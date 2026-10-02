# Publication Attribution

Complete: true; source stable: true.

Planned attempts: 36; attempted: 36; business failures: 0; invalid observations: 0. All attempted samples remain in original order, including warmups and failures.

Boundary-only includes owner phase timing. Detailed includes scalar demands and SQL tracing; neither is fully uninstrumented.

| Profile | Mode | Retained samples | Complete attempt median / P95 ms |
| --- | --- | ---: | --- |
| product | boundaryOnly | 5 | 544.146 / 569.444 |
| product | detailed | 5 | 628.162 / 668.695 |
| productPayload | boundaryOnly | 5 | 579.620 / 612.558 |
| productPayload | detailed | 5 | 666.926 / 685.361 |
| workflow | boundaryOnly | 5 | 932.925 / 986.198 |
| workflow | detailed | 5 | 1103.577 / 1154.041 |

## Owner component intervals

| Profile | Mode | Owner region | Sample union median / P95 ms |
| --- | --- | --- | --- |
| product | boundaryOnly | request admission | 71.640 / 73.889 |
| product | boundaryOnly | Worker execution | 320.936 / 337.886 |
| product | boundaryOnly | journal seal and OCC verification | 71.889 / 74.757 |
| product | boundaryOnly | authoritative publication | 78.913 / 88.535 |
| product | boundaryOnly | commandPreparation | 3.140 / 3.316 |
| product | boundaryOnly | authorityResolution | 1.329 / 1.524 |
| product | boundaryOnly | initialOutcome | 1.167 / 1.313 |
| product | boundaryOnly | intrinsicDefinition | 1.618 / 6.021 |
| product | boundaryOnly | mixedDefinitions | 2.634 / 3.584 |
| product | boundaryOnly | definitionPreparation | 7.108 / 13.071 |
| product | boundaryOnly | lifecycleAcceptance | 1.245 / 1.476 |
| product | boundaryOnly | lockedAttemptAcceptance | 3.155 / 3.491 |
| product | boundaryOnly | participantProof | 32.371 / 33.965 |
| product | boundaryOnly | occProof | 0.776 / 0.813 |
| product | boundaryOnly | priorDocuments | 0.549 / 0.600 |
| product | boundaryOnly | developerIndexPreparation | 4.447 / 7.420 |
| product | boundaryOnly | uniquePreparation | 0.955 / 0.987 |
| product | boundaryOnly | relationPreparation | 0.003 / 0.005 |
| product | boundaryOnly | intrinsicMembership | 1.055 / 1.089 |
| product | boundaryOnly | rowWrites | 1.779 / 2.194 |
| product | boundaryOnly | indexWrites | 3.087 / 3.325 |
| product | boundaryOnly | uniqueWrites | 2.045 / 2.581 |
| product | boundaryOnly | coverage | 1.498 / 1.583 |
| product | boundaryOnly | searchWrites | 1.153 / 1.367 |
| product | boundaryOnly | lowering | 19.738 / 23.002 |
| product | boundaryOnly | finalReferences | 0.601 / 0.743 |
| product | boundaryOnly | clockAdvance | 0.324 / 0.409 |
| product | boundaryOnly | durablePublication | 4.502 / 5.188 |
| product | boundaryOnly | transaction | 64.126 / 67.209 |
| product | boundaryOnly | finalOutcome | 1.644 / 2.030 |
| product | boundaryOnly | publisher | 78.592 / 88.219 |
| product | detailed | request admission | 90.652 / 99.604 |
| product | detailed | Worker execution | 355.957 / 369.734 |
| product | detailed | journal seal and OCC verification | 88.130 / 97.627 |
| product | detailed | authoritative publication | 98.334 / 104.915 |
| product | detailed | commandPreparation | 3.178 / 3.410 |
| product | detailed | authorityResolution | 1.794 / 1.910 |
| product | detailed | initialOutcome | 1.450 / 1.456 |
| product | detailed | intrinsicDefinition | 2.231 / 5.341 |
| product | detailed | mixedDefinitions | 3.565 / 3.973 |
| product | detailed | definitionPreparation | 9.528 / 12.959 |
| product | detailed | lifecycleAcceptance | 2.116 / 2.676 |
| product | detailed | lockedAttemptAcceptance | 4.731 / 5.061 |
| product | detailed | participantProof | 37.509 / 41.170 |
| product | detailed | occProof | 0.996 / 1.085 |
| product | detailed | priorDocuments | 0.685 / 0.769 |
| product | detailed | developerIndexPreparation | 4.543 / 5.266 |
| product | detailed | uniquePreparation | 1.076 / 1.386 |
| product | detailed | relationPreparation | 0.004 / 0.006 |
| product | detailed | intrinsicMembership | 1.276 / 1.469 |
| product | detailed | rowWrites | 2.465 / 2.723 |
| product | detailed | indexWrites | 4.053 / 4.255 |
| product | detailed | uniqueWrites | 2.902 / 2.961 |
| product | detailed | coverage | 1.930 / 1.984 |
| product | detailed | searchWrites | 1.733 / 1.907 |
| product | detailed | lowering | 24.527 / 26.421 |
| product | detailed | finalReferences | 0.721 / 0.789 |
| product | detailed | clockAdvance | 0.465 / 0.485 |
| product | detailed | durablePublication | 6.349 / 7.369 |
| product | detailed | transaction | 80.181 / 84.674 |
| product | detailed | finalOutcome | 1.792 / 1.820 |
| product | detailed | publisher | 97.961 / 104.577 |
| productPayload | boundaryOnly | request admission | 73.244 / 74.159 |
| productPayload | boundaryOnly | Worker execution | 342.374 / 349.391 |
| productPayload | boundaryOnly | journal seal and OCC verification | 83.689 / 89.619 |
| productPayload | boundaryOnly | authoritative publication | 82.443 / 99.488 |
| productPayload | boundaryOnly | commandPreparation | 4.016 / 4.409 |
| productPayload | boundaryOnly | authorityResolution | 1.070 / 1.458 |
| productPayload | boundaryOnly | initialOutcome | 1.097 / 1.380 |
| productPayload | boundaryOnly | intrinsicDefinition | 2.237 / 6.815 |
| productPayload | boundaryOnly | mixedDefinitions | 2.544 / 2.877 |
| productPayload | boundaryOnly | definitionPreparation | 7.824 / 13.083 |
| productPayload | boundaryOnly | lifecycleAcceptance | 1.311 / 1.493 |
| productPayload | boundaryOnly | lockedAttemptAcceptance | 3.114 / 3.513 |
| productPayload | boundaryOnly | participantProof | 33.384 / 37.838 |
| productPayload | boundaryOnly | occProof | 0.708 / 1.083 |
| productPayload | boundaryOnly | priorDocuments | 0.539 / 0.706 |
| productPayload | boundaryOnly | developerIndexPreparation | 4.408 / 5.527 |
| productPayload | boundaryOnly | uniquePreparation | 0.942 / 1.504 |
| productPayload | boundaryOnly | relationPreparation | 0.004 / 0.006 |
| productPayload | boundaryOnly | intrinsicMembership | 1.224 / 1.878 |
| productPayload | boundaryOnly | rowWrites | 1.954 / 2.239 |
| productPayload | boundaryOnly | indexWrites | 3.794 / 4.801 |
| productPayload | boundaryOnly | uniqueWrites | 2.567 / 3.331 |
| productPayload | boundaryOnly | coverage | 1.704 / 2.069 |
| productPayload | boundaryOnly | searchWrites | 1.250 / 1.718 |
| productPayload | boundaryOnly | lowering | 21.506 / 27.914 |
| productPayload | boundaryOnly | finalReferences | 0.576 / 0.765 |
| productPayload | boundaryOnly | clockAdvance | 0.307 / 0.371 |
| productPayload | boundaryOnly | durablePublication | 4.605 / 6.328 |
| productPayload | boundaryOnly | transaction | 66.874 / 80.806 |
| productPayload | boundaryOnly | finalOutcome | 1.664 / 1.923 |
| productPayload | boundaryOnly | publisher | 82.170 / 99.155 |
| productPayload | detailed | request admission | 88.910 / 95.898 |
| productPayload | detailed | Worker execution | 376.166 / 385.478 |
| productPayload | detailed | journal seal and OCC verification | 95.120 / 99.219 |
| productPayload | detailed | authoritative publication | 105.862 / 108.563 |
| productPayload | detailed | commandPreparation | 3.965 / 4.142 |
| productPayload | detailed | authorityResolution | 1.729 / 4.482 |
| productPayload | detailed | initialOutcome | 1.397 / 1.600 |
| productPayload | detailed | intrinsicDefinition | 3.245 / 3.357 |
| productPayload | detailed | mixedDefinitions | 3.354 / 3.455 |
| productPayload | detailed | definitionPreparation | 10.188 / 10.471 |
| productPayload | detailed | lifecycleAcceptance | 1.886 / 2.121 |
| productPayload | detailed | lockedAttemptAcceptance | 4.627 / 4.874 |
| productPayload | detailed | participantProof | 38.435 / 45.774 |
| productPayload | detailed | occProof | 0.979 / 2.986 |
| productPayload | detailed | priorDocuments | 0.673 / 0.987 |
| productPayload | detailed | developerIndexPreparation | 4.689 / 4.906 |
| productPayload | detailed | uniquePreparation | 1.183 / 1.218 |
| productPayload | detailed | relationPreparation | 0.004 / 0.004 |
| productPayload | detailed | intrinsicMembership | 1.485 / 1.576 |
| productPayload | detailed | rowWrites | 2.615 / 2.676 |
| productPayload | detailed | indexWrites | 4.357 / 4.894 |
| productPayload | detailed | uniqueWrites | 3.166 / 3.337 |
| productPayload | detailed | coverage | 2.073 / 2.116 |
| productPayload | detailed | searchWrites | 1.693 / 1.814 |
| productPayload | detailed | lowering | 26.038 / 26.705 |
| productPayload | detailed | finalReferences | 0.753 / 0.763 |
| productPayload | detailed | clockAdvance | 0.444 / 0.576 |
| productPayload | detailed | durablePublication | 6.464 / 9.062 |
| productPayload | detailed | transaction | 85.954 / 88.691 |
| productPayload | detailed | finalOutcome | 1.798 / 1.818 |
| productPayload | detailed | publisher | 105.512 / 108.234 |
| workflow | boundaryOnly | request admission | 75.933 / 78.664 |
| workflow | boundaryOnly | Worker execution | 609.609 / 646.319 |
| workflow | boundaryOnly | journal seal and OCC verification | 97.713 / 105.327 |
| workflow | boundaryOnly | authoritative publication | 151.032 / 160.073 |
| workflow | boundaryOnly | commandPreparation | 6.262 / 9.140 |
| workflow | boundaryOnly | authorityResolution | 1.291 / 1.382 |
| workflow | boundaryOnly | initialOutcome | 1.064 / 1.102 |
| workflow | boundaryOnly | intrinsicDefinition | 6.229 / 6.542 |
| workflow | boundaryOnly | mixedDefinitions | 2.490 / 2.557 |
| workflow | boundaryOnly | definitionPreparation | 11.848 / 12.625 |
| workflow | boundaryOnly | lifecycleAcceptance | 1.240 / 1.294 |
| workflow | boundaryOnly | lockedAttemptAcceptance | 3.582 / 3.671 |
| workflow | boundaryOnly | participantProof | 56.653 / 61.952 |
| workflow | boundaryOnly | occProof | 0.745 / 0.800 |
| workflow | boundaryOnly | priorDocuments | 0.872 / 0.967 |
| workflow | boundaryOnly | developerIndexPreparation | 12.536 / 12.937 |
| workflow | boundaryOnly | uniquePreparation | 2.045 / 2.202 |
| workflow | boundaryOnly | relationPreparation | 0.004 / 0.019 |
| workflow | boundaryOnly | intrinsicMembership | 2.562 / 2.959 |
| workflow | boundaryOnly | rowWrites | 2.877 / 3.878 |
| workflow | boundaryOnly | indexWrites | 17.561 / 19.668 |
| workflow | boundaryOnly | uniqueWrites | 4.988 / 5.491 |
| workflow | boundaryOnly | coverage | 5.268 / 7.594 |
| workflow | boundaryOnly | searchWrites | 3.144 / 3.353 |
| workflow | boundaryOnly | lowering | 57.230 / 63.406 |
| workflow | boundaryOnly | finalReferences | 0.584 / 0.619 |
| workflow | boundaryOnly | clockAdvance | 0.311 / 0.324 |
| workflow | boundaryOnly | durablePublication | 5.875 / 6.710 |
| workflow | boundaryOnly | transaction | 125.572 / 137.541 |
| workflow | boundaryOnly | finalOutcome | 1.583 / 1.677 |
| workflow | boundaryOnly | publisher | 150.634 / 159.627 |
| workflow | detailed | request admission | 94.826 / 96.401 |
| workflow | detailed | Worker execution | 711.706 / 716.530 |
| workflow | detailed | journal seal and OCC verification | 115.831 / 137.375 |
| workflow | detailed | authoritative publication | 179.546 / 203.651 |
| workflow | detailed | commandPreparation | 6.302 / 11.721 |
| workflow | detailed | authorityResolution | 1.643 / 4.644 |
| workflow | detailed | initialOutcome | 1.379 / 1.769 |
| workflow | detailed | intrinsicDefinition | 8.867 / 10.613 |
| workflow | detailed | mixedDefinitions | 3.429 / 4.843 |
| workflow | detailed | definitionPreparation | 16.338 / 20.120 |
| workflow | detailed | lifecycleAcceptance | 1.887 / 2.196 |
| workflow | detailed | lockedAttemptAcceptance | 5.204 / 6.913 |
| workflow | detailed | participantProof | 66.080 / 71.651 |
| workflow | detailed | occProof | 0.970 / 1.159 |
| workflow | detailed | priorDocuments | 1.038 / 1.111 |
| workflow | detailed | developerIndexPreparation | 13.660 / 19.342 |
| workflow | detailed | uniquePreparation | 2.335 / 2.631 |
| workflow | detailed | relationPreparation | 0.005 / 0.006 |
| workflow | detailed | intrinsicMembership | 2.860 / 3.508 |
| workflow | detailed | rowWrites | 3.833 / 4.452 |
| workflow | detailed | indexWrites | 18.574 / 19.060 |
| workflow | detailed | uniqueWrites | 5.721 / 5.940 |
| workflow | detailed | coverage | 7.636 / 8.342 |
| workflow | detailed | searchWrites | 4.948 / 5.206 |
| workflow | detailed | lowering | 67.203 / 71.640 |
| workflow | detailed | finalReferences | 0.746 / 0.800 |
| workflow | detailed | clockAdvance | 0.447 / 0.468 |
| workflow | detailed | durablePublication | 7.629 / 8.538 |
| workflow | detailed | transaction | 151.942 / 165.842 |
| workflow | detailed | finalOutcome | 1.792 / 1.857 |
| workflow | detailed | publisher | 179.123 / 203.188 |

