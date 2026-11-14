export type Vec2 = { x: number; y: number };
export type TargetId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';
export type Order = { type: 'INTERCEPT'; targetId: TargetId } | { type: 'RECALL' };
export interface CommandEnvelope {
  schemaId: 'CommandEnvelope.v1'; version: 1; commandId: string; runId: string;
  issuedAtTick: number; expiresAtTick: number; group: 'funnels';
  provenance: 'local-hand-commit' | 'local-keyboard-recall' | 'local-hand-recall' | 'local-voice-recall'; payload: Order;
}
export interface PilotControlFrame { move: Vec2; aim: Vec2; fire: boolean; padisarahFire?: boolean }
export const neutralFrame = (): PilotControlFrame => ({move:{x:0,y:0},aim:{x:0,y:0},fire:false});
export const clamp = (n:number, lo=-1, hi=1) => Math.max(lo,Math.min(hi,n));
export const finitePoint = (p:Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y);
export const targetIds: TargetId[] = ['T1','T2','T3','T4','T5','T6'];
export type DashKind='short'|'long';
export type DronePolicy='A'|'B';
export type ActionPayload={type:'DASH';kind:DashKind;direction:Vec2}|{type:'DRONE_POLICY';enabled:boolean;mode:DronePolicy};
/** Local, closed capabilities. These do not widen CommandEnvelope.v1 authority. */
export type ActionIntent={runId:string;id:number;tick:number;source:'local-hand'|'local-keyboard'|'local-button';payload:ActionPayload};


