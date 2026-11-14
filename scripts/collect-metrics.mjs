#!/usr/bin/env node
// Builds the app, runs the test suite and writes metrics.json for the audience-facing metrics page (metrics.html).
// Output goes to public/metrics.json (served by `npm run dev`) and dist/metrics.json (served by `npm run preview`).
// Both are generated files and are git-ignored.
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync,copyFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {join,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const at=(...parts)=>join(root,...parts);
const posix=path=>path.split(sep).join('/');
const run=(command,args)=>{const started=performance.now();const result=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});return {ok:result.status===0,output:(result.stdout??'')+(result.stderr??''),seconds:+((performance.now()-started)/1000).toFixed(1)};};
const listFiles=(dir,filter)=>existsSync(at(dir))?readdirSync(at(dir),{recursive:true}).map(String).map(name=>posix(join(dir,name))).filter(path=>statSync(at(path)).isFile()&&filter(path)).sort():[];

// ── Code size ────────────────────────────────────────────────────────────────
const describeFile=path=>{const text=readFileSync(at(path),'utf8');const lines=text.split('\n');if(lines.at(-1)==='')lines.pop();return {path,lines:lines.length,nonBlank:lines.filter(line=>line.trim()).length,bytes:Buffer.byteLength(text)};};
const groups={
  app:listFiles('src',path=>/\.(ts|css)$/.test(path)),
  tests:listFiles('tests',path=>path.endsWith('.ts')),
  tooling:[...listFiles('scripts',path=>/\.m?js$/.test(path)),...listFiles('public',path=>path.endsWith('.js')&&!path.startsWith('public/vendor/'))],
};
const code=Object.fromEntries(Object.entries(groups).map(([name,paths])=>{const files=paths.map(describeFile).sort((a,b)=>b.lines-a.lines);return [name,{files,lines:files.reduce((sum,file)=>sum+file.lines,0)}];}));
const appSource=groups.app.filter(path=>path.endsWith('.ts')).map(path=>readFileSync(at(path),'utf8')).join('\n');
code.markers={todo:(appSource.match(/\b(TODO|FIXME|HACK|XXX)\b/g)??[]).length,anyTypes:(appSource.match(/:\s*any\b|\bas any\b/g)??[]).length};

