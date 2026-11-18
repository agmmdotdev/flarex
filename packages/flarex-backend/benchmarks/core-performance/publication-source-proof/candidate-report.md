# Publication Attribution

Complete: true; source stable: true.

Planned attempts: 36; attempted: 36; business failures: 0; invalid observations: 0. All attempted samples remain in original order, including warmups and failures.

Boundary-only includes owner phase timing. Detailed includes scalar demands and SQL tracing; neither is fully uninstrumented.

| Profile | Mode | Retained samples | Complete attempt median / P95 ms |
| --- | --- | ---: | --- |
| product | boundaryOnly | 5 | 559.317 / 568.547 |
| product | detailed | 5 | 629.912 / 696.958 |
| productPayload | boundaryOnly | 5 | 594.831 / 599.277 |
| productPayload | detailed | 5 | 678.000 / 703.591 |
| workflow | boundaryOnly | 5 | 1258.172 / 1330.316 |
| workflow | detailed | 5 | 1295.980 / 1478.198 |

## Owner component intervals

| Profile | Mode | Owner region | Sample union median / P95 ms |
| --- | --- | --- | --- |
| product | boundaryOnly | request admission | 74.608 / 77.369 |
| product | boundaryOnly | Worker execution | 324.313 / 327.380 |
| product | boundaryOnly | journal seal and OCC verification | 74.138 / 78.474 |
| product | boundaryOnly | authoritative publication | 83.869 / 90.297 |
| product | boundaryOnly | commandPreparation | 3.551 / 6.294 |
| product | boundaryOnly | authorityResolution | 1.411 / 1.628 |
| product | boundaryOnly | initialOutcome | 1.066 / 1.312 |
| product | boundaryOnly | intrinsicDefinition | 1.659 / 1.877 |
| product | boundaryOnly | mixedDefinitions | 2.512 / 2.864 |
| product | boundaryOnly | definitionPreparation | 7.276 / 8.214 |
| product | boundaryOnly | lifecycleAcceptance | 1.451 / 4.678 |
| product | boundaryOnly | lockedAttemptAcceptance | 3.345 / 3.431 |
| product | boundaryOnly | participantProof | 32.674 / 36.183 |
| product | boundaryOnly | occProof | 0.704 / 1.040 |
| product | boundaryOnly | priorDocuments | 0.557 / 0.598 |
| product | boundaryOnly | developerIndexPreparation | 4.550 / 5.338 |
| product | boundaryOnly | uniquePreparation | 1.089 / 1.436 |
| product | boundaryOnly | relationPreparation | 0.005 / 0.014 |
| product | boundaryOnly | intrinsicMembership | 1.104 / 1.355 |
| product | boundaryOnly | rowWrites | 1.816 / 2.333 |
| product | boundaryOnly | indexWrites | 3.356 / 3.644 |
| product | boundaryOnly | uniqueWrites | 2.238 / 2.561 |
| product | boundaryOnly | coverage | 1.590 / 1.655 |
| product | boundaryOnly | searchWrites | 1.284 / 1.526 |
| product | boundaryOnly | lowering | 20.403 / 23.915 |
| product | boundaryOnly | finalReferences | 0.561 / 0.775 |
| product | boundaryOnly | clockAdvance | 0.304 / 0.408 |
| product | boundaryOnly | durablePublication | 4.571 / 5.742 |
| product | boundaryOnly | transaction | 68.631 / 73.997 |
| product | boundaryOnly | finalOutcome | 1.615 / 2.207 |
| product | boundaryOnly | publisher | 83.605 / 90.002 |
| product | detailed | request admission | 92.072 / 110.395 |
| product | detailed | Worker execution | 355.475 / 382.826 |
| product | detailed | journal seal and OCC verification | 87.015 / 98.576 |
| product | detailed | authoritative publication | 101.550 / 103.833 |
| product | detailed | commandPreparation | 3.225 / 3.263 |
| product | detailed | authorityResolution | 1.618 / 1.752 |
| product | detailed | initialOutcome | 1.331 / 1.419 |
| product | detailed | intrinsicDefinition | 2.191 / 2.540 |
| product | detailed | mixedDefinitions | 3.461 / 3.554 |
| product | detailed | definitionPreparation | 9.494 / 9.739 |
| product | detailed | lifecycleAcceptance | 1.956 / 2.047 |
| product | detailed | lockedAttemptAcceptance | 4.706 / 7.396 |
| product | detailed | participantProof | 39.981 / 41.792 |
| product | detailed | occProof | 1.035 / 1.407 |
| product | detailed | priorDocuments | 0.713 / 0.753 |
| product | detailed | developerIndexPreparation | 4.584 / 9.151 |
| product | detailed | uniquePreparation | 1.180 / 1.331 |
| product | detailed | relationPreparation | 0.004 / 0.008 |
| product | detailed | intrinsicMembership | 1.298 / 1.461 |
| product | detailed | rowWrites | 2.591 / 2.697 |
| product | detailed | indexWrites | 4.346 / 4.480 |
| product | detailed | uniqueWrites | 2.999 / 3.084 |
| product | detailed | coverage | 1.979 / 2.081 |
| product | detailed | searchWrites | 1.800 / 1.940 |
| product | detailed | lowering | 25.393 / 30.072 |
| product | detailed | finalReferences | 0.720 / 0.728 |
| product | detailed | clockAdvance | 0.446 / 0.484 |
| product | detailed | durablePublication | 6.506 / 7.385 |
| product | detailed | transaction | 83.612 / 85.717 |
| product | detailed | finalOutcome | 1.839 / 1.891 |
| product | detailed | publisher | 101.203 / 103.539 |
| productPayload | boundaryOnly | request admission | 74.076 / 77.221 |
| productPayload | boundaryOnly | Worker execution | 351.686 / 353.508 |
| productPayload | boundaryOnly | journal seal and OCC verification | 82.711 / 84.955 |
| productPayload | boundaryOnly | authoritative publication | 86.340 / 87.439 |
| productPayload | boundaryOnly | commandPreparation | 3.907 / 4.330 |
| productPayload | boundaryOnly | authorityResolution | 1.053 / 1.102 |
| productPayload | boundaryOnly | initialOutcome | 1.017 / 1.035 |
| productPayload | boundaryOnly | intrinsicDefinition | 2.198 / 2.873 |
| productPayload | boundaryOnly | mixedDefinitions | 2.355 / 2.643 |
| productPayload | boundaryOnly | definitionPreparation | 7.758 / 8.279 |
| productPayload | boundaryOnly | lifecycleAcceptance | 1.216 / 1.346 |
| productPayload | boundaryOnly | lockedAttemptAcceptance | 3.199 / 3.515 |
| productPayload | boundaryOnly | participantProof | 35.277 / 36.670 |
| productPayload | boundaryOnly | occProof | 0.719 / 0.722 |
| productPayload | boundaryOnly | priorDocuments | 0.519 / 0.536 |
| productPayload | boundaryOnly | developerIndexPreparation | 4.507 / 7.668 |
| productPayload | boundaryOnly | uniquePreparation | 0.957 / 1.157 |
| productPayload | boundaryOnly | relationPreparation | 0.003 / 0.004 |
| productPayload | boundaryOnly | intrinsicMembership | 1.228 / 1.490 |
| productPayload | boundaryOnly | rowWrites | 2.015 / 2.210 |
| productPayload | boundaryOnly | indexWrites | 3.950 / 4.127 |
| productPayload | boundaryOnly | uniqueWrites | 2.557 / 5.621 |
| productPayload | boundaryOnly | coverage | 1.703 / 1.842 |
| productPayload | boundaryOnly | searchWrites | 1.171 / 1.409 |
| productPayload | boundaryOnly | lowering | 23.210 / 25.910 |
| productPayload | boundaryOnly | finalReferences | 0.540 / 0.559 |
| productPayload | boundaryOnly | clockAdvance | 0.300 / 0.305 |
| productPayload | boundaryOnly | durablePublication | 4.390 / 4.664 |
| productPayload | boundaryOnly | transaction | 70.736 / 71.452 |
| productPayload | boundaryOnly | finalOutcome | 1.600 / 1.701 |
| productPayload | boundaryOnly | publisher | 86.059 / 87.166 |
| productPayload | detailed | request admission | 89.950 / 92.186 |
| productPayload | detailed | Worker execution | 384.615 / 410.933 |
| productPayload | detailed | journal seal and OCC verification | 96.116 / 98.371 |
| productPayload | detailed | authoritative publication | 104.773 / 107.970 |
| productPayload | detailed | commandPreparation | 3.797 / 4.595 |
| productPayload | detailed | authorityResolution | 1.615 / 5.168 |
| productPayload | detailed | initialOutcome | 1.366 / 1.458 |
| productPayload | detailed | intrinsicDefinition | 3.102 / 3.303 |
| productPayload | detailed | mixedDefinitions | 3.379 / 3.470 |
| productPayload | detailed | definitionPreparation | 10.286 / 10.506 |
| productPayload | detailed | lifecycleAcceptance | 1.911 / 1.952 |
| productPayload | detailed | lockedAttemptAcceptance | 4.671 / 7.711 |
| productPayload | detailed | participantProof | 38.780 / 42.797 |
| productPayload | detailed | occProof | 1.007 / 1.123 |
| productPayload | detailed | priorDocuments | 0.679 / 0.829 |
| productPayload | detailed | developerIndexPreparation | 4.821 / 5.271 |
| productPayload | detailed | uniquePreparation | 1.209 / 1.339 |
| productPayload | detailed | relationPreparation | 0.004 / 0.004 |
| productPayload | detailed | intrinsicMembership | 1.523 / 4.721 |
| productPayload | detailed | rowWrites | 2.604 / 3.124 |
| productPayload | detailed | indexWrites | 4.547 / 4.705 |
| productPayload | detailed | uniqueWrites | 3.251 / 3.298 |
| productPayload | detailed | coverage | 2.147 / 2.241 |
| productPayload | detailed | searchWrites | 1.698 / 1.721 |
| productPayload | detailed | lowering | 26.611 / 30.493 |
| productPayload | detailed | finalReferences | 0.691 / 0.873 |
| productPayload | detailed | clockAdvance | 0.456 / 0.533 |
| productPayload | detailed | durablePublication | 6.207 / 7.662 |
| productPayload | detailed | transaction | 84.955 / 88.013 |
| productPayload | detailed | finalOutcome | 1.915 / 1.947 |
| productPayload | detailed | publisher | 104.462 / 107.655 |
| workflow | boundaryOnly | request admission | 77.975 / 108.711 |
| workflow | boundaryOnly | Worker execution | 884.140 / 986.067 |
| workflow | boundaryOnly | journal seal and OCC verification | 109.472 / 146.931 |
| workflow | boundaryOnly | authoritative publication | 159.238 / 165.927 |
| workflow | boundaryOnly | commandPreparation | 6.792 / 9.286 |
| workflow | boundaryOnly | authorityResolution | 1.267 / 1.404 |
| workflow | boundaryOnly | initialOutcome | 1.079 / 1.176 |
| workflow | boundaryOnly | intrinsicDefinition | 6.412 / 6.688 |
| workflow | boundaryOnly | mixedDefinitions | 2.528 / 2.609 |
| workflow | boundaryOnly | definitionPreparation | 12.050 / 12.381 |
| workflow | boundaryOnly | lifecycleAcceptance | 1.223 / 1.343 |
| workflow | boundaryOnly | lockedAttemptAcceptance | 3.773 / 3.860 |
| workflow | boundaryOnly | participantProof | 55.965 / 58.568 |
| workflow | boundaryOnly | occProof | 0.737 / 0.802 |
| workflow | boundaryOnly | priorDocuments | 0.702 / 0.776 |
| workflow | boundaryOnly | developerIndexPreparation | 12.269 / 13.039 |
| workflow | boundaryOnly | uniquePreparation | 1.914 / 2.048 |
| workflow | boundaryOnly | relationPreparation | 0.005 / 0.005 |
| workflow | boundaryOnly | intrinsicMembership | 2.654 / 4.869 |
| workflow | boundaryOnly | rowWrites | 3.049 / 3.452 |
| workflow | boundaryOnly | indexWrites | 17.554 / 18.052 |
| workflow | boundaryOnly | uniqueWrites | 4.827 / 7.432 |
| workflow | boundaryOnly | coverage | 5.899 / 8.034 |
| workflow | boundaryOnly | searchWrites | 3.204 / 3.650 |
| workflow | boundaryOnly | lowering | 59.032 / 60.574 |
| workflow | boundaryOnly | finalReferences | 0.577 / 0.593 |
| workflow | boundaryOnly | clockAdvance | 0.306 / 0.332 |
| workflow | boundaryOnly | durablePublication | 5.968 / 6.942 |
| workflow | boundaryOnly | transaction | 132.903 / 142.662 |
| workflow | boundaryOnly | finalOutcome | 2.129 / 2.473 |
| workflow | boundaryOnly | publisher | 158.843 / 165.496 |
| workflow | detailed | request admission | 101.827 / 116.774 |
| workflow | detailed | Worker execution | 885.669 / 952.936 |
| workflow | detailed | journal seal and OCC verification | 122.696 / 160.895 |
| workflow | detailed | authoritative publication | 186.997 / 301.684 |
| workflow | detailed | commandPreparation | 6.780 / 9.309 |
| workflow | detailed | authorityResolution | 1.881 / 2.033 |
| workflow | detailed | initialOutcome | 1.425 / 1.611 |
| workflow | detailed | intrinsicDefinition | 8.960 / 9.552 |
| workflow | detailed | mixedDefinitions | 3.534 / 3.783 |
| workflow | detailed | definitionPreparation | 16.372 / 17.994 |
| workflow | detailed | lifecycleAcceptance | 1.954 / 2.002 |
| workflow | detailed | lockedAttemptAcceptance | 5.237 / 5.447 |
| workflow | detailed | participantProof | 65.991 / 68.350 |
| workflow | detailed | occProof | 1.040 / 1.099 |
| workflow | detailed | priorDocuments | 0.915 / 0.981 |
| workflow | detailed | developerIndexPreparation | 12.545 / 12.863 |
| workflow | detailed | uniquePreparation | 2.294 / 2.693 |
| workflow | detailed | relationPreparation | 0.004 / 0.004 |
| workflow | detailed | intrinsicMembership | 2.862 / 2.957 |
| workflow | detailed | rowWrites | 3.808 / 4.084 |
| workflow | detailed | indexWrites | 19.496 / 20.541 |
| workflow | detailed | uniqueWrites | 6.158 / 7.570 |
| workflow | detailed | coverage | 6.731 / 6.972 |
| workflow | detailed | searchWrites | 4.869 / 6.962 |
| workflow | detailed | lowering | 66.284 / 68.137 |
| workflow | detailed | finalReferences | 0.748 / 0.792 |
| workflow | detailed | clockAdvance | 0.447 / 0.570 |
| workflow | detailed | durablePublication | 7.903 / 8.935 |
| workflow | detailed | transaction | 156.348 / 269.502 |
| workflow | detailed | finalOutcome | 1.997 / 2.660 |
| workflow | detailed | publisher | 186.473 / 301.247 |

