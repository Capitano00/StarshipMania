import type {Order,TargetId} from './contracts';

export const gestureNames=['Closed_Fist','Open_Palm','Pointing_Up','Victory','Thumb_Up','Thumb_Down','ILoveYou'] as const;
export type GestureName=typeof gestureNames[number];
export type Recognition={category:string;score:number};
export const recognitionPresets={Forgiving:{enter:.55,retain:.45},Balanced:{enter:.65,retain:.55},Strict:{enter:.80,retain:.70}} as const;
export type RecognitionPreset=keyof typeof recognitionPresets;
export const COMMAND_HOLD_MS=500,FIRE_CONFIRM_MS=80,UNCERTAINTY_MS=150;
export const actions={pilotFire:{label:'Pilot fire',kind:'continuous',group:'MECH'},shortDash:{label:'Short dash / Shift',kind:'command',group:'MECH'},longDash:{label:'Long dash / Q',kind:'command',group:'MECH'},padisarahFire:{label:'Padisarah fire',kind:'continuous',group:'DRONE'},deploy:{label:'Deploy / redirect',kind:'command',group:'DRONE'},recall:{label:'Recall',kind:'command',group:'DRONE'},fireAtWill:{label:'Fire at will / F',kind:'command',group:'DRONE'}} as const;
export type ExtraAction='shortDash'|'longDash'|'fireAtWill';
export type ActionId=keyof typeof actions;
export type Side='Left'|'Right';
export type CommandAction='deploy'|'recall';
export type CommandReadiness={action:CommandAction;hand:Side;state:'Waiting for hand'|'Gesture uncertain'|'Change pose to rearm'|'No eligible target'|'Confirming'|'Issued';reason:string;recognized:GestureName|null;score:number|null;threshold:number;progress:number;durationMs:number;interruption:string};
export type ActionBinding={hand:Side;pose:Exclude<GestureName,'Open_Palm'>|'Unassigned';activation:'Instant'|'Duration'};
export type SessionBindings={bindings:Record<ActionId,ActionBinding>;autofire:boolean;durationMs:number};
export const defaultBindings=():SessionBindings=>({autofire:false,durationMs:COMMAND_HOLD_MS,bindings:{pilotFire:{hand:'Right',pose:'Closed_Fist',activation:'Instant'},padisarahFire:{hand:'Left',pose:'Closed_Fist',activation:'Instant'},deploy:{hand:'Left',pose:'Pointing_Up',activation:'Duration'},recall:{hand:'Left',pose:'Victory',activation:'Duration'},shortDash:{hand:'Left',pose:'Unassigned',activation:'Instant'},longDash:{hand:'Left',pose:'Unassigned',activation:'Instant'},fireAtWill:{hand:'Left',pose:'Unassigned',activation:'Duration'}}});
export const activationMs=(b:ActionBinding,durationMs=COMMAND_HOLD_MS)=>b.activation==='Duration'?durationMs:FIRE_CONFIRM_MS;
export const inputCatalogue=(['Left','Right'] as const).flatMap(hand=>gestureNames.map(pose=>({hand,pose,reserved:pose==='Open_Palm'})));
export function bindingError(config:SessionBindings):string|null {
 if(!config||typeof config.autofire!=='boolean'||!config.bindings||Object.keys(config.bindings).sort().join(',')!==Object.keys(actions).sort().join(','))return 'Invalid action configuration';
 if(!Number.isSafeInteger(config.durationMs)||config.durationMs<500||config.durationMs>3000||config.durationMs%100!==0)return 'Global Duration must be 0.5-3.0 seconds in 0.1 second steps';
 const used=new Set<string>();
 for(const id of Object.keys(actions) as ActionId[]){const b=config.bindings[id];
  if(!b||!['Left','Right'].includes(b.hand)||(b.pose as string)==='Open_Palm'||(!gestureNames.includes(b.pose as GestureName)&&!(b.pose==='Unassigned'&&['shortDash','longDash','fireAtWill'].includes(id))))return 'Select an anatomical hand and an assigned pose; Open Palm is reserved';
  if(!['Instant','Duration'].includes(b.activation)||Object.keys(b).sort().join(',')!=='activation,hand,pose')return 'Select Instant or Duration; per-action timing is not supported';
  const key=b.hand+b.pose;if(b.pose!=='Unassigned'){if(used.has(key))return 'Each hand + pose can bind to only one action';used.add(key);}
 }
 return null;
}
export const bindingLabel=(b:ActionBinding,durationMs=COMMAND_HOLD_MS)=>b.pose==='Unassigned'?'Unassigned (button / keyboard available)':`${b.hand} ${b.pose.replaceAll('_',' ')} (${b.activation==='Instant'?'Instant; 80 ms safety confirmation':`Duration ${(durationMs/1000).toFixed(1)} s`})`;

