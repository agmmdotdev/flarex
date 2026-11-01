# Legacy entrypoint retirement and remaining consumer gates

Status: **Unused private entrypoints and the test-only Task execution wrapper
retired; remaining consumer and historical-data gates below stay open.**

This is a connected cleanup of the [single-owner goal](../GOAL.md), following
the [Product/reference cutover](./16-native-product-links-and-references.md).
It does not close that goal or resume paused Task implementation or performance
measurement. Runtime implementation remains in the shared checkout; unrelated
work retains its existing ownership.

## Challenge and retired scope

Independent current-owner, accepted-direction and pinned-Convex readers checked
the deletion boundary, then exchanged counterexamples. The reference remains
`db914cf06e2b06ee985646611b9e12ed7a770318`. The removed private constructors
are not required by its query/transaction/snapshot owners. No core algorithm,
persisted codec, native profile or physical schema changes in this slice, so no
new mechanism divergence is introduced.

The following entrypoints had no repository import, exported-symbol caller or
generator/configuration reader beyond their package exports. Historical source
inventories are provenance, not executable consumers.

| Former owner | Retired entrypoints |
| --- | --- |
| Standard invocation | `systemV1.ts`, `querySystemV1.ts`, `LegacyStandardApplicationActiveRevisionReaderV1.ts` and their package exports |
| Candidate-bound Worker construction | The unused `CandidateBoundPointMutationRuntimeTargetV1.ts`, `CandidateBoundPointQueryRuntimeTargetV1.ts`, `CandidateBoundPointMutationInternalQueryRuntimeTargetV1.ts` and their now-unconsumed mutation/query `InternalCall` wrappers, with their package exports |
| Historical revision-target construction | The matching `applicationRevisionRuntimeTargetV1.ts`, `applicationRevisionQueryRuntimeTargetV1.ts`, `applicationRevisionMutationInternalQueryRuntimeTargetV1.ts` and their now-unconsumed mutation/query `InternalCall` wrappers, with their package exports |
| Commerce profile barrel | Unconsumed `commerceProfile.ts` and its export; underlying profile implementations remain in use |
| Stranded syscall construction | `LegacyApplicationRevisionSyscallValidatorV1.ts`, called only by the removed `systemV1.ts`, and its export |
| Stranded old query transaction | `applicationPointQuerySnapshotV1.ts`, called only by the retired query wrappers; both package aliases and its obsolete Effect-boundary allowlist entry |

`LegacyTaskExecutionHost.ts` was called only by its own test entry. Its source,
export and obsolete test entry retire together. The existing `test:dte06-d3b-i`
selection now exercises the retained Worker definition and current session,
compute-provider and Application execution hosts.

The current Task session tests own revision/profile/duration refusal before
loading, the five named legacy Worker failure mappings with original causes,
and initial/terminal identity corruption and resource disposal. Existing current
session/provider witnesses retain fresh outbound-denied loading. Application
execution-host witnesses exercise shared RPC result disposal, defects, timeout,
interruption and late disposal. Unknown Task START failures retain the current
`workerStartFailed` presentation; the removed wrapper does not redefine it.

## Retained consumer ledger

Each row names actual construction or a historical obligation, its replacement
owner and the proof needed before removing the complete displaced closure.
An export or a self-test alone is not an indefinite retention justification.

