# Publication Attribution

Complete: false; source stable: true.

Planned attempts: 6; attempted: 2; business failures: 0; invalid observations: 0. All attempted samples remain in original order, including warmups and failures.

Boundary-only includes owner phase timing. Detailed includes scalar demands and SQL tracing; neither is fully uninstrumented.

| Profile | Mode | Retained samples | Complete attempt median / P95 ms |
| --- | --- | ---: | --- |
| product | boundaryOnly | 0 | unavailable |
| product | detailed | 1 | 2118.348 / 2118.348 |
| productPayload | boundaryOnly | 0 | unavailable |
| productPayload | detailed | 0 | unavailable |
| workflow | boundaryOnly | 0 | unavailable |
| workflow | detailed | 0 | unavailable |

## Owner component intervals

| Profile | Mode | Owner region | Sample union median / P95 ms |
| --- | --- | --- | --- |
| product | detailed | request admission | 125.111 / 125.111 |
| product | detailed | Worker execution | 1524.340 / 1524.340 |
| product | detailed | journal seal and OCC verification | 188.757 / 188.757 |
| product | detailed | authoritative publication | 205.829 / 205.829 |
| product | detailed | commandPreparation | 3.607 / 3.607 |
| product | detailed | authorityResolution | 2.304 / 2.304 |
| product | detailed | initialOutcome | 1.600 / 1.600 |
| product | detailed | intrinsicDefinition | 2.618 / 2.618 |
| product | detailed | mixedDefinitions | 4.133 / 4.133 |
| product | detailed | definitionPreparation | 11.229 / 11.229 |
| product | detailed | lifecycleAcceptance | 2.490 / 2.490 |
| product | detailed | lockedAttemptAcceptance | 6.277 / 6.277 |
| product | detailed | participantProof | 41.487 / 41.487 |
| product | detailed | occProof | 1.669 / 1.669 |
| product | detailed | priorDocuments | 1.141 / 1.141 |
| product | detailed | developerIndexPreparation | 5.644 / 5.644 |
| product | detailed | uniquePreparation | 1.711 / 1.711 |
| product | detailed | relationPreparation | 0.005 / 0.005 |
| product | detailed | intrinsicMembership | 1.550 / 1.550 |
| product | detailed | rowWrites | 3.353 / 3.353 |
| product | detailed | indexWrites | 4.995 / 4.995 |
| product | detailed | uniqueWrites | 3.420 / 3.420 |
| product | detailed | coverage | 2.316 / 2.316 |
| product | detailed | searchWrites | 2.327 / 2.327 |
| product | detailed | lowering | 31.336 / 31.336 |
| product | detailed | finalReferences | 0.826 / 0.826 |
| product | detailed | clockAdvance | 0.667 / 0.667 |
| product | detailed | durablePublication | 9.829 / 9.829 |
| product | detailed | transaction | 97.781 / 97.781 |
| product | detailed | finalOutcome | 2.385 / 2.385 |
| product | detailed | publisher | 119.065 / 119.065 |

## Paired complete-attempt observation difference

These are sample-level detailed minus boundary-only differences for alternating pairs. They include real workload variation and diagnostic work; they are not a pure instrumentation cost.

| Profile | Matched retained pairs | Difference median / P95 ms |
| --- | ---: | --- |
| product | 0 | unavailable |
| productPayload | 0 | unavailable |
| workflow | 0 | unavailable |

## Paired publisher observation difference

The genuine outer publisher region includes child gaps. It is distinct from fixture authoritative publication, which can include executor handoff work. Differences and ratios below are formed within each matched retained pair before computing distributions; child percentiles are never summed.

| Profile | Matched publisher pairs | Difference median / P95 ms | Detailed / boundary ratio median / P95 |
| --- | ---: | --- | --- |
| product | 0 | unavailable | unavailable |
| productPayload | 0 | unavailable | unavailable |
| workflow | 0 | unavailable | unavailable |

Per-sample raw owner intervals retain overlap and SQL intersections. Phase unions are computed within each sample; percentiles are never added or subtracted.

Original demands and actual batch observations are distinct from net committed effects. Counts and batch events describe separate levels; do not sum them. Writes are provisional until real COMMIT. Server diagnostics, when present, remain a separate charged lane with partial nested coverage; CPU and lock costs remain unavailable.

Failed samples remain in original order. Complete-attempt timings include request admission, Worker execution, seal/finishing/publication and fixture cleanup; setup is separate.
