// The study of labjs-perf.html: one flow.Loop of 60 html.Screens (20 ms
// timeout each, ids 0_0 … 0_59), 60 trials, 62 rows with the loop's and the
// root's. on('end') keeps exportCsv() on window.__csv and the size of the
// rows as JSON (what a Store with persistence writes to storage on every
// commit) on window.__rowsJsonLength.
var params = [];
for (var i = 0; i < 60; i++) params.push({ i: i });
var study = new lab.flow.Sequence({
  title: 'root',
  content: [
    new lab.flow.Loop({
      title: 'many',
      template: new lab.html.Screen({ title: 'tick', content: '<p>${ parameters.i }</p>', timeout: 20 }),
      templateParameters: params
    })
  ]
});
study.on('end', function () {
  window.__rowsJsonLength = JSON.stringify(study.options.datastore.data).length;
  window.__csv = study.options.datastore.exportCsv();
});
study.run();