## Paired complete-attempt observation difference

These are sample-level detailed minus boundary-only differences for alternating pairs. They include real workload variation and diagnostic work; they are not a pure instrumentation cost.

| Profile | Matched retained pairs | Difference median / P95 ms |
| --- | ---: | --- |
| product | 5 | 88.079 / 119.191 |
| productPayload | 5 | 90.736 / 100.120 |
| workflow | 5 | 167.843 / 191.868 |

## Paired publisher observation difference

The genuine outer publisher region includes child gaps. It is distinct from fixture authoritative publication, which can include executor handoff work. Differences and ratios below are formed within each matched retained pair before computing distributions; child percentiles are never summed.

| Profile | Matched publisher pairs | Difference median / P95 ms | Detailed / boundary ratio median / P95 |
| --- | ---: | --- | --- |
| product | 5 | 20.149 / 25.985 | 1.259 / 1.331 |
| productPayload | 5 | 20.758 / 26.064 | 1.254 / 1.317 |
| workflow | 5 | 28.851 / 48.390 | 1.192 / 1.313 |

Per-sample raw owner intervals retain overlap and SQL intersections. Phase unions are computed within each sample; percentiles are never added or subtracted.

Original demands and actual batch observations are distinct from net committed effects. Counts and batch events describe separate levels; do not sum them. Writes are provisional until real COMMIT. Server diagnostics, when present, remain a separate charged lane with partial nested coverage; CPU and lock costs remain unavailable.

Failed samples remain in original order. Complete-attempt timings include request admission, Worker execution, seal/finishing/publication and fixture cleanup; setup is separate.
