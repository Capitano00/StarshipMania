import * as THREE from 'three';

const paint = (color: number, metalness = .28, roughness = .62) =>
  new THREE.MeshStandardMaterial({color, metalness, roughness});

const frame = paint(0x222d3d, .64, .55);
const joint = paint(0x637487, .7, .44);
const armor = paint(0xe1ddcf);
const sage = paint(0x647c71);
const deck = paint(0x152336, .44, .76);
const plateDark = paint(0x2a3b51, .45, .65);
const plateLight = paint(0x44556b, .52, .66);
const recess = paint(0x101821, .32, .78);
const ice = new THREE.MeshBasicMaterial({color: 0x9de7dd, toneMapped: false});
const violet = new THREE.MeshBasicMaterial({color: 0xd0b3ff, toneMapped: false});
const violetSoft = new THREE.MeshBasicMaterial({color: 0x7964a7, toneMapped: false});
const warm = new THREE.MeshBasicMaterial({color: 0xd6af7e, toneMapped: false});

type Point = readonly [number, number];
type Material = THREE.Material;

function block(w: number, h: number, d: number, material: Material, x = 0, y = 0, z = 0) {
  const result = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  result.position.set(x, y, z);
  return result;
}

function plate(points: readonly Point[], depth: number, material: Material, x = 0, y = 0, z = 0, bevel = .035) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [px, py] of points.slice(1)) shape.lineTo(px, py);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  const result = new THREE.Mesh(geometry, material);
  result.position.set(x, y, z);
  return result;
}

function chamfer(w: number, h: number, d: number, edge: number, material: Material, x = 0, y = 0, z = 0) {
  const a = w / 2, b = h / 2;
  return plate([[-a + edge, b], [a - edge, b], [a, b - edge], [a, -b + edge],
    [a - edge, -b], [-a + edge, -b], [-a, -b + edge], [-a, b - edge]], d, material, x, y, z, edge * .34);
}

function cylinder(radius: number, length: number, material: Material, x = 0, y = 0, z = 0) {
  const result = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
  result.position.set(x, y, z);
  return result;
}

