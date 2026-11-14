import {describe,it,expect} from 'vitest';
import {Controls,type Observation} from '../src/controls';
import {GestureBindings,defaultBindings,bindingError} from '../src/gestures';
import {Simulation,actorDefinitions} from '../src/simulation';
import {barriers,clearLine,freePoint,route} from '../src/cover';
import {arenaBounds} from '../src/arena-layout';
import {mapPoint} from '../src/arena-inspector';
import {neutralFrame} from '../src/contracts';
const pose=(category='Open_Palm')=>({category,score:1});
const presets={Left:'Balanced',Right:'Balanced'} as const;
function host(){
 const c=new Controls();let sequence=0;
 const feed=(time:number,left:string|null='Open_Palm',right:string|null='Open_Palm',x=.34)=>{
  const hands:Observation['hands']=[];
  if(left)hands.push({side:'Left',confidence:1,palm:{x,y:.5},gesture:pose(left)});
  if(right)hands.push({side:'Right',confidence:1,palm:{x:.7,y:.5},gesture:pose(right)});
  c.ingest({epoch:c.epoch,sequence:++sequence,capturedAt:time,hands,processingMs:0},time);return c.update(time,'T1');
 };
 feed(0,'Open_Palm','Open_Palm',.3);c.calibrate(0);c.resume(0);return {c,feed};
}
describe('v0.4.1 independent hands, activation and full world',()=>{
 it.each(['low confidence','duplicate identity','crossed identities'])('%s suppresses affected input without pausing the session',kind=>{
  const {c,feed}=host();feed(20,'Closed_Fist','Closed_Fist');feed(100,'Closed_Fist','Closed_Fist');const s=structuredClone(c.latest!);s.sequence++;s.capturedAt=120;
  if(kind==='low confidence')s.hands[1].confidence=.74;if(kind==='duplicate identity')s.hands.push({...s.hands[1]});if(kind==='crossed identities')s.hands[0].palm.x=.75;
  c.ingest(s,120);const out=c.update(120,'T1');expect(out.frame.fire).toBe(false);expect(out.frame.padisarahFire).toBe(kind!=='crossed identities');expect(c.paused||c.needsRearm).toBe(false);
 });
 it('missing right preserves left movement and manual unit fire; right requires two fresh identities over 80ms',()=>{
  const {c,feed}=host(),neutral=structuredClone(c.neutral);feed(20,'Closed_Fist','Closed_Fist');expect(feed(100,'Closed_Fist','Closed_Fist').frame.fire).toBe(true);
  const lost=feed(120,'Closed_Fist',null);expect(lost.frame.move.x).toBeGreaterThan(0);expect(lost.frame.padisarahFire).toBe(true);expect(lost.frame.fire).toBe(false);expect(c.paused||c.needsRearm).toBe(false);
  feed(140,'Closed_Fist','Closed_Fist');expect(c.handReady('Right',140)).toBe(false);feed(219,'Closed_Fist','Closed_Fist');expect(c.handReady('Right',219)).toBe(false);feed(220,'Closed_Fist','Closed_Fist');expect(c.handReady('Right',220)).toBe(true);expect(feed(300,'Closed_Fist','Closed_Fist').frame.fire).toBe(true);expect(c.neutral).toEqual(neutral);
 });
 it('missing left preserves right pilot fire; provisional changed position never stays locked to pre-loss coordinates',()=>{
  const {c,feed}=host();feed(20,'Open_Palm','Closed_Fist');feed(100,'Open_Palm','Closed_Fist');expect(feed(120,null,'Closed_Fist').frame.fire).toBe(true);
  feed(140,'Open_Palm','Closed_Fist',.1);expect(c.handReady('Left',140)).toBe(false);feed(220,'Open_Palm','Closed_Fist',.11);expect(c.handReady('Left',220)).toBe(true);expect(c.neutral!.left.x).toBe(.3);
 });
 it('completed one-shot survives loss and held-pose return without duplicate; other hand command remains usable',()=>{
  const b=new GestureBindings(),config=defaultBindings();config.bindings.recall.hand='Right';b.configure(config);b.sample(0,pose(),pose(),presets,'T1','T1');let result;
  for(let t=20;t<=520;t+=20)result=b.sample(t,pose('Pointing_Up'),pose(),presets,'T1','T1');expect(result).toEqual({type:'INTERCEPT',targetId:'T1'});
  b.lose('Left');for(let t=540;t<=1040;t+=20)result=b.sample(t,pose('Pointing_Up'),pose('Victory'),presets,'T1','T1');expect(result).toEqual({type:'RECALL'});
  for(let t=1060;t<=1800;t+=20)expect(b.sample(t,pose('Pointing_Up'),pose('Victory'),presets,'T1','T1')).toBeNull();
  b.sample(1820,pose(),pose(),presets,'T1','T1');expect(b.consumed).toBe(false);
 });
 it('Instant one-shot and Duration continuous use independent execution with one global duration',()=>{
  const b=new GestureBindings(),c=defaultBindings();c.durationMs=700;c.bindings.pilotFire.activation='Duration';c.bindings.recall.activation='Instant';expect(bindingError(c)).toBeNull();b.configure(c);b.sample(0,pose(),pose(),presets,null,null);
  let recalls=0;for(let t=20;t<=720;t+=20){const a=b.sample(t,pose('Victory'),pose('Closed_Fist'),presets,null,null);if(a)recalls++;if(t<720)expect(b.fire).toBe(false);}
  expect(recalls).toBe(1);expect(b.fire).toBe(true);b.sample(740,pose('Victory'),pose('None'),presets,null,null);expect(b.fire).toBe(false);
  expect(defaultBindings().durationMs).toBe(500);expect(bindingError({...c,durationMs:750})).not.toBeNull();
 });
 it('full world shares bounds and scales placement, not barrier footprint; edge recall is reachable',()=>{
  expect(arenaBounds.width).toBe(54);expect(actorDefinitions[0].position).toEqual({x:-13.5,y:-10.5});expect(actorDefinitions[4].patrol[0]).toEqual({x:-19.5,y:-19.5});
  expect(barriers[0].minX).toBe(-13.5);expect(barriers[0].maxX-barriers[0].minX).toBe(6);expect(barriers[1].minY).toBe(-8.125);
  const s=new Simulation('expanded','training');expect(s.position).toEqual({x:0,y:15});
  for(const actor of actorDefinitions)for(let i=0;i<actor.patrol.length;i++)expect(clearLine(actor.patrol[i],actor.patrol[(i+1)%actor.patrol.length],1.4)).toBe(true);
  const goal=freePoint({x:28,y:28});expect(goal).not.toBeNull();if(!goal)throw new Error('Expected reachable free edge slot');expect(goal.x).toBeLessThanOrEqual(arenaBounds.unitLimit);expect(route({x:24,y:24},goal)).not.toBeNull();
  expect(mapPoint({x:-27,y:-27},200)).toEqual({x:0,y:0});expect(mapPoint({x:27,y:27},200)).toEqual({x:200,y:200});
 });
 it('combat and explicit autofire keep progressing with neutral manual input; opt-out never fires units',()=>{
  for(const auto of [false,true]){const s=new Simulation('autofire','training');s.accept(s.envelope({type:'INTERCEPT',targetId:'T1'},'local-hand-commit','cmd-1'));for(let i=0;i<700;i++)s.step(neutralFrame(),[],auto);expect(s.tick).toBe(700);expect(s.pilotFire).toBe(false);expect(s.padisarahHits>0).toBe(auto);}
 });
});
