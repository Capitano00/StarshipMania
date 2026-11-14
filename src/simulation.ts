import {arenaBounds} from './arena-layout';
import {clamp,finitePoint,neutralFrame,targetIds,type ActionIntent,type ActionPayload,type DronePolicy,type DashKind,type CommandEnvelope,type Order,type PilotControlFrame,type TargetId,type Vec2} from './contracts';
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
export type Funnel={id:string;order:Order;origin:'manual'|'auto';assignment:number;status:string;position:Vec2;cooldown:number;destination:Vec2;requested:Vec2;path:Vec2[];waypoint:number;blocked:boolean;revision:number};
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
  if(!this.padisarahFire)return 'Holding fire';
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
   }else{
    if(this.mode==='training'||this.manualCommandTick===this.tick){this.events.add(this.tick,'Fire at will','Rejected',this.mode==='training'?'Unavailable in guided manual practice':'Accepted manual order takes precedence');continue;}
    const changed=p.mode!==this.preferredPolicy,was=this.fireAtWill;this.preferredPolicy=p.mode;this.fireAtWill=p.enabled;
    // OFF revokes every automatic fire source, including Settings applied while FAW was ON.
    this.directAutofireSuppressed=true;
    if(p.enabled){this.directAutofireSuppressed=true;if(!was||changed)for(const f of this.funnels)this.assignUnit(f,{type:'RECALL'},'auto',++this.automaticRevision);}
    this.events.add(this.tick,'Fire at will',p.enabled?'Enabled':'Disabled',p.enabled?'Policy '+p.mode:'Orders retained; automatic fire stopped');
   }
  }
 }
 private assignUnit(f:Funnel,order:Order,origin:'manual'|'auto',assignment:number){f.order={...order};f.origin=origin;f.assignment=assignment;f.revision=-1;f.blocked=false;this.routeRetry.delete(f.id);this.acquisitionRetry.delete(f.id);}
 deployments=0;recalls=0;padisarahHits=0;trainingStep=0;
 lastHit:{id:number;tick:number;target:TargetId;team:'pilot'|'funnel';shooter?:string;assignmentOrigin?:'manual'|'auto';assignment?:number;assignedTarget?:TargetId}|null=null;
 lastImpact:{tick:number;position:Vec2;team:Projectile['team']}|null=null;
 private seen=new Set<string>();private shotId=0;private fireCooldown=0;private recalledAtTick=-1;private hitId=0;private trainingAssignment=0;
 constructor(public readonly runId='run-1',public readonly mode:'combat'|'training'='combat',unitCount=2){
  if(!Number.isSafeInteger(unitCount)||unitCount<1||unitCount>16)throw new Error('Invalid fixture unit count');
  this.funnels=Array.from({length:unitCount},(_,i)=>{const x=(i-(unitCount-1)/2)*3.6;return {id:'U'+(i+1),order:{type:'RECALL'},origin:'manual',assignment:0,status:'Following',position:{x,y:11},destination:{x,y:11},requested:{x,y:11},cooldown:i*12,path:[],waypoint:0,blocked:false,revision:-1};});
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
 envelope(payload:Order,provenance:CommandEnvelope['provenance'],commandId:string):CommandEnvelope{return {schemaId:'CommandEnvelope.v1',version:1,commandId,runId:this.runId,issuedAtTick:this.tick,expiresAtTick:this.tick+12,group:'funnels',provenance,payload};}
 private validate(value:unknown):string|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return 'Invalid command';
  const c=value as CommandEnvelope,keys=Object.keys(c).sort().join(',');
  if(keys!==['schemaId','version','commandId','runId','issuedAtTick','expiresAtTick','group','provenance','payload'].sort().join(','))return 'Invalid envelope fields';
  if(c.schemaId!=='CommandEnvelope.v1'||c.version!==1||c.group!=='funnels')return 'Unsupported envelope';
  if(typeof c.commandId!=='string'||!/^cmd-[0-9]{1,9}$/.test(c.commandId)||c.runId!==this.runId)return 'Invalid command identity';
  if(this.seen.has(c.commandId)||this.seen.size>=4096)return 'Duplicate command or session budget reached';
  if(!Number.isSafeInteger(c.issuedAtTick)||!Number.isSafeInteger(c.expiresAtTick)||c.issuedAtTick<0||c.expiresAtTick<0||c.issuedAtTick>this.tick||c.expiresAtTick<this.tick||c.expiresAtTick-c.issuedAtTick<0||c.expiresAtTick-c.issuedAtTick>12)return 'Expired or invalid timing';
  const p=c.payload;if(!p||typeof p!=='object'||Array.isArray(p))return 'Invalid payload';
  if(p.type==='RECALL')return Object.keys(p).length===1&&(c.provenance==='local-keyboard-recall'||c.provenance==='local-hand-recall'||c.provenance==='local-voice-recall')?null:'Invalid recall authority';
  if(p.type!=='INTERCEPT'||Object.keys(p).sort().join(',')!=='targetId,type'||c.provenance!=='local-hand-commit'||!targetIds.includes(p.targetId))return 'Invalid intercept authority or target';
  if(this.recalledAtTick===this.tick)return 'Recall takes precedence';
  if(!this.turrets.some(t=>t.id===p.targetId&&t.health>0))return 'Target no longer available';return null;
 }
 accept(value:unknown){
  const failure=this.validate(value);if(failure){this.rejected++;this.message=`Rejected: ${failure}`;this.events.add(this.tick,'Command','Rejected',failure);return false;}
  const c=value as CommandEnvelope;this.seen.add(c.commandId);this.accepted++;this.manualCommandTick=this.tick;
  if(this.fireAtWill){this.fireAtWill=false;this.directAutofireSuppressed=true;this.manualOverrideTick=this.tick;this.fireInputs(this.pilotFire,false);this.events.add(this.tick,'Fire at will','Disabled','Accepted manual group order');}
  for(const f of this.funnels)this.assignUnit(f,c.payload,'manual',this.accepted);
  if(c.payload.type==='RECALL'){this.recalls++;this.recalledAtTick=this.tick;this.message='Recall accepted - returning to follow positions';}
  else{this.deployments++;this.message=`Assignment accepted: ${c.payload.targetId}`;}
  this.events.add(this.tick,c.payload.type==='RECALL'?'Recall':'Deploy / redirect','Accepted',c.provenance==='local-voice-recall'?`${this.message} · Voice`:this.message,c.payload.type==='INTERCEPT'?c.payload.targetId:null);
  if(this.mode==='training'){
   if(this.trainingStep===0&&c.payload.type==='INTERCEPT'&&c.payload.targetId==='T1'){this.trainingStep=1;this.trainingAssignment=this.accepted;}
   else if(this.trainingStep===1){if(c.payload.type==='INTERCEPT'&&c.payload.targetId==='T1')this.trainingAssignment=this.accepted;else this.trainingStep=0;}
   else if(this.trainingStep===2&&c.payload.type==='INTERCEPT'&&c.payload.targetId==='T2')this.trainingStep=3;
   else if(this.trainingStep===3&&c.payload.type==='RECALL')this.trainingStep=4;
   else if(this.trainingStep===4&&c.payload.type==='INTERCEPT')this.trainingStep=3;
  }
  this.planUnits();return true;
 }
 commands(values:unknown[]){
  const recall=values.find(v=>!!v&&typeof v==='object'&&(v as CommandEnvelope).payload?.type==='RECALL'&&!this.validate(v));
  if(recall){this.accept(recall);for(const other of values.slice(0,8))if(other!==recall){this.rejected++;this.events.add(this.tick,'Command','Rejected','Recall takes precedence');}return;}
  for(const value of values.slice(0,8))this.accept(value);
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
   if(this.padisarahFire&&target&&!f.blocked&&length(f.position,f.destination)<.15&&clearLine(f.position,target.position,.17)&&f.cooldown<=0&&this.projectiles.length<128){this.shoot(f.position,target.position,'funnel',.4,f);f.cooldown=24;this.padisarahFiring=true;}
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
