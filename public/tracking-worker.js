let landmarker;
self.onmessage=async({data})=>{
 if(data.type==='init'){
  try{
   const {GestureRecognizer,FilesetResolver}=await import('/vendor/vision_bundle.mjs');
   const vision=await FilesetResolver.forVisionTasks('/vendor/wasm');
   landmarker=await GestureRecognizer.createFromOptions(vision,{baseOptions:{modelAssetPath:'/vendor/gesture_recognizer.task',delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.65,minHandPresenceConfidence:.65,minTrackingConfidence:.65,cannedGesturesClassifierOptions:{scoreThreshold:0}});
   self.postMessage({type:'ready'});
  }catch{self.postMessage({type:'error',message:'Local gesture model failed to initialize'});}
  return;
 }
 if(data.type!=='frame')return;
 const {bitmap,epoch,sequence,capturedAt}=data;
 try{
  if(!landmarker)throw new Error('not ready');
  const start=performance.now(),result=landmarker.recognizeForVideo(bitmap,capturedAt);
  const hands=result.landmarks.map((points,i)=>{
   const indices=[0,5,9,13,17],label=result.handedness[i]?.[0],category=result.gestures[i]?.[0];
   return {side:label?.categoryName??'Unknown',confidence:label?.score??0,palm:{x:1-indices.reduce((sum,k)=>sum+points[k].x,0)/5,y:indices.reduce((sum,k)=>sum+points[k].y,0)/5},gesture:{category:category?.categoryName??'None',score:Number.isFinite(category?.score)?category.score:0}};
  });
  const landmarks=result.landmarks.map(points=>points.map(({x,y})=>({x:1-x,y})));
  self.postMessage({type:'observation',epoch,sequence,capturedAt,hands,processingMs:performance.now()-start,landmarks});
 }catch{self.postMessage({type:'frame-error',epoch,sequence,message:'Local gesture frame unavailable'});}
 finally{bitmap?.close();}
};
