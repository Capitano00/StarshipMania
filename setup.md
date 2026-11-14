MODEL="$HOME/mediapipe-models/gesture_recognizer.task"
mkdir -p "$(dirname "$MODEL")"

curl -L -o "$MODEL" \
  https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task

cd ~/Documents/StarshipMania
npm run setup:webcam -- --model "$MODEL" --confirm-independent-rights
npm run build
npm run preview
