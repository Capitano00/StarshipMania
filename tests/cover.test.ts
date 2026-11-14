import {describe,it,expect} from 'vitest';
import {barriers,clearLine,expand,firstBarrier,freePoint,inside,route,slide,sweepCircle} from '../src/cover';
import {Simulation} from '../src/simulation';
import {neutralFrame} from '../src/contracts';
describe('deterministic cover geometry and real simulation impacts',()=>{
 it('slides along expanded walls without entering corners, including a large diagonal step',()=>{
  let p={x:-10.5,y:3};for(let i=0;i<80;i++){p=slide(p,{x:.13,y:-.13});expect(barriers.some(b=>inside(p,expand(b,.85)))).toBe(false);}
  expect(p.x).toBeGreaterThan(-4);const q=slide({x:-12,y:4},{x:10,y:-10});expect(barriers.some(b=>inside(q,expand(b,.85)))).toBe(false);
 });
 it('sweeps wall and circle boundaries rather than tunnelling through endpoints',()=>{
  expect(firstBarrier({x:-10.5,y:4},{x:-10.5,y:-4})?.barrier.id).toBe('B1');expect(sweepCircle({x:0,y:0},{x:10,y:0},{x:5,y:0},1)).toBeCloseTo(.4);
  expect(sweepCircle({x:0,y:2},{x:10,y:2},{x:5,y:0},1)).toBeNull();
 });
 it.each(['pilot','funnel','enemy'] as const)('cover blocks %s shots before a farther actor',team=>{
  const s=new Simulation('cover','training');s.position={x:-10.5,y:-4};s.turrets[0].position={x:-10.5,y:-4};
  s.projectiles.push({id:99,position:{x:-10.5,y:4},velocity:{x:0,y:-10},team,life:20});s.step(neutralFrame());
  expect(s.health).toBe(100);expect(s.padisarahHits).toBe(0);expect(s.lastHit).toBeNull();expect(s.projectiles).toHaveLength(0);expect(s.lastImpact?.position.y).toBeGreaterThan(0);
 });
 it('a nearer target is hit before the wall and receives unchanged damage',()=>{
  const s=new Simulation();s.turrets[0].position={x:-10.5,y:3};s.projectiles.push({id:99,position:{x:-10.5,y:6},velocity:{x:0,y:-10},team:'pilot',life:20});s.step(neutralFrame());expect(s.turrets[0].health).toBe(80);expect(s.lastHit?.target).toBe('T1');
 });
 it('routes reproducibly through expanded corners and refuses an impossible destination',()=>{
  const a={x:-10.5,y:4},b={x:-10.5,y:-4},path=route(a,b)!;expect(path.length).toBeGreaterThan(1);expect(route(a,b)).toEqual(path);
  let previous=a;for(const point of path){expect(clearLine(previous,point,.55)).toBe(true);previous=point;}expect(route(a,{x:-10.5,y:0})).toBeNull();
 });
 it('projects an occupied follow slot onto a free point and resolves recall completion',()=>{
  const resolved=freePoint({x:-10.5,y:0})!;expect(barriers.some(b=>inside(resolved,expand(b,.55)))).toBe(false);
  const s=new Simulation('follow','training');s.position={x:-10.5,y:-1.6};for(let i=0;i<400;i++)s.step(neutralFrame());
  expect(s.groupState).toBe('Following');expect(s.funnels.every(f=>!barriers.some(b=>inside(f.position,expand(b,.55))))).toBe(true);
  const paths=s.funnels.map(f=>f.path);s.step(neutralFrame());expect(s.funnels[0].path).toBe(paths[0]);expect(s.funnels[1].path).toBe(paths[1]);
 });
 it('retains a blocked assignment without auto-targeting if no route is possible',()=>{
  const s=new Simulation('blocked','training');s.funnels.forEach(f=>f.position={x:-10.5,y:0});s.accept(s.envelope({type:'INTERCEPT',targetId:'T1'},'local-hand-commit','cmd-1'));s.step(neutralFrame());expect(s.order).toEqual({type:'INTERCEPT',targetId:'T1'});expect(s.groupState).toContain('Blocked');expect(s.projectiles).toHaveLength(0);
 });
 it('hand recall provenance cannot authorize INTERCEPT and retains recall precedence',()=>{
  const s=new Simulation();expect(s.accept(s.envelope({type:'INTERCEPT',targetId:'T1'},'local-hand-recall','cmd-1'))).toBe(false);
  s.commands([s.envelope({type:'INTERCEPT',targetId:'T1'},'local-hand-commit','cmd-2'),s.envelope({type:'RECALL'},'local-hand-recall','cmd-3')]);expect(s.order.type).toBe('RECALL');expect(s.accepted).toBe(1);
 });
 it.each([[-1,0],[0,-1],[.5,1],[0,Infinity],[NaN,1],[Number.MAX_SAFE_INTEGER+1,Number.MAX_SAFE_INTEGER+2]])('rejects unbounded timing %s / %s', (issuedAtTick,expiresAtTick)=>{
  const s=new Simulation();expect(s.accept({...s.envelope({type:'RECALL'},'local-hand-recall','cmd-1'),issuedAtTick,expiresAtTick})).toBe(false);expect(s.accepted).toBe(0);
 });
});
