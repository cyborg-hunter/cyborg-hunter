// src/cli/renderers/typing-limits-core.js
// typing-limits.json's text: the version of the CLI that judged (it holds
// the constants), the versions the data was recorded with, every constant
// the typing section judged with (value and meaning), and over the cohort
// where the rhythm and the rate came from and the verdicts, so a report
// rebuilt by a later CLI shows which constants decided it. No fs access:
// report-core.js sinks it.

import { TYPING_LIMITS } from '../analyzers/typing.js';
import { VERSION } from '../../shared/constants.js';

// recordedWith: as in cursor-limits.json. results: analyzeTyping's, one per
// participant.
//
// Each session is counted once for its rhythm source: a session whose
// rhythm is not recorded counts there, even when its recording was read
// (one made without the page, trace tier, holds key presses but not the
// field each went to). rateSource counts the participant's rate source (the
// weakest any judged trial used).
export function buildTypingLimitsJson(recordedWith, results) {
  const count = (test) => results.filter(test).length;
  const notRecorded = (r) => r.state === 'not recorded';
  const verdicts = { highlySuspicious: 0, suspicious: 0, clean: 0, notAssessed: 0 };
  for (const r of results) verdicts[['notAssessed', 'clean', 'suspicious', 'highlySuspicious'][r.level + 1]]++;
  return JSON.stringify({
    cliVersion: VERSION,
    recordedWith,
    limits: TYPING_LIMITS,
    sessions: {
      total: results.length,
      rhythmSource: {
        library: count((r) => r.source === 'library'),
        recording: count((r) => r.source === 'recording' && !notRecorded(r)),
        notRecorded: count(notRecorded)
      },
      rateSource: {
        library: count((r) => r.rate.source === 'library'),
        recording: count((r) => r.rate.source === 'recording'),
        oldFormula: count((r) => r.rate.source === 'old formula')
      },
      verdicts
    }
  }, null, 2) + '\n';
}
