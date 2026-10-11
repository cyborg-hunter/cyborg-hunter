// demo/handoff.js
// The demo's hand-off to the analyze page. The tour's last step stores the
// visitor's files in this browser's IndexedDB and opens analyze/#from-demo,
// which takes them out again and lists them as if they had been dropped.
// Same origin, same browser: nothing is uploaded, and the record is deleted
// as it is read. IndexedDB rather than sessionStorage or localStorage: those
// hold strings within a quota of about 5 MB, which a long dom-tier recording
// can exceed, while IndexedDB stores the files as Blobs. Imported by the tour
// (demo.js) and by the analyze page's entry (analyze/main.js, bundled).

var DB_NAME = 'cyborg-hunter-handoff';
var STORE = 'files';
var KEY = 'demo';

// The tour opens the analyzer as soon as the write is committed, so a record
// is read within seconds of being made. One older than this was left by a
// hand-off whose page never opened (a closed tab, a navigation the browser
// refused): its files are not the ones the visitor has just asked for.
export var HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

function openDb() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available in this browser')); return; }
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

// One readwrite transaction on the store: `work(store)` queues the requests,
// and the promise settles when the transaction does, with what `work`
// returns a getter for.
function inTransaction(work) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      var result = work(tx.objectStore(STORE));
      tx.oncomplete = function () { db.close(); resolve(result()); };
      tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || new Error('the hand-off store refused the transaction')); };
    });
  });
}

// Stores `files` ([{ path, blob }]) for the analyze page. Resolves once the
// write is committed: the caller navigates only then.
export function writeHandoff(files) {
  return inTransaction(function (store) {
    store.put({ files: files, createdAt: Date.now() }, KEY);
    return function () { return undefined; };
  });
}

// The stored record (null when there is none), read and deleted in the same
// transaction, so it is handed over once.
export function takeHandoff() {
  return inTransaction(function (store) {
    var record = null;
    var get = store.get(KEY);
    get.onsuccess = function () { record = get.result || null; store.delete(KEY); };
    return function () { return record; };
  });
}

// Deletes the stored record, if there is one. The tour calls this when it
// loads and when its own hand-off fails: a record whose analyzer page never
// opened must not be handed to a later visit.
export function clearHandoff() {
  return inTransaction(function (store) {
    store.delete(KEY);
    return function () { return undefined; };
  });
}

// The page's file entries ({ path, file, handoff: true }) for a record: none
// when there is no record or it is older than HANDOFF_MAX_AGE_MS at `now`.
// Every File gets the record's time as its modification time. `handoff`
// marks them as the tour's: the page does not count the fonts among them as
// experiment files the analyst has to put beside an exported config
// (analyze/page.js).
export function handoffEntries(record, now) {
  if (!record || !Array.isArray(record.files)) return [];
  if (!(now - record.createdAt <= HANDOFF_MAX_AGE_MS)) return [];
  return record.files.map(function (f) {
    var name = f.path.slice(f.path.lastIndexOf('/') + 1);
    return { path: f.path, file: new File([f.blob], name, { lastModified: record.createdAt }), handoff: true };
  });
}
