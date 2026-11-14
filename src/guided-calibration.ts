import type {Controls} from './controls';
import {ResumeIntent} from './resume-intent';

/** Same bounded request as Resume, but completion only captures neutral while paused. */
export class GuidedCalibration {
  private request=new ResumeIntent('calibrate');
  get pending(){return this.request.pending;}
  get result(){return this.request.result;}
  reset(){this.request.reset();}
  cancel(reason='Hand check cancelled - choose Retry hand check when ready'){this.request.cancel(reason);}
  start(now:number,controls:Controls){return controls.paused&&this.request.start(now);}
  update(now:number,controls:Controls){
    if(!controls.paused){this.cancel('Hand check cancelled - controls resumed');return false;}
    return this.request.update(now,controls);
  }
  message(now:number,controls:Controls,source:'off'|'camera'|'synthetic'){
    if(source==='off')return 'Choose Activate webcam or Synthetic rehearsal to begin';
    if(!controls.paused)return 'Neutral captured - controls running. Pause before checking both hands.';
    if(this.pending||this.result)return this.request.message(now,controls);
    return 'Choose Check both hands, then show both open palms comfortably. 3 s to get ready; 10 s to capture. This position becomes your centre. Checking does not start play.';
  }
}
