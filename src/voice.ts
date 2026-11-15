import type {ActionPayload,DronePolicy,Order,TargetId} from './contracts';

/**
 * Voice control for the Padisarah units: an isolated module with no game-loop, DOM, HUD or microphone code.
 *
 * Pipeline: Transcriber (text) -> parseVoiceCommand (VoiceIntent) -> toVoiceProposal (existing Order / policy payload).
 *
 * Voice only PROPOSES. Turning a proposal into a CommandEnvelope or ActionIntent, stamping it against the current
 * tick and sending it to the simulation is shared wiring owned by the integrator (main.ts / simulation.ts). The
 * simulation stays the sole authority, so Recall precedence, expiry and the Fire at Will hand-off apply unchanged.
 */

/** Closed set of things a voice command may ask for. Every kind maps onto an order the game already has. */
export type VoiceIntent=
 | {kind:'recall'}
 | {kind:'deploy';targetId:TargetId}
 | {kind:'fireAtWill';enabled:boolean;mode?:DronePolicy};

/** One finished utterance from any speech-to-text backend (or typed synthetic input). */
export type Transcript={text:string;confidence:number;at:number};

/**
 * A speech-to-text backend. TypedTranscriber stands in for speech during Synthetic Rehearsal. A microphone backend
 * (e.g. Silero VAD + Moonshine or Vosk, served locally) can implement the same interface later; the page's
 * Permissions-Policy sets `microphone=()`, so that is a boundary change for the team to approve first.
 */
export interface Transcriber{
 readonly name:string;
 start(onTranscript:(t:Transcript)=>void):void;
 stop():void;
}

export class TypedTranscriber implements Transcriber{
 readonly name='typed';
 private listener:((t:Transcript)=>void)|null=null;
 start(onTranscript:(t:Transcript)=>void){this.listener=onTranscript;}
 stop(){this.listener=null;}
 submit(text:string,at:number){if(this.listener&&text.trim())this.listener({text,confidence:1,at});}
}

/**
 * Turn one transcript into a voice intent, or null when it is not a confident command.
 *
 * TODO(you): implement this. Examples it should probably handle:
 *   "recall" / "come back" / "return"         -> {kind:'recall'}
 *   "deploy T3" / "attack tee three" / "go 3"  -> {kind:'deploy',targetId:'T3'}
 *   "fire at will" / "fire at will off"        -> {kind:'fireAtWill',enabled:true|false}
 *   "fire at will policy B"                    -> {kind:'fireAtWill',enabled:true,mode:'B'}
 *   "uh what"                                  -> null
 *
 * Decisions that are yours to make:
 *  - How loosely to match. Speech-to-text mishears ("tea three", "T free"); fuzzy matching helps but a wrong
 *    target in combat is worse than doing nothing.
 *  - Mixed phrases like "recall and deploy T2". The simulation already lets a same-tick Recall win, so you can
 *    choose to return the recall, the deploy, or null.
 *  - Whether low `confidence` transcripts should be dropped here or upstream.
 */
export function parseVoiceCommand(text:string):VoiceIntent|null{
 void text;
 return null;
}

/**
 * What the integrator receives. `order` becomes a CommandEnvelope; `policy` becomes a DRONE_POLICY ActionIntent.
 * Neither carries a tick: envelopes expire 12 ticks (200 ms) after issue, far shorter than speech latency, so the
 * integrator must stamp them when queuing, never when the speaker started talking.
 */
export type VoiceProposal=
 | {kind:'order';order:Order}
 | {kind:'policy';payload:Extract<ActionPayload,{type:'DRONE_POLICY'}>};

/** `currentPolicy` fills in the mode when the speaker did not name one. */
export function toVoiceProposal(intent:VoiceIntent,currentPolicy:DronePolicy):VoiceProposal{
 switch(intent.kind){
  case 'recall':return {kind:'order',order:{type:'RECALL'}};
  case 'deploy':return {kind:'order',order:{type:'INTERCEPT',targetId:intent.targetId}};
  case 'fireAtWill':return {kind:'policy',payload:{type:'DRONE_POLICY',enabled:intent.enabled,mode:intent.mode??currentPolicy}};
 }
}

/** Human-readable echo for a voice or HUD panel. */
export function describeVoiceIntent(intent:VoiceIntent){
 return intent.kind==='recall'?'Recall':intent.kind==='deploy'?`Deploy ${intent.targetId}`:`Fire at will ${intent.enabled?'on':'off'}${intent.mode?' / policy '+intent.mode:''}`;
}
