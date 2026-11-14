import {describe,expect,it,vi} from 'vitest';
import {Controls,type Hand,type Observation} from '../src/controls';
import {GuidedCalibration} from '../src/guided-calibration';
const hand=(side:Hand['side']):Hand=>({side,palm:{x:side==='Left'?.3:.7,y:.5},gesture:{category:'Open_Palm',score:1},confidence:1});
const sample=(c:Controls,now:number,hands=[hand('Left'),hand('Right')]):Observation=>({epoch:c.epoch,sequence:now,capturedAt:now,hands,processingMs:0});
function fixture(){const c=new Controls(),g=new GuidedCalibration();expect(g.start(0,c)).toBe(true);return {c,g};}
function feed(c:Controls,g:GuidedCalibration,t:number,hands?:Hand[]){c.ingest(sample(c,t,hands),t);return g.update(t,c);}

describe('one deliberate paired check shares readiness and captures only while paused',()=>{
 it('needs no single-hand clicks; moving open palms capture exactly once with zero input',()=>{
  const {c,g}=fixture(),capture=vi.spyOn(c,'calibrate');
  expect(feed(c,g,2980)).toBe(false);expect(g.message(2980,c,'camera')).toContain('in 1');
  const hands=[hand('Left'),hand('Right')];hands.forEach(h=>h.palm.y=.6);
  expect(feed(c,g,3000,hands)).toBe(true);expect(c.neutral).toEqual({left:hands[0].palm,right:hands[1].palm});
  expect(c.calibrated).toBe(true);expect(c.paused).toBe(true);expect(c.inputArmed).toBe(false);expect(g.pending).toBe(false);
  expect(c.update(3000,'T1')).toEqual({commit:null,frame:{move:{x:0,y:0},aim:{x:0,y:0},fire:false}});
  feed(c,g,3020);expect(capture).toHaveBeenCalledTimes(1);expect(g.message(3020,c,'camera')).toContain('Choose Test controls');
 });
 it('cannot capture without a request or reuse a pre-countdown frame',()=>{
  const c=new Controls(),g=new GuidedCalibration();expect(feed(c,g,0)).toBe(false);expect(c.calibrated).toBe(false);
  g.start(0,c);c.ingest(sample(c,2999),2999);expect(g.update(3000,c)).toBe(false);expect(feed(c,g,3001)).toBe(true);
 });
 it.each(['missing','single','unknown','duplicate','low identity','low pose','closed','crossed','jump','stale','future','old epoch','out of order'])( '%s cannot complete the paired check',kind=>{
  const {c,g}=fixture();c.ingest(sample(c,2900),2900);const s=sample(c,3000);
  if(kind==='missing')s.hands=[];if(kind==='single')s.hands.pop();if(kind==='unknown')s.hands[0].side='Unknown' as Hand['side'];
  if(kind==='duplicate')s.hands[1].side='Left';if(kind==='low identity')s.hands[0].confidence=.749;
  if(kind==='low pose')s.hands[0].gesture!.score=.64;if(kind==='closed')s.hands[0].gesture!.category='Closed_Fist';
  if(kind==='crossed')s.hands[0].palm.x=.65;if(kind==='jump')s.hands[0].palm.y=.8;
  if(kind==='stale')s.capturedAt=2799;if(kind==='future')s.capturedAt=3001;if(kind==='old epoch')s.epoch--;
  if(kind==='out of order')s.sequence=2899;c.ingest(s,3000);expect(g.update(3000,c)).toBe(false);expect(c.calibrated).toBe(false);expect(c.paused).toBe(true);
 });
 it.each([['Forgiving',.6,true],['Balanced',.6,false],['Strict',.7,false],['Strict',.8,true]] as const)('uses %s preset score %s without changing identity threshold', (preset,score,accepted)=>{
  const c=new Controls(),g=new GuidedCalibration();c.setRecognition('Left',preset);g.start(0,c);const s=sample(c,3000);s.hands[0].gesture!.score=score;c.ingest(s,3000);expect(g.update(3000,c)).toBe(accepted);
  const low=new Controls(),request=new GuidedCalibration();low.setRecognition('Left',preset);request.start(0,low);const x=sample(low,3000);x.hands[0].confidence=.74;low.ingest(x,3000);expect(request.update(3000,low)).toBe(false);
 });
 it('waits through bad tracking and new epochs without extending the deadline',()=>{
  const {c,g}=fixture();feed(c,g,2800);feed(c,g,3000,[]);expect(g.pending).toBe(true);expect(g.message(3000,c,'camera')).toContain('10 s left');
  expect(g.start(12000,c)).toBe(false);const old=sample(c,12900);c.invalidate('tracking reset',true);c.ingest(old,12900);expect(g.update(12900,c)).toBe(false);
  expect(feed(c,g,12999)).toBe(true);expect(c.paused).toBe(true);
 });
 it('expiry wins at 13 seconds, explains blocker, and requires deliberate full Retry',()=>{
  const {c,g}=fixture();feed(c,g,3000,[]);expect(g.update(13000,c)).toBe(false);expect(g.result).toContain('expired');expect(g.result).toContain('Both hands');expect(g.result).toContain('Retry hand check');
  expect(feed(c,g,13020)).toBe(false);expect(c.calibrated).toBe(false);expect(g.start(14000,c)).toBe(true);expect(feed(c,g,16999)).toBe(false);expect(feed(c,g,17000)).toBe(true);
  const other=fixture();expect(feed(other.c,other.g,13000)).toBe(false);expect(other.c.calibrated).toBe(false);
 });
 it.each(['cancel','reset'] as const)('%s removes deferred capture; later fresh hands cannot complete it',method=>{
  const {c,g}=fixture();g[method]();expect(feed(c,g,3000)).toBe(false);expect(c.calibrated).toBe(false);expect(g.pending).toBe(false);
  expect(g.start(4000,c)).toBe(true);expect(feed(c,g,7000)).toBe(true);
 });
 it('refuses running requests and cancels a request if controls are externally resumed',()=>{
  const {c,g}=fixture();c.paused=false;expect(g.update(3000,c)).toBe(false);expect(g.pending).toBe(false);expect(g.start(4000,c)).toBe(false);
 });
});
