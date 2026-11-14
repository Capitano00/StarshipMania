import {expect,it,vi} from 'vitest';
import {checkWebcamAssets} from '../src/webcam-assets';
import pins from '../webcam-asset-pins.json';

const assets=[...pins.runtime.files,pins.model];
const responseFor=(url:RequestInfo|URL)=> {
  const pin=assets.find(({file})=>url==='/vendor/'+file);
  return new Response(null,{status:pin?200:404,headers:pin?{'content-type':'application/octet-stream','content-length':String(pin.bytes)}:{}});
};

it('does not mistake the preview HTML fallback for installed webcam assets',async()=>{
  const fetchAsset=vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{headers:{'content-type':'text/html','content-length':'655'}}));
  expect(await checkWebcamAssets(fetchAsset)).toMatch(/setup missing/);
  expect(fetchAsset).toHaveBeenCalledTimes(6);
  expect(fetchAsset).toHaveBeenCalledWith('/vendor/gesture_recognizer.task',expect.objectContaining({method:'HEAD',redirect:'error'}));
});

it('classifies a missing or wrong-sized file as incomplete when other files exist',async()=>{
  const partial=vi.fn<typeof fetch>(async url=>url==='/vendor/gesture_recognizer.task'?new Response(null,{status:404}):responseFor(url));
  expect(await checkWebcamAssets(partial)).toMatch(/setup incomplete/);
  const notPinned=vi.fn<typeof fetch>(async url=>url==='/vendor/gesture_recognizer.task'?new Response(null,{headers:{'content-length':'1'}}):responseFor(url));
  expect(await checkWebcamAssets(notPinned)).toMatch(/mismatched/);
});

it('passes with all six same-origin files and their expected sizes',async()=>{
  expect(await checkWebcamAssets(vi.fn<typeof fetch>(async url=>responseFor(url)))).toBeNull();
});

it('gives recoverable feedback for a failed local fetch',async()=>{
  expect(await checkWebcamAssets(vi.fn<typeof fetch>().mockRejectedValue(new Error('network')))).toMatch(/could not be checked/);
});
