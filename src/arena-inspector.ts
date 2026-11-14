import type {CommandAction,CommandReadiness} from './gestures';
import {arenaBounds} from './arena-layout';
import {barriers} from './cover';
import type {Simulation} from './simulation';
import type {Vec2} from './contracts';
import {installVoiceTranscript} from './voice-transcript';

export const mapPoint=(p:Vec2,size:number)=>({x:(p.x+arenaBounds.half)/arenaBounds.width*size,y:(p.y+arenaBounds.half)/arenaBounds.width*size});

/** Presentation only: the full-reveal map never nominates or issues a command. */
export function installInspector(resize:()=>void,settings:()=>void){
 if(typeof ResizeObserver==='undefined')return;
 const get=(id:string)=>document.getElementById(id)!;
 const arena=get('arena'),shell=document.createElement('section');shell.id='arena-shell';
 shell.innerHTML='<div id="mission-bar"><div id="mission-stats"></div><div id="mission-actions"><button id="mission-menu">Menu / Settings</button></div></div><div id="training-banner" hidden></div><div id="arena-workspace"><aside id="arena-inspector" aria-label="Mission inspector"><div id="inspector-status"><div id="tracking-line" role="status"></div></div><div id="inspector-map"><span class="eyebrow">N / Debug map</span><canvas id="minimap" width="200" height="200" aria-label="North-up full arena map, read only"></canvas></div><div id="inspector-aux"><div role="tablist" aria-label="Inspector"><button id="log-tab" role="tab" aria-selected="true" aria-controls="log-panel">Command log</button><button id="input-tab" role="tab" aria-selected="false" aria-controls="input-panel">Input details</button></div><div id="log-panel" role="tabpanel"></div><div id="input-panel" role="tabpanel" hidden><p>Missing hands stop only their own manual input. Combat continues. Pause to rest.</p></div></div></aside></div>';
 arena.before(shell);get('arena-workspace').prepend(arena);
 const inputs=document.createElement('div');inputs.id='arena-inputs';
 inputs.innerHTML='<div><strong>Hands</strong><span id="arena-hands" role="status">Camera off</span></div><div id="arena-voice"><strong>Voice</strong></div>';
 get('mission-bar').after(inputs);
 get('arena-voice').append(get('voice-status'),get('voice-toggle'));
 const top=arena.querySelector('.arena-top');if(top)get('mission-stats').append(top);
 get('mission-actions').prepend(get('arena-actions'));
 get('mission-actions').append(get('recall'),get('back'));
 get('mission-menu').onclick=settings;
 const pad=document.createElement('section');pad.id='padisarah-panel';pad.setAttribute('aria-label','Padisarah commands');pad.innerHTML='<div id="command-readiness">'+(['deploy','recall'] as const).map(action=>'<div class="command-readiness-card"><div><span>'+ (action==='deploy'?'Deploy':'Recall') +'</span><strong id="command-'+action+'-state">Waiting for hand</strong></div><progress id="command-'+action+'-progress" max="1" value="0" aria-label="'+action+' activation progress"></progress></div>').join('')+'</div>';get('unit-fire-status').after(pad);pad.prepend(get('unit-fire-status'));
 const commandDetails=document.createElement('div');commandDetails.id='command-input-details';commandDetails.innerHTML='<p id="command-deploy-details"></p><p id="command-recall-details"></p>';get('input-details').append(commandDetails);
 for(const id of ['weapon-status','padisarah-panel','training-panel'])get('inspector-status').append(get(id));
 get('training-banner').append(get('training-step'));
 get('training-banner').append(get('training-panel'));
 get('input-panel').append(get('order-message'));
 const details=get('arena-details') as HTMLDetailsElement;details.open=true;pad.append(get('order-text'));get('input-panel').append(details);
 get('log-panel').append(get('command-log'));
 const latest=get('command-log').querySelector('button');if(latest){const heading=latest.parentElement;get('log-tab').after(latest);if(heading&&heading!==get('command-log')&&!heading.contains(get('log-scroll')))heading.hidden=true;}
 get('input-tab').insertAdjacentHTML('afterend','<button id="voice-tab" role="tab" aria-selected="false" aria-controls="voice-panel">Voice</button>');
 get('input-panel').insertAdjacentHTML('afterend','<div id="voice-panel" role="tabpanel" aria-labelledby="voice-tab" hidden><p id="voice-result" role="status">Game · no voice command yet</p><ol id="voice-transcript" aria-label="Voice conversation" tabindex="0"></ol></div>');
 const voiceTranscript=installVoiceTranscript(get('voice-transcript') as HTMLOListElement,get('voice-result'));
 const tabIds=['log','input','voice'] as const;
 const selectTab=(active:typeof tabIds[number])=>{
  for(const id of tabIds){
   get(`${id}-panel`).hidden=id!==active;
   get(`${id}-tab`).setAttribute('aria-selected',String(id===active));
   get(`${id}-tab`).tabIndex=id===active?0:-1;
  }
  if(active==='input'&&!get('session-settings').hasAttribute('open'))get('input-panel').append(get('input-details'));
 };
 for(const [index,id] of tabIds.entries()){
  const tab=get(`${id}-tab`);
  tab.onclick=()=>selectTab(id);
  tab.onkeydown=event=>{
   if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
   event.preventDefault();event.stopPropagation();
   const next=tabIds[(index+(event.key==='ArrowRight'?1:-1)+tabIds.length)%tabIds.length];
   selectTab(next);get(`${next}-tab`).focus();
  };
 }
 selectTab('log');
 new ResizeObserver(resize).observe(arena);
 const canvas=get('minimap') as HTMLCanvasElement,ctx=canvas.getContext('2d');
 const render=(sim:Simulation,aim:Vec2,tracking:string,hands:string)=>{
  const indicator=get('arena-hands');
  if(indicator.textContent!==hands)indicator.textContent=hands;
  get('tracking-line').textContent=tracking;get('training-banner').hidden=sim.mode!=='training';
  const pilot=get('weapon-status'),unit=get('unit-fire-status');pilot.title=pilot.textContent??'';unit.title=unit.textContent??'';
  pilot.textContent=pilot.title.startsWith('Ready')?'Pilot: Ready':pilot.title.startsWith('Fire input held')?'Pilot: Fire input held':pilot.title.startsWith('Stopped')?'Pilot: Stopped':pilot.title.replace(/^Blocked [^ ]+ /,'Pilot: Blocked / ').replace('; combat continues','');
  unit.textContent=unit.title.replace('hand gesture uncertain','input uncertain').replace(' | manual','').replace('Fire held: weapon cooldown','weapon cooldown');
  if(pilot.title.includes('Blocked')&&pilot.title.includes('paused'))pilot.textContent='Pilot: Paused';
  if(unit.title.includes('Blocked')&&unit.title.includes('paused'))unit.textContent='Padisarah: Paused'+(unit.title.includes('AUTO FIRE ON')?' / AUTO FIRE ON':'');
  for(const side of ['Left','Right'])if(tracking.includes(side+': no input'))unit.textContent=unit.textContent!.replace(side+' input uncertain',side+' no input');
  if(!ctx)return;
  const size=canvas.width;ctx.clearRect(0,0,size,size);ctx.fillStyle='#101e29';ctx.fillRect(0,0,size,size);ctx.strokeStyle='#9d91b2';ctx.strokeRect(.5,.5,size-1,size-1);
  ctx.fillStyle='#69778a';for(const b of barriers){const p=mapPoint({x:b.minX,y:b.minY},size);ctx.fillRect(p.x,p.y,(b.maxX-b.minX)/arenaBounds.width*size,(b.maxY-b.minY)/arenaBounds.width*size);}
  const dot=(position:Vec2,color:string,r:number)=>{const p=mapPoint(position,size);ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();return p;};
  for(const t of sim.turrets)if(t.health>0){const p=dot(t.position,t.armed?'#edab91':'#8dd9d0',4);ctx.fillStyle='#f2edf8';ctx.font='11px sans-serif';ctx.fillText(t.id,p.x+5,p.y-4);}
  for(const unit of sim.funnels)dot(unit.position,'#cbb7f4',3);
  const p=dot(sim.position,'#f5f0dd',4),angle=Math.atan2(aim.y-sim.position.y,aim.x-sim.position.x);ctx.strokeStyle='#f5f0dd';ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+Math.cos(angle)*11,p.y+Math.sin(angle)*11);ctx.stroke();
  for(const unit of sim.funnels)if(unit.order.type==='INTERCEPT'){const targetId=unit.order.targetId,t=sim.turrets.find(t=>t.id===targetId&&t.health>0);if(t){const q=mapPoint(t.position,size),from=mapPoint(unit.position,size);ctx.strokeStyle='#d5baff';ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.beginPath();ctx.arc(q.x,q.y,8,0,Math.PI*2);ctx.stroke();}}
 };
 return {render,voiceTranscript,showVoice:()=>selectTab('voice')};
}

export function renderCommandReadiness(readiness:Record<CommandAction,CommandReadiness>){
 for(const action of ['deploy','recall'] as const){const item=readiness[action],state=document.getElementById('command-'+action+'-state'),progress=document.getElementById('command-'+action+'-progress') as HTMLProgressElement|null,details=document.getElementById('command-'+action+'-details');
  if(state){state.textContent=item.state;state.title=item.reason;}if(progress){progress.max=item.durationMs;progress.value=item.progress;progress.setAttribute('aria-valuetext',item.state+': '+item.progress+' of '+item.durationMs+' ms. '+item.reason);}
  if(details)details.textContent=(action==='deploy'?'Deploy':'Recall')+' / '+item.hand+' / '+item.state+' / '+item.reason+' / pose '+(item.recognized??'uncertain')+' / score '+(item.score===null?'unavailable':item.score.toFixed(2))+' / active threshold '+item.threshold.toFixed(2)+(item.interruption?' / Last command interruption: '+item.interruption:'');
 }
}
