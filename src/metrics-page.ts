// Renders metrics.json (written by `npm run metrics`) on metrics.html. Reads a static file only; stores and sends nothing.
import './style.css';
import './metrics.css';
import {scorePerformance,type PerformanceRun} from './metrics-score';
import {compare,gameplayMetrics,type Comparison,type GameplayResult,type Row,type Snapshot,type Value,type VoiceSummary} from './metrics-compare';

interface Metrics {
  generatedAt:string;version:string;
  code:{app:{lines:number;files:unknown[]};tests:{lines:number;files:unknown[]}};
  build:{ok:boolean;seconds:number;warnings:string[]};
  bundle:{assets:{name:string;kind:string;bytes:number;gzipBytes:number;pages:string[]}[]};
  tests:{ok:true;totals:{tests:number;passed:number;todo:number;skipped:number};baseline:{size:number;stillFailing:number;nowPassing:string[];newFailures:string[]}}|{ok:false;error:string};
  performance:{runs:PerformanceRun[]};
  comparisons?:Comparison[];snapshots?:Snapshot[];
  bench?:{ok:true;gameplay:GameplayResult[];latencySweep:NonNullable<Snapshot['latencySweep']>;voice:VoiceSummary;gestureLatencyMs:number;roundLimitSeconds:number}|{ok:false;error:string};
}

const app=document.querySelector<HTMLDivElement>('#metrics-app')!;
const esc=(value:unknown)=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]!);
const num=(value:number)=>value.toLocaleString('en',{maximumFractionDigits:1});
const kB=(bytes:number)=>`${num(Math.round(bytes/102.4)/10)} kB`;
const fmt=(value:number,unit:string)=>unit==='%'?`${num(value)}%`:unit.startsWith('/')?num(value):unit?`${num(value)} ${unit}`:num(value);
const pct=(value:number,max:number)=>max?Math.max(0,Math.min(100,value/max*100)):0;
const header=`<header><a class="brand" href="/">P<span>◇</span>Z <small>PROJECTZERO</small></a><span class="edition">PROJECT METRICS</span><a class="back-link" href="/">← Back to game</a></header>`;
const section=(id:string,eyebrow:string,title:string,body:string)=>`<section class="m-section reveal" id="${id}" aria-labelledby="${id}-title"><div class="eyebrow">${eyebrow}</div><h2 id="${id}-title">${title}</h2>${body}</section>`;
const verdictText:Record<Row['verdict'],string>={better:'▲ Better',worse:'▼ Worse',same:'No change',neutral:'Changed',new:'✦ New',pending:'Awaiting'};
const pill=(verdict:Row['verdict'])=>`<span class="verdict ${verdict}">${verdictText[verdict]}</span>`;

// ── Reusable marks ──────────────────────────────────────────────────────────
// Animated values start at zero and grow when their section scrolls into view (see animate()).

/** A number that counts up from zero. */
const count=(value:number,unit='',decimals=0,tag='span')=>`<${tag} data-count="${value}" data-dec="${decimals}" data-unit="${esc(unit)}">${fmt(value,unit)}</${tag}>`;

/** Ring gauge for a score. */
function ring(value:number,max:number,size=96,tone='after'){
  const r=size/2-7,c=2*Math.PI*r;
  return `<svg class="ring ${tone}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${value} out of ${max}">
   <circle class="ring-track" cx="${size/2}" cy="${size/2}" r="${r}"/>
   <circle class="ring-value" cx="${size/2}" cy="${size/2}" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-dash="${(c*(1-value/max)).toFixed(1)}" transform="rotate(-90 ${size/2} ${size/2})"/>
   <text x="50%" y="50%" dy=".35em" text-anchor="middle" class="ring-text">${count(value,'',0,'tspan')}</text></svg>`;
}

