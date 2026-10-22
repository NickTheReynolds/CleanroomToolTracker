# Lookup algorithm

Lookup answers one question before a run: "what happened the last times I ran something like this?" It filters past runs, scores each one by a normalized distance from the planned parameters, weights them by similarity, age and tool events, then turns the ranked list into a short summary with plain arithmetic.

There is no AI, randomness or network in this process. The same input always gives the same output, and the inputs are never modified.

| Module | Job |
|---|---|
| `app/js/core/similarity.js` | `lookup()`: candidates, hard filters, spreads, distance, weights, ranking, extrapolation, relax counts. Also `matchFlags()`, `distance()` and `fieldSpread()`. |
| `app/js/core/summary.js` | `summarize()`: sensitivity, closest-run estimate, average, headline, trend, last tool event, suggested time, confidence. |
| `app/js/core/summary-text.js` | The sentences, warnings and confidence reasons. |
| `app/js/core/derive.js` | Derived outputs such as etch rate (see [Derived values](#derived-values)). |
| `app/js/config.js` | Every tunable constant (see [Constants](#constants)). |

The caller passes `now`. Every age and every "since" test is measured against it, so results never depend on the clock. If `now` is omitted, `lookup()` uses the current time. An unparseable `now` throws a `TypeError`.

## Terms

- **Set.** A value is set when it is a non-blank string, a finite number or a boolean. `null`, `undefined`, `''`, a string of spaces and `NaN` are all unset.
- **Input fields.** The fields of the query template with role `input`. Context and output fields are never matched.
- **Weight.** A field's `weight` if it is a number, with negative values counted as 0. Otherwise the default is 1, or 0 for duration fields, because time changes thickness, not rate. A field with weight 0 adds no distance term and is ignored by sensitivity.
- **Numeric fields** are `number` and `duration` (seconds). **Categorical fields** are `select`, `text` and `bool`.
- **Query value.** A query param counts only when it is set and has the field's type: a number for numeric fields, a boolean for `bool`, and a string for `text` and `select`. A value of the wrong type is ignored.
- **Equal** (categorical). Booleans compare strictly. Text and select values compare with `normText`: Unicode NFKC, trimmed, inner spaces collapsed, lower case. So "SiO₂" equals "sio2", and "Résist" equals " résist " but not "Resist".
- **Deleted records.** Deleted runs and deleted events are ignored. A deleted tool or template counts as not found.
- **Run steps.** A run with several steps (a breakthrough, the main etch, an over-etch) is compared by its main step, whose values are the run's `params`. The other steps are kept with the run and never matched. A run's projects play no part in Lookup.

## Step 0: candidates

A run is a candidate when it:

- is not deleted;
- has status `complete`;
- has a parseable `startedAt`; and
- has at least one set output. Outputs are the output-role fields of the run's own template. If that template is not found, any set value in `results` counts.

## Step 1: hard filters

A candidate must pass every filter below. The ones that pass are the **filtered candidates**, and every filtered candidate is a match.

1. **Tool.** The run has the query's `toolId`. With *Include siblings*, a run on any tool with the same `category` as the query tool also passes.
2. **Template.** The run has the query's `templateId`. With *Include siblings*, a run whose template has the same `processType` as the query template also passes.
3. **Material.** With *Same material*, `normText(run.material)` equals `normText(query.material)`. This filter is skipped when the query material is blank.
4. **Exact-match fields.** For each categorical input with `matchExact` that the query sets, the run's value must be set and equal. A run without the value fails. These filters apply whatever the field's weight, and they add no distance term.
5. **Strict chemistry.** With *Strict chemistry*, take the chemistry input fields of the query template together with those of the run's own template. For each of those keys, the gas flows when its value is a number above 0. An absent, unset or non-numeric value counts as 0, in the query as in the run. The query and the run must agree, key by key, on which gases flow.

Query options default to *Strict chemistry* on, *Same material* on and *Include siblings* off. The result echoes the query with these defaults filled in.

## Step 2: spread

Each numeric input with weight above 0 gets a spread s, which turns its differences into "typical variations":

1. Its `spreadHint`, if that is above 0.
2. Otherwise, the sample standard deviation (n − 1) of the field over the filtered candidates, if at least 4 of them have a numeric value and that deviation is above 0.
3. Otherwise, max(|ref| × 0.1, 1e-9). Here ref is the query value when the query sets the field. Otherwise ref is the mean of |value| over the filtered candidates that have the field, or 0 if none have it.

The values 4, 0.1 and 1e-9 are fixed by the spec rather than tunable. They are `SPREAD_MIN_N`, `SPREAD_FRACTION` and `SPREAD_FLOOR` in `similarity.js`.

## Step 3: distance

For every input the query sets that has weight w > 0 and is not `matchExact`, add one term:

| Field | Run value | Term |
|---|---|---|
| Numeric | a finite number r | w × \|q − r\| / s |
| Numeric | missing or not a number | w × `MISSING_PENALTY` |
| Categorical | equal | 0 |
| Categorical | set but not equal | w × `CATEGORICAL_PENALTY` |
| Categorical | missing | w × `MISSING_PENALTY` |

```text
d = sum over the terms   (a sum, not a mean: the worked example depends on it)
```

Each match carries its `terms` and a `diffs` list. The list has one entry per term above 0, in template order: `{key, label, unit, q, r, delta, missing}`. Here `delta` = r − q for numbers and null otherwise. `missing` is true when the run has no usable value, and `r` is null when it is unset.

## Step 4: weights

```text
w      = exp(−d) × 0.5^(max(ageDays, 0) / halfLife) × eventFactor
         ^ sim       ^ age                           ^ event

ageDays = (now − run.startedAt) / 86 400 000 ms        (reported unclamped)
```

- **halfLife** is the run's own tool's `halfLifeDays` when that is a positive number. Otherwise it is `HALF_LIFE_DAYS`. A sibling run uses its own tool's half-life.
- **eventFactor** is `EVENT_PENALTY` when a major event happened since the run, and 1 otherwise. That means a non-deleted event of the run's tool with `major === true` and run.startedAt < event.at ≤ now. An event at exactly the run's start does not count, and future events do not count.
- **lastEventSince** is the latest such event. On equal times the larger id wins. It names the flag, for example "Before last clean".
- A run dated after `now` has a negative age and an age factor of 1.

## Step 5: rank

Matches are sorted by:

1. d, smallest first. Distances that agree to 9 decimal places count as a tie, so float noise such as 0.1 + 0.2 against 0.3 does not decide the order.
2. Then `startedAt`, most recent first.
3. Then run id, ascending.

The result lists every filtered candidate. The screen shows the top `TOP_K` rows and keeps the rest behind Show more.

**Flags** (`matchFlags`): "Exact match" when d = 0. "Before last *x*" when an event happened since the run, where *x* is the short event name: clean, PM, target change and so on.

## Step 6: extrapolation

Check each numeric input with weight above 0 that the query sets. If q is below the minimum or above the maximum of that field over the filtered candidates, the check reports `{key, label, unit, q, min, max}`. Fields that no filtered candidate has are skipped.

## Step 7: relax counts

The relax counts tell the screen what to suggest when there are no matches. For each option, count the candidates that would pass with only that option relaxed:

- *Strict chemistry* turned off;
- *Same material* turned off;
- *Include siblings* turned on.

The reported number is max(0, relaxed − current). It is 0 when the option is already relaxed or changes nothing, for example *Same material* with a blank material.

## Summary

`summarize(result, {outputKey})` summarizes one output, by default the template's `primaryOutput`. It returns null when no match has a numeric value for that output. Below, **rows** are the matches with a numeric output, in rank order, and **n** is their number.

### Sensitivity

For each numeric input k with weight above 0, look at every unordered pair of filtered candidates that both have numeric values for k and for the output. A pair counts when:

- |Δk| > `SENS_MIN_DELTA` × s_k;
- every **other** numeric input with weight above 0 is either absent from both runs, or present in both with |Δ| ≤ `SENS_MAX_OTHER` × s. A value present in only one run rejects the pair.
- every categorical input with weight above 0 is either equal or absent from both. A value present in only one run rejects the pair. `matchExact` inputs are included here, even when the query does not set them.

The sensitivity of k is the median of Δoutput / Δk over the counted pairs, reported as `{value, pairs}`. Inputs with no counted pair have no sensitivity. The pair order does not matter, because the ratio is symmetric.

### Closest-run estimate

The closest run c is the first row. An input the query sets with weight above 0 **differs** when:

- it is numeric, and c has no numeric value or |q − c| > `DIFF_THRESHOLD` × s; or
- it is categorical, and the values are not equal (including when c has no value).

| Situation | Estimate |
|---|---|
| Nothing differs | c's value. Kind `exact` when c's d = 0, else `nearest`. |
| Every differing input is numeric, c has it, and it has a sensitivity | y_c + Σ sens_k × (q_k − c_k). Kind `adjusted`, with one adjustment `{key, label, unit, delta = q − c, sens, contribution}` per input. |
| Anything else | No estimate. `closestOnly` = c's value plus the labels that could not be adjusted. |

### Similar-runs average

The average is taken over the first `TOP_K` rows. It reports the weighted mean and the weighted standard deviation sqrt(Σw(x − μ)² / Σw), using each match's w. If the weights sum to 0, equal weights are used. The minimum, maximum and n are reported too.

### Headline

The headline is the estimate when there is one, labelled "exact match", "closest run" (for nearest) or "adjusted". Otherwise it is the weighted mean, labelled "similar-runs average".

### Trend

The trend uses rows with d ≤ `TREND_MAX_DISTANCE` and 0 ≤ ageDays ≤ `TREND_WINDOW_DAYS`. With at least `TREND_MIN_N` such rows, it fits a least-squares line of the output against `startedAt` in days and reports:

- `slopePerDay`, and `slopePerWeek` = slope × 7;
- `spanDays` = newest − oldest;
- `n`.

The trend is **stable** when |slope × spanDays| is below the sample standard deviation of those outputs, or when that deviation is 0. Otherwise it is **rising** (slope > 0) or **falling**. With too few rows, or with all rows at the same instant, there is no trend.

### Last tool event

The last event is the latest non-deleted major event of the **query** tool with at ≤ now. `runsSince` counts the matches on the query tool that started after it, whether or not they have the output. It is reported whatever the number of trend runs.

### Suggested time

A suggested time is given only when:

- the output unit, with spaces removed and lower-cased, is `nm/min`;
- the query has `targetThickness` T > 0; and
- the headline value R is above 0.

It is reported as:

- `minutes` = T / R and `seconds` = minutes × 60, with `mmss` from `formatMmSs` (5.882 min shows as "5:53");
- `rangeMin` = T / max and `rangeMax` = T / min, in minutes, over the top-`TOP_K` outputs that are above 0;
- `verb`: "etch" for process type etch, "deposit" for deposition, otherwise "run".

The range comes from the closest runs alone, so it need not contain the headline's time: an exact match, or an estimate extrapolated beyond your inputs, can fall outside it. The results card then says "The closest runs alone would take X; this estimate is beyond them" instead of calling it a range around the estimate (`ui/lookup-card.js`).

### On the Results screen

- The headline's subtitle names how many runs the range comes from: "range … in the closest 5 of 12 runs".
- The chart of the result over time joins only exact matches with a line (a trend of the same settings), and draws runs beyond the closest `TOP_K` fainter.
- Under the matches, the result is plotted against each numeric input that took at least two values in complete runs of the template, with a least-squares line; runs outside the closest `TOP_K` are fainter, and runs that do not pass the match rules faintest. It is a picture of the data, not part of the estimate.

### Confidence

| Level | Rule |
|---|---|
| Low | n = 1, or the closest run's d > `CONF_LOW_MIN_D`, or any extrapolation. |
| High | At least `CONF_HIGH_MIN_MATCHES` rows have d ≤ `CONF_HIGH_MAX_D`, the closest run is at most `CONF_HIGH_MAX_AGE_DAYS` old with no major event since it, and there is no extrapolation. |
| Medium | Otherwise. |

The `reasons` say what made the level low, what kept it from high, or what made it high. For example: "Only 2 runs within distance 0.5; high confidence needs 3."

### Sentences

Numbers use `fmtNum`: 3 significant figures and a true minus sign "−". Dates use `formatDay` in local time ("Oct 6"; a different year adds ", 2025"). A sentence appears only when its numbers exist, in this order:

| # | When | Format |
|---|---|---|
| 1 | always | "3 similar runs. Closest: Oct 6 (exact match), 85 nm/min." When c's d > 0, "(distance 0.25)" replaces "(exact match)". With one run, it starts "1 similar run." |
| 2 | adjusted estimate | "Adjusted for ICP power −25 W: ~89.5 nm/min." Several adjustments are joined with " and ". |
| 2 | closest shown as is | "Pressure differs from the closest run and has no measured sensitivity, so the closest run is shown as is." Several labels give "Pressure and CHF3 differ … and have …". |
| 3 | average over 2 or more runs | "Similar runs average 88.4 nm/min (71–94)." |
| 4 | each sensitivity, in template order | "Etch rate rises ~0.18 nm/min per W of ICP power (1 pair)." It says "falls" for a negative value and "per unit of X" when the input has no unit. A value of exactly 0 gives "Etch rate does not change with X (2 pairs)." |
| 5 | trend | "Etch rate is rising ~1.2 nm/min per week over 6 runs." (or "falling"), or "Etch rate has been stable over 6 runs." |
| 6 | last event | "Chamber clean on Oct 10; 1 run since." The event name comes from `EVENT_LABELS`, and the count is pluralized. |
| 7 | suggested time | "For 500 nm, etch ~5.9 min (5:53)." Minutes are shown to 1 decimal. |

Warnings are separate from sentences, with one per extrapolated input: "ICP power 500 W is outside your range (400–450 W); the estimate is extrapolated."

## Derived values

Derived outputs come from fixed built-in functions in `core/derive.js`, never from user formulas. A template's `derived` entries map an output key to one of them.

| Function | Formula | Inputs | Unit |
|---|---|---|---|
| `etchRate` | (pre − post) / (time / 60) | Pre and post mean thickness of the run's material; time in seconds | nm/min |
| `depRate` | (post − pre) / (time / 60), with pre = 0 when absent | As `etchRate` | nm/min |
| `removed` | pre − post | Pre and post mean thickness | nm |
| `deposited` | post − pre, with pre = 0 when absent | Pre and post mean thickness | nm |
| `uniformity` | (max − min) / (2 × \|mean\|) × 100 | Points of one measurement (post by default) | % |
| `uniformityStd` | sample std / \|mean\| × 100 (needs 2 or more points) | Points of one measurement | % |
| `selectivity` | (film pre − post) / (mask pre − post) | Each material's own pre and post measurements; needs `maskMaterial` | ratio |

The rules:

- **Mean.** A measurement's mean is the arithmetic mean of its points.
- **Which measurement.** For each phase, `derive.js` uses the latest non-deleted measurement by `takenAt` of the right kind (thickness by default) and material. A blank measurement material counts as the run's material.
- **Time.** Time comes from the entry's `timeField`, else from the template's first duration field. It must be a number above 0.
- **Selectivity.** Both films etch for the same time, so the rate ratio equals the ratio of thickness removed. A mask that did not thin gives no value.
- **Missing inputs.** If any input is missing, the output is absent, never 0. A reason is reported instead, such as "needs pre measurement", "needs time" or "post measurement has no points".
- **Units.** Values are converted on entry. Thickness and step height are stored in nm (Å × 0.1, µm × 1000) and CD in µm (nm × 0.001). Sheet resistance is stored in Ω/sq and stress in MPa. Refractive index has no unit.
- **Storage.** Values are recomputed on every save and every measurement change, and stored at full precision in `results`, with their keys in `derivedKeys`. A hand-entered output, meaning one in `results` but not in `derivedKeys`, always wins. Display rounds to 3 significant figures.

Test values: pre 1000 nm, post 575 nm and 300 s give 425 / 5 = **85 nm/min**. Points 412, 398 and 405 nm give a mean of **405 nm** and a uniformity of 14 / 810 × 100 = **1.728%**.

## Constants

Every tunable constant is in `DEFAULTS` in `app/js/config.js`. Settings → Lookup tuning can override **`HALF_LIFE_DAYS`**, **`EVENT_PENALTY`** and **`TOP_K`** through `withTuning(settings.tuning)`. Out-of-range values are ignored, and `TOP_K` is rounded. A tool's own `halfLifeDays` overrides `HALF_LIFE_DAYS` for that tool's runs.

| Constant | Default | Used in | Settings range |
|---|---|---|---|
| `HALF_LIFE_DAYS` | 30 | Age factor of the weight (`lookup`) | 1–3650 days |
| `EVENT_PENALTY` | 0.5 | Event factor of the weight (`lookup`) | 0–1 |
| `TOP_K` | 5 | Rows in the average and the time range (`summarize`); rows shown before Show more | 1–50 |
| `CATEGORICAL_PENALTY` | 1.0 | Distance term for unequal categorical values (`distance`) | |
| `MISSING_PENALTY` | 1.0 | Distance term for a value the run lacks (`distance`) | |
| `DIFF_THRESHOLD` | 0.1 | Spreads before an input counts as differing (`closestEstimate`) | |
| `SENS_MIN_DELTA` | 0.25 | Spreads the varied input must change (`sensitivities`) | |
| `SENS_MAX_OTHER` | 0.1 | Spreads other inputs may change (`sensitivities`) | |
| `TREND_MAX_DISTANCE` | 1.0 | Largest d of a trend run (`trendOf`) | |
| `TREND_WINDOW_DAYS` | 90 | Oldest trend run, in days (`trendOf`) | |
| `TREND_MIN_N` | 4 | Runs needed for a trend (`trendOf`) | |
| `CONF_HIGH_MIN_MATCHES` | 3 | Close runs needed for high confidence (`confidenceOf`) | |
| `CONF_HIGH_MAX_D` | 0.5 | What counts as close for high confidence (`confidenceOf`) | |
| `CONF_HIGH_MAX_AGE_DAYS` | 60 | Oldest closest run for high confidence (`confidenceOf`) | |
| `CONF_LOW_MIN_D` | 1.5 | Closest d above this is low confidence (`confidenceOf`) | |
| `BACKUP_REMINDER_DAYS` | 14 | Home backup banner (`views/home.js`) | |
| `PHOTO_MAX_EDGE` | 1600 px | Photo resize, long edge (`data/photos.js`) | |
| `PHOTO_QUALITY` | 0.8 | JPEG quality of resized photos (`data/photos.js`) | |

These values are fixed by the spec, not tunable:

- at least 4 candidates before the standard deviation is used as a spread;
- the 10% fallback spread;
- the 1e-9 spread floor;
- the 9-decimal tie rule for ranking.

## Worked example

These numbers come from the spec's Section 11 fixture (`test/fixtures.mjs`), and the tests in `test/similarity.test.mjs` and `test/summary.test.mjs` check them.

**Setup.** There is one ICP tool and the "Oxide etch" template. The spread hints are ICP 100 W, pressure 5 mTorr and CHF3 20 sccm. All runs are SiO2 with O2 = 0. `now` = 2026-10-20T12:00Z and the half-life is 30 days.

| Run | ICP (W) | Pressure (mTorr) | CHF3 (sccm) | Etch rate (nm/min) | Age (days) | Age factor |
|---|---|---|---|---|---|---|
| A | 400 | 10 | 50 | 85 | 14 | 0.7236 |
| B | 450 | 10 | 50 | 94 | 7 | 0.8507 |
| C | 400 | 15 | 40 | 71 | 90 | 0.1250 |

**Case 1: exact match.** The query is ICP 400, pressure 10, CHF3 50, with a 500 nm target.

- d: A 0, B 50/100 = 0.5, C 5/5 + 10/20 = 1.5. The order is A, B, C.
- w: A 0.7236, B exp(−0.5) × 0.8507 = 0.5160, C exp(−1.5) × 0.125 = 0.0279.
- Weighted mean **88.36** nm/min, weighted std 5.10, min 71, max 94.
- Sensitivity: ICP from the pair (A, B) is (94 − 85) / (450 − 400) = **0.18** nm/min per W. Pressure and CHF3 get none, because A and C differ in both.
- Headline **85** (exact match). Suggested time 500 / 85 = **5.882 min = 5:53**, with a range of 5.32–7.04 min.
- There is no extrapolation and no trend (3 runs < 4). Confidence is **medium**, because only 2 runs have d ≤ 0.5.
- Sentences:
  - "3 similar runs. Closest: Oct 6 (exact match), 85 nm/min."
  - "Similar runs average 88.4 nm/min (71–94)."
  - "Etch rate rises ~0.18 nm/min per W of ICP power (1 pair)."
  - "For 500 nm, etch ~5.9 min (5:53)."

**Case 2: between runs.** The query is ICP 425, pressure 10, CHF3 50.

- d: A 0.25, B 0.25, C 1.75. B ranks first on the recency tie-break.
- Headline **94 + 0.18 × (425 − 450) = 89.5** (adjusted). Confidence medium.
- Sentence: "Adjusted for ICP power −25 W: ~89.5 nm/min."

**Case 3: extrapolation.** The query is ICP 500, pressure 10, CHF3 50.

- d: B 0.5, A 1.0, C 2.5.
- Headline **94 + 0.18 × 50 = 103** (adjusted).
- Warning: "ICP power 500 W is outside your range (400–450 W); the estimate is extrapolated." Confidence **low**.

**Case 4: tool event.** Case 1, plus a major chamber clean at 2026-10-10T12:00Z.

- A and C are flagged "Before last clean" and their event factor is 0.5. B is not flagged.
- w: A **0.3618**, B 0.5160, C 0.0139. Weighted mean **89.99** nm/min.
- Sentence: "Chamber clean on Oct 10; 1 run since." Confidence medium.

**Case 5: no matches.** Case 1 with O2 = 10 sccm and *Strict chemistry* on.

- Zero matches. The relax counts are `{strictChemistry: 3, sameMaterial: 0, includeSiblings: 0}`, so turning off Strict chemistry would add 3 runs.

**Case 6: derived values.** These are the test values in [Derived values](#derived-values): **85 nm/min**, a mean of **405 nm** and uniformity of **1.728%**.
