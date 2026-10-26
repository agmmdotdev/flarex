# Source and evidence map

Inspected on 2026-10-26. References establish mechanisms and prior results, not
the feasibility or speed of the proposed experimental replacement.

## Convex source identity

The local Convex checkout is the enclosing `convex-backend` directory, two levels
above the Flarex repository root. Its inspected Git HEAD is
`84fbb0e70b4e857913673871cb847ad11a55f3d5`. This is a local checkout identity,
not a claim that the commit is published upstream. The inspected files were clean
relative to that HEAD. Its `upstream` fetch remote names `get-convex/convex-backend`;
the [official repository](https://github.com/convex/convex-backend) is the current
web destination. Remote HEAD is not the source pin for this analysis.

Local links below depend on this enclosing checkout. If it is unavailable,
obtain a recorded source revision and recheck symbols/hashes; do not silently
substitute current upstream code. Lines can drift; symbols and content hashes
identify what was inspected.

| Source | Symbols / lesson to inspect |
| --- | --- |
| [database.rs](../../../../crates/database/src/database.rs) | `begin_with_usage`, `begin_with_repeatable_ts`, `commit_with_write_source`: snapshot-backed transaction construction and one committer handoff |
| [transaction.rs](../../../../crates/database/src/transaction.rs) | `Transaction`, `table_mapping`, nested transaction operations: owned identity, metadata, reads, writes and limits |
| [snapshot_manager.rs](../../../../crates/database/src/snapshot_manager.rs) | `SnapshotManager`, `latest`, snapshot retention: immutable versioned metadata/index state and bounded history |
| [reads.rs](../../../../crates/database/src/reads.rs) | `TransactionReadSet`, `record_read_document`, `record_indexed_directly`, `writes_overlap_by_index`: precise dependencies and conflict detection |
| [writes.rs](../../../../crates/database/src/writes.rs) | `Writes::update`, `NestedWrites`, `coalesced_writes`: original/pending consistency, nested writes and final effects |
| [committer.rs](../../../../crates/database/src/committer.rs) | `Committer`, `write_to_persistence`, `publish_commit`: serialized commit ownership, persistence and visibility ordering |
| [application_function_runner/mod.rs](../../../../crates/application/src/application_function_runner/mod.rs) | `retry_mutation`, `_retry_mutation`, `run_mutation_inner`: retries belong to the root and require eligible failures |

Exact SHA-256 values for those local files:

```text
database.rs       662af0b889e9fa557df54e6eb5e97e0efb76fedd39c385b776bcb84c006d2066
transaction.rs    dcbbff39df81e7419e2571a199b72b2d1f0d41e01efea9ee903054e8a75cf1b9
snapshot_manager.rs f1250a25984684f65adc388f231f7077e06c25721d3ab386581c0972160cecee
reads.rs          c946bcefe9466ae81d7cce3b0de69066edd1955c4d6a114eb8e0e2eb000cb4f1
writes.rs         4b823100a68b5337ec4d4ab681f69c75c722bc61f05b81eeb9c74d788bf58ecf
committer.rs      757694be6c9fcac0eb06cc25a9897132a6ae7ae8b364b2fedc7052c22a12fd45
application_function_runner/mod.rs 4c723adb49b632793e6d2507424845bb60218a1ff7d8d2cb4035e7f03607ed33
```

Read the local [LICENSE.md](../../../../LICENSE.md) before considering source
copying; the inspected file identifies FSL-1.1-Apache-2.0. Its SHA-256 is
`cee614f23a461cb4aba2910e7127ae0969bcf42a0a91a38d3e3449d843383086`.
This experiment uses Convex as an architectural reference. It does not assume
permission to transplant source or that every source file has identical terms.

## Transferable ideas and explicit divergences

Transfer snapshot/version ownership, exact dependency tracking, owned pending
writes and singular commit/retry responsibility. Do not infer that Convex uses
no storage reads, no validation, no internal RPC or no authorization.

Flarex keeps PostgreSQL as committed-data authority, short physical transactions
around untrusted execution, explicit framework profiles and the private Worker
target. Convex's resident Rust database engine and in-memory snapshot structures
are not a drop-in Worker implementation. Moving all execution to a resident
database service would be a different hosting proposal, not this experiment.

Official explanations: [How Convex Works](https://stack.convex.dev/how-convex-works),
[OCC and Atomicity](https://docs.convex.dev/database/advanced/occ), and
[Writing Data](https://docs.convex.dev/database/writing-data). These describe
the model; local pinned source anchors exact implementation observations.

## Flarex source and prior experiments

The initial document inspection used Flarex HEAD
`bfbe463188996932c3392228a7c5f7ab9a259bf9` in a dirty shared checkout. This is
not a clean runnable baseline. Record executing source hashes for future runs.

| Reference | What it establishes |
| --- | --- |
| [Accepted design](../../design-notes/flarex-db-accepted-design.md), [package boundaries](../../roadmaps/16-package-boundaries.md) | Durable authority, profile separation, framework ownership and allowed breaking internal changes |
| [Working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts) | Existing pending/observed reuse and relational execution; a new working set alone is not the missing optimization |
| [Finite capture](../../packages/persistence-postgres/src/execution/finiteStorageCapture.ts) | Existing prepared SQL, fresh authority and result acceptance; checks and data already share some queries |
| [Operation CPU](../../work/validation/shared-execution-evidence/full-cpu-differential/operation-results.md) | Historical 138.425 ms Flarex / 27.775 ms native mean thread CPU; admission, selection/capture and publication are separate substantial families |
| [Read repetition](../../work/validation/shared-execution-evidence/full-cpu-differential/read-results.md) | Small measured duplicate pure preparation; no exact repeated input among 26 index and eight row captures |
| [Command investigation](../../work/validation/shared-execution-evidence/full-cpu-differential/candidate-results.md) | Distributed command/candidate cost; no demonstrated dominant safely removable leaf |
| [Rejected replacement](../../roadmaps/mixed-mutation-core/27-shared-execution-evidence-redesign-preflight.md) | Full document-pipeline replacement failed its performance gate; retained runtime must not be described as that candidate |
| [Native business harness](../../packages/medusa-adapter/benchmarks/core-performance/native-business/README.md), [executor harness](../../packages/executor/benchmarks/core-performance/README.md) | Real comparison workloads and measurement entry points |
| [Medusa SOURCE.json](../../third_party/medusa/SOURCE.json), [active adapter manifest](../../packages/medusa-adapter/package.json) | Pinned fork source versus executing promoted packages; inspect both before asserting equivalence |
| [Payload adapter manifest](../../packages/payload-adapter/package.json) | Inspected Payload peer version 3.88.0; verify executing dependency and Local API, not only the manifest |

The cited performance numbers are saved cohorts, not current measurements or
removable-cost estimates. Unrelated integration changes continue. Do not restart
old failed candidates, weaken their witnesses or treat a smaller SQL string as
proof of a faster engine.

## Concrete redesign evidence

The follow-up assessment targeted Flarex
`abb63e1638d0414a01dbdbf6e853f135bfd0c8f2`. The query/unique/predicate findings
below were also checked against the shared checkout. Pin executing files again
before implementation; later dirty adapter changes are not covered by that commit.
These patterns identify work and complexity, not their share of total latency.

| Source / symbol | Finding and experimental consequence |
| --- | --- |
| [Working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts): `readFiniteIndexRows` | Membership capture followed by acquisition of unseen bodies; evaluate a complete bounded operation while preserving real intervening access callbacks. |
| Same owner: relational `count`, `executeRelationalFind`, `readRelationalSelection`; [Payload adapter](../../packages/payload-adapter/src/adapter.ts): `count` | Count takes the find pipeline; Payload requests `limit: 1` but returns the total. Dedicated scalar execution can avoid document-result construction, sorting and projection where semantics permit. |
| Same owner: `withUniqueValidation`, `rows.values()` | Per-change/per-definition traversal and key lowering can produce quadratic local work for growing distinct insert batches. Maintain current key ownership incrementally; preserve required conflict/integrity behavior. |
| Same owner: `evaluateRelationalPredicate`; [PostgreSQL predicates](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/postgresRelationalPredicate.ts) | Captured original/pending documents are encoded and sent to SQL for matching. Evaluate eligible snapshot data near storage and combine relevant deltas without changing value semantics. |
| [Installed gate](../../packages/persistence-postgres/src/installation/scopeExecutionAuthorityInstallation.ts), [finite publication](../../packages/persistence-postgres/src/commit/point/finitePublication.ts) | Identity/freshness synchronization and the serialized accepting section need a complete writer inventory and server/lock measurements, not an assumed cache replacement. |
| [Medusa module construction](../../packages/medusa-adapter/src/module/definition.ts), [read ordering](../../packages/medusa-adapter/src/query/read.ts) | Evaluate root-scoped binding reuse; preserve per-call state and count/population ordering. Savings remain unmeasured. |
| [Settlement planning](../../packages/persistence-postgres/src/storage/materialization/settlementPlan.ts), [materialization](../../packages/persistence-postgres/src/storage/materialization/domainInstallation.ts) | Existing unchanged-membership skipping does not remove all key preparation/predecessor proof work. Measure remaining work before changing integrity enforcement. |
| [Measurement sources](../../packages/executor/test/performance/measurement/source.ts) | Existing package-oriented source fingerprints do not by themselves cover `experiments/core`; the candidate runner must include executing experimental SQL/code/configuration. |
| [Connected-generation results](../../packages/medusa-adapter/benchmarks/core-performance/native-business/connected-generation-results.md), [cost inventory](../../packages/medusa-adapter/benchmarks/core-performance/native-business/cost-inventory-proposal.md) | Historical paired results, capture inventory and materialization barriers. The attachment's archive reconstruction is not independently rerun by this documentation update; retained summaries are not fresh benchmarks. |

## PostgreSQL and hosted execution references

- [Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html):
  isolation belongs to a physical transaction. Final-transaction `SERIALIZABLE`
  does not retrospectively validate observations from earlier transactions;
  multi-visit logical commands still need their declared dependency protocol.
- [Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html):
  row/advisory lock lifetimes and conflicts. Row locking can cause disk writes;
  measure WAL and synchronization cost rather than assume nonlocking-read cost.
  An advisory-lock candidate requires every relevant writer to participate.
- [Hyperdrive connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)
  and [connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/):
  pooled transactions and Worker connection lifetimes constrain retained physical
  state. Local session reuse is not proof of hosted behavior.

Recheck these primary sources against the exact database/host used for validation.
They explain constraints; they do not predict the candidate's performance.
