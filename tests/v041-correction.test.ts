import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {ArenaView} from '../src/view';
import {Simulation} from '../src/simulation';
import {Controls,type Hand} from '../src/controls';
import {PracticeFireFeedback} from '../src/practice';
import {defaultBindings} from '../src/gestures';
import {arenaBounds} from '../src/arena-layout';

// Real production projection/raycast methods; only WebGL construction is omitted.
function projectionHost(){
 const view=Object.assign(Object.create(ArenaView.prototype),{camera:new THREE.PerspectiveCamera(52,1,.1,200),scene:new THREE.Scene(),mech:new THREE.Group(),turrets:new Map(),walls:[],layoutKey:false,ray:new THREE.Raycaster(),ground:new THREE.Plane(new THREE.Vector3(0,1,0),-1),canvas:{clientWidth:640,clientHeight:640},drawnRun:'',candidate:null}) as ArenaView;
 const sim=new Simulation('edge','training');sim.turrets=[];return {view,sim};
}
const hand=(side:'Left'|'Right',category='Open_Palm'):Hand=>({side,palm:{x:side==='Left'?.3:.7,y:.5},confidence:1,gesture:{category,score:1}});
describe('Critic v0.4.1 shared aim limits and feedback timing',()=>{
 it.each([{x:25,y:0},{x:-25,y:0},{x:0,y:25},{x:0,y:-25}])('projects the expanded edge without the obsolete 24-unit clamp: %j',point=>{
  const {view,sim}=projectionHost();sim.position={...point};const out=view.aim(view.projectWorld(point,sim),sim);expect(out.point.x).toBeCloseTo(point.x,9);expect(out.point.y).toBeCloseTo(point.y,9);
 });
 it('uses the shared outer aim limit on both axes',()=>{
  const {view,sim}=projectionHost();sim.position={x:0,y:arenaBounds.mechLimit};for(const point of [{x:40,y:40},{x:-40,y:-40}]){const aim=view.aim(view.projectWorld(point,sim),sim).point;expect(aim.x).toBe(Math.sign(point.x)*arenaBounds.aimLimit);expect(aim.y).toBe(Math.sign(point.y)*arenaBounds.aimLimit);}
 });
 it('neutral horizontal aim is x25 and remains world-fixed after right loss while the mech moves',()=>{
  const {view,sim}=projectionHost(),c=new Controls();sim.position={x:25,y:15};c.ingest({epoch:c.epoch,sequence:1,capturedAt:0,hands:[hand('Left'),hand('Right')],processingMs:0},0);c.calibrate(0);c.resume(0);
  const held=view.aim(c.pointer(0),sim).point;expect(held.x).toBeCloseTo(25,9);
  const left=hand('Left');left.palm.x=.23;c.ingest({epoch:c.epoch,sequence:2,capturedAt:20,hands:[left],processingMs:0},20);const out=c.update(20,null);expect(c.handReady('Right',20)).toBe(false);expect(out.frame.move.x).toBeLessThan(0);sim.step({...out.frame,aim:held});expect(sim.position.x).toBeLessThan(25);
  const retained=view.aim(view.projectWorld(held,sim),sim).point;expect(retained.x).toBeCloseTo(held.x,9);expect(retained.y).toBeCloseTo(held.y,9);expect(c.paused).toBe(false);
 });
 it('Duration feedback uses the selected global 2.0 seconds for open and confirming poses',()=>{
  const feedback=new PracticeFireFeedback(),config=defaultBindings();config.durationMs=2000;config.bindings.pilotFire.activation='Duration';
  for(const pose of ['Open_Palm','Closed_Fist']){const text=feedback.text(false,hand('Right',pose),'',config.bindings.pilotFire,config.durationMs);expect(text).toContain('Duration 2.0 s');expect(text).not.toContain('0.5 s');}
 });
 it('Instant feedback remains the 80ms safety label regardless of global Duration',()=>{
  const config=defaultBindings();expect(new PracticeFireFeedback().text(false,hand('Right'),'',config.bindings.pilotFire,2000)).toContain('Instant; 80 ms safety confirmation');
 });
});
