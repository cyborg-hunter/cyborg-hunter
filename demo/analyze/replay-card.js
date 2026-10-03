// demo/analyze/replay-card.js
// Replays outside the report (the report iframe's sandbox would freeze a
// nested dom-tier viewer, see demo/replay-host.js), one at a time: a dropdown
// of participants with a recording, a Load button, and a same-origin host
// iframe torn down on every switch. The model is requested from the worker
// on demand, so no cohort of models ever sits in page memory.
import { buildReplayHostHtml, teardownReplayHost } from '../replay-host.js';

export function createReplayCard(container, assets, requestModel) {
  var card = document.createElement('div');
  card.className = 'replay-card';
  card.innerHTML =
    '<h3>Session replay</h3>' +
    '<p class="hint" data-role="replay-policy">Replays play from the dropped data only. External stylesheets and images are never fetched (this page cannot reach the network); drop the experiment’s CSS and image files with the data for styled replays, or use the CLI.</p>' +
    '<p><select data-role="replay-select"></select> <button class="secondary" data-action="load-replay">Load replay</button> <span class="hint" data-role="asset-note"></span></p>' +
    '<div data-role="replay-mount"></div>';
  container.appendChild(card);
  var select = card.querySelector('[data-role="replay-select"]');
  var loadButton = card.querySelector('[data-action="load-replay"]');
  var note = card.querySelector('[data-role="asset-note"]');
  var mount = card.querySelector('[data-role="replay-mount"]');
  var participants = [];
  // Bumped by every teardown: a model that arrives after the selection moved
  // on (or after another load started) belongs to a viewer nobody wants.
  var generation = 0;
  // Whether the analyst has picked or loaded a replay since this run's list
  // arrived (the page then ignores the report's load-time selection).
  var chosen = false;

  function current() { return participants.find(function (p) { return p.participantId === select.value; }) || null; }
  function teardown() { generation++; teardownReplayHost(mount); }
  // missing: the id of a participant the report selected who has no
  // recording here. In a run without any recording the run-level note says
  // more, and there is no other replay it could be mistaken for.
  function showNote(missing) {
    var p = current();
    var none = !participants.some(function (x) { return x.hasReplay; });
    note.textContent = none ? 'No replay recordings in this run.'
      : missing ? 'Participant ' + missing + ' has no replay recording.'
      : (p && p.assetNote ? p.assetNote : '');
    loadButton.disabled = !(p && p.hasReplay);
  }

  function render() {
    select.innerHTML = '';
    participants.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.participantId;
      o.textContent = p.participantId + (p.hasReplay ? '' : ' (no replay)');
      o.disabled = !p.hasReplay;
      select.appendChild(o);
    });
    var first = participants.find(function (p) { return p.hasReplay; });
    if (first) select.value = first.participantId;
    showNote();
  }

  select.addEventListener('change', function () { chosen = true; teardown(); showNote(); });
  // A failed load is reported by the page (the worker's error message); the
  // card only has to not mount anything.
  loadButton.addEventListener('click', function () { chosen = true; api.load().catch(function () {}); });

  var api = {
    setParticipants: function (list) { participants = list; chosen = false; teardown(); render(); },
    userChose: function () { return chosen; },
    select: function (pid) {
      var p = participants.find(function (x) { return x.participantId === pid; });
      if (p && p.hasReplay) {
        if (select.value === pid) return;
        select.value = pid; teardown(); showNote();
        return;
      }
      // No recording for this participant: whatever replay is mounted belongs
      // to someone else, so it goes. The dropdown moves to the participant's
      // own disabled entry (or to nothing for an id it does not list), which
      // also leaves Load with nothing to load.
      teardown();
      if (p) select.value = pid; else select.selectedIndex = -1;
      showNote(pid);
    },
    load: async function () {
      var p = current();
      if (!p || !p.hasReplay) return;
      teardown();
      var mine = generation;
      var model = await requestModel(p.participantId);
      if (mine !== generation) return;
      var inner = document.createElement('div');
      inner.className = 'replay-host-card';
      var iframe = document.createElement('iframe');
      iframe.className = 'replay-host-frame';
      // Same sandbox as the demo's host, for the same reason (replay-host.js):
      // only the baked viewer client runs here; the recorded page is rebuilt
      // one level deeper, in the viewer's own script-less frame.
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      iframe.title = 'Session replay: ' + p.participantId;
      iframe.dataset.participantId = p.participantId;
      inner.appendChild(iframe);
      mount.appendChild(inner);
      iframe.src = URL.createObjectURL(new Blob(
        [buildReplayHostHtml(model, assets.replayClientSrc, { replayCss: assets.replayCss, fontFaceCss: assets.fontFaceCss }, { noExternalCss: true })],
        { type: 'text/html' }));
    },
    teardown: teardown,
  };
  return api;
}
