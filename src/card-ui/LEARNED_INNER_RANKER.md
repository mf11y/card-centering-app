# Learned inner-border rollout

Status: implemented in the app working tree, **learned enabled by default**, A retained as fallback. **Not committed, pushed or deployed. TOP rescue remains disabled.**

## Files changed

Paths below are relative to `src/card-ui` in the app repository.

- `src/lib/card-centering/inner-border.ts`: only the asynchronous initial-guide dispatch changed. The entire existing A detector and rescue-helper implementation remains byte-equivalent as text before `guessInnerBorders`.
- `src/lib/card-centering/inner-ranker-config.ts`: `INNER_RANKER_MODE` / `ENABLE_LEARNED_INNER_RANKER`.
- `src/lib/card-centering/learned-inner-features.ts`: canonical, parity-tested 29-feature construction.
- `src/lib/card-centering/learned-inner-mlp.ts`: fixed numeric MLP inference and deterministic candidate voting.
- `src/lib/card-centering/learned-inner-ranker.ts`: cached asset loading, per-side fallback and development diagnostics.
- `static/models/learned-inner-v1.bin`: fixed 10-member fold-0 weights and saved normalization.
- `scripts/learned-inner-ranker.test.ts`: feature, score, voting and safety regression tests.
- `scripts/fixtures/learned-inner-golden.json`: compact synthetic Python/PyTorch golden fixture, not training data.
- `LEARNED_INNER_RANKER.md`: this rollout/rollback documentation.

Only one pre-existing source file changed during this task: `inner-border.ts`. All other 32 pre-existing source files match the pre-task hashes. Existing unrelated working-tree changes were preserved. Outer segmentation, refinement, source quad geometry, perspective warp, curved assist, upload logging, aspect ratio, centering formulas, manual controls and TOP rescue state were not modified.

## Exact model selection

Same fixed first ten seeds as the seed-stability experiment and local manual tester. No retraining or seed selection was performed. Deployment uses fold 0, the same predetermined fold used for arbitrary uploads in the local tester. All members use that fold; other fold checkpoints are evaluation-only.

| Member | Base training seed | Preserved checkpoint |
| --- | --- | --- |
| 0 | 20260905 | `numeric_balanced_sampling_seed00_fold0.pt` |
| 1 | 20360908 | `numeric_balanced_sampling_seed01_fold0.pt` |
| 2 | 20460911 | `numeric_balanced_sampling_seed02_fold0.pt` |
| 3 | 20560914 | `numeric_balanced_sampling_seed03_fold0.pt` |
| 4 | 20660917 | `numeric_balanced_sampling_seed04_fold0.pt` |
| 5 | 20760920 | `numeric_balanced_sampling_seed05_fold0.pt` |
| 6 | 20860923 | `numeric_balanced_sampling_seed06_fold0.pt` |
| 7 | 20960926 | `numeric_balanced_sampling_seed07_fold0.pt` |
| 8 | 21060929 | `numeric_balanced_sampling_seed08_fold0.pt` |
| 9 | 21160932 | `numeric_balanced_sampling_seed09_fold0.pt` |

Checkpoints are under `inner_border_ranker_seed_stability/20260905_221238/checkpoints` in the dataset workspace. Fold-specific inner training uses base seed + 101 ? fold; outer refit adds 7, unchanged. `learned_ranker_integration/model_manifest.json` records all source hashes and tensor order.

## Deployment representation

One little-endian Float32 binary asset, **163,640 bytes** (150,014 bytes gzip), holding ten models. Per member: mean[29], std[29], W1[64?29], b1[64], W2[32?64], b2[32], W3[1?32], b3[1], in that order. Architecture is 29?64?32?1, ReLU after the first two layers. Dropout is inactive at inference. The original saved Float32 weights and normalization are exported without fitting new statistics.

The TypeScript runtime preserves the locked BF16 weight/bias/input/activation casts and Float32 normalization. Summation uses JavaScript arithmetic followed by Float32/BF16 output rounding. This avoids ten ONNX sessions or an additional ranker runtime. The existing outer ONNX runtime is untouched. Ranker production chunk: **5,815 bytes / 2,706 bytes gzip** in this build. No Python, filesystem path or localhost dependency exists in the deployed code.

Asset URL: `/models/learned-inner-v1.bin`, fetched once per page session and reused. The asset is present and hash-identical in both the client output and `.vercel/output/static/models/`. SHA-256: `60d51526fa4989a18a98e90adf31326adecf0205e618320d88024a12e6970abf`.

