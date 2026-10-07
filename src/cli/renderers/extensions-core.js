// src/cli/renderers/extensions-core.js
// extensions.csv's text — which AI extensions/tools were detected for which
// participants, one row per participant × extension, plus sidebar detection as
// a separate row. No fs access: report-core.js sinks it, extensions.js writes it.

import { countSidebarOpenings } from '../analyzers/summary.js';
import { csvCell } from '../../shared/csv-cell.js';

// The file's text and its row count (for the console line).
export function buildExtensionsCsv(participants) {
  const header = 'participantId,detectionType,name,details';
  const rows = [];

  for (const p of participants) {
    const pid = p.participantId;

    // Extensions detected (from browser scan)
    const extensions = p.session?.aiExtensionsFound || p.trials[0]?.extensionsDetected || [];
    for (const ext of extensions) {
      const name = typeof ext === 'string' ? ext : ext.name || 'unknown';
      rows.push(row(pid, 'extension', name, ''));
    }

    // Sidebar detection. Prefer the current library's session-level
    // sidebarEvents (the monitor records sidebars session-scoped, not per-trial);
    // fall back to the legacy per-trial sidebarGapPx only when no session events
    // exist (pre-session / Shape-2 legacy data). countSidebarOpenings() counts
    // distinct openings (collapsing the paired open/close records and the
    // innerWidth_delta + layout_compression double-detection), matching the
    // summary/triage count.
    const sidebarOpens = countSidebarOpenings(p.session?.sidebarEvents);
    if (sidebarOpens > 0) {
      rows.push(row(pid, 'sidebar', 'browser_sidebar', `${sidebarOpens} open event${sidebarOpens === 1 ? '' : 's'}`));
    } else if (p.trials.some(t => (t.sidebarGapPx || 0) > 0)) {
      const maxGap = Math.max(...p.trials.map(t => t.sidebarGapPx || 0));
      rows.push(row(pid, 'sidebar', 'browser_sidebar', `${maxGap}px gap`));
    }
  }

  return { csv: [header, ...rows].join('\n') + '\n', rows: rows.length };
}

function row(...cells) {
  return cells.map(csvCell).join(',');
}
