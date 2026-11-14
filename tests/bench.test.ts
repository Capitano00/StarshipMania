import {describe,expect,it} from 'vitest';
import {GESTURE_LATENCY_MS,ROUND_LIMIT_SECONDS,baselineControllers,droneCommander,latencySweep,playRound,roundScore,runGameplayBenchmark,runSupervisorBenchmark,supervisorAgent} from '../src/bench/gameplay';
import {evaluateVoice,phrases} from '../src/bench/voice-eval';
import {gameplayRows,type Snapshot} from '../src/metrics-compare';
import type {VoiceIntent} from '../src/voice';

describe('gameplay benchmark',()=>{
  it('is deterministic, so a before/after difference comes from the change and not from luck',()=>{
    expect(JSON.stringify(runGameplayBenchmark())).toBe(JSON.stringify(runGameplayBenchmark()));
  });
  it('wins every baseline scenario within the time limit, with every gesture order accepted',()=>{
    for(const result of runGameplayBenchmark()){
      expect(result.outcome).toBe('won');expect(result.targetsCleared).toBe(6);expect(result.seconds).toBeLessThan(ROUND_LIMIT_SECONDS);
      expect(result.ordersRejected).toBe(0);expect(result.accuracy).toBeGreaterThan(0);expect(result.accuracy).toBeLessThanOrEqual(100);
    }
    expect(baselineControllers().every(c=>c.commandLatencyMs===GESTURE_LATENCY_MS)).toBe(true);
  });
  it('drones only clear faster with faster orders, which is what the voice latency comparison relies on',()=>{
    const sweep=latencySweep();
    for(let i=1;i<sweep.length;i++)expect(sweep[i].seconds).toBeGreaterThanOrEqual(sweep[i-1].seconds);
    expect(playRound(droneCommander('instant',0)).seconds).toBeLessThan(playRound(droneCommander('gesture',GESTURE_LATENCY_MS)).seconds);
  });
  it('scores a round out of 1000 from targets, speed, health and accuracy',()=>{
    const perfect={outcome:'won' as const,seconds:0,targetsCleared:6,healthLeft:100,damageTaken:0,pilotShots:1,pilotHits:1,droneShots:0,droneHits:0,accuracy:100,ordersAccepted:0,ordersRejected:0};
    expect(roundScore(perfect)).toBe(1000);
    expect(roundScore({...perfect,outcome:'timeout',seconds:ROUND_LIMIT_SECONDS,targetsCleared:3,healthLeft:50,accuracy:50})).toBe(150+0+100+100);
  });
});

describe('supervisor agent benchmark',()=>{
  it('clears the arena through the real tool layer, deterministically, with no stale decisions',()=>{
    const report=runSupervisorBenchmark();
    expect(report).toEqual(runSupervisorBenchmark());
    expect(report.outcome).toBe('won');expect(report.stale).toBe(0);expect(report.tasksFailed).toBe(0);
    expect(report.succeeded).toBeGreaterThan(report.toolCalls/2);expect(report.tasksCompleted).toBeGreaterThan(0);
  });
  it('commands drones only through tools: its orders are accepted as autonomous, never as pilot input',()=>{
    const agent=supervisorAgent('probe',false);const round=playRound(agent);
    expect(round.outcome).toBe('won');expect(round.ordersAccepted).toBeGreaterThan(0);expect(round.ordersRejected).toBe(0);
  });
});

describe('voice phrase-list benchmark',()=>{
  it('counts correct answers, wrong orders, misses and false triggers separately',()=>{
    const answers=new Map(phrases.map(p=>[p.text,p.expected]));
    expect(evaluateVoice(text=>answers.get(text)??null)).toMatchObject({accuracy:100,correct:phrases.length,wrongOrders:0,missed:0,falseTriggers:0});
    const alwaysRecall=evaluateVoice(():VoiceIntent=>({kind:'recall'}));
    const recallPhrases=phrases.filter(p=>p.expected?.kind==='recall').length,ignored=phrases.filter(p=>p.expected===null).length;
    expect(alwaysRecall).toMatchObject({correct:recallPhrases,falseTriggers:ignored,missed:0,wrongOrders:phrases.length-recallPhrases-ignored});
    expect(evaluateVoice(()=>{throw new Error('broken parser');}).missed).toBe(phrases.length-ignored);
  });
  it('covers clear, misheard and non-command phrases',()=>{
    for(const kind of ['clear','misheard','not a command'] as const)expect(phrases.some(p=>p.kind===kind)).toBe(true);
  });
});

describe('gameplay comparison rows',()=>{
  const snapshot=(id:string,gameplay:Snapshot['gameplay']):Snapshot=>({id,label:id,capturedAt:'',version:'0.4.3',build:{ok:true,seconds:1},bundle:{firstLoadGzipBytes:1,laterGzipBytes:1},tests:{passed:1,failed:0,newFailures:0,todo:0},code:{appLines:1,testLines:1},gameplay});
  const result=(scenario:string,seconds:number,score:number)=>({scenario,commandLatencyMs:500,outcome:'won',seconds,targetsCleared:6,healthLeft:100,accuracy:90,score,ordersAccepted:6});
  it('compares shared scenarios and marks a scenario that only exists after the change as new',()=>{
    const rows=gameplayRows(snapshot('b',[result('Drones only',25.3,958)]),snapshot('a',[result('Drones only',22,962),result('Voice-deployed drones',21,965)]));
    expect(rows.find(r=>r.group==='Time to clear the arena'&&r.name==='Drones only')).toMatchObject({before:25.3,after:22,verdict:'better'});
    expect(rows.find(r=>r.group==='Round score'&&r.name==='Voice-deployed drones')).toMatchObject({before:'n/a',after:965,verdict:'new'});
  });
  it('waits for the after snapshot instead of guessing',()=>{
    expect(gameplayRows(snapshot('b',[result('Drones only',25.3,958)]),undefined).every(r=>r.verdict==='pending')).toBe(true);
  });
});