// ── Build ────────────────────────────────────────────────────────────────────
const buildRun=run('npm',['run','build']);
const build={ok:buildRun.ok,seconds:buildRun.seconds,warnings:buildRun.output.split('\n').filter(line=>line.startsWith('(!)')).map(line=>line.replace(/^\(!\)\s*/,'').replace(/\s*Consider:$/,''))};
const pageAssets=page=>existsSync(at('dist',page))?[...readFileSync(at('dist',page),'utf8').matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map(match=>match[1]):[];
const pages={game:pageAssets('index.html'),metrics:pageAssets('metrics.html')};
const bundle={
  assets:listFiles('dist/assets',()=>true).map(path=>{const bytes=readFileSync(at(path));const name=posix(relative(at('dist'),at(path)));return {name,kind:name.endsWith('.css')?'css':'js',bytes:bytes.length,gzipBytes:gzipSync(bytes).length,pages:Object.entries(pages).filter(([,assets])=>assets.includes(name)).map(([page])=>page)};}).sort((a,b)=>b.bytes-a.bytes),
  webcamAssetsBytes:listFiles('dist/vendor',()=>true).reduce((sum,path)=>sum+statSync(at(path)).size,0),
};

// ── Tests ────────────────────────────────────────────────────────────────────
mkdirSync(at('.cache'),{recursive:true});
const reportPath=at('.cache','metrics-vitest.json');
const testRun=run(at('node_modules','.bin','vitest'),['run','--reporter=json',`--outputFile=${reportPath}`]);
const baseline=JSON.parse(readFileSync(at('metrics','baseline-failures.json'),'utf8'));
let tests={ok:false,seconds:testRun.seconds,error:'The test reporter wrote no results.'};
if(existsSync(reportPath)){
  const report=JSON.parse(readFileSync(reportPath,'utf8'));
  const files=report.testResults.map(file=>{const path=posix(relative(root,file.name));const count=status=>file.assertionResults.filter(test=>test.status===status).length;return {path,passed:count('passed'),failed:count('failed'),todo:count('todo'),skipped:count('skipped')+count('pending'),seconds:+(((file.endTime??0)-(file.startTime??0))/1000).toFixed(2),failures:file.assertionResults.filter(test=>test.status==='failed').map(test=>`${path} > ${test.fullName}`)};}).sort((a,b)=>a.path.localeCompare(b.path));
  const failing=new Set(files.flatMap(file=>file.failures));const known=new Set(baseline.failures);
  tests={ok:true,seconds:testRun.seconds,
    totals:{files:files.length,tests:files.reduce((sum,file)=>sum+file.passed+file.failed+file.todo+file.skipped,0),passed:files.reduce((sum,file)=>sum+file.passed,0),failed:failing.size,todo:files.reduce((sum,file)=>sum+file.todo,0),skipped:files.reduce((sum,file)=>sum+file.skipped,0)},
    baseline:{source:baseline.source,size:known.size,stillFailing:[...failing].filter(name=>known.has(name)).length,nowPassing:[...known].filter(name=>!failing.has(name)),newFailures:[...failing].filter(name=>!known.has(name))},
    files:files.map(({failures,...file})=>({...file,newFailures:failures.filter(name=>!known.has(name)).length}))};
}

// ── Gameplay and agent benchmarks ────────────────────────────────────────────
// Bundles src/bench (TypeScript) with esbuild, then plays the scripted rounds and the voice phrase list in Node.
const benchFile=at('.cache','bench.mjs');
const bundleRun=run(at('node_modules','.bin','esbuild'),['src/bench/index.ts','--bundle','--platform=node','--format=esm',`--outfile=${benchFile}`,'--log-level=error']);
let bench={ok:false,error:bundleRun.output.trim().split('\n').slice(0,5).join(' ')||'The benchmark bundle failed.'};
if(bundleRun.ok){
  try{
    const module=await import(`${pathToFileURL(benchFile).href}?t=${Date.now()}`);
    const started=performance.now();
    bench={ok:true,gameplay:module.runGameplayBenchmark(),supervisor:module.runSupervisorBenchmark(),latencySweep:module.latencySweep(),voice:module.evaluateVoice(),
      gestureLatencyMs:module.GESTURE_LATENCY_MS,roundLimitSeconds:module.ROUND_LIMIT_SECONDS,seconds:+((performance.now()-started)/1000).toFixed(2)};
  }catch(error){bench={ok:false,error:String(error?.message??error)};}
}

// ── Snapshot (optional) ──────────────────────────────────────────────────────
// `npm run metrics -- --snapshot <id> --label "<text>"` also saves this version's numbers to metrics/snapshots/<id>.json,
// so a later version can be compared against it in metrics/comparisons.json.
const version=JSON.parse(readFileSync(at('package.json'),'utf8')).version;
const flag=name=>{const index=process.argv.indexOf(`--${name}`);return index>0?process.argv[index+1]:undefined;};
const snapshotId=flag('snapshot');
if(snapshotId!==undefined){
  if(!/^[a-z0-9][a-z0-9-]{0,60}$/.test(snapshotId))throw new Error('--snapshot needs an id of lowercase letters, digits and dashes, such as after-voice-agent');
  if(!tests.ok)throw new Error('Not saving a snapshot: the test results are missing.');
  const gzip=filter=>bundle.assets.filter(a=>a.kind==='js'&&filter(a)).reduce((sum,a)=>sum+a.gzipBytes,0);
  const snapshot={id:snapshotId,label:flag('label')??snapshotId,capturedAt:new Date().toISOString(),version,
    build:{ok:build.ok,seconds:build.seconds},
    bundle:{firstLoadGzipBytes:gzip(a=>a.pages.includes('game')),laterGzipBytes:gzip(a=>a.pages.length===0)},
    tests:{passed:tests.totals.passed,failed:tests.totals.failed,newFailures:tests.baseline.newFailures.length,todo:tests.totals.todo},
    code:{appLines:code.app.lines,testLines:code.tests.lines},
    ...(bench.ok?{gameplay:bench.gameplay.map(({scenario,commandLatencyMs,outcome,seconds,targetsCleared,healthLeft,accuracy,score,ordersAccepted})=>({scenario,commandLatencyMs,outcome,seconds,targetsCleared,healthLeft,accuracy,score,ordersAccepted})),
      latencySweep:bench.latencySweep,supervisor:bench.supervisor,voice:(({byKind,phrases,accuracy,correct,wrongOrders,missed,falseTriggers})=>({phrases,accuracy,correct,wrongOrders,missed,falseTriggers,byKind}))(bench.voice)}:{})};
  mkdirSync(at('metrics','snapshots'),{recursive:true});
  writeFileSync(at('metrics','snapshots',`${snapshotId}.json`),JSON.stringify(snapshot,null,1)+'\n');
  console.log(`Snapshot saved to metrics/snapshots/${snapshotId}.json`);
}
const snapshots=listFiles('metrics/snapshots',path=>path.endsWith('.json')).map(path=>JSON.parse(readFileSync(at(path),'utf8')));

// ── Write ────────────────────────────────────────────────────────────────────
// metrics.json is served to whoever opens the metrics page, so it holds no git history, author names or local file status.
const performanceRuns=JSON.parse(readFileSync(at('metrics','performance.json'),'utf8'));
const comparisons=JSON.parse(readFileSync(at('metrics','comparisons.json'),'utf8')).comparisons;
const metrics={generatedAt:new Date().toISOString(),version,node:process.version,code,build,bundle,tests,bench,performance:performanceRuns,comparisons,snapshots};
const json=JSON.stringify(metrics,null,1)+'\n';
writeFileSync(at('public','metrics.json'),json);
if(existsSync(at('dist')))copyFileSync(at('public','metrics.json'),at('dist','metrics.json'));
const summary=(tests.ok?`${tests.totals.passed} passed, ${tests.baseline.stillFailing} known failures, ${tests.baseline.newFailures.length} new failures`:tests.error)+
  ` · benchmarks ${bench.ok?`${bench.gameplay.length} rounds, voice ${bench.voice.accuracy}%`:'FAILED: '+bench.error}`;
console.log(`metrics.json written · build ${build.ok?'ok':'FAILED'} in ${build.seconds}s · ${summary}`);
if(!build.ok)console.error(buildRun.output.split('\n').slice(-30).join('\n'));
process.exitCode=build.ok&&tests.ok?0:1;
