/**
 * Provider-neutral supervisor tools for StarshipMania.
 *
 * Seven callable tools with JSON Schema inputs. Every handler is synchronous, validates its
 * input, and returns plain JSON. Action tools never touch the Simulation: they call
 * AgentController.submit(), which either creates a proposal for pilot approval (autonomy OFF)
 * or queues an autonomous order (autonomy ON). The game loop sends it on the next tick.
 *
 * Adapters at the bottom convert the registry into common LLM tool formats without importing
 * any provider SDK.
 */
import type {Simulation} from '../simulation';
import {targetIds, type TargetId} from '../contracts';
import {snapshot} from './snapshot';
import {AgentController, type AgentAction, type SubmitResult} from './controller';
import type {AgentEventKind} from './events';
import type {TaskRecord} from './tasks';

// ---------------------------------------------------------------------------------------------
// Minimal JSON Schema subset (enough for these tools; no dependency)
// ---------------------------------------------------------------------------------------------
export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  minItems?: number; maxItems?: number; maxLength?: number; minimum?: number; maximum?: number;
};

export function validate(schema: JsonSchema, value: unknown, path = 'input'): string | null {
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} must be an object`;
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (obj[key] === undefined) return `${path}.${key} is required`;
      for (const [key, v] of Object.entries(obj)) {
        const sub = schema.properties?.[key];
        if (!sub) { if (schema.additionalProperties === false) return `${path}.${key} is not allowed`; continue; }
        if (v === undefined) continue;
        const err = validate(sub, v, `${path}.${key}`); if (err) return err;
      }
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) return `${path} must be an array`;
      if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} item(s)`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} allows at most ${schema.maxItems} item(s)`;
      for (let i = 0; i < value.length; i++) { const err = schema.items ? validate(schema.items, value[i], `${path}[${i}]`) : null; if (err) return err; }
      return null;
    }
    case 'string':
      if (typeof value !== 'string') return `${path} must be a string`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} is longer than ${schema.maxLength} characters`;
      break;
    case 'integer':
      if (!Number.isSafeInteger(value)) return `${path} must be an integer`;
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a number`;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `${path} must be a boolean`;
      return null;
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) return `${path} must be one of ${schema.enum.join(', ')}`;
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) return `${path} must be ≥ ${schema.minimum}`;
  if (typeof value === 'number' && schema.maximum !== undefined && value > schema.maximum) return `${path} must be ≤ ${schema.maximum}`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Tool types
// ---------------------------------------------------------------------------------------------
export type ToolError = {ok: false; code: 'invalid_input' | 'stale' | 'invalid' | 'unavailable' | 'not_found' | 'unknown_tool'; error: string};
export type ToolResult = ({ok: true} & Record<string, unknown>) | ToolError;
export interface ToolDefinition {
  name: SupervisorToolName;
  description: string;
  input_schema: JsonSchema;
  handler: (input: Record<string, unknown>) => ToolResult;
}
export const supervisorToolNames = ['get_game_state', 'assign_target', 'recall_unit', 'defend_pilot', 'assign_squad', 'get_task_status', 'get_recent_events'] as const;
export type SupervisorToolName = typeof supervisorToolNames[number];

/** What the tools need from the running game. `getSim` returns null when no round is active. */
export interface SupervisorContext { getSim: () => Simulation | null; controller: AgentController }

export interface ToolRegistry {
  readonly tools: readonly ToolDefinition[];
  /** Name, description and JSON schema for each tool (provider-neutral). */
  specs(): {name: SupervisorToolName; description: string; input_schema: JsonSchema}[];
  /** Validate input against the schema and run the handler. Never throws. */
  call(name: string, input: unknown): ToolResult;
}

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------
const UNIT: JsonSchema = {type: 'string', enum: ['U1', 'U2'], description: 'Drone id.'};
const TARGET: JsonSchema = {type: 'string', enum: targetIds, description: 'Turret id.'};
const REASON: JsonSchema = {type: 'string', maxLength: 160, description: 'Short reason shown to the pilot verbatim. State facts from the game state; do not invent.'};
const TOKEN: JsonSchema = {type: 'string', maxLength: 64, description: 'state_token from the latest get_game_state. Decisions based on an outdated state are rejected.'};
const EVENT_KINDS: AgentEventKind[] = ['round_started', 'round_over', 'turret_destroyed', 'mech_damaged', 'unit_reassigned', 'unit_blocked', 'unit_unblocked', 'recall', 'command_rejected', 'autonomy_changed', 'fire_at_will_changed', 'task'];

const encodeToken = (sim: Simulation) => `${sim.runId}@${sim.controlEpoch}`;
function decodeToken(token: unknown): {runId: string; epoch: number} | null {
  if (typeof token !== 'string') return null;
  const at = token.lastIndexOf('@');
  const epoch = Number(token.slice(at + 1));
  return at > 0 && Number.isSafeInteger(epoch) ? {runId: token.slice(0, at), epoch} : null;
}

function taskView(t: TaskRecord) {
  return {task_id: t.id, unit: t.unit, kind: t.kind, target: t.target, status: t.status, detail: t.detail, firing: t.firing, reason: t.reason,
    history: t.history.map(h => ({status: h.status, tick: h.tick, detail: h.detail}))};
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------
export function createSupervisorTools(ctx: SupervisorContext): ToolRegistry {
  const noRound: ToolError = {ok: false, code: 'unavailable', error: 'No combat round is active. Ask the pilot to enter the arena.'};
  // observe() is pure and idempotent: it brings tasks/proposals up to date (e.g. right after a paused Retry).
  const active = () => { const sim = ctx.getSim(); if (!sim || sim.mode !== 'combat') return null; ctx.controller.observe(sim); return sim; };

  const submitTool = (input: Record<string, unknown>, action: AgentAction): ToolResult => {
    const sim = active(); if (!sim) return noRound;
    const basis = decodeToken(input.state_token);
    if (!basis) return {ok: false, code: 'invalid_input', error: 'state_token is malformed. Call get_game_state and copy state_token exactly.'};
    const r: SubmitResult = ctx.controller.submit(sim, action, basis);
    if (!r.ok) return {ok: false, code: r.code, error: r.error};
    const autonomous = r.mode === 'queued_autonomous';
    return {
      ok: true, mode: r.mode, proposal_id: r.proposalId, task_ids: r.taskIds, resolved: r.resolved,
      message: autonomous
        ? (sim.autonomy.fire ? 'Queued for autonomous execution on the next tick; the assigned drones may fire at their own targets.' : 'Queued for autonomous execution on the next tick (move only: drones hold fire unless the pilot fires).')
        : 'Proposed to the pilot. Nothing happens until the pilot accepts. If accepted, drones move but hold fire unless the pilot fires.',
      next: 'Track progress with get_task_status or get_recent_events.',
    };
  };

  const tools: ToolDefinition[] = [
    {
      name: 'get_game_state',
      description: 'Read-only battlefield snapshot: drones (orders, status, positions), turrets (alive, armed, health, distance to the pilot\'s mech), mech health, fire permissions, pilot authority (autonomy), pending proposals and open tasks. Returns state_token, which every action tool requires.',
      input_schema: {type: 'object', properties: {event_limit: {type: 'integer', minimum: 0, maximum: 20, description: 'Recent game events to include (default 5).'}}, additionalProperties: false},
      handler: input => {
        const sim = active(); if (!sim) return noRound;
        const snap = snapshot(sim, typeof input.event_limit === 'number' ? input.event_limit : 5);
        return {
          ok: true, state_token: encodeToken(sim), state: snap,
          authority: sim.autonomy.enabled
            ? (sim.autonomy.fire ? 'AUTONOMOUS: your orders execute immediately and assigned drones may fire.' : 'AUTONOMOUS (move only): your orders execute immediately; drones hold fire unless the pilot fires.')
            : 'PROPOSE ONLY: your orders are shown to the pilot for Accept/Dismiss.',
          pending_proposals: ctx.controller.pending().map(p => ({proposal_id: p.id, action: p.resolved, reason: p.reason})),
          open_tasks: ctx.controller.tasks.active().map(taskView),
          event_cursor: ctx.controller.log.cursor,
        };
      },
    },
    {
      name: 'assign_target',
      description: 'Order ONE drone to intercept a turret. Subject to pilot approval unless the pilot enabled autonomy. The pilot\'s Recall and manual orders always override.',
      input_schema: {type: 'object', properties: {unit: UNIT, target: TARGET, reason: REASON, state_token: TOKEN}, required: ['unit', 'target', 'reason', 'state_token'], additionalProperties: false},
      handler: input => submitTool(input, {kind: 'intercept', unit: input.unit as string, target: input.target as TargetId, reason: input.reason as string}),
    },
    {
      name: 'recall_unit',
      description: 'Order ONE drone to stop its task and escort the pilot. (The all-units emergency Recall belongs to the pilot only.)',
      input_schema: {type: 'object', properties: {unit: UNIT, reason: REASON, state_token: TOKEN}, required: ['unit', 'reason', 'state_token'], additionalProperties: false},
      handler: input => submitTool(input, {kind: 'recall', unit: input.unit as string, reason: input.reason as string}),
    },
    {
      name: 'defend_pilot',
      description: 'Order ONE drone to intercept the nearest living, ARMED turret to the pilot\'s mech (chosen from the current game state). Returns the chosen target in `resolved`.',
      input_schema: {type: 'object', properties: {unit: UNIT, reason: REASON, state_token: TOKEN}, required: ['unit', 'state_token'], additionalProperties: false},
      handler: input => submitTool(input, {kind: 'defend', unit: input.unit as string, reason: (input.reason as string | undefined) ?? 'Defending the pilot from the nearest armed turret'}),
    },
    {
      name: 'assign_squad',
      description: 'Give BOTH drones targets as ONE all-or-nothing plan (e.g. U1→T1 and U2→T3). If any entry is invalid, nothing is assigned.',
      input_schema: {type: 'object', properties: {
        assignments: {type: 'array', minItems: 1, maxItems: 2, items: {type: 'object', properties: {unit: UNIT, target: TARGET}, required: ['unit', 'target'], additionalProperties: false}},
        reason: REASON, state_token: TOKEN}, required: ['assignments', 'reason', 'state_token'], additionalProperties: false},
      handler: input => submitTool(input, {kind: 'squad', assignments: (input.assignments as {unit: string; target: TargetId}[]).map(a => ({unit: a.unit, target: a.target})), reason: input.reason as string}),
    },
    {
      name: 'get_task_status',
      description: 'Status of one task (task_id) or all recent tasks. Lifecycle: proposed → accepted → executing → completed, or failed / recalled / superseded / dismissed, with a reason. `firing` tells whether the drone is actually allowed to shoot.',
      input_schema: {type: 'object', properties: {task_id: {type: 'string', maxLength: 32}, include_finished: {type: 'boolean', description: 'When listing, also include finished tasks (default false).'}}, additionalProperties: false},
      handler: input => {
        if (typeof input.task_id === 'string') {
          const t = ctx.controller.task(input.task_id);
          return t ? {ok: true, task: taskView(t)} : {ok: false, code: 'not_found', error: `No task ${input.task_id}.`};
        }
        const list = input.include_finished === true ? ctx.controller.tasks.list().slice(-20) : ctx.controller.tasks.active();
        return {ok: true, tasks: list.map(taskView)};
      },
    },
    {
      name: 'get_recent_events',
      description: 'Battlefield history since a cursor: turrets destroyed, drones blocked/reassigned, Recalls, rejected commands, autonomy changes, task transitions, new rounds. Pass the returned cursor as `since` next time to get only new events.',
      input_schema: {type: 'object', properties: {
        since: {type: 'integer', minimum: 0, description: 'Cursor from a previous call (default 0 = everything retained).'},
        kinds: {type: 'array', items: {type: 'string', enum: EVENT_KINDS}},
        unit: UNIT,
        limit: {type: 'integer', minimum: 1, maximum: 100}}, additionalProperties: false},
      handler: input => {
        const r = ctx.controller.log.query({since: input.since as number | undefined, kinds: input.kinds as AgentEventKind[] | undefined, unit: input.unit as string | undefined, limit: (input.limit as number | undefined) ?? 30});
        return {ok: true, cursor: r.cursor, events: r.events};
      },
    },
  ];

  return {
    tools,
    specs: () => tools.map(t => ({name: t.name, description: t.description, input_schema: structuredClone(t.input_schema)})),
    call(name, input) {
      const tool = tools.find(t => t.name === name);
      if (!tool) return {ok: false, code: 'unknown_tool', error: `Unknown tool ${name}. Available: ${supervisorToolNames.join(', ')}.`};
      const args = input === undefined || input === null ? {} : input;
      const problem = validate(tool.input_schema, args);
      if (problem) return {ok: false, code: 'invalid_input', error: problem};
      try { return tool.handler(args as Record<string, unknown>); }
      catch (e) { return {ok: false, code: 'unavailable', error: `Tool failed: ${e instanceof Error ? e.message : String(e)}`}; }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Provider adapters (pure data; no SDK imports)
// ---------------------------------------------------------------------------------------------
/** Anthropic Messages API `tools` array: [{name, description, input_schema}]. */
export const toAnthropicTools = (r: ToolRegistry) => r.specs();
/** OpenAI-style function tools: [{type:'function', function:{name, description, parameters}}]. */
export const toOpenAITools = (r: ToolRegistry) => r.specs().map(s => ({type: 'function' as const, function: {name: s.name, description: s.description, parameters: s.input_schema}}));
/** Map of name → handler(params) returning a JSON string (e.g. ElevenLabs client tools, Vercel AI SDK `execute`). */
export const toClientToolHandlers = (r: ToolRegistry) => Object.fromEntries(r.specs().map(s => [s.name, (params: unknown) => JSON.stringify(r.call(s.name, params))])) as Record<SupervisorToolName, (params: unknown) => string>;
