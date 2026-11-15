/**
 * Presentation-only visual effects for the live arena.
 *
 * Reads Simulation state and adds its own objects to the ArenaView scene. It never
 * mutates simulation, controls or command state, and owns no gameplay meshes, so it
 * can be disabled (`?classic`) without changing play. Colours follow the HUD tokens
 * designed in Figma ("StarshipMania — Tactical HUD").
 */
import * as THREE from 'three';
import {arenaBounds} from '../arena-layout';
import type {Simulation} from '../simulation';
import type {TargetId, Vec2} from '../contracts';

export const fxPalette = {
  drone: 0xcbb7f4, pilot: 0x90dcd1, enemy: 0xffb65d, preview: 0xf4d577, critical: 0xff7a6b,
  skyTop: 0x05080f, horizon: 0x141a2c, nebula: 0x3a2a63, grid: 0x5fc9c0,
} as const;

/** Radial glow built from raw pixels, so it works without a DOM canvas (and in Node tests). */
export function glowTexture(size = 64, falloff = 2.2) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.min(1, Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1));
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(Math.pow(1 - d, falloff) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

const additive = (color: number, map: THREE.Texture, opacity = 1) => new THREE.SpriteMaterial({
  map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
});
const flatAdditive = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
});

const skyVertex = `varying vec3 vDir;
void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const skyFragment = `uniform vec3 top;uniform vec3 horizon;uniform vec3 nebula;uniform float time;varying vec3 vDir;
void main(){
  float h=clamp(vDir.y,-1.0,1.0);
  vec3 col=mix(horizon,top,smoothstep(-0.02,0.55,h));
  float band=exp(-pow((h-0.10)*5.0,2.0));
  float swirl=0.55+0.45*sin(vDir.x*4.0+vDir.z*2.6+time*0.03)*sin(vDir.z*3.4-vDir.x*1.7-time*0.02);
  col+=nebula*band*swirl*0.55;
  gl_FragColor=vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const gridVertex = `varying vec2 vWorld;
void main(){vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xz;gl_Position=projectionMatrix*viewMatrix*w;}`;
const gridFragment = `uniform vec3 color;uniform vec2 focus;uniform float time;uniform float halfSize;varying vec2 vWorld;
float line(float v,float w){float d=abs(fract(v)-0.5);return smoothstep(0.5-w,0.5,d);}
void main(){
  vec2 g=vWorld/2.0+0.5;
  float minor=max(line(g.x,0.035),line(g.y,0.035));
  float dist=length(vWorld-focus);
  float near=exp(-dist*dist/220.0);
  float pulse=0.5+0.5*sin(dist*0.55-time*1.6);
  float edge=smoothstep(halfSize-1.4,halfSize,max(abs(vWorld.x),abs(vWorld.y)));
  float a=minor*(0.05+0.40*near*(0.65+0.35*pulse))+edge*0.35;
  gl_FragColor=vec4(color*a,a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

type Burst = {mesh: THREE.Mesh; flash: THREE.Sprite; age: number; life: number; grow: number; strength: number};
type TurretMark = {group: THREE.Group; brackets: THREE.Mesh[]; health: THREE.Mesh; healthStep: number; material: THREE.MeshBasicMaterial; healthMaterial: THREE.MeshBasicMaterial; beacon: THREE.Mesh; beaconMaterial: THREE.MeshBasicMaterial};
/** Agent-requested highlight (structurally identical to the HUD contract's AgentTargetMark). */
export type FxAgentMark = {targetId: TargetId; phase: 'proposing' | 'executing'; droneId: string; since: number};
type DroneFx = {halo: THREE.Sprite; core: THREE.Sprite; light: THREE.PointLight; trail: THREE.Sprite[]; history: THREE.Vector3[]; last: THREE.Vector3 | null; tether: THREE.Line; packets: THREE.Sprite[]};
type ShotFx = {sprites: THREE.Sprite[]};

const TRAIL = 22, SHOT_TAIL = 4, PACKETS = 3;
const toWorld = (p: Vec2, y = 0, out = new THREE.Vector3()) => out.set(p.x, y, p.y);

export class ArenaFx {
  readonly root = new THREE.Group();
  private glow = glowTexture(64, 2.2);
  private soft = glowTexture(64, 1.2);
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private grid: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private mechRing: THREE.Mesh;
  private mechGlow: THREE.Sprite;
  private drones = new Map<string, DroneFx>();
  private shots = new Map<number, ShotFx>();
  private turrets = new Map<TargetId, TurretMark>();
  private bursts: Burst[] = [];
  private run = '';
  private lastHit = 0;
  private lastEvent = 0;
  private accepted = new Set<string>();
  private health = new Map<TargetId, number>();
  private frame = 0;
  private restore: {toneMapping: THREE.ToneMapping; exposure: number; background: THREE.Scene['background']; fog: THREE.Scene['fog']};

  constructor(private scene: THREE.Scene, private renderer?: {toneMapping: THREE.ToneMapping; toneMappingExposure: number}) {
    this.root.name = 'arena-fx';
    this.restore = {toneMapping: renderer?.toneMapping ?? THREE.NoToneMapping, exposure: renderer?.toneMappingExposure ?? 1, background: scene.background, fog: scene.fog};
    if (renderer) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3; }
    scene.background = new THREE.Color(fxPalette.horizon);
    scene.fog = new THREE.Fog(fxPalette.horizon, 38, 110);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), new THREE.ShaderMaterial({
      vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {top: {value: new THREE.Color(fxPalette.skyTop)}, horizon: {value: new THREE.Color(fxPalette.horizon)}, nebula: {value: new THREE.Color(fxPalette.nebula)}, time: {value: 0}},
    }));
    this.sky.renderOrder = -10; this.sky.name = 'fx-sky';
    this.root.add(this.sky, this.stars());

    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(arenaBounds.width, arenaBounds.width), new THREE.ShaderMaterial({
      vertexShader: gridVertex, fragmentShader: gridFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2,
      uniforms: {color: {value: new THREE.Color(fxPalette.grid)}, focus: {value: new THREE.Vector2()}, time: {value: 0}, halfSize: {value: arenaBounds.half}},
    }));
    this.grid.rotation.x = -Math.PI / 2; this.grid.position.y = .03; this.grid.name = 'fx-grid';
    this.root.add(this.grid);

    const rim = new THREE.DirectionalLight(0x8f7fe0, 1.4); rim.position.set(-14, 9, -24); rim.name = 'fx-rim';
    const fill = new THREE.DirectionalLight(0x5fc9c0, .5); fill.position.set(16, 6, 12); fill.name = 'fx-fill';
    this.root.add(rim, fill);

    this.mechRing = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.32, 48), flatAdditive(fxPalette.pilot, .7));
    this.mechRing.rotation.x = -Math.PI / 2; this.mechRing.name = 'fx-mech-ring';
    this.mechGlow = new THREE.Sprite(additive(fxPalette.pilot, this.soft, .22)); this.mechGlow.scale.setScalar(4.2);
    this.root.add(this.mechRing, this.mechGlow);
    scene.add(this.root);
  }

  private stars() {
    const count = 900, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < count; i++) {
      const theta = rand() * Math.PI * 2, y = .04 + rand() * .96, r = Math.sqrt(1 - y * y), radius = 135;
      positions.set([Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius], i * 3);
      const b = .35 + rand() * .65, tint = rand();
      colors.set([b * (tint > .8 ? 1 : .82), b * .86, b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({size: 1.1, map: this.glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false}));
    points.name = 'fx-stars'; points.renderOrder = -9;
    return points;
  }

  private drone(id: string) {
    let fx = this.drones.get(id);
    if (fx) return fx;
    const halo = new THREE.Sprite(additive(fxPalette.drone, this.soft, .42)); halo.scale.setScalar(2.6);
    const core = new THREE.Sprite(additive(0xe4d9ff, this.glow, .95)); core.scale.setScalar(.9);
    const light = new THREE.PointLight(fxPalette.drone, 6, 7, 1.6);
    const trail = Array.from({length: TRAIL}, () => { const s = new THREE.Sprite(additive(fxPalette.drone, this.glow, 0)); s.visible = false; return s; });
    const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({color: fxPalette.drone, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false}));
    tether.frustumCulled = false;
    const packets = Array.from({length: PACKETS}, () => { const s = new THREE.Sprite(additive(0xe4d9ff, this.glow, .9)); s.scale.setScalar(.45); return s; });
    fx = {halo, core, light, trail, history: [], last: null, tether, packets};
    this.root.add(halo, core, light, tether, ...trail, ...packets);
    this.drones.set(id, fx);
    return fx;
  }

  private turret(id: TargetId) {
    let mark = this.turrets.get(id);
    if (mark) return mark;
    const group = new THREE.Group(), material = flatAdditive(fxPalette.enemy, .8), healthMaterial = flatAdditive(fxPalette.enemy, .55);
    const brackets = [0, 1, 2, 3].map(i => { const m = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.05, 12, 1, i * Math.PI / 2 + Math.PI / 12, Math.PI / 3), material); m.rotation.x = -Math.PI / 2; group.add(m); return m; });
    const health = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.55, 48, 1, Math.PI / 2, Math.PI * 2), healthMaterial); health.rotation.x = -Math.PI / 2; group.add(health);
    const beaconMaterial = flatAdditive(fxPalette.preview, 0);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.09, .55, 7, 16, 1, true), beaconMaterial);
    beacon.position.y = 3.5; beacon.visible = false; group.add(beacon);
    group.position.y = .07; group.name = 'fx-target-' + id;
    mark = {group, brackets, health, healthStep: 20, material, healthMaterial, beacon, beaconMaterial};
    this.root.add(group); this.turrets.set(id, mark);
    return mark;
  }

  private burst(at: THREE.Vector3, color: number, size = 1, life = 26, strength = .9) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(.82, 1, 40), flatAdditive(color, strength));
    mesh.rotation.x = -Math.PI / 2; mesh.position.copy(at).setY(.12); mesh.scale.setScalar(.2 * size);
    const flash = new THREE.Sprite(additive(color, this.glow, 1)); flash.position.copy(at).setY(1); flash.scale.setScalar(2.4 * size);
    this.root.add(mesh, flash);
    this.bursts.push({mesh, flash, age: 0, life, grow: 3.4 * size, strength});
  }

  private clearTransient() {
    for (const b of this.bursts) this.dropBurst(b);
    this.bursts = [];
    for (const shot of this.shots.values()) for (const s of shot.sprites) { this.root.remove(s); s.material.dispose(); }
    this.shots.clear();
    for (const d of this.drones.values()) { d.history = []; d.last = null; for (const s of d.trail) s.visible = false; }
    this.health.clear();
  }

  private dropBurst(b: Burst) {
    this.root.remove(b.mesh, b.flash); b.mesh.geometry.dispose(); (b.mesh.material as THREE.Material).dispose(); b.flash.material.dispose();
  }

  /** Call once per rendered frame, before ArenaView.draw, with read-only simulation state. */
  update(sim: Simulation, preview: TargetId | null = null, aimed: TargetId | null = null, agentMarks: readonly FxAgentMark[] = []) {
    this.frame++;
    const t = this.frame / 60;
    if (sim.runId !== this.run) {
      this.clearTransient(); this.run = sim.runId;
      this.lastHit = sim.lastHit?.id ?? 0; this.lastEvent = sim.events.entries[0]?.id ?? 0;
    }
    this.sky.material.uniforms.time.value = t;
    const gridScale = (sim.bounds?.width ?? arenaBounds.width) / arenaBounds.width;
    this.grid.scale.set(gridScale,gridScale,1);
    this.grid.material.uniforms.halfSize.value = sim.bounds?.half ?? arenaBounds.half;
    this.grid.material.uniforms.time.value = t;
    this.grid.material.uniforms.focus.value.set(sim.position.x, sim.position.y);

    // Pilot mech: ground ring + soft glow.
    toWorld(sim.position, .05, this.mechRing.position);
    this.mechRing.scale.setScalar(1 + Math.sin(t * 3) * .04 + (sim.dash ? .25 : 0));
    toWorld(sim.position, 1.2, this.mechGlow.position);

    const assigned = new Map<TargetId, number>();
    sim.funnels.forEach((f, i) => {
      const fx = this.drone(f.id);
      const pos = toWorld(f.position, 1.6 + Math.sin(sim.tick * .08 + i) * .05);
      fx.halo.position.copy(pos);
      const pulse = .9 + Math.sin(t * 5 + i) * .1;
      fx.halo.scale.setScalar(2.6 * pulse);
      fx.light.position.copy(pos).setY(1.1);
      const moving = !!fx.last && fx.last.distanceToSquared(pos) > 1e-5;
      const dir = moving ? pos.clone().sub(fx.last!).normalize() : new THREE.Vector3();
      fx.core.position.copy(pos).addScaledVector(dir, -.75);
      fx.core.scale.setScalar(moving ? 1.05 : .75);
      if (moving) { fx.history.unshift(fx.core.position.clone()); if (fx.history.length > TRAIL) fx.history.length = TRAIL; }
      else if (fx.history.length && this.frame % 2 === 0) fx.history.pop();
      fx.last = pos;
      fx.trail.forEach((s, k) => {
        const p = fx.history[k];
        s.visible = !!p;
        if (!p) return;
        const fade = 1 - k / TRAIL;
        s.position.copy(p); s.scale.setScalar(1.05 * fade + .18); s.material.opacity = .42 * fade * fade;
      });
      const target = f.order.type === 'INTERCEPT' ? sim.turrets.find(tu => tu.id === (f.order as {targetId: TargetId}).targetId && tu.health > 0) : undefined;
      fx.tether.visible = !!target;
      fx.packets.forEach(p => p.visible = !!target);
      if (target) {
        assigned.set(target.id, (assigned.get(target.id) ?? 0) + 1);
        const end = toWorld(target.position, .9);
        const attr = fx.tether.geometry.getAttribute('position') as THREE.BufferAttribute;
        attr.setXYZ(0, pos.x, pos.y, pos.z); attr.setXYZ(1, end.x, end.y, end.z); attr.needsUpdate = true;
        fx.packets.forEach((p, k) => p.position.lerpVectors(pos, end, ((t * .9 + k / PACKETS) % 1)));
      }
    });
    for (const [id, fx] of this.drones) if (!sim.funnels.some(f => f.id === id)) { fx.halo.visible = fx.core.visible = fx.tether.visible = false; }

    // Target indicators: rotating brackets + health arc; colour shows threat / preview / assignment.
    for (const tu of sim.turrets) {
      const mark = this.turret(tu.id);
      const alive = tu.health > 0, previous = this.health.get(tu.id);
      if (previous !== undefined && previous > 0 && !alive) { const at = toWorld(tu.position); this.burst(at, fxPalette.enemy, 1.8, 40); this.burst(at, fxPalette.critical, 1.1, 30); }
      this.health.set(tu.id, tu.health);
      mark.group.visible = alive;
      if (!alive) continue;
      toWorld(tu.position, .07, mark.group.position);
      const agent = agentMarks.find(m => m.targetId === tu.id && m.phase === 'executing') ?? agentMarks.find(m => m.targetId === tu.id);
      if (agent?.phase === 'executing') {
        const key = `${agent.droneId}|${agent.targetId}|${agent.since}`;
        if (!this.accepted.has(key)) { this.accepted.add(key); this.burst(toWorld(tu.position), fxPalette.drone, 1.6, 34); }
      }
      const isPreview = preview === tu.id || agent?.phase === 'proposing', isAssigned = assigned.has(tu.id) || agent?.phase === 'executing', isAimed = aimed === tu.id;
      const color = isPreview ? fxPalette.preview : isAssigned ? fxPalette.drone : tu.armed ? fxPalette.enemy : fxPalette.pilot;
      mark.material.color.setHex(color); mark.healthMaterial.color.setHex(color);
      mark.material.opacity = isPreview || isAssigned ? .95 : isAimed ? .8 : .45;
      mark.group.rotation.y = t * (isPreview ? 1.6 : isAssigned ? .9 : .35);
      mark.group.scale.setScalar(isPreview ? 1.12 + Math.sin(t * 8) * .04 : isAimed ? 1.05 : 1);
      mark.beacon.visible = !!agent;
      if (agent) { mark.beaconMaterial.color.setHex(agent.phase === 'proposing' ? fxPalette.preview : fxPalette.drone); mark.beaconMaterial.opacity = agent.phase === 'proposing' ? .16 + Math.sin(t * 6) * .08 : .26; }
      const step = Math.max(1, Math.round(tu.health / 5));
      if (step !== mark.healthStep) {
        mark.healthStep = step; mark.health.geometry.dispose();
        mark.health.geometry = new THREE.RingGeometry(1.45, 1.55, 48, 1, Math.PI / 2, Math.PI * 2 * step / 20);
      }
    }

    // Projectiles: glowing head with a short streak behind it.
    const alive = new Set<number>();
    for (const shot of sim.projectiles) {
      alive.add(shot.id);
      let fx = this.shots.get(shot.id);
      const color = shot.team === 'enemy' ? fxPalette.enemy : shot.team === 'pilot' ? fxPalette.pilot : fxPalette.drone;
      if (!fx) {
        fx = {sprites: Array.from({length: SHOT_TAIL + 1}, (_, k) => { const s = new THREE.Sprite(additive(color, this.glow, k ? .5 * (1 - k / (SHOT_TAIL + 1)) : 1)); return s; })};
        fx.sprites.forEach(s => this.root.add(s)); this.shots.set(shot.id, fx);
      }
      const speed = Math.hypot(shot.velocity.x, shot.velocity.y) || 1;
      const head = shot.team === 'enemy' ? 1.15 : shot.team === 'pilot' ? .8 : .95;
      fx.sprites.forEach((s, k) => {
        s.position.set(shot.position.x - shot.velocity.x / speed * k * .32, 1, shot.position.y - shot.velocity.y / speed * k * .32);
        s.scale.setScalar(head * (1 - k * .16));
      });
    }
    for (const [id, fx] of this.shots) if (!alive.has(id)) { for (const s of fx.sprites) { this.root.remove(s); s.material.dispose(); } this.shots.delete(id); }

    // Hit confirmations from the simulation's own collision record.
    const hit = sim.lastHit;
    if (hit && hit.id !== this.lastHit) {
      this.lastHit = hit.id;
      const target = sim.turrets.find(tu => tu.id === hit.target);
      if (target) this.burst(toWorld(target.position), hit.team === 'funnel' ? fxPalette.drone : fxPalette.pilot, .8, 22);
    }
    // Command feedback: accepted Deploy pulses at the target, Recall sends a shockwave from the mech.
    const fresh = sim.events.entries.filter(e => e.id > this.lastEvent);
    if (fresh.length) this.lastEvent = fresh[0].id;
    for (const e of fresh) {
      if (e.outcome !== 'Accepted') continue;
      if (e.action === 'Recall') this.burst(toWorld(sim.position), fxPalette.drone, 1.9, 34, .55);
      else if (e.target) { const tu = sim.turrets.find(x => x.id === e.target); if (tu) this.burst(toWorld(tu.position), fxPalette.drone, 1.3, 30); }
    }
    for (const b of this.bursts) {
      b.age++;
      const k = b.age / b.life;
      b.mesh.scale.setScalar(.2 + b.grow * (1 - Math.pow(1 - k, 3)));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = b.strength * (1 - k);
      b.flash.material.opacity = Math.max(0, 1 - k * 2.2);
    }
    this.bursts = this.bursts.filter(b => { if (b.age < b.life) return true; this.dropBurst(b); return false; });
  }

  /** Counts for tests and diagnostics. */
  stats() {
    return {drones: this.drones.size, shots: this.shots.size, bursts: this.bursts.length, targets: [...this.turrets.values()].filter(m => m.group.visible).length,
      tethers: [...this.drones.values()].filter(d => d.tether.visible).length};
  }

  dispose() {
    this.clearTransient();
    this.scene.remove(this.root);
    this.root.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach(x => x.dispose()); });
    this.glow.dispose(); this.soft.dispose();
    this.scene.background = this.restore.background; this.scene.fog = this.restore.fog;
    if (this.renderer) { this.renderer.toneMapping = this.restore.toneMapping; this.renderer.toneMappingExposure = this.restore.exposure; }
  }
}