/** One horizontal bar that grows to its value; a dashed ghost when the value is missing. */
function bar(value:Value,max:number,side:'before'|'after',unit:string,tip:string){
  if(typeof value!=='number')return `<div class="hbar"><span class="track"><i class="ghost">${value==='n/a'?'not possible':'awaiting'}</i></span><span class="hval muted">–</span></div>`;
  return `<div class="hbar" data-tip="${esc(`${tip}: ${fmt(value,unit)}`)}" tabindex="0"><span class="track"><i class="fill ${side}" data-w="${pct(value,max).toFixed(1)}"></i></span><span class="hval">${fmt(value,unit)}</span></div>`;
}
const legend=(c:Comparison)=>`<p class="legend"><span><i class="sw before"></i>${esc(c.before.label)}</span><span><i class="sw after"></i>${esc(c.after.label)}</span></p>`;
const status=(rows:Row[])=>{const done=rows.filter(r=>r.verdict!=='pending').length;return done===rows.length?'<span class="tag done">Measured</span>':`<span class="tag wait">${done?`${done}/${rows.length} measured`:'Awaiting results'}</span>`;};
/** before → after with a verdict, for numbers that do not need a chart. */
const delta=(r:Row)=>`<div class="delta" data-tip="${esc(r.note??r.name)}" tabindex="0"><span class="delta-name">${esc(r.name)}</span><span class="delta-values">${typeof r.before==='number'?fmt(r.before,r.unit):r.before==='n/a'?'—':'?'} <b>→</b> ${typeof r.after==='number'?fmt(r.after,r.unit):'?'}</span>${pill(r.verdict)}</div>`;

// ── 0 · Headline strip ──────────────────────────────────────────────────────

function hero(m:Metrics,ctx:Ctx){
  const latest=m.performance.runs.at(-1),score=latest?scorePerformance(latest).total:null;
  const rounds=m.bench?.ok?m.bench.gameplay:[];const avg=rounds.length?Math.round(rounds.reduce((s,r)=>s+r.score,0)/rounds.length):null;
  const voice=m.bench?.ok?m.bench.voice:null;
  const firstLoad=m.bundle.assets.filter(a=>a.kind==='js'&&a.pages.includes('game')).reduce((s,a)=>s+a.gzipBytes,0);
  // Compare today's first load with the original 171 kB, not with an older "after" figure.
  const lazy=ctx.comparisons.find(c=>c.id==='lazy-three')?.metrics[0];
  const saved=typeof lazy?.before==='number'&&firstLoad?Math.round((1-firstLoad/1024/lazy.before)*100):null;
  const tile=(label:string,body:string,detail:string,tone='')=>`<div class="hero-tile ${tone}"><span class="hero-label">${label}</span><div class="hero-body">${body}</div><span class="hero-detail">${detail}</span></div>`;
  return `<div class="hero reveal">
   ${score!==null?tile('Performance',ring(score,100,84),`${Math.min(...latest!.scenarios.map(s=>s.fps))} fps · ${esc(latest!.label.replace(/\s*\(.*\)$/,''))}`):''}
   ${avg!==null?tile('Round score',`<strong>${count(avg)}</strong><small>/1000</small>`,`average of ${rounds.length} scripted rounds · ${rounds.filter(r=>r.outcome==='won').length} won`):''}
   ${voice?tile('Voice commands',`<strong>${count(voice.accuracy,'%',1)}</strong>`,`${voice.correct} of ${voice.phrases} phrases · local phrase parser (the ElevenLabs agent is not benchmarked here)`,voice.accuracy<50?'warn':''):''}
   ${m.tests.ok?tile('Tests',`<strong>${count(m.tests.totals.passed)}</strong>`,`passing · ${m.tests.baseline.newFailures.length} new failures`,m.tests.baseline.newFailures.length?'bad':''):''}
   ${tile('First load',`<strong>${count(Math.round(firstLoad/102.4)/10,'kB',1)}</strong>`,saved!==null?`compressed JS · ${saved}% smaller than before lazy-loading`:'compressed JS')}
  </div>`;
}

// ── 1 · Agent & model ───────────────────────────────────────────────────────

type Ctx={comparisons:Comparison[];snapshots:Snapshot[];runs:PerformanceRun[];bench:Metrics['bench']};
const snap=(ctx:Ctx,id?:string|null)=>id?ctx.snapshots.find(s=>s.id===id):undefined;
const rowsOf=(ctx:Ctx,c:Comparison)=>compare(c,ctx.snapshots,ctx.runs);

