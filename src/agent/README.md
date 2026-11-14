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

### ElevenLabs voice agent (already wired)

`src/voice-recall.ts` (the voice Recall from `main`) passes the seven tools to the same ElevenLabs session as client tools, alongside the guarded `recall_drones`. `main.ts` supplies them through `getSupervisorTools()?.adapters.clientTools()`.
- `recall_drones` keeps its own phrase, once-only and expiry checks, and can't be replaced.
- The supervisor tools answer only while that voice session is active.

**What you still have to do:** declare the tools you want (same names and parameters as `specs()`) on the published ElevenLabs agent, with **Wait for response** on. The agent can only call tools declared there. This dashboard step hasn't been done or verified by us.

A spoken Recall (`'local-voice-recall'`) is pilot input. It's an emergency Recall that also switches autonomy off and makes older `state_token`s stale.

The tool output strings already state the authority model, for example "Proposed to the pilot…", so the voice agent can explain them truthfully.

## Game-loop wiring (already done in `main.ts`)

```ts
const agentCommands = agentController.drain(sim);                      // fresh envelopes, inside the fixed 60 Hz step
sim.step(frame, [...pilotCommands, ...agentCommands], autofire, intents);
agentController.observe(sim);                                         // tasks and events
// Pilot controls: G → AUTONOMY intent; Y / N → approve / dismiss the newest proposal (button strip at the bottom of the arena)
```

Model calls must never run inside this loop. Your supervisor calls the tools asynchronously, and the loop picks up their effects on the next tick.

## HUD (`feature/ui`)

This branch doesn't contain the `feature/ui` HUD. It shows a minimal approval strip and an "Autonomy ON/OFF / G" button. After both branches merge:

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
