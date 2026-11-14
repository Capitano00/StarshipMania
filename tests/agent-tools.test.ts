import {describe, expect, it} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame} from '../src/contracts';
import {AgentController} from '../src/agent/controller';
import {createSupervisorTools, supervisorToolNames, toAnthropicTools, toClientToolHandlers, toOpenAITools, validate, type ToolRegistry} from '../src/agent/tools';
import {connectHud} from '../src/agent/hud-bridge';
import {getSupervisorTools, installSupervisorRuntime} from '../src/agent/runtime';

/** A supervisor runtime only sees `registry.call(name, json)`. The game loop is simulated here. */
function setup(id = 'tools') {
  const state = {sim: new Simulation(id) as Simulation | null};
  const controller = new AgentController();
  const tools = createSupervisorTools({getSim: () => state.sim, controller});
  const step = (n = 1, intents: Parameters<Simulation['step']>[3] = []) => {
    for (let i = 0; i < n; i++) { const sim = state.sim!; const agent = controller.drain(sim); sim.step(neutralFrame(), agent, false, i === 0 ? intents : []); controller.observe(sim); }
  };
  const autonomy = (enabled: boolean) => step(1, [state.sim!.intent({type: 'AUTONOMY', enabled, fire: enabled}, 'local-button')]);
  const token = (r: ToolRegistry = tools) => (r.call('get_game_state', {}) as unknown as {state_token: string}).state_token;
  return {state, controller, tools, step, autonomy, token};
}

describe('registry', () => {
  it('registers exactly the seven tools with JSON schemas, in every adapter format', () => {
    const {tools} = setup();
    expect(tools.specs().map(s => s.name)).toEqual([...supervisorToolNames]);
    for (const s of tools.specs()) { expect(s.input_schema.type).toBe('object'); expect(s.description.length).toBeGreaterThan(30); }
    expect(toAnthropicTools(tools)[1]).toMatchObject({name: 'assign_target', input_schema: {required: ['unit', 'target', 'reason', 'state_token']}});
    expect(toOpenAITools(tools)[4]).toMatchObject({type: 'function', function: {name: 'assign_squad', parameters: {type: 'object'}}});
    const handlers = toClientToolHandlers(tools);
    expect(Object.keys(handlers)).toEqual([...supervisorToolNames]);
    expect(JSON.parse(handlers.get_game_state({}))).toMatchObject({ok: true});
  });

  it('validates input against the schema and never throws', () => {
    const {tools, token} = setup();
    const t = token();
    expect(tools.call('assign_target', {unit: 'U3', target: 'T1', reason: 'x', state_token: t})).toMatchObject({ok: false, code: 'invalid_input', error: 'input.unit must be one of U1, U2'});
    expect(tools.call('assign_target', {unit: 'U1', target: 'T1', state_token: t})).toMatchObject({ok: false, code: 'invalid_input', error: 'input.reason is required'});
    expect(tools.call('assign_target', {unit: 'U1', target: 'T1', reason: 'x', state_token: t, extra: 1})).toMatchObject({ok: false, code: 'invalid_input'});
    expect(tools.call('assign_squad', {assignments: [], reason: 'x', state_token: t})).toMatchObject({ok: false, code: 'invalid_input'});
    expect(tools.call('fly_to_moon', {})).toMatchObject({ok: false, code: 'unknown_tool'});
    expect(tools.call('get_recent_events', null)).toMatchObject({ok: true});
    expect(validate({type: 'string', maxLength: 3}, 'abcd')).toBe('input is longer than 3 characters');
  });

  it('reports no active round instead of failing', () => {
    const {tools, state} = setup();
    state.sim = null;
    expect(tools.call('get_game_state', {})).toMatchObject({ok: false, code: 'unavailable'});
    expect(tools.call('recall_unit', {unit: 'U1', reason: 'x', state_token: 'run@0'})).toMatchObject({ok: false, code: 'unavailable'});
  });

  it('the runtime installs a live registry for in-page supervisors', () => {
    const controller = new AgentController(), sim = new Simulation('rt');
    installSupervisorRuntime({getSim: () => sim, controller}, {exposeGlobal: true});
    expect(getSupervisorTools()?.call('get_game_state', {})).toMatchObject({ok: true});
    expect((globalThis as unknown as {starshipSupervisor: ToolRegistry}).starshipSupervisor.specs()).toHaveLength(7);
    expect(getSupervisorTools()?.adapters.anthropic()).toHaveLength(7);
  });
});

