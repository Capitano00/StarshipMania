# StarshipMania team checkout

Use this GitHub repository as the Codex working project for game development. Keep event planning, judging and submission coordination in IC-Hackathon-Nov26 Control Tower. ProjectZero remains the upstream project.

- Branch from the shared `main` and coordinate ownership of overlapping gameplay files before editing.
- Start with one visible drone decision and test that player Recall takes priority. Keep the baseline Fire at Will behaviour attributable to ProjectZero.
- Use Node.js 24 and `npm ci`. Run `npm run build` and the tests relevant to the change. Report the known baseline failures and any additional failures separately.
- Use Synthetic Rehearsal for ordinary development. Keep camera captures, saved sessions, credentials and model weights out of commits.