function voiceCard(ctx:Ctx,c:Comparison){
  const rows=rowsOf(ctx,c).filter(r=>r.source==='feature'||r.source==='agent');
  const before=snap(ctx,c.before.snapshot)?.voice,after=snap(ctx,c.after.snapshot)?.voice;
  const share=(v:VoiceSummary|undefined,kind:string):Value=>{const k=v?.byKind.find(k=>k.kind===kind);return k?Math.round(k.correct/k.phrases*100):null;};
  const groups=[['clear','Clear commands'],['misheard','Misheard commands'],['not a command','Chatter ignored']].map(([kind,label])=>
    `<div class="bar-row"><span class="bar-name">${label}</span><div class="bar-pair">${bar(share(before,kind),100,'before','%',`${label} · ${c.before.label}`)}${bar(share(after,kind),100,'after','%',`${label} · ${c.after.label}`)}</div></div>`).join('');
  const chips=rows.filter(r=>r.unit!=='%'||r.source==='feature').map(delta).join('');
  return `<article class="m-card"><div class="card-head"><h3>${esc(c.title)}</h3>${status(rows)}</div>${legend(c)}
   <figure class="chart"><figcaption>Phrases understood, by type</figcaption>${groups}</figure><div class="deltas">${chips}</div></article>`;
}

function winRateCard(ctx:Ctx,c:Comparison){
  const rows=rowsOf(ctx,c).filter(r=>r.source==='feature');
  const win=c.metrics.find(m=>/win rate/i.test(m.name));const value=typeof win?.after==='number'?win.after:null;
  const body=value===null?`<i class="ghost">awaiting the AutoScientist run</i>`:`<i class="fill after" data-w="${pct(value,100).toFixed(1)}" data-tip="Adapted model wins ${value}% of head-to-head comparisons" tabindex="0"></i>`;
  return `<article class="m-card"><div class="card-head"><h3>${esc(c.title)}</h3>${status(rows)}</div>${legend(c)}
   <figure class="chart"><figcaption>Adapted model's win rate against the base model</figcaption>
    <div class="winrate"><span class="track tall">${body}<b class="parity" style="left:50%" data-tip="50% = no better than the base model" tabindex="0"></b></span><span class="hval">${value===null?'–':fmt(value,'%')}</span></div>
    <div class="scale"><span>0%</span><span>50% · parity</span><span>100%</span></div></figure>
   <div class="deltas">${rows.filter(r=>r!==rows.find(x=>x.name===win?.name)).map(delta).join('')}</div></article>`;
}

/** Supervisor agent: what happened to its tool calls and tasks in the drones-only round. Before it existed, so before is "not possible". */
function supervisorCard(ctx:Ctx,c:Comparison){
  const rows=rowsOf(ctx,c).filter(r=>r.source==='agent');
  const after=snap(ctx,c.after.snapshot)?.supervisor;
  const before:Value=snap(ctx,c.before.snapshot)?(snap(ctx,c.before.snapshot)!.supervisor?null:'n/a'):null;
  const max=Math.max(1,after?.toolCalls??0,after?(after.tasksCompleted+after.tasksFailed):0);
  const line=(label:string,value:number|undefined,tip:string)=>`<div class="bar-row"><span class="bar-name">${label}</span><div class="bar-pair">${bar(before,max,'before','',`${label} · ${c.before.label}`)}${bar(value??null,max,'after','',`${label} · ${tip}`)}</div></div>`;
  return `<article class="m-card"><div class="card-head"><h3>${esc(c.title)}</h3>${status(rows)}</div>${legend(c)}
   <figure class="chart"><figcaption>Tool calls and tasks in one drones-only round${after?` · re-plans every ${after.decisionMs/1000} s`:''}</figcaption>
    ${line('Tool calls succeeded',after?.succeeded,`${after?.succeeded??0} of ${after?.toolCalls??0} calls`)}${line('Calls rejected',after?(after.invalid+after.stale):undefined,'invalid or stale')}${line('Tasks completed',after?.tasksCompleted,'drone tasks finished')}</figure>
   <div class="deltas">${rows.filter(r=>r.unit==='%'||/failed|stale/i.test(r.name)).map(delta).join('')}</div></article>`;
}

