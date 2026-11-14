import type {Controls} from './controls';

/** A deliberate, bounded request. Observation epochs may change while hands return. */
export class ResumeIntent {
  private countdownEnd:number|null=null;
  result='';
  constructor(private completion:'resume'|'calibrate'='resume'){}
  get pending(){return this.countdownEnd!==null;}
  reset(){this.countdownEnd=null;this.result='';}
  start(now:number){
    if(this.pending||!Number.isFinite(now))return false;
    this.countdownEnd=now+3000;this.result='';return true;
  }
  cancel(reason='Start request cancelled · retry when ready'){
    if(this.pending)this.result=reason;
    this.countdownEnd=null;
  }
  update(now:number,controls:Controls){
    if(this.countdownEnd===null)return false;
    if(now>=this.countdownEnd+10000){this.cancel(`${this.completion==='calibrate'?'Hand check':'Start request'} expired · ${controls.readiness(now).blocker||'no eligible sample arrived before the deadline'} · ${this.completion==='calibrate'?'choose Retry hand check':'choose Retry or Recalibrate neutral'}`);return false;}
    if(now<this.countdownEnd||controls.latest?.epoch!==controls.epoch||controls.latest.capturedAt<this.countdownEnd||!controls.readiness(now).ready)return false;
    if(!(this.completion==='calibrate'?controls.calibrate(now):controls.resume(now)))return false;
    this.countdownEnd=null;this.result=this.completion==='calibrate'?'Both hands checked · neutral captured · still paused. Choose Test controls.':'';return true;
  }
  message(now:number,controls?:Controls){
    if(this.countdownEnd===null)return this.result;
    if(now<this.countdownEnd)return `${this.completion==='calibrate'?'Check both hands in':'Starting in'} ${Math.ceil((this.countdownEnd-now)/1000)} · open both hands comfortably; this position becomes your centre`;
    const blocker=controls?.readiness(now).blocker;
    return `Waiting for fresh, open hands to recenter · ${Math.ceil((this.countdownEnd+10000-now)/1000)} s left${blocker?' · '+blocker:''}`;
  }
}
