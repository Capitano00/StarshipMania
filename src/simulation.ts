import {arenaBounds} from './arena-layout';
import {clamp,finitePoint,neutralFrame,targetIds,type ActionIntent,type ActionPayload,type DronePolicy,type DashKind,type CommandEnvelope,type CommandGroup,type Order,type SquadOrder,pilotProvenances,type PilotControlFrame,type TargetId,type Vec2} from './contracts';
import {barriers,clearLine,firstBarrier,freePoint,length,route,slidePath,movingImpact,sweepCircle} from './cover';
import {RoundEvents} from './round-events';
export const actorDefinitions=[
 {id:'T1',position:{x:-13.5,y:-10.5},armed:true,patrol:[]},
 {id:'T2',position:{x:0,y:-18},armed:true,patrol:[]},
 {id:'T3',position:{x:13.5,y:-10.5},armed:true,patrol:[]},
 {id:'T4',position:{x:-19.5,y:7.5},armed:false,patrol:[]},
 {id:'T5',position:{x:-19.5,y:-19.5},armed:true,patrol:[{x:-19.5,y:-19.5},{x:-7.5,y:-19.5}]},
 {id:'T6',position:{x:18,y:7.5},armed:false,patrol:[{x:18,y:7.5},{x:18,y:18}]}
] as const;
export type Turret={id:TargetId;position:Vec2;health:number;cooldown:number;armed:boolean;patrol:readonly Vec2[];waypoint:number};
export type Projectile={id:number;position:Vec2;velocity:Vec2;team:'pilot'|'enemy'|'funnel';life:number;assignment?:number;shooter?:string;assignmentOrigin?:'manual'|'auto';assignedTarget?:TargetId};
export type Funnel={id:string;order:Order;origin:'manual'|'auto';assignment:number;/** Assigned by an agent under autonomy: may fire at its own target when autonomy grants fire. */autonomous:boolean;status:string;position:Vec2;cooldown:number;destination:Vec2;requested:Vec2;path:Vec2[];waypoint:number;blocked:boolean;revision:number};
/** One command outcome. `assignment` is the units' new assignment number when accepted (origin 'manual'). */
export type CommandRecord={commandId:string|null;tick:number;group:string|null;provenance:string|null;order:Order|null;squad?:{unit:string;targetId:TargetId}[];outcome:'accepted'|'rejected';reason?:string;units:string[];assignment?:number};
const direction=(a:Vec2,b:Vec2)=>{const d=length(a,b)||1;return {x:(b.x-a.x)/d,y:(b.y-a.y)/d};};
export class Simulation {
 tick=0;health=100;position={x:0,y:15};outcome:'playing'|'won'|'lost'='playing';readonly barriers=barriers;
 turrets:Turret[]=actorDefinitions.map((t,i)=>({...t,position:{...t.position},health:100,cooldown:90+i*60,waypoint:1}));
 readonly events=new RoundEvents();
 pilotFire=false;padisarahFire=false;padisarahFiring=false;
 stopFire(){this.fireInputs(false,false);this.padisarahFiring=false;this.cancelDash();}
 private fireInputs(pilot:boolean,units:boolean){
  for(const [action,before,after] of [['Pilot fire',this.pilotFire,pilot],['Padisarah fire',this.padisarahFire,units]] as const)
   if(before!==after)this.events.add(this.tick,action,after?'Started':'Stopped',after?'Fire permission active':'Fire permission removed');
  this.pilotFire=pilot;this.padisarahFire=units;
 }
 get fireState(){
  if(!this.padisarahFire){
   const auto=this.autonomy.fire?this.funnels.filter(f=>f.autonomous&&f.order.type==='INTERCEPT'):[];
   return auto.length?`Autonomous fire: ${auto.map(f=>f.id).join(', ')}`:'Holding fire';
  }
  if(this.funnels.every(f=>f.blocked))return 'Blocked: no reachable firing position';
  if(this.padisarahFiring)return 'Firing';
  if(this.funnels.some(f=>f.order.type==='INTERCEPT'))return this.funnels.map(f=>f.id+': '+f.status).join(' / ');
  return this.fireAtWill?'Waiting: no reachable eligible target':'Blocked: no target assigned';
 }
 funnels:Funnel[]=[];
 /** Compatibility summary only; navigation and fire always use each unit's order. */
 get order():Order{return this.funnels[0]?.order??{type:'RECALL'};}
 projectiles:Projectile[]=[];message='Padisarah units following';accepted=0;rejected=0;
 fireAtWill=false;preferredPolicy:DronePolicy='A';directAutofireSuppressed=false;
 private automaticRevision=0;private intentSequence=0;private seenIntents=new Set<number>();private manualOverrideTick=-1;private manualCommandTick=-1;
 private routeRetry=new Map<string,number>();private acquisitionRetry=new Map<string,number>();
 dash:{kind:DashKind;direction:Vec2;remaining:number}|null=null;dashReadyAt=0;
 private facing:Vec2={x:0,y:-1};
 dashDirection(frame:PilotControlFrame):Vec2{
  const aim={x:frame.aim.x-this.position.x,y:frame.aim.y-this.position.y};
  if(finitePoint(aim)&&Math.hypot(aim.x,aim.y)>.001){const n=Math.hypot(aim.x,aim.y);this.facing={x:aim.x/n,y:aim.y/n};}
  return Math.hypot(frame.move.x,frame.move.y)>.001?{x:frame.move.x,y:-frame.move.y}:{...this.facing};
 }
 intent(payload:ActionPayload,source:ActionIntent['source']='local-button'):ActionIntent{return {runId:this.runId,id:++this.intentSequence,tick:this.tick,source,payload};}
 get boosterState(){return this.dash?this.dash.kind+' dash':this.tick<this.dashReadyAt?'Cooldown '+((this.dashReadyAt-this.tick)/60).toFixed(1)+'s':'Ready / Shift short / Q long';}
 cancelDash(){if(this.dash){this.dash=null;this.events.add(this.tick,'Booster','Cancelled','Explicit pause / lifecycle boundary');}}
 setDirectAutofire(){this.directAutofireSuppressed=false;}
 private validIntent(value:ActionIntent){
  if(!value||Object.keys(value).sort().join(',')!=='id,payload,runId,source,tick'||value.runId!==this.runId||!Number.isSafeInteger(value.id)||value.id<1||this.seenIntents.has(value.id)||this.seenIntents.size>=4096||!Number.isSafeInteger(value.tick)||value.tick<0||value.tick>this.tick||this.tick-value.tick>12||!['local-hand','local-keyboard','local-button'].includes(value.source))return false;
  const p=value.payload;if(!p||typeof p!=='object')return false;
  if(p.type==='DRONE_POLICY')return Object.keys(p).sort().join(',')==='enabled,mode,type'&&typeof p.enabled==='boolean'&&['A','B'].includes(p.mode);
  if(p.type==='AUTONOMY')return Object.keys(p).sort().join(',')==='enabled,fire,type'&&typeof p.enabled==='boolean'&&typeof p.fire==='boolean';
  return p.type==='DASH'&&Object.keys(p).sort().join(',')==='direction,kind,type'&&['short','long'].includes(p.kind)&&!!p.direction&&Object.keys(p.direction).sort().join(',')==='x,y'&&finitePoint(p.direction)&&Math.hypot(p.direction.x,p.direction.y)>.0001;
 }
 private applyIntents(values:readonly ActionIntent[]){
  const ordered=values.slice(0,8).sort((a,b)=>Number(b?.payload?.type==='DASH'&&b.payload.kind==='short')-Number(a?.payload?.type==='DASH'&&a.payload.kind==='short'));
  for(const value of ordered){
   if(!this.validIntent(value)){this.events.add(this.tick,'Action','Rejected','Invalid, stale or duplicate local intent');continue;}
   this.seenIntents.add(value.id);const p=value.payload;
   if(p.type==='DASH'){
    if(this.dash||this.tick<this.dashReadyAt){this.events.add(this.tick,'Booster','Rejected','Shared cooldown; no queue');continue;}
    const magnitude=Math.hypot(p.direction.x,p.direction.y);this.dash={kind:p.kind,direction:{x:p.direction.x/magnitude,y:p.direction.y/magnitude},remaining:p.kind==='short'?12:18};this.dashReadyAt=this.tick+60;
    this.events.add(this.tick,'Booster','Started',p.kind+' / direction locked / no invulnerability');
   }else if(p.type==='AUTONOMY'){
    // Pilot-only grant (intents never come from agent code). Same guards as Fire at Will.
    if(this.mode==='training'||this.manualCommandTick===this.tick){this.events.add(this.tick,'Autonomy','Rejected',this.mode==='training'?'Unavailable in guided manual practice':'Accepted manual order takes precedence');continue;}
    if(p.enabled&&this.fireAtWill){this.fireAtWill=false;this.directAutofireSuppressed=true;this.events.add(this.tick,'Fire at will','Disabled','Supervisor autonomy enabled');}
    this.setAutonomy(p.enabled,p.enabled&&p.fire,p.enabled?(p.fire?'Agent assignments may move and fire':'Agent assignments may move; fire stays manual'):'Pilot disabled autonomy');
   }else{
    if(this.mode==='training'||this.manualCommandTick===this.tick){this.events.add(this.tick,'Fire at will','Rejected',this.mode==='training'?'Unavailable in guided manual practice':'Accepted manual order takes precedence');continue;}
    const changed=p.mode!==this.preferredPolicy,was=this.fireAtWill;this.preferredPolicy=p.mode;this.fireAtWill=p.enabled;this.controlEpoch++;
    // OFF revokes every automatic fire source, including Settings applied while FAW was ON.
    this.directAutofireSuppressed=true;
    if(p.enabled){this.directAutofireSuppressed=true;if(this.autonomy.enabled)this.setAutonomy(false,false,'Fire at Will enabled');if(!was||changed)for(const f of this.funnels)this.assignUnit(f,{type:'RECALL'},'auto',++this.automaticRevision);}
    this.events.add(this.tick,'Fire at will',p.enabled?'Enabled':'Disabled',p.enabled?'Policy '+p.mode:'Orders retained; automatic fire stopped');
   }
  }
 }
 private assignUnit(f:Funnel,order:Order,origin:'manual'|'auto',assignment:number,autonomous=false){f.order={...order};f.origin=origin;f.assignment=assignment;f.autonomous=autonomous;f.revision=-1;f.blocked=false;this.routeRetry.delete(f.id);this.acquisitionRetry.delete(f.id);}
 /** Pilot-granted supervisor autonomy. OFF by default and in every new round. */
 readonly autonomy={enabled:false,fire:false};
 /** Increments on every pilot control change (pilot commands, Recall, autonomy / Fire at Will toggles). Agent decisions based on an older epoch are stale. */
 controlEpoch=0;
 private setAutonomy(enabled:boolean,fire:boolean,why:string){
  const changed=this.autonomy.enabled!==enabled||this.autonomy.fire!==fire;
  this.autonomy.enabled=enabled;this.autonomy.fire=fire;this.controlEpoch++;
  if(changed)this.events.add(this.tick,'Autonomy',enabled?'Enabled':'Disabled',why);
 }
 deployments=0;recalls=0;padisarahHits=0;trainingStep=0;
 lastHit:{id:number;tick:number;target:TargetId;team:'pilot'|'funnel';shooter?:string;assignmentOrigin?:'manual'|'auto';assignment?:number;assignedTarget?:TargetId}|null=null;
 lastImpact:{tick:number;position:Vec2;team:Projectile['team']}|null=null;
 private seen=new Set<string>();private shotId=0;private fireCooldown=0;private recalledAtTick=-1;private hitId=0;private trainingAssignment=0;
 /** Per-unit Recalls accepted (the group Recall keeps counting in `recalls`). */
 unitRecalls=0;
 private unitRecalledAt=new Map<string,number>();
 /** Tick of the last pilot-input order per unit: agent orders cannot override it within the same tick. */
 private pilotOrderedAt=new Map<string,number>();
 /** Bounded, newest-first record of every command outcome, for task tracking and read-only agent views. */
 readonly commandLog:CommandRecord[]=[];
 private unitsFor(group:unknown){return group==='funnels'?this.funnels:this.funnels.filter(f=>f.id===group);}
 private record(value:unknown,outcome:'accepted'|'rejected',reason?:string,units:string[]=[],assignment?:number){
  const c=(value&&typeof value==='object'&&!Array.isArray(value)?value:{}) as Record<string,unknown>,text=(x:unknown)=>typeof x==='string'?x.slice(0,64):null;
  const p=c.payload as {type?:unknown;targetId?:unknown;assignments?:unknown}|null|undefined;
  const order:Order|null=!p||typeof p!=='object'?null:p.type==='RECALL'?{type:'RECALL'}:p.type==='INTERCEPT'&&targetIds.includes(p.targetId as TargetId)?{type:'INTERCEPT',targetId:p.targetId as TargetId}:null;
  const squad=p&&typeof p==='object'&&p.type==='SQUAD'&&Array.isArray(p.assignments)?p.assignments.slice(0,16).flatMap(a=>a&&typeof a==='object'&&typeof a.unit==='string'&&targetIds.includes(a.targetId)?[{unit:a.unit.slice(0,8),targetId:a.targetId as TargetId}]:[]):undefined;
  this.commandLog.unshift({commandId:text(c.commandId),tick:this.tick,group:text(c.group),provenance:text(c.provenance),order,squad,outcome,reason,units,assignment});
  if(this.commandLog.length>64)this.commandLog.length=64;
 }
 constructor(public readonly runId='run-1',public readonly mode:'combat'|'training'='combat',unitCount=2){
  if(!Number.isSafeInteger(unitCount)||unitCount<1||unitCount>16)throw new Error('Invalid fixture unit count');
  this.funnels=Array.from({length:unitCount},(_,i)=>{const x=(i-(unitCount-1)/2)*3.6;return {id:'U'+(i+1),order:{type:'RECALL'},origin:'manual',assignment:0,autonomous:false,status:'Following',position:{x,y:11},destination:{x,y:11},requested:{x,y:11},cooldown:i*12,path:[],waypoint:0,blocked:false,revision:-1};});
  if(mode==='training')this.turrets.forEach(t=>t.armed=false);
 }
 get groupState(){
  const targets=this.funnels.map(f=>f.order.type==='INTERCEPT'?f.order.targetId:null),same=targets.every(t=>t===targets[0]);
  if(!same)return this.funnels.map(f=>f.id+': '+(f.order.type==='INTERCEPT'?f.order.targetId:'Following')+(f.blocked?' (Blocked)':'')).join(' / ');
  if(this.funnels.some(f=>f.blocked))return targets[0]?'Blocked - assigned '+targets[0]:'Blocked - return route unavailable';
  const arrived=this.funnels.every(f=>length(f.position,f.destination)<.15);
  return targets[0]?(arrived?'Assigned ':'Deploying to ')+targets[0]:arrived?'Following':'Returning';
 }
 get results(){return {turretsCleared:this.turrets.filter(t=>t.health<=0).length,deployments:this.deployments,recalls:this.recalls,padisarahHits:this.padisarahHits};}
 get trainingInstruction(){return [
  '1 / 5 - Aim at T1 and use Deploy / redirect.',
  '2 / 5 - Hold Padisarah fire until a real unit projectile hits T1. Pilot hits do not count.',
  '3 / 5 - Open the command hand to rearm, aim at T2 and use Deploy / redirect.',
  '4 / 5 - Open the command hand to rearm and Recall (or press R).',
  '5 / 5 - Let both units reach their resolved follow positions.',
  'Practice complete - deployment, a real unit hit, redirect and return confirmed.'
 ][this.trainingStep];}
 envelope(payload:Order,provenance:CommandEnvelope['provenance'],commandId:string,group:CommandGroup='funnels'):CommandEnvelope{return {schemaId:'CommandEnvelope.v1',version:1,commandId,runId:this.runId,issuedAtTick:this.tick,expiresAtTick:this.tick+12,group,provenance,payload};}
 private validate(value:unknown):string|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return 'Invalid command';
  const c=value as CommandEnvelope,keys=Object.keys(c).sort().join(',');
  if(keys!==['schemaId','version','commandId','runId','issuedAtTick','expiresAtTick','group','provenance','payload'].sort().join(','))return 'Invalid envelope fields';
  if(c.schemaId!=='CommandEnvelope.v1'||c.version!==1||(c.group!=='funnels'&&!this.funnels.some(f=>f.id===c.group)))return 'Unsupported envelope';
  if(typeof c.commandId!=='string'||!/^cmd-[0-9]{1,9}$/.test(c.commandId)||c.runId!==this.runId)return 'Invalid command identity';
  if(this.seen.has(c.commandId)||this.seen.size>=4096)return 'Duplicate command or session budget reached';
  if(!Number.isSafeInteger(c.issuedAtTick)||!Number.isSafeInteger(c.expiresAtTick)||c.issuedAtTick<0||c.expiresAtTick<0||c.issuedAtTick>this.tick||c.expiresAtTick<this.tick||c.expiresAtTick-c.issuedAtTick<0||c.expiresAtTick-c.issuedAtTick>12)return 'Expired or invalid timing';
  const p=c.payload as Order|SquadOrder;if(!p||typeof p!=='object'||Array.isArray(p))return 'Invalid payload';
  if(c.group!=='funnels'&&this.mode==='training')return 'Per-unit orders unavailable in guided practice';
  const agent=c.provenance==='local-approved-proposal'||c.provenance==='local-autonomous';
  if(agent&&this.mode==='training')return 'Agent orders unavailable in guided practice';
  if(c.provenance==='local-autonomous'&&!this.autonomy.enabled)return 'Autonomy disabled';
  const affected=p.type==='SQUAD'&&Array.isArray(p.assignments)?p.assignments.map(a=>a?.unit):this.unitsFor(c.group).map(f=>f.id);
  const pilotHeld=agent?affected.find(u=>this.pilotOrderedAt.get(u)===this.tick):undefined;
  if(pilotHeld)return this.recalledAtTick===this.tick||this.unitRecalledAt.get(pilotHeld)===this.tick?'Recall takes precedence':'Pilot order takes precedence';
  // The group (emergency) Recall stays pilot-input only; a per-unit Recall may also come from an agent.
  if(p.type==='RECALL')return Object.keys(p).length===1&&(c.provenance==='local-keyboard-recall'||c.provenance==='local-hand-recall'||c.provenance==='local-voice-recall'||(c.group!=='funnels'&&agent))?null:'Invalid recall authority';
  if(p.type==='SQUAD'){
   // Atomic plan: validated as a whole before anything is assigned.
   if(c.group!=='funnels'||!agent||Object.keys(p).sort().join(',')!=='assignments,type'||!Array.isArray(p.assignments)||p.assignments.length<1||p.assignments.length>this.funnels.length)return 'Invalid squad plan';
   const units=new Set<string>();
   for(const a of p.assignments){
    if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).sort().join(',')!=='targetId,unit'||!this.funnels.some(f=>f.id===a.unit)||units.has(a.unit)||!targetIds.includes(a.targetId))return 'Invalid squad plan';
    units.add(a.unit);
   }
   if(this.recalledAtTick===this.tick||p.assignments.some(a=>this.unitRecalledAt.get(a.unit)===this.tick))return 'Recall takes precedence';
   const gone=p.assignments.find(a=>!this.turrets.some(t=>t.id===a.targetId&&t.health>0));
   return gone?'Target no longer available':null;
  }
  if(p.type!=='INTERCEPT'||Object.keys(p).sort().join(',')!=='targetId,type'||(c.provenance!=='local-hand-commit'&&!agent)||!targetIds.includes(p.targetId))return 'Invalid intercept authority or target';
  // Autonomous agents address single units or a squad plan, never the whole group directly.
  if(c.provenance==='local-autonomous'&&c.group==='funnels')return 'Invalid intercept authority or target';
  if(this.recalledAtTick===this.tick)return 'Recall takes precedence';
  if(this.unitsFor(c.group).some(f=>this.unitRecalledAt.get(f.id)===this.tick))return 'Recall takes precedence';
  if(!this.turrets.some(t=>t.id===p.targetId&&t.health>0))return 'Target no longer available';return null;
 }
 accept(value:unknown){
  const failure=this.validate(value);if(failure){this.rejected++;this.message=`Rejected: ${failure}`;this.events.add(this.tick,'Command','Rejected',failure);this.record(value,'rejected',failure);return false;}
  const c=value as CommandEnvelope;this.seen.add(c.commandId);this.accepted++;
  const pilot=(pilotProvenances as readonly string[]).includes(c.provenance),autonomous=c.provenance==='local-autonomous';
  // Autonomous agent orders never block same-tick pilot toggles; pilot orders always take control back.
  if(!autonomous)this.manualCommandTick=this.tick;
  if(pilot){this.controlEpoch++;if(this.autonomy.enabled)this.setAutonomy(false,false,c.payload.type==='RECALL'&&c.group==='funnels'?'Emergency Recall':'Pilot took manual control');}
  const p=c.payload,squad=p.type==='SQUAD',perUnit=c.group!=='funnels'&&!squad;
  const plan:[Funnel,Order][]=p.type==='SQUAD'?p.assignments.map(a=>[this.funnels.find(f=>f.id===a.unit)!,{type:'INTERCEPT',targetId:a.targetId}]):this.unitsFor(c.group).map(f=>[f,p]);
  if(pilot)for(const [f] of plan)this.pilotOrderedAt.set(f.id,this.tick);
  if(this.fireAtWill){this.fireAtWill=false;this.directAutofireSuppressed=true;this.manualOverrideTick=this.tick;this.fireInputs(this.pilotFire,false);this.events.add(this.tick,'Fire at will','Disabled',squad?'Accepted squad order':perUnit?'Accepted manual unit order':'Accepted manual group order');}
  for(const [f,order] of plan)this.assignUnit(f,order,'manual',this.accepted,autonomous);
  const tag=autonomous?' (autonomous)':'';
  if(p.type==='SQUAD'){this.deployments++;this.message=`Squad assignment accepted: ${p.assignments.map(a=>a.unit+'→'+a.targetId).join(', ')}${tag}`;}
  else if(p.type==='RECALL'){
   // Only a pilot-input unit Recall outranks same-tick orders; an agent's unit Recall never blocks the pilot.
   if(perUnit){this.unitRecalls++;if(pilot)this.unitRecalledAt.set(c.group,this.tick);this.message=`${c.group} recall accepted - returning to follow position${tag}`;}
   else{this.recalls++;this.recalledAtTick=this.tick;this.message='Recall accepted - returning to follow positions';}
  }
  else{this.deployments++;this.message=perUnit?`${c.group} assignment accepted: ${p.targetId}${tag}`:`Assignment accepted: ${p.targetId}`;}
  this.events.add(this.tick,p.type==='SQUAD'?'Squad deploy':p.type==='RECALL'?(perUnit?'Unit recall':'Recall'):(perUnit?'Unit deploy':'Deploy / redirect'),'Accepted',c.provenance==='local-voice-recall'?`${this.message} · Voice`:this.message,p.type==='INTERCEPT'?p.targetId:null);
  this.record(value,'accepted',undefined,plan.map(([f])=>f.id),this.accepted);
  if(this.mode==='training'&&!squad){
   if(this.trainingStep===0&&c.payload.type==='INTERCEPT'&&c.payload.targetId==='T1'){this.trainingStep=1;this.trainingAssignment=this.accepted;}
   else if(this.trainingStep===1){if(c.payload.type==='INTERCEPT'&&c.payload.targetId==='T1')this.trainingAssignment=this.accepted;else this.trainingStep=0;}
   else if(this.trainingStep===2&&c.payload.type==='INTERCEPT'&&c.payload.targetId==='T2')this.trainingStep=3;
   else if(this.trainingStep===3&&c.payload.type==='RECALL')this.trainingStep=4;
   else if(this.trainingStep===4&&c.payload.type==='INTERCEPT')this.trainingStep=3;
  }
  this.planUnits();return true;
 }
 commands(values:unknown[]){
  // The group Recall is absolute: it wins the whole batch, whatever the queue order.
  const recall=values.find(v=>!!v&&typeof v==='object'&&(v as CommandEnvelope).payload?.type==='RECALL'&&(v as CommandEnvelope).group==='funnels'&&!this.validate(v));
  if(recall){this.accept(recall);for(const other of values.slice(0,8))if(other!==recall){this.rejected++;this.events.add(this.tick,'Command','Rejected','Recall takes precedence');this.record(other,'rejected','Recall takes precedence');}return;}
  // Same-tick order: per-unit Recalls, then pilot input, then approved proposals, then autonomous agent orders.
  // A pilot order switches autonomy off, so a competing autonomous order in the same tick is rejected.
  const rank=(v:unknown)=>{const c=(v&&typeof v==='object'?v:{}) as Partial<CommandEnvelope>;
   return c.provenance==='local-approved-proposal'?2:c.provenance==='local-autonomous'?3:c.payload?.type==='RECALL'&&c.group!=='funnels'?0:1;};
  const batch=values.slice(0,8).map((v,i)=>({v,i,r:rank(v)})).sort((a,b)=>a.r-b.r||a.i-b.i);
  for(const {v} of batch)this.accept(v);
 }
 private planUnits(){this.funnels.forEach((f,i)=>this.planUnit(f,i));}
 private planUnit(f:Funnel,index:number){
  if(f.blocked&&f.revision===f.assignment&&this.tick<(this.routeRetry.get(f.id)??0))return;
  const target=f.order.type==='INTERCEPT'?this.turrets.find(t=>t.id===(f.order as {targetId:TargetId}).targetId&&t.health>0):undefined;
  const desired=target?{x:target.position.x+(index-(this.funnels.length-1)/2)*5,y:target.position.y+3}:{x:this.position.x+(index-(this.funnels.length-1)/2)*3.6,y:this.position.y+1};
  const tolerance=target?.patrol.length?.30:.05;
  const routeValid=!f.path[f.waypoint]||clearLine(f.position,f.path[f.waypoint],.55);
  if(f.revision===f.assignment&&!f.blocked&&length(desired,f.requested)<tolerance&&routeValid&&(!target||f.blocked||clearLine(f.destination,target.position,.17)))return;
  f.revision=f.assignment;f.requested={...desired};f.path=[];f.waypoint=0;f.blocked=true;
  const candidates:Vec2[]=[];
  if(target){candidates.push(desired);for(let k=0;k<8;k++){const angle=(k+index*8/this.funnels.length)*Math.PI/4;candidates.push({x:target.position.x+Math.sin(angle)*3.9,y:target.position.y+Math.cos(angle)*3.9});}}
  else{const resolved=freePoint(desired);if(resolved)candidates.push(resolved);}
  for(const goal of candidates){
   if(Math.abs(goal.x)>arenaBounds.unitLimit||Math.abs(goal.y)>arenaBounds.unitLimit||(target&&!clearLine(goal,target.position,.17)))continue;
   const path=route(f.position,goal);if(!path)continue;
   f.destination={...goal};f.path=path;f.blocked=false;this.routeRetry.delete(f.id);return;
  }
  this.routeRetry.set(f.id,this.tick+6);
 }
 private acquireAutomatic(){
  if(!this.fireAtWill)return;
  const candidates=(p:Vec2)=>this.turrets.filter(t=>t.health>0).sort((a,b)=>length(p,a.position)-length(p,b.position)||a.id.localeCompare(b.id));
  const reachable=(f:Funnel,index:number,t:Turret)=>{const trial:Funnel={...f,order:{type:'INTERCEPT',targetId:t.id},revision:-1,path:[],requested:{...f.requested}};this.planUnit(trial,index);return !trial.blocked;};
  const waiting=this.funnels.filter(f=>f.order.type!=='INTERCEPT'||!this.turrets.some(t=>f.order.type==='INTERCEPT'&&t.id===f.order.targetId&&t.health>0));
  for(const f of waiting){if(this.tick<(this.acquisitionRetry.get(f.id)??0))continue;const index=this.funnels.indexOf(f),reference=this.preferredPolicy==='A'?this.position:f.position;
   const target=candidates(reference).find(t=>this.preferredPolicy==='A'?this.funnels.every((unit,i)=>reachable(unit,i,t)):reachable(f,index,t));
   if(target){this.assignUnit(f,{type:'INTERCEPT',targetId:target.id},'auto',++this.automaticRevision);this.events.add(this.tick,'Auto assignment','Changed',f.id+' / policy '+this.preferredPolicy,target.id);}
   else{this.assignUnit(f,{type:'RECALL'},'auto',f.assignment);this.acquisitionRetry.set(f.id,this.tick+6);if(f.status!=='Waiting: no reachable eligible target')this.events.add(this.tick,'Auto assignment','Waiting',f.id+' / no reachable eligible target');f.status='Waiting: no reachable eligible target';}
  }
 }
 private shoot(from:Vec2,to:Vec2,team:Projectile['team'],speed:number,unit?:Funnel){if(this.projectiles.length>=128)return;const d=direction(from,to);this.projectiles.push({id:++this.shotId,position:{...from},velocity:{x:d.x*speed,y:d.y*speed},team,life:240,assignment:unit?.assignment??this.accepted,shooter:unit?.id,assignmentOrigin:unit?.origin,assignedTarget:unit?.order.type==='INTERCEPT'?unit.order.targetId:undefined});}
 step(frame:PilotControlFrame,commands:unknown[]=[],autofire=false,intents:ActionIntent[]=[]){
  if(this.outcome!=='playing')return;
  if(!finitePoint(frame.move)||!finitePoint(frame.aim)||typeof frame.fire!=='boolean'){frame=neutralFrame();autofire=false;}
  this.dashDirection(frame);
  this.applyIntents(intents.filter(intent=>intent?.payload?.type==='DASH'));
  this.fireInputs(frame.fire,this.padisarahFire);this.padisarahFiring=false;
  for(const t of this.turrets)if(t.health>0&&t.patrol.length){const goal=t.patrol[t.waypoint],d=length(t.position,goal),v=direction(t.position,goal),amount=Math.min(.035,d);t.position={x:t.position.x+v.x*amount,y:t.position.y+v.y*amount};if(d<=.035)t.waypoint=(t.waypoint+1)%t.patrol.length;}
  const move={x:clamp(frame.move.x),y:clamp(frame.move.y)},scale=Math.max(1,Math.hypot(move.x,move.y));
  const delta=this.dash?{x:this.dash.direction.x/3,y:this.dash.direction.y/3}:{x:move.x/scale*.13,y:-move.y/scale*.13};
  const movement=slidePath(this.position,delta);this.position=movement.position;
  if(this.dash&&--this.dash.remaining===0){this.dash=null;this.events.add(this.tick,'Booster','Finished','Pulse complete; blocked travel is not refunded');}
  if(this.fireCooldown>0)this.fireCooldown--;
  if(frame.fire&&this.fireCooldown===0){this.shoot(this.position,frame.aim,'pilot',.65);this.fireCooldown=10;}
  for(const shot of this.projectiles){
   const start=shot.position,end={x:start.x+shot.velocity.x,y:start.y+shot.velocity.y};
   const wall=firstBarrier(start,end,shot.team==='enemy'?.2:shot.team==='pilot'?.12:.17);
   let hitTime=wall?.t??Infinity,target:Turret|null=null,mech=false;
   if(shot.team==='enemy'){const t=movingImpact(start,end,movement.segments,.85);if(t!==null&&t<hitTime){hitTime=t;mech=true;}}
   else for(const turret of this.turrets)if(turret.health>0){const t=sweepCircle(start,end,turret.position,1.2);if(t!==null&&t<hitTime){hitTime=t;target=turret;}}
   if(hitTime!==Infinity){
    shot.position={x:start.x+(end.x-start.x)*hitTime,y:start.y+(end.y-start.y)*hitTime};shot.life=0;
    this.lastImpact={tick:this.tick,position:{...shot.position},team:shot.team};
    if(mech)this.health=Math.max(0,this.health-10);
    if(target){
     if(this.mode==='combat')target.health=Math.max(0,target.health-(shot.team==='pilot'?20:10));
     const team=shot.team as 'pilot'|'funnel';this.lastHit={id:++this.hitId,tick:this.tick,target:target.id,team,shooter:shot.shooter,assignmentOrigin:shot.assignmentOrigin,assignment:shot.assignment,assignedTarget:shot.assignedTarget};
     if(team==='funnel'){this.padisarahHits++;if(this.mode==='training'&&this.trainingStep===1&&target.id==='T1'&&shot.assignment===this.trainingAssignment&&shot.assignmentOrigin==='manual'&&!!shot.shooter&&shot.assignedTarget==='T1')this.trainingStep=2;}
    }
   }else shot.position=end;shot.life--;
  }
  this.projectiles=this.projectiles.filter(s=>s.life>0&&Math.abs(s.position.x)<arenaBounds.projectileLimit&&Math.abs(s.position.y)<arenaBounds.projectileLimit);
  this.commands(commands);this.applyIntents(intents.filter(intent=>intent?.payload?.type!=='DASH'));
  for(const f of this.funnels)if(f.order.type==='INTERCEPT'&&!this.turrets.some(t=>f.order.type==='INTERCEPT'&&t.id===f.order.targetId&&t.health>0)){
   this.assignUnit(f,{type:'RECALL'},this.fireAtWill?'auto':'manual',f.assignment);this.message='Assigned target cleared - '+(this.fireAtWill?'automatic reselection':'returning, no automatic retarget');this.events.add(this.tick,'Assignment','Changed',f.id+' / '+this.message);
  }
  this.acquireAutomatic();
  this.fireInputs(frame.fire,this.manualOverrideTick!==this.tick&&(frame.padisarahFire===true||this.fireAtWill||(autofire&&!this.directAutofireSuppressed)));
  this.funnels.forEach((f,i)=>{
   this.planUnit(f,i);
   const waypoint=f.path[f.waypoint];
   if(!f.blocked&&waypoint){
    const d=length(f.position,waypoint),v=direction(f.position,waypoint),amount=Math.min(.19,d);
    f.position={x:f.position.x+v.x*amount,y:f.position.y+v.y*amount};if(d<=.19)f.waypoint++;
   }
   f.cooldown--;
   const status=this.fireAtWill&&f.order.type==='RECALL'?'Waiting: no reachable eligible target':f.blocked?'Blocked: route / firing position':length(f.position,f.destination)>=.15?'Moving':f.order.type==='INTERCEPT'?'At firing position':'Following';
   if(status!==f.status&&(status.startsWith('Blocked')||f.status.startsWith('Blocked')))this.events.add(this.tick,'Unit route',status,f.id);f.status=status;
   const target=f.order.type==='INTERCEPT'?this.turrets.find(t=>t.id===(f.order as {targetId:TargetId}).targetId&&t.health>0):undefined;
   // Drones fire with pilot permission (Padisarah fire / Fire at Will / autofire), or on their own
   // autonomous assignment while the pilot's autonomy grant includes fire.
   if((this.padisarahFire||(this.autonomy.fire&&f.autonomous))&&target&&!f.blocked&&length(f.position,f.destination)<.15&&clearLine(f.position,target.position,.17)&&f.cooldown<=0&&this.projectiles.length<128){this.shoot(f.position,target.position,'funnel',.4,f);f.cooldown=24;this.padisarahFiring=true;}
  });
  if(this.mode==='training'&&this.trainingStep===4&&this.groupState==='Following')this.trainingStep=5;
  if(this.mode==='combat')for(const turret of this.turrets)if(turret.armed&&turret.health>0&&--turret.cooldown<=0){this.shoot(turret.position,this.position,'enemy',.105);turret.cooldown=140;}
  this.tick++;if(this.health<=0){this.outcome='lost';this.message='Mech disabled';}else if(this.turrets.every(t=>t.health<=0)){this.outcome='won';this.message='Arena clear';}
 }
}
export class FixedClock {
 private previous:number|null=null;private accumulator=0;
 reset(){this.previous=null;this.accumulator=0;}
 advance(now:number,paused:boolean,step:()=>void){
  if(this.previous===null){this.previous=now;return;}
  const elapsed=now-this.previous;this.previous=now;
  if(paused||elapsed<0||elapsed>200){this.accumulator=0;return;}
  this.accumulator+=elapsed;let steps=0;while(this.accumulator>=1000/60&&steps++<8){step();this.accumulator-=1000/60;}
 }
}
