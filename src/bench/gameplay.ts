/**
 * Gameplay benchmark: plays scripted rounds of the real Simulation headlessly and scores them.
 *
 * The simulation is deterministic, so the same controller always produces the same round. A difference between a
 * "before" and an "after" snapshot is therefore caused by the change, not by luck. Teammates add their agent or model as
 * another Controller (see `scenarios` at the bottom) and the collector plays it alongside the baseline.
 *
 * Runs in Node via `npm run metrics`; nothing here touches the DOM, storage or network.
 */
import {Simulation} from '../simulation';
import {clearLine,route} from '../cover';
import {neutralFrame,type ActionIntent,type CommandEnvelope,type DronePolicy,type Order,type PilotControlFrame,type TargetId,type Vec2} from '../contracts';
import {AgentController} from '../agent/controller';
import {createSupervisorTools,type ToolRegistry} from '../agent/tools';

export const TICKS_PER_SECOND=60;
export const ROUND_LIMIT_SECONDS=180;
/** Deploy and Recall gestures must be held for 500 ms (COMMAND_HOLD_MS) before they reach the simulation. */
export const GESTURE_LATENCY_MS=500;

export interface RoundView {readonly sim:Simulation;readonly tick:number}
export interface Decision {
  frame:PilotControlFrame;
  /** Drone orders. Each reaches the simulation after the controller's command latency. */
  orders?:Order[];
  /** Turn Fire at Will on or off. */
  policy?:{enabled:boolean;mode:DronePolicy};
  /** Already-stamped actions for this tick, e.g. the pilot granting autonomy or the supervisor agent's drained orders. */
  intents?:ActionIntent[];
  commands?:CommandEnvelope[];
}
export interface Controller {
  name:string;
  /** How long a drone order takes from decision to arrival, e.g. a 500 ms gesture hold or speech-to-order time. */
  commandLatencyMs:number;
  decide(view:RoundView):Decision;
  /** Runs after every simulation step, e.g. so the supervisor agent can update its tasks. */
  afterStep?(sim:Simulation):void;
}

export interface RoundStats {
  outcome:'won'|'lost'|'timeout';
  seconds:number;targetsCleared:number;healthLeft:number;damageTaken:number;
  pilotShots:number;pilotHits:number;droneShots:number;droneHits:number;
  /** Hits ÷ shots for pilot and drones together, 0–100. */
  accuracy:number;
  ordersAccepted:number;ordersRejected:number;
  /** Drone orders the pilot had to give by gesture, and orders the supervisor agent gave instead. */
  pilotCommands:number;agentCommands:number;
  score:number;
}

/** Round score out of 1000: 300 for targets, 300 for speed (wins only), 200 for health kept, 200 for accuracy. */
export function roundScore(s:Pick<RoundStats,'outcome'|'seconds'|'targetsCleared'|'healthLeft'|'accuracy'>){
  const targets=300*s.targetsCleared/6;
  const speed=s.outcome==='won'?300*Math.max(0,1-s.seconds/ROUND_LIMIT_SECONDS):0;
  const health=200*s.healthLeft/100;
  const accuracy=200*s.accuracy/100;
  return Math.round(targets+speed+health+accuracy);
}

const round1=(value:number)=>Math.round(value*10)/10;

export function playRound(controller:Controller):RoundStats{
  const sim=new Simulation('bench');
  const latencyTicks=Math.round(controller.commandLatencyMs/1000*TICKS_PER_SECOND);
  const pending:{dueTick:number;order:Order}[]=[];
  const seen=new Set<number>();
  let commandId=0,pilotCommands=0,agentCommands=0,pilotShots=0,pilotHits=0,droneShots=0,droneHits=0,lastHealth=100;
  let turretHealth=sim.turrets.reduce((sum,t)=>sum+t.health,0),lastDroneHits=0;
  const limit=ROUND_LIMIT_SECONDS*TICKS_PER_SECOND;
  while(sim.outcome==='playing'&&sim.tick<limit){
    const decision=controller.decide({sim,tick:sim.tick});
    for(const order of decision.orders??[])pending.push({dueTick:sim.tick+latencyTicks,order});
    pilotCommands+=decision.orders?.length??0;agentCommands+=decision.commands?.length??0;
    // Envelopes expire 12 ticks after issue, so stamp each one when it arrives, not when it was decided.
    const due=pending.filter(p=>p.dueTick<=sim.tick);
    for(const p of due)pending.splice(pending.indexOf(p),1);
    const commands=due.map(p=>sim.envelope(p.order,p.order.type==='RECALL'?'local-keyboard-recall':'local-hand-commit',`cmd-${++commandId}`));
    const intents=[...(decision.policy?[sim.intent({type:'DRONE_POLICY',...decision.policy},'local-button')]:[]),...(decision.intents??[])];
    sim.step(decision.frame,[...commands,...(decision.commands??[])],false,intents);
    controller.afterStep?.(sim);
    // Shots: every new projectile id. Hits: drones are counted by the simulation; pilot hits come from damage (20 each).
    for(const shot of sim.projectiles)if(!seen.has(shot.id)){seen.add(shot.id);if(shot.team==='pilot')pilotShots++;else if(shot.team==='funnel')droneShots++;}
    const health=sim.turrets.reduce((sum,t)=>sum+t.health,0),dropped=turretHealth-health,newDroneHits=sim.padisarahHits-lastDroneHits;
    if(dropped>0)pilotHits+=newDroneHits===0?Math.max(1,Math.round(dropped/20)):Math.max(0,Math.round((dropped-10*newDroneHits)/20));
    droneHits+=newDroneHits;turretHealth=health;lastDroneHits=sim.padisarahHits;lastHealth=sim.health;
  }
  const shots=pilotShots+droneShots;
  const stats={
    outcome:sim.outcome==='playing'?'timeout' as const:sim.outcome,
    seconds:round1(sim.tick/TICKS_PER_SECOND),
    targetsCleared:sim.turrets.filter(t=>t.health<=0).length,
    healthLeft:lastHealth,damageTaken:100-lastHealth,
    pilotShots,pilotHits,droneShots,droneHits,
    accuracy:shots?round1((pilotHits+droneHits)/shots*100):0,
    ordersAccepted:sim.accepted,ordersRejected:sim.rejected,pilotCommands,agentCommands,
  };
  return {...stats,score:roundScore(stats)};
}

