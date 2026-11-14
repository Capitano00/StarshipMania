import type {TargetId} from './contracts';
import type {Hand} from './controls';
import {bindingLabel,defaultBindings,type ActionBinding} from './gestures';
export class PracticeFeedback {
 private acknowledgement='';private until=0;
 commit(target:TargetId,now:number){this.acknowledgement=`Practice committed ${target}`;this.until=now+2000;}
 recall(now:number){this.acknowledgement='Recall input confirmed - practice only';this.until=now+2000;}
 clear(){this.acknowledgement='';this.until=0;}
 text(now:number,fallback:string){return this.acknowledgement&&now<this.until?this.acknowledgement:fallback;}
}
export class PracticeFireFeedback {
 private held=false;private stopped=false;
 text(fire:boolean,right:Hand|undefined,blocked:string,binding:ActionBinding=defaultBindings().bindings.pilotFire,durationMs=defaultBindings().durationMs){
  if(blocked||!right){this.held=false;this.stopped=false;return `Blocked · ${blocked||'waiting for fresh tracking'}`;}
  if(fire){this.held=true;this.stopped=false;return `Fire input held · change ${binding.hand} pose to stop`;}
  if(this.held){this.held=false;this.stopped=true;}
  return this.stopped?'Stopped · fire input released':right.gesture?.category===binding.pose?`Ready · confirming ${bindingLabel(binding,durationMs)}`:`Ready · hold ${bindingLabel(binding,durationMs)}`;
 }
}
