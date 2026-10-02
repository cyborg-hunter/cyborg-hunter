// demo/analyze/main.js — page entry (filled in with the page UI).
import workerSrc from 'virtual:worker-src';
export function createAnalyzeWorker() {
  return new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
}