// ── Baseline controllers: how a player plays today, before any agent or model ──────────────────────────────────

const alive=(sim:Simulation)=>sim.turrets.filter(t=>t.health>0);
const distance=(a:Vec2,b:Vec2)=>Math.hypot(a.x-b.x,a.y-b.y);
const nearest=(sim:Simulation)=>alive(sim).sort((a,b)=>distance(a.position,sim.position)-distance(b.position,sim.position))[0];

/** Walks toward the nearest turret until it has a clear shot, then stands and fires at it. */
function pilotFrame(sim:Simulation):PilotControlFrame{
  const target=nearest(sim);
  if(!target)return neutralFrame();
  if(clearLine(sim.position,target.position,.12))return {move:{x:0,y:0},aim:{...target.position},fire:true};
  // Walk around cover using the game's own route finder, heading for the next waypoint.
  const path=route(sim.position,target.position,.85)??[target.position];
  const next=path.find(point=>distance(point,sim.position)>.3)??target.position;
  const dx=next.x-sim.position.x,dy=next.y-sim.position.y,n=Math.hypot(dx,dy)||1;
  // Frame y is screen-up; arena y grows toward the player, so it is flipped.
  return {move:{x:dx/n,y:-dy/n},aim:{...target.position},fire:false};
}

/** Sends both drones to the nearest turret whenever they are idle, as a player would with the Deploy gesture. */
function manualDroneOrders(sim:Simulation,state:{waitingUntil:number}):Order[]{
  const target=nearest(sim);
  if(!target||sim.order.type==='INTERCEPT'||sim.tick<state.waitingUntil)return [];
  state.waitingUntil=sim.tick+TICKS_PER_SECOND; // one deliberate gesture per second at most
  return [{type:'INTERCEPT',targetId:target.id as TargetId}];
}

/** Pilot stands still and only commands the drones, so the arena is cleared by drone orders alone. */
export function droneCommander(name:string,commandLatencyMs:number):Controller{
  const state={waitingUntil:0};
  return {name,commandLatencyMs,decide:({sim})=>({frame:{...neutralFrame(),padisarahFire:true},orders:manualDroneOrders(sim,state)})};
}

export function baselineControllers():Controller[]{
  return [
    {name:'Drones on Fire at Will',commandLatencyMs:GESTURE_LATENCY_MS,decide:({tick})=>({frame:neutralFrame(),policy:tick===0?{enabled:true,mode:'A'}:undefined})},
    droneCommander('Gesture-deployed drones only',GESTURE_LATENCY_MS),
    {name:'Pilot alone',commandLatencyMs:GESTURE_LATENCY_MS,decide:({sim})=>({frame:pilotFrame(sim)})},
    (()=>{const state={waitingUntil:0};return {name:'Pilot + gesture-deployed drones',commandLatencyMs:GESTURE_LATENCY_MS,decide:({sim}:RoundView)=>({frame:{...pilotFrame(sim),padisarahFire:true},orders:manualDroneOrders(sim,state)})};})(),
    {name:'Pilot + Fire at Will',commandLatencyMs:GESTURE_LATENCY_MS,decide:({sim,tick})=>({frame:pilotFrame(sim),policy:tick===0?{enabled:true,mode:'A'}:undefined})},
  ];
}

// ── Supervisor agent (src/agent): commands the drones only through its seven tools ───────────────────────────

/** How often the scripted supervisor re-plans, standing in for an LLM's tool-call round trip. */
export const SUPERVISOR_DECISION_MS=1000;
export interface AgentReport {toolCalls:number;succeeded:number;stale:number;invalid:number;tasksCompleted:number;tasksFailed:number}

