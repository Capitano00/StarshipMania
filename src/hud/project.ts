/**
 * World point → normalized device coordinates, the same result as THREE.Vector3.project(camera).
 *
 * The HUD mounts at page start, before the arena (and Three.js) has loaded on demand. Doing this one projection with the
 * camera's own matrices lets the HUD avoid importing Three.js, so the 3D engine stays out of the first download.
 */
import type {Camera} from 'three';

type Matrix=ArrayLike<number>;
/** Matrix4.applyToVector3 with its perspective divide; elements are column-major, as in Three.js. */
function apply(m:Matrix,x:number,y:number,z:number):[number,number,number]{
  const w=1/(m[3]*x+m[7]*y+m[11]*z+m[15]);
  return [(m[0]*x+m[4]*y+m[8]*z+m[12])*w,(m[1]*x+m[5]*y+m[9]*z+m[13])*w,(m[2]*x+m[6]*y+m[10]*z+m[14])*w];
}

export function projectToScreen(x:number,y:number,z:number,camera:Camera){
  const [vx,vy,vz]=apply(camera.matrixWorldInverse.elements,x,y,z);
  const [nx,ny,nz]=apply(camera.projectionMatrix.elements,vx,vy,vz);
  return {x:nx,y:ny,z:nz};
}
