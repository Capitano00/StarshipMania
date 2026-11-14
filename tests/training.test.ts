import {describe,it,expect} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame} from '../src/contracts';

const step=(s:Simulation,n=1)=>{for(let i=0;i<n;i++)s.step(neutralFrame());};
const deploy=(s:Simulation,targetId:'T1'|'T2'|'T3',id:number)=>s.accept(s.envelope({type:'INTERCEPT',targetId},'local-hand-commit',`cmd-${id}`));
const recall=(s:Simulation,id:number)=>s.accept(s.envelope({type:'RECALL'},'local-keyboard-recall',`cmd-${id}`));
describe('actual simulation guided Padisarah training',()=>{
  it('requires accepted T1, an actual unit collision, accepted T2, explicit recall and both return positions',()=>{
    const s=new Simulation('training','training');step(s,200);expect(s.trainingStep).toBe(0);expect(s.groupState).toBe('Following');
    deploy(s,'T2',1);step(s,200);expect(s.trainingStep).toBe(0);
    deploy(s,'T1',2);expect(s.trainingStep).toBe(1);expect(s.groupState).toBe('Deploying to T1');
    for(let i=0;i<300&&s.trainingStep===1;i++)s.step({...neutralFrame(),padisarahFire:true});
    expect(s.trainingStep).toBe(2);expect(s.lastHit?.team).toBe('funnel');expect(s.padisarahHits).toBeGreaterThan(0);expect(s.groupState).toBe('Assigned T1');
    deploy(s,'T3',3);expect(s.trainingStep).toBe(2);deploy(s,'T2',4);expect(s.trainingStep).toBe(3);step(s,200);expect(s.trainingStep).toBe(3);
    recall(s,5);expect(s.trainingStep).toBe(4);expect(s.groupState).toBe('Returning');step(s);expect(s.trainingStep).toBe(4);
    step(s,300);expect(s.trainingStep).toBe(5);expect(s.groupState).toBe('Following');expect(s.turrets.every(t=>t.health===100)).toBe(true);expect(s.health).toBe(100);expect(s.projectiles.some(p=>p.team==='enemy')).toBe(false);
    expect(s.results.deployments).toBe(4);expect(s.results.recalls).toBe(1);
  });
  it('pilot collisions and old assignment projectiles cannot satisfy the unit-hit step',()=>{
    const s=new Simulation('training','training');deploy(s,'T1',1);
    for(const team of ['pilot','funnel'] as const){s.projectiles.push({id:900,position:{...s.turrets[0].position},velocity:{x:0,y:0},life:1,team,assignment:0});step(s);expect(s.trainingStep).toBe(1);}
    expect(s.turrets[0].health).toBe(100);expect(s.lastHit?.target).toBe('T1');
    recall(s,2);expect(s.trainingStep).toBe(0);step(s);deploy(s,'T1',3);expect(s.trainingStep).toBe(1);
    const before=s.trainingStep;expect(s.accept({...s.envelope({type:'INTERCEPT',targetId:'T2'},'local-hand-commit','cmd-4'),runId:'old'})).toBe(false);expect(s.trainingStep).toBe(before);expect(s.message).toContain('Rejected');
  });
  it('combat still damages targets and fires enemy projectiles; round counters are fresh',()=>{
    const s=new Simulation();s.projectiles.push({id:900,position:{...s.turrets[0].position},velocity:{x:0,y:0},life:1,team:'funnel'});step(s,100);
    expect(s.turrets[0].health).toBe(90);expect(s.padisarahHits).toBe(1);expect(s.projectiles.some(p=>p.team==='enemy')).toBe(true);
    const fresh=new Simulation('next');expect(fresh.results).toEqual({turretsCleared:0,deployments:0,recalls:0,padisarahHits:0});expect(fresh.lastHit).toBeNull();expect(fresh.trainingStep).toBe(0);
  });
});
