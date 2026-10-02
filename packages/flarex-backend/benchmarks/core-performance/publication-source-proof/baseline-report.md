# Publication Attribution

Complete: true; source stable: true.

Planned attempts: 36; attempted: 36; business failures: 0; invalid observations: 0. All attempted samples remain in original order, including warmups and failures.

Boundary-only includes owner phase timing. Detailed includes scalar demands and SQL tracing; neither is fully uninstrumented.

| Profile | Mode | Retained samples | Complete attempt median / P95 ms |
| --- | --- | ---: | --- |
| product | boundaryOnly | 5 | 539.726 / 551.493 |
| product | detailed | 5 | 664.691 / 717.226 |
| productPayload | boundaryOnly | 5 | 593.145 / 833.583 |
| productPayload | detailed | 5 | 676.868 / 710.156 |
| workflow | boundaryOnly | 5 | 949.270 / 989.878 |
| workflow | detailed | 5 | 1116.840 / 1185.713 |

## Owner component intervals

| Profile | Mode | Owner region | Sample union median / P95 ms |
| --- | --- | --- | --- |
| product | boundaryOnly | request admission | 72.040 / 75.065 |
| product | boundaryOnly | Worker execution | 316.306 / 323.994 |
| product | boundaryOnly | journal seal and OCC verification | 71.520 / 75.226 |
| product | boundaryOnly | authoritative publication | 81.059 / 81.868 |
| product | boundaryOnly | commandPreparation | 3.308 / 3.613 |
| product | boundaryOnly | authorityResolution | 1.244 / 1.361 |
| product | boundaryOnly | initialOutcome | 1.150 / 1.193 |
| product | boundaryOnly | intrinsicDefinition | 1.649 / 4.708 |
| product | boundaryOnly | mixedDefinitions | 2.443 / 2.632 |
| product | boundaryOnly | definitionPreparation | 7.120 / 10.448 |
| product | boundaryOnly | lifecycleAcceptance | 1.267 / 1.452 |
| product | boundaryOnly | lockedAttemptAcceptance | 3.172 / 5.675 |
| product | boundaryOnly | participantProof | 31.093 / 33.982 |
| product | boundaryOnly | occProof | 0.710 / 0.783 |
| product | boundaryOnly | priorDocuments | 0.523 / 1.037 |
| product | boundaryOnly | developerIndexPreparation | 4.502 / 4.634 |
| product | boundaryOnly | uniquePreparation | 0.934 / 1.064 |
| product | boundaryOnly | relationPreparation | 0.003 / 0.011 |
| product | boundaryOnly | intrinsicMembership | 1.146 / 1.349 |
| product | boundaryOnly | rowWrites | 1.836 / 2.069 |
| product | boundaryOnly | indexWrites | 3.147 / 3.511 |
| product | boundaryOnly | uniqueWrites | 2.162 / 2.592 |
| product | boundaryOnly | coverage | 1.473 / 1.569 |
| product | boundaryOnly | searchWrites | 1.205 / 1.488 |
| product | boundaryOnly | lowering | 20.497 / 21.544 |
| product | boundaryOnly | finalReferences | 0.549 / 0.606 |
| product | boundaryOnly | clockAdvance | 0.306 / 0.346 |
| product | boundaryOnly | durablePublication | 4.335 / 5.194 |
| product | boundaryOnly | transaction | 65.369 / 66.624 |
| product | boundaryOnly | finalOutcome | 1.589 / 1.707 |
| product | boundaryOnly | publisher | 80.790 / 81.527 |
| product | detailed | request admission | 93.713 / 103.010 |
| product | detailed | Worker execution | 370.127 / 419.773 |
| product | detailed | journal seal and OCC verification | 93.037 / 96.240 |
| product | detailed | authoritative publication | 100.047 / 106.485 |
| product | detailed | commandPreparation | 3.180 / 3.327 |
| product | detailed | authorityResolution | 1.624 / 1.882 |
| product | detailed | initialOutcome | 1.409 / 1.500 |
| product | detailed | intrinsicDefinition | 2.230 / 2.448 |
| product | detailed | mixedDefinitions | 3.506 / 4.105 |
| product | detailed | definitionPreparation | 9.965 / 10.621 |
| product | detailed | lifecycleAcceptance | 2.011 / 2.074 |
| product | detailed | lockedAttemptAcceptance | 4.903 / 7.774 |
| product | detailed | participantProof | 37.947 / 43.080 |
| product | detailed | occProof | 1.013 / 1.266 |
| product | detailed | priorDocuments | 0.714 / 0.954 |
| product | detailed | developerIndexPreparation | 4.732 / 8.269 |
| product | detailed | uniquePreparation | 1.172 / 1.536 |
| product | detailed | relationPreparation | 0.004 / 0.006 |
| product | detailed | intrinsicMembership | 1.354 / 1.480 |
| product | detailed | rowWrites | 2.528 / 2.697 |
| product | detailed | indexWrites | 4.027 / 4.425 |
| product | detailed | uniqueWrites | 2.936 / 3.361 |
| product | detailed | coverage | 2.094 / 2.396 |
| product | detailed | searchWrites | 1.816 / 1.863 |
| product | detailed | lowering | 25.995 / 28.611 |
| product | detailed | finalReferences | 0.713 / 0.796 |
| product | detailed | clockAdvance | 0.447 / 0.467 |
| product | detailed | durablePublication | 6.190 / 7.305 |
| product | detailed | transaction | 81.831 / 87.523 |
| product | detailed | finalOutcome | 1.859 / 1.992 |
| product | detailed | publisher | 99.732 / 106.173 |
| productPayload | boundaryOnly | request admission | 72.576 / 269.336 |
| productPayload | boundaryOnly | Worker execution | 344.665 / 395.689 |
| productPayload | boundaryOnly | journal seal and OCC verification | 81.617 / 90.673 |
| productPayload | boundaryOnly | authoritative publication | 86.639 / 94.912 |
| productPayload | boundaryOnly | commandPreparation | 3.839 / 3.955 |
| productPayload | boundaryOnly | authorityResolution | 1.116 / 1.287 |
| productPayload | boundaryOnly | initialOutcome | 1.139 / 1.238 |
| productPayload | boundaryOnly | intrinsicDefinition | 2.277 / 2.471 |
| productPayload | boundaryOnly | mixedDefinitions | 2.352 / 2.514 |
| productPayload | boundaryOnly | definitionPreparation | 7.495 / 8.186 |
| productPayload | boundaryOnly | lifecycleAcceptance | 1.231 / 1.290 |
| productPayload | boundaryOnly | lockedAttemptAcceptance | 3.219 / 3.650 |
| productPayload | boundaryOnly | participantProof | 36.638 / 37.198 |
| productPayload | boundaryOnly | occProof | 0.731 / 0.799 |
| productPayload | boundaryOnly | priorDocuments | 0.521 / 0.553 |
| productPayload | boundaryOnly | developerIndexPreparation | 4.557 / 4.636 |
| productPayload | boundaryOnly | uniquePreparation | 1.016 / 1.048 |
| productPayload | boundaryOnly | relationPreparation | 0.003 / 0.004 |
| productPayload | boundaryOnly | intrinsicMembership | 1.284 / 1.340 |
| productPayload | boundaryOnly | rowWrites | 2.131 / 2.486 |
| productPayload | boundaryOnly | indexWrites | 4.103 / 4.303 |
| productPayload | boundaryOnly | uniqueWrites | 2.604 / 2.705 |
| productPayload | boundaryOnly | coverage | 1.652 / 1.670 |
| productPayload | boundaryOnly | searchWrites | 1.165 / 1.282 |
| productPayload | boundaryOnly | lowering | 22.230 / 22.246 |
| productPayload | boundaryOnly | finalReferences | 0.565 / 0.633 |
| productPayload | boundaryOnly | clockAdvance | 0.314 / 0.432 |
| productPayload | boundaryOnly | durablePublication | 4.516 / 4.840 |
| productPayload | boundaryOnly | transaction | 71.240 / 78.995 |
| productPayload | boundaryOnly | finalOutcome | 1.636 / 1.973 |
| productPayload | boundaryOnly | publisher | 86.369 / 94.637 |
| productPayload | detailed | request admission | 90.288 / 95.011 |
| productPayload | detailed | Worker execution | 379.883 / 410.438 |
| productPayload | detailed | journal seal and OCC verification | 97.841 / 101.305 |
| productPayload | detailed | authoritative publication | 107.640 / 110.990 |
| productPayload | detailed | commandPreparation | 3.886 / 4.053 |
| productPayload | detailed | authorityResolution | 1.648 / 1.889 |
| productPayload | detailed | initialOutcome | 1.344 / 1.362 |
| productPayload | detailed | intrinsicDefinition | 3.067 / 3.232 |
| productPayload | detailed | mixedDefinitions | 3.518 / 6.189 |
| productPayload | detailed | definitionPreparation | 10.306 / 13.118 |
| productPayload | detailed | lifecycleAcceptance | 2.105 / 2.431 |
| productPayload | detailed | lockedAttemptAcceptance | 4.805 / 4.975 |
| productPayload | detailed | participantProof | 41.503 / 43.331 |
| productPayload | detailed | occProof | 0.955 / 1.057 |
| productPayload | detailed | priorDocuments | 0.676 / 0.717 |
| productPayload | detailed | developerIndexPreparation | 4.745 / 4.886 |
| productPayload | detailed | uniquePreparation | 1.174 / 1.176 |
| productPayload | detailed | relationPreparation | 0.003 / 0.004 |
| productPayload | detailed | intrinsicMembership | 1.556 / 1.771 |
| productPayload | detailed | rowWrites | 2.616 / 2.708 |
| productPayload | detailed | indexWrites | 4.558 / 5.095 |
| productPayload | detailed | uniqueWrites | 3.379 / 6.197 |
| productPayload | detailed | coverage | 2.174 / 2.693 |
| productPayload | detailed | searchWrites | 1.776 / 2.351 |
| productPayload | detailed | lowering | 29.027 / 30.086 |
| productPayload | detailed | finalReferences | 0.729 / 0.861 |
| productPayload | detailed | clockAdvance | 0.448 / 0.554 |
| productPayload | detailed | durablePublication | 6.436 / 9.318 |
| productPayload | detailed | transaction | 88.221 / 88.670 |
| productPayload | detailed | finalOutcome | 1.834 / 2.077 |
| productPayload | detailed | publisher | 107.347 / 110.700 |
| workflow | boundaryOnly | request admission | 74.662 / 80.973 |
| workflow | boundaryOnly | Worker execution | 619.838 / 648.306 |
| workflow | boundaryOnly | journal seal and OCC verification | 103.933 / 106.046 |
| workflow | boundaryOnly | authoritative publication | 152.375 / 154.550 |
| workflow | boundaryOnly | commandPreparation | 6.628 / 10.205 |
| workflow | boundaryOnly | authorityResolution | 1.252 / 1.508 |
| workflow | boundaryOnly | initialOutcome | 1.085 / 1.126 |
| workflow | boundaryOnly | intrinsicDefinition | 6.575 / 6.636 |
| workflow | boundaryOnly | mixedDefinitions | 2.628 / 2.703 |
| workflow | boundaryOnly | definitionPreparation | 12.485 / 15.371 |
| workflow | boundaryOnly | lifecycleAcceptance | 1.228 / 1.345 |
| workflow | boundaryOnly | lockedAttemptAcceptance | 3.797 / 4.023 |
| workflow | boundaryOnly | participantProof | 55.722 / 60.806 |
| workflow | boundaryOnly | occProof | 0.726 / 0.769 |
| workflow | boundaryOnly | priorDocuments | 0.905 / 0.939 |
| workflow | boundaryOnly | developerIndexPreparation | 12.383 / 13.425 |
| workflow | boundaryOnly | uniquePreparation | 1.936 / 2.246 |
| workflow | boundaryOnly | relationPreparation | 0.004 / 0.005 |
| workflow | boundaryOnly | intrinsicMembership | 2.545 / 2.626 |
| workflow | boundaryOnly | rowWrites | 2.796 / 3.173 |
| workflow | boundaryOnly | indexWrites | 16.510 / 16.853 |
| workflow | boundaryOnly | uniqueWrites | 4.834 / 5.091 |
| workflow | boundaryOnly | coverage | 5.437 / 5.672 |
| workflow | boundaryOnly | searchWrites | 3.078 / 3.266 |
| workflow | boundaryOnly | lowering | 55.106 / 56.947 |
| workflow | boundaryOnly | finalReferences | 0.573 / 0.649 |
| workflow | boundaryOnly | clockAdvance | 0.307 / 0.337 |
| workflow | boundaryOnly | durablePublication | 5.728 / 6.856 |
| workflow | boundaryOnly | transaction | 125.200 / 131.527 |
| workflow | boundaryOnly | finalOutcome | 1.644 / 1.676 |
| workflow | boundaryOnly | publisher | 151.933 / 154.112 |
| workflow | detailed | request admission | 90.525 / 105.573 |
| workflow | detailed | Worker execution | 725.108 / 774.457 |
| workflow | detailed | journal seal and OCC verification | 117.773 / 120.766 |
| workflow | detailed | authoritative publication | 183.567 / 185.557 |
| workflow | detailed | commandPreparation | 6.979 / 7.488 |
| workflow | detailed | authorityResolution | 1.696 / 1.786 |
| workflow | detailed | initialOutcome | 1.343 / 3.370 |
| workflow | detailed | intrinsicDefinition | 9.219 / 9.802 |
| workflow | detailed | mixedDefinitions | 3.546 / 3.764 |
| workflow | detailed | definitionPreparation | 17.318 / 20.304 |
| workflow | detailed | lifecycleAcceptance | 1.942 / 2.135 |
| workflow | detailed | lockedAttemptAcceptance | 5.671 / 6.192 |
| workflow | detailed | participantProof | 66.601 / 67.556 |
| workflow | detailed | occProof | 0.996 / 1.411 |
| workflow | detailed | priorDocuments | 1.078 / 1.170 |
| workflow | detailed | developerIndexPreparation | 12.929 / 14.427 |
| workflow | detailed | uniquePreparation | 2.191 / 2.480 |
| workflow | detailed | relationPreparation | 0.004 / 0.005 |
| workflow | detailed | intrinsicMembership | 2.932 / 3.290 |
| workflow | detailed | rowWrites | 3.583 / 4.511 |
| workflow | detailed | indexWrites | 19.095 / 20.755 |
| workflow | detailed | uniqueWrites | 5.794 / 6.086 |
| workflow | detailed | coverage | 6.727 / 8.250 |
| workflow | detailed | searchWrites | 4.779 / 6.664 |
| workflow | detailed | lowering | 66.459 / 68.727 |
| workflow | detailed | finalReferences | 0.785 / 2.391 |
| workflow | detailed | clockAdvance | 0.468 / 0.637 |
| workflow | detailed | durablePublication | 7.818 / 9.219 |
| workflow | detailed | transaction | 152.943 / 155.774 |
| workflow | detailed | finalOutcome | 1.877 / 1.914 |
| workflow | detailed | publisher | 183.100 / 185.099 |

