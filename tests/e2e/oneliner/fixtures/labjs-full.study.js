// The study of labjs-full.html and labjs-not-hookable.html. lab.js commits
// one row per component, containers included; the one-line setup adds
// columns to the trial rows:
//   intro     html.Screen, id 0, ends on the Start click                 trial
//   block     flow.Loop, id 1: 3 × html.Form (ids 1_0, 1_1, 1_2) with a
//             textarea name="answer" and a submit button                3 trials, 1 container row
//   shapes    canvas.Screen, id 2, 200 ms timeout                        trial
//   framed    html.Frame, id 3, around html.Screen "inner" (3_0, 100 ms) 1 trial, 1 container row
//   final     html.Form, id 4, its <form> carries data-ch-trial="final-q" trial named final-q
//   bye       core.Dummy, id 5, skipped                                  row, no columns
//   root      flow.Sequence                                              row, committed after on('end')
// 7 trials. on('end') sees 10 rows and keeps exportCsv()/exportJson() on
// window (__csv, __json); on('epilogue'), after the root row's commit, keeps
// all 11 rows (__csvAll, __rowsAll).
// A data-transmit="<url>" attribute on this script's tag adds the Transmit
// plugin to the root (incremental slices and the full upload to <url>).
var transmitUrl = document.currentScript && document.currentScript.getAttribute('data-transmit');
var study = new lab.flow.Sequence({
  title: 'root',
  plugins: transmitUrl ? [new lab.plugins.Transmit({ url: transmitUrl })] : [],
  content: [
    new lab.html.Screen({ title: 'intro', content: '<p>Intro</p><button id="start" type="button">Start</button>', responses: { 'click #start': 'start' } }),
    new lab.flow.Loop({
      title: 'block',
      template: new lab.html.Form({ title: 'question', content: '<form><p>${ parameters.prompt }</p><textarea name="answer" id="answer"></textarea><button type="submit" id="next">Next</button></form>' }),
      templateParameters: [{ prompt: 'Q1' }, { prompt: 'Q2' }, { prompt: 'Q3' }]
    }),
    new lab.canvas.Screen({ title: 'shapes', content: [{ type: 'rect', left: 0, top: 0, width: 100, height: 50, fill: '#36c' }], timeout: 200 }),
    new lab.html.Frame({ title: 'framed', context: '<div id="frame"><h2>Frame</h2><main id="inner"></main></div>', contextSelector: '#inner',
      content: new lab.html.Screen({ title: 'inner', content: '<p>Inner</p>', timeout: 100 }) }),
    new lab.html.Form({ title: 'final', content: '<form data-ch-trial="final-q"><p>Final</p><textarea name="final" id="final"></textarea><button type="submit" id="finish">Finish</button></form>' }),
    new lab.core.Dummy({ title: 'bye' })
  ]
});
study.on('end', function () {
  window.__rowsAtEnd = study.options.datastore.data.length;
  window.__csv = study.options.datastore.exportCsv();
  window.__json = study.options.datastore.exportJson();
});
study.on('epilogue', function () {
  window.__rowsAll = study.options.datastore.data.length;
  window.__csvAll = study.options.datastore.exportCsv();
});
study.run();
