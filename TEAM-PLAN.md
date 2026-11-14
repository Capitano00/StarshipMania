# StarshipMania team plan

**First team demo:** The pilot keeps steering while one drone recommends regrouping and explains why. The player can accept or dismiss the suggestion. Pressing **Recall** clears the suggestion and immediately restores manual command authority.

Use one scenario, one drone, and one recommendation with a visible reason. Start with keyboard input and the existing Synthetic Rehearsal. Keep the inherited Fire at Will behaviours separate from the new recommendation.

| Owner | Workstream | First deliverable |
| --- | --- | --- |
| Boyong | Coordination and integration | Set scope, assign issues, coordinate the merge order, and lead the first team demo. |
| Teammate 1 | Gameplay | Own the recommendation and command arbitration. Test that Recall wins while a suggestion is pending or accepted, and that a late response cannot reactivate it. |
| Teammate 2 | Design and HUD | Design pending, accepted, dismissed, and recalled states in Figma. Implement a readable suggestion and reason with clear, keyboard-accessible accept and dismiss controls. |
| Teammate 3 | Voice and evaluation | Use a mock against the agreed interaction first. Check live voice feasibility and define repeatable evaluation cases. |

1. **Agree the contract.** Gameplay and design agree the displayed reason, commands, and states. Use one issue and one short PR per change. Gameplay, HUD, and voice/evaluation can work in parallel once they agree the interface and own separate files.
2. **Integrate the local flow.** Show uninterrupted steering while the suggestion appears, then accept or dismiss it and use Recall. Confirm Recall wins even when acceptance arrives late. Keep the demo runnable without sponsor credentials or network.
3. **Review sponsor work.** Add an integration only if it improves the same flow. Demo the local path before relying on live voice.

| Priority | Proposed work | First checkpoint |
| --- | --- | --- |
| Figma | Design the pilot's decision UI in Figma and implement it in the existing game. Keep the design artefact and show how it changed the HUD. | A teammate can identify the recommendation, its reason, and who has control at each step. See the [Figma prize brief](https://imperial-ai-hackathon.devpost.com/#prizes). |
| ElevenLabs voice | Once keyboard play works, try a real-time voice agent that explains the recommendation and proposes accepting or dismissing it. The local game validates the proposal. Voice never takes over steering or bypasses Recall. | Confirm access, a real interaction, and keyboard fallback if service drops. Use explicit opt-in and get a decision on microphone and network boundaries before integration. Keep credentials server-side. [Client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools) · [Agent authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication) |
| Adaption | Spend at most 30 minutes checking leaderboard access, task fit, data needs, turnaround, and required artefacts. If feasible, compare base and adapted models on held-out synthetic examples of valid, ambiguous, and rejected requests. | A verified run and evaluation path fits the schedule. Otherwise keep training off the critical path. [AutoScientist run requirements](https://docs.adaptionlabs.ai/autoscientist/running-autoscientist/) · [Evaluation](https://docs.adaptionlabs.ai/autoscientist/interpreting-results/) |

These are proposed workstreams. The current game has no Figma, ElevenLabs, or Adaption runtime dependency. Keep keys, microphone recordings, camera frames, and model files out of Git.

**Team review:** Pilot keeps moving → drone gives a recommendation and reason → player accepts or dismisses → Recall takes priority. Report the commit, steps, expected versus actual result, and any service or input limitation. Keep keyboard play as the demo if live voice is not ready.