function agentSection(ctx:Ctx){
  const cards=ctx.comparisons.filter(c=>c.id!=='lazy-three').map(c=>c.agentBenchmark==='supervisor'?supervisorCard(ctx,c):c.agentBenchmark==='voice'?voiceCard(ctx,c):c.metrics.some(m=>/win rate/i.test(m.name))?winRateCard(ctx,c):c.metrics.length?`<article class="m-card"><div class="card-head"><h3>${esc(c.title)}</h3>${status(rowsOf(ctx,c))}</div><div class="deltas">${rowsOf(ctx,c).filter(r=>r.source==='feature').map(delta).join('')}</div></article>`:'').join('');
  return cards?section('agent','01 / AGENT & MODEL','How well they work',`<div class="grid-2">${cards}</div>`):'';
}

// ── 2 · Gameplay (interactive) ──────────────────────────────────────────────

function gameplaySection(ctx:Ctx){
  const withRounds=ctx.comparisons.filter(c=>snap(ctx,c.before.snapshot)?.gameplay);
  const current=ctx.bench?.ok?ctx.bench:null;
  if(!withRounds.length&&!current)return '';
  const metricButtons=gameplayMetrics.map((m,i)=>`<button type="button" class="seg${i?'':' on'}" data-metric="${m.key}" aria-pressed="${!i}">${m.name.replace(' the arena','')}</button>`).join('');
  const compareButtons=withRounds.map((c,i)=>`<button type="button" class="seg${i?'':' on'}" data-compare="${c.id}" aria-pressed="${!i}">${esc(c.title.replace(' for motion control',''))}</button>`).join('');
  const sweep=current?.latencySweep??snap(ctx,withRounds[0]?.before.snapshot)?.latencySweep;
  return section('gameplay','02 / GAMEPLAY','What changes in a round',`
   <article class="m-card" id="rounds"><div class="controls"><div class="segs" role="group" aria-label="Metric">${metricButtons}</div>${compareButtons?`<div class="segs" role="group" aria-label="Compare">${compareButtons}</div>`:''}</div>
    <div id="rounds-legend"></div><figure class="chart"><figcaption id="rounds-caption"></figcaption><div id="rounds-bars"></div></figure></article>
   ${sweep?`<article class="m-card" id="latency">${latencyExplorer(sweep,current?.gestureLatencyMs??500,voiceLatency(ctx))}</article>`:''}`);
}
const voiceLatency=(ctx:Ctx)=>{const m=ctx.comparisons.find(c=>c.agentBenchmark==='voice')?.metrics.find(m=>/time to issue/i.test(m.name));return typeof m?.after==='number'?m.after:null;};

/** Redraws the round bars for the chosen metric and comparison. Widths transition, so switching animates. */
function drawRounds(ctx:Ctx,metricKey:string,compareId:string){
  const metric=gameplayMetrics.find(m=>m.key===metricKey)??gameplayMetrics[0];
  const c=ctx.comparisons.find(c=>c.id===compareId);
  const before=c?snap(ctx,c.before.snapshot)?.gameplay:ctx.bench?.ok?ctx.bench.gameplay:undefined;
  const after=c?snap(ctx,c.after.snapshot)?.gameplay:undefined;
  const names=[...new Set([...(before??[]),...(after??[])].map(r=>r.scenario))];
  const get=(list:GameplayResult[]|undefined,name:string,hasSide:boolean):Value=>{if(!hasSide)return null;const r=list?.find(r=>r.scenario===name);return r?r[metric.key] as number:'n/a';};
  const values=names.flatMap(n=>[get(before,n,!!before),get(after,n,!!after)]).filter((v):v is number=>typeof v==='number');
  const max=metric.unit==='%'?100:metric.unit==='/1000'?1000:Math.max(1,...values)*1.1;
  const host=document.getElementById('rounds-bars');if(!host)return;
  const existing=new Map([...host.querySelectorAll<HTMLElement>('.bar-row')].map(row=>[row.dataset.name!,row]));
  host.innerHTML=names.map(n=>`<div class="bar-row" data-name="${esc(n)}"><span class="bar-name">${esc(n)}</span><div class="bar-pair">${bar(get(before,n,!!before),max,'before',metric.unit,`${n} · ${c?.before.label??'Now'}`)}${bar(get(after,n,!!after),max,'after',metric.unit,`${n} · ${c?.after.label??''}`)}</div></div>`).join('');
  // Start each bar at its previous width so the switch animates instead of jumping.
  host.querySelectorAll<HTMLElement>('.bar-row').forEach(row=>{const old=existing.get(row.dataset.name!);row.querySelectorAll<HTMLElement>('.fill').forEach((fill,i)=>{const prev=old?.querySelectorAll<HTMLElement>('.fill')[i]?.style.width;fill.style.width=prev||'0%';});});
  // Before the section has scrolled into view, leave the bars at zero for animate() to grow.
  if(reduceMotion||host.closest('.reveal')?.classList.contains('shown'))requestAnimationFrame(()=>requestAnimationFrame(()=>host.querySelectorAll<HTMLElement>('[data-w]').forEach(el=>el.style.width=el.dataset.w+'%')));
  document.getElementById('rounds-caption')!.textContent=`${metric.name} · ${metric.better==='higher'?'higher':'lower'} is better`;
  document.getElementById('rounds-legend')!.innerHTML=c?legend(c):'';
}

