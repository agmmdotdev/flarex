# Source-owned finite pin: direct mixed workflow

This run measures the frozen candidate after separating finite pin/correlation
issuance from frame-only full verification. The [raw report](./mixed-workflow.json)
and [command receipt](./command.json) preserve all observations. Base revision is
`8c394df7747f3a7c8cdebb1b929f53c766499bc9` with an uncommitted candidate.

`pnpm perf:core --scenario mixed-workflow --full --sql` ran three warmups, twenty
quiet fresh requests with real settlement, and one separate SQL diagnostic on
ordinary-role PostgreSQL 18.3 and Node 24.16.0. All requests passed their semantic
checks. The diagnostic duration is excluded from the quiet distribution.

| Observation | Frozen baseline | Initial sharing candidate | Full-source issuer correction | Explicit pin/frame split |
| --- | ---: | ---: | ---: | ---: |
| Quiet median ms | 729.610 | 692.753 | 871.883 | 733.142 |
| Quiet P95 ms | 744.972 | 716.431 | 1,906.934 | 749.606 |
| Diagnostic statements | 800 | 736 | 872 | 736 |
| Diagnostic transactions | 63 | 63 | 63 | 63 |

The latest quiet range is **722.419–769.783 ms**. Median is **3.532 ms (0.48%)**
above the baseline; P95 is **4.635 ms (0.62%)** above it. This sequential comparison
does not establish equivalence or a causal regression. It supplies no overall
latency-win claim. The extra 136 completion statements in the
[issuer correction](../frontier-candidate-final-full/README.md) are removed while
the genuine finite issuer and whole-root retry contract remain intact.

The command took **84.601 s**, runner **83.586 s**, load **4.483 s**, and preparation
**22.286 s**. Preparation includes **9.351 s** index/unique build and **3.328 s**
logical admission. Setup, seed and persisted-result verification stay outside
request latency and are not free. The separate diagnostic took **1,130.834 ms**;
its SQL await sum/interval union was **385.553 ms**. These intervals are neither
server execution nor isolated CPU and do not explain the remaining request time.

No open transaction, query error, lost context, unknown/unobserved dispatch or
incomplete diagnostic span remained. The [source fingerprint](./source-fingerprint.json)
checks ten owned runtime/diagnostic sources before and after the quiet run, with
all unchanged. It is a scoped source inventory, not an exhaustive executing-build
or transitive-dependency fingerprint.

The [initial fixed native comparison](../frontier-candidate-native/README.md)
still records failed additive budgets, and the
[scaling witness](../frontier-candidate-scaling/README.md) still cannot prepare the
unchanged 100-table catalog. They predate later source corrections and are not
claimed as final-source acceptance. No new native or complete scaling acceptance
is inferred from this direct workflow diagnostic. The candidate remains
uncommitted with slice acceptance incomplete. The proposed
[finite execution contract](../../../../../roadmaps/mixed-mutation-core/23-finite-execution-contract-preflight.md)
owns the next architecture decision, rather than treating SQL reduction as that
redesign.
