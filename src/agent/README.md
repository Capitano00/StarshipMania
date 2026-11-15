# Supervisor agent tools

Seven typed, provider-neutral tools that let one AI supervisor observe the battlefield and command drones U1 and U2. They're plain TypeScript functions with JSON Schema inputs. There's no LLM, network or provider SDK in this folder.

The model never touches the simulation. Action tools only **submit** decisions:
- **Autonomy OFF** (default): a decision becomes a proposal. The pilot accepts with **Y** or dismisses with **N**.
- **Autonomy ON** (the pilot pressed **G**): the decision is queued and executes on the next tick.

The game loop turns submitted decisions into validated commands, stamped with a fresh id, the current round and the current tick. The pilot's emergency Recall and manual orders always win.

## What runs where

| Piece | File | Who calls it |
| --- | --- | --- |
| Tool registry (schemas and handlers) | `src/agent/tools.ts` | Your supervisor runtime |
| Live registry for the running game | `src/agent/runtime.ts` | `main.ts` installs it; you read it |
| Controller (proposals, autonomy queue, stale checks) | `src/agent/controller.ts` | Tools and the game loop |
| Snapshot, task tracker, event log | `snapshot.ts`, `tasks.ts`, `events.ts` | Used by the tools |
| HUD bridge for `feature/ui` (`hudFeed`) | `src/agent/hud-bridge.ts` | Not wired on this branch (see below) |

**Important: the tools run inside the game page.** They need the live simulation.
- **In-page supervisor** (an ElevenLabs client-tools widget, a browser chat panel, a WebLLM): call the tools directly.
- **Model on a server** (recommended for API keys): run the model loop on your server and **relay each tool call to the page**, for example over a WebSocket you add, then send the JSON result back. This repo contains no network bridge. Adding one is a team decision under AGENTS.md: keep keys server-side and get approval for any new network boundary.

## Getting the tools

```ts
// Inside the game bundle (any module loaded by main.ts):
import {getSupervisorTools} from './agent/runtime';

const tools = getSupervisorTools();          // null only before main.ts has started
tools!.specs();                              // [{name, description, input_schema}, ...] x 7
tools!.call('get_game_state', {});           // → plain JSON, never throws
```

From a script outside the bundle, open the game with `?supervisor` (or `?qa`) in the URL. That exposes the same object as `window.starshipSupervisor`:

```js
const r = window.starshipSupervisor.call('assign_target', {unit: 'U1', target: 'T3', reason: 'T3 is armed and nearest', state_token});
```

`call(name, input)` validates `input` against the tool's JSON schema first. Bad input returns `{ok: false, code: 'invalid_input', error}`.

## The seven tools

Every result has `ok: true | false`. Failures add `code` (`invalid_input`, `stale`, `invalid`, `unavailable`, `not_found` or `unknown_tool`) and a human-readable `error` written for the model.

| Tool | Required input | Optional | What it does |
| --- | --- | --- | --- |
| `get_game_state` | none | `event_limit` (0–20) | Read-only snapshot plus `state_token`, `authority`, `pending_proposals`, `open_tasks` and `event_cursor` |
| `assign_target` | `unit` (U1/U2), `target` (T1–T6), `reason`, `state_token` | none | One drone intercepts one turret |
| `recall_unit` | `unit`, `reason`, `state_token` | none | One drone returns to escort the pilot (the all-drone emergency Recall is pilot-only) |
| `defend_pilot` | `unit`, `state_token` | `reason` | One drone intercepts the **nearest living armed turret** to the mech; the chosen target is in `resolved` |
| `assign_squad` | `assignments: [{unit, target}]` (1–2 entries), `reason`, `state_token` | none | All-or-nothing plan for both drones |
| `get_task_status` | none | `task_id`, `include_finished` | One task, or all open tasks |
| `get_recent_events` | none | `since` (cursor), `kinds[]`, `unit`, `limit` (1–100) | Battlefield history since a cursor |

The exact schemas come from the registry. Use `tools.specs()` (or `toAnthropicTools` / `toOpenAITools` below) instead of copying them by hand.

### state_token: protection against stale decisions

`get_game_state` returns `state_token`, for example `"run-2@5"`. Every action tool requires it. If the pilot Recalls, gives a manual order, toggles autonomy or Fire at Will, or presses Retry after that snapshot, the action is rejected with `code: 'stale'`. A slow model response therefore can't revive cancelled work. **Tell the model to call `get_game_state` again and re-decide when it gets `stale`.**

### Example results

```jsonc
// assign_target while autonomy is OFF
{"ok": true, "mode": "awaiting_approval", "proposal_id": "proposal-1", "task_ids": ["task-1"],
 "resolved": {"kind": "intercept", "unit": "U1", "target": "T1"},
 "message": "Proposed to the pilot. Nothing happens until the pilot accepts. If accepted, drones move but hold fire unless the pilot fires.",
 "next": "Track progress with get_task_status or get_recent_events."}

// get_task_status
{"ok": true, "task": {"task_id": "task-1", "unit": "U1", "kind": "intercept", "target": "T1",
 "status": "executing", "detail": "Engaging (autonomous fire)", "firing": true, "reason": "…", "history": [ … ]}}

// get_game_state → state.units[0] / state.turrets[0]
{"id": "U1", "order": "follow", "target": null, "origin": "manual", "assignment": 0, "autonomous": false,
 "status": "Following", "blocked": false, "arrived": true, "position": {"x": -1.8, "y": 11}, "destination": {"x": -1.8, "y": 11}}
{"id": "T1", "alive": true, "health": 100, "armed": true, "patrolling": false, "position": {"x": -13.5, "y": -10.5},
 "distanceToMech": 28.85, "assignedUnits": []}
```

