import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Simulation as SimulationType} from '../src/simulation';
import type {Observation} from '../src/controls';

const state=vi.hoisted(()=>({failView:false,sim:null as SimulationType|null,resize:vi.fn(),emitCamera:(_count:number,_side?:'Left'|'Right')=>{}}));
vi.mock('../src/view',()=>({ArenaView:class {
  constructor(){if(state.failView)throw new Error('injected WebGL failure');}
  resize(){state.resize(state.sim?.mode);} draw(){}
  projectWorld(){return {x:0,y:0};}
  projectFixtureTarget(){return {x:0,y:0};}
  aim(){const target=state.sim!.turrets.find(t=>t.health>0);return {point:target?.position??{x:0,y:0},target:target?.id??null};}
}}));
vi.mock('../src/simulation',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../src/simulation')>();
  return {...original,Simulation:class extends original.Simulation {
    constructor(runId?:string,mode:'combat'|'training'='combat'){super(runId,mode);state.sim=this;}
  }};
});
vi.mock('../src/camera',()=>({captureBitmap:vi.fn(),CameraInput:class {
  active=false;loading=false;status='Camera off';
  constructor(_video:unknown,epoch:()=>number,observe:(s:Observation,landmarks?:unknown)=>void,private stopped:(s:string)=>void){let sequence=0;state.emitCamera=(count,side)=>{const hands:Observation['hands']=Array.from({length:count},(_,i)=>({side:side??(i===0?'Left':'Right'),palm:{x:side==='Right'?.7:i===0?.3:.7,y:.5},gesture:{category:'Open_Palm',score:1},confidence:1}));observe({epoch:epoch(),sequence:++sequence,capturedAt:performance.now(),hands,processingMs:0},hands.map(h=>Array.from({length:21},()=>({...h.palm}))));};}
  stop(reason:string){this.active=false;this.loading=false;this.stopped(reason);} pump(){} activate(){this.stop('Starting mock camera');this.active=true;this.status='Synthetic camera host';}
}}));