/** Player model with the same ground origin, facing and moving parts as the arena blockout. */
export function createMechVisual() {
  const root = new THREE.Group();
  root.name = 'Peregrine hero mech';
  const legs: THREE.Group[] = [];

  root.add(chamfer(.65, .54, .65, .13, frame, 0, 1.17, .02));
  root.add(plate([[-.42, .26], [.42, .26], [.49, -.07], [.21, -.28], [-.21, -.28], [-.49, -.07]],
    .54, sage, 0, 1.29, -.19));
  root.add(chamfer(1.05, .87, .61, .16, frame, 0, 1.95, 0));
  root.add(plate([[-.63, .27], [-.43, .39], [.43, .39], [.63, .27], [.51, -.13], [.29, -.3], [-.29, -.3], [-.51, -.13]],
    .48, armor, 0, 2.05, -.21));
  root.add(plate([[-.31, .18], [.31, .18], [.22, -.28], [-.22, -.28]], .13, sage, 0, 2.05, -.50));
  root.add(chamfer(.67, .59, .39, .10, frame, 0, 2.06, .44));
  root.add(chamfer(.39, .62, .33, .07, armor, 0, 2.12, .63));
  root.add(chamfer(.17, .29, .03, .035, recess, 0, 2.17, .82));
  root.add(block(.10, .13, .018, violet, 0, 2.18, .842));

  root.add(cylinder(.20, .23, joint, 0, 2.53, 0));
  root.add(plate([[-.32, .10], [-.24, .26], [.21, .26], [.31, .09], [.26, -.20], [.10, -.27],
    [-.14, -.27], [-.27, -.18]], .48, armor, 0, 2.82, -.04));
  root.add(plate([[-.27, .09], [.26, .09], [.16, -.10], [-.20, -.085]], .035, recess, 0, 2.83, -.31, .016));
  root.add(plate([[-.22, .035], [.21, .045], [.15, -.035], [-.18, -.023]], .016, violet, 0, 2.86, -.344, .008));
  const fin = plate([[-.10, -.29], [.05, -.19], [.07, .38], [-.02, .51], [-.13, .12]],
    .09, sage, -.25, 2.84, .07, .016);
  fin.rotation.z = -.13;
  root.add(fin, block(.40, .045, .025, violetSoft, 0, 2.86, .235));

  for (const side of [-1, 1]) {
    const hip = cylinder(.19, .18, joint, side * .43, 1.05, 0);
    hip.rotation.z = Math.PI / 2;
    root.add(hip);
    const leg = new THREE.Group();
    leg.name = side < 0 ? 'Left articulated leg' : 'Right articulated leg';
    leg.position.set(side * .40, 1.16, 0);
    leg.add(chamfer(.36, .76, .42, .07, frame, 0, -.31, 0));
    leg.add(plate([[-.21, .25], [.21, .25], [.15, -.26], [-.14, -.20]], .30, armor, 0, -.28, -.10));
    const knee = cylinder(.16, .37, joint, 0, -.59, .02);
    knee.rotation.z = Math.PI / 2;
    leg.add(knee, chamfer(.38, .28, .26, .07, sage, 0, -.62, -.17));
    leg.add(plate([[-.18, .25], [.19, .26], [.23, -.16], [.17, -.29], [-.17, -.29], [-.22, -.12]],
      .38, armor, 0, -.85, .04));
    leg.add(chamfer(.30, .22, .19, .04, recess, 0, -.87, .28));
    leg.add(block(.12, .035, .022, violet, 0, -.83, .39));
    leg.add(chamfer(.49, .18, .72, .08, frame, 0, -1.06, -.12));
    leg.add(chamfer(.43, .18, .42, .07, sage, 0, -1.02, -.34));
    root.add(leg);
    legs.push(leg);

    const shoulder = plate([[-.31, .20], [-.12, .33], [.23, .25], [.35, .08], [.32, -.16], [-.26, -.20]],
      .66, armor, side * .77, 2.30, .02);
    shoulder.rotation.z = -side * .10;
    root.add(shoulder, chamfer(.38, .50, .40, .07, frame, side * .86, 1.94, .02));
    root.add(chamfer(.44, .61, .42, .09, armor, side * .90, 1.51, -.04));
    root.add(chamfer(.32, .22, .33, .04, joint, side * .91, 1.18, -.04));
    root.add(chamfer(.27, .53, .30, .06, sage, side * .35, 2.10, .54));
    const thruster = cylinder(.11, .23, recess, side * .35, 1.94, .73);
    thruster.rotation.x = Math.PI / 2;
    const light = cylinder(.067, .023, violet, side * .35, 1.94, .855);
    light.rotation.x = Math.PI / 2;
    root.add(thruster, light);
  }

  const shield = plate([[-.24, .54], [.14, .62], [.38, .36], [.31, -.31], [.11, -.65], [-.18, -.44], [-.33, .13]],
    .17, sage, -1.13, 1.97, .08, .045);
  shield.rotation.y = -.71;
  shield.rotation.z = -.15;
  shield.add(chamfer(.32, .74, .063, .09, armor, .00, .01, .11));
  shield.add(block(.082, .27, .012, violetSoft, -.041, -.129, .153));
  root.add(shield);

  const gun = chamfer(.32, .31, 1.08, .065, frame, .95, 1.50, -.70);
  gun.name = 'Forearm emitter';
  gun.add(chamfer(.33, .13, .62, .047, sage, 0, .15, -.02));
  gun.add(block(.19, .083, .04, ice, 0, .01, -.56));
  root.add(gun);
  return {root, legs, gun};
}

