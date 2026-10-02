// demo/analyze/main.js — page entry: one worker from a blob URL (so it
// inherits this page's policy), then the page state machine over it.
import workerSrc from 'virtual:worker-src';
import { createPage } from './page.js';

// One worker alive at a time: making a new one (the page replaces a worker
// that failed) revokes the previous one's blob URL.
var workerBlob = new Blob([workerSrc], { type: 'text/javascript' });
var workerUrl = null;
export function createAnalyzeWorker() {
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  workerUrl = URL.createObjectURL(workerBlob);
  return new Worker(workerUrl);
}

if (typeof document !== 'undefined') {
  // createPage owns the worker's events, and replaces it through the factory if it fails.
  window.__chAnalyze = createPage(document.body, createAnalyzeWorker(), { createWorker: createAnalyzeWorker });   // exposed for the end-to-end tests
}