// Minimal DOM host: execute the actual page handlers/controller/clock/simulation.
// Rendering and hardware are replaced; this is not browser or camera evidence.
class Element extends EventTarget {
  tagName='div';contentEditable=false;parent:Element|null=null;
  hidden=false;disabled=false;open=false;textContent='';innerHTML='';value=0;
  style:Record<string,string>={};classList={toggle:vi.fn()};
  onclick:(()=>void)|null=null;onchange:(()=>void)|null=null;
  click(){if(!this.disabled)this.onclick?.();}
  closest(selectors:string):Element|null{return selectors.split(',').some(selector=>selector===this.tagName||(selector==='[contenteditable="true"]'&&this.contentEditable))?this:this.parent?.closest(selectors)??null;}
  getContext(){return null;}
  setAttribute(){}
  showModal(){} close(){}
  querySelector(){return get('eyebrow');} append(){} after(){} focus(){}
}
let nodes:Map<string,Element>,doc:EventTarget&{hidden:boolean},win:EventTarget;
let now:number,frame:FrameRequestCallback;
function get(id:string){if(!nodes.has(id)){const element=new Element();element.tagName=['move-sensitivity','aim-sensitivity'].includes(id)?'input':['restart','resume','start-practice'].includes(id)?'button':id==='settings-summary'?'summary':'div';nodes.set(id,element);}return nodes.get(id)!;}
function advance(ms=500){const end=now+ms;while(now<end){now+=Math.min(20,end-now);frame(now);}}
function key(value:string,type='keydown',target?:Element){const event=new Event(type,{cancelable:true});Object.assign(event,{key:value,repeat:false});if(target)Object.defineProperty(event,'target',{value:target});doc.dispatchEvent(event);return event;}
async function setup(search=''){
  vi.resetModules();state.failView=false;state.sim=null;state.resize.mockClear();nodes=new Map();now=0;
  doc=Object.assign(new EventTarget(),{hidden:false,getElementById:get,querySelector:()=>get('app'),createElement:()=>new Element()});
  win=new EventTarget();get('arena').hidden=true;
  vi.stubGlobal('document',doc);vi.stubGlobal('window',win);vi.stubGlobal('location',{search});
  vi.stubGlobal('HTMLElement',Element);
  vi.stubGlobal('performance',{now:()=>now});vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frame=cb;return 1;});
  await import('../src/main');
  get('synthetic').click();advance();get('calibrate').click();advance(3020);
  expect(get('enter').disabled).toBe(false);
}
function enter(){get('enter').click();advance();get('resume').click();advance(3100);}
beforeEach(()=>setup());
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('page lifecycle with synthetic observations and mocked rendering',()=>{
  it('loss of a remapped initiating hand logs its pending cancellation once, without pausing combat',()=>{
    enter();get('menu-bindings').click();Object.assign(get('binding-deploy'),{value:'Right:Pointing_Up'});get('apply-bindings').click();get('close-settings').click();get('resume').click();advance(3100);
    key('k');advance(300);expect(get('preview-text').textContent).toContain('Confirming');get('loss-synthetic').click();advance(100);expect(state.sim!.events.entries.filter(e=>e.outcome==='Cancelled')).toHaveLength(1);expect(state.sim!.accepted).toBe(0);expect(get('pause-overlay').hidden).toBe(true);
  });
  it('persistent Retry retires an uncommitted preview before creating a clean round',()=>{
    for(const training of [false,true]){
      if(training){get('train').click();advance(3100);}else enter();
      key('k');advance(400);expect(get('preview-text').textContent).toContain('Confirming');const old=state.sim!;
      get('arena-retry').click();const fresh=state.sim!;expect(fresh).not.toBe(old);expect(fresh.events.entries).toEqual([]);expect(fresh.accepted).toBe(0);expect(fresh.projectiles).toEqual([]);
      advance(20);expect(fresh.events.entries).toEqual([]);get('cancel-resume').click();advance(14000);expect(fresh.tick).toBe(0);expect(fresh.events.entries).toEqual([]);
      get('resume').click();advance(3100);expect(fresh.accepted).toBe(0);expect(fresh.events.entries).toEqual([]);expect(fresh.pilotFire||fresh.padisarahFire).toBe(false);
    }
  });
  it('v0.4 menu retry retains current mode and setup across repeated arena and training retries',()=>{
    enter();for(const mode of ['combat','training'] as const){if(mode==='training'){get('train').click();advance(3100);}
      for(let i=0;i<2;i++){key('h');key('j');advance(120);get('arena-pause').click();advance(20);const old=state.sim!;expect(old.padisarahFire||old.pilotFire).toBe(false);
        get('menu-retry').click();advance(20);expect(state.sim!.runId).not.toBe(old.runId);expect(state.sim!.mode).toBe(mode);expect(state.sim!.events.entries).toEqual([]);expect(get('setup').hidden).toBe(true);expect(get('resume-status').textContent).toContain('Starting in');advance(3100);expect(state.sim!.accepted).toBe(0);expect(state.sim!.pilotFire||state.sim!.padisarahFire).toBe(false);
      }
    }
  });
  it('v0.4 settings applies validated cross-hand bindings, opt-in autofire, and cannot silently resume',()=>{
    enter();get('menu-bindings').click();Object.assign(get('binding-recall'),{value:'Right:Victory'});Object.assign(get('binding-duration'),{value:'0.5'});Object.assign(get('autofire'),{checked:true});get('apply-bindings').click();expect(get('binding-error').textContent).toContain('Applied');get('close-settings').click();advance(4000);expect(get('tracking-state').textContent).toBe('PAUSED');get('resume').click();advance(3100);expect(get('unit-fire-status').textContent).toContain('AUTO FIRE ON');key('v');advance(540);expect(state.sim!.recalls).toBe(1);
    get('settings').click();Object.assign(get('binding-recall'),{value:'Left:Pointing_Up'});get('apply-bindings').click();expect(get('binding-error').textContent).toContain('only one');get('reset-bindings').click();get('close-settings').click();advance(20);expect(get('unit-fire-status').textContent).not.toContain('AUTO FIRE ON');
  });
  it('v0.4 manual Padisarah fire is independent and cancellation is logged once',()=>{
    enter();key('k');advance(1600);key('k','keyup');advance(3000);expect(state.sim!.padisarahHits).toBe(0);key('h');key('j');advance(120);expect(state.sim!.padisarahFire&&state.sim!.pilotFire).toBe(true);key('h','keyup');advance(20);expect(state.sim!.padisarahFire).toBe(false);expect(state.sim!.pilotFire).toBe(true);key('k');advance(100);get('cancel').click();advance(40);expect(state.sim!.events.entries.filter(e=>e.outcome==='Cancelled')).toHaveLength(1);
  });
  it('unknown worker identity is diagnostic only and cannot stop the animation loop',()=>{
    get('activate').click();advance(20);state.emitCamera(1,'Unknown' as 'Left');expect(()=>advance(20)).not.toThrow();expect(get('input-fresh').textContent).toContain('unknown hand identity');expect(get('tracking-state').textContent).toBe('PAUSED');expect(get('practice-fire').textContent).toContain('Blocked');
    state.emitCamera(2);expect(()=>advance(20)).not.toThrow();expect(get('readiness-hands').textContent).toContain('Ready');
  });
  it('practice Victory has persistent bounded input-only feedback independent of fire and clears on restart/epoch',()=>{
    get('start-practice').click();advance(3020);key('j');key('v');advance(1540);expect(get('practice-feedback').textContent).toBe('Recall input confirmed - practice only');expect(get('practice-fire').textContent).toContain('Fire input held');expect(state.sim!.recalls).toBe(0);
    advance(20);expect(get('practice-feedback').textContent).toContain('Recall input confirmed');advance(2000);expect(get('practice-feedback').textContent).not.toContain('Recall input confirmed');
    key('v','keyup');advance(20);key('v');advance(1540);expect(get('practice-feedback').textContent).toContain('Recall input confirmed');get('restart').click();advance(20);expect(get('practice-feedback').textContent).not.toContain('Recall input confirmed');
    get('start-practice').click();advance(3020);key('v');advance(1540);expect(get('practice-feedback').textContent).toContain('Recall input confirmed');get('stop').click();advance(20);expect(get('practice-feedback').textContent).not.toContain('Recall input confirmed');
  });
  it('gesture guide pauses play and preset changes cancel countdown without touching palm gains',()=>{
    enter();get('open-gesture-guide').click();advance(20);const tick=state.sim!.tick;expect(get('tracking-state').textContent).toBe('PAUSED');
    Object.assign(get('preset-Left'),{value:'Forgiving'});get('preset-Left').onchange?.();advance(20);expect(get('input-presets').textContent).toContain('Left Forgiving / Right Balanced');expect(get('move-sensitivity-value').textContent).toBe('1.0×');
    get('close-settings').click();advance(4000);expect(state.sim!.tick).toBe(tick);get('resume').click();advance(1000);
    Object.assign(get('preset-Right'),{value:'Strict'});get('preset-Right').onchange?.();advance(4000);expect(state.sim!.tick).toBe(tick);expect(get('cancel-resume').hidden).toBe(true);
    get('resume').click();advance(3100);expect(get('preset-Left').disabled).toBe(true);Object.assign(get('preset-Left'),{value:'Strict'});get('preset-Left').onchange?.();advance(20);expect(get('input-presets').textContent).toContain('Left Forgiving / Right Strict');
  });
  it('inspector details remain available without pausing; resizing preserves the round',()=>{
    Object.assign(win,{innerWidth:640});enter();expect(get('arena-details').open).toBe(true);const run=state.sim;
    key('k');advance(40);expect(get('arena-details-summary').textContent).toContain('Confirming');advance(400);expect(get('arena-details-summary').textContent).toContain('Confirming');key('k','keyup');advance(20);
    get('arena-details').open=true;get('arena-details').dispatchEvent(new Event('toggle'));advance(20);expect(get('tracking-state').textContent).toBe('TRACKING');
    Object.assign(win,{innerWidth:1280});win.dispatchEvent(new Event('resize'));expect(get('arena-details').open).toBe(true);expect(state.sim).toBe(run);
    Object.assign(win,{innerWidth:640});win.dispatchEvent(new Event('resize'));expect(get('arena-details').open).toBe(true);expect(state.sim).toBe(run);
  });
  it('training -> Controls -> Enter arena creates combat, resizes after the mode class, and preserves session settings',()=>{
    get('move-sensitivity').value=1.4;get('move-sensitivity').dispatchEvent(new Event('input'));
    get('train').click();advance(3020);const training=state.sim!;expect(training.mode).toBe('training');
    get('back').click();advance(20);get('arena').classList.toggle.mockClear();state.resize.mockClear();get('enter').click();advance(20);
    const combat=state.sim!;expect(combat).not.toBe(training);expect(combat.mode).toBe('combat');expect(combat.results).toEqual({turretsCleared:0,deployments:0,recalls:0,padisarahHits:0});
    expect(get('move-sensitivity-value').textContent).toBe('1.4×');expect(get('setup').hidden).toBe(true);expect(get('tracking-state').textContent).toBe('PAUSED');
    expect(get('arena').classList.toggle).toHaveBeenCalledWith('is-training',false);expect(state.resize).toHaveBeenCalledWith('combat');
    expect(get('arena').classList.toggle.mock.invocationCallOrder[0]).toBeLessThan(state.resize.mock.invocationCallOrder[0]);
    get('resume').click();advance(3020);expect(combat.tick).toBeGreaterThan(0);
    get('back').click();advance(20);const tick=combat.tick;get('enter').click();advance(20);expect(state.sim).toBe(combat);expect(combat.tick).toBe(tick);
    get('resume').click();advance(3020);expect(combat.tick).toBeGreaterThan(tick);
  });
  it('v0.2 settings pauses, cancels start and shortcuts, then requires explicit resume',()=>{
    enter();get('settings').click();advance(20);const tick=state.sim!.tick;
    key(' ');key('r');key('c');key('j');advance(14000);expect(state.sim!.tick).toBe(tick);expect(state.sim!.accepted).toBe(0);
    get('close-settings').click();advance(4000);expect(state.sim!.tick).toBe(tick);
    get('resume').click();advance(1000);get('settings').click();get('close-settings').click();advance(14000);expect(state.sim!.tick).toBe(tick);
    get('resume').click();advance(3020);expect(state.sim!.tick).toBeGreaterThan(tick);
  });
  it('v0.2 consecutive wins and losses replay in arena with setup/sensitivity retained and clean run state',()=>{
    get('move-sensitivity').value=1.5;get('move-sensitivity').dispatchEvent(new Event('input'));enter();
    for(const outcome of ['won','won','lost','lost'] as const){
      const old=state.sim!;if(outcome==='won')old.turrets.forEach(t=>t.health=0);else old.health=0;advance(40);
      expect(old.outcome).toBe(outcome);expect(get('results-panel').hidden).toBe(false);
      get('play-again').click();advance(20);const fresh=state.sim!;expect(fresh).not.toBe(old);expect(fresh.tick).toBe(0);expect(fresh.results).toEqual({turretsCleared:0,deployments:0,recalls:0,padisarahHits:0});expect(fresh.projectiles).toHaveLength(0);
      expect(get('setup').hidden).toBe(true);expect(get('arena').hidden).toBe(false);expect(get('move-sensitivity-value').textContent).toBe('1.5×');expect(get('resume-status').textContent).toContain('Starting in');
      advance(3020);expect(get('tracking-state').textContent).toBe('TRACKING');expect(fresh.accepted).toBe(0);expect(get('weapon-status').textContent).toContain('Ready');
    }
  });
  it('v0.2 training switches and retry reset only the round; camera-off replay cannot start later',()=>{
    get('train').click();advance(3020);expect(state.sim!.mode).toBe('training');expect(get('training-panel').hidden).toBe(false);
    const old=state.sim!;get('retry-training').click();advance(3020);expect(state.sim).not.toBe(old);expect(state.sim!.trainingStep).toBe(0);
    get('leave-training').click();advance(3020);expect(state.sim!.mode).toBe('combat');expect(get('training-panel').hidden).toBe(true);
    get('stop').click();get('play-again').click();advance(14000);expect(state.sim!.tick).toBe(0);expect(get('recover-camera').hidden).toBe(false);
  });
  it('Space on a focused settings summary preserves native disclosure without requesting resume',()=>{
    get('enter').click();advance(20);const event=key(' ','keydown',get('settings-summary'));
    expect(event.defaultPrevented).toBe(false);advance(3500);expect(get('tracking-state').textContent).toBe('PAUSED');expect(get('cancel-resume').hidden).toBe(true);
  });
  it.each(['move-sensitivity','aim-sensitivity'])('Escape focused on %s cancels pending start before the input guard',id=>{
    get('enter').click();advance(20);get('resume').click();advance(100);expect(get('cancel-resume').hidden).toBe(false);key('Escape','keydown',get(id));
    advance(14000);expect(get('cancel-resume').hidden).toBe(true);expect(get('tracking-state').textContent).toBe('PAUSED');expect(state.sim!.tick).toBe(0);
    get('resume').click();advance(3100);expect(get('tracking-state').textContent).toBe('TRACKING');
  });
  it('local practice start counts down, independently acknowledges fire and funnel, and pauses immediately',()=>{
    get('start-practice').click();advance(2900);expect(get('tracking-state').textContent).toBe('PAUSED');expect(get('practice-start-status').textContent).toContain('Starting in 1');
    advance(120);expect(get('practice-fire').textContent).toContain('Ready');key('j');advance(100);expect(get('practice-fire').textContent).toContain('Fire input held');
    key('k');advance(1560);key('k','keyup');advance(20);expect(get('practice-feedback').textContent).toBe('Practice committed T1');expect(get('practice-fire').textContent).toContain('Fire input held');
    key('j','keyup');advance(20);expect(get('practice-fire').textContent).toContain('Stopped');advance(2200);expect(get('practice-fire').textContent).toContain('Stopped');
    expect(state.sim!.tick).toBe(0);expect(state.sim!.projectiles).toHaveLength(0);get('pause-practice').click();advance(20);expect(get('practice-fire').textContent).toContain('Blocked · paused');
    get('test-controls').click();advance(3020);expect(get('practice-fire').textContent).toContain('Ready');
  });
  it('shows actionable readiness and separate collapsed read-only input diagnostics without changing sensitivity controls',()=>{
    advance(500);expect(get('readiness-summary').textContent).toBe('Start readiness · 3 / 3');expect(get('readiness-camera').textContent).toContain('synthetic rehearsal');expect(get('readiness-hands').textContent).toContain('Ready');expect(get('readiness-open').textContent).toContain('Ready');expect(get('readiness-guidance').textContent).toContain('this position becomes your centre');
    expect(get('input-details-summary').textContent).toContain('local and transient');expect(get('input-right-gesture').textContent).toContain('Open_Palm');expect(get('move-sensitivity-value').textContent).toBe('1.0×');expect(get('aim-sensitivity-value').textContent).toBe('1.0×');
    key('j');advance(100);expect(get('readiness-open').textContent).toContain('Needs attention');expect(get('practice-fire').textContent).toContain('Blocked');key('j','keyup');advance(420);expect(get('readiness-summary').textContent).toBe('Start readiness · 3 / 3');
    get('loss-synthetic').click();advance(20);expect(get('readiness-hands').textContent).toContain('Needs attention');expect(get('readiness-summary').textContent).not.toContain('3 / 3');get('loss-synthetic').click();advance(420);
  });
  it('countdown tolerates no hands and held pinches, then resumes without catch-up or old actions',()=>{
    enter();key('j');key('k');advance(400);get('pause').click();advance(20);const tick=state.sim!.tick;get('resume').click();get('loss-synthetic').click();advance(3500);
    expect(state.sim!.tick).toBe(tick);expect(get('resume-status').textContent).toContain('Waiting for fresh');expect(get('preview-text').textContent).not.toContain('Confirming');
    get('loss-synthetic').click();advance(500);expect(state.sim!.tick).toBe(tick);get('neutral-synthetic').click();advance(20);
    expect(get('tracking-state').textContent).toBe('TRACKING');expect(state.sim!.tick-tick).toBeLessThan(4);expect(state.sim!.accepted).toBe(0);expect(get('weapon-status').textContent).toContain('Ready');
    key(' ');const paused=state.sim!.tick;advance(1500);expect(state.sim!.tick).toBe(paused);expect(get('tracking-state').textContent).toBe('PAUSED');
  });
  it('starts from a shifted open pose at countdown end with neutral capture output',()=>{
    get('start-practice').click();key('d');key('ArrowUp');advance(2980);
    expect(get('tracking-state').textContent).toBe('PAUSED');advance(20);
    expect(get('tracking-state').textContent).toBe('TRACKING');expect(get('practice-feedback').textContent).toBe('MOVE 0.0, 0.0');
    expect(get('practice-reticle').style.left).toBe('50%');expect(get('practice-reticle').style.top).toBe('42%');expect(get('practice-fire').textContent).toContain('Ready');
    key('j');advance(100);expect(get('practice-fire').textContent).toContain('Fire input held');
  });
  it('expiry requires Retry and recovered tracking alone never starts practice',()=>{
    get('start-practice').click();get('loss-synthetic').click();advance(13000);expect(get('practice-start-status').textContent).toContain('expired');expect(get('start-practice').textContent).toBe('Retry practice');
    expect(get('practice-start-status').textContent).toContain('Both hands');expect(get('practice-start-status').textContent).toContain('Recalibrate neutral');get('neutral-synthetic').click();advance(4000);expect(get('tracking-state').textContent).toBe('PAUSED');get('start-practice').click();advance(3020);expect(get('tracking-state').textContent).toBe('TRACKING');
    key('j');advance(20);get('loss-synthetic').click();advance(20);expect(get('practice-fire').textContent).toContain('Blocked');expect(get('practice-fire').textContent).not.toContain('Stopped');
  });
  it.each(['cancel-practice','cancel-resume','cancel','escape','stop','background','blur','activate','synthetic','restart','back','enter','calibrate','graphics-loss'])( '%s invalidates pending start with no obsolete later resume',action=>{
    get('start-practice').click();advance(100);
    if(action==='escape')key('escape');else if(action==='blur')win.dispatchEvent(new Event('blur'));else if(action==='background'){doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));doc.hidden=false;}else if(action==='graphics-loss')get('scene').dispatchEvent(new Event('webglcontextlost',{cancelable:true}));else get(action).click();
    advance(14000);expect(get('tracking-state').textContent).toBe('PAUSED');expect(get('cancel-practice').hidden).toBe(true);expect(state.sim!.tick).toBe(0);expect(state.sim!.accepted).toBe(0);
  });
  it('paused sliders update independently, reject running changes, reset, and preserve native keyboard input',()=>{
    const move=get('move-sensitivity'),aim=get('aim-sensitivity');expect(get('move-sensitivity-value').textContent).toBe('1.0×');
    move.value=2;move.dispatchEvent(new Event('input'));aim.value=.5;aim.dispatchEvent(new Event('input'));advance(20);
    expect(get('move-sensitivity-value').textContent).toBe('2.0×');expect(get('aim-sensitivity-value').textContent).toBe('0.5×');
    expect(key('ArrowRight','keydown',aim).defaultPrevented).toBe(false);expect(key(' ','keydown',aim).defaultPrevented).toBe(false);advance(20);expect(get('tracking-state').textContent).toBe('PAUSED');
    enter();expect(move.disabled).toBe(true);expect(aim.disabled).toBe(true);move.value=.5;move.dispatchEvent(new Event('input'));advance(20);expect(get('move-sensitivity-value').textContent).toBe('2.0×');
    get('pause').click();advance();get('reset-sensitivity').click();advance(20);expect(get('move-sensitivity-value').textContent).toBe('1.0×');expect(get('aim-sensitivity-value').textContent).toBe('1.0×');
  });
  it('camera-off recovery preserves its reason and returns to setup without restarting or activating',()=>{
    enter();get('activate').click();advance(20);doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));doc.hidden=false;advance(20);
    const run=state.sim!,tick=run.tick;expect(get('pause-title').textContent).toContain('Return to setup');expect(get('resume').hidden).toBe(true);expect(get('resume').disabled).toBe(true);
    expect(get('pause-reason').textContent).toContain('Page backgrounded');get('resume').click();key(' ');advance(20);expect(get('pause-reason').textContent).toContain('Page backgrounded');expect(get('weapon-status').textContent).toContain('camera off');
    get('recover-camera').click();advance(500);expect(get('setup').hidden).toBe(false);expect(get('arena').hidden).toBe(true);expect(state.sim).toBe(run);expect(run.tick).toBe(tick);expect(get('tracking-preview').hidden).toBe(true);expect(get('tracking-state').textContent).toBe('PAUSED');
  });
  it('arena weapon feedback separates readiness, held fire, pause and tracking rearm without claiming hits',()=>{
    enter();expect(get('weapon-status').textContent).toContain('Ready');key('j');advance(100);expect(get('weapon-status').textContent).toContain('Fire input held');
    key('j','keyup');advance(20);expect(get('weapon-status').textContent).toContain('Stopped');get('pause').click();advance();expect(get('weapon-status').textContent).toContain('Blocked · paused');
    get('resume').click();advance(3100);get('loss-synthetic').click();advance(20);expect(get('weapon-status').textContent).toContain('Blocked');get('neutral-synthetic').click();advance();expect(get('weapon-status').textContent).toContain('Ready');
    get('resume').click();advance(3100);expect(get('weapon-status').textContent).toContain('Ready');key('j');advance(20);get('recall').click();advance(100);expect(get('weapon-status').textContent).toContain('Fire input held');
    key('j','keyup');advance(20);expect(get('weapon-status').textContent).toContain('Stopped');
  });
  it('one paired request allows repositioning, captures while paused, then requires separate Test controls',()=>{
    get('activate').click();advance(20);state.emitCamera(1,'Right');advance(20);
    expect(get('calibrate').disabled).toBe(false);expect(get('calibrate').textContent).toContain('Check both hands');
    get('calibrate').click();state.emitCamera(0);advance(2900);expect(get('enter').disabled).toBe(true);expect(get('cancel-calibration').hidden).toBe(false);expect(get('test-controls').disabled).toBe(true);
    advance(200);expect(get('calibration-guide-status').textContent).toContain('Waiting for fresh');
    state.emitCamera(2);advance(20);expect(get('enter').disabled).toBe(false);expect(get('tracking-state').textContent).toBe('PAUSED');expect(get('calibration-guide-status').textContent).toContain('still paused');
    expect(get('practice-fire').textContent).toContain('Blocked');expect(state.sim!.tick).toBe(0);expect(state.sim!.accepted).toBe(0);
    for(let i=0;i<160;i++){state.emitCamera(2);advance(20);}expect(get('tracking-state').textContent).toBe('PAUSED');
    get('test-controls').click();for(let i=0;i<152;i++){state.emitCamera(2);advance(20);}expect(get('tracking-state').textContent).toBe('TRACKING');expect(get('practice-fire').textContent).toContain('Ready');
    expect(get('calibration-guide-status').textContent).toContain('controls running');expect(get('calibration-guide-status').textContent).not.toContain('still paused');expect(get('calibration-guide-status').textContent).toContain('Neutral captured');
  });
  it.each(['cancel-calibration','restart','stop','synthetic','activate','back','escape','blur','background','settings','move-sensitivity','aim-sensitivity','reset-sensitivity','preset-Left'])( '%s cancels pending capture without obsolete later completion',action=>{
    get('synthetic').click();advance();get('calibrate').click();advance(100);
    if(action==='escape')key('escape');else if(action==='blur')win.dispatchEvent(new Event('blur'));else if(action==='background'){doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));doc.hidden=false;}else if(action==='preset-Left'){get(action).value='Forgiving' as any;get(action).onchange?.();}else if(action.endsWith('-sensitivity')&&action!=='reset-sensitivity'){get(action).value=1.2;get(action).dispatchEvent(new Event('input'));}else get(action).click();
    if(action==='settings')get('close-settings').click();advance(14000);expect(get('enter').disabled).toBe(true);expect(get('cancel-calibration').hidden).toBe(true);expect(get('tracking-state').textContent).toBe('PAUSED');
  });
  it('paired-check expiry explains the blocker and fresh hands cannot auto-retry',()=>{
    get('synthetic').click();advance(20);get('loss-synthetic').click();get('calibrate').click();advance(13000);
    expect(get('calibration-guide-status').textContent).toContain('expired');expect(get('calibration-guide-status').textContent).toContain('Both hands');expect(get('calibrate').textContent).toContain('Retry hand check');
    get('neutral-synthetic').click();advance(4000);expect(get('enter').disabled).toBe(true);get('calibrate').click();advance(2980);expect(get('enter').disabled).toBe(true);advance(40);expect(get('enter').disabled).toBe(false);expect(get('tracking-state').textContent).toBe('PAUSED');
  });
  it('Enter arena cancels recalibration and Cancel permits a fresh retry',()=>{
    get('calibrate').click();advance(100);get('enter').click();advance(3500);expect(get('cancel-calibration').hidden).toBe(true);expect(get('calibration-guide-status').textContent).toContain('cancelled');
    get('back').click();get('synthetic').click();advance();get('calibrate').click();advance(100);get('cancel-calibration').click();advance(3200);expect(get('enter').disabled).toBe(true);
    get('calibrate').click();advance(2900);expect(get('enter').disabled).toBe(true);advance(120);expect(get('enter').disabled).toBe(false);
  });
  it('reactivation requires a new explicit paired request even when both hands are already visible',()=>{
    get('activate').click();advance(20);get('calibrate').click();for(let i=0;i<152;i++){state.emitCamera(2);advance(20);}expect(get('enter').disabled).toBe(false);
    get('stop').click();get('activate').click();for(let i=0;i<152;i++){state.emitCamera(2);advance(20);}expect(get('enter').disabled).toBe(true);expect(get('calibrate').disabled).toBe(false);expect(get('calibrate').textContent).toContain('Check both hands');
  });
  it('synthetic gesture rehearsal commits on hold while pilot fire stays independent through recall',()=>{
    enter();key('j');key('k');advance(1560);expect(state.sim!.deployments).toBe(1);expect(get('weapon-status').textContent).toContain('Fire input held');
    advance(1800);expect(state.sim!.deployments).toBe(1);get('recall').click();advance(20);expect(state.sim!.recalls).toBe(1);expect(get('weapon-status').textContent).toContain('Fire input held');
    key('k','keyup');key('j','keyup');advance(100);key('v');advance(1540);expect(state.sim!.recalls).toBe(2);
  });
  it('camera feedback is visible for setup, hideable in arena, and cleared on background or source switch',()=>{
    get('activate').click();state.emitCamera(0);advance(20);expect(get('camera-feedback').textContent).toContain('No hands');
    state.emitCamera(1);advance(20);expect(get('camera-feedback').textContent).toContain('One hand');
    state.emitCamera(2);advance(20);get('calibrate').click();
    for(let i=0;i<152;i++){state.emitCamera(2);advance(20);}
    expect(get('camera-feedback').textContent).toContain('identity checks passed');expect(get('tracking-preview').hidden).toBe(false);
    get('enter').click();advance(20);expect(get('camera-preview').hidden).toBe(true);expect(get('camera-feedback').textContent).toContain('hidden');
    get('toggle-camera-preview').click();state.emitCamera(2);advance(20);expect(get('camera-preview').hidden).toBe(false);
    doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));advance(20);expect(get('tracking-preview').hidden).toBe(true);expect(get('camera-feedback').textContent).toContain('Camera off');
    doc.hidden=false;get('back').click();get('activate').click();state.emitCamera(2);advance(20);expect(get('tracking-preview').hidden).toBe(false);
    get('synthetic').click();advance(20);expect(get('tracking-preview').hidden).toBe(true);expect(get('camera-feedback').textContent).toContain('Camera off');
  });
  it('failed WebGL entry stays in setup with a durable error and no simulation ticks',()=>{
    state.failView=true;get('enter').click();advance();
    expect(get('setup').hidden).toBe(false);
    expect(get('arena').hidden).toBe(true);
    expect(get('arena-error').textContent).toContain('WebGL');
    key(' ');advance(1000);expect(state.sim!.tick).toBe(0);
  });
  it('context loss freezes the run and recovery requires restart before resume',()=>{
    enter();key('j');key('k');advance(400);expect(get('preview-text').textContent).toContain('Confirming');
    const tick=state.sim!.tick;expect(tick).toBeGreaterThan(0);
    get('scene').dispatchEvent(new Event('webglcontextlost',{cancelable:true}));advance();
    expect(state.sim!.tick).toBe(tick);
    expect(get('preview-text').textContent).not.toContain('Confirming');
    expect(get('pause-reason').textContent).toContain('Graphics context lost');
    expect(get('weapon-status').textContent).toContain('Blocked · Graphics context lost');
    expect(get('resume').disabled).toBe(true);
    get('restart').click();advance();expect(state.sim!.tick).toBe(tick);
    key(' ');advance();expect(state.sim!.tick).toBe(tick);
    get('scene').dispatchEvent(new Event('webglcontextrestored'));advance();
    expect(get('pause-reason').textContent).toContain('Restart is required');
    key(' ');advance();expect(state.sim!.tick).toBe(tick);
    get('restart').click();advance();expect(state.sim!.tick).toBe(0);
    expect(state.sim!.projectiles).toHaveLength(0);expect(state.sim!.accepted).toBe(0);
    get('resume').click();advance(3100);expect(state.sim!.tick).toBeGreaterThan(0);
    expect(state.sim!.projectiles).toHaveLength(0);expect(state.sim!.accepted).toBe(0);
  });
  it('failed entry can be retried successfully without losing calibration',()=>{
    state.failView=true;get('enter').click();advance();state.failView=false;
    enter();expect(get('setup').hidden).toBe(true);expect(get('arena-error').hidden).toBe(true);expect(state.sim!.tick).toBeGreaterThan(0);
  });
  it('Space preserves native focused-button activation rather than intercepting it',()=>{
    enter();const event=key(' ','keydown',get('restart'));
    expect(event.defaultPrevented).toBe(false);
    advance(100);expect(get('tracking-state').textContent).toBe('TRACKING');
  });
  it('button and keyboard pause/resume, recall and cancellation use the same guards',()=>{
    enter();get('pause').click();advance();const tick=state.sim!.tick;
    expect(get('tracking-state').textContent).toBe('PAUSED');key(' ');advance(3100);expect(state.sim!.tick).toBeGreaterThan(tick);
    key('k');advance(400);get('cancel').click();advance();expect(state.sim!.accepted).toBe(0);expect(get('preview-text').textContent).not.toContain('Confirming');
    key('k','keyup');advance(20);key('k');advance(400);key('escape');key('k','keyup');advance();expect(state.sim!.accepted).toBe(0);
    get('recall').click();advance();expect(state.sim!.order.type).toBe('RECALL');expect(state.sim!.accepted).toBe(1);
    key('r');advance();expect(state.sim!.accepted).toBe(2);
    key(' ');advance();expect(get('tracking-state').textContent).toBe('PAUSED');get('resume').click();advance(3100);expect(get('tracking-state').textContent).toBe('TRACKING');
  });
  it('ordinary right-hand loss stops pilot input while left deployment and combat continue; explicit pause still rests',()=>{
    enter();key('j');key('k');advance(400);get('loss-synthetic').click();advance(40);const tick=state.sim!.tick;
    expect(state.sim!.pilotFire).toBe(false);expect(get('pause-overlay').hidden).toBe(true);advance(300);expect(state.sim!.tick).toBeGreaterThan(tick);expect(state.sim!.accepted).toBe(1);
    get('neutral-synthetic').click();advance(100);expect(get('pause-overlay').hidden).toBe(true);get('arena-pause').click();advance(20);const paused=state.sim!.tick;advance(600);expect(state.sim!.tick).toBe(paused);
  });
  it('background, blur and stop freeze time and clear pending actions without automatic resume',()=>{
    enter();key('j');key('k');advance(400);doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));const tick=state.sim!.tick;advance(2000);
    expect(state.sim!.tick).toBe(tick);doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));advance();expect(state.sim!.tick).toBe(tick);
    expect(get('preview-text').textContent).not.toContain('Confirming');get('resume').click();advance(3100);expect(state.sim!.tick).toBeGreaterThan(tick);
    win.dispatchEvent(new Event('blur'));advance();expect(get('tracking-state').textContent).toBe('PAUSED');
    get('resume').click();advance(3100);get('stop').click();const stoppedTick=state.sim!.tick;advance();key(' ');advance();expect(state.sim!.tick).toBe(stoppedTick);
    get('synthetic').click();advance();expect(get('enter').disabled).toBe(true);key('c');advance(3020);expect(get('enter').disabled).toBe(false);
  });
  it.each(['won','lost'] as const)('reaches %s through actual combat and restart restores a clean paused run',outcome=>{
    enter();state.sim!.position={x:0,y:-9};if(outcome==='won')key('j');
    for(let i=0;i<3000&&state.sim!.outcome==='playing';i++){if(outcome==='won'){const target=state.sim!.turrets.find(t=>t.health>0)!;state.sim!.position={x:target.position.x,y:target.position.y+3.5};}advance(20);}
    expect(state.sim!.outcome).toBe(outcome);expect(get('resume').disabled).toBe(true);
    expect(get('weapon-status').textContent).toContain(outcome==='won'?'Blocked · arena clear':'Blocked · mech disabled');
    const old=state.sim!,tick=old.tick;key(' ');advance();expect(old.tick).toBe(tick);expect(get('tracking-state').textContent).toBe('PAUSED');
    expect(get('pause-title').textContent).toBe(outcome==='won'?'Arena clear.':'Mech disabled.');
    get('restart').click();advance();expect(state.sim!.runId).not.toBe(old.runId);expect(state.sim!.tick).toBe(0);expect(state.sim!.health).toBe(100);
    expect(state.sim!.projectiles).toHaveLength(0);expect(state.sim!.accepted).toBe(0);expect(state.sim!.rejected).toBe(0);expect(state.sim!.turrets.every(t=>t.health===100)).toBe(true);
    get('resume').click();advance(3100);expect(state.sim!.tick).toBeGreaterThan(0);expect(state.sim!.projectiles).toHaveLength(0);
  });
});