/**
 * A deterministic stand-in for an LLM supervisor. Like a model following src/agent/README.md, it reads get_game_state,
 * then sends each idle drone at the nearest armed turret (defend_pilot), falling back to the nearest living turret
 * (assign_target). The pilot grants autonomy with fire at the start, as pressing G does. It measures what the tool layer
 * and autonomy rules allow, not the judgement of any particular model.
 */
export function supervisorAgent(name:string,withPilot:boolean,decisionMs=SUPERVISOR_DECISION_MS):Controller&{report():AgentReport}{
  const agent=new AgentController();
  let sim:Simulation|null=null,tools:ToolRegistry|null=null;
  const counts={toolCalls:0,succeeded:0,stale:0,invalid:0};
  const call=(tool:string,input:Record<string,unknown>)=>{
    const result=tools!.call(tool,input) as {ok:boolean;code?:string}&Record<string,unknown>;
    counts.toolCalls++;if(result.ok)counts.succeeded++;else if(result.code==='stale')counts.stale++;else counts.invalid++;
    return result;
  };
  const think=()=>{
    const view=call('get_game_state',{event_limit:0}) as {ok:boolean;state_token:string;state:{units:{id:string;order:string}[];turrets:{id:string;alive:boolean;distanceToMech:number;assignedUnits:string[]}[]}};
    if(!view.ok)return;
    const idle=view.state.units.filter(u=>u.order==='follow');
    for(const unit of idle){
      const defend=call('defend_pilot',{unit:unit.id,state_token:view.state_token,reason:'Nearest armed turret to the mech'});
      if(defend.ok||defend.code==='stale')continue;
      const free=view.state.turrets.filter(t=>t.alive).sort((a,b)=>a.assignedUnits.length-b.assignedUnits.length||a.distanceToMech-b.distanceToMech)[0];
      if(free)call('assign_target',{unit:unit.id,target:free.id,state_token:view.state_token,reason:`${free.id} is the nearest living turret`});
    }
  };
  const every=Math.max(1,Math.round(decisionMs/1000*TICKS_PER_SECOND));
  return {
    name,commandLatencyMs:0,
    decide:({sim:current,tick})=>{
      if(sim!==current){sim=current;tools=createSupervisorTools({getSim:()=>sim,controller:agent});}
      const intents=tick===0?[current.intent({type:'AUTONOMY',enabled:true,fire:true},'local-button')]:[];
      if(tick>0&&tick%every===0)think();
      return {frame:withPilot?pilotFrame(current):neutralFrame(),intents,commands:agent.drain(current)};
    },
    afterStep:current=>{agent.observe(current);},
    report:()=>{
      const tasks=(tools?.call('get_task_status',{include_finished:true}) as {tasks?:{status:string}[]})?.tasks??[];
      return {...counts,tasksCompleted:tasks.filter(t=>t.status==='completed').length,tasksFailed:tasks.filter(t=>t.status==='failed').length};
    },
  };
}

/** Dimension 1 for the supervisor: how its tool calls fared over the drones-only round. */
export function runSupervisorBenchmark(){
  const agent=supervisorAgent('Supervisor agent drones only',false);
  const round=playRound(agent);
  return {decisionMs:SUPERVISOR_DECISION_MS,seconds:round.seconds,outcome:round.outcome,...agent.report()};
}

/** How the supervisor's re-planning interval (a model's decision speed) changes time to clear, alone and with the pilot. */
export const AGENT_SPEEDS_MS=[100,250,500,750,1000,1500,2000];
export function agentSpeedSweep(){
  return AGENT_SPEEDS_MS.map(decisionMs=>({decisionMs,dronesOnly:playRound(supervisorAgent('sweep',false,decisionMs)).seconds,withPilot:playRound(supervisorAgent('sweep',true,decisionMs)).seconds}));
}

/**
 * Every scenario the benchmark plays. To measure your agent or model, add a controller here that makes the same kind of
 * decisions through it (for example voice orders with your measured speech-to-order latency), using a new name.
 * Keep the baseline ones unchanged so before and after stay comparable.
 */
export function scenarios():Controller[]{
  return [...baselineControllers(),supervisorAgent('Supervisor agent drones only',false),supervisorAgent('Pilot + supervisor agent',true)];
}

export function runGameplayBenchmark(){
  return scenarios().map(controller=>({scenario:controller.name,commandLatencyMs:controller.commandLatencyMs,...playRound(controller)}));
}

/** What-if: the drones-only round played with slower or faster orders. Shows what a given voice latency is worth. */
export const SWEEP_LATENCIES_MS=[0,250,500,750,1000,1500,2000,3000];
export function latencySweep(){
  return SWEEP_LATENCIES_MS.map(latencyMs=>{const r=playRound(droneCommander('sweep',latencyMs));return {latencyMs,seconds:r.seconds,score:r.score,outcome:r.outcome};});
}
