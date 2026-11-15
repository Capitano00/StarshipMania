import type {Observation} from './controls';
const MAX_FRAME_AGE_MS=200;
// Native Web APIs require their global receiver, not the CameraHost object.
export const captureBitmap=(source:ImageBitmapSource)=>globalThis.createImageBitmap(source);
const TRACKING_BITMAP_MAX_SIDE=320;
/** Keep the preview at native resolution while sending fewer pixels to the local worker. */
export function captureTrackingBitmap(video:HTMLVideoElement) {
  const {videoWidth:width,videoHeight:height}=video;
  const longestSide=Math.max(width,height);
  if(!(width>0&&height>0)||longestSide<=TRACKING_BITMAP_MAX_SIDE)return captureBitmap(video);
  const scale=TRACKING_BITMAP_MAX_SIDE/longestSide;
  return globalThis.createImageBitmap(video,{
    resizeWidth:Math.max(1,Math.round(width*scale)),
    resizeHeight:Math.max(1,Math.round(height*scale)),
    resizeQuality:'low',
  });
}

function captureFailure(error:unknown):string {
  const name=error instanceof Error?error.name:'';
  const detail=name==='InvalidStateError'?'video frame not ready':name==='SecurityError'?'browser blocked frame access':name==='TypeError'?'browser capture API failed':'frame extraction failed';
  return `Frame capture unavailable · ${detail} · camera released; activate webcam again. If repeated, refresh this page in a current Chromium browser.`;
}
export interface CameraHost {
  media:Pick<MediaDevices,'getUserMedia'>;createWorker:()=>Worker;bitmap:(video:HTMLVideoElement)=>Promise<ImageBitmap>;
  now:()=>number;hidden:()=>boolean;
}
/** Owns tracks, one transferred frame and worker lifetime. Never persists sensor data. */
export class CameraInput {
  active=false;loading=false;ready=false;status='Camera off';dropped=0;
  private generation=0;private stream:MediaStream|null=null;private worker:Worker|null=null;private busy=false;private sequence=0;
  private callbackId:number|null=null;private lastPresented=-1;
  private initializationTimer:ReturnType<typeof setTimeout>|null=null;
  constructor(private video:HTMLVideoElement,private epoch:()=>number,private observe:(s:Observation,landmarks?:unknown)=>void,private stopped:(reason:string)=>void,private host:CameraHost={media:navigator.mediaDevices,createWorker:()=>new Worker('/tracking-worker.js'),bitmap:captureTrackingBitmap,now:()=>performance.now(),hidden:()=>document.hidden}){}
  async activate(checkAvailability?:()=>Promise<string|null>) {
    this.stop('Starting camera');const generation=this.generation;this.loading=true;this.status=checkAvailability?'Checking local webcam setup':'Waiting for camera permission';
    if(typeof this.video.requestVideoFrameCallback!=='function'||typeof this.video.cancelVideoFrameCallback!=='function'){this.stop('Frame-delivery API unavailable · camera disabled safely');return;}
    try {
      if(checkAvailability){
        const unavailable=await checkAvailability();
        if(generation!==this.generation)return;
        if(this.host.hidden()){this.stop('Page backgrounded · activate camera again');return;}
        if(unavailable){this.stop(unavailable);return;}
      }
      if(!this.host.media?.getUserMedia){this.stop('Webcam unavailable in this browser · choose Synthetic rehearsal.');return;}
      this.status='Waiting for camera permission';
      const stream=await this.host.media.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}},audio:false});
      if(generation!==this.generation||this.host.hidden()){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.video.srcObject=stream;this.video.muted=true;this.video.playsInline=true;
      stream.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(generation===this.generation)this.stop('Camera disconnected');}));
      await this.video.play();
      if(generation!==this.generation)return;
      if(this.host.hidden()){this.stop('Camera stopped');return;}
      this.active=true;this.status='Loading local hand model';
      this.watchFrames(generation);
      const worker=this.host.createWorker();this.worker=worker;
      worker.onerror=()=>{if(generation===this.generation)this.stop('Tracking worker failed · reactivate deliberately');};
      worker.onmessage=({data})=>{
        if(generation!==this.generation)return;
        if(data.type==='ready'){this.clearInitializationTimer();this.ready=true;this.loading=false;this.status='Local hand model ready';}
        else if(data.type==='observation'){this.busy=false;if(data.epoch===this.epoch()){
          // Keep display-only landmarks out of the retained control observation.
          const {epoch,sequence,capturedAt,hands,processingMs}=data;
          this.observe({epoch,sequence,capturedAt,hands,processingMs},data.landmarks);
        }}
        else if(data.type==='frame-error'){this.busy=false;this.status='Frame rejected';}
        else if(data.type==='error')this.stop('Local model unavailable · '+data.message);
      };
      this.initializationTimer=setTimeout(()=>{if(generation===this.generation)this.stop('Local model initialization timed out · camera released; activate webcam again');},30000);
      worker.postMessage({type:'init'});
    } catch(error) {
      if(generation!==this.generation)return;
      const name=error instanceof Error?error.name:'';
      this.stop(name==='NotAllowedError'||name==='SecurityError'
        ?'Webcam permission denied or blocked · choose Synthetic rehearsal or allow access and activate again.'
        :name==='NotFoundError'?'No webcam found · choose Synthetic rehearsal.'
        :name==='NotReadableError'?'Webcam could not be opened · close other camera apps or choose Synthetic rehearsal.'
        :'Camera unavailable · choose Synthetic rehearsal or activate again.');
    }
  }
  private watchFrames(generation:number) {
    this.callbackId=this.video.requestVideoFrameCallback((_now,metadata)=>{
      if(generation!==this.generation||!this.active)return;
      this.callbackId=null;this.watchFrames(generation);
      if(this.host.hidden()){this.stop('Page backgrounded · activate camera again');return;}
      if(!Number.isSafeInteger(metadata.presentedFrames)||metadata.presentedFrames<=this.lastPresented)return;
      this.lastPresented=metadata.presentedFrames;
      // Browser delivery/compositor time, never the advancing playback clock or callback receipt time.
      const capturedAt=Number.isFinite(metadata.captureTime)?Math.min(metadata.captureTime!,metadata.presentationTime):metadata.presentationTime;
      const now=this.host.now();
      if(!Number.isFinite(capturedAt)||capturedAt>now||now-capturedAt>MAX_FRAME_AGE_MS)return;
      if(!this.ready||this.busy){this.dropped++;return;}
      if(!this.worker||this.video.readyState<2)return;
      return this.captureFrame(generation,capturedAt,this.epoch());
    });
  }
  private async captureFrame(generation:number,capturedAt:number,epoch:number) {
    this.busy=true;
    const sequence=++this.sequence;
    let bitmap:ImageBitmap|undefined;
    try {
      bitmap=await this.host.bitmap(this.video);
      if(generation!==this.generation||epoch!==this.epoch()||this.host.now()-capturedAt>MAX_FRAME_AGE_MS||this.host.hidden()||!this.worker){bitmap.close();if(generation===this.generation)this.busy=false;return;}
      this.worker.postMessage({type:'frame',bitmap,epoch,sequence,capturedAt},[bitmap]);
    } catch(error) {bitmap?.close();if(generation===this.generation)this.stop(captureFailure(error));}
  }
  private clearInitializationTimer(){if(this.initializationTimer!==null)clearTimeout(this.initializationTimer);this.initializationTimer=null;}
  stop(reason='Camera stopped') {
    this.clearInitializationTimer();
    this.generation++;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
    if(this.callbackId!==null)this.video.cancelVideoFrameCallback(this.callbackId);this.callbackId=null;
    this.worker?.terminate();this.worker=null;this.video.pause();this.video.srcObject=null;
    this.active=false;this.loading=false;this.ready=false;this.busy=false;this.lastPresented=-1;this.status=reason;
    this.stopped(reason);
  }
}
