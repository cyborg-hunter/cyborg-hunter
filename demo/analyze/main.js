// demo/analyze/main.js — page entry: one worker from a blob URL (so it
// inherits this page's policy), then the page state machine over it, and the
// files the demo's last step left for it (analyze/#from-demo).
import workerSrc from 'virtual:worker-src';
import { createPage } from './page.js';
import { takeHandoff, handoffEntries } from '../handoff.js';

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
  // createPage owns the worker's events, and replaces it through the factory
  // if it fails. From file: the page reads dropped files itself (page.js).
  window.__chAnalyze = createPage(document.body, createAnalyzeWorker(),
    { createWorker: createAnalyzeWorker, transferBytes: location.protocol === 'file:' });   // exposed for the end-to-end tests
  // Opened by the demo's "Open in the analyzer web app": its files wait in this
  // browser's IndexedDB (../handoff.js) and join the list as a drop would.
  // The hash goes first, so a reload starts with an empty list. Nothing
  // stored, or a record older than the hand-off's ten minutes: the files
  // step says nothing was handed off. A failure leaves the page as if opened
  // directly.
  if (location.hash === '#from-demo') {
    history.replaceState(null, '', location.pathname + location.search);
    takeHandoff().then(function (record) {
      var entries = handoffEntries(record, Date.now());
      if (!entries.length) { window.__chAnalyze.handoffEmpty(); return; }
      return window.__chAnalyze.addFiles(entries);
    }).catch(function (e) {
      if (e && e.handled) return;   // recover() (page.js) has shown it on the page already
      console.warn('cyborg-hunter analyze: the files from the demo could not be read', e);
    });
  }
}
