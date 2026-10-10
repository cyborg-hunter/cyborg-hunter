# demo-sessions

Four sessions recorded on this project's demo tour (the public demo at the repository's Pages site), for running `cyborg-hunter report` before you have data of your own. Three were recorded by the project's author and one by a GPT agent driving Chrome from a browser sidebar. One session per triage tier and the agent's:

| file | who | tour | what it shows |
|---|---|---|---|
| `DEMO-9mop.json` | the author | an earlier two-act version of the tour | hard-flagged: four pastes, four copies, four long tab-aways |
| `DEMO-bsq6.json` | a GPT agent | the current ten-step tour | hard-flagged, and a highly suspicious pointer verdict: all twelve first clicks arrived without a path |
| `DEMO-681w.json` | the author | the current ten-step tour | soft-flagged at the threshold; a clean pointer verdict |
| `DEMO-a3f3.json` | the author | an earlier two-act version of the tour | clean, with reasons |

The files are the "Session data" file each tour saved on its last step, as saved, except that one paste in `DEMO-a3f3.json` had the author's clipboard as its text and that text was removed (the event, its time and its length stay). What they hold: per-trial counts and timings, the pointer track, the session report, and the text of pastes made on the tour, which is the tour's own copy. No typed answer, user-agent string or address is in them. The tour's recordings (the replay files the last step also saves) are not bundled.

```bash
cd examples/demo-sessions
cyborg-hunter report
open report/index.html
```

The walkthrough that interprets every output file: [docs/worked-example.md](../../docs/worked-example.md).