| Retained family and actual caller | Obligation and replacement owner | Removal condition |
| --- | --- | --- |
| `legacyV1AppDataEngine`, legacy document/index/invoke-session storage: `apps/executor/src/worker.ts` constructs `createFlarexExecutor`, which installs the legacy-only registry in `packages/executor/src/index.ts` | The configured HTTP/syscall path, session identities, stored outcomes and recovery need a connected host cutover to the translated Application owner; local DO conformance alone does not move this entrypoint | Inventory its admitted routes/syscalls and named persisted sessions/outcomes, migrate those callers, prove request/recovery/uncertain-outcome behavior, then remove the registry, old engine/storage APIs and obsolete host wiring together |
| `applicationQueryDataCache`, `snapshotIndexCache` and old `applicationQuerySnapshot`: the legacy branch of `ApplicationQuerySystem` and `ApplicationRelationQuerySystem` | Preserve selected-query authority, incoming relations and exact dependency/result contracts through the shared snapshot/cache owners | Move the last selection-bound query/relation consumer, including connected Task/system-test construction; prove warm/cold reads and invalidation under its admitted profile, then remove old handoff/completion/cache owners and their exports |
| Finite/journal execution, private Payload Save/Reverse/Binding and mixed-reference consumers, including the 28 `privatePayload*.ts` helpers | Authentic grant/receipt grammar, cancellation, publication ordering, retry and stored-result reconstruction remain covered by the [named Product16 ledger](./16-native-product-links-and-references.md#named-retained-consumers) | Migrate or explicitly disposition each named finite contract and its stored evidence; move meaningful assertions to real Core consumers before removing the shared constructors, helpers and old entries |
| Remaining commerce/CMS hosts, logical participants and framework installers: admitted modules/workflows outside Product/Currency and developer-UDF Payload borrowing | Native business/flush/compensation behavior stays framework-owned; shared transaction/schema owners replace old SQL/session/materialization choreography | For each remaining module/profile, record the executing entrypoint, complete native graph and data obligations; prove both database lanes and any actual host consumer, then delete that profile's obsolete construction and finally the unshared host/install owners |
| Old commit feed, relation facts and readiness builders: `apps/executor/src/querySyncSourceRead.ts`, backend deployment-sync, old intrinsic/unique builders | Sync readers and builds require exact change/dependency semantics through the translated publication/history/index lifecycle owners | Migrate the actual feed/evaluation/build readers and preserve replay, ordering, selective invalidation and retained-history boundaries; remove old writers only when no reader or admitted recovery path still requires their records |
| Legacy Task lifecycle/store/schema and `LegacyTaskWorkerDefinition`: current compute provider, supervisor, Product import and fulfillment workflow callers | The [Task cutover plan](../../../../design-notes/task-system/04-cutover-and-retirement.md) owns complete lifecycle, waits, workflow callbacks, storage and recovery replacement | Resume only under that goal's authorization; prove its connected adopted engine and logical storage, migrate actual callers and decide named data, then remove Task-specific physical state and duplicate lifecycle machinery. Task implementation remains paused |
| Legacy physical maintenance, schemas and `LegacyIndexMaintenanceEvidence` / `LegacyUniqueMaintenanceEvidence`: old PostgreSQL/PGlite installation and maintenance callers | Physical upgrades and retained old consumers remain distinct from new logical installation | Name each surviving table/dataset and its last runtime or upgrade reader/writer; prove the replacement and approved migration/reset disposition, then remove old schema declarations, installer/maintenance exports and physical artifacts. Code cleanup supplies no data-deletion permission |
| Frozen `core/legacySchema.ts`: bootstrap migration and pre-cutover table-summary reconstruction; `LegacyApplicationProgramIdentity.ts`: stored-program verification in `coreProgram.ts` | These are historical decoders used by the current Core, not a second engine | Retire only after all admitted stores/programs are upgraded and no supported snapshot, table-summary checkpoint, replay/outcome or retained history can demand the old encoding; preserve exact frozen decoding until that condition is proved |
| Historical declarative verifier repository/inert/hash and opaque command bridge: paired `test/legacy` witnesses and pre-0064 registration fixtures | Historical replay/upgrade assertions are separate from current execution authority; `historicalVerifierFixture.ts` deliberately provides no live installation/execution authority | Enumerate the old-state guarantees still required, preserve them at direct current/repository owners or an explicitly frozen historical reader, then remove the bridge, duplicate exports and bridge-only assertions. No serving-analyzer obligation has been established by these tests |
| Legacy joint Currency host: eight cases in `medusa-adapter/test/logical-cross-source-admission.test.ts` | Finite Application point-commit rollback, source/catalog activation, endpoint identity/scope, 33-reference batches, atomic mixed publication/replay and both Product reference directions still need connected Core counterparts | Map all eight cases to actual Core witnesses or explicit dispositions, preserving missing-target rollback, active-source continuity, atomicity and races; remove the old host/participant/publication closure after its last mapped case moves. Product CRUD migration alone does not close this gate |
| Old Product runner: `medusa-adapter/benchmarks/core-performance/native-retrieval/scenario.ts`; old Payload reference runtime: `executor/test/performance/support/mixedMutationProductFixture.ts` | Preserve the actual workload graph and comparison meaning; native retrieval also uses old managed-read hosts, metadata-scaling, separate pools and observation setup | Migrate the complete workload construction and its readback/resource contracts to Core, not only a runner import; remove runner/factory and obsolete observation assumptions afterward. Construction changes do not authorize measurement; performance remains paused |
| Self-contained `experiments/core/src` candidate: its own tests and comparison workloads, with no external runtime import | The [experimental baseline](../../README.md) preserves runnable comparison evidence, distinct from the current Core | Identify and accept/freeze the exact comparison evidence still needed and transfer meaningful behavioral assertions before removing the executable candidate, its package/build/test configuration and dependencies; do not start a performance run to satisfy cleanup |

The eight-case joint-host gate supersedes older wording that waited only for
Product/reference migration. Source files and fixtures are not evidence of a
named external dataset. Missing dataset inventory keeps physical retirement
open; it does not justify preserving uncalled private constructors.

## Acceptance boundary

Check deleted filenames, aliases and exported symbols against first-party
imports, build scripts and configuration; preserve generated-source inputs that
have actual generator readers. Validate affected package types, current owner
regressions, source/package guards, core/diff/exact-index lint and both mandatory
read-only reviews. This deletion/test-transfer slice makes no new database,
isolation, migration or query-plan claim. Such later runtime changes retain their
PGlite and ordinary-role PostgreSQL gates.

The shared-worktree checkpoint must contain only owned deletions, test transfers,
export/script edits and this durable retirement truth. Existing unrelated edits,
including other hunks in a manifest, remain with their owner. Validation receipts
and chronology belong in Git.
