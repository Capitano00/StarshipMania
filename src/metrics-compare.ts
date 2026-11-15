/** Before/after comparisons for metrics/comparisons.json. Pure, so the metrics page and tests share it. */
import {scorePerformance,type PerformanceRun} from './metrics-score';

/** Build, bundle and test numbers for one version of the game, saved by `npm run metrics -- --snapshot <id>`. */
export interface Snapshot {
  id:string;label:string;capturedAt:string;version:string;
  build:{ok:boolean;seconds:number};
  bundle:{firstLoadGzipBytes:number;laterGzipBytes:number};
  tests:{passed:number;failed:number;newFailures:number;todo:number};
  code:{appLines:number;testLines:number};
  /** Scripted rounds from src/bench/gameplay.ts. Older snapshots may not have them. */
  gameplay?:GameplayResult[];
  latencySweep?:{latencyMs:number;seconds:number;score:number;outcome:string}[];
  /** Phrase-list results from src/bench/voice-eval.ts. */
  voice?:VoiceSummary;
  /** Supervisor agent tool-call results from the drones-only round (src/bench/gameplay.ts). */
  supervisor?:SupervisorSummary;
}
export interface SupervisorSummary {decisionMs:number;seconds:number;toolCalls:number;succeeded:number;stale:number;invalid:number;tasksCompleted:number;tasksFailed:number}
export interface GameplayResult {scenario:string;commandLatencyMs:number;outcome:string;seconds:number;targetsCleared:number;healthLeft:number;accuracy:number;score:number;ordersAccepted:number;pilotCommands?:number;agentCommands?:number}
export interface VoiceSummary {phrases:number;accuracy:number;correct:number;wrongOrders:number;missed:number;falseTriggers:number;byKind:{kind:string;phrases:number;correct:number}[]}
export type Better='higher'|'lower'|null;
/** A number only the feature owner can measure, such as voice accuracy or a model's win rate.
 *  null = not measured yet. "n/a" = the "before" version cannot do this at all, so the "after" value is a new capability. */
export type Value=number|null|'n/a';
export interface CustomMetric {name:string;unit:string;better:Better;before:Value;after:Value;note?:string;
  /** Changes this small count as "No change", so measurement noise is not reported as a win or a regression. Default 0. */
  tolerance?:number}
export interface Side {label:string;snapshot?:string|null;performanceRun?:string|null}
export interface Comparison {id:string;title:string;summary:string;before:Side;after:Side;metrics:CustomMetric[];
  /** Also compare the automatic voice phrase-list results from the two snapshots. */
  agentBenchmark?:'voice'|'supervisor'}
export type Verdict='better'|'worse'|'same'|'neutral'|'new'|'pending';
/** feature + agent = how well the agent/model itself works; gameplay = what it does to a round; benchmark + snapshot = engineering cost. */
export type Source='feature'|'agent'|'gameplay'|'benchmark'|'snapshot';
export interface Row {name:string;unit:string;better:Better;before:Value;after:Value;delta:number|null;verdict:Verdict;source:Source;note?:string;group?:string}

const kB=(bytes:number)=>Math.round(bytes/102.4)/10;

export function verdict(before:Value,after:Value,better:Better,tolerance=0):Verdict{
  if(typeof after!=='number')return 'pending';
  if(before==='n/a')return 'new';
  if(before===null)return 'pending';
  if(better===null)return after===before?'same':'neutral';
  if(Math.abs(after-before)<=tolerance)return 'same';
  return (after>before)===(better==='higher')?'better':'worse';
}
const row=(name:string,unit:string,better:Better,before:Value,after:Value,source:Source,note?:string,tolerance=0):Row=>
  ({name,unit,better,before,after,delta:typeof before==='number'&&typeof after==='number'?Math.round((after-before)*100)/100:null,verdict:verdict(before,after,better,tolerance),source,note});

const snapshotRows=(before?:Snapshot,after?:Snapshot):Row[]=>[
  row('First-load JS (gzip)','kB','lower',before?kB(before.bundle.firstLoadGzipBytes):null,after?kB(after.bundle.firstLoadGzipBytes):null,'snapshot'),
  row('JS loaded later or on demand (gzip)','kB','lower',before?kB(before.bundle.laterGzipBytes):null,after?kB(after.bundle.laterGzipBytes):null,'snapshot'),
  row('Tests passing','','higher',before?.tests.passed??null,after?.tests.passed??null,'snapshot'),
  row('New test failures','','lower',before?.tests.newFailures??null,after?.tests.newFailures??null,'snapshot','Failures not inherited from ProjectZero'),
  row('App source lines','',null,before?.code.appLines??null,after?.code.appLines??null,'snapshot','More code is neither better nor worse'),
];

const benchmarkRows=(before?:PerformanceRun,after?:PerformanceRun):Row[]=>{
  const slowest=(run?:PerformanceRun)=>run?Math.min(...run.scenarios.map(s=>s.fps)):null;
  return [
    row('Performance score','/100','higher',before?scorePerformance(before).total:null,after?scorePerformance(after).total:null,'benchmark'),
    // Tolerances are rough allowances for noise between manual benchmark runs; tighten them once repeat runs show the real spread.
    row('Slowest frame rate','fps','higher',slowest(before),slowest(after),'benchmark',undefined,1),
    row('Page load','ms','lower',before?.load.loadMs??null,after?.load.loadMs??null,'benchmark',undefined,10),
    row('Long animation frames','','lower',before?.longAnimationFrames.length??null,after?.longAnimationFrames.length??null,'benchmark','Frames over 50 ms, such as screen changes'),
    row('Peak JS heap','MB','lower',before?.heap.peakMB??null,after?.heap.peakMB??null,'benchmark','Changes within 1 MB are garbage-collection timing',1),
  ];
};

