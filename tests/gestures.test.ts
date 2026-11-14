import {describe,it,expect} from 'vitest';
import {GestureBindings,defaultBindings,recognize,type Recognition} from '../src/gestures';
const pose=(category:string,score=1):Recognition=>({category,score});
const durationBindings=()=>{const b=new GestureBindings(),c=defaultBindings();c.durationMs=1500;b.configure(c);b.reset();return b;};
const presets={Left:'Balanced',Right:'Balanced'} as const;
describe('fresh-observation gesture bindings, not physical recognition evidence',()=>{
 it('uses per-hand enter/retain presets and never retains through None or another pose',()=>{
  expect(recognize(pose('Open_Palm'),undefined as unknown as 'Balanced')).toBeNull();
  expect(recognize(pose('Closed_Fist',.6),'Balanced')).toBeNull();expect(recognize(pose('Closed_Fist',.6),'Balanced','Closed_Fist')).toBe('Closed_Fist');
  expect(recognize(pose('Closed_Fist',.6),'Strict','Closed_Fist')).toBeNull();expect(recognize(pose('Closed_Fist',.6),'Forgiving')).toBe('Closed_Fist');
  for(const category of ['None','Unknown','unsupported'])expect(recognize(pose(category),'Forgiving','Closed_Fist')).toBeNull();
 });
 it('requires 80 ms and at least two distinct fresh samples before fire, then stops on any non-fist',()=>{
  const b=durationBindings(),f=(t:number,c='Closed_Fist',score=1)=>b.sample(t,pose('Open_Palm'),pose(c,score),presets,null,null);
  f(0);expect(b.fire).toBe(false);f(79);expect(b.fire).toBe(false);f(80);expect(b.fire).toBe(true);f(90,'Closed_Fist',.55);expect(b.fire).toBe(true);
  f(100,'None');expect(b.fire).toBe(false);f(110,'Closed_Fist',.55);expect(b.fire).toBe(false);f(120);expect(b.fire).toBe(false);f(200);expect(b.fire).toBe(true);
  for(const category of ['Open_Palm','Victory','Thumb_Up','Thumb_Down','ILoveYou']){f(300,category);expect(b.fire).toBe(false);}
 });
 it('duplicate timestamps and 201 ms gaps never supply fire confirmation',()=>{
  const b=durationBindings();for(let i=0;i<10;i++)b.sample(0,pose('Open_Palm'),pose('Closed_Fist'),presets,null,null);expect(b.fire).toBe(false);
  b.sample(201,pose('Open_Palm'),pose('Closed_Fist'),presets,null,null);expect(b.fire).toBe(false);
 });
 it('commits at 1500 ms without release, fires concurrently, and emits once until open',()=>{
  const b=durationBindings();const actions=[];
  for(let t=0;t<=4000;t+=20){const action=b.sample(t,pose('Pointing_Up'),pose('Closed_Fist'),presets,'T1','T1');if(action)actions.push({t,action});}
  expect(actions).toEqual([{t:1500,action:{type:'INTERCEPT',targetId:'T1'}}]);expect(b.fire).toBe(true);
  b.sample(4020,pose('Victory'),pose('Open_Palm'),presets,null,null);expect(b.pending).toBeNull();
  b.sample(4040,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);expect(b.consumed).toBe(false);
 });
 it('uncertainty pauses without credit for <=150 ms, then continuing the same pose earns only fresh time',()=>{
  const b=durationBindings();for(let t=0;t<=600;t+=20)b.sample(t,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1');
  b.sample(620,pose('None'),pose('Open_Palm'),presets,'T1','T1');b.sample(760,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1');expect(b.progress).toBe(600);
  b.sample(780,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1');expect(b.progress).toBe(620);
 });
 it.each(['long uncertainty','different pose','target change','cancel','reset'])('%s clears accrued command hold',kind=>{
  const b=durationBindings();for(let t=0;t<=600;t+=20)b.sample(t,pose('Pointing_Up'),pose('Open_Palm'),presets,'T1','T1');
  if(kind==='long uncertainty'){b.sample(620,pose('None'),pose('Open_Palm'),presets,'T1','T1');b.sample(780,pose('None'),pose('Open_Palm'),presets,'T1','T1');}
  if(kind==='different pose')b.sample(620,pose('Victory'),pose('Open_Palm'),presets,'T1','T1');
  if(kind==='target change')b.nominationChanged('T2');if(kind==='cancel')b.cancel();if(kind==='reset')b.reset(true);
  expect(b.progress).toBe(0);
 });
 it('a different command can begin before consumption; recall never interrupts the independent pilot trigger',()=>{
  const b=durationBindings();for(let t=0;t<=100;t+=20)b.sample(t,pose('Pointing_Up'),pose('Closed_Fist'),presets,'T1','T1');
  let action;for(let t=120;t<=1620;t+=20)action=b.sample(t,pose('Victory'),pose('Closed_Fist'),presets,null,null);
  expect(action).toEqual({type:'RECALL'});expect(b.fire).toBe(true);
 });
 it('unpainted or unavailable target never earns deployment dwell',()=>{
  for(const target of ['T1',null] as const){const b=durationBindings();for(let t=0;t<=3000;t+=20)expect(b.sample(t,pose('Pointing_Up'),pose('Open_Palm'),presets,target,null)).toBeNull();expect(b.progress).toBe(0);}
 });
 it('simulation rejection resets an attempted hold without interrupting fire or requiring an accepted-command rearm',()=>{
  const b=durationBindings();for(let t=0;t<=1500;t+=20)b.sample(t,pose('Pointing_Up'),pose('Closed_Fist'),presets,'T1','T1');expect(b.consumed).toBe(true);b.rejected();expect(b.consumed).toBe(false);expect(b.fire).toBe(true);
  b.sample(1520,pose('Victory'),pose('Closed_Fist'),presets,null,null);expect(b.pending).toEqual({type:'RECALL'});expect(b.progress).toBe(0);
 });
});
