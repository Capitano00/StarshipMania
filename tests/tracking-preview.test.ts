import {describe,expect,it,vi} from 'vitest';
import {TrackingPreview,previewRect} from '../src/tracking-preview';
import type {Observation} from '../src/controls';

function sample(count=2):Observation{return {epoch:0,sequence:1,capturedAt:100,processingMs:10,hands:Array.from({length:count},(_,i)=>({side:i===0?'Left':'Right',confidence:1,palm:{x:i===0?.25:.75,y:.5},gesture:{category:'Open_Palm',score:1}}))};}
const skeletons=(count=2)=>Array.from({length:count},(_,i)=>Array.from({length:21},()=>({x:i===0?.25:.75,y:.5})));
function fixture(){
  const context={clearRect:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),scale:vi.fn(),drawImage:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),arc:vi.fn(),fill:vi.fn(),strokeText:vi.fn(),fillText:vi.fn()};
  const canvas={width:320,height:240,hidden:false,getContext:()=>context} as unknown as HTMLCanvasElement;
  const status={textContent:''} as HTMLElement;
  const video={readyState:2,videoWidth:640,videoHeight:480} as HTMLVideoElement;
  const preview=new TrackingPreview(canvas,status);
  return {context,canvas,status,video,preview,render:(now=100,epoch=0,active=true,loading=false,acceptedFreshFire=false)=>preview.render(video,now,epoch,active,loading,acceptedFreshFire)};
}
describe('display-only tracking preview with synthetic canvas host',()=>{
  it('mirrors only the raw video and draws already-mirrored anatomical landmarks without another flip',()=>{
    const f=fixture();f.preview.observe(sample(),skeletons(),true,0);f.render();
    expect(f.context.translate).toHaveBeenCalledWith(320,0);expect(f.context.scale).toHaveBeenCalledExactlyOnceWith(-1,1);
    expect(f.context.drawImage).toHaveBeenCalledWith(f.video,0,0,320,240);
    expect(f.context.arc).toHaveBeenCalledWith(80,120,2.5,0,Math.PI*2);expect(f.context.arc).toHaveBeenCalledWith(240,120,2.5,0,Math.PI*2);
    expect(f.context.fillText).toHaveBeenCalledWith('L · Left',80,140);expect(f.context.fillText).toHaveBeenCalledWith('R · Right',222,140);
  });
  it('letterboxes non-4:3 video and overlays points in the same fitted rectangle',()=>{
    const f=fixture();Object.assign(f.video,{videoWidth:480,videoHeight:640});
    expect(previewRect(320,240,480,640)).toEqual({x:70,y:0,width:180,height:240});
    f.preview.observe(sample(),skeletons(),true,0);f.render();expect(f.context.translate).toHaveBeenCalledWith(250,0);expect(f.context.arc).toHaveBeenCalledWith(115,120,2.5,0,Math.PI*2);
  });
  it.each([[0,false,'No hands'],[1,false,'One hand'],[2,false,'Ambiguous tracking'],[2,true,'identity checks passed']] as const)('labels %i observed hands truthfully (accepted=%s)',(count,accepted,text)=>{
    const f=fixture();f.preview.observe(sample(count),skeletons(count),accepted,0);f.render();expect(f.status.textContent).toContain(text);
    if(count===2)expect(f.context.fillText).toHaveBeenCalledWith('L · Left',80,140);
    if(count===1){expect(f.context.fillText).toHaveBeenCalledWith('L · Left',80,140);expect(f.status.textContent).toContain('detection only, not pair control');}
  });
  it('identity labels do not depend on open pose or gesture score',()=>{
    for(const gesture of [{category:'Closed_Fist',score:1},{category:'Open_Palm',score:.4},{category:'None',score:1}]){const f=fixture(),s=sample(1);s.hands[0].gesture=gesture;f.preview.observe(s,skeletons(1),false,0);f.render();expect(f.context.fillText).toHaveBeenCalledWith('L · Left',80,140);expect(f.status.textContent).toContain('Left identity 1.00');expect(f.status.textContent).toContain('pose '+(gesture.category==='Closed_Fist'?'Closed_Fist':'uncertain'));}
  });
  it.each([['Forgiving',.6,'Open_Palm'],['Balanced',.6,'uncertain'],['Strict',.7,'uncertain'],['Strict',.8,'Open_Palm']] as const)('uses active %s preset for pose %s while keeping identity separate',(preset,score,pose)=>{
    const f=fixture(),s=sample(1);s.hands[0].gesture!.score=score;f.preview.observe(s,skeletons(1),false,0,{Left:preset,Right:'Balanced'});f.render();expect(f.context.fillText).toHaveBeenCalledWith('L · Left',80,140);expect(f.status.textContent).toContain(`pose ${pose} (${preset})`);
  });
  it('unknown, low-confidence and duplicate identities stay untrusted; old epochs are not relabelled current',()=>{
    for(const change of [{confidence:.74},{side:'Unknown'}]){const f=fixture(),s=sample(1);Object.assign(s.hands[0],change);f.preview.observe(s,skeletons(1),false,0);f.render();expect(f.context.fillText).toHaveBeenCalledWith('? · uncertain',80,140);expect(f.status.textContent).toContain('Unknown identity');}
    const duplicate=fixture(),s=sample();s.hands[1].side='Left';duplicate.preview.observe(s,skeletons(),false,0);duplicate.render();expect(duplicate.context.fillText.mock.calls.every(call=>call[0]==='? · uncertain')).toBe(true);
    const f=fixture();f.preview.observe(sample(1),skeletons(1),false,1);f.render(100,1);expect(f.context.fillText).not.toHaveBeenCalled();expect(f.status.textContent).toContain('Tracking reset');
  });
  it('limits repeated preview paints while removing stale landmarks immediately',()=>{
    const f=fixture();f.preview.observe(sample(),skeletons(),true,0);
    f.render(270);f.render(280);f.render(300);
    expect(f.context.drawImage).toHaveBeenCalledTimes(1);
    f.context.arc.mockClear();f.render(301);
    expect(f.context.drawImage).toHaveBeenCalledTimes(2);
    expect(f.context.arc).not.toHaveBeenCalled();
    expect(f.status.textContent).toContain('Stale');
  });
  it('distinguishes acquiring, stale and epoch-reset states and discards stale landmark drawings',()=>{
    const f=fixture();f.render(100,0,false,true);expect(f.status.textContent).toContain('Acquiring');
    f.preview.observe(sample(),skeletons(),true,0);f.render(300);expect(f.context.arc).toHaveBeenCalledTimes(42);
    f.context.arc.mockClear();f.render(301);expect(f.context.arc).not.toHaveBeenCalled();expect(f.status.textContent).toContain('Stale');
    f.preview.observe({...sample(),sequence:2,capturedAt:302},skeletons(),true,0);f.render(302,1);expect(f.status.textContent).toContain('Tracking reset');expect(f.context.arc).not.toHaveBeenCalled();
  });
  it('highlights the right thumb-index connection only for accepted fresh fire',()=>{
    const f=fixture(),points=skeletons();points[1][4]={x:.7,y:.45};points[1][8]={x:.8,y:.55};f.preview.observe(sample(),points,true,0);f.render(100,0,true,false);
    expect(f.context.moveTo).not.toHaveBeenCalledWith(224,108);f.context.moveTo.mockClear();f.context.lineTo.mockClear();const styles:{lineWidth:number;strokeStyle:string}[]=[];f.context.stroke.mockImplementation(()=>styles.push({lineWidth:(f.context as any).lineWidth,strokeStyle:(f.context as any).strokeStyle}));f.render(100,0,true,false,true);
    expect(f.context.moveTo).toHaveBeenCalledWith(224,108);expect(f.context.lineTo).toHaveBeenCalledWith(256,132);expect(styles).toContainEqual({lineWidth:5,strokeStyle:'#ffb65d'});
    f.context.moveTo.mockClear();f.preview.observe({...sample(),sequence:2,capturedAt:301},points,true,0);f.render(502,0,true,false,true);expect(f.context.moveTo).not.toHaveBeenCalledWith(224,108);
  });
  it.each([{points:[]},{points:[[{x:.5,y:.5}]]},{points:[[...skeletons(1)[0].slice(0,20),{x:NaN,y:.5}]]},{points:[[...skeletons(1)[0].slice(0,20),{x:1.1,y:.5}]]}])('rejects missing, partial or invalid point sets without inventing a skeleton',({points})=>{
    const f=fixture();f.preview.observe(sample(1),points,false,0);f.render();expect(f.context.arc).not.toHaveBeenCalled();expect(f.status.textContent).toContain('overlay unavailable');
  });
  it('hide and camera stop clear pixels and release observations; reshow waits for new data',()=>{
    const f=fixture();f.preview.observe(sample(),skeletons(),true,0);f.render();f.context.drawImage.mockClear();f.context.arc.mockClear();
    f.preview.setVisible(false);expect(f.canvas.hidden).toBe(true);f.preview.observe({...sample(),sequence:2},skeletons(),true,0);f.render();
    expect(f.status.textContent).toBe('Camera preview hidden');expect(f.context.drawImage).not.toHaveBeenCalled();
    f.preview.setVisible(true);f.render();expect(f.context.arc).not.toHaveBeenCalled();expect(f.status.textContent).toContain('Acquiring');
    f.preview.observe({...sample(),sequence:3},skeletons(),true,0);f.context.drawImage.mockClear();f.render(100,0,false,false);expect(f.context.drawImage).not.toHaveBeenCalled();expect(f.status.textContent).toContain('Camera off');
    f.render();expect(f.context.arc).not.toHaveBeenCalled();expect(f.status.textContent).toContain('Acquiring');
  });
  it('preview drawing failure cannot escape into the control loop',()=>{
    const f=fixture();f.context.drawImage.mockImplementation(()=>{throw new Error('synthetic not-ready video');});expect(()=>f.render()).not.toThrow();expect(f.status.textContent).toContain('Preview frame unavailable');expect(f.context.restore).toHaveBeenCalledOnce();
  });
});
