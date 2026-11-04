import path from 'node:path';
import { createRequire } from 'node:module';
import type { FaceBox } from '../../core/timeline';

const require = createRequire(import.meta.url);
let ready: Promise<any> | null = null;

/** face-api tiny face detector on the tfjs WASM backend: no native build, weights ship in the npm package. */
async function init() {
  const faceapi: any = await import('@vladmandic/face-api/dist/face-api.node-wasm.js');
  const wasm = await import('@tensorflow/tfjs-backend-wasm');
  const wasmDir = path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')) + '/dist/';
  wasm.setWasmPaths(wasmDir);
  await faceapi.tf.setBackend('wasm');
  await faceapi.tf.ready();
  const modelDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
  await faceapi.nets.tinyFaceDetector.loadFromDisk(modelDir);
  return faceapi;
}

export async function detectFaces(frames: Buffer[], w: number, h: number, fps: number): Promise<{ t: number; boxes: FaceBox[] }[]> {
  ready ??= init();
  const faceapi = await ready;
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });
  const out: { t: number; boxes: FaceBox[] }[] = [];
  for (let i = 0; i < frames.length; i++) {
    const tensor = faceapi.tf.tensor3d(new Uint8Array(frames[i]), [h, w, 3], 'int32');
    try {
      const dets = await faceapi.detectAllFaces(tensor, opts);
      out.push({
        t: Math.round((i / fps) * 100) / 100,
        boxes: dets.map((d: any) => ({
          x: +(d.box.x / w).toFixed(4), y: +(d.box.y / h).toFixed(4), w: +(d.box.width / w).toFixed(4), h: +(d.box.height / h).toFixed(4), score: +d.score.toFixed(3),
        })),
      });
    } finally {
      tensor.dispose();
    }
  }
  return out;
}
