const qaMissingHands=new Set<string>();
import {installInspector,renderCommandReadiness} from './arena-inspector';
let lastWorldAim:{x:number;y:number}|null=null,lastAimRun='',lastAimEpoch=-1;
let inspector:ReturnType<typeof installInspector>|null=null;
import './style.css';
import './player-interface.css';
import {keyboardTrainingPrompt,prepareIntro,titleScreen,voiceCommandGuide,type PlayMode} from './player-interface';
// StarshipMania tactical HUD + arena effects (presentation only; `?classic` restores the original look).
import {ArenaFx} from './fx/arena-fx';
import {mountHud,type HudHandle} from './hud/hud';
import {hudFeed} from './hud/feed';
import {demoRequested,startHudDemo} from './hud/demo';
const hudClassic=new URLSearchParams(location.search).has('classic');let fx:ArenaFx|null=null,hud:HudHandle|null=null,hudBridge:ReturnType<typeof connectHud>|null=null,voiceHud:ReturnType<typeof createVoiceHudBridge>|null=null;
import {checkWebcamAssets} from './webcam-assets';
import {gestureCatalogue} from './gesture-guide';
import {actions,bindingLabel,type ActionId,type ExtraAction} from './gestures';
import {bindingInstructions,bindingSettingsMarkup,installBindingSettings} from './binding-settings';
import {LogCursor} from './round-events';
import {gestureNames,recognize,recognitionPresets,type RecognitionPreset} from './gestures';
import {PracticeFeedback,PracticeFireFeedback} from './practice';
import {ResumeIntent} from './resume-intent';
import {TrackingPreview} from './tracking-preview';
import {GuidedCalibration} from './guided-calibration';
import {AgentController} from './agent/controller';
import {OrderQueue,type OrderAssignment} from './agent/order-queue';
import {createVoiceSupervisor} from './agent/voice-supervisor';
import {getSupervisorTools,installSupervisorRuntime} from './agent/runtime';
import {connectHud,describeAction} from './agent/hud-bridge';
import {createVoiceHudBridge} from './hud/voice-bridge';
import {createVoiceRecall} from './voice-recall';
import {Controls,type Observation} from './controls';import {Simulation,FixedClock} from './simulation';import {CameraInput,captureBitmap} from './camera';import {ArenaView} from './view';import {clamp,type ActionIntent,type DronePolicy,type CommandEnvelope,type TargetId} from './contracts';
const qaEnabled=new URLSearchParams(location.search).has('qa');
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`
<header><span class="brand">Starship<span>Mania</span></span><div class="privacy"><i></i><span id="privacy-mode">CAMERA AND MIC OFF</span></div></header>
<main>${titleScreen}<section id="setup" class="setup" aria-labelledby="prepare-heading" hidden>${prepareIntro}
<div class="prepare-choices"><button id="quick-keyboard" class="primary">Play with keyboard</button><button id="activate">Activate webcam</button></div>
<p class="prepare-choice-note">WASD moves, arrow keys aim, J fires the mech, H fires assigned drones, K deploys and R recalls. Your webcam is optional and processes images on this device.</p>
<p id="arena-error" role="alert" hidden></p>
<div id="prepare-launch" class="prepare-launch" hidden><p>Controls ready.</p><button id="enter" class="primary" disabled>Enter arena</button><button id="train" class="primary" disabled hidden>Start training</button></div>
<div id="prepare-camera" class="setup-grid" hidden><article id="prepare-camera-feed" class="card"><h2>Hand tracking</h2><div id="source-status" class="status" role="status">Camera off</div><div id="camera-actions" class="buttons"></div><div id="tracking-home"><aside id="tracking-preview" class="tracking-preview" hidden><div class="tracking-heading"><strong>Mirrored camera</strong><button id="toggle-camera-preview" hidden>Show camera preview</button></div><canvas id="camera-preview" width="320" height="240" aria-label="Mirrored camera view with detected hand landmarks"></canvas><div id="camera-feedback" role="status" aria-live="polite">Camera off</div><div id="camera-fire" class="fire-status" role="status" aria-live="polite">Blocked · camera off</div><p class="tracking-legend">Check that L and R follow your left and right hands. Amber ? means uncertain.</p></aside></div></article>
<article id="prepare-calibration" class="card" hidden><h2>Calibrate controls</h2><p>Rest your elbows and show two separated, open palms.</p><div class="palm-map"><div class="comfort left"><span>L · MOVE</span><i id="left-dot"></i></div><div class="comfort right"><span>R · AIM</span><i id="right-dot"></i></div></div><div id="calibration-home"><section id="calibration-guide"><p id="calibration-guide-status" role="status" aria-live="polite"></p><div class="buttons"><button id="calibrate" class="primary">Check both hands / C</button><button id="cancel-calibration" hidden>Cancel calibration</button></div></section></div><button id="test-controls">Test controls</button><p id="calibration-status" class="fine">Neutral not captured</p></article></div>
<details class="prepare-advanced"><summary>Control test and help</summary><div class="card"><button id="synthetic">Set up keyboard control test</button><p id="setup-control-instructions"></p><div id="practice" class="practice"><span class="practice-target">T1</span><i id="practice-reticle" class="crosshair"></i><span id="practice-feedback">Control test paused</span></div>${voiceCommandGuide}</div></details>
<div class="setup-foot"><button id="probe" hidden>Check local model with blank synthetic frame</button><output id="probe-result"></output></div></section>
<section id="arena" hidden><canvas id="scene" aria-label="Third-person mech arena"></canvas><div class="arena-top"><div><div class="eyebrow">02 / LIVE ARENA</div><h2 id="arena-title">Clear all six targets.</h2><small class="shot-legend">Mint: pilot · Lavender: Padisarah · Amber: enemy fire</small></div><div class="stats"><span>MECH <b id="health">100</b><meter id="health-meter" min="0" max="100" value="100"></meter></span><span>TARGETS <b id="remaining">6 / 6</b></span><span>PADISARAH UNITS <b>02</b><small>ONE GROUP</small></span></div></div><div id="reticle" class="crosshair"></div><div id="target-label"></div><div id="pause-overlay"><div class="eyebrow">SIMULATION FROZEN</div><h2 id="pause-title">Ready when you are.</h2><p id="pause-reason">Choose Resume, then open both hands comfortably.</p><button id="resume" class="primary">Resume / Space</button></div><details id="arena-details" class="arena-bottom" open><summary id="arena-details-summary">Unit order and command details</summary><div class="order"><span class="eyebrow system-order">PADISARAH · UNIT ORDER</span><strong id="order-text">FOLLOW</strong><span id="order-message">Padisarah units following</span></div><div class="preview"><span class="eyebrow">COMMAND PREVIEW</span><strong id="preview-text">No command pending</strong><progress id="dwell" max="1500" value="0"></progress></div></details></section>
<section id="synthetic-help" hidden><b>SYNTHETIC INPUT · camera off</b><span>WASD: left palm · Arrows: right palm · J: pilot fire · H: Padisarah fire · K: deploy · V: recall (active bindings)</span><button id="neutral-synthetic">Open hands at neutral</button><button id="loss-synthetic">Toggle right-hand loss</button></section>
</main><footer><div><span id="tracking-state">PAUSED</span><span id="metrics">No observations</span><span id="voice-status" role="status"></span></div><nav><button id="pause">Space · pause</button><button id="recall">R · recall</button><button id="voice-toggle" title="Shares microphone audio with ElevenLabs while listening">Start voice</button><button id="cancel">Esc · cancel</button><button id="restart">Restart</button><button id="back">Controls</button><button id="stop">Stop camera</button></nav></footer>`;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
function createVoiceGuide(){
  const help=document.createElement('div');
  help.innerHTML=voiceCommandGuide;
  return help;
}
el('camera-actions').append(el('stop'));
el('back').textContent='Prepare';
el('calibration-guide').append(el('test-controls'));
const sensitivityPanel=document.createElement('fieldset');sensitivityPanel.id='sensitivity';sensitivityPanel.innerHTML='<legend>Sensitivity · adjust while paused</legend><label for="move-sensitivity">Move <output id="move-sensitivity-value" for="move-sensitivity">1.0×</output></label><input id="move-sensitivity" type="range" min="0.5" max="2" step="0.1" value="1"><label for="aim-sensitivity">Aim <output id="aim-sensitivity-value" for="aim-sensitivity">1.0×</output></label><input id="aim-sensitivity" type="range" min="0.5" max="2" step="0.1" value="1"><button id="reset-sensitivity">Reset to 1×</button><small>Lower = gentler response · higher = less hand travel. Session only.</small>';el('calibration-guide').append(sensitivityPanel);
const recovery=document.createElement('button');recovery.id='recover-camera';recovery.textContent='Return to setup to activate camera';recovery.hidden=true;el('pause-overlay').append(recovery);
const weapon=document.createElement('div');weapon.id='weapon-status';weapon.className='fire-status';weapon.setAttribute('role','status');weapon.setAttribute('aria-live','polite');el('arena').append(weapon);
const practiceActions=document.createElement('div');practiceActions.className='practice-actions';practiceActions.innerHTML='<div class="buttons"><button id="start-practice" class="primary">Start practice</button><button id="pause-practice" hidden>Pause practice</button><button id="cancel-practice" hidden>Cancel start</button><button id="recalibrate-practice">Recalibrate neutral</button></div><section id="practice-readiness" aria-label="Start readiness"><strong id="readiness-summary">Start readiness</strong><ul><li id="readiness-camera"></li><li id="readiness-hands"></li><li id="readiness-open"></li></ul><p id="readiness-guidance"></p></section><p id="practice-start-status" role="status" aria-live="polite"></p><p id="practice-fire" class="fire-status" role="status" aria-live="polite">Blocked · practice paused</p><small>Trigger feedback only · no projectile or hit simulation here.</small>';el('practice').after(practiceActions);
const inputDetails=document.createElement('details');inputDetails.id='input-details';inputDetails.innerHTML='<summary id="input-details-summary">Input details · local and transient</summary><dl><dt>Fresh accepted pair</dt><dd id="input-fresh">No</dd><dt>Open posture</dt><dd id="input-open">No</dd><dt>Left classification</dt><dd id="input-left-gesture">Unknown</dd><dt>Right classification</dt><dd id="input-right-gesture">Unknown</dd><dt>Recognition presets</dt><dd id="input-presets">Balanced / Balanced</dd></dl><p>Read-only session diagnostics. No images, landmarks, or values are stored.</p>';practiceActions.append(inputDetails);
const resumeStatus=document.createElement('p');resumeStatus.id='resume-status';resumeStatus.setAttribute('role','status');resumeStatus.setAttribute('aria-live','polite');el('pause-overlay').append(resumeStatus);
const cancelResume=document.createElement('button');cancelResume.id='cancel-resume';cancelResume.textContent='Cancel start';cancelResume.hidden=true;el('pause-overlay').append(cancelResume);
const pausedSettings=document.createElement('details');pausedSettings.id='paused-settings';pausedSettings.innerHTML='<summary>Recalibration and sensitivity</summary>';el('pause-overlay').append(pausedSettings);
const settings=document.createElement('dialog');settings.id='session-settings';settings.setAttribute('aria-labelledby','settings-title');settings.innerHTML='<h2 id="settings-title">Session settings</h2><p>Play is paused. Closing settings never resumes it. Sensitivity lasts for this session only.</p><div id="settings-controls"></div><div id="settings-camera"></div><div id="settings-diagnostics"></div><h3>Controls</h3><p id="settings-control-instructions">Left palm moves; right palm aims. Right Closed Fist holds fire after an 80 ms fresh-sample confirmation. Hold left Pointing Up over a candidate for 0.5 s to deploy; left Victory for 0.5 s recalls. Commands commit when the hold completes, not on release. Open the initiating hand to cancel/rearm, or confirm a different pose on that hand for 80 ms to rearm. R recalls immediately; Esc cancels. Open both hands comfortably after an explicit Start / Resume countdown to recenter.</p><button id="close-settings" class="primary">Close settings · stay paused</button>';app.append(settings);
const guide=document.createElement('div');guide.innerHTML=gestureCatalogue();el('settings-diagnostics').after(guide);
const guideButton=document.createElement('button');guideButton.id='open-gesture-guide';guideButton.textContent='Illustrated gesture guide';el('test-controls').after(guideButton);
const recognitionPanel=document.createElement('fieldset');recognitionPanel.id='recognition-presets';recognitionPanel.innerHTML='<legend>Recognition confidence · adjust while paused</legend>'+(['Left','Right'] as const).map(side=>`<label for="preset-${side}">${side} hand <select id="preset-${side}">${Object.entries(recognitionPresets).map(([name,p])=>`<option value="${name}" ${name==='Balanced'?'selected':''}>${name} (${p.enter.toFixed(2)} / ${p.retain.toFixed(2)})</option>`).join('')}</select></label>`).join('')+'<small>Enter / retain score. Separate from palm sensitivity. Session only.</small>';el('calibration-guide').append(recognitionPanel);
const settingsButton=document.createElement('button');settingsButton.id='settings';settingsButton.hidden=true;settingsButton.textContent='Settings';el('back').after(settingsButton);
el('settings-diagnostics').after(createVoiceGuide());
const trainingPanel=document.createElement('section');trainingPanel.id='training-panel';trainingPanel.hidden=true;trainingPanel.innerHTML='<strong>PADISARAH TRAINING · no enemy fire · indestructible targets</strong><p id="training-step" role="status" aria-live="polite"></p><p id="training-help"></p><div class="buttons"><button id="retry-training">Retry practice</button><button id="leave-training">Leave practice · enter arena</button></div>';el('arena').append(trainingPanel);
const resultsPanel=document.createElement('section');resultsPanel.id='results-panel';resultsPanel.hidden=true;resultsPanel.setAttribute('aria-labelledby','results-title');resultsPanel.innerHTML='<h2 id="results-title"></h2><p id="results-counts"></p><div class="buttons"><button id="play-again" class="primary">Play again</button><button id="results-training">Training</button><button id="results-settings">Settings</button><button id="results-menu">Main menu</button></div>';el('arena').append(resultsPanel);
const objective=document.createElement('p');
objective.id='arena-objective';
objective.textContent='Clear all six targets';
el('arena').append(objective);
const hitFeedback=document.createElement('p');hitFeedback.id='hit-feedback';hitFeedback.setAttribute('role','status');el('order-message').after(hitFeedback);
const controls=new Controls(),clock=new FixedClock(),practiceFeedback=new PracticeFeedback();let sim=new Simulation(),run=1,commandId=0,pending:CommandEnvelope[]=[];
let session=controls.configuration;let preferredPolicy:DronePolicy='A';let queuedActions:{action:ExtraAction;source:ActionIntent['source']}[]=[];let queuedPolicy:DronePolicy|null=null;
const actionLabel=(id:ActionId)=>bindingLabel(session.bindings[id],session.durationMs);
const bindingPanel=document.createElement('section');bindingPanel.id='binding-settings';bindingPanel.tabIndex=-1;bindingPanel.innerHTML=bindingSettingsMarkup();el('settings-controls').after(bindingPanel);
function refreshBindingGuide(){
 guide.innerHTML=gestureCatalogue(session);
 el('setup-control-instructions').textContent=bindingInstructions(session);
 el('settings-control-instructions').textContent=bindingInstructions(session);
}
const fillBindings=installBindingSettings(()=>controls.configuration,config=>{if(!controls.setBindings(config))return false;session=controls.configuration;sim.setDirectAutofire();resumeIntent.cancel();calibration.cancel();clearPending();refreshBindingGuide();return true;});
const pauseActions=document.createElement('div');pauseActions.className='buttons';pauseActions.innerHTML='<button id="menu-retry">Retry round</button><button id="menu-settings">Settings</button><button id="menu-bindings">Gesture bindings</button><button id="menu-guide">Gesture guide</button><button id="menu-title">Main menu</button>';el('resume').after(pauseActions);
const arenaActions=document.createElement('div');arenaActions.id='arena-actions';arenaActions.innerHTML='<button id="arena-pause">Pause / Esc</button><button id="arena-retry">Retry round</button>';el('arena').append(arenaActions);
// Supervisor agent: proposals need pilot approval (Y / N) unless the pilot grants autonomy (G). See src/agent/README.md.
const agentController=new AgentController();let queuedAutonomy:{enabled:boolean;source:ActionIntent['source']}|null=null;
const orderQueue=new OrderQueue();
orderQueue.reset(sim.runId);
function approveVoiceAssignment(current:Simulation,assignments:OrderAssignment[],reason:string){
  const proposal=agentController.submit(current,{kind:'squad',assignments,reason},AgentController.basis(current),{requireApproval:true});
  return proposal.ok&&agentController.approve(proposal.proposalId,current).ok;
}
const voiceSupervisor=createVoiceSupervisor({current:()=>gameplayActive()?sim:null,queue:orderQueue,submit:approveVoiceAssignment,
  notify:message=>{sim.events.add(sim.tick,'Voice order','Pilot decision',message);}});