const voiceRows=(before?:VoiceSummary,after?:VoiceSummary):Row[]=>[
  row('Phrase list understood correctly','%','higher',before?.accuracy??null,after?.accuracy??null,'agent','Fixed list of clear, misheard and non-command phrases (src/bench/voice-eval.ts)'),
  row('Wrong orders','','lower',before?.wrongOrders??null,after?.wrongOrders??null,'agent','Parsed into the wrong target or action: worse than doing nothing'),
  row('Missed commands','','lower',before?.missed??null,after?.missed??null,'agent'),
  row('False triggers','','lower',before?.falseTriggers??null,after?.falseTriggers??null,'agent','Orders issued for chatter that was not a command'),
];

/** A snapshot from before the agent existed reports it as "n/a" (not possible), not as unmeasured. */
const supervisorRows=(before?:Snapshot,after?:Snapshot):Row[]=>{
  const v=(s:Snapshot|undefined,pick:(x:SupervisorSummary)=>number):Value=>!s?null:s.supervisor?pick(s.supervisor):'n/a';
  return [
    row('Tool calls that succeeded','%','higher',v(before,x=>Math.round(x.succeeded/Math.max(1,x.toolCalls)*1000)/10),v(after,x=>Math.round(x.succeeded/Math.max(1,x.toolCalls)*1000)/10),'agent','Every get_game_state, defend_pilot and assign_target call in the drones-only round'),
    row('Calls rejected as stale','','lower',v(before,x=>x.stale),v(after,x=>x.stale),'agent','Decisions made on an outdated state_token'),
    row('Calls rejected as invalid','','lower',v(before,x=>x.invalid),v(after,x=>x.invalid),'agent','Mostly defend_pilot with no armed turret left; the agent then uses assign_target'),
    row('Tasks completed','','higher',v(before,x=>x.tasksCompleted),v(after,x=>x.tasksCompleted),'agent'),
    row('Tasks failed','','lower',v(before,x=>x.tasksFailed),v(after,x=>x.tasksFailed),'agent'),
  ];
};

/** The four numbers every scripted round reports, in the order the page charts them. */
export const gameplayMetrics=[
  {key:'score',name:'Round score',unit:'/1000',better:'higher'},
  {key:'seconds',name:'Time to clear the arena',unit:'s',better:'lower'},
  {key:'accuracy',name:'Hit accuracy',unit:'%',better:'higher'},
  {key:'healthLeft',name:'Mech health left',unit:'%',better:'higher'},
] as const satisfies readonly {key:keyof GameplayResult;name:string;unit:string;better:Better}[];

/** One row per scenario and metric. A scenario only one side played shows the other side as "n/a" (it did not exist). */
export function gameplayRows(before?:Snapshot,after?:Snapshot):Row[]{
  const names=[...new Set([...(before?.gameplay??[]),...(after?.gameplay??[])].map(r=>r.scenario))];
  const value=(snap:Snapshot|undefined,scenario:string,key:keyof GameplayResult):Value=>{
    if(!snap?.gameplay)return null;
    const result=snap.gameplay.find(r=>r.scenario===scenario);
    return result?result[key] as number:'n/a';
  };
  return gameplayMetrics.flatMap(m=>names.map(scenario=>({...row(scenario,m.unit,m.better,value(before,scenario,m.key),value(after,scenario,m.key),'gameplay'),group:m.name})));
}

/** Every row for one comparison. Snapshot and benchmark rows appear only when either side names a snapshot or run. */
export function compare(comparison:Comparison,snapshots:Snapshot[],runs:(PerformanceRun&{id?:string})[]):Row[]{
  const snap=(id?:string|null)=>id?snapshots.find(s=>s.id===id):undefined;
  const run=(id?:string|null)=>id?runs.find(r=>r.id===id):undefined;
  const {before,after}=comparison;
  const usesSnapshots=!!(before.snapshot||after.snapshot);
  return [
    ...comparison.metrics.map(m=>row(m.name,m.unit,m.better,m.before,m.after,'feature',m.note,m.tolerance)),
    ...(comparison.agentBenchmark==='voice'&&usesSnapshots?voiceRows(snap(before.snapshot)?.voice,snap(after.snapshot)?.voice):[]),
    ...(comparison.agentBenchmark==='supervisor'&&usesSnapshots?supervisorRows(snap(before.snapshot),snap(after.snapshot)):[]),
    ...(usesSnapshots?gameplayRows(snap(before.snapshot),snap(after.snapshot)):[]),
    ...(before.performanceRun||after.performanceRun?benchmarkRows(run(before.performanceRun),run(after.performanceRun)):[]),
    ...(usesSnapshots?snapshotRows(snap(before.snapshot),snap(after.snapshot)):[]),
  ];
}

/** How far along a comparison is: measured rows out of all rows. */
export const progress=(rows:Row[])=>({measured:rows.filter(r=>r.verdict!=='pending').length,total:rows.length});
