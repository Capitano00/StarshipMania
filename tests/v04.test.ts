import {describe,it,expect} from 'vitest';
import {GestureBindings,defaultBindings,bindingError} from '../src/gestures';
import {Simulation,actorDefinitions} from '../src/simulation';
import {RoundEvents,LogCursor} from '../src/round-events';
import {clearLine,length} from '../src/cover';
import {neutralFrame} from '../src/contracts';
import {Controls} from '../src/controls';
const pose=(category:string)=>({category,score:1});
const presets={Left:'Balanced',Right:'Balanced'} as const;
describe('v0.4 bounded bindings and fire',()=>{
 it('a consumed deploy hand does not block a fresh recall on the other hand',()=>{
  for(const rejected of [false,true]){
   const b=new GestureBindings(),c=defaultBindings();c.durationMs=500;c.bindings.recall={hand:'Right',pose:'Victory',activation:'Duration'};b.configure(c);
   b.sample(0,pose('Open_Palm'),pose('Open_Palm'),presets,'T1','T1');let result;
   for(let t=20;t<=520;t+=20)result=b.sample(t,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1');
   expect(result).toEqual({type:'INTERCEPT',targetId:'T1'});expect(b.consumed).toBe(true);
   for(let t=540;t<=1040;t+=20)result=b.sample(t,pose('Pointing_Up'),pose('Victory'),presets,'T1','T1');
   expect(result).toEqual({type:'RECALL'});if(rejected)b.rejected();
   for(let t=1060;t<=2060;t+=20){expect(b.sample(t,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1')).toBeNull();}
   expect(b.consumed).toBe(true);expect(b.pending).toBeNull();
   b.sample(2080,pose('Open_Palm'),pose('Open_Palm'),presets,'T1','T1');expect(b.consumed).toBe(false);
  }
 });
 it('validates catalogue collisions, reserved poses and exact timing bounds',()=>{
  expect(bindingError(defaultBindings())).toBeNull();
  for(const durationMs of [499,501,3001,NaN]){const c=defaultBindings();c.durationMs=durationMs;expect(bindingError(c)).not.toBeNull();}
  for(const durationMs of [500,1000,3000]){const c=defaultBindings();c.durationMs=durationMs;expect(bindingError(c)).toBeNull();}
  for(const durationMs of [500,1000,3000]){const c=defaultBindings();c.durationMs=durationMs;expect(bindingError(c)).toBeNull();}
  const c=defaultBindings();c.bindings.recall={...c.bindings.deploy};expect(bindingError(c)).toContain('only one');
  c.bindings.recall={hand:'Right',pose:'Open_Palm' as 'Victory',activation:'Duration'};expect(bindingError(c)).toContain('reserved');
 });
 it('confirms both fire signals independently and stops immediately on uncertain or changed pose',()=>{
  const b=new GestureBindings();b.sample(0,pose('Closed_Fist'),pose('Closed_Fist'),presets,null,null);expect(b.padisarahFire).toBe(false);
  b.sample(80,pose('Closed_Fist'),pose('Closed_Fist'),presets,null,null);expect(b.fire&&b.padisarahFire).toBe(true);
  b.sample(100,pose('None'),pose('Closed_Fist'),presets,null,null);expect(b.padisarahFire).toBe(false);expect(b.fire).toBe(true);
  b.sample(120,pose('Closed_Fist'),pose('Victory'),presets,null,null);expect(b.fire||b.padisarahFire).toBe(false);
  b.sample(321,pose('Closed_Fist'),pose('Closed_Fist'),presets,null,null);expect(b.fire||b.padisarahFire).toBe(false);
 });
 it('cross-hand recall wins, rearms on its own hand, and respects edited dwell',()=>{
  const b=new GestureBindings(),c=defaultBindings();c.bindings.recall={hand:'Right',pose:'Victory',activation:'Duration'};c.durationMs=500;b.configure(c);
  b.sample(0,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);
  let result;for(let t=20;t<=520;t+=20)result=b.sample(t,pose('Pointing_Up'),pose('Victory'),presets,'T1','T1');
  expect(result).toEqual({type:'RECALL'});b.sample(540,pose('Open_Palm'),pose('Victory'),presets,'T1','T1');expect(b.consumed).toBe(true);
  b.sample(560,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1');expect(b.consumed).toBe(false);expect(b.pending?.type).toBe('INTERCEPT');
 });
 it('keeps movement/aim and both fire signals concurrent, with zero fresh recenter output',()=>{
  const c=new Controls();let sequence=0;const feed=(time:number,closed=false)=>c.ingest({epoch:c.epoch,sequence:++sequence,capturedAt:time,processingMs:0,hands:[{side:'Left',confidence:1,palm:{x:closed?.34:.3,y:.5},gesture:pose(closed?'Closed_Fist':'Open_Palm')},{side:'Right',confidence:1,palm:{x:closed?.74:.7,y:.5},gesture:pose(closed?'Closed_Fist':'Open_Palm')}]},time);
  feed(0);expect(c.calibrate(0)&&c.resume(0)).toBe(true);expect(c.update(0,null).frame.fire).toBe(false);feed(20,true);c.update(20,null);feed(100,true);const f=c.update(100,null).frame;expect(f.fire&&f.padisarahFire).toBe(true);expect(f.move.x).toBeGreaterThan(0);expect(f.aim.x).toBeGreaterThan(0);c.pause();expect(c.update(101,null).frame.fire).toBe(false);expect(c.bindings.padisarahFire).toBe(false);
 });
});
describe('v0.4 six actors, manual training and events',()=>{
 it('has the exact roster, cover-free deterministic patrols and all six count for victory',()=>{
  const s=new Simulation(),b=new Simulation();expect(s.turrets).toHaveLength(6);expect(s.turrets.filter(t=>t.armed).map(t=>t.id)).toEqual(['T1','T2','T3','T5']);
  for(const t of actorDefinitions)for(let i=0;i<t.patrol.length;i++)expect(clearLine(t.patrol[i],t.patrol[(i+1)%t.patrol.length],1.4)).toBe(true);
  s.turrets.forEach(t=>t.cooldown=99999);b.turrets.forEach(t=>t.cooldown=99999);for(let i=0;i<300;i++){s.step(neutralFrame());b.step(neutralFrame());}expect(s.turrets).toEqual(b.turrets);expect(s.turrets[4].position).not.toEqual(actorDefinitions[4].position);
  s.turrets.slice(0,5).forEach(t=>t.health=0);s.step(neutralFrame());expect(s.outcome).toBe('playing');s.turrets[5].health=0;s.step(neutralFrame());expect(s.outcome).toBe('won');
 });
 it('default deployment does not fire; manual hit unlocks training and opt-in auto is explicit',()=>{
  for(const auto of [false,true]){const s=new Simulation('test','training');s.accept(s.envelope({type:'INTERCEPT',targetId:'T1'},'local-hand-commit','cmd-1'));for(let i=0;i<300;i++)s.step(neutralFrame());expect(s.padisarahHits).toBe(0);expect(s.trainingStep).toBe(1);
   for(let i=0;i<300&&s.trainingStep===1;i++)s.step({...neutralFrame(),padisarahFire:!auto},[],auto);expect(s.trainingStep).toBe(2);expect(s.turrets.every(t=>t.health===100&&!t.armed)).toBe(true);expect(s.projectiles.some(p=>p.team==='enemy')).toBe(false);s.stopFire();expect(s.padisarahFire).toBe(false);
  }
 });
 it('replans assigned moving target without redirecting and gates blocked firing',()=>{
  const s=new Simulation('route','training');s.accept(s.envelope({type:'INTERCEPT',targetId:'T5'},'local-hand-commit','cmd-1'));const requested={...s.funnels[0].requested};for(let i=0;i<400;i++)s.step({...neutralFrame(),padisarahFire:true});expect(length(requested,s.funnels[0].requested)).toBeGreaterThan(.3);expect(s.order).toEqual({type:'INTERCEPT',targetId:'T5'});expect(s.accepted).toBe(1);
  for(let i=0;i<1000;i++)s.step({...neutralFrame(),padisarahFire:true});expect(s.padisarahHits).toBeGreaterThan(0);
  s.funnels.forEach(f=>f.blocked=true);expect(s.fireState).toContain('Blocked');
 });
 it('logs bounded semantic transitions and preserves older reading until Latest',()=>{
  const s=new Simulation();s.step({...neutralFrame(),fire:true});for(let i=0;i<20;i++)s.step({...neutralFrame(),fire:true});expect(s.events.entries.filter(e=>e.action==='Pilot fire')).toHaveLength(1);s.stopFire();expect(s.events.entries[0].outcome).toBe('Stopped');
  const e=new RoundEvents(),cursor=new LogCursor();e.add(0,'Recall','Accepted');cursor.update('one',e.entries);cursor.readOlder();for(let i=1;i<=30;i++)e.add(i,'Deploy','Rejected');cursor.update('one',e.entries);expect(e.entries).toHaveLength(20);expect(e.entries[0].id).toBe(31);expect(cursor.rows[0].id).toBe(1);expect(cursor.unread).toBe(30);cursor.showLatest();cursor.update('one',e.entries);expect(cursor.rows[0].id).toBe(31);cursor.update('two',[]);expect(cursor.rows).toEqual([]);expect(cursor.unread).toBe(0);
 });
});
