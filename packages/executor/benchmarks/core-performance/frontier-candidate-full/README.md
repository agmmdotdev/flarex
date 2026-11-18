# Shared finite frontier initial candidate: direct mixed workflow

This ledger records the **initial candidate**, before the later overlap cleanup
and `sourceAdmission` full-callback issuer-retry corrections. These numerical
reports do not measure the latest source correction or establish its validation.
They are not evidence for the final runtime checkpoint or slice acceptance.
The [frozen baseline](../frontier-baseline/README.md) and this candidate
both identify base revision `8c394df7747f3a7c8cdebb1b929f53c766499bc9` with a dirty
checkout. The baseline has test instrumentation but no candidate runtime edits;
this run includes the candidate runtime. The report records revision and dirty
state, not an exhaustive dirty-source fingerprint or executable-build inventory.

The root ran `pnpm perf:core --scenario mixed-workflow --full --sql`. The
[command receipt](./command.json) and [raw report](./mixed-workflow.json) retain
the observations. Only the command receipt's report path is normalized to a
repository-relative path. This is direct Node execution with fresh requests and
real settlement, PostgreSQL 18.3 and Node 24.16.0. The ordinary database role has
no superuser, BYPASSRLS, database-creation or role-creation authority; fsync,
synchronous commit and full page writes are enabled.

Three quiet warmups precede twenty quiet measured requests. One separate
instrumented request supplies SQL evidence; its timing is excluded from the
quiet distribution.

| Observation | Frozen baseline | Initial candidate | Change |
| --- | ---: | ---: | ---: |
| Quiet request median | 729.610 ms | 692.753 ms | -36.857 ms (-5.05%) |
| Quiet request P95 | 744.972 ms | 716.431 ms | -28.541 ms (-3.83%) |
| Diagnostic client SQL submissions/statements | 800 | 736 | -64 (-8.00%) |
| Diagnostic transactions | 63 | 63 | 0 |
| Diagnostic duration | 1,090.473 ms | 1,053.184 ms | -37.289 ms |
| Diagnostic SQL await sum/interval union | 369.160 ms | 345.605 ms | -23.555 ms |

The candidate quiet range is **680.140–716.897 ms**. Its selected command takes
**80.985 s** and the scenario runner **80.015 s**. Loading takes **4.281 s** and
preparation **21.574 s**, including **8.930 s** index/unique-set construction and
**3.229 s** logical admission. Seeding and persisted-result verification are
separately recorded per sample outside request latency. This setup accounting
does not establish a request-speed cause.

| Candidate diagnostic phase | Inclusive wall time | Client SQL statements |
| --- | ---: | ---: |
| Application admission preparation | 43.280 ms | 60 |
| Finite outer entry activation | 84.903 ms | 55 |
| Authenticated outer entry | 23.823 ms | 21 |
| Portable execution outside child spans | 25.649 ms exclusive | 19 |
| Application point operations | 26.876 ms total | 35 |
| Native Product operations | 136.179 ms total | 122 |
| Native Medusa workflow | 227.798 ms | 161 |
| Native Payload operations | 25.917 ms total | 12 |
| Freeze and seal | 117.518 ms | 58 |
| Stored verification and planning | 30.832 ms | 0 |
| Finishing | 13.562 ms | 21 |
| Authoritative publication | 210.635 ms | 172 |

Exclusive phase SQL counts sum to 736. The 64-submission reduction is localized
to Product (-3) and workflow (-61); entry, seal and publication counts remain
unchanged. Inclusive parent/child times overlap and must not be summed.
`stored read and source preparation` denotes `context.prepareAttempt`, not an
isolated framework checked-read phase. Product's following retrieve is an
attempt-local read after its update; this mixed graph does not substitute for
the fresh first-demand hit/miss method comparison.

The diagnostic leaves zero open transactions, query errors, lost context,
unknown/unobserved dispatches or incomplete spans. SQL await sum and interval
union are equal; checkout await sum and union are **2.169 ms**. These are client
await intervals and SQL submissions, not server CPU, network round trips or
hidden server-function statement counts.

The [matched native quiet ledger](../frontier-candidate-native/README.md) and
[metadata scaling ledger](../frontier-candidate-scaling/README.md) are separate
evidence lanes. Their fixed method gates, affected correctness regressions,
connected integration graph, final source provenance and final validation remain
required. Successful scenario execution and this numerical improvement do not
claim completion, hosted performance or activation readiness.
