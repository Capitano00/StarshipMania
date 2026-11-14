import type {TargetId,Vec2} from './contracts';
export type ProjectedTarget={id:TargetId;left:number;right:number;top:number;bottom:number;visible:boolean};
const distance=(p:Vec2,b:ProjectedTarget)=>Math.hypot(Math.max(b.left-p.x,0,p.x-b.right),Math.max(b.top-p.y,0,p.y-b.bottom));
export function nominate(pointer:Vec2,targets:readonly ProjectedTarget[],previous:TargetId|null,direct:TargetId|null=null):TargetId|null {
  const visible=targets.filter(t=>t.visible);
  if(direct&&visible.some(t=>t.id===direct))return direct;
  const ranked=visible.map(target=>({target,distance:distance(pointer,target)})).sort((a,b)=>a.distance-b.distance);
  if(!ranked.length)return null;
  // Equal-distance silhouette boundaries are explicitly ambiguous, including overlaps.
  if(ranked.length>1&&Math.abs(ranked[0].distance-ranked[1].distance)<.5)return null;
  const best=ranked[0],halo=best.target.id===previous?32:24;
  // Nearest silhouette clips both acquisition and retention at the same neighbour boundary.
  return best.distance<=halo?best.target.id:null;
}
