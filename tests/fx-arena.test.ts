import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {ArenaFx, glowTexture} from '../src/fx/arena-fx';
import {Simulation} from '../src/simulation';
import {neutralFrame} from '../src/contracts';

const snapshot = (sim: Simulation) => JSON.stringify({tick: sim.tick, health: sim.health, position: sim.position,
  funnels: sim.funnels.map(f => ({...f})), turrets: sim.turrets.map(t => ({...t})), projectiles: sim.projectiles.length, events: sim.events.entries.length});

describe('arena fx (presentation only)', () => {
  it('builds a radial glow texture without a DOM canvas', () => {
    const texture = glowTexture(16);
    const data = texture.image.data as Uint8Array;
    expect(data.length).toBe(16 * 16 * 4);
    expect(data[(8 * 16 + 8) * 4 + 3]).toBeGreaterThan(200);
    expect(data[3]).toBe(0);
  });

  it('tracks drones, targets, tethers and command pulses from real simulation state without mutating it', () => {
    const scene = new THREE.Scene(), renderer = {toneMapping: THREE.NoToneMapping as THREE.ToneMapping, toneMappingExposure: 1};
    const fx = new ArenaFx(scene, renderer);
    const sim = new Simulation('fx-run');
    expect(scene.children).toContain(fx.root);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);

    const before = snapshot(sim);
    fx.update(sim, null, null);
    expect(snapshot(sim)).toBe(before);
    expect(fx.stats()).toMatchObject({drones: 2, targets: sim.turrets.length, tethers: 0});

    sim.step(neutralFrame(), [sim.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-hand-commit', 'cmd-1')]);
    for (let i = 0; i < 5; i++) { sim.step(neutralFrame()); fx.update(sim, 'T1', 'T1'); }
    expect(sim.funnels.every(f => f.order.type === 'INTERCEPT')).toBe(true);
    expect(fx.stats().tethers).toBe(2);
    expect(fx.stats().bursts).toBeGreaterThan(0);

    sim.step(neutralFrame(), [sim.envelope({type: 'RECALL'}, 'local-keyboard-recall', 'cmd-2')]);
    fx.update(sim);
    expect(fx.stats().tethers).toBe(0);
  });

  it('clears transient effects on a new run and restores the scene on dispose', () => {
    const scene = new THREE.Scene(); const background = new THREE.Color(0x09131c); scene.background = background;
    const renderer = {toneMapping: THREE.NoToneMapping as THREE.ToneMapping, toneMappingExposure: 1};
    const fx = new ArenaFx(scene, renderer);
    const sim = new Simulation('a');
    sim.step(neutralFrame(), [sim.envelope({type: 'INTERCEPT', targetId: 'T2'}, 'local-hand-commit', 'cmd-1')]);
    fx.update(sim);
    fx.update(new Simulation('b'));
    expect(fx.stats().bursts).toBe(0);
    fx.dispose();
    expect(scene.children).not.toContain(fx.root);
    expect(scene.background).toBe(background);
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
  });
});
