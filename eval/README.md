# PinePoint eval runbook

This folder holds the eval for PinePoint (Linear issue VI-20, Master Plan section 11).

Files:

| File | Use |
|---|---|
| `planted.json` | The test PRs. PR 10 has the planted bug "coupon applies twice" (lens Abuse, expected total $21.60, buggy total $19.44). PR 11 is clean (no bug). Do not change this file. |
| `results.json` | The results. Use `record.mjs` to add data. |
| `record.mjs` | Adds one run or one interview to `results.json`. |
| `summarize.mjs` | Prints the summary. |
| `interviews.md` | The form for the developer interviews. |

## Eval plan

1. Run the planted PR (PR 10) 3 times. Count the runs that report the coupon bug as a Bug finding.
2. Run the clean PR (PR 11) 3 times. Count all Bug findings. Each Bug finding on the clean PR is a false alarm. If the rate is more than 1 in 10 missions, the product fails this test, and the pitch must say the real number.
3. For each run, record the minutes from Run to review, and the cost per run (Pine usage plus Anthropic usage).
4. Run one real PR from the repository of Vi.
5. If time is available, run one PinePoint web (dogfood) PR.
6. Interview five developers (see `interviews.md`).

## Steps for one run

1. Open https://pinepoint-rho.vercel.app/app.
2. Paste the PR URL:
   - Planted: https://github.com/vihuynh72/pinepoint/pull/10
   - Clean: https://github.com/vihuynh72/pinepoint/pull/11
3. Write down the time. This is the start time.
4. Click Run.
5. Wait for the review. The review is on the page and on the PR.
6. Write down the time. This is the review time.
7. Write down these values:
   - The run ID.
   - The number of Bug findings.
   - The number of Possible findings.
   - The number of missions (usually 10).
   - For PR 10 only: does a Bug finding report the coupon bug (total $19.44, expected $21.60)? Yes or no.
8. Get the cost of the run:
   - Pine usage for the run.
   - Anthropic usage for the run (input tokens, output tokens, USD).
   - Add the two USD amounts. This is the cost.
9. Record the run (see the next section).

## Commands

Record a planted run:

```sh
node eval/record.mjs --pr 10 --kind planted --run RUN_ID --minutes 6.5 --caught yes --bugs 1 --possible 2 --cost 0.84 --input-tokens 400000 --output-tokens 30000 --notes "short note"
```

Record a clean run:

```sh
node eval/record.mjs --pr 11 --kind clean --run RUN_ID --minutes 6.0 --bugs 0 --possible 1 --cost 0.80
```

Record a real run or a dogfood run: use `--kind real` or `--kind dogfood` and the PR number.

Optional flags for a run:

| Flag | Value | Default |
|---|---|---|
| `--missions` | Number of missions in the run | 10 |
| `--started` | Start time, ISO format (for example `2026-10-17T15:02:00-07:00`) | null |
| `--review` | Review time, ISO format | null |
| `--input-tokens`, `--output-tokens` | Anthropic tokens. Give both or neither. | null |
| `--cost` | Cost in USD (Pine plus Anthropic) | null |
| `--notes` | Text | "" |

Required flags for a run: `--pr`, `--kind`, `--run`, `--minutes`, `--bugs`, `--possible`. A planted run also needs `--caught yes` or `--caught no`. Do not use `--caught` for other kinds.

Record an interview:

```sh
node eval/record.mjs --interview --who "Name, team" --waiting "4 PRs" --last-bug "last month, a broken checkout" --paused-helps "yes, I can see the bug" --notes "short note"
```

Print the summary:

```sh
node eval/summarize.mjs
```

Use another results file (for example, to test):

```sh
node eval/summarize.mjs --file /path/to/sample.json
node eval/record.mjs --file /path/to/sample.json --pr 10 --kind planted ...
```

The summary prints:

- Caught: the planted runs that caught the coupon bug, as "x of y".
- False alarms: Bug findings on clean runs over clean missions, as "a in b" and a percent. PASS if the rate is 1 in 10 or less.
- Median minutes to review and median cost per run.
- Token price comparison: the same token counts priced at the Claude Opus 5.5 list price. This is a comparison only. It is not the real cost. The price is in the constant `OPUS_5_5_LIST_PRICE_PER_MTOK` in `summarize.mjs`. Vi must confirm the price and then set `confirmed: true`.
- The real and dogfood runs.
- The interview answers.

## Shape of results.json

```json
{
  "runs": [
    {
      "pr": 10,
      "kind": "planted",
      "runId": "run_abc",
      "startedAt": "2026-10-17T22:02:00.000Z",
      "reviewAt": "2026-10-17T22:08:30.000Z",
      "minutesToReview": 6.5,
      "caughtPlantedBug": true,
      "bugFindings": 1,
      "possibleFindings": 2,
      "missions": 10,
      "costUsd": 0.84,
      "tokens": { "input": 400000, "output": 30000 },
      "notes": ""
    }
  ],
  "interviews": [
    {
      "who": "Name, team",
      "prsWaiting": "4 PRs",
      "lastPreviewBugInProd": "last month",
      "pausedSessionHelps": "yes",
      "notes": ""
    }
  ]
}
```

Field rules:

| Field | Type | Rule |
|---|---|---|
| `kind` | string | `planted`, `clean`, `real` or `dogfood` |
| `caughtPlantedBug` | true, false or null | true or false for planted runs. null for other kinds. |
| `startedAt`, `reviewAt` | string or null | ISO time |
| `minutesToReview` | number | Minutes from Run to review |
| `bugFindings`, `possibleFindings`, `missions` | whole number | |
| `costUsd` | number or null | Pine usage plus Anthropic usage, in USD |
| `tokens` | object or null | Anthropic input and output tokens |
