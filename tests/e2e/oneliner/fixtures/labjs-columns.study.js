// The study of labjs-columns.html. Its form has a field named integrity, one
// of ch-labjs.js's column names: ch-labjs.js keeps the participant's answer there and
// writes its own trial report as cyborgHunter_integrity.
//   q      html.Form, id 0: a textarea name="integrity" and a submit button   trial
//   done   html.Screen, id 1, 200 ms timeout                                    trial
//   root   flow.Sequence                                                        row, committed after on('end')
// on('epilogue') keeps exportCsv() (all three rows) on window.__csv and the
// datastore's state.integrity on window.__stateIntegrity.
var study = new lab.flow.Sequence({
  title: 'root',
  content: [
    new lab.html.Form({ title: 'q', content: '<form><p>Question</p><textarea name="integrity" id="integrity"></textarea><button type="submit" id="next">Next</button></form>' }),
    new lab.html.Screen({ title: 'done', content: '<p>Done</p>', timeout: 200 })
  ]
});
study.on('epilogue', function () {
  window.__stateIntegrity = study.options.datastore.state.integrity;
  window.__csv = study.options.datastore.exportCsv();
});
study.run();
