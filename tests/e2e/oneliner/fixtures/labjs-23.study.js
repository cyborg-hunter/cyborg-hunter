// The study of labjs-23.html, on the lab.js 23 alpha line (the
// flip-generation line; API not settled): labjs-full.study.js without the
// frame and the Dummy.
//   intro     html.Screen, ends on the Start click
//   block     flow.Loop: 3 × html.Form with a textarea name="answer"
//   shapes    canvas.Screen, 200 ms timeout
//   final     html.Form, its <form> carries data-ch-trial="final-q"
//   root      flow.Sequence
// ch-labjs.js does not hook this line yet, so no row gets integrity columns.
// on('end') keeps exportCsv() on window.__csv; the datastore lives on the
// controller (23 has no options.datastore).
var study = new lab.flow.Sequence({
  title: 'root',
  content: [
    new lab.html.Screen({ title: 'intro', content: '<p>Intro</p><button id="start" type="button">Start</button>', responses: { 'click #start': 'start' } }),
    new lab.flow.Loop({
      title: 'block',
      template: new lab.html.Form({ title: 'question', content: '<form><p>${ parameters.prompt }</p><textarea name="answer" id="answer"></textarea><button type="submit" id="next">Next</button></form>' }),
      templateParameters: [{ prompt: 'Q1' }, { prompt: 'Q2' }, { prompt: 'Q3' }]
    }),
    new lab.canvas.Screen({ title: 'shapes', content: [{ type: 'rect', left: 0, top: 0, width: 100, height: 50, fill: '#36c' }], timeout: 200 }),
    new lab.html.Form({ title: 'final', content: '<form data-ch-trial="final-q"><p>Final</p><textarea name="final" id="final"></textarea><button type="submit" id="finish">Finish</button></form>' })
  ]
});
study.on('end', function () {
  window.__csv = study.internals.controller.global.datastore.exportCsv();
});
study.run();
