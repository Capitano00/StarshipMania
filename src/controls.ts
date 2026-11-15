import {clamp,neutralFrame,type PilotControlFrame,type TargetId} from './contracts';
import {GestureBindings,recognize,recognitionPresets,type Recognition,type RecognitionPreset,type SessionBindings,type Side} from './gestures';
export type Hand={side:'Left'|'Right';palm:{x:number;y:number};confidence:number;gesture?:Recognition;pinch?:number};
export type Observation={epoch:number;sequence:number;capturedAt:number;hands:Hand[];processingMs:number};
export type ControlOutput={frame:PilotControlFrame;commit:TargetId|null;recall?:boolean;actions?:import('./gestures').ExtraAction[]};
export type ReadinessSnapshot={fresh:boolean;bothHands:boolean;openPosture:boolean;ready:boolean;rightPinch:number|null;blocker:string};
const AGE=200,RECOVER=80;
type HandTrack={hand:Hand|null;since:number;at:number;count:number;ready:boolean};
const emptyTrack=():HandTrack=>({hand:null,since:0,at:-Infinity,count:0,ready:false});
export const validHand=(h:Hand)=>h.confidence>=.75&&Number.isFinite(h.confidence)&&Number.isFinite(h.palm?.x)&&Number.isFinite(h.palm?.y)&&h.palm.x>=0&&h.palm.x<=1&&h.palm.y>=0&&h.palm.y<=1;
export const openHand=(h:Hand,preset:RecognitionPreset='Balanced')=>recognize(h.gesture,preset)==='Open_Palm';
const axis=(n:number)=>Math.abs(n)<.12?0:Math.sign(n)*(Math.min(1,Math.abs(n))-.12)/.88;
export class Controls {
 epoch=0;paused=true;needsRearm=false;calibrated=false;reason='Activate a source, then capture your neutral';trackingPauses=0;
 latest:Observation|null=null;neutral:{left:{x:number;y:number};right:{x:number;y:number}}|null=null;
 preview:TargetId|null=null;visibleTarget:TargetId|null=null;visibleSince=0;processingMs=0;updateAgeMs=0;
 private nomination:TargetId|null=null;
 readonly bindings=new GestureBindings();
 private presets:{Left:RecognitionPreset;Right:RecognitionPreset}={Left:'Balanced',Right:'Balanced'};
 private moveGain=1;private aimGain=1;private sequence=-1;private consumedSequence=-1;private capturedAt=-Infinity;
 private tracks:Record<Side,HandTrack>={Left:emptyTrack(),Right:emptyTrack()};private armed=false;private readinessIssue='';
 handReady(side:Side,now:number){const t=this.tracks[side];return this.latest!==null&&t.ready&&now>=t.at&&now-t.at<=AGE;}
 trackingStatus(now:number){return (['Left','Right'] as const).map(side=>`${side}: ${this.handReady(side,now)?'ready':this.latest&&this.tracks[side].hand&&now-this.tracks[side].at<=AGE?'confirming identity':'no input'}`).join(' / ');}
 get sensitivity(){return {move:this.moveGain,aim:this.aimGain};}
 get recognition(){return {...this.presets};}
 get configuration(){return this.bindings.configuration;}
 setBindings(config:SessionBindings){if(!this.paused||!this.bindings.configure(config))return false;this.invalidate('Bindings changed; choose explicit Resume with open hands',true);return true;}
 get inputArmed(){return this.armed&&!this.paused&&!this.needsRearm;}
 get commandProgress(){return this.bindings.progress;}
 acknowledgeCommand(accepted:boolean){this.bindings.acknowledge(accepted);}
 commandReadiness(now:number){const config=this.configuration;return {deploy:this.bindings.readiness('deploy',this.inputArmed&&this.handReady(config.bindings.deploy.hand,now),this.nomination,this.visibleTarget,this.presets[config.bindings.deploy.hand]),recall:this.bindings.readiness('recall',this.inputArmed&&this.handReady(config.bindings.recall.hand,now),null,null,this.presets[config.bindings.recall.hand])};}
 setSensitivity(move:number,aim:number){if(!this.paused||!Number.isFinite(move)||!Number.isFinite(aim))return false;this.moveGain=clamp(move,.5,2);this.aimGain=clamp(aim,.5,2);return true;}
 setRecognition(side:'Left'|'Right',preset:RecognitionPreset){if(!this.paused||!(preset in recognitionPresets))return false;this.presets[side]=preset;this.invalidate('Recognition changed; open both hands before Start / Resume',true);return true;}
 invalidate(reason:string,pause=false){
  this.epoch++;this.latest=null;this.sequence=this.consumedSequence=-1;this.preview=this.visibleTarget=null;this.visibleSince=0;
  this.nomination=null;
  this.bindings.reset(true);this.armed=false;this.tracks={Left:emptyTrack(),Right:emptyTrack()};this.capturedAt=-Infinity;
  if(pause){this.paused=true;this.needsRearm=false;}this.reason=reason;
 }
 cancel(now=this.latest?.capturedAt??0){this.preview=this.visibleTarget=null;this.visibleSince=0;this.bindings.cancel(now);}
 pause(reason='Paused; choose Start / Resume, then open both hands comfortably'){this.invalidate(reason,true);}
 restart(){this.pause('Round reset; choose Start / Resume with open hands');this.trackingPauses=0;}
 recall(now=this.latest?.capturedAt??0){this.preview=this.visibleTarget=null;this.visibleSince=0;this.bindings.cancelDrone(now);this.reason='Recall requested; mech input remains independent';}
 ingest(sample:Observation,now:number){
  if(sample.epoch!==this.epoch||sample.sequence<=this.sequence)return false;this.sequence=sample.sequence;
  if(!Number.isFinite(sample.capturedAt)||sample.capturedAt>now||now-sample.capturedAt>AGE||sample.capturedAt<=this.capturedAt){this.fail('Waiting for fresh tracking');return false;}
  this.capturedAt=sample.capturedAt;
  const left=sample.hands.filter(h=>h.side==='Left'),right=sample.hands.filter(h=>h.side==='Right');
  const unknown=sample.hands.some(h=>h.side!=='Left'&&h.side!=='Right');
  const cross=left.length===1&&right.length===1&&validHand(left[0])&&validHand(right[0])&&left[0].palm.x+.08>=right[0].palm.x;
  const accepted:Hand[]=[];
  for(const side of ['Left','Right'] as const){
   const found=side==='Left'?left:right;
   if(unknown||cross||found.length!==1||!validHand(found[0])){this.lose(side);continue;}
   let t=this.tracks[side];const h=found[0];
   if(sample.capturedAt-t.at>AGE){this.lose(side);t=this.tracks[side];}
   if(t.hand&&Math.hypot(h.palm.x-t.hand.palm.x,h.palm.y-t.hand.palm.y)>.18){this.lose(side);continue;}
   if(!t.hand)t.since=sample.capturedAt;
   t.hand=h;t.at=sample.capturedAt;t.count++;t.ready=t.count>=2&&t.at-t.since>=RECOVER;accepted.push(h);
  }
  this.latest={...sample,hands:accepted};this.processingMs=sample.processingMs;
  this.readinessIssue=accepted.length===2?'':cross||unknown?'Hand identity uncertain; show separated palms':'Both hands must be confidently tracked for the requested paired capture';
  return accepted.length>0;
 }
 private lose(side:Side){
  this.tracks[side]=emptyTrack();this.bindings.lose(side);
  if(!this.bindings.pending){this.preview=this.visibleTarget=null;this.visibleSince=0;}
 }
 private fail(reason:string){
  this.tracks={Left:emptyTrack(),Right:emptyTrack()};
  this.clearLiveInput(reason);
 }
 private clearLiveInput(reason:string){
  this.bindings.lose('Left');this.bindings.lose('Right');
  this.latest=null;this.nomination=this.preview=this.visibleTarget=null;this.visibleSince=0;this.readinessIssue=reason;
 }
 readiness(now:number):ReadinessSnapshot {
  const fresh=!!this.latest&&this.latest.epoch===this.epoch&&Number.isFinite(now)&&now>=this.latest.capturedAt&&now-this.latest.capturedAt<=AGE;
  const bothHands=fresh&&this.latest!.hands.length===2;
  const openPosture=bothHands&&this.latest!.hands.every(h=>openHand(h,this.presets[h.side]));
  return {fresh,bothHands,openPosture,ready:bothHands&&openPosture,rightPinch:null,blocker:!fresh?'Waiting for fresh tracking':!bothHands?(this.readinessIssue||'Show both hands'):!openPosture?'Open both hands comfortably; this position becomes your centre.':''};
 }
 ready(now:number){return this.readiness(now).ready;}
 calibrate(now:number){if(!this.paused||!this.ready(now))return false;this.recenter();this.calibrated=true;this.reason='Neutral captured';return true;}
 private recenter(){
  this.neutral={left:{...this.latest!.hands.find(h=>h.side==='Left')!.palm},right:{...this.latest!.hands.find(h=>h.side==='Right')!.palm}};
  this.preview=this.visibleTarget=null;this.visibleSince=0;this.bindings.reset();this.consumedSequence=this.latest!.sequence;
  for(const side of ['Left','Right'] as const){this.tracks[side].ready=true;this.tracks[side].count=2;this.tracks[side].since=this.tracks[side].at-RECOVER;}
 }
 resume(now:number){if(!this.calibrated||!this.ready(now)||(!this.paused&&!this.needsRearm))return false;this.recenter();this.paused=false;this.needsRearm=false;this.armed=true;this.reason='Ready';return true;}
 markRendered(target:TargetId|null,now:number){if(target&&target===this.preview&&this.visibleTarget!==target){this.visibleTarget=target;this.visibleSince=now;}}
 pointer(now:number){
  if(!this.neutral||!this.handReady('Right',now))return {x:0,y:0};
  const hand=this.tracks.Right.hand!;
  return {x:clamp((hand.palm.x-this.neutral.right.x)/.12*this.aimGain),y:clamp((this.neutral.right.y-hand.palm.y)/.10*this.aimGain)};
 }
 update(now:number,target:TargetId|null):ControlOutput {
  this.updateAgeMs=this.latest?now-this.latest.capturedAt:Infinity;
  if(this.latest){
   if(!Number.isFinite(this.updateAgeMs)||this.updateAgeMs<0)this.fail('Waiting for fresh tracking');
   // An in-flight capture can still maintain identity, but an expired sample grants no input or gesture credit.
   else if(this.updateAgeMs>AGE)this.clearLiveInput('Waiting for fresh tracking');
  }
  if(!this.latest||!this.inputArmed||!this.neutral)return {frame:neutralFrame(),commit:null};
  this.nomination=target;
  const left=this.handReady('Left',now)?this.tracks.Left.hand:null,right=this.handReady('Right',now)?this.tracks.Right.hand:null;
  this.bindings.nominationChanged(target);
  if(this.preview!==target){this.preview=null;this.visibleTarget=null;this.visibleSince=0;}
  let action:null|import('./contracts').Order=null;let actions:import('./gestures').ExtraAction[]=[];
  if(this.latest.sequence!==this.consumedSequence){
   this.consumedSequence=this.latest.sequence;
   action=this.bindings.sample(this.latest.capturedAt,left?.gesture,right?.gesture,this.presets,target,this.visibleTarget);
   actions=[...this.bindings.extraActions];
  }
  this.preview=this.bindings.pending?.type==='INTERCEPT'?this.bindings.pending.targetId:null;
  if(!this.preview){this.visibleTarget=null;this.visibleSince=0;}
  const frame={move:left?{x:clamp(axis((left.palm.x-this.neutral.left.x)/.10)*this.moveGain),y:clamp(axis((this.neutral.left.y-left.palm.y)/.10)*this.moveGain)}:{x:0,y:0},aim:this.pointer(now),fire:this.bindings.fire,padisarahFire:this.bindings.padisarahFire};
  // Recall takes precedence over unit commands, never over the independent pilot trigger.
  if(action?.type==='RECALL')return {frame,commit:null,recall:true,...(actions.length?{actions}:{})};
  return {frame,commit:action?.type==='INTERCEPT'?action.targetId:null,...(actions.length?{actions}:{})};
 }
}
