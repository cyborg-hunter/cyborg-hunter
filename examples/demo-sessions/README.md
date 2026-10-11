# demo-sessions

Four sessions recorded on this project's demo tour (the public demo at the repository's Pages site), for running `cyborg-hunter report` before you have data of your own. Three were recorded by Mira, a human tester, and one by a GPT agent driving Chrome from a browser sidebar. One session per triage tier and the agent's:

| file | who | tour | recording | what it shows |
|---|---|---|---|---|
| `DEMO-9mop.json` | Mira, a human tester | an earlier two-act version of the tour | none | hard-flagged: four pastes, four copies, four long tab-aways |
| `DEMO-bsq6.json` | a GPT agent | the current ten-step tour | `DEMO-bsq6.replay.json` | hard-flagged, and a highly suspicious pointer verdict: all twelve of its first clicks with a known position arrived without a path |
| `DEMO-681w.json` | Mira, a human tester | the current ten-step tour | `DEMO-681w.replay.json` | soft-flagged at the threshold; a clean pointer verdict |
| `DEMO-a3f3.json` | Mira, a human tester | an earlier two-act version of the tour | `DEMO-a3f3.replay.json` | clean, with reasons |

The files are the "Session data" file each tour saved on its last step, as saved, except that one paste in `DEMO-a3f3.json` had the tester's clipboard as its text and that text was removed (the event, its time and its length stay). What they hold: per-trial counts and timings, the pointer track, the wall-clock times of trial ends and tab-aways, the recording screen's size, the session report, and the texts of the pastes that came from the tour's own copy. No answer typed by hand, no user-agent string, no address.

The three `*.replay.json` files are the sessions' replay recordings, as the tour saved them, with three edits: the stylesheet URL is the relative `demo.css`; the elements and styles that the recording browser's extensions added to the page are removed; and `DEMO-a3f3.replay.json` reads as a paste of `Copy Copy` (length 9) with nothing typed after it: the pasted text is `Copy Copy` wherever it appeared, and the keystrokes typed after the paste are removed. They carry the page as it was rendered, the pointer and scroll trace, the typed text (the agent's "A productive day so far.", the tour's own copy, the demo's scripted typing), each recording's start time and viewport size, and one identifying field: the browser line `Mozilla/5.0 (Macintosh; …) Chrome/…`. `cyborg-hunter report` attaches them to their sessions; the analyzer page fetches them when "Load sample data" is clicked.

```bash
cd examples/demo-sessions
cyborg-hunter report
open report/index.html
```

The walkthrough that interprets every output file: [docs/worked-example.md](../../docs/worked-example.md).