## Exact feature vector

A's scan window, tangent samples, gradient strengths and supports are unchanged. The ranker uses the existing experimental local-maximum list from A's full depth profile, in ascending depth order, including plateau peaks. This is the same candidate set used to train/validate these models, not the five separated peaks in A's abbreviated diagnostic display. No new candidate generation, search extent or acceptance threshold is introduced.

Let p be the candidate's detector-pixel position, D the side-normal detector size, S its strength, U its support, W the raw A winner strength, and R the strongest rival more than max(3 pixels, 0.008D) away. All constructed values are cast to Float32 before each model's saved mean/std normalization.

| Index | Name | Value |
| --- | --- | --- |
| 0 | depth | inset percentage / 10 |
| 1 | strength | S / 100 |
| 2 | support | U |
| 3 | winner_strength | W / 100 |
| 4 | candidate_winner_ratio | S / max(W, 1e-6) |
| 5 | rival_strength | R / 100 |
| 6 | rival_candidate_ratio | min(5, R / max(S, 1)) |
| 7 | A_rank | strength-descending, depth-ascending rank / number of peaks |
| 8 | search_start | A searchStart / D |
| 9 | search_end | A searchEnd / D |
| 10?13 | side_top, side_bottom, side_left, side_right | one-hot side |
| 14?18 | r3_fraction, r3_variance, r3_min_support, r3_median_strength, r3_run | 3-region features below |
| 19?23 | r5_fraction, r5_variance, r5_min_support, r5_median_strength, r5_run | 5-region features |
| 24?28 | r7_fraction, r7_variance, r7_min_support, r7_median_strength, r7_run | 7-region features |

Regional extraction exactly ports the frozen Python implementation: the same 80 samples over the central 70% span, array-split grouping with remainder assigned to earlier groups, lower 35th-percentile strength, alpha validity and support threshold. Nearby local peaks use radius max(1, Python ties-to-even round(0.0025D)); regional evidence qualifies at strength ?14 and support ?0.70. These constants construct features; they are **not a new selection rejection gate**. Per-region features are fraction supporting, variance of supported peak depths in pp? capped at 1 (1 when none), minimum regional support, median regional strength /100, and longest contiguous supporting run /region count. Saved normalization comes exclusively from the original checkpoints.

## Voting and safety

Each member scores all existing candidates and chooses its largest logit. Equal scores choose the first stored candidate. The ensemble counts those choices; the largest count wins, with the same first-candidate tie-break. This is plurality voting, not always a strict majority. No probability calibration or score-margin rejection is added. Disagreement never triggers fallback by itself.

A runs first and supplies a complete valid result. Asset/decode failure preserves A on every side. Empty candidates, feature exceptions/nonfinite features, wrong score dimensions, nonfinite outputs, invalid selected depth and unexpected per-side errors preserve A for that side. Other sides can still use learned selection. Failed model loading is cached for that page session; reload retries it. Debug callbacks cannot break processing.

Development diagnostics are available as `globalThis.__learnedInnerDiagnostics`: candidate insets, A/learned selections, candidate vote counts, winning/runner-up vote fractions, disagreement, entropy and fallback reasons. `differsFromA` compares at A's existing two-decimal inset precision, so formatting-only differences are not called different candidate selections. Raw numerical differences are retained in regression exports. No production console messages or new telemetry system were added.

Manual correction stays authoritative. The existing async generation/warp checks and per-axis manual-adjustment guards were not changed. A production-preview test delayed model loading, nudged the top guide from 33.7 px to 34.374 px, and verified it remained at 34.374 px when the model completed.

## Browser parity and benchmark

