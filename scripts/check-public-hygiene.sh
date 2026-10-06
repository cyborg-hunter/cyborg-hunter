#!/usr/bin/env bash
#
# check-public-hygiene.sh — public-tree hygiene gate.
#
# Fails (exit 1) if any tracked file contains a banned token. Banned tokens are
# personal or internal-process leakage that must never ship in the public tree:
# personal machine paths and Pages URLs, study-specific participant identifiers,
# and internal review vocabulary (Sol / Fable / pack / C-prime / red-team).
#
# NOTE on Prolific/MTurk: the bare platform names are NOT banned — they are the
# legitimate crowdsourcing platforms this tool supports, and deliberate
# package.json / CITATION keywords. Only the study-specific identifier forms
# (PROLIFIC_PID env var, Prolific completionCode) are treated as leakage.
# One path-scoped exception: the one-line setup reads Prolific's documented
# URL parameter, so the literal is allowed in its resolver, tests and docs and
# in the built one-line files (dist/ch.js, dist/ch-<name>.js) under
# $GATE_SCAN_DIR, and the analyze page's bundle and offline file there, which
# carry the resolver's parameter list (PID_ALLOW_RE below).
#
# The personal Pages host konukcan.github.io is banned. One allowlisted
# exception: konukcan.github.io/cyborg-hunter, the demo's PRE-org-migration
# URL (repo moved to the cyborg-hunter org, 2026-08-04) — it survives only
# as a historical mention in CHANGELOG entries, which we don't rewrite. The
# current demo host (cyborg-hunter.github.io) never matches the ban. A hit
# on any OTHER path under the personal host (e.g. a different personal
# project's Pages URL pasted by accident) still fails the gate.
#
# GATE_SCAN_DIR: when set, this script ALSO plain-greps that directory (in
# addition to the normal git-tracked-file scan) with the same patterns and
# the same allowlist filter. Use it to scan the assembled Pages artifact
# (.demo-site/), which contains generated files git grep can't see because
# they're gitignored/untracked.
#
# GATE_COMMIT: when set to a revision, the message of that commit
# (git log -1 --format=%B) is ALSO scanned, against the same patterns plus
# an extra list of agent-run vocabulary that applies to the message only.
# Unset, behaviour is unchanged.
#
# Process labels: source, tests, tools and packages must not carry labels from
# how the code was built (plan task numbers, review-round and finding ids).
# They mean nothing to an outside reader. The label_patterns below run over
# those paths only (src, tests, tools, packages, bin, build.js,
# build-targets.js, demo; never docs, never this file), and over
# $GATE_SCAN_DIR when it is set.
#
# Runs from anywhere in the repo. Scans tracked files (git grep) plus,
# optionally, $GATE_SCAN_DIR (plain grep).

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PAGES_ALLOWLIST='konukcan.github.io/cyborg-hunter'

# PROLIFIC_PID is Prolific's public URL parameter name (as workerId is
# MTurk's), and the one-line setup reads it by default, so the literal is
# allowed in exactly these tracked paths: the resolver, its tests, its e2e
# suite and its docs. Anywhere else (any other source, test, doc or script)
# it still fails the gate, which keeps guarding the author's own study code.
# Hits are `path:line:text`; the `:` after the path stops a later path-like
# string in the text from matching. Under $GATE_SCAN_DIR only these built
# files are allowed (filter_hits' second arg): the one-line files, dist/ch.js
# and dist/ch-<name>.js (one per target in build-targets.js), and
# analyze/analyze.bundle.js and analyze/cyborg-hunter-analyze.html.
PID_ALLOW_RE='^(src/oneliner/participant-id\.js|tests/oneliner/participant-id\.test\.js|tests/oneliner/debug\.test\.js|tests/e2e/oneliner/[^:]*|docs/quickstart\.md|docs/advanced-integration\.md):'

# Filters raw hit lines for a given pattern through the Pages allowlist when
# the pattern is the personal-host ban, and through the PROLIFIC_PID path
# allowlist (tracked files; or, given a scan dir as $2, that dir's
# built files above only); every other pattern passes through unfiltered. The
# trailing `|| true` keeps this 0-exit under `set -e` even when grep -v
# filters out every line (its normal "no output" exit is 1).
filter_hits() {
  local pat="$1" scan_dir="${2:-}"
  if [ "$pat" = 'konukcan\.github\.io' ]; then
    grep -vF "$PAGES_ALLOWLIST" || true
  elif [ "$pat" = 'PROLIFIC_PID' ] && [ -n "$scan_dir" ]; then
    # The scan dir is a literal prefix (no regex escaping of the dir name
    # needed). After it: the one-line files (dist/ch.js, dist/ch-<name>.js),
    # and the analyze page's bundle and offline file.
    awk -v d="${scan_dir%/}/" 'index($0, d) == 1 { p = substr($0, length(d) + 1); if (p ~ /^dist\/ch(-[a-z0-9]+)?\.js:/ || index(p, "analyze/analyze.bundle.js:") == 1 || index(p, "analyze/cyborg-hunter-analyze.html:") == 1) next } { print }'
  elif [ "$pat" = 'PROLIFIC_PID' ]; then
    grep -vE "$PID_ALLOW_RE" || true
  else
    cat
  fi
}

