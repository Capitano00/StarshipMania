import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {linear,scorePerformance,thresholds,type PerformanceRun} from '../src/metrics-score';
import {compare,progress,verdict,type Comparison,type Snapshot} from '../src/metrics-compare';
import config from '../vite.config';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const runs:PerformanceRun[]=JSON.parse(read('metrics/performance.json')).runs;
const perfect:PerformanceRun={date:'2026-11-14',label:'ideal',environment:'test',load:{ttfbMs:5,domContentLoadedMs:20,loadMs:50,initialTransferKB:20,initialJsGzipKB:30},scenarios:[{name:'Combat',seconds:10,fps:60,p50Ms:16.7,p99Ms:17,maxMs:17,slowFrames:0,longTasks:0}],longAnimationFrames:[],heap:{startMB:5,peakMB:8,settledMB:6}};

describe('performance score',()=>{
  it('interpolates between the best and worst thresholds in either direction',()=>{
    expect(linear(60,60,30)).toBe(1);expect(linear(45,60,30)).toBe(.5);expect(linear(10,60,30)).toBe(0);
    expect(linear(100,100,1000)).toBe(1);expect(linear(550,100,1000)).toBe(.5);expect(linear(5000,100,1000)).toBe(0);
  });
  it('gives a clean run full marks and its categories add up to 100',()=>{
    const score=scorePerformance(perfect);
    expect(score.total).toBe(100);expect(score.categories.reduce((sum,c)=>sum+c.max,0)).toBe(100);
  });
  it('penalises dropped frames, long frames and a heap that never settles',()=>{
    const janky=scorePerformance({...perfect,scenarios:[{...perfect.scenarios[0],fps:45,slowFrames:2}],longAnimationFrames:[{when:'entry',ms:90}],heap:{startMB:5,peakMB:30,settledMB:30}});
    const points=Object.fromEntries(janky.categories.map(c=>[c.id,c.points]));
    expect(points.frames).toBe(15);
    expect(points.smoothness).toBe(20-2*thresholds.slowFramePenalty-thresholds.longFramePenalty);
    expect(points.memory).toBe(15-thresholds.leakPenalty);
  });
  it('scores the recorded benchmark runs and shows lazy-loading Three.js improved the score',()=>{
    const [before,after]=runs.map(run=>scorePerformance(run).total);
    expect(before).toBe(85);expect(after).toBe(98);
  });
});

describe('before/after comparisons',()=>{
  const {comparisons}=JSON.parse(read('metrics/comparisons.json')) as {comparisons:Comparison[]};
  it('judges each change by its direction and treats "n/a" before values as new capabilities',()=>{
    expect(verdict(500,320,'lower')).toBe('better');expect(verdict(90,70,'higher')).toBe('worse');expect(verdict(60,60,'higher')).toBe('same');
    expect(verdict(2000,2100,null)).toBe('neutral');expect(verdict('n/a',85,'higher')).toBe('new');
    expect(verdict(9.6,9.7,'lower',1)).toBe('same');expect(verdict(9.6,11,'lower',1)).toBe('worse');expect(verdict(2000,2000,null)).toBe('same');
    expect(verdict(500,null,'lower')).toBe('pending');expect(verdict(null,320,'lower')).toBe('pending');expect(verdict('n/a',null,'higher')).toBe('pending');
  });
  it('shows the lazy-loading change as measured and better',()=>{
    const rows=compare(comparisons.find(c=>c.id==='lazy-three')!,[],runs);
    const byName=Object.fromEntries(rows.map(r=>[r.name,r]));
    expect(byName['Performance score']).toMatchObject({before:85,after:98,delta:13,verdict:'better'});
    expect(byName['Page load']).toMatchObject({before:175,after:43,verdict:'better'});
    expect(rows.some(r=>r.source==='snapshot')).toBe(false);
  });
  it('keeps the voice comparison pending until its "after" results exist',()=>{
    const snapshot:Snapshot={id:'before-integrations',label:'before',capturedAt:'',version:'0.4.3',build:{ok:true,seconds:3},bundle:{firstLoadGzipBytes:39000,laterGzipBytes:133000},tests:{passed:251,failed:71,newFailures:0,todo:5},code:{appLines:2000,testLines:1300}};
    for(const id of ['voice-agent']){
      const rows=compare(comparisons.find(c=>c.id===id)!,[snapshot],runs);
      expect(rows.length).toBeGreaterThan(0);expect(progress(rows).measured).toBe(0);
      expect(rows.find(r=>r.name==='Tests passing')).toMatchObject({before:251,after:null,verdict:'pending'});
    }
  });
  it('references only snapshots and benchmark runs that exist or are still to come',()=>{
    const runIds=new Set(runs.map(r=>r.id));
    for(const c of comparisons)for(const side of [c.before,c.after]){
      if(side.performanceRun)expect(runIds.has(side.performanceRun)).toBe(true);
      if(side.snapshot)expect(()=>read(`metrics/snapshots/${side.snapshot}.json`)).not.toThrow();
    }
  });
});

describe('metrics page wiring',()=>{
  it('builds metrics.html as a second page and links to it from the game header',()=>{
    expect(config.build?.rollupOptions?.input).toEqual({main:'index.html',metrics:'metrics.html'});
    expect(read('src/main.ts')).toContain('<a class="metrics-link" href="/metrics.html" target="_blank" rel="noopener">Metrics ↗</a>');
    expect(read('metrics.html')).toContain('<script type="module" src="/src/metrics-page.ts"></script>');
  });
  it('reads a static file only: no storage, recording, transmission or remote URLs',()=>{
    for(const file of ['src/metrics-page.ts','src/metrics-score.ts']){
      const source=read(file);
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|MediaRecorder|sendBeacon|new WebSocket|toDataURL|toBlob/);
      expect(source).not.toMatch(/https?:\/\//);
    }
  });
  it('keeps git history, author names and local file status off the audience-facing page and its data',()=>{
    const collector=read('scripts/collect-metrics.mjs').replace(/\/\/.*$/gm,'');
    expect(collector).not.toMatch(/run\('git'|untracked|author/);
    expect(read('src/metrics-page.ts')).not.toMatch(/Recent commits|Uncommitted|repo\./);
  });
  it('records each known baseline failure exactly once',()=>{
    // 71 came with ProjectZero; fixed ones are removed so they count as new if they break again.
    const {failures,fixedSinceImport}=JSON.parse(read('metrics/baseline-failures.json')) as {failures:string[];fixedSinceImport:number};
    expect(new Set(failures).size).toBe(failures.length);expect(failures.length+fixedSinceImport).toBe(71);
  });
});
