import {expect,it} from 'vitest';
import {Controls,type Observation} from '../src/controls';
import {ResumeIntent} from '../src/resume-intent';
const sample=(c:Controls,t:number,pinch=1):Observation=>({epoch:c.epoch,sequence:t,capturedAt:t,processingMs:0,hands:[{side:'Left',palm:{x:.3,y:.5},gesture:{category:pinch===1?'Open_Palm':'Closed_Fist',score:1},confidence:1},{side:'Right',palm:{x:.7,y:.5},gesture:{category:pinch===1?'Open_Palm':'Closed_Fist',score:1},confidence:1}]});
function fixture(){const c=new Controls();c.ingest(sample(c,0),0);c.ingest(sample(c,400),400);c.calibrate(400);c.pause();return {c,r:new ResumeIntent()};}
it('cannot resume before three seconds, consumes once and cannot resume after an immediate pause',()=>{
  const {c,r}=fixture();r.start(500);for(let t=500;t<3500;t+=20){c.ingest(sample(c,t),t);expect(r.update(t,c)).toBe(false);}
  c.ingest(sample(c,3500),3500);expect(r.update(3500,c)).toBe(true);expect(r.pending).toBe(false);c.pause();
  for(let t=3520;t<5000;t+=20){c.ingest(sample(c,t),t);expect(r.update(t,c)).toBe(false);}expect(c.paused).toBe(true);
});
it('duplicate requests cannot extend the countdown or ten-second readiness deadline',()=>{
  const {c,r}=fixture();r.start(500);expect(r.start(3000)).toBe(false);expect(r.message(3499)).toContain('Starting in 1');expect(r.message(3500)).toContain('10 s left');
  expect(r.update(13499,c)).toBe(false);expect(r.pending).toBe(true);r.update(13500,c);expect(r.pending).toBe(false);expect(r.result).toContain('expired');expect(r.result).toContain('Recalibrate neutral');
  for(let t=14000;t<=14500;t+=20)c.ingest(sample(c,t),t);expect(r.update(14500,c)).toBe(false);expect(c.paused).toBe(true);
  expect(r.start(14500)).toBe(true);
});
it('expiry wins even when the first ready frame arrives exactly at the deadline',()=>{
  const {c,r}=fixture();r.start(500);c.ingest(sample(c,13000),13000);c.ingest(sample(c,13500),13500);
  expect(c.ready(13500)).toBe(true);expect(r.update(13500,c)).toBe(false);expect(c.paused).toBe(true);
});
it('missing hands and epoch changes retain intent but obsolete samples cannot satisfy readiness',()=>{
  const {c,r}=fixture();r.start(500);c.ingest(sample(c,3000),3000);const old=sample(c,3500);c.invalidate('tracking discontinuity',true);
  expect(c.ingest(old,3500)).toBe(false);expect(r.update(3500,c)).toBe(false);expect(r.pending).toBe(true);
  c.ingest(sample(c,3520),3520);expect(r.update(3520,c)).toBe(true);expect(c.update(3520,null).frame.fire).toBe(false);
});
it('stale and pinched pairs wait; the next moving open pair recenters immediately',()=>{
  const {c,r}=fixture();r.start(500);c.ingest(sample(c,3000),3000);expect(r.update(3500,c)).toBe(false);
  for(let t=3500;t<4500;t+=20){c.ingest(sample(c,t,.2),t);expect(r.update(t,c)).toBe(false);}
  const s=sample(c,4500);s.hands.forEach(h=>h.palm.y=.6);expect(c.ingest(s,4500)).toBe(true);expect(r.update(4500,c)).toBe(true);
  expect(c.update(4500,'T1')).toEqual({commit:null,frame:{move:{x:0,y:0},aim:{x:0,y:0},fire:false}});
  const next=sample(c,4520);next.hands.forEach(h=>h.palm.y=.6);next.hands[1].gesture={category:'Closed_Fist',score:1};c.ingest(next,4520);expect(c.update(4520,null).frame.fire).toBe(false);const confirmed={...next,sequence:4600,capturedAt:4600};c.ingest(confirmed,4600);expect(c.update(4600,null).frame.fire).toBe(true);
});
it('cancel and unrequested readiness cannot become automatic recovery',()=>{
  const {c,r}=fixture();c.ingest(sample(c,500),500);c.ingest(sample(c,900),900);expect(r.update(900,c)).toBe(false);
  r.start(1000);r.cancel();expect(r.update(4000,c)).toBe(false);expect(c.paused).toBe(true);expect(r.start(4000)).toBe(true);
});
it('calibrate-only completion shares timing but cannot arm controls or consume a pre-countdown observation',()=>{
  const c=new Controls(),r=new ResumeIntent('calibrate');r.start(0);c.ingest(sample(c,2999),2999);expect(r.update(3000,c)).toBe(false);
  c.ingest(sample(c,3000),3000);expect(r.update(3000,c)).toBe(true);expect(c.calibrated).toBe(true);expect(c.paused).toBe(true);expect(c.inputArmed).toBe(false);expect(c.update(3000,null).frame.fire).toBe(false);
  expect(r.update(3020,c)).toBe(false);r.reset();expect(r.result).toBe('');expect(r.pending).toBe(false);
});
