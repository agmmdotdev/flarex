# Bounded read execution performance

This package retains the complete [16-sample traced smoke](./traced-smoke/manifest.json)
and [104-sample untraced series](./untraced/manifest.json): exact generated raw
JSON and report bytes, verified gzip round trips, every CSV sample and byte/SHA-256
manifests. All 120 samples succeed, with zero setup failures and zero exclusions.
The [verified checkpoint](./verified-measurement-checkpoint.json) records all
51 measured source hashes and the exact working fingerprint verified against
the workspace before packaging and final documentation edits. Both lanes share
that checkpoint, the unchanged business profiles and the original sample plan.
The [prepared-admission baseline](../prepared-admission/README.md) and all its
samples remain unchanged.

## Measured cost and stage acceptance

The four graphs use the same local ordinary-role PostgreSQL settings and fresh
single-use Worker lifecycle. Each graph's two warm traced requests have identical
SQL dispatch and transaction counts. Latency uses 20 untraced warm requests and
three cold requests per graph; warm p95 is descriptive nearest rank. Times are
milliseconds.

| Workload | Prepared warm p50 / p95 | Batched warm p50 / p95 | Cold p50 | Prepared → batched SQL | Transactions | SQL / transaction ceiling |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Product | 783.7 / 1,011.6 | 635.4 / 668.3 | 680.4 | 862 → 643 | 41 → 29 | 798 / 33 |
| Product + Payload | 973.8 / 1,006.0 | 690.0 / 751.7 | 726.5 | 1,068 → 670 | 52 → 30 | 924 / 34 |
| Mixed finite workflow | 1,676.6 / 1,714.8 | 1,169.3 / 1,226.9 | 1,196.3 | 1,663 → 1,034 | 78 → 43 | 1,439 / 50 |
| Standalone finite workflow | 309.4 / 395.3 | 321.2 / 342.7 | 327.0 | 354 → 354 | 6 → 6 | 354 / 6 |

Every slice 16 stage gate passes. Warm medians change by **−18.9% / −29.1% /
−30.3% / +3.8%**. Standalone passes both its median ceiling (**321.2 < 400 ms**)
and strict regression limit (**3.8% < 10%**). Every warm maximum is retained:
**689.0 / 782.2 / 1,237.6 / 380.0 ms**. No outlier is excluded or replaced.
The final mixed p50 goals of **100 / 200 / 500 ms** and p95 goals of
**200 / 400 / 1,000 ms** remain unmet. Comparing checkpoints does not isolate
the causes of latency changes or establish native Medusa parity.

## Attributable transaction structure

[Full warm SQL fingerprints](./sql-fingerprints.csv), [SQL families](./sql-families.csv),
[phase spans](./phases.csv), [transaction groups](./transactions.csv) and
[derived analysis](./analysis.json) retain the comparison and exact template
selection rules. The transaction counts below match both warm traced samples.

| Explicit transaction category | Product prepared → batched | Product + Payload | Mixed workflow |
| --- | ---: | ---: | ---: |
| Request admission, including control | 11 → 9 | 13 → 9 | 19 → 9 |
| Finite method admission / borrowed construction | 6 → 0 | 14 → 0 | 18 → 0 |
| Native data frontiers | 14 → 10 | 15 → 11 | 31 → 24 |
| Application point operations | 2 → 2 | 2 → 2 | 2 → 2 |
| Root point-table bootstrap | 1 → 1 | 1 → 1 | 1 → 1 |
| Seal/OCC | 5 → 5 | 5 → 5 | 5 → 5 |
| Publication | 2 → 2 | 2 → 2 | 2 → 2 |

The approved setup-only ceilings retain the previous data-frontier allowance.
Actual grouping removes another **4 / 4 / 7** transactions. Product data occurs
in its update phase (10 transactions); pending retrieve and list need no SQL.
Payload adds one create frontier; its later pending reads and update need no SQL.
Workflow adds 13 data frontiers. Sequential native steps and parent-dependent
keys still require separate demands; these aggregates do not establish a
universal minimum number of data rounds. Explicit BEGIN/COMMIT spans do not
fully count autocommit, control or internal server transactions.

| Target statement family | Product prepared → batched | Product + Payload | Mixed workflow |
| --- | ---: | ---: | ---: |
| Canonical Application activation | 6 → 6 | 6 → 6 | 6 → 6 |
| Legacy revision-schema projection | 5 → 5 | 5 → 5 | 5 → 5 |
| Binding activation/candidate/complete-lane join | 2 → 2 | 3 → 3 | 6 → 4 |
| Full epoch capture | 5 → 5 | 6 → 6 | 9 → 7 |
| Mandatory full epoch tail | 22 → 12 | 32 → 13 | 55 → 26 |
| Strong clock lock | 34 → 22 | 45 → 23 | 71 → 36 |
| Physical catalog proof | 23 → 13 | 28 → 13 | 50 → 26 |

Each actual checked frontier retains the six kernel statements, full source-wide
required readiness, physical evidence and protected-epoch tail. The reduced
tail/proof counts follow fewer accepting transactions; they do not establish
cheaper attestation. The existing 23-table installation/role/catalog attestation
and privileged quiescence contract remain. Driver queries cannot count the SQL
executed inside attestation functions or triggers.

Mean summed driver await for full epoch tails is **37.3 / 39.5 / 75.2 ms**;
capture await is **15.4 / 17.8 / 20.0 ms**. Await includes transport, server and
lock waits. Trace phases and transaction/query sums overlap and are non-additive;
traced wall times are not latency acceptance. Pure CPU/decode/hash, server work,
lock attribution and hosted Cloudflare performance remain unmeasured.

## Retained contract and validation limits

[Slice 16](../../../../../roadmaps/mixed-mutation-core/16-batched-read-execution-preflight.md)
owns aggregate full finite entry, local issued construction and bounded trusted
storage execution. Native modules, hooks and workflow steps retain their existing
graphs and remain outside SQL. Relevant Application point seeds authenticate
their original snapshot observation before overlay membership is used. Ordered
dependencies, charging, pending views and sticky body/tail refusal remain with
the existing working-set/root owners. Standalone and durable-operation profiles,
journal encodings, aggregate seal, publication and uncertain-outcome recovery
retain their contracts.

Focused validation covers tentative Product construction after claim loss,
workflow construction after required Pricing readiness loss, pending-only Payload
calls after claim loss, required/unrelated readiness, final seal refusal, genuine
native results/events, whole-root retry, caught failures, cancellation and
acknowledgement recovery. Neutral and actual Product witnesses cover compound
IN/disjunction, unique-owner hydration, residual windows, ordered writes and
deferred Application seed hydration on PGlite and ordinary-role PostgreSQL.
Payload's held-hook/nested-read witness checks no open SQL transaction. Product
and workflow native entry/completion observations retain the same assertion;
workflow cancellation is PGlite-only and no dedicated PostgreSQL pause between
SDK steps is claimed.

Affected typechecks, core/diff lint and connected-runtime/Application-definition
source guards pass. Three generated Worker artifacts pass byte-identical rebuild
checks. The Effect audit retains exactly the baseline's 12 diagnostics
over 1,878 sources; the pre-existing stale Medusa promotion hash remains unchanged.
These bounded proofs do not establish public APIs, named-environment activation,
production readiness, arbitrary framework support or final latency acceptance.
The next gate is the separately scoped [settlement preflight](../../../../../roadmaps/mixed-mutation-core/17-batched-settlement-preflight.md).