function clearWaitingOrders(){
  voiceSupervisor.clear();
  orderQueue.discardImpossible(()=>true);
}
installSupervisorRuntime({getSim:()=>stage==='arena'?sim:null,controller:agentController},{exposeGlobal:qaEnabled||new URLSearchParams(location.search).has('supervisor')});
const autonomyButton=document.createElement('button');autonomyButton.id='autonomy-toggle';autonomyButton.textContent='Autonomy OFF / G';autonomyButton.setAttribute('aria-pressed','false');arenaActions.append(autonomyButton);
const proposalPanel=document.createElement('section');proposalPanel.id='agent-proposal';proposalPanel.hidden=true;proposalPanel.setAttribute('aria-live','polite');proposalPanel.style.cssText='position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:6;display:flex;gap:8px;align-items:center;padding:8px 12px;background:#102430f0;border:1px solid #cbb7f4;border-radius:6px;font-size:12px;max-width:min(640px,92%)';
proposalPanel.innerHTML='<strong id="agent-proposal-text"></strong><span id="agent-proposal-reason"></span><button id="agent-accept" class="primary">Accept / Y</button><button id="agent-dismiss">Dismiss / N</button>';el('arena').append(proposalPanel);
function toggleAutonomy(source:ActionIntent['source']){if(!gameplayActive()||sim.mode!=='combat')return;queuedAutonomy={enabled:!sim.autonomy.enabled,source};}
function decideProposal(accept:boolean){const p=stage==='arena'?agentController.pending().at(-1):undefined;if(!p)return;if(accept)agentController.approve(p.id,sim);else agentController.dismiss(p.id,sim.tick);}
autonomyButton.onclick=()=>toggleAutonomy('local-button');el('agent-accept').onclick=()=>decideProposal(true);el('agent-dismiss').onclick=()=>decideProposal(false);
function renderSupervisor(){
 if(stage==='arena')agentController.observe(sim); // also while paused (e.g. right after Retry); pure and idempotent
 const on=sim.autonomy.enabled;autonomyButton.textContent=on?`Autonomy ON${sim.autonomy.fire?' (may fire)':''} / G`:'Autonomy OFF / G';autonomyButton.setAttribute('aria-pressed',String(on));autonomyButton.hidden=sim.mode!=='combat';
 const p=stage==='arena'?agentController.pending().at(-1):undefined;proposalPanel.hidden=!p||!!hudBridge; // with the HUD connected its recommendation card is the single approval UI (Y / N still work)
 if(p){el('agent-proposal-text').textContent='Agent proposes: '+describeAction(p);el('agent-proposal-reason').textContent=p.reason?' · '+p.reason:'';}
}
const unitFire=document.createElement('div');unitFire.id='unit-fire-status';unitFire.className='fire-status';el('arena').append(unitFire);
const cameraUnitFire=document.createElement('div');cameraUnitFire.id='camera-unit-fire';cameraUnitFire.className='fire-status';el('camera-fire').after(cameraUnitFire);
const practiceUnitFire=document.createElement('div');practiceUnitFire.id='practice-unit-fire';practiceUnitFire.className='fire-status';el('practice-fire').after(practiceUnitFire);
const commandLog=document.createElement('section');commandLog.id='command-log';commandLog.setAttribute('aria-label','Recent commands and fire transitions');commandLog.innerHTML='<div class="log-heading"><strong>Command log</strong><button id="log-latest">Latest</button></div><div id="log-scroll" tabindex="0"><ol id="log-entries"></ol></div>';el('arena').append(commandLog);
const logCursor=new LogCursor();let logSignature='';
el('log-scroll').addEventListener('scroll',()=>{if(el('log-scroll').scrollTop>2)logCursor.readOlder();});
el('log-latest').onclick=()=>{logCursor.showLatest();el('log-scroll').querySelectorAll('details').forEach(detail=>detail.open=false);el('log-scroll').scrollTop=0;};
el('log-entries').addEventListener('toggle',event=>{if(event.target instanceof HTMLDetailsElement&&event.target.open)logCursor.readOlder();},true);
function renderLog(){
 logCursor.update(sim.runId,sim.events.entries);const signature=sim.runId+':'+logCursor.rows.map(e=>e.id).join(',');
 if(signature!==logSignature){logSignature=signature;const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');el('log-entries').innerHTML=logCursor.rows.map(e=>`<li><details class="log-event"><summary><span class="log-headline"><span class="log-primary"><time>${(e.tick/60).toFixed(1)}s</time><b>${escape(e.action)}${e.target?' '+e.target:''}</b></span><span class="log-result"><span>${escape(e.outcome.startsWith('Blocked')?'Blocked':e.outcome)}</span><span class="log-disclosure">Details</span></span></span></summary><small>${escape(e.outcome)}. ${escape(e.detail)||'No additional detail.'}</small></details></li>`).join('')||'<li>No commands this round.</li>';if(logCursor.following)el('log-scroll').scrollTop=0;}
 el('log-latest').textContent=logCursor.unread?`${logCursor.unread} new entries / Latest`:'Latest';
}
const resumeIntent=new ResumeIntent(),practiceFire=new PracticeFireFeedback();
const calibration=new GuidedCalibration();
let stage:'controls'|'arena'='controls',source:'off'|'camera'|'synthetic'='off',lastEpoch=controls.epoch;
let prepareMode:PlayMode='combat',cameraSetupRequested=false;
let diagnosticSample:Observation|null=null;
let previousPreview:TargetId|null=null,syntheticSeq=0,syntheticAim={x:0,y:0},syntheticLoss=false;const keys=new Set<string>();
let replayStart:number|null=null,replayCaptured=false,replayResumed=false,replayRecalled=false;
let qaAim:TargetId|null=null,qaV02Running=false;
let replayEvidence={practice:false,movement:false,fire:false,intercept:false,recall:false};
const video=document.createElement('video');let view:ArenaView|null=null;
const trackingPreview=new TrackingPreview(el<HTMLCanvasElement>('camera-preview'),el('camera-feedback'));let showCameraDuringPlay=false;
let renderState:'ready'|'lost'|'restart-required'='ready',renderMessage='';
let settingsOpen=false,settingsFocus:HTMLElement|null=null,resultsShown=false;
const camera=new CameraInput(video,()=>controls.epoch,(s,landmarks)=>{diagnosticSample=s;const accepted=controls.ingest(s,performance.now());trackingPreview.observe(s,landmarks,accepted,controls.epoch,controls.recognition);},reason=>{
  stopVoice();
  diagnosticSample=null;resumeIntent.cancel();calibration.reset();trackingPreview.clear();controls.pause(reason);clearPending();clock.reset();
});
function clearPending(){queuedActions=[];queuedPolicy=null;if(stage==='arena'&&previousPreview&&!controls.inputArmed)sim.events.add(sim.tick,'Deploy / redirect','Cancelled','Control epoch reset',previousPreview);pending=[];previousPreview=null;lastEpoch=controls.epoch;practiceFeedback.clear();if(controls.paused||!controls.inputArmed)sim.stopFire();}
function logCancellation(detail:string){const command=controls.bindings.pending;if(stage==='arena'&&(command||pending.length)){sim.events.add(sim.tick,command?.type==='RECALL'?'Recall':'Deploy / redirect','Cancelled',detail,command?.type==='INTERCEPT'?command.targetId:null);previousPreview=null;}}
function pause(){stopVoice();logCancellation('Paused or menu opened');resumeIntent.cancel();calibration.cancel();controls.pause();clearPending();clock.reset();}
function sizeArena(){el<HTMLDetailsElement>('arena-details').open=true;view?.resize();}
window.addEventListener('resize',sizeArena);

function cameraUnavailable(){return source==='off'||(source==='camera'&&!camera.active&&!camera.loading);}
function canRequestResume(){return !settingsOpen&&!document.hidden&&!calibration.pending&&!cameraUnavailable()&&controls.calibrated&&renderState==='ready'&&(stage!=='arena'||(!!view&&sim.outcome==='playing'&&!(sim.mode==='training'&&sim.trainingStep===5)));}
function resume(now=performance.now()){
  if(resumeIntent.pending||(!controls.paused&&!controls.needsRearm)||!canRequestResume())return false;
  calibration.cancel('Calibration cancelled · start requested');pause();return resumeIntent.start(now);
}
function toggle(){if(resumeIntent.pending)pause();else if(controls.paused||controls.needsRearm)resume();else pause();}
function recall(source:'local-keyboard-recall'|'local-voice-recall'='local-keyboard-recall') {
  if (!gameplayActive()) return false;
  if (source === 'local-keyboard-recall') voiceRecall.invalidate();
  controls.recall(performance.now());
  pending=[];previousPreview=null;queuedPolicy=null;
  queuedActions=queuedActions.filter(item=>item.action!=='fireAtWill');practiceFeedback.clear();
  const before=sim.accepted;
  sim.commands([sim.envelope({type:'RECALL'},source,`cmd-${++commandId}`)]);
  if (sim.accepted===before) return false;
  clearWaitingOrders();
  controls.bindings.manualOverride();
  return true;
}
function cancelCommand(){logCancellation('Explicit cancel');resumeIntent.cancel();calibration.cancel();controls.cancel(performance.now());clearPending();if(sim.mode==='training')sim.message='Command cancelled; open the bound hand or confirm a different pose for 80 ms to rearm';}
function resetRound(mode:'combat'|'training'){
  stopVoice();
  inspector?.voiceTranscript.clear();
  // Retire old input and its events against the old run, never against its replacement.
  controls.restart();clearPending();
  resumeIntent.cancel();calibration.cancel();replayStart=null;qaAim=null;sim=new Simulation(`run-${++run}`,mode);sim.preferredPolicy=preferredPolicy;commandId=0;
  orderQueue.reset(sim.runId);
  keys.clear();qaMissingHands.clear();syntheticAim={x:0,y:0};syntheticLoss=false;clock.reset();resultsShown=false;
}
function startRound(mode:'combat'|'training'){
  if(settingsOpen||renderState==='lost')return;
  renderState='ready';renderMessage='';resetRound(mode);enterArena(mode);if(stage==='arena')resume();
}
function restart(){if(stage==='arena'){startRound(sim.mode);return;}if(settingsOpen||renderState==='lost')return;renderState='ready';renderMessage='';resetRound('combat');}
function closeSettings(){
  if(!settingsOpen)return;settingsOpen=false;calibration.cancel();pause();settings.close();
  el(stage==='arena'?'paused-settings':'calibration-home').append(el('calibration-guide'));
  el(stage==='arena'?'arena':'tracking-home').append(el('tracking-preview'));practiceActions.append(inputDetails);
  trackingPreview.setVisible(stage==='controls'||showCameraDuringPlay);
  (settingsFocus??el('settings')).focus();settingsFocus=null;
}
function openSettings(){
  if(settingsOpen)return;settingsFocus=document.activeElement instanceof HTMLElement?document.activeElement:el('settings');
  replayStart=null;keys.clear();qaMissingHands.clear();calibration.cancel();pause();settingsOpen=true;
  el('settings-controls').append(el('calibration-guide'));el('settings-camera').append(el('tracking-preview'));el('settings-diagnostics').append(inputDetails);
  trackingPreview.setVisible(true);fillBindings();settings.showModal();el('close-settings').focus();
}
refreshBindingGuide();
el('arena-pause').onclick=()=>{pause();el('resume').focus();};el('arena-retry').onclick=restart;el('menu-retry').onclick=restart;
el('menu-settings').onclick=openSettings;el('menu-bindings').onclick=()=>{openSettings();el('binding-settings').focus();};el('menu-guide').onclick=()=>{openSettings();el('gesture-guide').focus();};
el('open-gesture-guide').onclick=()=>{openSettings();el('gesture-guide').focus();};
for(const side of ['Left','Right'] as const)el<HTMLSelectElement>(`preset-${side}`).onchange=()=>{if(controls.setRecognition(side,el<HTMLSelectElement>(`preset-${side}`).value as RecognitionPreset)){resumeIntent.cancel();calibration.cancel();clearPending();}};
el('settings').onclick=openSettings;el('results-settings').onclick=openSettings;el('close-settings').onclick=closeSettings;
settings.addEventListener('cancel',event=>{event.preventDefault();closeSettings();});
function showPrepare(mode:PlayMode=prepareMode){
  prepareMode=mode;
  const training=mode==='training';
  el('title-screen').hidden=true;
  el('setup').hidden=false;
  el('prepare-heading').textContent=training?'Prepare for training':'Prepare to play';
  el('prepare-objective').textContent=training?'Practise deployment, firing and Recall with no incoming damage.':'Clear six targets and keep your mech operational.';
  el('quick-keyboard').textContent=training?'Train with keyboard':'Play with keyboard';
  el('enter').hidden=training;
  el('train').hidden=!training;
  el('prepare-heading').focus();
}
function showTitle(){
  if(stage==='arena')el('back').click();
  pause();
  if(source==='camera')el('stop').click();
  cameraSetupRequested=false;
  el('setup').hidden=true;
  el('title-screen').hidden=false;
  el(prepareMode==='training'?'title-training':'title-play').focus();
}
el('title-play').onclick=()=>showPrepare('combat');
el('title-training').onclick=()=>showPrepare('training');
el('title-settings').onclick=openSettings;
el('return-title').onclick=showTitle;
el('menu-title').onclick=showTitle;
el('results-menu').onclick=showTitle;
el('train').onclick=()=>{if(controls.calibrated)startRound('training');};el('results-training').onclick=()=>startRound('training');
el('retry-training').onclick=()=>startRound('training');el('leave-training').onclick=()=>startRound('combat');el('play-again').onclick=()=>startRound('combat');
function calibrate(){if(calibration.pending||document.hidden||cameraUnavailable())return;if(!controls.paused){controls.reason='Pause before recentering';return;}pause();calibration.start(performance.now(),controls);}
el('activate').onclick=()=>{
  if(stage==='controls'&&el('setup').hidden)showPrepare();
  cameraSetupRequested=true;
  replayStart=null;source='camera';keys.clear();qaMissingHands.clear();controls.calibrated=false;controls.neutral=null;void camera.activate(checkWebcamAssets);
};
function chooseKeyboard(){
  if(stage==='controls'&&el('setup').hidden)showPrepare();
  cameraSetupRequested=false;
  camera.stop('Synthetic rehearsal · no camera');source='synthetic';syntheticAim={x:0,y:0};syntheticLoss=false;controls.calibrated=false;controls.neutral=null;keys.clear();qaMissingHands.clear();
}
el('synthetic').onclick=chooseKeyboard;
el('quick-keyboard').onclick=()=>{
  if(document.hidden||settingsOpen||stage!=='controls')return;
  chooseKeyboard();
  // Keyboard input can establish neutral from a fresh synthetic sample immediately.
  const now=performance.now();
  synthetic(now);
  if(controls.calibrate(now))startRound(prepareMode);
};
el('calibrate').onclick=calibrate;el('test-controls').onclick=()=>resume();
el('start-practice').onclick=()=>resume();el('pause-practice').onclick=pause;el('cancel-practice').onclick=pause;el('cancel-resume').onclick=pause;
el('recalibrate-practice').onclick=calibrate;
el('cancel-calibration').onclick=()=>calibration.cancel();
function enterArena(mode:'combat'|'training'='combat'){
  if(settingsOpen||!controls.calibrated||renderState!=='ready')return;
  calibration.cancel();pause();if(sim.mode!==mode)resetRound(mode);
  if(!view){try{view=new ArenaView(el<HTMLCanvasElement>('scene'));}catch{renderMessage='WebGL unavailable · arena did not start. Check browser graphics support, then retry Enter arena.';return;}}
  if(!fx&&!hudClassic&&view.scene){try{fx=new ArenaFx(view.scene,view.renderer);}catch{fx=null;}}
  renderMessage='';stage='arena';showCameraDuringPlay=false;trackingPreview.setVisible(false);
  el('arena').append(el('tracking-preview'));el('paused-settings').append(el('calibration-guide'));el('title-screen').hidden=true;el('setup').hidden=true;el('arena').hidden=false;
  // Mode changes can change canvas height without a window resize event.
  el('arena').classList.toggle('is-training',mode==='training');sizeArena();
  const scene=el('scene');scene.tabIndex=-1;scene.focus();
}
el('enter').onclick=()=>enterArena();
el('scene').addEventListener('webglcontextlost',event=>{event.preventDefault();calibration.cancel();renderState='lost';renderMessage='Graphics context lost · simulation frozen. Wait for graphics recovery, then Restart.';keys.clear();qaMissingHands.clear();replayStart=null;pause();});
el('scene').addEventListener('webglcontextrestored',()=>{if(renderState!=='lost')return;renderState='restart-required';renderMessage='Graphics recovered · Restart is required before resuming.';pause();});
el('back').onclick=()=>{calibration.cancel();pause();stage='controls';trackingPreview.setVisible(true);el('tracking-home').append(el('tracking-preview'));el('calibration-home').append(el('calibration-guide'));el('arena').hidden=true;showPrepare();};
el('recover-camera').onclick=()=>el('back').click();
for(const kind of ['move','aim'] as const)el<HTMLInputElement>(`${kind}-sensitivity`).addEventListener('input',()=>{const value=Number(el<HTMLInputElement>(`${kind}-sensitivity`).value),current=controls.sensitivity;if(controls.setSensitivity(kind==='move'?value:current.move,kind==='aim'?value:current.aim)){resumeIntent.cancel();calibration.cancel();}});
el('reset-sensitivity').onclick=()=>{if(controls.setSensitivity(1,1)){resumeIntent.cancel();calibration.cancel();}};
el('toggle-camera-preview').onclick=()=>{showCameraDuringPlay=!showCameraDuringPlay;trackingPreview.setVisible(showCameraDuringPlay);};
el('pause').onclick=toggle;el('resume').onclick=()=>resume();el('recall').onclick=()=>recall();el('cancel').onclick=cancelCommand;el('restart').onclick=restart;
el('stop').onclick=()=>{source='off';keys.clear();qaMissingHands.clear();camera.stop('Camera stopped · deliberate reactivation required');};
el('neutral-synthetic').onclick=()=>{syntheticAim={x:0,y:0};keys.clear();qaMissingHands.clear();syntheticLoss=false;};el('loss-synthetic').onclick=()=>{syntheticLoss=!syntheticLoss;};
document.addEventListener('keydown',event=>{
  if(event.repeat)return;const key=event.key.toLowerCase();
  if(settingsOpen){if(key==='escape'){event.preventDefault();closeSettings();}return;}
  if(!el('title-screen').hidden)return;
  if(stage==='arena'&&sim.outcome!=='playing')return;
  // Cancellation remains available while adjusting a native control.
  if(key==='escape'){event.preventDefault();if(stage==='arena'){pause();el('resume').focus();}else cancelCommand();return;}
  if(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if(key===' '&&event.target instanceof HTMLElement&&event.target.closest('button,a,summary,input,textarea,select,[contenteditable="true"]'))return;
  if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(key))event.preventDefault();keys.add(key);
  if(key===' ')toggle();else if(key==='c')calibrate();else if(key==='r')recall();else if(key==='shift')queueAction('shortDash','local-keyboard');else if(key==='q')queueAction('longDash','local-keyboard');else if(key==='f')queueAction('fireAtWill','local-keyboard');else if(key==='g')toggleAutonomy('local-keyboard');else if(key==='y')decideProposal(true);else if(key==='n')decideProposal(false);
});
document.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
window.addEventListener('blur',()=>{calibration.cancel();keys.clear();qaMissingHands.clear();pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopVoice();keys.clear();qaMissingHands.clear();camera.stop('Page backgrounded · activate camera again');if(source==='camera')source='off';}});
window.addEventListener('pagehide',()=>{stopVoice();camera.stop('Page closed');});
function synthetic(now:number){
  if(qaAim&&view){const target=view.projectFixtureTarget(qaAim,sim);syntheticAim.x+=(target.x-syntheticAim.x)*.15;syntheticAim.y+=(target.y-syntheticAim.y)*.15;}
  syntheticAim.x=clamp(syntheticAim.x+((keys.has('arrowright')?1:0)-(keys.has('arrowleft')?1:0))*.012);
  syntheticAim.y=clamp(syntheticAim.y+((keys.has('arrowup')?1:0)-(keys.has('arrowdown')?1:0))*.012);
  const heldPose=(hand:'Left'|'Right')=>{for(const [id,key] of [['recall','v'],['deploy','k'],['pilotFire','j'],['padisarahFire','h']] as const)if(keys.has(key)&&session.bindings[id].hand===hand)return session.bindings[id].pose;return 'Open_Palm';};
  const sample:Observation={epoch:controls.epoch,sequence:++syntheticSeq,capturedAt:now,processingMs:0,hands:[{side:'Left',palm:{x:.3+((keys.has('d')?1:0)-(keys.has('a')?1:0))*.075,y:.5+((keys.has('s')?1:0)-(keys.has('w')?1:0))*.075},gesture:{category:heldPose('Left'),score:1},confidence:1},{side:'Right',palm:{x:.7+syntheticAim.x*.12,y:.5-syntheticAim.y*.10},gesture:{category:heldPose('Right'),score:1},confidence:1}]};
  if(syntheticLoss)sample.hands.pop();sample.hands=sample.hands.filter(h=>!qaMissingHands.has(h.side));diagnosticSample=sample;controls.ingest(sample,now);
}
let lastDraw=0;
function weaponBlock(now:number){
  if(renderState!=='ready'||(stage==='arena'&&!view))return renderMessage||'graphics not ready';
  if(stage==='arena'&&sim.outcome!=='playing')return sim.outcome==='won'?'arena clear':'mech disabled';
  if(cameraUnavailable())return 'camera off; return to setup to activate';
  if(document.hidden)return 'page backgrounded';
  if(source==='camera'&&camera.loading)return 'camera / model loading';
  if(controls.paused)return 'paused; '+(resumeIntent.message(now)||controls.reason);

  if(!controls.latest||now-controls.latest.capturedAt>200)return 'waiting for fresh tracking';
  if(!controls.inputArmed)return 'open both hands before shooting';
  if(!controls.handReady(session.bindings.pilotFire.hand,now))return `${session.bindings.pilotFire.hand} hand input unavailable; combat continues`;
  const hand=session.bindings.pilotFire.hand;
  if(!recognize(controls.latest.hands.find(h=>h.side===hand)?.gesture,controls.recognition[hand],hand==='Left'?controls.bindings.left:controls.bindings.right))return `${hand} hand tracked; gesture uncertain or unsupported`;
  return '';
}
function readinessCondition(id:string,label:string,ready:boolean,detail=''){
  const node=el(id);node.textContent=`${ready?'Ready':'Needs attention'} · ${label}${detail?' · '+detail:''}`;node.classList.toggle('is-ready',ready);
}
function fireStatus(id:string,text:string){const node=el(id);node.textContent=text;node.classList.toggle('is-held',text.startsWith('Fire input held'));node.classList.toggle('is-blocked',text.startsWith('Blocked'));}
function loop(now:number){
  if(!document.hidden){if(source==='synthetic')synthetic(now);else if(source==='camera')void camera.pump();}
  if(lastEpoch!==controls.epoch)clearPending();
  if(!document.hidden)calibration.update(now,controls);
  if(resumeIntent.pending&&!canRequestResume())resumeIntent.cancel();
  if(!document.hidden)resumeIntent.update(now,controls);
  // Previous frame's preview has had a paint opportunity; start conservative visible dwell now.
  if(!document.hidden&&now-lastDraw<200)controls.markRendered(previousPreview,now);
  if(lastAimRun!==sim.runId||lastAimEpoch!==controls.epoch){lastWorldAim=null;lastAimRun=sim.runId;lastAimEpoch=controls.epoch;}
  const pointer=stage==='arena'&&view&&lastWorldAim&&!controls.handReady('Right',now)?view.projectWorld(lastWorldAim,sim):controls.pointer(now);
  const aim=stage==='arena'&&view&&renderState!=='lost'?view.aim(pointer,sim):{point:{x:pointer.x,y:pointer.y},target:stage==='controls'&&Math.hypot(pointer.x,pointer.y)<.15?'T1' as TargetId:null};
  if(stage==='arena'){if(lastWorldAim&&!controls.handReady('Right',now))aim.point={...lastWorldAim};else lastWorldAim={...aim.point};}
  if(Math.abs(pointer.x*.88)>1||Math.abs(pointer.y*.72)>1)aim.target=null;
  const pendingBefore=controls.bindings.pending;
  const out=controls.update(now,aim.target);
  if(stage==='arena'&&previousPreview&&!pendingBefore&&!controls.preview&&!out.commit&&!out.recall&&controls.inputArmed)sim.events.add(sim.tick,'Deploy','Cancelled','Initiating hand input unavailable',previousPreview);
  if(stage==='arena'&&pendingBefore&&!out.commit&&!out.recall&&(controls.bindings.pending?.type!==pendingBefore.type||(pendingBefore.type==='INTERCEPT'&&controls.preview!==pendingBefore.targetId)))sim.events.add(sim.tick,pendingBefore.type==='RECALL'?'Recall':'Deploy / redirect','Cancelled','Pose, target or tracking changed',pendingBefore.type==='INTERCEPT'?pendingBefore.targetId:null);
  if(stage==='arena'&&previousPreview&&!controls.preview&&!out.commit&&!controls.paused)sim.message='No order sent; use your configured Deploy input over a visible candidate';
  if(lastEpoch!==controls.epoch)clearPending();
  if(controls.preview)practiceFeedback.clear();
  if(out.recall){if(stage==='arena'){voiceRecall.invalidate();pending.push(sim.envelope({type:'RECALL'},'local-hand-recall',`cmd-${++commandId}`));}else practiceFeedback.recall(now);}
  if(out.commit){if(stage==='arena')pending.push(sim.envelope({type:'INTERCEPT',targetId:out.commit},'local-hand-commit',`cmd-${++commandId}`));else practiceFeedback.commit(out.commit,now);}
  if(stage==='arena'&&controls.inputArmed)for(const action of out.actions??[])queueAction(action,'local-hand');
  if(stage==='arena')clock.advance(now,controls.paused||document.hidden||renderState!=='ready'||!view,()=>{const commands=pending;pending=[];const before=sim.accepted;const frame={...out.frame,aim:aim.point};const intents:ActionIntent[]=queuedActions.map(item=>sim.intent(item.action==='fireAtWill'?{type:'DRONE_POLICY',enabled:!sim.fireAtWill,mode:preferredPolicy}:{type:'DASH',kind:item.action==='shortDash'?'short':'long',direction:sim.dashDirection(frame)},item.source));queuedActions=[];
  if(queuedPolicy){intents.push(sim.intent({type:'DRONE_POLICY',enabled:sim.fireAtWill,mode:queuedPolicy}));queuedPolicy=null;}
  if(queuedAutonomy){intents.push(sim.intent({type:'AUTONOMY',enabled:queuedAutonomy.enabled,fire:queuedAutonomy.enabled},queuedAutonomy.source));queuedAutonomy=null;}
  // Agent envelopes are created here, at the tick they are stepped (fresh id, run and tick); pilot commands still outrank them.
  const agentCommands=agentController.drain(sim);void before;
  if(gameplayActive()&&sim.tick%15===0&&!commands.length&&!agentCommands.length&&!intents.length){
    const targetAlive=(target:TargetId)=>sim.turrets.some(t=>t.id===target&&t.health>0);
    orderQueue.discardImpossible(order=>order.assignments.some(a=>!targetAlive(a.target)));
    orderQueue.dispatch(order=>order.assignments.every(a=>sim.funnels.some(f=>f.id===a.unit&&f.order.type==='RECALL')&&sim.canRouteIntercept(a.unit,a.target)),order=>{
      if(!approveVoiceAssignment(sim,order.assignments,order.reason))return false;
      const batch=agentController.drain(sim);
      const accepted=sim.accepted;
      sim.commands(batch);
      return sim.accepted>accepted;
    });
  }
  const recalls=sim.recalls;
  sim.step(frame,[...commands,...agentCommands],session.autofire&&controls.inputArmed,intents);agentController.observe(sim);
  if(sim.recalls>recalls)clearWaitingOrders();
  // Acknowledge the pilot's gesture only if one of the PILOT's own commands was accepted.
  if(commands.length)controls.acknowledgeCommand(commands.some(c=>sim.commandLog.some(r=>r.commandId===c.commandId&&r.outcome==='accepted')));});else clock.reset();
  if(stage==='arena'&&(sim.outcome!=='playing'||(sim.mode==='training'&&sim.trainingStep===5))){resumeIntent.cancel();if(!controls.paused){stopVoice();controls.pause(sim.mode==='training'?'Practice complete':sim.message);clearPending();}}
  if(!controls.inputArmed)sim.stopFire();
  const blocked=weaponBlock(now),fireText=practiceFire.text(out.frame.fire,controls.latest?.hands.find(h=>h.side===session.bindings.pilotFire.hand),blocked,session.bindings.pilotFire,session.durationMs);
  const unitHand=session.bindings.padisarahFire.hand,unitPose=unitHand==='Left'?controls.bindings.left:controls.bindings.right;
  const unitText=!controls.inputArmed?'Blocked: paused / fresh open-hand recovery required':!sim.fireAtWill&&!(session.autofire&&!sim.directAutofireSuppressed)&&!unitPose?`Blocked: ${unitHand} hand gesture uncertain`:stage==='arena'?sim.fireState:out.frame.padisarahFire?'Fire input held (practice only)':'Holding fire';
  for(const id of ['unit-fire-status','camera-unit-fire','practice-unit-fire'])el(id).textContent=`Padisarah: ${unitText}${sim.fireAtWill?' | FAW '+sim.preferredPolicy+' / AUTO FIRE ON':session.autofire&&!sim.directAutofireSuppressed?' | DIRECT AUTO FIRE ON':' | manual'}${stage==='controls'?' | '+actionLabel('padisarahFire'):''}`;
  renderLog();renderAbilities();renderSupervisor();
  if(stage==='arena'&&view&&renderState!=='lost'){fx?.update(sim,controls.preview,aim.target,hudFeed.targetMarks());view.draw(sim,controls.preview,aim.point,aim.target);hudBridge?.update(sim);hud?.update({sim,preview:controls.preview,aimed:aim.target,camera:view.camera});}
  el('tracking-preview').hidden=source!=='camera';el('toggle-camera-preview').hidden=stage!=='arena'||settingsOpen;el('toggle-camera-preview').textContent=showCameraDuringPlay?'Hide camera preview':'Show camera preview';
  trackingPreview.render(video,now,controls.epoch,source==='camera'&&camera.active&&!document.hidden,source==='camera'&&camera.loading&&!document.hidden,out.frame.fire&&!blocked,session.bindings.pilotFire.hand);
  for(const [side,id]of [['Left','left-dot'],['Right','right-dot']]as const){const hand=controls.latest?.hands.find(h=>h.side===side);const dot=el(id);dot.style.opacity=hand?'1':'.2';if(hand){const center=controls.neutral?.[side==='Left'?'left':'right']??{x:side==='Left'?.3:.7,y:.5};dot.style.left=`${clamp(50+(hand.palm.x-center.x)*300,5,95)}%`;dot.style.top=`${clamp(50+(hand.palm.y-center.y)*300,10,90)}%`;}}
  const sourceStatus=source==='synthetic'?'Synthetic observations · no camera':camera.status;
  if(el('source-status').textContent!==sourceStatus)el('source-status').textContent=sourceStatus;
  if(stage==='controls'){
    el('prepare-camera').hidden=!cameraSetupRequested&&source!=='synthetic';
    el('prepare-camera-feed').hidden=!cameraSetupRequested;
    el('prepare-calibration').hidden=cameraUnavailable()||camera.loading;
    el('prepare-launch').hidden=!controls.calibrated||cameraUnavailable();
    el('stop').hidden=!camera.active&&!camera.loading;
    el('activate').textContent=camera.loading?'Connecting webcam…':camera.active?'Reactivate webcam':'Activate webcam';
    el<HTMLButtonElement>('activate').disabled=camera.loading;
  }
  const privacy=voiceRunning()?'VOICE USES ELEVENLABS':camera.active?'CAMERA PROCESSED LOCALLY':'CAMERA AND MIC OFF';
  if(el('privacy-mode').textContent!==privacy)el('privacy-mode').textContent=privacy;
  el('calibration-status').textContent=(controls.calibrated?'Neutral captured. ':'')+controls.reason;
  for(const kind of ['move','aim'] as const){const input=el<HTMLInputElement>(`${kind}-sensitivity`),value=controls.sensitivity[kind];input.disabled=!controls.paused;input.value=String(value);el(`${kind}-sensitivity-value`).textContent=`${value.toFixed(1)}×`;}
  el<HTMLButtonElement>('reset-sensitivity').disabled=!controls.paused;
  for(const side of ['Left','Right'] as const){const select=el<HTMLSelectElement>(`preset-${side}`);select.disabled=!controls.paused;select.value=controls.recognition[side];}
  const diagnosticHands=diagnosticSample&&diagnosticSample.epoch===controls.epoch&&now>=diagnosticSample.capturedAt&&now-diagnosticSample.capturedAt<=200?diagnosticSample.hands:[];
  for(const name of gestureNames){const active=diagnosticHands.filter(h=>(h.side==='Left'||h.side==='Right')&&recognize(h.gesture,controls.recognition[h.side])===name).map(h=>`${h.side} ${h.gesture!.score.toFixed(2)}`)??[];el(`gesture-live-${name}`).textContent=active.length?`Detected (not input acceptance): ${active.join(' / ')}`:'Not currently recognised';}
  el<HTMLButtonElement>('calibrate').disabled=cameraUnavailable()||!controls.paused||calibration.pending;
  el('calibrate').textContent=calibration.pending?'Checking both hands...':calibration.result.includes('expired')||calibration.result.includes('cancelled')?'Retry hand check / C':controls.calibrated?'Recheck both hands / C':'Check both hands / C';
  el('cancel-calibration').hidden=!calibration.pending;
  const calibrationMessage=calibration.message(now,controls,source);if(el('calibration-guide-status').textContent!==calibrationMessage)el('calibration-guide-status').textContent=calibrationMessage;
  const readiness=controls.readiness(now),cameraReady=source==='synthetic'||(source==='camera'&&camera.active&&!camera.loading),cameraDetail=source==='synthetic'?'synthetic rehearsal; camera bypassed':source==='camera'?(camera.loading?'camera / model loading':camera.active?'camera and local model active':'camera inactive'):'activate camera or choose synthetic rehearsal';
  readinessCondition('readiness-camera','Camera / source',cameraReady,cameraDetail);readinessCondition('readiness-hands','Both hands accepted',readiness.bothHands);readinessCondition('readiness-open','Open posture',readiness.openPosture);
  const readyCount=[cameraReady,readiness.bothHands,readiness.openPosture].filter(Boolean).length;el('readiness-summary').textContent=`Start readiness · ${readyCount} / 3`;el('readiness-guidance').textContent=cameraReady?(readiness.ready?'Open both hands comfortably; this position becomes your centre.':readiness.blocker):cameraDetail;
  el('input-details-summary').textContent='Input details · local and transient';el('input-fresh').textContent=diagnosticHands.some(h=>h.side!=='Left'&&h.side!=='Right')?'No · unknown hand identity; input blocked':readiness.fresh?'Yes · ≤ 200 ms':'No';el('input-open').textContent=readiness.openPosture?'Yes · both Open Palm':'No';
  for(const side of ['Left','Right'] as const){const hand=diagnosticHands.find(h=>h.side===side);el(`input-${side.toLowerCase()}-gesture`).textContent=hand?`${hand.gesture?.category??'Unknown'} · ${hand.gesture?.score.toFixed(2)??'no score'} · ${recognize(hand.gesture,controls.recognition[side])?'recognised':'tracked, gesture uncertain'}`:'Tracking unavailable';}
  el('input-presets').textContent=`Left ${controls.recognition.Left} / Right ${controls.recognition.Right}`;
  el<HTMLButtonElement>('enter').disabled=!controls.calibrated||renderState!=='ready';
  el<HTMLButtonElement>('train').disabled=!controls.calibrated||renderState!=='ready';
  el('arena-error').hidden=!renderMessage;el('arena-error').textContent=renderMessage;
  el('synthetic-help').hidden=source!=='synthetic'||!el('title-screen').hidden;el('tracking-state').textContent=controls.paused?'PAUSED':controls.needsRearm?'RECOVERY REQUIRED':controls.latest?'TRACKING':'INPUT NEUTRAL';
  el('metrics').textContent=`${source==='synthetic'?'Synthetic · ':''}processing ${controls.processingMs.toFixed(1)} ms · sample age ${controls.latest?Math.max(0,now-controls.latest.capturedAt).toFixed(0):'—'} ms · tracking pauses ${controls.trackingPauses}`;
  el('health').textContent=String(sim.health);el<HTMLMeterElement>('health-meter').value=sim.health;el('remaining').textContent=`${sim.turrets.filter(t=>t.health>0).length} / ${sim.turrets.length}`;
  el('order-text').textContent=sim.funnels.map(f=>f.id+': '+(f.order.type==='INTERCEPT'?f.order.targetId:'Follow')+(f.blocked?' Blocked':'')).join(' / ');el('order-text').title=sim.funnels.map(f=>f.id+': '+f.status+' / '+f.origin).join(' / ');el('order-message').textContent=sim.groupState+' / '+sim.message;
  el('hit-feedback').textContent=sim.lastHit&&sim.tick-sim.lastHit.tick<90?`${sim.lastHit.team==='funnel'?'Padisarah':'Pilot'} hit ${sim.lastHit.target} · collision confirmed`:'';
  el('training-panel').hidden=stage!=='arena'||sim.mode!=='training';
  el('training-step').textContent=source==='synthetic'?keyboardTrainingPrompt(sim.trainingStep,session.autofire):sim.trainingInstruction+([0,2].includes(sim.trainingStep)?' '+actionLabel('deploy'):sim.trainingStep===1?' '+(session.autofire?'AUTO FIRE ON':actionLabel('padisarahFire')):sim.trainingStep===3?' '+actionLabel('recall'):'');
  el('arena-title').textContent=sim.mode==='training'?'Practise deployment. No combat damage.':'Clear all six targets.';
  objective.hidden=sim.mode==='training'||sim.outcome!=='playing';
  el('training-help').textContent=controls.paused?(sim.trainingStep===5?'Repeat practice or enter combat when ready.':`Paused · ${resumeIntent.message(now)||controls.reason} · choose Resume when ready.`):sim.message;
  el('retry-training').textContent=sim.trainingStep===5?'Repeat practice':'Retry practice';
  const showResults=stage==='arena'&&sim.outcome!=='playing';el('results-panel').hidden=!showResults;
  el('results-title').textContent=sim.outcome==='won'?'Arena clear.':'Mech disabled.';
  const stats=sim.results;el('results-counts').textContent=`Targets cleared ${stats.turretsCleared} / ${sim.turrets.length} · Accepted deployments ${stats.deployments} · Recalls ${stats.recalls} · Padisarah hits ${stats.padisarahHits}`;
  if(showResults&&!resultsShown&&!settingsOpen)el('play-again').focus();resultsShown=showResults;
  const dwell=controls.commandProgress;
  el('arena-details-summary').textContent=`${sim.groupState} · ${controls.bindings.pending?`Confirming ${controls.bindings.pending.type==='RECALL'?'recall':controls.preview} · ${(dwell/controls.bindings.holdMs*100).toFixed(0)}%`:'no pending command'} · details`;
  el('preview-text').textContent=controls.bindings.consumed&&!controls.bindings.pending?'Open the initiating command hand, or confirm a different pose on that hand for 80 ms, to rearm':controls.bindings.pending?`Confirming ${controls.bindings.pending.type==='RECALL'?'recall':controls.preview} · ${(dwell/1000).toFixed(1)} / ${(controls.bindings.holdMs/1000).toFixed(1)} s` :aim.target?`Candidate ${aim.target} · ${actionLabel('deploy')}`:'Blocked · nominate a visible living target';el<HTMLProgressElement>('dwell').max=controls.bindings.holdMs;el<HTMLProgressElement>('dwell').value=dwell;
  const cameraOff=cameraUnavailable();
  el('pause-overlay').hidden=!controls.paused&&!controls.needsRearm;el('pause-overlay').querySelector('.eyebrow')!.textContent=cameraOff?'CAMERA OFF · SIMULATION PAUSED':controls.paused?'SIMULATION FROZEN':'INPUT HELD NEUTRAL · CHOOSE RESUME';el('pause-reason').textContent=renderMessage||controls.reason;el<HTMLButtonElement>('resume').disabled=cameraOff||sim.outcome!=='playing'||renderState!=='ready'||!view;el('resume').hidden=cameraOff;el('recover-camera').hidden=!cameraOff;
  el('pause-title').textContent=renderState!=='ready'?'Graphics recovery required.':sim.outcome==='won'?'Arena clear.':sim.outcome==='lost'?'Mech disabled.':cameraOff?'Return to setup to reactivate.':resumeIntent.pending?'Start requested · still paused.':'Paused · choose Resume.';
  el('pause-overlay').hidden ||= showResults||settingsOpen||(sim.mode==='training'&&sim.trainingStep===5);
  const startMessage=resumeIntent.message(now);
  for(const id of ['resume-status','practice-start-status'])if(el(id).textContent!==startMessage)el(id).textContent=startMessage;
  el<HTMLButtonElement>('resume').disabled ||= resumeIntent.pending;
  el('resume').textContent=resumeIntent.result?'Retry resume / Space':'Resume / Space';
  el('cancel-resume').hidden=!resumeIntent.pending;
  el('start-practice').hidden=resumeIntent.pending||(!controls.paused&&!controls.needsRearm);
  el<HTMLButtonElement>('start-practice').disabled=!canRequestResume();
  el('start-practice').textContent=resumeIntent.result?'Retry practice':'Start practice';
  el<HTMLButtonElement>('recalibrate-practice').disabled=cameraUnavailable()||!controls.paused||calibration.pending;
  el('pause-practice').hidden=controls.paused;el('cancel-practice').hidden=!resumeIntent.pending;
  el<HTMLButtonElement>('test-controls').disabled=resumeIntent.pending||!canRequestResume()||(!controls.paused&&!controls.needsRearm);
  fireStatus('weapon-status',fireText);fireStatus('practice-fire',fireText);fireStatus('camera-fire',fireText);
  el('reticle').style.left=`${50+pointer.x*44}%`;el('reticle').style.top=`${50-pointer.y*36}%`;el('reticle').classList.toggle('firing',out.frame.fire);const assignedUnits=sim.funnels.filter(f=>f.order.type==='INTERCEPT'&&f.order.targetId===aim.target).map(f=>f.id);el('target-label').textContent=aim.target?`Candidate ${aim.target} · ${sim.turrets.find(t=>t.id===aim.target)?.armed?"armed":"nonattacking"} · ${assignedUnits.length?'assigned '+assignedUnits.join(', '):'not assigned'}`:'';
  el('target-label').style.left=`${50+pointer.x*44}%`;el('target-label').style.top=`${50-pointer.y*36}%`;
  el('practice-reticle').style.left=`${50+pointer.x*43}%`;el('practice-reticle').style.top=`${42-pointer.y*32}%`;el('practice-reticle').classList.toggle('firing',out.frame.fire);
  el('practice-feedback').textContent=practiceFeedback.text(now,controls.paused?'Control test paused':controls.preview?`${controls.preview} · hold ${(dwell/1000).toFixed(1)} / ${(controls.bindings.holdMs/1000).toFixed(1)} s`:out.frame.fire?'FIRE held':`MOVE ${out.frame.move.x.toFixed(1)}, ${out.frame.move.y.toFixed(1)}`);
  previousPreview=controls.preview;lastDraw=now;renderCommandReadiness(controls.commandReadiness(now));
  if(stage==='arena'){
    const tracking=source==='camera'&&camera.ready?controls.trackingStatus(now):'';
    const hands=source==='synthetic'?'Keyboard rehearsal · camera off'
      :source==='off'?'Camera off'
      :calibration.pending?'Calibrating'
      :camera.ready?(controls.paused?'Tracking · arena paused':!controls.inputArmed?'Tracking · open hands to resume':'Tracking')
      :camera.status;
    inspector?.render(sim,lastWorldAim??sim.position,tracking,hands);
    inspector?.orderQueue?.render(orderQueue.rows(),voiceSupervisor.pending());
    renderVoiceStatus();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
if(qaEnabled){
  // Camera-free fixture: nomination assistance only; all actions still enter via observations.
  Object.assign(globalThis,{__pzQA:{aim:(id:TargetId|null)=>{if(source==='synthetic')qaAim=id;},snapshot:()=>({runId:sim.runId,mode:sim.mode,tick:sim.tick,paused:controls.paused,calibrated:controls.calibrated,trainingStep:sim.trainingStep,accepted:sim.accepted,pilotFire:sim.pilotFire,padisarahFire:sim.padisarahFire,hits:sim.padisarahHits,projectiles:sim.projectiles.length,events:sim.events.entries,actors:sim.turrets.map(t=>({id:t.id,health:t.health,armed:t.armed,position:t.position})),outcome:sim.outcome,source,fireAtWill:sim.fireAtWill,policy:sim.preferredPolicy,booster:sim.boosterState,dash:sim.dash,units:sim.funnels.map(f=>({id:f.id,order:f.order,status:f.status,origin:f.origin,position:f.position}))})}});
  const v02Panel=document.createElement('section');v02Panel.innerHTML='<button id="v02-replay">Check v0.3 gestures + guided practice + two wins + two replays (synthetic)</button><output id="v02-result">QA only · actual controls and simulation · camera off</output>';app.append(v02Panel);
  el('v02-replay').onclick=async()=>{
    if(qaV02Running||camera.active||camera.loading||settingsOpen)return;
    qaV02Running=true;el<HTMLButtonElement>('v02-replay').disabled=true;el('v02-result').textContent='RUNNING guided practice, collisions, two combat wins and two replays';
    const wait=async(check:()=>boolean)=>{const end=performance.now()+30000;while(!check()){if(document.hidden||source!=='synthetic'||settingsOpen||performance.now()>end)throw new Error('Interrupted or timed out');await new Promise(resolve=>setTimeout(resolve,25));}};
    const deploy=async(id:TargetId)=>{
      qaAim=id;await wait(()=>!!view&&view.aim(controls.pointer(performance.now()),sim).target===id);
      keys.delete('k');keys.delete('v');await new Promise(resolve=>setTimeout(resolve,100));const before=sim.deployments;keys.add('k');await wait(()=>sim.deployments>before);keys.delete('k');await new Promise(resolve=>setTimeout(resolve,100));
    };
    try{
      el('back').click();el('synthetic').click();restart();calibrate();await wait(()=>controls.calibrated);
      el('train').click();await wait(()=>!controls.paused);await deploy('T1');keys.add('h');await wait(()=>sim.trainingStep===2);keys.delete('h');
      await deploy('T2');const beforeRecall=sim.recalls;keys.add('v');await wait(()=>sim.recalls>beforeRecall);keys.delete('v');await wait(()=>sim.trainingStep===5);
      const training={complete:sim.trainingStep===5,hits:sim.padisarahHits,following:sim.groupState==='Following',indestructible:sim.turrets.every(t=>t.health===100),noEnemyFire:!sim.projectiles.some(p=>p.team==='enemy')};
      qaAim=null;el('retry-training').click();await wait(()=>!controls.paused);const repeated=sim.trainingStep===0;
      el('leave-training').click();await wait(()=>!controls.paused);const wins=[];
      for(let round=0;round<2;round++){
        for(const id of ['T1','T2','T3','T4','T5','T6'] as const){await deploy(id);keys.add('j');await wait(()=>sim.turrets.find(t=>t.id===id)!.health===0);keys.delete('j');}
        await wait(()=>sim.outcome==='won');wins.push({...sim.results,layout:{width:innerWidth,height:innerHeight,scrollY,boxes:Object.fromEntries(['scene','reticle','results-panel','play-again'].map(id=>[id,el(id).getBoundingClientRect().toJSON()]))}});qaAim=null;
        el('play-again').click();if(sim.tick!==0||sim.accepted!==0||sim.projectiles.length!==0)throw new Error('Replay state not clean');
        await wait(()=>!controls.paused);
      }
      el('v02-result').textContent='PASS '+JSON.stringify({training,repeated,wins,replays:2,setupPreserved:controls.calibrated&&stage==='arena',camera:'off'});
    }catch(error){el('v02-result').textContent='FAIL '+String(error);}
    finally{qaAim=null;qaV02Running=false;keys.clear();qaMissingHands.clear();pause();el<HTMLButtonElement>('v02-replay').disabled=false;}
  };
  const graphicsPanel=document.createElement('section');graphicsPanel.innerHTML='<button id="graphics-probe">Check graphics recovery (synthetic only)</button><output id="graphics-result">Run the synthetic control sequence first · no hardware camera</output>';el('app').append(graphicsPanel);
  el('graphics-probe').onclick=async()=>{
    const button=el<HTMLButtonElement>('graphics-probe'),result=el('graphics-result');
    if(source!=='synthetic'||stage!=='arena'||!view||renderState!=='ready'||sim.outcome!=='playing'){result.textContent='Run the synthetic control sequence first, with camera off.';return;}
    const gl=el<HTMLCanvasElement>('scene').getContext('webgl2'),extension=gl?.getExtension('WEBGL_lose_context');
    if(!extension){result.textContent='UNVERIFIED: browser graphics-loss test extension unavailable';return;}
    button.disabled=true;result.textContent='RUNNING real WebGL loss → frozen ticks → restore → explicit restart';
    const wait=async(condition:()=>boolean)=>{const deadline=performance.now()+5000;while(!condition()){if(document.hidden||source!=='synthetic'||stage!=='arena')throw new Error('interrupted');if(performance.now()>deadline)throw new Error('timeout');await new Promise(resolve=>setTimeout(resolve,50));}};
    const require=(condition:boolean)=>{if(!condition)throw new Error('assertion');};
    try{
      el('neutral-synthetic').click();await wait(()=>controls.ready(performance.now()));el('resume').click();const before=sim.tick;await wait(()=>sim.tick>before);
      extension.loseContext();await wait(()=>renderState==='lost');const frozen=sim.tick;
      await new Promise(resolve=>setTimeout(resolve,350));require(sim.tick===frozen&&controls.paused&&pending.length===0&&controls.preview===null);
      el('pause').click();require(controls.paused&&sim.tick===frozen);
      extension.restoreContext();await wait(()=>renderState==='restart-required');el('neutral-synthetic').click();await wait(()=>controls.ready(performance.now()));
      el('pause').click();require(controls.paused&&sim.tick===frozen);
      const oldRun=sim.runId;el('restart').click();require(sim.runId!==oldRun&&sim.tick===0&&sim.health===100&&sim.projectiles.length===0&&pending.length===0);
      await wait(()=>controls.ready(performance.now()));el('resume').click();await wait(()=>sim.tick>0);pause();
      result.textContent='PASS real WebGL recovery: frozen=true; preview cleared=true; restore alone blocked=true; explicit restart=true; safe resume=true; camera off';
    }catch{result.textContent='FAIL or INTERRUPTED graphics recovery check · no pass claimed';}
    finally{if(gl?.isContextLost())extension.restoreContext();pause();button.disabled=false;}
  };
  const capturePanel=document.createElement('section');capturePanel.innerHTML='<button id="capture-probe">Check native capture with synthetic video</button><output id="capture-result">QA only · no hardware camera</output>';el('app').append(capturePanel);
  el('capture-probe').onclick=async()=>{
    const button=el<HTMLButtonElement>('capture-probe'),result=el('capture-result');
    if(camera.active||camera.loading){result.textContent='Stop the webcam before this synthetic-only check.';return;}
    button.disabled=true;
    const unavailable=await checkWebcamAssets();
    if(unavailable||camera.active||camera.loading){button.disabled=false;result.textContent=unavailable??'Stop the webcam before this synthetic-only check.';return;}
    result.textContent='RUNNING native receiver comparison and detached synthetic video → real local worker';
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d')!;context.fillRect(0,0,640,480);
    let oldResult='accepted',corrected=false,observations=0,stream:MediaStream|undefined,probe:CameraInput|undefined,timer:ReturnType<typeof setInterval>|undefined,timeout:ReturnType<typeof setTimeout>|undefined;
    try {
      // Deliberately reproduce the previous receiver on artificial pixels only.
      try{const oldHost={bitmap:globalThis.createImageBitmap};const bitmap=await oldHost.bitmap(canvas);bitmap.close();}catch(error){oldResult=error instanceof TypeError?'TypeError':'rejected';}
      const bitmap=await captureBitmap(canvas);corrected=bitmap.width===640&&bitmap.height===480;bitmap.close();
      stream=canvas.captureStream(30);const syntheticStream=stream;const syntheticVideo=document.createElement('video');
      await new Promise<void>((resolve,reject)=>{
        probe=new CameraInput(syntheticVideo,()=>0,()=>{if(++observations>=3)resolve();},reason=>{if(reason!=='Starting camera'&&reason!=='Synthetic check complete')reject(new Error('synthetic capture stopped'));},{media:{getUserMedia:async()=>syntheticStream},createWorker:()=>new Worker('/tracking-worker.js'),bitmap:captureBitmap,now:()=>performance.now(),hidden:()=>document.hidden});
        let frame=0;timer=setInterval(()=>{context.fillStyle=++frame%2?'#101010':'#202020';context.fillRect(0,0,640,480);void probe!.pump();},33);
        timeout=setTimeout(()=>reject(new Error('synthetic capture timeout')),30000);void probe.activate();
      });
      result.textContent=`${corrected&&observations>=3?'PASS':'FAIL'} native capture: old receiver=${oldResult}; corrected canvas=${corrected}; detached video observations=${observations}; real local worker; hardware camera off`;
    } catch {result.textContent=`FAIL native capture: old receiver=${oldResult}; corrected canvas=${corrected}; detached video observations=${observations}; ${probe?.status??'browser synthetic API unavailable'}; hardware camera off`;}
    finally{clearInterval(timer);clearTimeout(timeout);probe?.stop('Synthetic check complete');stream?.getTracks().forEach(track=>track.stop());button.disabled=false;}
  };

}
if(qaEnabled){el('probe').hidden=false;el('probe').onclick=async()=>{const result=el('probe-result');const button=el<HTMLButtonElement>('probe');if(camera.active||camera.loading){result.textContent='Stop the webcam before this synthetic-only check.';return;}button.disabled=true;const unavailable=await checkWebcamAssets();if(unavailable||camera.active||camera.loading){button.disabled=false;result.textContent=unavailable??'Stop the webcam before this synthetic-only check.';return;}result.textContent='Loading local model · blank synthetic image only';const worker=new Worker('/tracking-worker.js');const timeout=setTimeout(()=>{worker.terminate();button.disabled=false;result.textContent='FAIL: local worker timeout';},30000);worker.onerror=()=>{clearTimeout(timeout);worker.terminate();button.disabled=false;result.textContent='FAIL: worker error';};worker.onmessage=async({data})=>{if(data.type==='ready'){const canvas=new OffscreenCanvas(640,480);canvas.getContext('2d')!.fillRect(0,0,640,480);const bitmap=canvas.transferToImageBitmap();worker.postMessage({type:'frame',bitmap,epoch:0,sequence:1,capturedAt:performance.now()},[bitmap]);}else{clearTimeout(timeout);worker.terminate();button.disabled=false;result.textContent=data.type==='observation'?`PASS: local model processed blank synthetic image; ${data.hands.length} hands, ${data.processingMs.toFixed(1)} ms (not camera latency)`:'FAIL: '+data.message;}};worker.postMessage({type:'init'});};}

inspector=installInspector(()=>view?.resize(),()=>openSettings(),{
  promote:id=>{if(gameplayActive())orderQueue.promote(id);},
  cancel:id=>{orderQueue.cancel(id);},
  confirm:()=>voiceSupervisor.confirm(),
  defer:()=>voiceSupervisor.confirm(true),
  dismiss:()=>voiceSupervisor.clear(),
})??null;
el('voice-panel')?.append(createVoiceGuide());
hud=hudClassic?null:mountHud();if(hud&&qaEnabled)Object.assign(globalThis,{__hudFeed:hudFeed});
// ?hud-demo publishes SIMULATED events and owns the HUD's Accept/Dismiss; the real supervisor bridge is never connected then.
if(hud&&demoRequested())startHudDemo(hudFeed,el('arena'));else if(hud){hudBridge=connectHud(agentController,hudFeed);voiceHud=createVoiceHudBridge(hudFeed);}
const mechPanel=document.createElement('section');mechPanel.id='mech-panel';el('weapon-status').before(mechPanel);mechPanel.append(el('weapon-status'));const booster=document.createElement('div');booster.innerHTML='<output id="booster-status">Booster ready</output><div class="ability-buttons"><button id="short-dash">Short / Shift</button><button id="long-dash">Long / Q</button></div>';mechPanel.append(booster);
const policyPanel=document.createElement('div');policyPanel.className='ability-buttons';policyPanel.innerHTML='<button id="fire-at-will" aria-pressed="false">FAW OFF / F</button><select id="faw-mode" aria-label="Fire at will policy"><option value="A">A / Mech nearest</option><option value="B">B / Each unit nearest</option><option disabled>C / Priority (planned)</option></select>';el('padisarah-panel').append(policyPanel);
el('short-dash').onclick=()=>queueAction('shortDash','local-button');el('long-dash').onclick=()=>queueAction('longDash','local-button');el('fire-at-will').onclick=()=>queueAction('fireAtWill','local-button');el<HTMLSelectElement>('faw-mode').onchange=()=>{if(!gameplayActive())return;preferredPolicy=el<HTMLSelectElement>('faw-mode').value as DronePolicy;queuedPolicy=preferredPolicy;};
function gameplayActive(){return stage==='arena'&&!settingsOpen&&!document.hidden&&!controls.paused&&controls.inputArmed&&sim.outcome==='playing'&&renderState==='ready';}
const voiceButton=el<HTMLButtonElement>('voice-toggle');
const voiceStatus=el('voice-status');
let voiceState:import('./voice-recall').VoiceStatus='off';
let voiceDetail='';
const voiceLabels={off:'Off',connecting:'Connecting',listening:'Listening',speaking:'Agent speaking',unavailable:'Unavailable'};
function voiceRunning(){return voiceState==='connecting'||voiceState==='listening'||voiceState==='speaking';}
function renderVoiceStatus(){
  const running=voiceRunning();
  const text=voiceState==='off'&&!gameplayActive()?'Off · Resume to start voice'
    :voiceLabels[voiceState]+(voiceDetail?' · '+voiceDetail:'');
  if(voiceStatus.textContent!==text)voiceStatus.textContent=text;
  const disabled=!running&&!gameplayActive();
  if(voiceButton.disabled!==disabled)voiceButton.disabled=disabled;
}
const voiceRecall=createVoiceRecall(() => recall('local-voice-recall'), (state, detail) => {
  voiceState=state;voiceDetail=detail??'';
  voiceButton.textContent=voiceRunning()?'Stop voice':'Start voice';
  if(state==='off'||state==='unavailable'){
    inspector?.voiceTranscript.discardPartial();
    voiceSupervisor.clear();
  }
  renderVoiceStatus();voiceHud?.status(state,detail);
}, event=>{inspector?.voiceTranscript.update(event);voiceHud?.event(event);},
()=> {
  const tools=getSupervisorTools()?.adapters.clientTools();
  return {
    ...(tools?{get_game_state:tools.get_game_state,get_recent_events:tools.get_recent_events,get_task_status:tools.get_task_status}:{}),
    ...voiceSupervisor.clientTools(),
  };
});
function stopVoice(){if(voiceState!=='off')voiceRecall.stop();}
voiceButton.onclick=()=>{
  if(voiceRunning())stopVoice();
  else if(gameplayActive()){
    inspector?.showVoice();
    void voiceRecall.start();
  }
};
function queueAction(action:ExtraAction,source:ActionIntent['source']){if(!gameplayActive())return;if(action==='fireAtWill'&&sim.mode==='training'){sim.message='Fire at will unavailable in guided manual practice; use Deploy and manual fire.';return;}if(!queuedActions.some(q=>q.action===action))queuedActions.push({action,source});}
function renderAbilities(){const enabled=gameplayActive();el('booster-status').textContent='Booster: '+sim.boosterState;for(const id of ['short-dash','long-dash'])el<HTMLButtonElement>(id).disabled=!enabled||sim.tick<sim.dashReadyAt;const button=el<HTMLButtonElement>('fire-at-will');button.disabled=!enabled||sim.mode==='training';button.textContent=sim.mode==='training'?'FAW unavailable':sim.fireAtWill?'FAW ON / F':'FAW OFF / F';button.title=sim.mode==='training'?'Guided practice requires manual assignments and fire':'Automatic targeting and fire. Accepted manual Deploy or Recall exits this policy.';button.setAttribute('aria-pressed',String(sim.fireAtWill));el<HTMLSelectElement>('faw-mode').disabled=!enabled||sim.mode==='training';el<HTMLSelectElement>('faw-mode').value=preferredPolicy;}


if(qaEnabled){const qa=(globalThis as unknown as {__pzQA:{snapshot:()=>object;loss?:(side:string,lost:boolean)=>void}}).__pzQA;const previous=qa.snapshot;qa.snapshot=()=>({...previous(),position:{...sim.position},worldAim:lastWorldAim?{...lastWorldAim}:null,tracking:controls.trackingStatus(performance.now()),configuration:controls.configuration});qa.loss=(side,lost)=>{if(source==='synthetic'&&['Left','Right'].includes(side)){if(lost)qaMissingHands.add(side);else qaMissingHands.delete(side);}};}
