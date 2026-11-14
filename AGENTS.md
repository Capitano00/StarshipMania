# StarshipMania agent guidance

Use this checkout for StarshipMania game development. Keep team direction, scope decisions, and sponsor coordination in Hackathon Control. ProjectZero is upstream and remains separate. Start with [README.md](README.md), [TEAM-PLAN.md](TEAM-PLAN.md), [PROVENANCE.md](PROVENANCE.md), and the assigned issue or PR.

## Assign and own the change

- Work from one small issue and one branch based on `main`. Record the base commit, expected behaviour, check to prove it, and the files or areas you own before editing.
- Use one designated writer per scope. Read-only checks may run in parallel. Write in parallel only on agreed, non-overlapping files. Agree shared interfaces before branching and sequence changes to shared files or the lockfile. Preserve edits you did not make.
- Check status and the current diff before and after edits. Work inside the assignment. If the base changed materially, ownership overlaps, expected behaviour is unclear, or the fix needs broader scope, stop the affected work and identify the decision or person needed.
- The team's human scope owner settles product direction and material trade-offs, including dependencies, external integrations, data permissions, costs, and publication. Agents can recommend and implement an agreed change; they do not infer approval or independently widen scope.

## Preserve gameplay authority and provenance

- The first milestone is one drone recommendation with a visible reason and a player response. The player keeps piloting, and manual Recall takes priority. Keep typed command validation, simulation, and manual controls local and deterministic. An optional model may propose an action; it must not directly mutate simulation state, run in the frame loop, or replay an action after Recall, Retry, or a stale response.
- Use Synthetic Rehearsal for normal development. Keep it usable without a camera, microphone, model files, API keys, or external services. Camera activation stays explicit and local. Escalate any new microphone, cloud, or data boundary before implementing it.
- Keep credentials, camera or microphone captures, raw tracking data, saved sessions or calibration, model files, and generated builds out of Git. Verify third-party rights and notices before adding assets or distributing builds. Do not treat ignored files as secret storage.
- Attribute the upstream baseline and inherited Fire at Will behaviour in [PROVENANCE.md](PROVENANCE.md). Distinguish inherited code, new changes, observed results, and untested proposals. Preserve accepted decisions when recording a replacement; leave routine edits in Git history.

## Verify, review, and report

- Use Node.js 24 and `npm ci --ignore-scripts` from a clean clone. Run the build and checks relevant to your change. For changes to the core play path, smoke-test camera-off startup through rehearsal, Deploy/Recall, arena, and Retry. Record exact commands, tested commit, and results. State what was mocked or not tested.
- The known baseline includes 71 inherited failures: 67 in `page.test.ts` and one each in `camera.test.ts`, `guided-calibration.test.ts`, `resume-intent.test.ts`, and `tracking-worker.test.ts`. Use the latest verified baseline where available. Compare by full test name, not count alone. Report new failures separately. Do not skip or weaken tests to make the run look green.
- Open a short PR describing the behaviour change, evidence, and limitations. Get independent review for material gameplay, security, or integration changes. Passing checks, review, and owner acceptance are separate. The designated human integrates changes after review; no automatic merging, tagging, publication, or cross-chat updates.
- For routine updates, report the result, evidence, and next step briefly. For a material milestone, blocker, or change of direction, lead with **Now / Changed / Next**, then use the compact handoff below. A ready-for-review handoff gives a run command, expected observations, and a way to report discrepancies. Do not infer completion, acceptance, or runtime readiness from silence, elapsed time, or stale records.

## Copyable task assignment

```text
Task / issue:
Outcome and expected behaviour:
Base branch / commit:
Mode: read-only | write
Designated writer: none | name
Owned files or area; out of scope:
Validation and acceptance criteria:
Stop and escalate if:
Review / next owner:
```

## Copyable end-of-turn handoff

```text
Now / Changed / Next: [lead with this for material updates]
Status: planned | in progress | blocked | ready for review | complete
Expected / actual:
Evidence: commit or PR, commands and results, and reproduction steps
Scope changed: none | what changed and who approved it
Risks / limits: new vs inherited failures, mocks, and untested behaviour
Review / human acceptance: pending | recorded, with reference
Next owner / decision or action needed:
```