## Paired complete-attempt observation difference

These are sample-level detailed minus boundary-only differences for alternating pairs. They include real workload variation and diagnostic work; they are not a pure instrumentation cost.

| Profile | Matched retained pairs | Difference median / P95 ms |
| --- | ---: | --- |
| product | 5 | 119.728 / 168.869 |
| productPayload | 5 | 91.011 / 103.847 |
| workflow | 5 | 167.570 / 197.339 |

## Paired publisher observation difference

The genuine outer publisher region includes child gaps. It is distinct from fixture authoritative publication, which can include executor handoff work. Differences and ratios below are formed within each matched retained pair before computing distributions; child percentiles are never summed.

| Profile | Matched publisher pairs | Difference median / P95 ms | Detailed / boundary ratio median / P95 |
| --- | ---: | --- | --- |
| product | 5 | 18.942 / 29.109 | 1.234 / 1.378 |
| productPayload | 5 | 22.809 / 24.330 | 1.265 / 1.282 |
| workflow | 5 | 31.166 / 34.370 | 1.205 / 1.228 |

Per-sample raw owner intervals retain overlap and SQL intersections. Phase unions are computed within each sample; percentiles are never added or subtracted.

Original demands and actual batch observations are distinct from net committed effects. Counts and batch events describe separate levels; do not sum them. Writes are provisional until real COMMIT. Server diagnostics, when present, remain a separate charged lane with partial nested coverage; CPU and lock costs remain unavailable.

Failed samples remain in original order. Complete-attempt timings include request admission, Worker execution, seal/finishing/publication and fixture cleanup; setup is separate.
