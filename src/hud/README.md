# Tactical HUD and arena effects

Presentation-only layers for the live arena. They read simulation state; they never change gameplay, gesture recognition or command arbitration. Add `?classic` to the URL to get the original UI.

Design source: Figma file "StarshipMania — Tactical HUD" (variables `HUD/*`, components `DroneCard`, `RecommendationCard`, `LinkChip`, `EventRow`). CSS tokens in `hud.css` use the same names (`--hud-*`).

| File | Role |
| --- | --- |
| `src/fx/arena-fx.ts` | three.js effects added to the ArenaView scene: sky, grid glow, drone glow/trails/tethers, target brackets, projectile streaks, hit and command pulses |
| `src/hud/model.ts` | Pure mapping from `Simulation` to drone cards, objectives and events |
| `src/hud/hud.ts`, `hud.css` | DOM overlay and styles, scoped under `body.hud-v2` |
| `src/hud/contract.ts` | Stable types; enum values match the Figma variants |
| `src/hud/feed.ts` | `hudFeed`: the only place agent and voice code should push data |

## Connecting agent and voice features

Nothing agent-related is shown until real data arrives. Defaults: voice "not connected", agent "not connected", no recommendation.

```ts
import {hudFeed} from './hud/feed';

hudFeed.setAgentLink('live');
hudFeed.setSuggestion({id: 's-7', droneId: 'U1', action: 'Regroup on the pilot', reason: 'Two armed turrets cover T4', status: 'pending'});
const off = hudFeed.onDecision({
  accept: id => {/* gameplay validates and applies, then */ hudFeed.setSuggestion({...hudFeed.suggestion!, status: 'accepted'});},
  dismiss: id => hudFeed.setSuggestion({...hudFeed.suggestion!, status: 'dismissed'}),
});
// Gameplay owns "Recall wins": when Recall is accepted, report it.
hudFeed.setSuggestion({...hudFeed.suggestion!, status: 'recalled'});

hudFeed.setVoice({status: 'listening', partial: 'U1, regroup'});
hudFeed.setDroneTelemetry('U1', {health: 0.8, reason: 'Covering the pilot', authority: 'agent'});
```

Accept and Dismiss stay disabled until `onDecision` handlers exist. With `?qa`, the feed is also available as `window.__hudFeed` for manual rendering checks.
