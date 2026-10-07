// The study of labjs-replay.html. The intro screen sets the study's own
// participantId (RES-3), which ch-labjs.js never overwrites; ch-labjs.js's id goes into
// cyborgHunterParticipantId and the recording.
//   intro     html.Screen, id 0, data { participantId: 'RES-3' }, ends on the Start click   trial
//   shapes    canvas.Screen, id 1, 300 ms timeout                                           trial
//   final     html.Form, id 2, its <form> carries data-ch-trial="final-q"                   trial named final-q
//   root      flow.Sequence                                                                 row, committed after on('end')
// on('end') keeps CyborgHunter.replay() on window.__replay and exportCsv()
// on window.__csv (3 trial rows).
var study = new lab.flow.Sequence({
  title: 'root',
  content: [
    new lab.html.Screen({ title: 'intro', data: { participantId: 'RES-3' }, content: '<p>Intro</p><button id="start" type="button">Start</button>', responses: { 'click #start': 'start' } }),
    new lab.canvas.Screen({ title: 'shapes', content: [{ type: 'rect', left: 0, top: 0, width: 100, height: 50, fill: '#36c' }], timeout: 300 }),
    new lab.html.Form({ title: 'final', content: '<form data-ch-trial="final-q"><p>Final</p><textarea name="final" id="final"></textarea><button type="submit" id="finish">Finish</button></form>' })
  ]
});
study.on('end', function () {
  window.__replay = CyborgHunter.replay();
  window.__csv = study.options.datastore.exportCsv();
});
study.run();
