# ProjectZero Hybrid Control · Hackathon

The four-person team chose ProjectZero as the starting point for a game prototype where a player and agents share control of in-game drones. The first gameplay slice will define the player’s commands, the drone agent’s permitted actions, and how the player overrides the agent.

## Baseline and contribution record

| Item | Status |
| --- | --- |
| Upstream baseline | ProjectZero Control verified First Playable Demo v0.4.3 at `3aa4bd12dbe510423f518faa8a9053fa62e42808`. Import remains pending event reuse clearance. |
| Event and reuse rules | Confirm the applicable event and its rules on prior code and assets before importing. |
| Camera-free starter scope | First-party arena, pilot controls, deploy and recall for two Padisarah units, Synthetic rehearsal, lockfile and portable tests. Exclude webcam functionality and model diagnostics, `.task` model files, bundled model runtime, private notes, Git history and generated output. Model redistribution clearance remains open. |
| Hackathon changes | Record the team’s hybrid-control changes after the baseline import. Keep the import as its own commit so the diff identifies the new work. |
| Shared remote | [StarshipMania](https://github.com/Capitano00/StarshipMania), private GitHub repository owned by Capitano00. |

The baseline already has deterministic Fire at Will policies. Record them as pre-existing and identify the specific new agent behaviour in the hackathon diff and submission.

## First demo check

After the approved import, install the locked dependencies with Node 24 and run the tests and build. From a clean checkout, verify Synthetic rehearsal → calibration → practice → deploy and recall → arena → Retry without a webcam, model file or API key. Use one in-game drone and one arena scenario for the new work. Show one visible agent decision while the player keeps piloting, then use manual Recall to regain control immediately. Check that gameplay works if the agent is unavailable. Record the build version and independent test result.