describe('tools drive real behaviour', () => {
  it('get_game_state returns the snapshot, authority, token and open work', () => {
    const {tools} = setup('gs');
    const r = tools.call('get_game_state', {event_limit: 2}) as unknown as Record<string, unknown> & {state: {units: unknown[]; turrets: unknown[]}};
    expect(r).toMatchObject({ok: true, state_token: 'gs@0', authority: expect.stringContaining('PROPOSE ONLY'), pending_proposals: [], open_tasks: []});
    expect(r.state.units).toHaveLength(2);
    expect(r.state.turrets).toHaveLength(6);
  });

  it('assign_target (autonomy OFF) proposes; nothing moves until approval; then the drone executes without fire', () => {
    const {tools, controller, state, step, token} = setup('at');
    const r = tools.call('assign_target', {unit: 'U1', target: 'T1', reason: 'T1 is armed and closest', state_token: token()}) as unknown as {ok: true; proposal_id: string; task_ids: string[]; mode: string; message: string};
    expect(r).toMatchObject({ok: true, mode: 'awaiting_approval'});
    expect(r.message).toContain('hold fire');
    step(20);
    expect(state.sim!.funnels[0].order.type).toBe('RECALL');
    expect((tools.call('get_game_state', {}) as unknown as {pending_proposals: unknown[]}).pending_proposals).toHaveLength(1);
    controller.approve(r.proposal_id, state.sim!);
    step(400);
    expect(state.sim!.funnels[0].order).toEqual({type: 'INTERCEPT', targetId: 'T1'});
    expect(tools.call('get_task_status', {task_id: r.task_ids[0]})).toMatchObject({ok: true, task: {status: 'executing', firing: false, detail: 'Holding fire: no drone fire permission'}});
  });

  it('assign_squad + autonomy ON: both drones assigned atomically; autonomous fire completes a task', () => {
    const {tools, state, step, autonomy, token} = setup('sq');
    state.sim!.turrets.forEach(t => t.armed = false);
    autonomy(true);
    expect((tools.call('get_game_state', {}) as unknown as {authority: string}).authority).toContain('AUTONOMOUS');
    const bad = tools.call('assign_squad', {assignments: [{unit: 'U1', target: 'T4'}, {unit: 'U1', target: 'T6'}], reason: 'x', state_token: token()});
    expect(bad).toMatchObject({ok: false, code: 'invalid'});
    const r = tools.call('assign_squad', {assignments: [{unit: 'U1', target: 'T4'}, {unit: 'U2', target: 'T6'}], reason: 'Clear both flanks', state_token: token()}) as unknown as {ok: true; task_ids: string[]; mode: string};
    expect(r).toMatchObject({ok: true, mode: 'queued_autonomous'});
    step(1);
    expect(state.sim!.funnels.map(f => f.order)).toEqual([{type: 'INTERCEPT', targetId: 'T4'}, {type: 'INTERCEPT', targetId: 'T6'}]);
    let sawAutonomousFire = false;
    for (let i = 0; i < 4000 && (tools.call('get_task_status', {task_id: r.task_ids[0]}) as unknown as {task: {status: string}}).task.status !== 'completed'; i++) {
      step(1);
      const t = (tools.call('get_task_status', {task_id: r.task_ids[0]}) as unknown as {task: {firing: boolean; detail: string}}).task;
      if (t.firing && t.detail === 'Engaging (autonomous fire)') sawAutonomousFire = true;
    }
    expect(sawAutonomousFire).toBe(true);
    expect(tools.call('get_task_status', {task_id: r.task_ids[0]})).toMatchObject({task: {status: 'completed', detail: 'T4 destroyed by U1'}});
    const ev = tools.call('get_recent_events', {kinds: ['turret_destroyed']}) as unknown as {events: {target: string}[]};
    expect(ev.events.map(e => e.target)).toContain('T4');
  });

  it('defend_pilot resolves the nearest armed turret; recall_unit returns the drone', () => {
    const {tools, state, step, autonomy, token} = setup('dp');
    autonomy(true);
    const snap = (tools.call('get_game_state', {}) as unknown as {state: {turrets: {id: string; alive: boolean; armed: boolean; distanceToMech: number}[]}}).state;
    const nearest = snap.turrets.filter(t => t.alive && t.armed).sort((a, b) => a.distanceToMech - b.distanceToMech)[0].id;
    const d = tools.call('defend_pilot', {unit: 'U2', state_token: token()});
    expect(d).toMatchObject({ok: true, resolved: {kind: 'intercept', unit: 'U2', target: nearest}});
    step(2);
    expect(state.sim!.funnels[1].order).toEqual({type: 'INTERCEPT', targetId: nearest});
    const rc = tools.call('recall_unit', {unit: 'U2', reason: 'Escort the pilot', state_token: token()}) as unknown as {task_ids: string[]};
    step(2);
    expect(state.sim!.funnels[1].order.type).toBe('RECALL');
    expect(tools.call('get_task_status', {})).toMatchObject({ok: true});
    expect((tools.call('get_task_status', {task_id: rc.task_ids[0]}) as unknown as {task: {status: string}}).task.status).toMatch(/executing|completed/);
  });

  it('stale state_token after a pilot Recall or Retry is rejected', () => {
    const {tools, state, step, token} = setup('st');
    const old = token();
    step(1);
    state.sim!.step(neutralFrame(), [state.sim!.envelope({type: 'RECALL'}, 'local-keyboard-recall', 'cmd-1')]);
    expect(tools.call('assign_target', {unit: 'U1', target: 'T1', reason: 'x', state_token: old})).toMatchObject({ok: false, code: 'stale'});
    const fresh = token();
    state.sim = new Simulation('st-2');
    expect(tools.call('assign_target', {unit: 'U1', target: 'T1', reason: 'x', state_token: fresh})).toMatchObject({ok: false, code: 'stale'});
    expect(tools.call('assign_target', {unit: 'U1', target: 'T1', reason: 'x', state_token: 'garbage'})).toMatchObject({ok: false, code: 'invalid_input'});
  });

  it('get_recent_events supports cursors', () => {
    const {tools, step, autonomy} = setup('ev');
    step(1);
    const first = tools.call('get_recent_events', {}) as unknown as {cursor: number};
    autonomy(true);
    const next = tools.call('get_recent_events', {since: first.cursor}) as unknown as {cursor: number; events: {kind: string}[]};
    expect(next.events.map(e => e.kind)).toContain('autonomy_changed');
    expect((tools.call('get_recent_events', {since: next.cursor}) as unknown as {events: unknown[]}).events).toEqual([]);
  });
});