/** Low, tapered Shield Manta with matching silhouettes and separate aft identity lights. */
export function createDroneVisual(id: string) {
  const drone = new THREE.Group();
  drone.name = `${id} Shield Manta`;
  const wing = plate([[-.98, .19], [-.78, -.15], [-.44, -.36], [-.20, -.65], [0, -.76],
    [.20, -.65], [.44, -.36], [.78, -.15], [.98, .19], [.66, .51], [.28, .35],
    [.15, .55], [-.15, .55], [-.28, .35], [-.66, .51]], .14, frame, 0, .01, 0, .039);
  wing.rotation.x = Math.PI / 2;
  drone.add(wing);
  for (const side of [-1, 1]) {
    const shoulder = plate([[.24, -.36], [.56, -.21], [.88, .15], [.64, .39], [.25, .20], [.17, -.09]]
      .map(([x, y]) => [x * side, y] as const), .12, armor, 0, .123, 0, .04);
    shoulder.rotation.x = Math.PI / 2;
    drone.add(shoulder);
    const ski = plate([[.27, .13], [.57, .30], [.67, .38], [.49, .49], [.26, .35]]
      .map(([x, y]) => [x * side, y] as const), .079, sage, 0, .135, 0, .021);
    ski.rotation.x = Math.PI / 2;
    drone.add(ski);
    drone.add(chamfer(.18, .12, .27, .04, frame, side * .44, .02, .35));
    drone.add(chamfer(.12, .069, .024, .02, violetSoft, side * .44, .037, .494));
  }
  drone.add(chamfer(.43, .22, .78, .10, sage, 0, .19, -.055));
  drone.add(chamfer(.37, .15, .36, .053, armor, 0, .285, -.205));
  drone.add(chamfer(.30, .09, .061, .037, recess, 0, .289, -.44));
  drone.add(block(.22, .024, .018, ice, 0, .292, -.48));
  const identity = id === 'U2' ? violet : ice;
  drone.add(block(.19, .051, .021, identity, 0, .168, .35));
  if (id === 'U2') drone.add(block(.19, .025, .021, identity, 0, .24, .35));
  return drone;
}

function repeated(name: string, size: readonly [number, number, number], positions: readonly THREE.Vector3[], material: Material) {
  const meshes = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), material, positions.length);
  meshes.name = name;
  const matrix = new THREE.Matrix4();
  positions.forEach((position, i) => meshes.setMatrixAt(i, matrix.makeTranslation(position.x, position.y, position.z)));
  return meshes;
}

/** Collision and navigation retain their original ArenaLayout dimensions. */
export function createCarrierDeck(width: number, half: number) {
  const scene = new THREE.Group();
  scene.name = 'Carrier exterior deck';
  scene.add(block(width, .21, width, deck, 0, -.115, 0));
  scene.add(block(width - .38, 1.2, width - .38, frame, 0, -.91, 0));
  scene.add(block(width - 2.9, 1.05, width - 2.9, recess, 0, -1.88, 0));

  const darkSeams: THREE.Vector3[] = [];
  const sideRibs: THREE.Vector3[] = [];
  const lane: THREE.Vector3[] = [];
  const edge: THREE.Vector3[] = [];
  for (let row = -half + 3; row < half - 1; row += 4) {
    darkSeams.push(new THREE.Vector3(0, -.003, row));
    for (const side of [-1, 1]) {
      lane.push(new THREE.Vector3(side * 3.2, .012, row));
      edge.push(new THREE.Vector3(side * (half - .63), .09, row));
      sideRibs.push(new THREE.Vector3(side * (half - .09), -.74, row));
    }
  }
  scene.add(repeated('Deck plate seams', [width - 1.45, .012, .055], darkSeams, recess));
  scene.add(repeated('Sequenced lane markers', [.13, .018, .74], lane, violetSoft));
  scene.add(repeated('Deck edge lights', [.22, .09, 1.15], edge, ice));
  scene.add(repeated('Carrier hull riblets', [.22, .48, .78], sideRibs, plateLight));
  for (const side of [-1, 1]) {
    scene.add(block(.29, .38, width, plateDark, side * half, .1, 0));
    scene.add(block(width, .38, .29, plateDark, 0, .10, side * half));
    scene.add(block(.13, .05, width - .5, plateLight, side * (half - 2.1), .019, 0));
  }
  return scene;
}

