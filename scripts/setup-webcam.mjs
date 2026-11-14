import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, rmdir, unlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const pins=JSON.parse(await readFile(join(root,'webcam-asset-pins.json'),'utf8'));
const [flag, modelPath, confirmation, ...extra]=process.argv.slice(2);
const check=(bytes,pin)=>bytes.length===pin.bytes && createHash('sha256').update(bytes).digest('hex')===pin.sha256;
async function setup(){
  if(flag!=='--model'||!modelPath||confirmation!=='--confirm-independent-rights'||extra.length)
    throw new Error('Usage: npm run setup:webcam -- --model <local path> --confirm-independent-rights. Proceed only if you independently have rights to use that model; this command does not grant rights or download it.');
  const modelFile=resolve(modelPath);
  const modelStat=await lstat(modelFile).catch(()=>null);
  if(!modelStat?.isFile()||modelStat.size!==pins.model.bytes)
    throw new Error('Local gesture model missing or wrong size. Use the exact independently authorized model described in the README.');
  const model=await readFile(modelFile);
  if(!check(model,pins.model))throw new Error('Local gesture model hash does not match the pin. Nothing was staged.');
  const runtime=join(root,'node_modules',pins.runtime.package);
  const installed=JSON.parse(await readFile(join(runtime,'package.json'),'utf8').catch(()=>{throw new Error('Install the locked dependencies with npm ci --ignore-scripts first.');}));
  if(installed.name!==pins.runtime.package||installed.version!==pins.runtime.version)
    throw new Error('Installed MediaPipe version does not match the lockfile pin.');
  const ready=[];
  for(const pin of pins.runtime.files){
    const bytes=await readFile(join(runtime,pin.file));
    if(!check(bytes,pin))throw new Error('Installed runtime file failed integrity: '+pin.file);
    ready.push([pin.file,bytes]);
  }
  ready.push([pins.model.file,model]);
  const dest=join(root,'public','vendor');
  if(!(await lstat(join(root,'public'))).isDirectory())throw new Error('Expected a local public directory.');
  await mkdir(dest).catch(error=>{if(error.code==='EEXIST')throw new Error('public/vendor already exists. It was left unchanged; use a clean local copy to restage.');throw error;});
  const written=[];
  let madeWasm=false;
  try{
    await mkdir(join(dest,'wasm'));madeWasm=true;
    for(const [file,bytes] of ready){
      const target=join(dest,file);
      await writeFile(target,bytes,{flag:'wx'});written.push(target);
    }
  }catch(error){
    for(const file of written)await unlink(file).catch(()=>{});
    if(madeWasm)await rmdir(join(dest,'wasm')).catch(()=>{});
    await rmdir(dest).catch(()=>{});
    throw error;
  }
  console.log('Verified and staged six local webcam assets in ignored public/vendor. Rebuild before using preview. Keep these files and the resulting dist private.');
}
await setup().catch(error=>{console.error(error.message);process.exitCode=1;});