describe('HUD bridge (for feature/ui hudFeed)', () => {
  it('publishes the pending proposal and per-drone phases; Accept/Dismiss route to the controller', () => {
    const {tools, controller, state, step, token} = setup('hud');
    const published: {type: string; [k: string]: unknown}[] = [];
    let handlers: {accept: (id: string) => void; dismiss: (id: string) => void} | null = null;
    const bridge = connectHud(controller, {publish: e => published.push(e as never), onDecision: h => { handlers = h; return () => { handlers = null; }; }});
    expect(published[0]).toEqual({type: 'agent.link', state: 'live'});
    const r = tools.call('assign_target', {unit: 'U1', target: 'T2', reason: 'Flanking turret', state_token: token()}) as unknown as {proposal_id: string};
    bridge.update(state.sim!);
    expect(published.find(e => e.type === 'agent.suggestion' && e.suggestion)).toMatchObject({suggestion: {id: r.proposal_id, droneId: 'U1', action: 'U1 intercept T2', reason: 'Flanking turret', status: 'pending'}});
    expect(published.find(e => e.type === 'agent.phase')).toMatchObject({droneId: 'U1', phase: 'proposing', targetId: 'T2'});
    handlers!.accept(r.proposal_id);
    step(3); bridge.update(state.sim!);
    expect(published.filter(e => e.type === 'agent.phase').at(-1)).toMatchObject({droneId: 'U1', phase: 'executing'});
    bridge.disconnect();
    expect(published.at(-1)).toEqual({type: 'agent.link', state: 'offline'});
  });
});
