import pins from '../webcam-asset-pins.json';

const assets = [...pins.runtime.files, pins.model];
export async function checkWebcamAssets(fetchAsset: typeof fetch = fetch): Promise<string | null> {
  try {
    const signal = AbortSignal.timeout(5000);
    const responses = await Promise.all(assets.map(({file}) =>
      fetchAsset('/vendor/' + file, {method:'HEAD', cache:'no-store', redirect:'error', signal})));
    const recognizable = responses.map(response => response.ok &&
      !/^text\/html\b/i.test(response.headers.get('content-type') ?? ''));
    if (!recognizable.some(Boolean)) {
      return 'Webcam setup missing · see the README or choose Synthetic rehearsal.';
    }
    if (responses.some((response,i) => !recognizable[i] ||
        response.headers.get('content-length') !== String(assets[i].bytes))) {
      return 'Webcam setup incomplete or mismatched · check the local setup in the README or choose Synthetic rehearsal.';
    }
    return null;
  } catch {
    return 'Webcam assets could not be checked · restart the local preview or choose Synthetic rehearsal.';
  }
}