export function createLaunchGate() {
  const group = new THREE.Group();
  group.name = 'Carrier launch aperture';
  for (const side of [-1, 1]) {
    const pylon = plate([[-1.15, 0], [1.15, 0], [1.28, 4.8], [.17, 6.78], [-1.15, 6.33]],
      1.38, plateDark, side * 8.45, 0, 0, .08);
    pylon.scale.x = side;
    group.add(pylon);
    group.add(chamfer(1.01, 3.5, .53, .15, recess, side * 8.22, 2.47, 1.0));
    group.add(chamfer(.46, 2.12, .112, .09, plateLight, side * 8.10, 2.43, 1.36));
    for (const z of [-.76, .84]) {
      group.add(block(.089, 2.83, .037, violetSoft, side * 7.65, 2.14, z));
      group.add(block(.12, 1.10, .044, ice, side * 7.65, 2.39, z - .033));
    }
    group.add(block(1.77, .14, 2.7, plateLight, side * 8.60, .12, .18));
  }
  group.add(chamfer(17.96, .90, 1.21, .19, frame, 0, 6.16, 0));
  group.add(chamfer(10.70, .33, 1.39, .115, plateLight, 0, 6.22, 0));
  group.add(block(5.18, .075, .017, ice, 0, 6.25, .73));
  group.add(block(5.18, .075, .017, ice, 0, 6.25, -.73));
  group.add(block(12.98, .016, .16, violetSoft, 0, .017, 0));
  return group;
}

function stars() {
  let seed = 4681;
  const random = () => {seed = (seed * 16807) % 2147483647; return seed / 2147483647;};
  const background = new Float32Array(620 * 3);
  const brightness = new Float32Array(background.length);
  for (let i = 0; i < 620; i++) {
    const a = random() * Math.PI * 2;
    const y = random() * 1.65 - .55;
    const r = Math.sqrt(1 - Math.min(y * y, 1));
    background.set([r * Math.cos(a) * 130, Math.min(1, y) * 125, r * Math.sin(a) * 130], i * 3);
    const light = .2 + random() ** 3 * .62;
    brightness.set([light * .83, light * .92, light], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(background, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(brightness, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    vertexColors: true, size: 1.25, sizeAttenuation: false, depthWrite: false, fog: false, toneMapped: false,
  }));
  points.name = 'Outer-orbit star field';
  return points;
}

const planetSurface = new THREE.ShaderMaterial({
  fog: false,
  vertexShader: `varying vec3 localNormal;
    void main(){localNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `varying vec3 localNormal;
    float hash(vec3 p){return fract(sin(dot(p,vec3(17.43,37.67,67.91)))*43758.5453);}
    float noise(vec3 p){
      vec3 i=floor(p);vec3 f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    void main(){
      vec3 n=normalize(localNormal);
      float wave=noise(n*7.0)*0.55+noise(n*15.0)*0.29+noise(n*36.0)*0.16;
      float stripe=sin(n.y*26.0+wave*5.0)*0.5+0.5;
      float lit=smoothstep(-0.37,0.20,dot(n,normalize(vec3(-0.65,0.70,0.39))));
      vec3 rock=mix(vec3(.042,.09,.19),vec3(.20,.33,.45),stripe*.40+wave*.45);
      vec3 cloud=mix(rock,vec3(.35,.56,.66),smoothstep(.60,.77,wave)*.45);
      float haze=pow(clamp(1.0-n.z,0.0,1.0),2.5);
      vec3 color=mix(vec3(.011,.018,.040),cloud,lit) + vec3(.10,.20,.37)*haze*lit*.22;
      gl_FragColor=vec4(color,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

/** Depth-correct planet and optional background points, compatible with ArenaFx's enclosing sky. */
export function createOrbitalBackdrop({withStars = true} = {}) {
  const result = new THREE.Group();
  result.name = 'Orbital backdrop';
  const planet = new THREE.Group();
  planet.name = 'Eos gas giant';
  planet.position.set(29, -13, -66);
  planet.rotation.z = -.34;

  const surface = new THREE.Mesh(new THREE.SphereGeometry(20, 40, 28), planetSurface);
  planet.add(surface);
  for (const [inner, outer, alpha] of [[24, 25, .19], [26, 30, .26], [31, 31.6, .14]]) {
    const rings = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), new THREE.MeshBasicMaterial({
      color: 0x8da1c3, opacity: alpha, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    rings.rotation.x = -Math.PI / 2.55;
    planet.add(rings);
  }
  result.add(planet);
  if (withStars) result.add(stars());
  return result;
}
