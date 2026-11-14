curl -L -o ~/Downloads/gesture_recognizer.task \
  https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task

cd ~/Documents/StarshipMania
npm run setup:webcam -- --model ~/Downloads/gesture_recognizer.task --confirm-independent-rights
npm run build
npm run preview
