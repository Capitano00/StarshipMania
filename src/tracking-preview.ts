import {validHand,type Hand,type Observation} from './controls';
import {recognize,type RecognitionPreset} from './gestures';

type Point={x:number;y:number};
type Overlay={label:string;side:'Left'|'Right';points:Point[];trusted:boolean};
const bones=[[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]];

/** The worker already reflected output coordinates. Only the displayed video is flipped. */
export function previewRect(width:number,height:number,videoWidth:number,videoHeight:number){
  const scale=Math.min(width/videoWidth,height/videoHeight);
  const w=videoWidth*scale,h=videoHeight*scale;
  return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}

/** Display-only, latest-sample memory. Never feeds landmarks back into controls. */
export class TrackingPreview {
  private context:CanvasRenderingContext2D|null;
  private frame:{capturedAt:number;epoch:number;sequence:number;status:string;overlays:Overlay[]}|null=null;
  private visible=true;
  private lastPaintAt=-Infinity;
  private lastPaintKey='';
  private expired:'stale'|'reset'|null=null;
  constructor(private canvas:HTMLCanvasElement,private status:HTMLElement){this.context=canvas.getContext('2d');}
  clear(){this.frame=null;this.expired=null;this.lastPaintAt=-Infinity;this.lastPaintKey='';this.context?.clearRect(0,0,this.canvas.width,this.canvas.height);}
  private message(text:string){if(this.status.textContent!==text)this.status.textContent=text;}
  setVisible(visible:boolean){if(this.visible!==visible)this.clear();this.visible=visible;this.canvas.hidden=!visible;}
  observe(sample:Observation,landmarks:unknown,accepted:boolean,currentEpoch:number,presets:{Left:RecognitionPreset;Right:RecognitionPreset}={Left:'Balanced',Right:'Balanced'}){
    if(!this.visible)return;
    if(this.frame?.epoch===currentEpoch&&sample.sequence<=this.frame.sequence)return;
    const count=sample.hands.length;
    const identity=(hand:Hand)=>sample.epoch===currentEpoch&&count<=2&&(hand.side==='Left'||hand.side==='Right')&&validHand(hand)&&sample.hands.filter(h=>h.side===hand.side).length===1;
    const details=sample.hands.map(hand=>{
      const known=hand.side==='Left'||hand.side==='Right',score=Number.isFinite(hand.confidence)?hand.confidence.toFixed(2):'invalid';
      const pose=known?recognize(hand.gesture,presets[hand.side]):null;
      return `${identity(hand)?hand.side:'Unknown'} identity ${score} · pose ${pose??'uncertain'}${known?' ('+presets[hand.side]+')':''}`;
    }).join(' / ');
    const status=(count===0?'No hands detected · show both open palms':count===1?'One hand detected · detection only, not pair control':accepted?'Two hands · identity checks passed':'Ambiguous tracking · input not accepted')+(details?' · '+details:'');
    const overlays:Overlay[]=[];
    if(Array.isArray(landmarks)&&landmarks.length===count&&count<=2){
      sample.hands.forEach((hand,index)=>{
        const points:unknown=landmarks[index];
        // A partial or malformed skeleton must not appear as a complete hand.
        if(!Array.isArray(points)||points.length!==21||!points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1))return;
        const knownSide=hand.side==='Left'||hand.side==='Right';
        const trusted=accepted&&knownSide&&identity(hand);
        const labelled=identity(hand);
        const label=labelled?(hand.side==='Left'?'L · Left':'R · Right'):'? · uncertain';
        overlays.push({label,side:hand.side,trusted,points:points.map(p=>({x:p.x,y:p.y}))});
      });
    }
    this.expired=null;
    this.frame={capturedAt:sample.capturedAt,epoch:sample.epoch,sequence:sample.sequence,status:status+(count>0&&overlays.length!==count?' · landmark overlay unavailable':''),overlays};
  }
  render(video:HTMLVideoElement,now:number,epoch:number,active:boolean,loading:boolean,acceptedFreshFire=false,fireHand:'Left'|'Right'='Right'){
    const context=this.context;
    if(!active&&!loading){this.clear();this.message('Camera off · no image retained');return;}
    if(!this.visible){this.message('Camera preview hidden');return;}
    if(this.frame&&(this.frame.epoch!==epoch||!Number.isFinite(this.frame.capturedAt)||this.frame.capturedAt>now||now-this.frame.capturedAt>200)){
      this.expired=this.frame.epoch!==epoch?'reset':'stale';this.frame=null;
    }
    this.message(this.frame?.status??(this.expired==='stale'?'Stale tracking · waiting for a fresh sample':this.expired==='reset'?'Tracking reset · waiting for a fresh sample':loading?'Acquiring camera / local model…':'Acquiring hand tracking…'));
    if(!context)return;
    if(!active||video.readyState<2||video.videoWidth<=0||video.videoHeight<=0){
      context.clearRect(0,0,this.canvas.width,this.canvas.height);
      this.lastPaintAt=-Infinity;
      return;
    }
    // Avoid repainting identical overlays at game refresh rate. Changes to tracking
    // or fire indication still paint immediately, including removal of stale marks.
    const paintKey=(this.frame?.sequence??'none')+':'+(acceptedFreshFire?fireHand:'');
    if(paintKey===this.lastPaintKey&&now-this.lastPaintAt<50)return;
    this.lastPaintAt=now;this.lastPaintKey=paintKey;
    context.clearRect(0,0,this.canvas.width,this.canvas.height);
    const rect=previewRect(this.canvas.width,this.canvas.height,video.videoWidth,video.videoHeight);
    context.save();
    try{
      context.translate(rect.x+rect.width,rect.y);context.scale(-1,1);
      context.drawImage(video,0,0,rect.width,rect.height);
    }catch{this.message('Preview frame unavailable · waiting for video');return;}
    finally{context.restore();}
    context.save();context.beginPath();context.rect(rect.x,rect.y,rect.width,rect.height);context.clip();
    for(const hand of this.frame?.overlays??[]){
      const points=hand.points.map(p=>({x:rect.x+p.x*rect.width,y:rect.y+p.y*rect.height}));
      context.strokeStyle=hand.trusted?'#8ce0d2':'#f2c477';context.fillStyle=context.strokeStyle;context.lineWidth=2;
      for(const chain of bones){context.beginPath();chain.forEach((index,i)=>{const p=points[index];if(i===0)context.moveTo(p.x,p.y);else context.lineTo(p.x,p.y);});context.stroke();}
      if(acceptedFreshFire&&hand.trusted&&hand.side===fireHand){
        context.beginPath();context.moveTo(points[4].x,points[4].y);context.lineTo(points[8].x,points[8].y);context.strokeStyle='#ffb65d';context.lineWidth=5;context.stroke();
      }
      for(const p of points){context.beginPath();context.arc(p.x,p.y,2.5,0,Math.PI*2);context.fill();}
      const wrist=points[0],x=Math.max(rect.x+4,Math.min(rect.x+rect.width-98,wrist.x)),y=Math.max(rect.y+18,Math.min(rect.y+rect.height-6,wrist.y+20));
      context.font='bold 14px sans-serif';context.lineWidth=4;context.strokeStyle='#07131c';context.strokeText(hand.label,x,y);context.fillText(hand.label,x,y);
    }
    context.restore();
  }
}