## Paired complete-attempt observation difference

These are sample-level detailed minus boundary-only differences for alternating pairs. They include real workload variation and diagnostic work; they are not a pure instrumentation cost.

| Profile | Matched retained pairs | Difference median / P95 ms |
| --- | ---: | --- |
| product | 5 | 90.326 / 128.412 |
| productPayload | 5 | 83.169 / 104.315 |
| workflow | 5 | 124.218 / 179.038 |

## Paired publisher observation difference

The genuine outer publisher region includes child gaps. It is distinct from fixture authoritative publication, which can include executor handoff work. Differences and ratios below are formed within each matched retained pair before computing distributions; child percentiles are never summed.

| Profile | Matched publisher pairs | Difference median / P95 ms | Detailed / boundary ratio median / P95 |
| --- | ---: | --- | --- |
| product | 5 | 16.178 / 23.146 | 1.193 / 1.288 |
| productPayload | 5 | 18.281 / 22.707 | 1.214 / 1.267 |
| workflow | 5 | 29.619 / 142.404 | 1.180 / 1.897 |

Per-sample raw owner intervals retain overlap and SQL intersections. Phase unions are computed within each sample; percentiles are never added or subtracted.

Original demands and actual batch observations are distinct from net committed effects. Counts and batch events describe separate levels; do not sum them. Writes are provisional until real COMMIT. Server diagnostics, when present, remain a separate charged lane with partial nested coverage; CPU and lock costs remain unavailable.

Failed samples remain in original order. Complete-attempt timings include request admission, Worker execution, seal/finishing/publication and fixture cleanup; setup is separate.
