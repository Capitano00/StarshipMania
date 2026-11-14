import {describe,it,expect} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame,type Vec2,type DronePolicy} from '../src/contracts';
import {slidePath,movingImpact,barriers,inside,expand} from '../src/cover';
import {arenaBounds} from '../src/arena-layout';
import {GestureBindings,defaultBindings,bindingError,actions,type Recognition} from '../src/gestures';
import {bindingSettingsMarkup} from '../src/binding-settings';
const frame=()=>({...neutralFrame(),aim:{x:0,y:-15}});
const advance=(s:Simulation,n:number)=>{for(let i=0;i<n;i++)s.step(frame());};
const combat=(units=2)=>{const s=new Simulation('test','combat',units);s.turrets.forEach(t=>{t.armed=false;t.patrol=[];});return s;};
const policy=(s:Simulation,mode:DronePolicy='A',enabled=true)=>s.step(frame(),[],false,[s.intent({type:'DRONE_POLICY',mode,enabled})]);
const manual=(s:Simulation,id=1)=>s.envelope({type:'INTERCEPT',targetId:'T1'},'local-hand-commit',`cmd-${id}`);
const pose=(category:string):Recognition=>({category,score:1});const presets={Left:'Balanced',Right:'Balanced'} as const;
describe('v043 independent review corrections',()=>{
 it('FAW off revokes direct autofire applied in Settings while FAW remains active',()=>{
  const s=combat();policy(s);s.stopFire();s.setDirectAutofire();s.step(frame(),[],true);expect(s.fireAtWill).toBe(true);expect(s.padisarahFire).toBe(true);const orders=s.funnels.map(f=>({...f.order}));
  s.step(frame(),[],true,[s.intent({type:'DRONE_POLICY',mode:'A',enabled:false})]);expect(s.fireAtWill).toBe(false);expect(s.padisarahFire).toBe(false);expect(s.funnels.map(f=>f.order)).toEqual(orders);s.step(frame(),[],true);expect(s.padisarahFire).toBe(false);
 });
 it('continued held FAW cannot undo accepted Recall, including uncertainty/loss, until deliberate rearm',()=>{
  const s=combat();policy(s);const g=new GestureBindings(),c=defaultBindings();c.bindings.fireAtWill={hand:'Right',pose:'Thumb_Up',activation:'Duration'};g.configure(c);g.sample(-20,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);
  for(let t=0;t<=500;t+=20){const order=g.sample(t,pose('Victory'),pose('Thumb_Up'),presets,null,null);if(order){const accepted=s.accept(s.envelope(order,'local-hand-recall','cmd-1'));expect(accepted).toBe(true);g.acknowledge(accepted);}}
  expect(s.fireAtWill).toBe(false);for(let t=520;t<=1200;t+=20){g.sample(t,pose('Victory'),pose('Thumb_Up'),presets,null,null);expect(g.extraActions).toEqual([]);}
  g.lose('Right');g.sample(1220,pose('Victory'),undefined,presets,null,null);g.sample(1240,pose('Victory'),pose('None'),presets,null,null);for(let t=1260;t<=2200;t+=20){g.sample(t,pose('Victory'),pose('Thumb_Up'),presets,null,null);expect(g.extraActions).toEqual([]);}expect(s.fireAtWill).toBe(false);
  g.sample(2220,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);for(let t=2240;t<=2740;t+=20)g.sample(t,pose('Open_Palm'),pose('Thumb_Up'),presets,null,null);expect(g.extraActions).toEqual(['fireAtWill']);
 });
 it('rejected manual command does not create a false FAW rearm latch or change orders',()=>{
  const s=combat();policy(s);const prior=s.funnels.map(f=>({...f.order}));const g=new GestureBindings(),c=defaultBindings();c.bindings.fireAtWill={hand:'Right',pose:'Thumb_Up',activation:'Duration'};g.configure(c);g.sample(-20,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);
  for(let t=0;t<=500;t+=20){const order=g.sample(t,pose('Victory'),pose('Thumb_Up'),presets,null,null);if(order){const accepted=s.accept({...s.envelope(order,'local-hand-recall','cmd-1'),runId:'old'});expect(accepted).toBe(false);g.acknowledge(accepted);}}
  expect(s.fireAtWill).toBe(true);expect(s.funnels.map(f=>f.order)).toEqual(prior);for(let t=520;t<=1020;t+=20)g.sample(t,pose('Open_Palm'),pose('Thumb_Up'),presets,null,null);expect(g.extraActions).toEqual(['fireAtWill']);
 });
 it('FAW-specific suppression does not consume a fresh dash on that hand',()=>{const g=new GestureBindings(),c=defaultBindings();c.bindings.fireAtWill={hand:'Right',pose:'Thumb_Up',activation:'Duration'};c.bindings.shortDash={hand:'Right',pose:'Thumb_Down',activation:'Instant'};g.configure(c);g.sample(-20,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);g.manualOverride();g.sample(0,pose('Open_Palm'),pose('Thumb_Down'),presets,null,null);g.sample(80,pose('Open_Palm'),pose('Thumb_Down'),presets,null,null);expect(g.extraActions).toEqual(['shortDash']);});
});
describe('v043 booster movement and collision',()=>{
 it.each(['short','long'] as const)('%s replaces movement with exactly bounded pulse and one shared cooldown',kind=>{
  const s=combat();s.position={x:0,y:15};const f={...frame(),move:{x:1,y:0},fire:true};s.step(f,[],false,[s.intent({type:'DASH',kind,direction:s.dashDirection(f)})]);
  for(let i=1;i<(kind==='short'?12:18);i++)s.step(f);
  expect(s.position.x).toBeCloseTo(kind==='short'?4:6);expect(s.position.y).toBe(15);expect(s.dash).toBeNull();expect(s.projectiles.some(p=>p.team==='pilot')).toBe(true);
  s.step(frame(),[],false,[s.intent({type:'DASH',kind:'short',direction:{x:1,y:0}})]);expect(s.dash).toBeNull();advance(s,60-s.tick);s.step(frame(),[],false,[s.intent({type:'DASH',kind:'long',direction:{x:0,y:1}})]);expect(s.dash?.kind).toBe('long');
 });
 it('movement wins over aim; stationary uses aim then retained facing; diagonal is normalized',()=>{
  const s=combat();expect(s.dashDirection({...frame(),move:{x:1,y:1}})).toEqual({x:1,y:-1});expect(s.dashDirection({...frame(),aim:{x:5,y:15}})).toEqual({x:1,y:0});expect(s.dashDirection({...frame(),aim:{...s.position}})).toEqual({x:1,y:0});
  s.step(frame(),[],false,[s.intent({type:'DASH',kind:'short',direction:{x:1,y:-1}})]);advance(s,11);expect(Math.hypot(s.position.x,s.position.y-15)).toBeCloseTo(4);
 });
 it('short wins simultaneous; repeated/stale/cross-run intents cannot queue another pulse',()=>{
  const s=combat(),long=s.intent({type:'DASH',kind:'long',direction:{x:1,y:0}}),short=s.intent({type:'DASH',kind:'short',direction:{x:1,y:0}});s.step(frame(),[],false,[long,short]);expect(s.dash?.kind).toBe('short');advance(s,61);s.step(frame(),[],false,[short,{...s.intent({type:'DASH',kind:'long',direction:{x:1,y:0}}),runId:'old'}]);expect(s.dash).toBeNull();
 });
 it('ordinary no-input frames finish the pulse; explicit pause discards remainder; retry resets',()=>{
  const s=combat();s.step(frame(),[],false,[s.intent({type:'DASH',kind:'long',direction:{x:1,y:0}})]);advance(s,5);expect(s.dash).not.toBeNull();s.stopFire();const x=s.position.x;advance(s,30);expect(s.position.x).toBe(x);expect(s.dash).toBeNull();const next=combat();expect(next.dashReadyAt).toBe(0);
 });
 it('cover/corners/bounds block travel without refund or penetration',()=>{
  const s=combat();s.position={x:-10.5,y:2};s.step(frame(),[],false,[s.intent({type:'DASH',kind:'short',direction:{x:0,y:-1}})]);advance(s,11);expect(s.position.y).toBeGreaterThan(1.47);expect(s.dash).toBeNull();
  const path=slidePath({x:-14.5,y:2},{x:3,y:-3});expect(path.segments.length).toBeGreaterThan(1);for(const seg of path.segments)for(const b of barriers)expect(inside(seg.to,expand(b,.84))).toBe(false);
  s.position={x:arenaBounds.mechLimit-.1,y:15};advance(s,60);s.step(frame(),[],false,[s.intent({type:'DASH',kind:'long',direction:{x:1,y:1}})]);advance(s,17);expect(s.position.x).toBeLessThanOrEqual(arenaBounds.mechLimit);
 });
 it('relative sweep hits a moving mech even when both endpoint tests would miss',()=>{
  const s=combat();s.position={x:0,y:15};s.projectiles.push({id:900,position:{x:.16,y:14},velocity:{x:0,y:2},team:'enemy',life:10});s.step(frame(),[],false,[s.intent({type:'DASH',kind:'short',direction:{x:1,y:0}})]);expect(s.health).toBe(90);
 });
 it('relative impact uses sliding path segments, not a start-to-end chord',()=>{
  const path=[{from:{x:0,y:0},to:{x:2,y:0},start:0,end:.5},{from:{x:2,y:0},to:{x:2,y:2},start:.5,end:1}];expect(movingImpact({x:2,y:0},{x:2,y:0},path,.1)).not.toBeNull();expect(movingImpact({x:1,y:1},{x:1,y:1},path,.1)).toBeNull();
 });
 it('boundary contact uses its actual tick time then stops rather than stretching travel',()=>{const result=slidePath({x:arenaBounds.mechLimit-.1,y:15},{x:1,y:0});expect(result.segments[0].end).toBeCloseTo(.1);expect(result.segments.at(-1)!.from).toEqual(result.segments.at(-1)!.to);expect(result.position.x).toBe(arenaBounds.mechLimit);});
});
describe('v043 per-unit Fire at will',()=>{
 it('default off; A selects nearest among all six, including nonattacking, using stable ties',()=>{
  const s=combat();expect(s.fireAtWill).toBe(false);s.position={x:-19.5,y:9};policy(s);expect(s.funnels.every(f=>f.order.type==='INTERCEPT'&&f.order.targetId==='T4')).toBe(true);expect(s.deployments).toBe(0);expect(s.accepted).toBe(0);
  const tied=combat();tied.turrets.forEach((t,i)=>t.position={x:i===0?-5:i===1?5:20,y:15});policy(tied);expect(tied.funnels.every(f=>f.order.type==='INTERCEPT'&&f.order.targetId==='T1')).toBe(true);
 });
 it('B independently selects by unit position; collection fixtures support more than two',()=>{
  const s=combat(3);s.funnels[0].position={x:-19.5,y:9};s.funnels[1].position={x:18,y:9};s.funnels[2].position={x:13.5,y:-7};policy(s,'B');expect(new Set(s.funnels.map(f=>f.id)).size).toBe(3);expect(s.funnels[0].order).toEqual({type:'INTERCEPT',targetId:'T4'});expect(s.funnels[1].order).toEqual({type:'INTERCEPT',targetId:'T6'});expect(s.groupState).toContain('U1');
  s.accept(s.envelope({type:'RECALL'},'local-keyboard-recall','cmd-1'));advance(s,600);expect(s.funnels.every(f=>f.order.type==='RECALL')).toBe(true);expect(s.groupState).toBe('Following');
 });
 it('sticky while living; death reselects; mode switch explicitly replaces assignments',()=>{
  const s=combat();policy(s);const id=s.funnels[0].order.type==='INTERCEPT'?s.funnels[0].order.targetId:null;expect(id).not.toBeNull();s.position={x:-19.5,y:8};advance(s,10);expect(s.funnels[0].order).toEqual({type:'INTERCEPT',targetId:id});s.turrets.find(t=>t.id===id)!.health=0;advance(s,1);expect(s.funnels[0].order).not.toEqual({type:'INTERCEPT',targetId:id});policy(s,'B');expect(s.preferredPolicy).toBe('B');
 });
 it('rejected manual orders do not disable policy; accepted Deploy and Recall atomically exit it',()=>{
  const s=combat();policy(s);expect(s.accept({...manual(s),runId:'old'})).toBe(false);expect(s.fireAtWill).toBe(true);s.step(frame(),[manual(s)],true);expect(s.fireAtWill).toBe(false);expect(s.padisarahFire).toBe(false);expect(s.funnels.every(f=>f.origin==='manual'&&f.order.type==='INTERCEPT'&&f.order.targetId==='T1')).toBe(true);advance(s,1);expect(s.padisarahFire).toBe(false);
  policy(s);s.accept(s.envelope({type:'RECALL'},'local-keyboard-recall','cmd-2'));expect(s.fireAtWill).toBe(false);expect(s.funnels.every(f=>f.order.type==='RECALL')).toBe(true);
 });
 it('off keeps orders and permits manual fire, never restoring direct autofire without explicit setting',()=>{
  const s=combat();policy(s);const orders=s.funnels.map(f=>({...f.order}));policy(s,'A',false);expect(s.funnels.map(f=>f.order)).toEqual(orders);s.step(frame(),[],true);expect(s.padisarahFire).toBe(false);s.step({...frame(),padisarahFire:true});expect(s.padisarahFire).toBe(true);s.setDirectAutofire();s.step(frame(),[],true);expect(s.padisarahFire).toBe(true);
 });
 it('ordinary missing input does not stop auto; explicit pause stops fire without removing policy',()=>{
  const s=combat();policy(s);advance(s,200);expect(s.fireAtWill).toBe(true);expect(s.padisarahFire).toBe(true);expect(s.padisarahHits).toBeGreaterThan(0);expect(s.lastHit?.shooter).toMatch(/^U/);expect(s.lastHit?.assignmentOrigin).toBe('auto');s.stopFire();expect(s.padisarahFire).toBe(false);expect(s.fireAtWill).toBe(true);
 });
 it('unreachable initial targets wait with bounded semantic events; blocked assignment stays sticky',()=>{
  const s=combat();s.turrets.forEach(t=>t.position={x:100,y:100});policy(s);advance(s,100);expect(s.funnels.every(f=>f.order.type==='RECALL')).toBe(true);expect(s.events.entries.filter(e=>e.outcome==='Waiting').length).toBe(2);
  const t=combat();policy(t);const orders=t.funnels.map(f=>({...f.order}));for(const f of t.funnels)if(f.order.type==='INTERCEPT')t.turrets.find(a=>f.order.type==='INTERCEPT'&&a.id===f.order.targetId)!.position={x:100,y:100};advance(t,10);expect(t.funnels.map(f=>f.order)).toEqual(orders);expect(t.funnels.every(f=>f.blocked)).toBe(true);
 });
 it('manual tutorial excludes FAW, auto attribution, old hits and pilot hits',()=>{
  const s=new Simulation('training','training');policy(s);expect(s.fireAtWill).toBe(false);expect(s.trainingStep).toBe(0);s.accept(manual(s));s.projectiles.push({id:999,position:{...s.turrets[0].position},velocity:{x:0,y:0},team:'funnel',life:5,assignment:s.accepted,assignmentOrigin:'auto',shooter:'U1',assignedTarget:'T1'});advance(s,1);expect(s.trainingStep).toBe(1);for(let i=0;i<400&&s.trainingStep===1;i++)s.step({...frame(),padisarahFire:true});expect(s.trainingStep).toBe(2);expect(s.deployments).toBe(1);
 });
 it('manual order beats simultaneous policy enable without serializing a dash',()=>{const s=combat();s.step(frame(),[manual(s)],false,[s.intent({type:'DASH',kind:'short',direction:{x:1,y:0}}),s.intent({type:'DRONE_POLICY',mode:'A',enabled:true})]);expect(s.dash).not.toBeNull();expect(s.funnels.every(f=>f.order.type==='INTERCEPT'&&f.order.targetId==='T1')).toBe(true);});
});
describe('v043 catalogue and independent gesture channels',()=>{
 it('new actions unassigned; grouping/default activation and uniqueness remain typed',()=>{const c=defaultBindings();expect(bindingError(c)).toBeNull();expect(actions.shortDash.group).toBe('MECH');expect(actions.fireAtWill.group).toBe('DRONE');expect(c.bindings.shortDash.pose).toBe('Unassigned');expect(c.bindings.fireAtWill.activation).toBe('Duration');expect(bindingSettingsMarkup()).toContain('Unassigned');c.bindings.shortDash={...c.bindings.deploy};expect(bindingError(c)).toContain('only one action');});
 it('dash and deploy complete independently on opposite hands in the same sample',()=>{
  const g=new GestureBindings(),c=defaultBindings();c.bindings.shortDash={hand:'Right',pose:'Thumb_Up',activation:'Duration'};g.configure(c);g.sample(-20,pose('Open_Palm'),pose('Open_Palm'),presets,'T1','T1');let order;for(let t=0;t<=500;t+=20)order=g.sample(t,pose('Pointing_Up'),pose('Thumb_Up'),presets,'T1','T1');expect(order).toEqual({type:'INTERCEPT',targetId:'T1'});expect(g.extraActions).toEqual(['shortDash']);for(let t=520;t<=2000;t+=20){g.sample(t,pose('Pointing_Up'),pose('Thumb_Up'),presets,'T1','T1');expect(g.extraActions).toEqual([]);}
 });
 it('loss/unknown do not rearm dash; confirmed different pose does; fire remains independent',()=>{
  const g=new GestureBindings(),c=defaultBindings();c.bindings.shortDash={hand:'Left',pose:'Thumb_Up',activation:'Instant'};g.configure(c);g.sample(-20,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);g.sample(0,pose('Thumb_Up'),pose('Closed_Fist'),presets,null,null);g.sample(79,pose('Thumb_Up'),pose('Closed_Fist'),presets,null,null);expect(g.extraActions).toEqual([]);g.sample(80,pose('Thumb_Up'),pose('Closed_Fist'),presets,null,null);expect(g.extraActions).toEqual(['shortDash']);expect(g.fire).toBe(true);g.lose('Left');g.sample(100,undefined,pose('Closed_Fist'),presets,null,null);g.sample(180,pose('Thumb_Up'),pose('Closed_Fist'),presets,null,null);g.sample(280,pose('Thumb_Up'),pose('Closed_Fist'),presets,null,null);expect(g.extraActions).toEqual([]);
 });
 it('FAW earns Duration once, uncertainty pauses without credit, and Recall has priority',()=>{const g=new GestureBindings(),c=defaultBindings();c.bindings.fireAtWill={hand:'Right',pose:'Thumb_Up',activation:'Duration'};g.configure(c);g.sample(-20,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);for(let t=0;t<=300;t+=20)g.sample(t,pose('Open_Palm'),pose('Thumb_Up'),presets,null,null);g.sample(320,pose('Open_Palm'),pose('None'),presets,null,null);g.sample(400,pose('Open_Palm'),pose('Thumb_Up'),presets,null,null);for(let t=420;t<600;t+=20){g.sample(t,pose('Open_Palm'),pose('Thumb_Up'),presets,null,null);expect(g.extraActions).toEqual([]);}g.sample(600,pose('Open_Palm'),pose('Thumb_Up'),presets,null,null);expect(g.extraActions).toEqual(['fireAtWill']);g.sample(620,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);for(let t=640;t<=1140;t+=20){g.sample(t,pose('Victory'),pose('Thumb_Up'),presets,null,null);expect(g.extraActions).toEqual([]);}expect(g.consumed).toBe(true);});
 it('external cancellation resets extra hold and prevents a held pose restarting',()=>{const g=new GestureBindings(),c=defaultBindings();c.bindings.fireAtWill={hand:'Right',pose:'Thumb_Up',activation:'Duration'};g.configure(c);g.sample(-20,pose('Open_Palm'),pose('Open_Palm'),presets,null,null);for(let t=0;t<=300;t+=20)g.sample(t,pose('Open_Palm'),pose('Thumb_Up'),presets,null,null);g.cancel(300);for(let t=320;t<=1000;t+=20){g.sample(t,pose('Open_Palm'),pose('Thumb_Up'),presets,null,null);expect(g.extraActions).toEqual([]);}});
});
