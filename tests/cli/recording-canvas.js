// tests/cli/recording-canvas.js
// The recording canvas stub shared by the plot tests. It lives outside any
// *.test.js file so importing it never registers another file's tests.

// Fake createCanvas: records method calls and property assignments on the 2d
// context. Methods that must return values get minimal stubs.
export function makeRecordingCanvasFactory(log) {
  return function createCanvas(w, h) {
    log.push(['createCanvas', w, h]);
    const ctx = new Proxy({}, {
      get(_, prop) {
        if (prop === 'measureText') return (s) => { log.push(['measureText', s]); return { width: String(s).length * 6 }; };
        if (prop === 'createLinearGradient') return (...a) => { log.push(['createLinearGradient', ...a]); return { addColorStop: (o, c) => log.push(['addColorStop', o, c]) }; };
        return (...args) => { log.push([prop, ...args.map(a => (typeof a === 'number' ? Math.round(a * 100) / 100 : a))]); };
      },
      set(_, prop, value) { log.push(['set:' + String(prop), value]); return true; },
    });
    return { width: w, height: h, getContext: () => ctx };
  };
}
