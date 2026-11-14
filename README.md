# StarshipMania: import ProjectZero v0.4.3 with optional webcam controls

Private team staging for a browser prototype. Open **Synthetic rehearsal** to try the controls without a webcam, model, or downloaded tracking assets. The interface retains its original ProjectZero / Padisarah labels. See [provenance](PROVENANCE.md) and [third-party notices](THIRD_PARTY.md) before reuse.

## Run the camera-free build

With Node 24 and npm, from this directory:

    npm ci --ignore-scripts
    npm run build
    npm run preview

Open http://127.0.0.1:4180/. The strict loopback preview applies the document and worker security policy. Stop it with Ctrl+C. The package installation needs registry access or a populated npm cache; rehearsal runs locally.

1. Confirm **v0.4.3** and **Camera off**. Choose **Synthetic rehearsal**, then **Check both hands** and wait for the neutral countdown.
2. Choose **Test controls** for the setup control test, or **Practise Padisarah** for the arena tutorial. Follow the displayed control and aiming prompts. Keyboard synthetic observations go through the inherited control path.
3. Try manual Deploy and Recall, then enter the arena. Retry preserves setup and resets the round; Fire at Will starts OFF.

Synthetic rehearsal demonstrates the software controls. It does not validate physical tracking, accessibility, or release eligibility.

## Optional webcam on an independently authorized machine

The camera starts only after **Activate webcam**, and only if the local assets pass preflight. The asset files are not included; leave webcam setup disabled if you do not independently have rights to use the exact gesture model.

1. Obtain the exact authorized Gesture Recognizer float16/1 model independently. Expected bytes: 8,373,440. SHA-256: 97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482.
2. After installing the locked dependencies, run:

       npm run setup:webcam -- --model "/path/to/gesture_recognizer.task" --confirm-independent-rights
       npm run build
       npm run preview

   The opt-in command checks the local model and five pinned files from installed MediaPipe. It makes no download and grants no rights. It stages only to ignored public/vendor/ and refuses to overwrite an existing one. Use a clean local copy if you need to restage. Rebuild after staging. Keep local vendor assets and generated dist out of shared exports.
3. Click **Activate webcam**, decide whether to grant permission, and follow calibration. Missing or incomplete assets leave the webcam off. If permission is denied, choose Synthetic rehearsal or adjust browser settings and explicitly try again. Stop the webcam or leave the page to release the tracks. Camera images and landmarks are processed in memory; no audio, recording or sensor transmission is enabled.

The optional model licence remains unresolved for publication or redistribution. Do not copy it from another private project package. Source share/reuse beyond this staging boundary, event eligibility and public distribution are separate decisions.

## Team development

Clone [StarshipMania](https://github.com/Capitano00/StarshipMania) and open that checkout as the Codex project for game coding. IC-Hackathon-Nov26 remains the coordination project. ProjectZero remains upstream. Confirm event reuse rules before submitting any inherited work.

Verification of the import: locked install and build passed, Synthetic Rehearsal passed in Edge, and seven added tests passed. The inherited suite still has 71 failures (230 passed), matching the upstream baseline. Physical webcam tracking was not verified here.
