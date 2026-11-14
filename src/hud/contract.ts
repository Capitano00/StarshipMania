/**
 * Stable, UI-only shapes for the StarshipMania tactical HUD.
 *
 * Gameplay, agent and voice code push data in through `hudFeed` (see feed.ts); they never
 * import HUD rendering code. Enum values match the Figma component variants
 * (DroneCard / RecommendationCard / LinkChip / EventRow) one-to-one, so a design state maps
 * directly to a `data-state` attribute.
 */
import type {TargetId} from '../contracts';

export type DroneState = 'following' | 'moving' | 'engaging' | 'returning' | 'standby' | 'blocked' | 'offline';
export type DroneAuthority = 'pilot' | 'auto' | 'agent';

export interface DroneHud {
  id: string;
  callsign: string;
  state: DroneState;
  task: {kind: 'follow' | 'intercept' | 'recall' | 'standby' | 'custom'; label: string; targetId?: TargetId};
  authority: DroneAuthority;
  /** Remaining hull of the drone's current target (0–1), from the simulation. */
  targetHull: number | null;
  /** Drone hull (0–1). Null until an agent/telemetry source provides it — rendered as "—". */
  health: number | null;
  /** Optional short explanation from an agent ("why this drone is doing this"). */
  reason?: string;
}

/** Optional telemetry a teammate can attach to a drone without touching the simulation. */
export interface DroneTelemetry { health?: number | null; reason?: string; authority?: DroneAuthority; taskLabel?: string }

export type ObjectiveState = 'idle' | 'armed' | 'assigned' | 'locked' | 'down';
export interface ObjectiveHud { id: TargetId; state: ObjectiveState; hull: number }

export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed' | 'recalled' | 'expired';
export interface SuggestionHud {
  id: string;
  droneId: string;
  /** Short imperative, e.g. "Regroup on the pilot". */
  action: string;
  /** Visible reason, e.g. "Two armed turrets cover the T4 approach". */
  reason: string;
  status: SuggestionStatus;
}

export type VoiceStatus = 'unavailable' | 'idle' | 'listening' | 'transcribing' | 'processing' | 'responding' | 'error';
export interface VoiceHud { status: VoiceStatus; partial?: string; final?: string; reply?: string; message?: string }

export type LinkState = 'offline' | 'live';

export type HudSeverity = 'info' | 'success' | 'warn' | 'critical';
export interface HudEvent { id: string; tick: number; source: 'pilot' | 'agent' | 'voice' | 'system'; title: string; detail: string; severity: HudSeverity }

/** What an autonomous drone agent reports it is doing. Matches Figma DroneTag "Phase" variants. */
export type AgentPhase = 'idle' | 'planning' | 'proposing' | 'executing' | 'completed' | 'failed' | 'recalled';
export interface DroneAgentHud {
  droneId: string;
  phase: AgentPhase;
  /** Short action text from the agent, e.g. "Intercept T4". */
  action?: string;
  /** Concise reason supplied by the agent. The HUD never generates reasoning. */
  reason?: string;
  targetId?: TargetId;
  /** performance.now() when this phase was published. */
  at: number;
}

/**
 * Provider-neutral events for voice and agent integrations: `hudFeed.publish(event)`.
 * No ElevenLabs (or other provider) types appear here.
 */
export type HudInputEvent =
  | {type: 'voice.status'; status: VoiceStatus; message?: string}
  | {type: 'voice.transcript'; text: string; final: boolean}
  | {type: 'voice.response'; text: string}
  | {type: 'agent.link'; state: LinkState}
  | {type: 'agent.phase'; droneId: string; phase: AgentPhase; action?: string; reason?: string; targetId?: TargetId}
  | {type: 'agent.suggestion'; suggestion: SuggestionHud | null}
  | {type: 'agent.clear'; droneId?: string};

/** Target highlight requested by agent state, consumed by the 3D effects layer. */
export interface AgentTargetMark { targetId: TargetId; phase: 'proposing' | 'executing'; droneId: string; since: number }
