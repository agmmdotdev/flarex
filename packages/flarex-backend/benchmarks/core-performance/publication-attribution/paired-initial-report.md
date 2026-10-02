# Publication Attribution

Complete: false; source stable: true.

Planned attempts: 36; attempted: 13; business failures: 1; invalid observations: 0. All attempted samples remain in original order, including warmups and failures.

Boundary-only includes owner phase timing. Detailed includes scalar demands and SQL tracing; neither is fully uninstrumented.

| Profile | Mode | Retained samples | Complete attempt median / P95 ms |
| --- | --- | ---: | --- |
| product | boundaryOnly | 5 | 552.128 / 553.442 |
| product | detailed | 5 | 641.215 / 759.686 |
| productPayload | boundaryOnly | 0 | unavailable |
| productPayload | detailed | 0 | unavailable |
| workflow | boundaryOnly | 0 | unavailable |
| workflow | detailed | 0 | unavailable |

## Owner component intervals

| Profile | Mode | Owner region | Sample union median / P95 ms |
| --- | --- | --- | --- |
| product | boundaryOnly | request admission | 74.275 / 77.450 |
| product | boundaryOnly | Worker execution | 320.244 / 326.437 |
| product | boundaryOnly | journal seal and OCC verification | 73.588 / 76.100 |
| product | boundaryOnly | authoritative publication | 78.976 / 82.396 |
| product | boundaryOnly | commandPreparation | 3.303 / 6.064 |
| product | boundaryOnly | authorityResolution | 1.347 / 1.448 |
| product | boundaryOnly | initialOutcome | 1.087 / 1.173 |
| product | boundaryOnly | intrinsicDefinition | 1.635 / 1.784 |
| product | boundaryOnly | mixedDefinitions | 2.550 / 2.697 |
| product | boundaryOnly | definitionPreparation | 7.103 / 7.577 |
| product | boundaryOnly | lifecycleAcceptance | 1.257 / 1.326 |
| product | boundaryOnly | lockedAttemptAcceptance | 3.171 / 7.204 |
| product | boundaryOnly | participantProof | 30.779 / 34.418 |
| product | boundaryOnly | occProof | 0.793 / 1.035 |
| product | boundaryOnly | priorDocuments | 0.550 / 0.591 |
| product | boundaryOnly | developerIndexPreparation | 4.286 / 4.895 |
| product | boundaryOnly | uniquePreparation | 0.888 / 1.017 |
| product | boundaryOnly | relationPreparation | 0.003 / 0.005 |
| product | boundaryOnly | intrinsicMembership | 1.052 / 1.253 |
| product | boundaryOnly | rowWrites | 1.801 / 2.003 |
| product | boundaryOnly | indexWrites | 3.138 / 3.355 |
| product | boundaryOnly | uniqueWrites | 2.118 / 2.387 |
| product | boundaryOnly | coverage | 1.507 / 1.705 |
| product | boundaryOnly | searchWrites | 1.162 / 1.265 |
| product | boundaryOnly | lowering | 20.017 / 20.525 |
| product | boundaryOnly | finalReferences | 0.553 / 0.654 |
| product | boundaryOnly | clockAdvance | 0.307 / 0.345 |
| product | boundaryOnly | durablePublication | 4.333 / 4.657 |
| product | boundaryOnly | transaction | 64.222 / 66.995 |
| product | boundaryOnly | finalOutcome | 1.599 / 1.628 |
| product | boundaryOnly | publisher | 78.687 / 82.027 |
| product | detailed | request admission | 91.850 / 100.804 |
| product | detailed | Worker execution | 358.705 / 484.769 |
| product | detailed | journal seal and OCC verification | 87.507 / 97.374 |
| product | detailed | authoritative publication | 98.104 / 101.166 |
| product | detailed | commandPreparation | 3.005 / 3.325 |
| product | detailed | authorityResolution | 1.552 / 1.625 |
| product | detailed | initialOutcome | 1.352 / 1.417 |
| product | detailed | intrinsicDefinition | 2.151 / 2.222 |
| product | detailed | mixedDefinitions | 3.343 / 3.399 |
| product | detailed | definitionPreparation | 9.343 / 9.395 |
| product | detailed | lifecycleAcceptance | 1.988 / 2.197 |
| product | detailed | lockedAttemptAcceptance | 4.655 / 7.272 |
| product | detailed | participantProof | 37.524 / 39.898 |
| product | detailed | occProof | 0.963 / 1.011 |
| product | detailed | priorDocuments | 0.697 / 0.736 |
| product | detailed | developerIndexPreparation | 4.900 / 9.854 |
| product | detailed | uniquePreparation | 1.171 / 1.319 |
| product | detailed | relationPreparation | 0.004 / 0.007 |
| product | detailed | intrinsicMembership | 1.303 / 1.369 |
| product | detailed | rowWrites | 2.493 / 2.698 |
| product | detailed | indexWrites | 3.902 / 4.188 |
| product | detailed | uniqueWrites | 2.850 / 2.956 |
| product | detailed | coverage | 1.961 / 1.992 |
| product | detailed | searchWrites | 1.796 / 1.889 |
| product | detailed | lowering | 24.474 / 30.249 |
| product | detailed | finalReferences | 0.720 / 0.891 |
| product | detailed | clockAdvance | 0.450 / 0.532 |
| product | detailed | durablePublication | 6.452 / 7.427 |
| product | detailed | transaction | 80.892 / 83.175 |
| product | detailed | finalOutcome | 1.807 / 1.976 |
| product | detailed | publisher | 97.817 / 100.874 |

## Paired complete-attempt observation difference

These are sample-level detailed minus boundary-only differences for alternating pairs. They include real workload variation and diagnostic work; they are not a pure instrumentation cost.

| Profile | Matched retained pairs | Difference median / P95 ms |
| --- | ---: | --- |
| product | 5 | 89.087 / 219.756 |
| productPayload | 0 | unavailable |
| workflow | 0 | unavailable |

## Paired publisher observation difference

The genuine outer publisher region includes child gaps. It is distinct from fixture authoritative publication, which can include executor handoff work. Differences and ratios below are formed within each matched retained pair before computing distributions; child percentiles are never summed.

| Profile | Matched publisher pairs | Difference median / P95 ms | Detailed / boundary ratio median / P95 |
| --- | ---: | --- | --- |
| product | 5 | 17.492 / 22.645 | 1.218 / 1.297 |
| productPayload | 0 | unavailable | unavailable |
| workflow | 0 | unavailable | unavailable |

Per-sample raw owner intervals retain overlap and SQL intersections. Phase unions are computed within each sample; percentiles are never added or subtracted.

Original demands and actual batch observations are distinct from net committed effects. Counts and batch events describe separate levels; do not sum them. Writes are provisional until real COMMIT. Server diagnostics, when present, remain a separate charged lane with partial nested coverage; CPU and lock costs remain unavailable.

Failed samples remain in original order. Complete-attempt timings include request admission, Worker execution, seal/finishing/publication and fixture cleanup; setup is separate.
