// tests/cli/recording-canvas.js
// The recording canvas stub shared by the plot tests. It lives outside any
// *.test.js file so importing it never registers another file's tests.

// Fake createCanvas: records method calls and property assignments on the 2d
// context. Methods that must return values get minimal stubs. measureText
// gives `measure(text)` px, 6 px a character unless a test passes its own.
export function makeRecordingCanvasFactory(log, measure = (s) => String(s).length * 6) {
  return function createCanvas(w, h) {
    log.push(['createCanvas', w, h]);
    const ctx = new Proxy({}, {
      get(_, prop) {
        if (prop === 'measureText') return (s) => { log.push(['measureText', s]); return { width: measure(String(s)) }; };
        if (prop === 'createLinearGradient') return (...a) => { log.push(['createLinearGradient', ...a]); return { addColorStop: (o, c) => log.push(['addColorStop', o, c]) }; };
        return (...args) => { log.push([prop, ...args.map(a => (typeof a === 'number' ? Math.round(a * 100) / 100 : a))]); };
      },
      set(_, prop, value) { log.push(['set:' + String(prop), value]); return true; },
    });
    return { width: w, height: h, getContext: () => ctx };
  };
}
