import {describe,it,expect} from 'vitest';
import {Controls,type Observation} from '../src/controls';
import {neutralFrame} from '../src/contracts';
const sample=(c:Controls,t:number,left='Open_Palm',right='Open_Palm'):Observation=>({epoch:c.epoch,sequence:t,capturedAt:t,processingMs:8,hands:[{side:'Left',palm:{x:.3,y:.5},gesture:{category:left,score:1},confidence:.99},{side:'Right',palm:{x:.7,y:.5},gesture:{category:right,score:1},confidence:.99}]});
function ready(){const c=new Controls();c.ingest(sample(c,0),0);expect(c.calibrate(0)).toBe(true);expect(c.resume(0)).toBe(true);return c;}
const feed=(c:Controls,t:number,l='Open_Palm',r='Open_Palm',target:'T1'|'T2'|null='T1')=>{c.ingest(sample(c,t,l,r),t);return c.update(t,target);};
describe('render expiry retains identity only for continuous fresh captures',()=>{
 it('stops between samples and recovers steering at 125 ms cadence with 135 ms delivery delay',()=>{
  const c=ready();
  for(const capturedAt of [125,250,375,500]){
   const expiredAt=capturedAt-125+201;
   expect(c.update(expiredAt,null)).toEqual({frame:neutralFrame(),commit:null});
   expect(c.latest).toBeNull();
   expect(c.pointer(expiredAt-2)).toEqual({x:0,y:0});
   const next=sample(c,capturedAt);
   next.hands[0].palm.x+=.06;next.hands[1].palm.y-=.04;
   const receivedAt=capturedAt+135;
   expect(c.ingest(next,receivedAt)).toBe(true);
   expect(c.handReady('Left',receivedAt)&&c.handReady('Right',receivedAt)).toBe(true);
   const {frame}=c.update(receivedAt,null);
   expect(frame.move.x).toBeGreaterThan(.5);expect(frame.aim.y).toBeCloseTo(.4);
   expect(c.update(capturedAt+200,null).frame).toEqual(frame);
  }
 });
 it('revokes fire and pending deploy until fresh render and samples reconfirm them',()=>{
  const c=ready();
  feed(c,20,'Pointing_Up','Closed_Fist');c.markRendered('T1',20);
  expect(feed(c,100,'Pointing_Up','Closed_Fist').frame.fire).toBe(true);
  feed(c,140,'Pointing_Up','Closed_Fist');expect(c.commandProgress).toBe(40);

  expect(c.update(341,'T1')).toEqual({frame:neutralFrame(),commit:null});
  expect(c.latest).toBeNull();
  expect(c.preview).toBeNull();expect(c.visibleTarget).toBeNull();expect(c.visibleSince).toBe(0);
  expect(c.bindings.pending).toBeNull();expect(c.commandProgress).toBe(0);
  expect(c.bindings.fire).toBe(false);expect(c.bindings.padisarahFire).toBe(false);
  expect(c.commandReadiness(341).deploy.state).toBe('Waiting for hand');

  c.ingest(sample(c,265,'Pointing_Up','Closed_Fist'),400);
  expect(c.handReady('Left',400)&&c.handReady('Right',400)).toBe(true);
  expect(c.update(400,'T1')).toMatchObject({frame:{fire:false},commit:null});
  expect(c.preview).toBe('T1');expect(c.visibleTarget).toBeNull();
  c.markRendered('T1',400);
  c.ingest(sample(c,390,'Pointing_Up','Closed_Fist'),450);
  expect(c.update(450,'T1')).toMatchObject({frame:{fire:true},commit:null});
  expect(c.commandProgress).toBe(0);
  expect(feed(c,470,'Pointing_Up','Closed_Fist').commit).toBeNull();
  expect(c.commandProgress).toBe(80);
 });
 it('does not rearm a completed gesture when identity continues after expiry',()=>{
  const c=ready();
  feed(c,20,'Pointing_Up');c.markRendered('T1',20);
  for(const t of [100,225,350,475])expect(feed(c,t,'Pointing_Up').commit).toBeNull();
  expect(feed(c,600,'Pointing_Up').commit).toBe('T1');
  c.acknowledgeCommand(true);
  expect(c.update(801,'T1').frame).toEqual(neutralFrame());
  c.ingest(sample(c,725,'Pointing_Up'),860);
  expect(c.update(860,'T1').commit).toBeNull();
  expect(c.commandReadiness(860).deploy.state).toBe('Issued');
  for(const t of [850,975,1100,1225,1350]){
   const now=t+135;
   c.ingest(sample(c,t,'Pointing_Up'),now);
   expect(c.update(now,'T1').commit).toBeNull();
   expect(c.commandReadiness(now).deploy.state).toBe('Issued');
  }
 });
 it('reconfirms identity after a capture gap greater than 200 ms',()=>{
  const c=ready();feed(c,125);c.update(326,null);
  expect(c.ingest(sample(c,326),461)).toBe(true);
  expect(c.handReady('Left',461)||c.handReady('Right',461)).toBe(false);
  expect(c.update(461,null).frame).toEqual({...neutralFrame(),padisarahFire:false});
  expect(c.ingest(sample(c,406),541)).toBe(true);
  expect(c.handReady('Left',541)&&c.handReady('Right',541)).toBe(true);
 });
 it.each(['stale on arrival','invalid capture time','missing hand','duplicate identity','crossed pair','position jump'])('reconfirms after %s during an expired render window',kind=>{
  const c=ready();feed(c,125);c.update(326,null);
  const invalid=sample(c,250);
  if(kind==='invalid capture time')invalid.capturedAt=NaN;
  if(kind==='missing hand')invalid.hands.pop();
  if(kind==='duplicate identity')invalid.hands.push(invalid.hands[1]);
  if(kind==='crossed pair')invalid.hands[1].palm.x=.28;
  if(kind==='position jump')invalid.hands[1].palm.y=.74;
  const leftStillTracked=['missing hand','duplicate identity','position jump'].includes(kind);
  expect(c.ingest(invalid,kind==='stale on arrival'?451:385)).toBe(leftStillTracked);
  expect(c.ingest(sample(c,375),510)).toBe(true);
  expect(c.handReady('Left',510)).toBe(leftStillTracked);
  expect(c.handReady('Right',510)).toBe(false);
  expect(c.ingest(sample(c,455),590)).toBe(true);
  expect(c.handReady('Right',590)).toBe(true);
 });
 it('ignores previous epochs and non-increasing sequences; a new epoch resets identity',()=>{
  const c=ready();feed(c,125);c.update(326,null);
  const next=sample(c,250);
  expect(c.ingest({...next,epoch:c.epoch-1},385)).toBe(false);
  expect(c.ingest({...next,sequence:125},385)).toBe(false);
  expect(c.ingest(next,385)).toBe(true);
  expect(c.handReady('Right',385)).toBe(true);
  c.pause();
  expect(c.ingest({...next,sequence:375,capturedAt:375},510)).toBe(false);
  expect(c.ingest(sample(c,375),510)).toBe(true);
  expect(c.handReady('Right',510)).toBe(false);
 });
});
describe('v043 correction2 Recall channel isolation through production Controls',()=>{
 it('R during Left Thumb Up dash confirmation preserves completion at80ms and never repeats while held',()=>{
  const c=new Controls(),config=c.configuration;config.bindings.shortDash={hand:'Left',pose:'Thumb_Up',activation:'Instant'};config.bindings.fireAtWill={hand:'Right',pose:'Thumb_Down',activation:'Duration'};
  expect(c.setBindings(config)).toBe(true);c.ingest(sample(c,0),0);expect(c.calibrate(0)&&c.resume(0)).toBe(true);
  expect(feed(c,20,'Thumb_Up','Open_Palm',null).actions).toBeUndefined();expect(c.bindings.pending).toBeNull();c.recall(60);c.bindings.manualOverride();
  expect(feed(c,99,'Thumb_Up','Open_Palm',null).actions).toBeUndefined();expect(feed(c,100,'Thumb_Up','Open_Palm',null).actions).toEqual(['shortDash']);
  for(let t=120;t<=1000;t+=20)expect(feed(c,t,'Thumb_Up','Open_Palm',null).actions).toBeUndefined();
 });
 it('Recall still consumes a real pending Deploy and accepted override prevents held FAW from starting later',()=>{
  const c=new Controls(),config=c.configuration;config.bindings.fireAtWill={hand:'Right',pose:'Thumb_Up',activation:'Duration'};expect(c.setBindings(config)).toBe(true);c.ingest(sample(c,0),0);expect(c.calibrate(0)&&c.resume(0)).toBe(true);
  feed(c,20,'Pointing_Up','Thumb_Up');c.markRendered('T1',21);feed(c,40,'Pointing_Up','Thumb_Up');expect(c.bindings.pending?.type).toBe('INTERCEPT');c.recall(60);c.bindings.manualOverride();expect(c.bindings.pending).toBeNull();
  for(let t=80;t<=1200;t+=20){const out=feed(c,t,'Pointing_Up','Thumb_Up');expect(out.commit).toBeNull();expect(out.actions).toBeUndefined();}expect(c.commandReadiness(1200).deploy.state).toBe('Change pose to rearm');
 });
});
describe('fresh accepted classified observations; no physical camera evidence',()=>{
 it('moving open hands recenter immediately without old-neutral or steady locks; captured frame is zero',()=>{
  const c=ready();c.pause();const s=sample(c,100);s.hands.forEach(h=>h.palm.y=.63);c.ingest(s,100);expect(c.ready(100)).toBe(true);expect(c.resume(100)).toBe(true);
  expect(c.update(100,'T1')).toEqual({commit:null,frame:{move:{x:0,y:0},aim:{x:0,y:0},fire:false,padisarahFire:false}});expect(c.neutral!.left.y).toBe(.63);
  const next=sample(c,120,'Open_Palm','Closed_Fist');next.hands.forEach(h=>h.palm.y=.63);c.ingest(next,120);expect(c.update(120,null).frame.fire).toBe(false);
  c.ingest({...next,sequence:200,capturedAt:200},200);expect(c.update(200,null).frame.fire).toBe(true);
 });
 it.each(['closed','unknown','missing','stale','ambiguous','crossed','jump','obsolete'])('rejects %s recenter sample without changing neutral',kind=>{
  const c=ready();c.pause();const before=structuredClone(c.neutral),s=sample(c,1000);
  if(kind==='closed')s.hands[1].gesture!.category='Closed_Fist';if(kind==='unknown')s.hands[1].gesture!.category='None';if(kind==='missing')s.hands.pop();if(kind==='stale')s.capturedAt=799;if(kind==='ambiguous')s.hands[1].confidence=.74;if(kind==='crossed')s.hands[0].palm.x=.7;
  if(kind==='jump'){c.ingest(sample(c,980),980);s.hands[0].palm.y=.8;}if(kind==='obsolete')s.epoch--;
  c.ingest(s,1000);expect(c.calibrate(1000)).toBe(false);expect(c.resume(1000)).toBe(false);expect(c.neutral).toEqual(before);expect(c.update(1000,null).frame.fire).toBe(false);
 });
 it('moving palms can fire and deploy concurrently at 500 ms, without release or duplicate commands',()=>{
  const c=ready(),actions=[];let moved=false,fired=false;
  for(let t=20;t<=3400;t+=20){const s=sample(c,t,'Pointing_Up','Closed_Fist');s.hands[0].palm.x+=Math.sin(t/150)*.04;s.hands[1].palm.y+=Math.sin(t/180)*.03;c.ingest(s,t);const out=c.update(t,'T1');c.markRendered(c.preview,t);if(out.commit)actions.push(t);moved ||=Math.abs(out.frame.move.x)>.1;fired ||=out.frame.fire;}
  expect(actions).toEqual([540]);expect(moved&&fired).toBe(true);
 });
 it('render-only frames cannot accrue hold and target changes cancel without a new tracking sample',()=>{
  const c=ready();feed(c,20,'Pointing_Up');c.markRendered('T1',20);feed(c,40,'Pointing_Up');for(let t=41;t<=200;t++)expect(c.update(t,'T1').commit).toBeNull();expect(c.commandProgress).toBe(0);c.update(200,'T2');expect(c.preview).toBeNull();
 });
 it('unknown tracked gesture stops only its affected action, not palm movement or tracking',()=>{
  const c=ready();feed(c,20,'Pointing_Up','Closed_Fist');c.markRendered('T1',20);expect(feed(c,100,'Pointing_Up','Closed_Fist').frame.fire).toBe(true);
  const s=sample(c,120,'Pointing_Up','None');s.hands[0].palm.x=.4;c.ingest(s,120);const out=c.update(120,'T1');expect(out.frame.fire).toBe(false);expect(out.frame.move.x).toBeGreaterThan(.9);expect(c.needsRearm||c.paused).toBe(false);expect(c.latest).not.toBeNull();
 });
 it('keyboard recall cancels pending units without deadlocking or interrupting movement/fire',()=>{
  const c=ready();feed(c,20,'Pointing_Up','Closed_Fist');c.markRendered('T1',20);expect(feed(c,100,'Pointing_Up','Closed_Fist').frame.fire).toBe(true);c.recall(110);
  expect(c.update(110,'T1').frame.fire).toBe(true);expect(c.inputArmed).toBe(true);expect(c.preview).toBeNull();
  for(let t=120;t<=1900;t+=20)expect(feed(c,t,'Pointing_Up','Closed_Fist').commit).toBeNull();expect(c.paused).toBe(false);expect(feed(c,1920).frame.fire).toBe(false);expect(c.inputArmed).toBe(true);
 });
 it('hand recall arbitration is independent from held pilot fire on repeated renders',()=>{
  const c=ready();let emitted=false;for(let t=20;t<=1520;t+=20){const out=feed(c,t,'Victory','Closed_Fist',null);if(out.recall){emitted=true;expect(out.frame.fire).toBe(true);expect(c.update(t+1,null).frame.fire).toBe(true);}}
  expect(emitted).toBe(true);
 });
 it('ordinary loss stops manual fire without pausing, and fresh identity recovers without recenter',()=>{
  const c=ready(),neutral=structuredClone(c.neutral);feed(c,20,'Open_Palm','Closed_Fist');feed(c,100,'Open_Palm','Closed_Fist');const s=sample(c,120);s.hands=[];c.ingest(s,120);expect(c.update(120,null).frame.fire).toBe(false);expect(c.needsRearm||c.paused).toBe(false);
  feed(c,140);expect(c.handReady('Right',140)).toBe(false);feed(c,220);expect(c.handReady('Right',220)).toBe(true);expect(c.resume(220)).toBe(false);feed(c,240,'Open_Palm','Closed_Fist');expect(feed(c,320,'Open_Palm','Closed_Fist').frame.fire).toBe(true);expect(c.neutral).toEqual(neutral);
 });
 it('stale and old epochs never fire; prolonged ordinary loss does not pause combat',()=>{
  const c=ready();feed(c,20,'Open_Palm','Closed_Fist');feed(c,100,'Open_Palm','Closed_Fist');const old=sample(c,120,'Pointing_Up','Closed_Fist');expect(c.update(301,null).frame.fire).toBe(false);c.update(802,null);expect(c.paused).toBe(false);expect(c.trackingPauses).toBe(0);expect(c.ingest(old,802)).toBe(false);c.pause();expect(c.ingest({...old,capturedAt:803},803)).toBe(false);
 });
 it('paused recognition presets are independent from each other and existing sensitivity',()=>{
  const c=ready();expect(c.setRecognition('Left','Forgiving')).toBe(false);expect(c.setSensitivity(2,.5)).toBe(false);c.pause();expect(c.setRecognition('Left','Forgiving')).toBe(true);expect(c.setRecognition('Right','Strict')).toBe(true);expect(c.setSensitivity(2,.5)).toBe(true);
  const s=sample(c,100);s.hands[0].gesture!.score=.55;s.hands[1].gesture!.score=.79;c.ingest(s,100);expect(c.ready(100)).toBe(false);s.sequence=120;s.capturedAt=120;s.hands[1].gesture!.score=.8;c.ingest(s,120);expect(c.resume(120)).toBe(true);expect(c.sensitivity).toEqual({move:2,aim:.5});expect(c.recognition).toEqual({Left:'Forgiving',Right:'Strict'});
 });
 it('preserves move/aim gains, deadzone, final clamps, paused Reset and source-bound neutral',()=>{
  const c=ready();c.pause();expect(c.setSensitivity(9,-2)).toBe(true);expect(c.sensitivity).toEqual({move:2,aim:.5});expect(c.setSensitivity(NaN,1)).toBe(false);c.setSensitivity(.5,2);feed(c,100);c.resume(100);
  const s=sample(c,120);s.hands[0].palm.x+=.056;s.hands[1].palm.x+=.03;s.hands[1].palm.y-=.025;c.ingest(s,120);const out=c.update(120,null);expect(out.frame.move.x).toBeCloseTo(.25);expect(out.frame.aim).toEqual(c.pointer(120));expect(out.frame.aim.x).toBeCloseTo(.5);expect(out.frame.aim.y).toBeCloseTo(.5);
  c.pause();c.setSensitivity(1,1);expect(c.sensitivity).toEqual({move:1,aim:1});const next=new Controls();expect(next.neutral).toBeNull();expect(next.calibrated).toBe(false);
 });
});
