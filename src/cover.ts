import {arenaBounds,placed,type ArenaBounds} from './arena-layout';
import {clamp,type Vec2} from './contracts';
export type Barrier={id:string;minX:number;maxX:number;minY:number;maxY:number;height:number};
export const barriers:readonly Barrier[]=[[-10.5,0],[0,-7.5],[10.5,0]].map(([x,y],i)=>({id:`B${i+1}`,minX:x-3,maxX:x+3,minY:y-.625,maxY:y+.625,height:2}));
const EPS=.001;
export const length=(a:Vec2,b:Vec2)=>Math.hypot(a.x-b.x,a.y-b.y);
export const expand=(b:Barrier,r:number):Barrier=>({...b,minX:b.minX-r,maxX:b.maxX+r,minY:b.minY-r,maxY:b.maxY+r});
export const inside=(p:Vec2,b:Barrier)=>p.x>=b.minX&&p.x<=b.maxX&&p.y>=b.minY&&p.y<=b.maxY;
export function sweepBox(a:Vec2,b:Vec2,box:Barrier):{t:number;normal:Vec2}|null {
  let enter=0,exit=1,normal={x:0,y:0};
  for(const axis of ['x','y'] as const){
    const delta=b[axis]-a[axis],lo=axis==='x'?box.minX:box.minY,hi=axis==='x'?box.maxX:box.maxY;
    if(Math.abs(delta)<1e-10){if(a[axis]<lo||a[axis]>hi)return null;continue;}
    const near=(delta>0?lo:hi)-a[axis],far=(delta>0?hi:lo)-a[axis],t=near/delta;
    if(t>=enter){enter=t;normal=axis==='x'?{x:delta>0?-1:1,y:0}:{x:0,y:delta>0?-1:1};}
    exit=Math.min(exit,far/delta);if(enter>exit)return null;
  }
  return enter<=1&&exit>=0?{t:Math.max(0,enter),normal}:null;
}
export function sweepCircle(a:Vec2,b:Vec2,center:Vec2,r:number):number|null {
  const x=a.x-center.x,y=a.y-center.y,dx=b.x-a.x,dy=b.y-a.y,c=x*x+y*y-r*r;
  if(c<=0)return 0;const aa=dx*dx+dy*dy;if(aa===0)return null;
  const bb=2*(x*dx+y*dy),disc=bb*bb-4*aa*c;if(disc<0)return null;
  const t=(-bb-Math.sqrt(disc))/(2*aa);return t>=0&&t<=1?t:null;
}
export function firstBarrier(a:Vec2,b:Vec2,r=0,walls=barriers){
  let hit:({t:number;normal:Vec2;barrier:Barrier})|null=null;
  for(const wall of walls){const next=sweepBox(a,b,expand(wall,r));if(next&&(!hit||next.t<hit.t))hit={...next,barrier:wall};}
  return hit;
}
export const clearLine=(a:Vec2,b:Vec2,r=0,walls=barriers)=>firstBarrier(a,b,r,walls)===null;
export type MotionSegment={from:Vec2;to:Vec2;start:number;end:number};
export function slidePath(position:Vec2,delta:Vec2,r=.85,walls=barriers,bounds:ArenaBounds=arenaBounds):{position:Vec2;segments:MotionSegment[]} {
  let p={...position},remaining={...delta},time=0;const segments:MotionSegment[]=[];
  for(let i=0;i<3;i++){
    const end={x:p.x+remaining.x,y:p.y+remaining.y};let hit:{t:number;normal:Vec2;boundary?:boolean}|null=firstBarrier(p,end,r,walls);
    // Boundaries consume only their actual fraction of the tick, then slide/stop.
    for(const axis of ['x','y'] as const)if(Math.abs(end[axis])>bounds.mechLimit&&remaining[axis]!==0){const sign=Math.sign(remaining[axis]),t=Math.max(0,(sign*bounds.mechLimit-p[axis])/remaining[axis]);if(t<=1&&(!hit||t<hit.t))hit={t,boundary:true,normal:axis==='x'?{x:-sign,y:0}:{x:0,y:-sign}};}
    if(!hit){segments.push({from:{...p},to:end,start:time,end:1});return {position:end,segments};}
    const t=Math.max(0,hit.t-(hit.boundary?0:EPS)),next={x:p.x+(end.x-p.x)*t,y:p.y+(end.y-p.y)*t},until=time+(1-time)*hit.t;
    if(until>time)segments.push({from:{...p},to:next,start:time,end:until});p=next;time=until;
    remaining={x:remaining.x*(1-hit.t)*(hit.normal.x?0:1),y:remaining.y*(1-hit.t)*(hit.normal.y?0:1)};
    if(Math.hypot(remaining.x,remaining.y)<EPS)break;
  }
  if(time<1)segments.push({from:{...p},to:{...p},start:time,end:1});return {position:p,segments};
}
export const slide=(position:Vec2,delta:Vec2,r=.85,walls=barriers)=>slidePath(position,delta,r,walls).position;
/** Both projectile and mech move over the same tick, including post-contact sliding. */
export function movingImpact(start:Vec2,end:Vec2,path:readonly MotionSegment[],radius=.85):number|null {
 let earliest:number|null=null;
 for(const segment of path){const at=(t:number)=>({x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t}),a=at(segment.start),b=at(segment.end);
  const local=sweepCircle({x:a.x-segment.from.x,y:a.y-segment.from.y},{x:b.x-segment.to.x,y:b.y-segment.to.y},{x:0,y:0},radius);
  if(local!==null){const time=segment.start+(segment.end-segment.start)*local;if(earliest===null||time<earliest)earliest=time;}
 }return earliest;
}
export function freePoint(desired:Vec2,r=.55,walls=barriers,bounds:ArenaBounds=arenaBounds):Vec2|null {
  const p={x:clamp(desired.x,-bounds.unitLimit,bounds.unitLimit),y:clamp(desired.y,-bounds.unitLimit,bounds.unitLimit)},boxes=walls.map(w=>expand(w,r));
  const candidates=[p];
  for(const b of boxes)if(inside(p,b))candidates.push({x:b.minX-EPS,y:p.y},{x:b.maxX+EPS,y:p.y},{x:p.x,y:b.minY-EPS},{x:p.x,y:b.maxY+EPS});
  return candidates.filter(c=>Math.abs(c.x)<=bounds.unitLimit&&Math.abs(c.y)<=bounds.unitLimit&&!boxes.some(b=>inside(c,b))).sort((a,b)=>length(a,p)-length(b,p))[0]??null;
}
/** Small deterministic visibility graph; called on destination changes, never every tick. */
export function route(start:Vec2,end:Vec2,r=.55,walls=barriers):Vec2[]|null {
  if(walls.some(w=>inside(start,expand(w,r))||inside(end,expand(w,r))))return null;
  if(clearLine(start,end,r,walls))return [{...end}];
  const nodes=[start,end];
  for(const wall of walls){const b=expand(wall,r+EPS);nodes.push({x:b.minX,y:b.minY},{x:b.maxX,y:b.minY},{x:b.maxX,y:b.maxY},{x:b.minX,y:b.maxY});}
  const cost=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),done=nodes.map(()=>false);cost[0]=0;
  for(let step=0;step<nodes.length;step++){
    let current=-1;for(let i=0;i<nodes.length;i++)if(!done[i]&&(current<0||cost[i]<cost[current]))current=i;
    if(current<0||!Number.isFinite(cost[current]))return null;if(current===1)break;done[current]=true;
    for(let next=0;next<nodes.length;next++)if(!done[next]&&clearLine(nodes[current],nodes[next],r,walls)){
      const distance=cost[current]+length(nodes[current],nodes[next]);if(distance<cost[next]){cost[next]=distance;previous[next]=current;}
    }
  }
  if(!Number.isFinite(cost[1]))return null;const result:Vec2[]=[];
  for(let i=1;i!==0;i=previous[i]){if(i<0)return null;result.unshift({...nodes[i]});}return result;
}