**Task lifecycle:**
- `proposed` → `accepted` → `executing` → `completed` is the normal path.
- Otherwise a task ends `failed` (rejected, blocked for more than 3 s, or round reset), `recalled` (pilot or unit Recall), `superseded` (another order or Fire at Will) or `dismissed` (by the pilot).
- `firing` is `true` only when the drone is at its firing position **and** allowed to shoot.

**Event kinds:** `round_started`, `round_over`, `turret_destroyed`, `mech_damaged`, `unit_reassigned`, `unit_blocked`, `unit_unblocked`, `recall`, `command_rejected`, `autonomy_changed`, `fire_at_will_changed`, `task`. Pass the returned `cursor` as `since` next time to receive only new events.

### Authority rules the model should know (put them in the system prompt)

- Autonomy is controlled by the pilot only. No tool can turn it on.
- With autonomy **OFF**, an accepted order **moves** the drone, but the drone **holds fire** unless the pilot fires (Padisarah fire or Fire at Will).
- With autonomy **ON (may fire)**, drones assigned by the supervisor fire at their own target.
- Any manual pilot order or emergency Recall switches autonomy **OFF** and overrides the supervisor. Fire at Will and autonomy are mutually exclusive.
- Drones have **no health**. They can't be damaged, so don't reason about drone damage.
- The `reason` field is shown to the pilot word for word, so state facts from `get_game_state`.

## Registering the tools with your LLM framework

All three adapters are pure data. They import no SDKs.

```ts
import {getSupervisorTools} from './agent/runtime';
import {toAnthropicTools, toOpenAITools, toClientToolHandlers} from './agent/tools';

const registry = getSupervisorTools()!;
toAnthropicTools(registry);      // [{name, description, input_schema}]: Claude Messages API `tools`
toOpenAITools(registry);         // [{type: 'function', function: {name, description, parameters}}]
toClientToolHandlers(registry);  // {get_game_state: (params) => JSON string, ...}: ElevenLabs client tools, Vercel AI `execute`, etc.
// registry.adapters.anthropic() / .openai() / .clientTools() are shortcuts for the same calls.
```

### Claude (Messages API manual tool loop), on your server

The loop runs where your API key lives. `runTool` is your relay to the page; in-page it would be `registry.call(name, input)`. Use `tool_choice` `auto` (the default), because forced tool choice isn't supported on Claude Opus 5.5. Return **all** tool results of a turn in **one** user message, and mark failures with `is_error`.

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY on the server; never ship a key to the browser
const tools = TOOL_SPECS as Anthropic.Tool[]; // the output of toAnthropicTools(), sent from the page once at startup

