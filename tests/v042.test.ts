import {describe,it,expect} from 'vitest';
import {GestureBindings,defaultBindings,type Recognition} from '../src/gestures';
const pose=(category:string,score=1):Recognition=>({category,score});
const presets={Left:'Balanced',Right:'Balanced'} as const;
function deploy(){const g=new GestureBindings();for(let t=0;t<=500;t+=20)g.sample(t,pose('Pointing_Up'),pose('Closed_Fist'),presets,'T1','T1');g.acknowledge(true);return g;}
describe('v0.4.2 deliberate pose-transition rearm and gate diagnostics',()=>{
 it('a later non-gesture acknowledgement cannot turn a rejected gesture into Issued',()=>{
  const g=new GestureBindings();for(let t=0;t<=500;t+=20)g.sample(t,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1');g.acknowledge(false);g.cancel(520);g.acknowledge(true);expect(g.readiness('deploy',true,'T1','T1').state).not.toBe('Issued');
 });
 it('direct deploy -> Victory rearms after 80ms, then earns a separate Recall duration without a target',()=>{
  const g=deploy();expect(g.readiness('deploy',true,'T1','T1').state).toBe('Issued');let result;
  for(let t=520;t<=1100;t+=20){result=g.sample(t,pose('Victory'),pose('Closed_Fist'),presets,null,null);if(t<600)expect(g.readiness('recall',true,null,null).state).toBe('Change pose to rearm');if(t===600){expect(g.pending).toEqual({type:'RECALL'});expect(g.progress).toBe(0);}if(t<1100)expect(result).toBeNull();}
  expect(result).toEqual({type:'RECALL'});expect(g.fire).toBe(true);expect(g.readiness('recall',true,null,null).state).not.toBe('Issued');g.acknowledge(true);expect(g.readiness('recall',true,null,null).state).toBe('Issued');
 });
 it('continuous fire -> deploy stops that fire immediately and retains the other hand fire',()=>{
  const g=new GestureBindings();g.sample(0,pose('Closed_Fist'),pose('Closed_Fist'),presets,'T1','T1');g.sample(80,pose('Closed_Fist'),pose('Closed_Fist'),presets,'T1','T1');expect(g.fire&&g.padisarahFire).toBe(true);let result;
  for(let t=100;t<=600;t+=20){result=g.sample(t,pose('Pointing_Up'),pose('Closed_Fist'),presets,'T1','T1');expect(g.padisarahFire).toBe(false);expect(g.fire).toBe(true);}expect(result).toEqual({type:'INTERCEPT',targetId:'T1'});
 });
 it('same completed pose never repeats and opposite-hand changes cannot rearm it',()=>{
  const g=deploy();for(let t=520;t<=3000;t+=20)expect(g.sample(t,pose('Pointing_Up'),pose(t%80?'Open_Palm':'Victory'),presets,'T1','T1')).toBeNull();expect(g.consumed).toBe(true);
 });
 it.each(['missing','None','low score'])('%s is not a deliberate pose change and cannot rearm a completed hold',kind=>{
  const g=deploy();for(let t=520;t<=1000;t+=20){if(kind==='missing')g.lose('Left');g.sample(t,kind==='missing'?undefined:pose(kind==='None'?'None':'Victory',kind==='low score'?.2:1),pose('Open_Palm'),presets,null,null);}for(let t=1020;t<=1800;t+=20)expect(g.sample(t,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1')).toBeNull();expect(g.consumed).toBe(true);
 });
 it('79ms, repeated timestamps and an interrupted transition never provide the 80ms fresh confirmation',()=>{
  const g=deploy();g.sample(520,pose('Victory'),pose('Open_Palm'),presets,null,null);for(let i=0;i<10;i++)g.sample(520,pose('Victory'),pose('Open_Palm'),presets,null,null);g.sample(599,pose('Victory'),pose('Open_Palm'),presets,null,null);expect(g.pending).toBeNull();g.sample(600,pose('None'),pose('Open_Palm'),presets,null,null);g.sample(620,pose('Victory'),pose('Open_Palm'),presets,null,null);g.sample(699,pose('Victory'),pose('Open_Palm'),presets,null,null);expect(g.pending).toBeNull();g.sample(700,pose('Victory'),pose('Open_Palm'),presets,null,null);expect(g.pending?.type).toBe('RECALL');expect(g.progress).toBe(0);
 });
 it('Open Palm remains immediate explicit rearm and cancellation',()=>{
  const g=deploy();g.sample(520,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);expect(g.consumed).toBe(false);g.sample(540,pose('Victory'),pose('Open_Palm'),presets,null,null);g.sample(560,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);expect(g.pending).toBeNull();expect(g.progress).toBe(0);
 });
 it('custom right-hand bindings use right-hand transitions and preserve Recall priority',()=>{
  const g=new GestureBindings(),c=defaultBindings();c.bindings.deploy={hand:'Right',pose:'Thumb_Up',activation:'Duration'};c.bindings.recall={hand:'Right',pose:'Thumb_Down',activation:'Instant'};g.configure(c);g.sample(-20,pose('Open_Palm'),pose('Open_Palm'),presets,'T1','T1');for(let t=0;t<=500;t+=20)g.sample(t,pose('Closed_Fist'),pose('Thumb_Up'),presets,'T1','T1');g.acknowledge(true);
  g.sample(520,pose('Open_Palm'),pose('Thumb_Up'),presets,null,null);expect(g.consumed).toBe(true);let result;for(let t=540;t<=700;t+=20)result=g.sample(t,pose('Closed_Fist'),pose('Thumb_Down'),presets,null,null);expect(result).toEqual({type:'RECALL'});expect(g.padisarahFire).toBe(true);
 });
 it('target changes reset dwell, and Recall readiness never depends on nomination',()=>{
  const g=new GestureBindings();for(let t=0;t<=300;t+=20)g.sample(t,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1');g.nominationChanged('T2');g.sample(320,pose('Pointing_Up'),pose('Open_Palm'),presets,'T2',null);expect(g.progress).toBe(0);expect(g.readiness('deploy',true,'T2',null).state).toBe('No eligible target');g.sample(340,pose('Victory'),pose('Open_Palm'),presets,null,null);expect(g.readiness('recall',true,null,null).state).toBe('Confirming');expect(g.progress).toBe(0);
 });
 it('readiness reports actual identity/pose/threshold gates and never claims a rejected command was issued',()=>{
  const g=new GestureBindings();expect(g.readiness('deploy',false,null,null,'Strict').threshold).toBe(.8);expect(g.readiness('deploy',false,null,null).state).toBe('Waiting for hand');g.sample(0,pose('Pointing_Up',.7),pose('Open_Palm'),presets,null,null);expect(g.readiness('deploy',true,null,null).state).toBe('No eligible target');g.sample(20,pose('Pointing_Up',.6),pose('Open_Palm'),presets,'T1','T1');expect(g.readiness('deploy',true,'T1','T1').threshold).toBe(.55);for(let t=40;t<=520;t+=20)g.sample(t,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1');g.acknowledge(false);expect(g.readiness('deploy',true,'T1','T1').state).not.toBe('Issued');expect(g.readiness('deploy',true,'T1','T1').interruption).toContain('rejected');
 });
});
