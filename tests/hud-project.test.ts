import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {projectToScreen} from '../src/hud/project';

describe('HUD projection without Three.js at page start',()=>{
  it('matches THREE.Vector3.project for the arena camera at several positions',()=>{
    const camera=new THREE.PerspectiveCamera(52,16/9,.1,200);
    for(const [mx,mz] of [[0,15],[-12,4],[18,-9]] as const){
      // Same framing as ArenaView.setCamera: above and behind the mech, looking ahead.
      camera.position.set(mx,14,mz+19);camera.lookAt(mx,0,mz-9);camera.updateMatrixWorld();camera.updateProjectionMatrix();
      for(const [x,y,z] of [[mx,2.35,mz],[-13.5,1,-10.5],[18,1,7.5],[0,1,-18]] as const){
        const expected=new THREE.Vector3(x,y,z).project(camera),actual=projectToScreen(x,y,z,camera);
        expect(actual.x).toBeCloseTo(expected.x,10);expect(actual.y).toBeCloseTo(expected.y,10);expect(actual.z).toBeCloseTo(expected.z,10);
      }
    }
  });
  it('keeps Three.js out of the modules that load at page start',()=>{
    for(const file of ['src/main.ts','src/hud/hud.ts','src/hud/agent-voice.ts','src/hud/project.ts']){
      const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
      expect(source).not.toMatch(/^import (?!type)[^;]*from '(three|\.\/view|\.\/fx\/arena-fx)'/m);
    }
  });
});