async function supervise(goal: string, runTool: (name: string, input: unknown) => Promise<{ok: boolean}>) {
  const messages: Anthropic.MessageParam[] = [{role: 'user', content: goal}];
  while (true) {
    const response = await client.messages.create({model: 'claude-opus-5-5', max_tokens: 16000, system: SUPERVISOR_PROMPT, tools, messages});
    if (response.stop_reason === 'refusal') break;          // see stop_details; consider server-side fallbacks
    if (response.stop_reason !== 'tool_use') break;          // end_turn: the supervisor is done for now
    messages.push({role: 'assistant', content: response.content});
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const result = await runTool(block.name, block.input);
      results.push({type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result), is_error: !result.ok});
    }
    messages.push({role: 'user', content: results});
  }
}
```

### ElevenLabs voice supervisor

Configure a new private, authenticated agent so the existing Recall agent remains available. Register the tools below as **Client** tools with **Wait for response** enabled. Give the planning tool at least 20 seconds to respond so it can accommodate the cloud adapter's 15-second deadline. Publish the test configuration and use that agent's ID in the local launcher. [ElevenLabs client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools)

| Tool | Client parameters |
| --- | --- |
| `recall_drones` | None. Only a fresh spoken “Recall drones” or “Recall the drones” authorizes it. |
| `get_game_state` | Optional integer `event_limit` (0–20). |
| `plan_drone_assignment` | Required strings `intent` (`direct`, `near`, `far`, `defend`, `squad`), `timing` (`now`, `when_feasible`) and `state_token`. Optional strings `unit` (`U1` or `U2`), `target`, `u1_target` and `u2_target` (each target `T1`–`T6`). Direct needs unit and target. Defend needs unit. Squad needs both distinct targets. Near and far need neither. |
| `request_unit_recall` | Required strings `unit` (`U1` or `U2`) and `state_token`. Requires confirmation in Orders. |
| `get_order_queue` | None. |
| `request_queue_change` | Required strings `id`, `operation` (`promote` or `cancel`), and `state_token`. |

The browser also registers the read-only `get_task_status` and `get_recent_events` tools. Register these only if the agent needs progress reports. The browser's voice action tools require explicit approval in **Orders**, including when the in-game autonomy switch is on.

Suggested system prompt:

> You are StarshipMania's voice supervisor for a fictional arena game. Speak briefly. Ask for clarification for missing drone or turret IDs. Handle clear spoken orders only. For “Recall drones” or “Recall the drones”, call recall_drones. For a named drone, use request_unit_recall with its ID. For Scout or status questions, call get_game_state with event_limit 0 and describe up to two nearest living armed turrets and which drones are following or assigned. Scout is read-only. Before a proposed action, read get_game_state and copy its state_token. For exact assignments call plan_drone_assignment with intent direct, unit and target. For a defend request use intent defend and the named unit. For two named assignments use intent squad, u1_target and u2_target. Use near or far for broad target requests. Set timing to now unless the pilot asks to defer. If asked what orders are waiting, read get_order_queue and report the waiting orders and IDs. For Promote or Cancel, read get_order_queue and request the change by exact ID. If the tool reports a replacement, explain which current task it would replace. Direct the pilot to Orders to approve any change except all-drone Recall. Say an order was proposed or approved at that stage. Report execution only when game state or the game result confirms it. Fire is a separate pilot permission. Questions, quotations and negated requests never trigger a change.

### Local launch and QA

From the StarshipMania checkout, build and start on a free local port. The launcher prompts for credentials privately.

```powershell
npm.cmd run build
& ./scripts/start-voice.ps1 -AgentId agent_YOUR_ID -Port 4186 -DroneWorkerProvider ollama
```

Ollama must be reachable on loopback, with `qwen3.5:2b-q4_K_M` available. Warm it before the demo. Each drone receives an independent structured request, with the same local model by default. The choices are checked against current route feasibility before the pilot can approve them.

To test the cloud fallback, stop that preview and run the same launcher with `-DroneWorkerProvider openai`. It uses `gpt-5-mini` and reads `OPENAI_API_KEY` server-side, prompting privately when it is missing. If the model is unavailable, direct named assignments and manual Recall remain available.

Check these scenarios in Synthetic Rehearsal or with calibrated hands:

1. Say “Send drone one to turret three.” Verify the exact assignment appears in Orders and executes only after acceptance.
2. While U1 is busy, say “Take out the turrets at the far end.” Verify the supervisor explains a feasible U2 assignment or says why it could not find one.
3. Request an exact busy-drone order when feasible. Confirm it and check the waiting row. Try a promotion and cancellation by ID, then verify one confirmed feasible order executes once.
4. Recall during pending work. Waiting orders must cancel and the late model response must have no effect. Retry clears the round's queue. Repeat live spoken Recall three times in one session and record transcript, tool request and game acceptance.
5. Say “Scout ahead” and compare the reported threats and availability with the HUD. Check that drone orders stay unchanged.
6. Assign both drones, then say “Recall U1.” Confirm in Orders. U1 should return to escort, its waiting orders should clear, and U2 should keep its task.
7. Say “U2, defend me” and check the proposed turret is the nearest living armed threat. Request an exact squad assignment and check both assignments appear together. Repeat with a stale or destroyed target to verify the game rejects the whole pair.


## Game-loop wiring (already done in `main.ts`)

```ts
const agentCommands = agentController.drain(sim);                      // fresh envelopes, inside the fixed 60 Hz step
sim.step(frame, [...pilotCommands, ...agentCommands], autofire, intents);
agentController.observe(sim);                                         // tasks and events
// Pilot controls: G → AUTONOMY intent; Y / N → approve / dismiss the newest proposal (button strip at the bottom of the arena)
```

Model calls must never run inside this loop. Your supervisor calls the tools asynchronously, and the loop picks up their effects on the next tick.

## HUD

The tactical HUD supports the existing approval strip and pilot autonomy controls. The Orders tab holds voice proposals and the waiting-order queue. The supervisor HUD bridge still exposes:

```ts
import {hudFeed} from './hud/feed';
import {connectHud} from './agent/hud-bridge';
const bridge = connectHud(agentController, hudFeed);   // once, after mounting the HUD
bridge.update(sim);                                    // every frame (cheap when unchanged)
```

The bridge publishes the pending proposal to the recommendation card with Accept/Dismiss, and per-drone phases to the drone tags. Accept/Dismiss route back to `agentController.approve` and `dismiss`.

## Verify locally

- `npx vitest run tests/agent-*.test.ts`: unit and integration tests on the real simulation.
- `npm run dev`, then open `http://127.0.0.1:4180/?supervisor`. Choose Synthetic rehearsal, Check both hands, then Enter arena. In the browser console:

```js
const s = starshipSupervisor; const t = s.call('get_game_state', {}).state_token;
s.call('assign_target', {unit: 'U1', target: 'T1', reason: 'Testing', state_token: t}); // press Y in the game
s.call('get_task_status', {});
```