# Each entry is an extended-regex (ERE) banned token. Case is encoded in the
# pattern where it matters (e.g. C-prime must stay upper-case to avoid matching
# "specific primer"); word boundaries (\b) guard common English substrings.
patterns=(
  'konukcan\.github\.io'   # personal GitHub Pages host
  '/Users/cankonuk'        # personal machine path
  'PROLIFIC_PID'           # study-specific participant identifier
  'completionCode'         # Prolific study completion code
  '\b[Pp]ledge\b'          # internal honor-pledge study term
  '\b[Ff]able\b'           # internal codename (also covers fable-window)
  '[Ss]ol[ -][0-9]'        # internal review vocab: "Sol 5", "sol-5", "Sol 20"
  '[Ss]ol review'          # internal review vocab
  'ch-sol-loop'            # internal review-loop label
  'C′'                     # internal design label "C-prime" (U+2032 prime)
  'C.?prime'               # internal design label, spelled out
  'pack[ -][0-9]'          # internal iteration label: "pack 26", "pack-30"
  'se-study'               # internal study name
  'SE study'               # internal study name (spaced form)
  'SE-native'              # internal shorthand
  '[Ss]elf-explanation'    # internal paradigm / repo name
  'SEAudio'                # internal component name
  '[Rr]ule-gallery'        # internal paradigm name
  '[Cc]ard-games'          # private repo name
  '\bstudy3\b'             # internal study name
  'study-3'                # internal study name
  'design-decisions'       # deleted internal design-rationale doc
  'adversarial break'      # internal red-team vocab
)

fail=0
self='scripts/check-public-hygiene.sh'  # this file lists the tokens; don't scan it
for pat in "${patterns[@]}"; do
  # -I skips binary files; -n adds line numbers; -E extended regex.
  if raw=$(git grep -I -nE "$pat" -- ":(exclude)$self" 2>/dev/null); then
    hits=$(printf '%s\n' "$raw" | filter_hits "$pat")
    if [ -n "$hits" ]; then
      echo "BANNED TOKEN /$pat/:"
      printf '%s\n' "$hits" | sed 's/^/  /'
      echo
      fail=1
    fi
  fi

  if [ -n "${GATE_SCAN_DIR:-}" ] && [ -d "$GATE_SCAN_DIR" ]; then
    if raw=$(grep -rnIE "$pat" "$GATE_SCAN_DIR" 2>/dev/null); then
      hits=$(printf '%s\n' "$raw" | filter_hits "$pat" "$GATE_SCAN_DIR")
      if [ -n "$hits" ]; then
        echo "BANNED TOKEN /$pat/ in \$GATE_SCAN_DIR ($GATE_SCAN_DIR):"
        printf '%s\n' "$hits" | sed 's/^/  /'
        echo
        fail=1
      fi
    fi
  fi
done

# --- Process labels (source, tests, tools, packages) -------------------------
# POSIX ERE with explicit boundary classes instead of \b, so the result is the
# same under BSD and GNU regex. Q holds the two quote characters: a token like
# T5.9 is only a label when it is NOT quoted (a quoted 'T1' is test data) and
# not embedded in a base64 / path / version run (the +/=. and - exclusions).
Q="'\""
label_patterns=(
  "(^|[^A-Za-z0-9_/+=.$Q-])T[0-9]+(\\.[0-9]+)?([^A-Za-z0-9_/+=$Q-]|$)"  # T5, T5.9
  '(^|[^A-Za-z0-9_])Tasks?[ -][0-9]'    # Task 10, Task-3, Tasks 4-7
  'fix round'                           # "fix round 3"
  '[Ff]inding [0-9]'                    # "finding 2"
  'review [A-Z]-[0-9]'                  # "review M-4"
  '[A-Z][0-9] review'                   # "A3 review"
  'Sol (round|R[0-9])'                  # "Sol round-1", "Sol R2"
)
label_paths=(src tests tools packages bin build.js build-targets.js demo)
for pat in "${label_patterns[@]}"; do
  if raw=$(git grep -I -nE "$pat" -- "${label_paths[@]}" ":(exclude)$self" 2>/dev/null); then
    echo "PROCESS LABEL /$pat/:"
    printf '%s\n' "$raw" | sed 's/^/  /'
    echo
    fail=1
  fi
  if [ -n "${GATE_SCAN_DIR:-}" ] && [ -d "$GATE_SCAN_DIR" ]; then
    if raw=$(grep -rnIE "$pat" "$GATE_SCAN_DIR" 2>/dev/null); then
      echo "PROCESS LABEL /$pat/ in \$GATE_SCAN_DIR ($GATE_SCAN_DIR):"
      printf '%s\n' "$raw" | sed 's/^/  /'
      echo
      fail=1
    fi
  fi
done

# --- Commit-message mode (opt-in): GATE_COMMIT=<rev> -------------------------
# Scans the message of <rev> with the patterns above (same personal-host
# allowlist) plus message-only agent-run vocabulary. Does not touch files.
if [ -n "${GATE_COMMIT:-}" ]; then
  if ! msg=$(git log -1 --format=%B "$GATE_COMMIT" 2>/dev/null); then
    echo "FAIL: GATE_COMMIT=$GATE_COMMIT is not a valid revision." >&2
    exit 1
  fi
  message_only_patterns=(
    'overnight'
    '\bT[0-9]\b'
    '\bI[0-9]\b'
    'fix round'
    'ledger'
    '\bSDD\b'
  )
  for pat in "${patterns[@]}" "${message_only_patterns[@]}"; do
    if raw=$(printf '%s\n' "$msg" | grep -E "$pat" 2>/dev/null); then
      hits=$(printf '%s\n' "$raw" | filter_hits "$pat")
      if [ -n "$hits" ]; then
        echo "BANNED TOKEN /$pat/ in commit message ($GATE_COMMIT):"
        printf '%s\n' "$hits" | sed 's/^/  commit message: /'
        echo
        fail=1
      fi
    fi
  done
fi

if [ "$fail" -ne 0 ]; then
  echo "FAIL: public-hygiene gate found banned tokens above." >&2
  exit 1
fi

echo "OK: no banned tokens in tracked files."