/** Line chart plus a slider: pick an order delay and read the time to clear with drones only. */
function latencyExplorer(sweep:NonNullable<Snapshot['latencySweep']>,gestureMs:number,voiceMs:number|null){
  const W=640,H=210,L=40,R=14,T=14,B=30,maxX=sweep.at(-1)!.latencyMs,maxY=Math.ceil(Math.max(...sweep.map(p=>p.seconds))/10)*10;
  const x=(ms:number)=>L+ms/maxX*(W-L-R),y=(s:number)=>T+(1-s/maxY)*(H-T-B);
  const pts=sweep.map(p=>`${x(p.latencyMs).toFixed(1)},${y(p.seconds).toFixed(1)}`).join(' ');
  const ref=(ms:number,label:string,cls:string,line:number)=>`<line class="ref ${cls}" x1="${x(ms)}" x2="${x(ms)}" y1="${T}" y2="${H-B}"/><text class="ref-label" x="${x(ms)+5}" y="${T+10+line*14}">${label}</text>`;
  return `<div class="card-head"><h3>Order delay explorer</h3><span class="tag">simulated · drones only</span></div>
   <div class="explorer"><div class="readout" aria-live="polite"><strong id="lat-seconds">–</strong><span id="lat-detail"></span></div>
    <label class="slider"><span>Delay from deciding an order to it reaching the drones: <b id="lat-ms">${gestureMs} ms</b></span>
     <input id="lat-input" type="range" min="0" max="${maxX}" step="25" value="${gestureMs}" data-sweep='${esc(JSON.stringify(sweep))}' data-gesture="${gestureMs}"></label></div>
   <svg class="sweep" viewBox="0 0 ${W} ${H}" role="img" aria-label="Time to clear rises from ${sweep[0].seconds} s with no delay to ${sweep.at(-1)!.seconds} s at ${maxX} ms">
    ${Array.from({length:maxY/10+1},(_,i)=>i*10).map(t=>`<line class="grid" x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L-6}" y="${y(t)+4}" text-anchor="end">${t}s</text>`).join('')}
    ${[0,500,1000,2000,3000].filter(t=>t<=maxX).map(t=>`<text class="tick" x="${x(t)}" y="${H-10}" text-anchor="middle">${t<1000?t+' ms':t/1000+' s'}</text>`).join('')}
    ${ref(gestureMs,'Gesture hold','gesture',0)}${voiceMs!==null?ref(voiceMs,'Voice agent','voice',1):''}
    <polyline class="line draw" points="${pts}" pathLength="1"/>
    ${sweep.map(p=>`<circle class="dot" cx="${x(p.latencyMs)}" cy="${y(p.seconds)}" r="4.5" data-tip="${p.latencyMs} ms → ${p.seconds} s to clear" tabindex="0"/>`).join('')}
    <line id="lat-cursor" class="cursor" x1="0" x2="0" y1="${T}" y2="${H-B}" data-x0="${L}" data-x1="${W-R}" data-max="${maxX}"/>
    <circle id="lat-point" class="cursor-dot" r="6" cx="0" cy="0" data-t="${T}" data-h="${H-T-B}" data-maxy="${maxY}"/>
   </svg>`;
}
function wireLatency(){
  const input=document.querySelector<HTMLInputElement>('#lat-input');if(!input)return;
  const sweep=JSON.parse(input.dataset.sweep!) as {latencyMs:number;seconds:number}[],gesture=Number(input.dataset.gesture);
  const at=(ms:number)=>{const i=sweep.findIndex(p=>p.latencyMs>=ms);if(i<=0)return sweep[0].seconds;const a=sweep[i-1],b=sweep[i];return a.seconds+(b.seconds-a.seconds)*(ms-a.latencyMs)/(b.latencyMs-a.latencyMs);};
  const cursor=document.getElementById('lat-cursor')!,point=document.getElementById('lat-point')!;
  const update=()=>{
    const ms=Number(input.value),s=at(ms),diff=s-at(gesture);
    document.getElementById('lat-ms')!.textContent=`${ms} ms`;
    document.getElementById('lat-seconds')!.textContent=`${s.toFixed(1)} s`;
    document.getElementById('lat-detail')!.textContent=Math.abs(diff)<.05?'to clear · same as the 500 ms gesture hold':`to clear · ${Math.abs(diff).toFixed(1)} s ${diff<0?'faster':'slower'} than the gesture hold`;
    const x0=Number(cursor.dataset.x0),x1=Number(cursor.dataset.x1),cx=x0+ms/Number(cursor.dataset.max)*(x1-x0);
    cursor.setAttribute('x1',String(cx));cursor.setAttribute('x2',String(cx));
    point.setAttribute('cx',String(cx));point.setAttribute('cy',String(Number(point.dataset.t)+(1-s/Number(point.dataset.maxy))*Number(point.dataset.h)));
  };
  input.addEventListener('input',update);update();
}

// ── 3 · Engineering: before → after dot charts ──────────────────────────────

function engineeringSection(ctx:Ctx){
  const measured=ctx.comparisons.map(c=>({c,rows:rowsOf(ctx,c).filter(r=>(r.source==='benchmark'||r.source==='snapshot'||(c.id==='lazy-three'&&r.source==='feature'))&&typeof r.before==='number'&&typeof r.after==='number')})).filter(x=>x.rows.length);
  const waiting=ctx.comparisons.filter(c=>!measured.some(x=>x.c===c)&&(c.after.snapshot===null||c.after.performanceRun===null));
  const dumbbell=(r:Row)=>{const b=r.before as number,a=r.after as number,max=Math.max(b,a)*1.15||1;
    return `<div class="db-row"><span class="db-name">${esc(r.name)}</span><span class="db-track"><i class="db-line" style="left:${pct(Math.min(a,b),max)}%;width:${Math.abs(pct(a,max)-pct(b,max))}%"></i><b class="db-dot before" style="left:${pct(b,max)}%" data-tip="Before: ${esc(fmt(b,r.unit))}" tabindex="0"></b><b class="db-dot after" style="left:${pct(b,max)}%" data-left="${pct(a,max)}" data-tip="After: ${esc(fmt(a,r.unit))}" tabindex="0"></b></span><span class="db-val">${fmt(b,r.unit)} → <b>${fmt(a,r.unit)}</b></span>${pill(r.verdict)}</div>`;};
  const cards=measured.map(({c,rows})=>`<article class="m-card"><div class="card-head"><h3>${esc(c.title)}</h3><span class="tag done">Measured</span></div>${legend(c)}${rows.map(dumbbell).join('')}</article>`).join('');
  const pending=waiting.length?`<p class="m-note">Awaiting “after” builds: ${waiting.map(c=>esc(c.title)).join(' · ')}</p>`:'';
  return cards||pending?section('engineering','03 / ENGINEERING','What each change costs',cards+pending):'';
}

// ── 4–6 · Performance, tests, build ─────────────────────────────────────────

function performanceSection(runs:PerformanceRun[]){
  const latest=runs.at(-1);if(!latest)return '';
  const s=scorePerformance(latest);
  const bars=s.categories.map(c=>`<div class="bar-row"><span class="bar-name">${c.label}</span><div class="hbar" data-tip="${esc(c.basis)}" tabindex="0"><span class="track"><i class="fill after" data-w="${pct(c.points,c.max).toFixed(1)}"></i></span><span class="hval">${c.points}/${c.max}</span></div></div>`).join('');
  return section('performance','04 / PERFORMANCE',`Score ${s.total} / 100`,`<article class="m-card perf"><div class="perf-ring">${ring(s.total,100,140)}<span class="m-note">${esc(latest.label)}</span></div><figure class="chart">${bars}</figure></article>`);
}

function testsSection(tests:Metrics['tests']){
  if(!tests.ok)return section('tests','05 / TESTS','Test results unavailable',`<p class="m-note">${esc(tests.error)}</p>`);
  const {totals,baseline}=tests,news=baseline.newFailures.length,todo=totals.todo+totals.skipped;
  const parts=[{label:'Passing',value:totals.passed,cls:'pass'},{label:'Inherited from ProjectZero',value:baseline.stillFailing,cls:'known'},{label:'New failures',value:news,cls:'bad'},{label:'Todo',value:todo,cls:'todo'}];
  const total=parts.reduce((s,p)=>s+p.value,0),r=54,c=2*Math.PI*r;let offset=0;
  const arcs=parts.filter(p=>p.value).map(p=>{const len=p.value/total*c,arc=`<circle class="arc ${p.cls}" cx="70" cy="70" r="${r}" stroke-dasharray="0 ${c.toFixed(1)}" data-arc="${Math.max(0,len-2).toFixed(1)} ${(c-len+2).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 70 70)" data-tip="${p.label}: ${p.value}" tabindex="0"/>`;offset+=len;return arc;}).join('');
  return section('tests','05 / TESTS',`${num(totals.passed)} passing · ${news} new failures`,`<article class="m-card donut-card">
   <svg class="donut" width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="${totals.passed} of ${total} tests passing">${arcs}<text x="70" y="66" text-anchor="middle" class="donut-big">${count(Math.round(totals.passed/total*100),'%',0,'tspan')}</text><text x="70" y="86" text-anchor="middle" class="donut-small">passing</text></svg>
   <ul class="donut-legend">${parts.map(p=>`<li><i class="sw ${p.cls}"></i>${p.label}<b>${p.value}</b></li>`).join('')}</ul>
   <p class="m-note">The ${baseline.size} inherited failures came with ProjectZero v0.4.3 and are tracked by name, so anything new is counted separately.</p></article>`);
}

function buildSection(m:Metrics){
  const game=m.bundle.assets.filter(a=>a.pages.includes('game')||a.pages.length===0);
  const first=game.filter(a=>a.pages.includes('game')).reduce((s,a)=>s+a.gzipBytes,0),later=game.filter(a=>!a.pages.length).reduce((s,a)=>s+a.gzipBytes,0),total=first+later||1;
  const ratio=m.code.app.lines?(m.code.tests.lines/m.code.app.lines).toFixed(2):'–';
  return section('build','06 / BUILD & CODE',`Build ${m.build.ok?'passing':'failing'} in ${m.build.seconds}s`,`<article class="m-card">
   <figure class="chart"><figcaption>What the game downloads (compressed)</figcaption>
    <div class="stack"><i class="seg-first" data-w="${pct(first,total).toFixed(1)}" data-tip="At page start: ${kB(first)}" tabindex="0"></i><i class="seg-later" data-w="${pct(later,total).toFixed(1)}" data-tip="In the background (3D engine): ${kB(later)}" tabindex="0"></i></div>
    <p class="legend"><span><i class="sw after"></i>At page start · ${kB(first)}</span><span><i class="sw later"></i>In the background · ${kB(later)}</span></p></figure>
   <div class="m-stats"><div><strong>${count(m.code.app.lines)}</strong><span>lines of game code</span></div><div><strong>${count(m.code.tests.lines)}</strong><span>lines of tests</span></div><div><strong>${ratio}</strong><span>test lines per code line</span></div></div></article>`);
}

// ── Page assembly and motion ────────────────────────────────────────────────

const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el:HTMLElement){
  const target=Number(el.dataset.count),dec=Number(el.dataset.dec),unit=el.dataset.unit??'';
  if(reduceMotion){el.textContent=fmt(target,unit);return;}
  const start=performance.now(),step=(now:number)=>{const t=Math.min(1,(now-start)/900),v=target*(1-(1-t)**3);el.textContent=fmt(Number(v.toFixed(dec)),unit);if(t<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}
function animate(root:Element){
  root.querySelectorAll<HTMLElement>('[data-w]').forEach(el=>el.style.width=el.dataset.w+'%');
  root.querySelectorAll<SVGElement>('[data-dash]').forEach(el=>el.setAttribute('stroke-dashoffset',el.dataset.dash!));
  root.querySelectorAll<SVGElement>('[data-arc]').forEach(el=>el.setAttribute('stroke-dasharray',el.dataset.arc!));
  root.querySelectorAll<HTMLElement>('[data-left]').forEach(el=>el.style.left=el.dataset.left+'%');
  root.querySelectorAll('.draw').forEach(el=>el.classList.add('drawn'));
  root.querySelectorAll<HTMLElement>('[data-count]').forEach(countUp);
}

function wireTooltip(){
  const tip=document.createElement('div');tip.className='m-tip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
  const show=(target:Element,x?:number,y?:number)=>{tip.textContent=target.getAttribute('data-tip');tip.hidden=false;const r=target.getBoundingClientRect(),px=x??r.left+r.width/2,py=y??r.top;
    tip.style.left=`${Math.min(innerWidth-tip.offsetWidth-8,Math.max(8,px-tip.offsetWidth/2))}px`;tip.style.top=`${Math.max(8,py-tip.offsetHeight-12)}px`;};
  document.addEventListener('pointermove',e=>{const t=(e.target as Element).closest?.('[data-tip]');if(t)show(t,e.clientX,e.clientY);else tip.hidden=true;});
  document.addEventListener('focusin',e=>{const t=(e.target as Element).closest('[data-tip]');if(t)show(t);});
  document.addEventListener('focusout',()=>{tip.hidden=true;});
  addEventListener('scroll',()=>{tip.hidden=true;},{passive:true});
}

function wireRounds(ctx:Ctx){
  const card=document.getElementById('rounds');if(!card)return;
  let metric:string=gameplayMetrics[0].key,compareId=card.querySelector<HTMLElement>('[data-compare]')?.dataset.compare??'';
  const press=(attr:string,value:string)=>card.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach(b=>{const on=b.dataset[attr]===value;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
  card.addEventListener('click',e=>{const b=(e.target as Element).closest<HTMLButtonElement>('button');if(!b)return;
    if(b.dataset.metric){metric=b.dataset.metric;press('metric',metric);}else if(b.dataset.compare){compareId=b.dataset.compare;press('compare',compareId);}else return;
    drawRounds(ctx,metric,compareId);});
  drawRounds(ctx,metric,compareId);
}

function render(m:Metrics){
  const ctx:Ctx={comparisons:m.comparisons??[],snapshots:m.snapshots??[],runs:m.performance.runs,bench:m.bench};
  const nav=[['agent','Agent & model'],['gameplay','Gameplay'],['engineering','Engineering'],['performance','Performance'],['tests','Tests'],['build','Build']].map(([id,label])=>`<a href="#${id}">${label}</a>`).join('');
  app.innerHTML=`${header}<main class="metrics"><div class="m-intro"><div class="eyebrow">PROJECTZERO v${esc(m.version)} · ${esc(new Date(m.generatedAt).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}))}</div><h1>Project metrics</h1><nav class="m-nav" aria-label="Sections">${nav}</nav></div>
   ${hero(m,ctx)}${agentSection(ctx)}${gameplaySection(ctx)}${engineeringSection(ctx)}${performanceSection(m.performance.runs)}${testsSection(m.tests)}${buildSection(m)}</main>`;
  wireTooltip();wireRounds(ctx);wireLatency();
  // Sections are drawn after metrics.json loads, so honour a #section link now that the anchor exists.
  if(location.hash)document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  if(reduceMotion||!('IntersectionObserver' in window)){document.querySelectorAll('.reveal').forEach(animate);return;}
  const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('shown');animate(e.target);io.unobserve(e.target);}}),{threshold:.12});
  document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
}

function renderMissing(reason:string){
  app.innerHTML=`${header}<main class="metrics"><div class="m-intro"><div class="eyebrow">PROJECT METRICS</div><h1>No metrics collected yet</h1><p class="m-note">${esc(reason)} From the project folder, run <code>npm run metrics</code>, then reload this page.</p></div></main>`;
}

fetch('./metrics.json',{cache:'no-store'})
  .then(response=>response.ok?response.json() as Promise<Metrics>:Promise.reject(new Error(`metrics.json was not found (HTTP ${response.status}).`)))
  .then(render,(error:Error)=>renderMissing(error.message));
