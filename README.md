# StarshipMania

Pilot a mech and command two Padisarah drones in your browser. Play with a keyboard or opt in to local hand tracking. See [provenance](PROVENANCE.md) and [third-party notices](THIRD_PARTY.md) for the ProjectZero baseline and bundled dependencies.

## Run the camera-free build

With Node 24 and npm, from this directory:

    npm ci --ignore-scripts
    npm run build
    npm run preview

Open http://127.0.0.1:4180/. The strict loopback preview applies the document and worker security policy. Stop it with Ctrl+C. The package installation needs registry access or a populated npm cache; rehearsal runs locally.

1. Choose **Play**, then **Play with keyboard**. The game starts after a brief countdown. Move with WASD, aim with the arrow keys, use J for mech fire, H for drone fire, K to deploy, and R to recall. Hold K over a visible target until the order takes effect.
2. Choose **Training** to practise deployments, firing and Recall against indestructible targets with no incoming damage. **Control test and help** on Prepare offers a separate input test and command reference.
3. Press Space to pause or resume. Retry preserves your setup and resets the round. Fire at Will starts off.

**Orbital Relay** is a separate carrier mission. Launch through the marked gate, clear T1 and T3, hold between the violet relay towers for two seconds, then return to the amber extraction pad. The objective shows a compass heading and distance, and the minimap marks the active waypoint. Use the centre lane for a shorter approach or weave around deck cover. Enable **Mission sounds** in Prepare or Settings to hear a short cue at each milestone.

Keyboard play uses the game’s synthetic hand observations and requires no webcam or model files.

## Optional voice commands

On a voice-enabled preview, resume the arena and select **Start voice**. ElevenLabs receives microphone audio while voice is active. The **Voice** tab shows the transcript and the game’s response. You can stop listening at any time.

| Try saying | What happens |
| --- | --- |
| “Recall drones” | Recalls both drones immediately. R does the same. |
| “Send U2 to T3” | Proposes a specific assignment. |
| “Take the far turret” | Asks the two drone workers for a suggestion. “Take the near turret” also works. |
| “Send U2 to T3 when feasible” | Offers to wait until the assignment becomes possible. |
| “Promote order-1” or “Cancel order-1” | Proposes a change to a waiting order. Use the ID shown in **Orders**. |

Approve assignments and queue changes in **Orders**. Those commands require the configured supervisor. See the [voice supervisor setup](src/agent/README.md#elevenlabs-voice-supervisor).

## Optional webcam on an independently authorized machine

The camera starts only after **Activate webcam**, and only if the local assets pass preflight. The asset files are not included; leave webcam setup disabled if you do not independently have rights to use the exact gesture model.

1. Obtain the exact authorized Gesture Recognizer float16/1 model independently. Expected bytes: 8,373,440. SHA-256: 97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482.
2. After installing the locked dependencies, run:

       npm run setup:webcam -- --model "/path/to/gesture_recognizer.task" --confirm-independent-rights
       npm run build
       npm run preview

   The opt-in command checks the local model and five pinned files from installed MediaPipe. It makes no download and grants no rights. It stages only to ignored public/vendor/ and refuses to overwrite an existing one. Use a clean local copy if you need to restage. Rebuild after staging. Keep local vendor assets and generated dist out of shared exports.
3. From **Play** or **Training**, click **Activate webcam**, decide whether to grant permission, and follow calibration. Missing or incomplete assets leave the webcam off. If permission is denied, choose keyboard play or adjust browser settings and explicitly try again. Stop the webcam or leave the page to release the tracks. Camera images and landmarks are processed in memory.

The optional model licence remains unresolved for publication or redistribution. Do not copy it from another private project package. Source share/reuse beyond this staging boundary, event eligibility and public distribution are separate decisions.

## Team development

Clone [StarshipMania](https://github.com/Capitano00/StarshipMania) and open that checkout as the Codex project for game coding. IC-Hackathon-Nov26 remains the coordination project. ProjectZero remains upstream. Confirm event reuse rules before submitting any inherited work.

Verification of the import: locked install and build passed, Synthetic Rehearsal passed in Edge, and seven added tests passed. The inherited suite still has 71 failures (230 passed), matching the upstream baseline. Physical webcam tracking was not verified here.
