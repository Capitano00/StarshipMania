# StarshipMania

StarshipMania is a browser game prototype where you pilot a mech and direct two Padisarah drones. Start with **Synthetic rehearsal** to practise the controls and play an arena round without a webcam, model, or API key.

## Current stack

| Component | What it does |
| --- | --- |
| TypeScript | Game simulation, controls, command validation, and browser UI |
| Three.js | 3D arena and gameplay rendering |
| Vite | Local development server, build, and preview |
| Node.js 24 and npm | Locked dependency installation and development tooling |
| Vitest | Automated tests |
| MediaPipe Tasks Vision | Optional local webcam and hand-gesture tracking |

See [Third-party notices](THIRD_PARTY.md) for attribution and the separate webcam model terms.

## Quick start

From a fresh clone with Node.js 24:

```sh
npm ci --ignore-scripts
npm run build
npm run preview
```

Open [the local game](http://127.0.0.1:4180/). The preview listens only on this machine. If port 4180 is busy, stop only a preview you started, or run `npm run preview -- --port 4181` and open [port 4181](http://127.0.0.1:4181/). Press Ctrl+C to stop the server you launched.

For development, run `npm run dev`. Use `npm test` for the automated suite and `npm run typecheck` for a standalone type check.

## Play without a webcam

1. Confirm **Camera off**, select **Synthetic rehearsal**, then **Check both hands** and wait for neutral calibration.
2. Select **Test controls** or **Practise Padisarah**. In rehearsal, **WASD** moves and the **arrow keys** aim. Follow the on-screen prompts to practise pilot fire and drone commands.
3. Try **Deploy** and **Recall**, then enter the arena. **R** issues immediate Recall. **Retry** retains calibration and starts a new round with Fire at Will off.

## Optional webcam

The camera stays off until you choose **Activate webcam**. Frames and landmarks are processed in memory on your device. The current game does not use the microphone or send camera data off-device. Choose **Stop camera** or leave the page to release the tracks.

The model and runtime files are not shipped in this repository. If you independently have rights to use the exact Gesture Recognizer model pinned in [webcam-asset-pins.json](webcam-asset-pins.json), install the locked dependencies and run:

```sh
npm run setup:webcam -- --model "/path/to/gesture_recognizer.task" --confirm-independent-rights
npm run build
npm run preview
```

The setup command verifies the model and MediaPipe runtime hashes and stages files into ignored `public/vendor/`. It does not download the model, grant rights, or overwrite an existing vendor folder. Use a clean local copy if you need to restage. If files are missing or incomplete, or you deny browser permission, **Synthetic rehearsal** remains available. Keep model files, camera captures, saved calibration or session data, credentials, and build outputs out of commits.

## Team development

Branch from `main` and open one short PR per change. Coordinate ownership before editing shared gameplay files. Use this repo for implementation and Hackathon Control for team decisions and sponsor coordination. An assigned human integrates changes after review.

[Agent and review guidance](AGENTS.md) · [Team plan](TEAM-PLAN.md) · [ProjectZero provenance](PROVENANCE.md)

## Verification

Dedicated QA tested a byte-verified snapshot of `af1efff0a939a5799715e09eb295896653675542` and the readiness candidate. Both passed locked install, typecheck, build, and nine isolated Edge checks. The rehearsal covered camera-off startup, calibration, practice, Deploy and Recall, the arena, and Retry, with no camera, model, or external requests during synthetic play. Missing or partial webcam assets blocked activation before permission; permission denial was mocked. Physical webcam tracking was not tested.

Both runs passed 237 of 308 automated tests. The same 71 inherited tests failed in both runs, with no changed test outcomes. See [agent guidance](AGENTS.md#verify-review-and-report) for the affected suites and how to report regressions.
