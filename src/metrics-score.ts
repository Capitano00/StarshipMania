/** Performance score for one benchmark run in metrics/performance.json. Pure, so the metrics page and tests share it. */
export interface PerformanceRun {
  id?:string;date:string;label:string;environment:string;
  load:{ttfbMs:number;domContentLoadedMs:number;loadMs:number;initialTransferKB:number;initialJsGzipKB:number};
  scenarios:{name:string;seconds:number;fps:number;p50Ms:number;p99Ms:number;maxMs:number;slowFrames:number;longTasks:number}[];
  longAnimationFrames:{when:string;ms:number}[];
  heap:{startMB:number;peakMB:number;settledMB:number|null};
}
export interface ScoreCategory {id:string;label:string;points:number;max:number;basis:string}

/** 1 at `best` or better, 0 at `worst` or beyond, straight line in between. Works whichever way round "better" is. */
export const linear=(value:number,best:number,worst:number)=>Math.max(0,Math.min(1,(value-worst)/(best-worst)));
const round1=(value:number)=>Math.round(value*10)/10;
const plural=(count:number,noun:string)=>`${count} ${noun}${count===1?'':'s'}`;

// Thresholds: tune these to change how strict the score is.
export const thresholds={
  fps:{best:60,worst:30},              // worst scenario's average frame rate
  slowFramePenalty:4,                  // per frame over 33 ms during play
  longFramePenalty:2,                  // per long animation frame (over 50 ms), such as a screen change
  heapPeakMB:{best:50,worst:200},
  leakPenalty:5,                       // heap settles more than 50% (+2 MB) above where it started
  loadMs:{best:100,worst:1000},
  initialJsGzipKB:{best:50,worst:250},
};

export function scorePerformance(run:PerformanceRun):{total:number;max:number;categories:ScoreCategory[]}{
  const t=thresholds;
  const worstFps=Math.min(...run.scenarios.map(s=>s.fps));
  const slowFrames=run.scenarios.reduce((sum,s)=>sum+s.slowFrames,0);
  const {startMB,peakMB,settledMB}=run.heap;
  const leak=settledMB!==null&&settledMB>startMB*1.5+2;
  const categories:ScoreCategory[]=[
    {id:'frames',label:'Frame rate',max:30,points:30*linear(worstFps,t.fps.best,t.fps.worst),basis:`${worstFps} fps in the slowest scenario`},
    {id:'smoothness',label:'Smoothness',max:20,points:Math.max(0,20-t.slowFramePenalty*slowFrames-t.longFramePenalty*run.longAnimationFrames.length),basis:`${plural(slowFrames,'slow frame')} in play · ${plural(run.longAnimationFrames.length,'long animation frame')}`},
    {id:'memory',label:'Memory',max:15,points:Math.max(0,15*linear(peakMB,t.heapPeakMB.best,t.heapPeakMB.worst)-(leak?t.leakPenalty:0)),basis:`${peakMB} MB peak heap${settledMB===null?'':leak?' · did not settle back (possible leak)':' · settles back after combat'}`},
    {id:'load',label:'Load speed',max:20,points:20*linear(run.load.loadMs,t.loadMs.best,t.loadMs.worst),basis:`page load event at ${run.load.loadMs} ms`},
    {id:'bundle',label:'First-load size',max:15,points:15*linear(run.load.initialJsGzipKB,t.initialJsGzipKB.best,t.initialJsGzipKB.worst),basis:`${run.load.initialJsGzipKB} kB of compressed JS before first paint`},
  ].map(category=>({...category,points:round1(category.points)}));
  return {total:Math.round(categories.reduce((sum,c)=>sum+c.points,0)),max:100,categories};
}
