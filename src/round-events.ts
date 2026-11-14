import type {TargetId} from './contracts';
export type RoundEvent={id:number;tick:number;action:string;target:TargetId|null;outcome:string;detail:string};
/** Semantic transitions only: no observations, frames, or individual shots. */
export class RoundEvents {
 readonly entries:RoundEvent[]=[];
 private sequence=0;
 add(tick:number,action:string,outcome:string,detail='',target:TargetId|null=null){
  this.entries.unshift({id:++this.sequence,tick,action,target,outcome,detail});
  this.entries.length=Math.min(20,this.entries.length);
 }
}
/** Hold a reading snapshot until Latest is explicitly requested. */
export class LogCursor {
 private run='';private latest=0;
 following=true;unread=0;rows:RoundEvent[]=[];
 update(run:string,entries:readonly RoundEvent[]){
  if(run!==this.run){this.run=run;this.latest=0;this.following=true;this.unread=0;this.rows=[];}
  const newest=entries[0]?.id??0;
  if(this.following){this.rows=[...entries];this.latest=newest;this.unread=0;}
  else this.unread=Math.max(0,newest-this.latest);
 }
 readOlder(){this.following=false;}
 showLatest(){this.following=true;}
}
