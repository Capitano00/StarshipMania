import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Controls,type Observation} from '../src/controls';
import {GuidedCalibration} from '../src/guided-calibration';

// Model outputs are explicitly mocked: these test normalization, not anatomical recognition.
const points=(x:number)=>Array.from({length:21},(_,i)=>({x:x+i*.002,y:.4+i*.003,z:.123}));
async function infer(landmarks=[points(.7),points(.2)],labels=['Left','Right'],scores=[.98,.97]){
  const source=readFileSync(new URL('../public/tracking-worker.js',import.meta.url),'utf8');
  const model={recognizeForVideo:vi.fn(()=>({landmarks,gestures:landmarks.map(()=>[{categoryName:'Open_Palm',score:.91}]),handedness:labels.map((categoryName,i)=>[{categoryName,score:scores[i]}])}))};
  const self={postMessage:vi.fn(),onmessage:null as unknown as (e:{data:object})=>Promise<void>};
  const bitmap={width:640,height:480,close:vi.fn()};
  const context={translate:vi.fn(),scale:vi.fn(),drawImage:vi.fn()};
  const canvas=vi.fn();
  runInNewContext(source+'\nlandmarker=model;', {self,model,performance:{now:()=>100},OffscreenCanvas:class {constructor(){canvas();}getContext(){return context;}}});
  await self.onmessage({data:{type:'frame',bitmap,epoch:2,sequence:3,capturedAt:90}});
  return {result:self.postMessage.mock.calls[0][0] as Observation&{type:string;landmarks:{x:number;y:number}[][]},model,bitmap,canvas};
}
it('passes the original camera bitmap to Tasks without pre-inference pixel mirroring',async()=>{
  const f=await infer();expect(f.model.recognizeForVideo).toHaveBeenCalledExactlyOnceWith(f.bitmap,90);
  expect(f.canvas).not.toHaveBeenCalled();expect(f.bitmap.close).toHaveBeenCalledOnce();
});
it('reflects all overlay x coordinates exactly once, preserving y and removing depth',async()=>{
  const input=[points(.7),points(.2)],before=structuredClone(input),{result}=await infer(input);
  expect(result.landmarks).toEqual(input.map(hand=>hand.map(({x,y})=>({x:1-x,y}))));expect(input).toEqual(before);
  expect(result).not.toHaveProperty('bitmap');expect(result).toMatchObject({epoch:2,sequence:3,capturedAt:90,type:'observation'});
});
it('preserves Tasks labels and confidence, never assigning identity by position or array order',async()=>{
  const {result}=await infer([points(.2),points(.7)],['Right','Left'],[.97,.98]);
  expect(result.hands.map(({side,confidence})=>({side,confidence}))).toEqual([{side:'Right',confidence:.97},{side:'Left',confidence:.98}]);
  const crossed=await infer([points(.2),points(.7)]);expect(crossed.result.hands.map(h=>h.side)).toEqual(['Left','Right']);
  const c=new Controls();c.epoch=2;expect(c.ingest(crossed.result,100)).toBe(false);
});
it('reflects derived palms and passes per-hand category/score without gameplay pinch',async()=>{
  const input=[points(.7),points(.2)],{result}=await infer(input);
  input.forEach((p,i)=>{
    const palm=[0,5,9,13,17],h=result.hands[i],overlay=result.landmarks[i];
    expect(h.palm.x).toBeCloseTo(1-palm.reduce((sum,k)=>sum+p[k].x,0)/5,12);
    expect(h.palm.x).toBeCloseTo(palm.reduce((sum,k)=>sum+overlay[k].x,0)/5,12);
    expect(h.palm.y).toBeCloseTo(palm.reduce((sum,k)=>sum+p[k].y,0)/5,12);
    const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
    expect(h.gesture).toEqual({category:'Open_Palm',score:.91});expect(h).not.toHaveProperty('pinch');
    expect(distance(overlay[4],overlay[8])).toBeCloseTo(distance(p[4],p[8]),12);
    expect(Object.keys(h).sort()).toEqual(['confidence','gesture','palm','side']);
  });
});
it('normalized left/right detections satisfy the timed calibration-only paired request',async()=>{
  const openPoints=(x:number)=>{const p=points(x);p[4].y=.2;p[8].y=.6;return p;};
  const {result}=await infer([openPoints(.7),openPoints(.2)]),c=new Controls(),g=new GuidedCalibration();c.epoch=2;
  expect(c.ingest(result,100)).toBe(true);expect(g.start(100,c)).toBe(true);expect(g.update(100,c)).toBe(false);
  expect(c.calibrated).toBe(false);expect(c.neutral).toBeNull();
  expect(c.ingest({...result,capturedAt:3100,sequence:4},3100)).toBe(true);expect(g.update(3100,c)).toBe(true);expect(c.calibrated).toBe(true);expect(c.paused).toBe(true);expect(c.inputArmed).toBe(false);
});
it('does not promote low confidence or empty model observations to accepted tracking',async()=>{
  const low=await infer(undefined,undefined,[.5,.97]),c=new Controls(),g=new GuidedCalibration();c.epoch=2;
  expect(low.result.hands[0].confidence).toBe(.5);expect(c.ingest(low.result,100)).toBe(false);
  g.start(100,c);c.ingest({...low.result,capturedAt:3100,sequence:4},3100);expect(g.update(3100,c)).toBe(false);expect(c.calibrated).toBe(false);
  const empty=await infer([],[],[]);expect(empty.result.hands).toEqual([]);expect(empty.result.landmarks).toEqual([]);
});