export function recognize(value:Recognition|undefined,preset:RecognitionPreset,previous:GestureName|null=null):GestureName|null {
  const limits=recognitionPresets[preset];
  if(!limits||!value||!gestureNames.includes(value.category as GestureName)||!Number.isFinite(value.score)||value.score>1)return null;
  const threshold=limits[previous===value.category?'retain':'enter'];
  return value.score>=threshold?value.category as GestureName:null;
}

/** Bindings consume accepted observations only. Rendering can never earn dwell credit. */
export class GestureBindings {
  extraActions:ExtraAction[]=[];
  private policySuppressed=false;
  private policyTransition:{pose:GestureName|null;since:number;samples:number}={pose:null,since:0,samples:0};
  /** Called only for an accepted manual group command, never for nomination/rejection. */
  manualOverride(){this.policySuppressed=this.config.bindings.fireAtWill.pose!=='Unassigned';this.policyTransition={pose:null,since:0,samples:0};this.resetExtra('fireAtWill');this.extraActions=this.extraActions.filter(id=>id!=='fireAtWill');}
  private rearmPolicy(time:number,poses:Record<Side,GestureName|null>){
    if(!this.policySuppressed)return;const b=this.config.bindings.fireAtWill,pose=poses[b.hand],transition=this.policyTransition;
    if(pose==='Open_Palm'){this.policySuppressed=false;this.policyTransition={pose:null,since:0,samples:0};return;}
    if(!pose||pose===b.pose){this.policyTransition={pose:null,since:0,samples:0};return;}
    if(transition.pose!==pose){transition.pose=pose;transition.since=time;transition.samples=1;}else transition.samples++;
    if(transition.samples>=2&&time-transition.since>=FIRE_CONFIRM_MS){this.policySuppressed=false;this.policyTransition={pose:null,since:0,samples:0};}
  }
  private extra:Record<ExtraAction,{progress:number;at:number|null;uncertain:number|null;samples:number}>={shortDash:{progress:0,at:null,uncertain:null,samples:0},longDash:{progress:0,at:null,uncertain:null,samples:0},fireAtWill:{progress:0,at:null,uncertain:null,samples:0}};
  private resetExtra(id:ExtraAction){this.extra[id]={progress:0,at:null,uncertain:null,samples:0};}
  private sampleExtra(time:number,poses:Record<Side,GestureName|null>){
    const dronePending=(['recall','deploy'] as const).some(id=>{const b=this.config.bindings[id];return !this.consumedHands.has(b.hand)&&poses[b.hand]===b.pose&&(id==='recall'||this.extraTarget);});
    for(const id of ['shortDash','longDash','fireAtWill'] as const){const b=this.config.bindings[id],c=this.extra[id],pose=poses[b.hand];
      if(b.pose==='Unassigned'||this.consumedHands.has(b.hand)||(id==='fireAtWill'&&(dronePending||this.policySuppressed))){this.resetExtra(id);continue;}
      if(pose===null&&c.samples){c.uncertain??=time;c.at=null;if(time-c.uncertain>UNCERTAINTY_MS)this.resetExtra(id);continue;}
      if(pose!==b.pose){this.resetExtra(id);continue;}
      if(c.uncertain!==null){if(time-c.uncertain>UNCERTAINTY_MS){this.resetExtra(id);continue;}c.uncertain=null;c.at=null;}
      if(c.at!==null)c.progress+=time-c.at;c.at=time;c.samples++;
      if(c.samples>=2&&c.progress>=activationMs(b,this.config.durationMs)){
        this.extraActions.push(id);this.consumedHands.add(b.hand);this.consumedPoses.set(b.hand,pose);this.transitions[b.hand]={pose:null,since:0,samples:0};this.resetExtra(id);
      }
    }
  }
  private extraTarget:TargetId|null=null;
  /** Recall cancels drone work; an idle drone channel has no hand to consume. */
  cancelDrone(time=this.lastTime??-Infinity){if(this.pending)this.cancel(time,false);this.resetExtra('fireAtWill');this.extraActions=this.extraActions.filter(id=>id!=='fireAtWill');}
  left:GestureName|null=null;right:GestureName|null=null;
  progress=0;fire=false;padisarahFire=false;consumed=false;
  private config=defaultBindings();
  get configuration(){return structuredClone(this.config);}
  configure(config:SessionBindings){if(bindingError(config))return false;this.config=structuredClone(config);this.reset(true);return true;}
  get holdMs(){return activationMs(this.config.bindings[this.pending?.type==='RECALL'?'recall':'deploy'],this.config.durationMs);}
  get commandHand(){return this.config.bindings[this.pending?.type==='RECALL'?'recall':'deploy'].hand;}
  private consumedHands=new Set<Side>();
  private consumedPoses=new Map<Side,GestureName|null>();
  private transitions:Record<Side,{pose:GestureName|null;since:number;samples:number}>={Left:{pose:null,since:0,samples:0},Right:{pose:null,since:0,samples:0}};
  private observations:Record<Side,{score:number|null;threshold:number}>={Left:{score:null,threshold:.65},Right:{score:null,threshold:.65}};
  private acceptedActions=new Set<CommandAction>();
  private attemptedAction:CommandAction|null=null;
  private interruption='';
  private issuedHand:Side|null=null;
  private confirmation={pilotFire:{since:null as number|null,samples:0},padisarahFire:{since:null as number|null,samples:0}};
  pending:Order|null=null;
  private lastTime:number|null=null;
  private uncertainSince:number|null=null;
  private eligibleSince:number|null=null;
  private rearmAfter=-Infinity;
  reset(requireOpen=false){
    this.policySuppressed=false;this.policyTransition={pose:null,since:0,samples:0};
    this.extraActions=[];for(const id of ['shortDash','longDash','fireAtWill'] as const)this.resetExtra(id);
    this.left=this.right=null;this.progress=0;this.fire=this.padisarahFire=false;this.pending=null;
    this.lastTime=this.uncertainSince=this.eligibleSince=null;this.consumed=requireOpen;this.rearmAfter=-Infinity;
    this.consumedHands=new Set(requireOpen?[this.config.bindings.deploy.hand,this.config.bindings.recall.hand]:[]);
    if(requireOpen)for(const id of ['shortDash','longDash','fireAtWill'] as const)if(this.config.bindings[id].pose!=='Unassigned')this.consumedHands.add(this.config.bindings[id].hand);
    this.consumedPoses=new Map([...this.consumedHands].map(hand=>[hand,null]));this.acceptedActions.clear();this.attemptedAction=null;this.interruption='';
    for(const hand of ['Left','Right'] as const){this.transitions[hand]={pose:null,since:0,samples:0};this.observations[hand].score=null;}
    this.issuedHand=null;
    for(const c of Object.values(this.confirmation)){c.since=null;c.samples=0;}
  }
  cancel(time=this.lastTime??-Infinity,external=true){if(external){for(const id of ['shortDash','longDash','fireAtWill'] as const){const b=this.config.bindings[id];if(this.extra[id].samples){this.consumedHands.add(b.hand);this.consumedPoses.set(b.hand,b.hand==='Left'?this.left:this.right);}this.resetExtra(id);}this.extraActions=[];}const hand=this.commandHand;this.consumedHands.add(hand);this.consumedPoses.set(hand,hand==='Left'?this.left:this.right);this.transitions[hand]={pose:null,since:0,samples:0};this.clearPending();this.consumed=true;this.rearmAfter=time;}
  acknowledge(accepted:boolean){if(accepted&&this.attemptedAction){this.acceptedActions.add(this.attemptedAction);this.interruption='';this.manualOverride();}else if(!accepted){this.interruption='Simulation rejected the command; a new hold is required';this.rejected();}this.attemptedAction=null;}
  rejected(){this.clearPending();if(this.issuedHand)this.consumedHands.delete(this.issuedHand);this.issuedHand=null;this.consumed=this.consumedHands.size>0;}
  /** True identity loss cancels only this hand's activation, never its completed-hold latch. */
  lose(hand:Side){
    if(this.config.bindings.fireAtWill.hand===hand)this.policyTransition={pose:null,since:0,samples:0};
    for(const id of ['shortDash','longDash','fireAtWill'] as const)if(this.config.bindings[id].hand===hand)this.resetExtra(id);this.extraActions=[];
    this.transitions[hand]={pose:null,since:0,samples:0};this.observations[hand].score=null;
    if(hand==='Left')this.left=null;else this.right=null;
    for(const id of ['pilotFire','padisarahFire'] as const)if(this.config.bindings[id].hand===hand){this.confirmation[id]={since:null,samples:0};if(id==='pilotFire')this.fire=false;else this.padisarahFire=false;}
    if(this.pending&&this.commandHand===hand){this.interruption=`${hand} identity input lost; hold reset`;this.clearPending();}
  }
  readiness(action:CommandAction,available:boolean,target:TargetId|null,visible:TargetId|null,preset:RecognitionPreset='Balanced'):CommandReadiness{
    const binding=this.config.bindings[action],recognized=binding.hand==='Left'?this.left:this.right,pending=this.pending?.type===(action==='recall'?'RECALL':'INTERCEPT');
    const result:CommandReadiness={action,hand:binding.hand,state:'Gesture uncertain',reason:`Show ${binding.hand} ${binding.pose.replaceAll('_',' ')}${recognized?`; recognized ${recognized.replaceAll('_',' ')}`:''}`,recognized,...this.observations[binding.hand],threshold:this.observations[binding.hand].score===null?recognitionPresets[preset].enter:this.observations[binding.hand].threshold,progress:pending?this.progress:0,durationMs:activationMs(binding,this.config.durationMs),interruption:this.interruption};
    if(!available)return {...result,state:'Waiting for hand',reason:`Waiting for fresh confirmed ${binding.hand} identity`};
    if(this.acceptedActions.has(action)&&this.consumedHands.has(binding.hand)&&recognized===binding.pose)return {...result,state:'Issued',reason:'Accepted by simulation. Change pose to rearm; holding this pose cannot repeat.'};
    if(!recognized)return {...result,reason:`${binding.hand} gesture is not confidently recognized${pending?'; progress paused without credit':''}`};
    if(this.consumedHands.has(binding.hand))return {...result,state:'Change pose to rearm',reason:`Open ${binding.hand} palm, or confirm a different pose for 80 ms; loss and uncertainty do not rearm`};
    if(recognized!==binding.pose)return result;
    if(action==='deploy'&&(!target||(pending&&visible!==target)))return {...result,state:'No eligible target',reason:target?'Waiting for the nominated target to be rendered':'Aim at a visible living target'};
    if(this.pending&&!pending)return {...result,reason:'Another command has priority; this action is not accumulating time'};
    return {...result,state:'Confirming',reason:pending?'Fresh accepted observations accumulate activation time':'Waiting for the next accepted observation to begin activation'};
  }
  private clearPending(){this.pending=null;this.progress=0;this.eligibleSince=this.uncertainSince=null;}
  sample(time:number,left:Recognition|undefined,right:Recognition|undefined,presets:{Left:RecognitionPreset;Right:RecognitionPreset},target:TargetId|null,visible:TargetId|null):Order|null {
    this.extraActions=[];
    if(this.lastTime!==null&&time<=this.lastTime)return null;
    const gap=this.lastTime!==null&&time-this.lastTime>200;
    if(gap){for(const id of ['shortDash','longDash','fireAtWill'] as const)this.resetExtra(id);this.policyTransition={pose:null,since:0,samples:0};}
    this.lastTime=time;
    if(gap){this.interruption='Fresh-sample gap exceeded 200 ms; hold reset';this.clearPending();for(const c of Object.values(this.confirmation)){c.since=null;c.samples=0;}for(const hand of ['Left','Right'] as const)this.transitions[hand]={pose:null,since:0,samples:0};this.fire=this.padisarahFire=false;this.left=this.right=null;}
    for(const [hand,value,previous] of [['Left',left,this.left],['Right',right,this.right]] as const){const limits=recognitionPresets[presets[hand]];this.observations[hand]={score:value&&Number.isFinite(value.score)?value.score:null,threshold:limits[previous===value?.category?'retain':'enter']};}
    this.left=recognize(left,presets.Left,this.left);this.right=recognize(right,presets.Right,this.right);
    const poses={Left:this.left,Right:this.right};
    for(const id of ['pilotFire','padisarahFire'] as const){const b=this.config.bindings[id],c=this.confirmation[id];
      if(poses[b.hand]===b.pose){c.since??=time;c.samples++;}else{c.since=null;c.samples=0;}
      const held=c.since!==null&&c.samples>=2&&time-c.since>=activationMs(b,this.config.durationMs);
      if(id==='pilotFire')this.fire=held;else this.padisarahFire=held;
    }
    for(const hand of this.consumedHands){
      const current=poses[hand],prior=this.consumedPoses.get(hand),transition=this.transitions[hand];let rearmed=current==='Open_Palm'&&time>this.rearmAfter;
      if(!rearmed&&current&&prior&&current!==prior){if(transition.pose!==current){transition.pose=current;transition.since=time;transition.samples=1;}else transition.samples++;rearmed=transition.samples>=2&&time-transition.since>=FIRE_CONFIRM_MS;}
      else if(!rearmed)this.transitions[hand]={pose:null,since:0,samples:0};
      if(rearmed){this.consumedHands.delete(hand);this.consumedPoses.delete(hand);this.transitions[hand]={pose:null,since:0,samples:0};for(const action of ['deploy','recall'] as const)if(this.config.bindings[action].hand===hand)this.acceptedActions.delete(action);}
    }
    this.rearmPolicy(time,poses);this.extraTarget=target;this.sampleExtra(time,poses);
    this.consumed=this.consumedHands.size>0;
    if(this.pending?.type==='INTERCEPT'&&this.pending.targetId!==target)this.clearPending();
    const recall=this.config.bindings.recall,deploy=this.config.bindings.deploy;
    // Immediate priority selection preserves a single pending command even across hands.
    const next:Order|null=!this.consumedHands.has(recall.hand)&&poses[recall.hand]===recall.pose?{type:'RECALL'}:!this.consumedHands.has(deploy.hand)&&poses[deploy.hand]===deploy.pose&&target?{type:'INTERCEPT',targetId:target}:null;
    if(!next&&this.pending&&poses[this.commandHand]===null){
      if(this.pending){this.uncertainSince??=time;this.eligibleSince=null;this.interruption='Gesture uncertain; progress paused without credit';if(time-this.uncertainSince>UNCERTAINTY_MS){this.interruption='Gesture uncertainty exceeded 150 ms; hold reset';this.clearPending();}}
      return null;
    }
    if(!next){this.clearPending();return null;}
    const same=this.pending?.type===next.type&&(next.type==='RECALL'||(this.pending?.type==='INTERCEPT'&&this.pending.targetId===next.targetId));
    if(!same&&this.pending)this.interruption='Gesture changed; previous hold reset';
    if(!same||(this.uncertainSince!==null&&time-this.uncertainSince>UNCERTAINTY_MS))this.clearPending();
    this.pending=next;
    if(this.uncertainSince!==null){this.uncertainSince=null;this.eligibleSince=null;}
    if(next.type==='INTERCEPT'&&visible!==target){this.eligibleSince=null;return null;}
    if(this.eligibleSince!==null)this.progress+=time-this.eligibleSince;
    this.eligibleSince=time;
    if(this.progress<this.holdMs)return null;
    this.attemptedAction=next.type==='RECALL'?'recall':'deploy';this.issuedHand=this.commandHand;this.cancel(this.lastTime??-Infinity,false);return next;
  }
  nominationChanged(target:TargetId|null){if(this.pending?.type==='INTERCEPT'&&this.pending.targetId!==target){this.interruption='Target changed or became unavailable; hold reset';this.clearPending();}}
}
