# Metrics and before/after comparisons

The metrics page (`/metrics.html`, the **Metrics ↗** button in the game header) reads `metrics.json`. Generate it from the project folder:

    npm run metrics

That builds the game, runs every test and writes `public/metrics.json` and `dist/metrics.json` (both git-ignored). The page is shown to judges, so the collector records no git history, author names or local file status.

## Files in this folder

| File | What it holds | Who updates it |
| --- | --- | --- |
| `comparisons.json` | Each before/after comparison shown under **Before & after** | Whoever owns the change |
| `snapshots/*.json` | Build, bundle and test numbers for one version of the game | `npm run metrics -- --snapshot …` |
| `performance.json` | Benchmark runs: frame rate, load time, memory | Whoever runs the benchmark |
| `baseline-failures.json` | The 71 test failures inherited from ProjectZero v0.4.3 | Nobody, unless an inherited failure is fixed |

## Comparing your change (voice agent, Adaption model, or anything else)

1. **The "before" is already saved** as `snapshots/before-integrations.json` and the `after-lazy-three` benchmark run.
2. **On a branch that includes your change and this metrics work**, save the "after" snapshot:

       npm run metrics -- --snapshot after-voice-agent --label "With the voice agent"

3. **Optionally, benchmark the game with your change** using the method in `performance.json`, and add a run with a new `id` (for example `after-voice-agent`).
4. **Point your comparison at them** in `comparisons.json`: set `after.snapshot` and `after.performanceRun` to those ids.
5. **Fill in your feature metrics** in the same entry. Each metric has `before` and `after`:
   - a number, such as `420`;
   - `null` when it is not measured yet (shown as "Not measured");
   - `"n/a"` when the old version cannot do it at all (shown as "Not possible", and the after value as **New**).

   Set `better` to `"higher"`, `"lower"`, or `null` when neither is better.
6. Run `npm run metrics` again and reload the page.

Measure before and after on the same machine, browser and scenario, or the comparison is not fair.

## The two dimensions on the page

**1. Agent & model: how well the agent or model itself works.**
- *Voice (automatic):* every `npm run metrics` runs the labelled phrase list in `src/bench/voice-eval.ts` through `parseVoiceCommand` in `src/voice.ts`. It reports how many phrases were understood, wrong orders, missed commands and false triggers, split into clear commands, misheard commands and chatter. If your voice agent produces intents some other way, pass your own function to `evaluateVoice` in `src/bench/index.ts`.
- *Anything else* (latency, Adaption win rate): type the numbers into your entry in `comparisons.json`.

**2. Gameplay: what it changes in a round.**
`src/bench/gameplay.ts` plays the real game simulation with scripted controllers: Fire at Will only, gesture-deployed drones only, pilot alone, and pilot with drones. It reports round score (out of 1000), time to clear, hit accuracy and mech health left. The simulation is deterministic, so the same code always gives the same numbers; any change between snapshots is caused by the code change.

To show your feature's effect, add a controller to `scenarios()` in that file that plays through your agent or model, with a new name. Leave the baseline controllers unchanged. For the voice agent, the simplest version is the drones-only controller with your measured speech-to-order latency:

    droneCommander('Voice-deployed drones only', 320)   // 320 = your measured latency in ms

Then set the "Minimum time to issue Deploy or Recall" `after` value to the same latency. The latency chart marks it next to today's 500 ms gesture hold.

**Supervisor agent (`src/agent`).** Two scripted rounds, "Supervisor agent drones only" and "Pilot + supervisor agent", drive the drones only through the agent's tools (`get_game_state`, `defend_pilot`, `assign_target`) after the pilot grants autonomy, re-planning every second. The drones-only round also reports tool calls succeeded, rejected (stale or invalid) and tasks completed. The scripted supervisor stands in for a model, so these numbers measure the tool layer and autonomy rules, not a particular LLM's judgement.

### Suggested numbers for each workstream

- **Voice agent:** the time from the end of speech to the order being accepted (compare with the 500 ms gesture hold), the share of a fixed phrase list understood correctly, wrong orders from mis-hearing, and whether Recall still beats voice-issued orders.
- **Adaption model:** `best_win_rate` from the AutoScientist run as a percentage (50% means no better than the base model) and `best_win_rate ÷ target_win_rate`. If the adapted model runs inside the game, also save an "after" snapshot and benchmark run to show its cost in download size and frame rate.
