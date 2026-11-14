export type Vec2 = { x: number; y: number };
export type TargetId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';
export type Order = { type: 'INTERCEPT'; targetId: TargetId } | { type: 'RECALL' };
/** Drone ids are 'U1', 'U2', ... (validated against the live roster). */
export type UnitId = `U${number}`;
/** 'funnels' addresses every unit (the original group command); a UnitId addresses one unit. */
export type CommandGroup = 'funnels' | UnitId;
/** Atomic multi-unit intercept plan (group 'funnels' only): every entry is accepted, or none. */
export type SquadOrder = { type: 'SQUAD'; assignments: { unit: UnitId; targetId: TargetId }[] };
/** Pilot-input provenances: these always outrank agent provenances in the same tick. */
export const pilotProvenances = ['local-hand-commit', 'local-keyboard-recall', 'local-hand-recall'] as const;
export interface CommandEnvelope {
  schemaId: 'CommandEnvelope.v1'; version: 1; commandId: string; runId: string;
  issuedAtTick: number; expiresAtTick: number; group: CommandGroup;
  /**
   * 'local-approved-proposal': an agent proposal the pilot explicitly approved, queued locally.
   * 'local-autonomous': an agent action executed under the pilot's autonomy grant (only valid while autonomy is ON).
   */
  provenance: typeof pilotProvenances[number] | 'local-approved-proposal' | 'local-autonomous'; payload: Order | SquadOrder;
}
export interface PilotControlFrame { move: Vec2; aim: Vec2; fire: boolean; padisarahFire?: boolean }
export const neutralFrame = (): PilotControlFrame => ({move:{x:0,y:0},aim:{x:0,y:0},fire:false});
export const clamp = (n:number, lo=-1, hi=1) => Math.max(lo,Math.min(hi,n));
export const finitePoint = (p:Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y);
export const targetIds: TargetId[] = ['T1','T2','T3','T4','T5','T6'];
export type DashKind='short'|'long';
export type DronePolicy='A'|'B';
/** AUTONOMY is a pilot-only grant: `fire` lets autonomously assigned units fire at their own target. */
export type ActionPayload={type:'DASH';kind:DashKind;direction:Vec2}|{type:'DRONE_POLICY';enabled:boolean;mode:DronePolicy}|{type:'AUTONOMY';enabled:boolean;fire:boolean};
/** Local, closed capabilities. These do not widen CommandEnvelope.v1 authority. */
export type ActionIntent={runId:string;id:number;tick:number;source:'local-hand'|'local-keyboard'|'local-button';payload:ActionPayload};


