// demo/analyze/main.js — page entry: one worker from a blob URL (so it
// inherits this page's policy), then the page state machine over it.
import workerSrc from 'virtual:worker-src';
import { createPage } from './page.js';

export function createAnalyzeWorker() {
  return new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
}

if (typeof document !== 'undefined') {
  var worker = createAnalyzeWorker();
  worker.onerror = function (e) { var el = document.querySelector('[data-role="error"]'); el.textContent = 'Worker failed: ' + (e.message || 'unknown error'); el.hidden = false; };
  window.__chAnalyze = createPage(document.body, worker, {});   // exposed for the end-to-end tests
}
