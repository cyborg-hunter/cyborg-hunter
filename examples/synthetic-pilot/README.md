# synthetic-pilot

A four-participant synthetic dataset for trying out `cyborg-hunter report` without collecting data first. One participant per triage tier (clean, soft-flagged, hard-flagged), and a generated session that sets off the report's pointer checks: its browser set the automation flag, two of its trials move in straight lines before they click, and the third is clicked with no pointer movement.

**No real participants are behind these files.** `generate-fixture.mjs` hand-authors every number; the data is shaped exactly like what the jsPsych extension saves (v0.6.1 for the three tier sessions, whose pointer checks the report shows as not recorded; 0.14.0 for the generated one, with the device facts and click provenance the checks read), so the full pipeline runs on it.

```bash
cd examples/synthetic-pilot
cyborg-hunter report
open report/index.html
```

The walkthrough that interprets every output file: [docs/worked-example.md](../../docs/worked-example.md).

To regenerate the CSVs after editing the generator: `node generate-fixture.mjs`.