- **173/173 sides:** exact feature vectors, all **11,590 candidate scores**, and 10-model selections match the saved held-out-fold experiment.
- **144 clear sides:** 144 exact selections, zero mismatches; **0.430489743 pp MAE**, **80.5556% within 0.5 pp**, **8 errors >2 pp**. Ambiguous/no-valid labels are excluded from accuracy metrics.
- Held-out benchmark evaluation loads each side's original held-out fold. It must not be confused with the deployed fixed fold-0 model set.
- Actual compiled production chunk + real static asset, fixed fold 0: **173/173 selections match fixed-fold-0 PyTorch**, one asset request across the whole run, no production debug global. The corresponding 144-clear descriptive score is **0.454908130 pp**, 82.6389% within 0.5 pp, 10 catastrophic errors. This mixes training and held-out examples and is **not an unbiased validation score**.
- Large fixture check: **341 cards / 1,364 sides / 80,530 scores**, zero selected-candidate discrepancies. One score differs on a single underlying card present twice (validation 70 and its preset). For bottom candidate 2.40963855%, seed index 3: PyTorch 3.5 vs browser 3.515625, one BF16 step. JavaScript versus CUDA accumulation rounding differs at this boundary. Both votes and final selections remain unchanged. No threshold or special-case correction was added to conceal this difference.

## 295-card and historical comparison

All 295 frozen validation warps plus 46 historical presets were processed through the integrated browser selector, using shipped fold-0 weights. The historical presets include Mewtwo, Psyduck, Eevee, Gold Charizard, wide borders, persistent failures, consistent fixes/regressions and prior reviewed rescue examples.

- 295-card set: **351 side-position changes across 197 cards** versus A.
- Historical presets: **64 side-position changes across 38 cards**.
- Comparing exact numeric inset values also counts A's two-decimal rounding differences: 1,161 /183 changed side values respectively. Therefore all 341 cards have at least one numerical difference. Every numerical disagreement has an overlay, so no actual position change is omitted.
- Zero runtime/safety fallbacks in this fixture set.

These comparisons are not a claim that every changed guide is correct. The 295-card set lacks exhaustive manual truth for all sides; no fabricated accuracy metric is assigned to it. Some historical images duplicate validation cards. Frozen warps isolate the inner-selector change; outer inference was not rerun for every historical image because it is unchanged. Real uploaded-image detection/warp was exercised in the production-preview test.

Artifacts in the dataset workspace:

- `learned_ranker_integration/reports/comparison.html`: A versus shipped learned overlays for every numerical disagreement.
- `reports/regression-comparison.csv`: all per-side selections, deltas, votes and fallback status.
- `reports/regression.json`: complete candidates, features and scores for 341 cases.
- `reports/browser-parity.json`, `reports/large-fixture-pytorch-parity.json`, `reports/production-bundle-parity.json`: exact parity evidence.
- `reports/fallback-tests.json`, `reports/production-preview.json`, `reports/final-verification.json`: safety and protected-source checks.

## Performance

Desktop Edge, actual direct TypeScript path, 341-card fixture run:

| Stage | Median ms | p95 ms |
| --- | ---: | ---: |
| Detector-image preprocessing | 4.2 | 24.1 |
| A scan | 0.7 | 1.4 |
| Numeric/regional feature extraction | 2.6 | 5.3 |
| Ten-model inference | 0.7 | 3.2 |
| Total inner decision (A + learned, excluding image preparation) | 4.2 | 8.4 |

Actual production asset fetch + decode initialization measured **3 ms locally**, reused for all 173 sides. Network delivery and mobile performance can differ; these are not guarantees of cold end-to-end upload time. The historical ONNX-only ~0.095 ms microbenchmark excluded feature extraction and initialization and is not substituted for the measured integrated runtime here.

## Tests, deployment and rollback

Run from `src/card-ui`:

```powershell
node --test scripts/learned-inner-ranker.test.ts scripts/top-inner-rescue.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false
npm.cmd run build
```

26 tests pass. TypeScript checks pass. Client and SSR production compilation succeeds. The Vercel adapter then fails on this Windows machine with **EPERM creating catchall.func ? index.func symlink**. This is the known packaging/OS-permission issue, distinct from compilation and runtime validation. Existing curved-help accessibility and Sharp platform-dependency warnings also remain unchanged. Model assets were already copied correctly into Vercel static output before the packaging failure. Full Linux/Vercel packaging remains to be confirmed in the authorized deployment workflow.

Rollback: change `INNER_RANKER_MODE` to `'a'` in `src/lib/card-centering/inner-ranker-config.ts`, rebuild and redeploy. This restores A-only selection without touching other code or enabling TOP rescue. No user-facing switch is introduced. Local development uses the same explicit constant.

Nothing has been committed, pushed or deployed. No further ranker implementation is pending. Before public rollout, inspect the disagreement artifacts as desired, then explicitly authorize commit/push and verify the Vercel/Linux build. The local Windows packaging limitation has not been hidden or worked around by changing deployment configuration.
