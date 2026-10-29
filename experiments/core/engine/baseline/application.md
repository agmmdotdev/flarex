# Application baseline for the single-owner refactor

Status: **Source-inspected baseline; runtime validation not rerun**.
This records the existing Application responsibilities that the
[authorized goal](../GOAL.md) must migrate or explicitly retain. It is not a
claim that the replacement core or DO host already implements them. The inventory
is bounded by the executing entry points and witnesses below; missing connected
proof remains a gate.

## Canonical inventory and executing chain

Use the current [clean Application API roadmap](../../../../roadmaps/50-clean-application-apis.md),
[Standard API roadmap](../../../../roadmaps/42-standard-application-apis.md),
[execution map](../../../../roadmaps/execution-architecture/architecture.md) and
[construction inventory](../../../../roadmaps/execution-architecture/03-consumer-construction-and-domain-apis.md)
for the owning capability/status enumerations. Their historical versioned
exports do not automatically become the current executing contract.

The inspected live chain is:

1. [application-invocation](../../../../packages/application-invocation/src/index.ts)
   exposes clean query, mutation, action and task operations. For example,
   [Query.ts](../../../../packages/application-invocation/src/Query.ts) validates
   its typed reference/result and delegates to the current Standard query system.
2. [ApplicationQuerySystem](../../../../packages/standard-application-invocation/src/ApplicationQuerySystem.ts)
   selects/authenticates the active target, opens/revalidates the snapshot,
   loads source and supplies restricted query RPC capabilities.
   [ApplicationMutationSystem](../../../../packages/standard-application-invocation/src/ApplicationMutationSystem.ts)
   composes admission, grants, attempt execution and durable outcome handling.
3. [ApplicationPointMutationRunner](../../../../packages/flarex-backend/src/artifactRuntime/ApplicationPointMutationRunner.ts)
   and the current query system use
   [ApplicationWorkerDefinition](../../../../packages/flarex-backend/src/artifactRuntime/ApplicationWorkerDefinition.ts).
   That constructor checks target/source/manifest authority, forms the admitted
   internal query/mutation catalog and builds the module graph from
   [ApplicationWorkerCore.generated](../../../../packages/flarex-backend/src/artifactRuntime/ApplicationWorkerCore.generated.ts).
   Hashing only an older `PointMutationExactRuntimeWorkerCore` would not identify
   this executing chain.
4. [ApplicationWorkerCore](../../../../packages/flarex-backend/src/artifactRuntime/ApplicationWorkerCore.ts)
   and [functionApiCore](../../../../packages/function-runtime/src/functionApiCore.ts)
   construct the actual restricted database context and enforce boundary
   draining/result decoding. Query reads reach
   [applicationQuerySnapshot](../../../../packages/persistence-postgres/src/application/applicationQuerySnapshot.ts);
   mutation syscalls reach the
   [journal RPC capability](../../../../packages/executor/src/mutation/journal/applicationPointMutationJournalCapability.ts)
   and [journal operations](../../../../packages/persistence-postgres/src/execution/journal/api.ts).

The canonical operation shapes are in
[functionApiCore](../../../../packages/function-runtime/src/functionApiCore.ts),
[Application runtime contracts](../../../../packages/function-runtime/src/applicationFunctionRuntimeV1.ts),
[Worker request protocol](../../../../packages/flarex-protocol/src/application-worker-v1.ts)
and [journal contracts](../../../../packages/persistence-postgres/src/execution/journal/contracts.ts).
Keep these actual enumerations at their owners rather than creating a second
capability catalog here.

## Supported scope and proof levels

| Area | Existing executing obligation | Evidence and limits |
| --- | --- | --- |
| Ordinary queries | Open an authenticated active snapshot; revalidate before Worker business reads; point/missing-row reads record the appropriate snapshot evidence; finalization returns evaluation/dependency evidence without mutation publication. | `ApplicationQuerySystem`, `applicationQuerySnapshot` and the native query contract below. Query Worker and lower snapshot behavior have distinct witnesses. |
| Bounded index reads | The query RPC and mutation journal expose `queryIndexRange` with admitted table/index descriptors, encoded bounds, limits and a page/end verdict. Historical index membership, eligibility and range dependencies belong to persistence. | `ApplicationQueryRpcCapability`, journal `SessionJournalIndexedQueryOperationV1` and `appIndexEntries` are executing owners. A source/owner test or mocked RPC check alone does not establish a complete native Worker range scenario on both drivers. Retain that proof as a slice gate. |
| Incoming relations | The Standard relation system provides bounded incoming-source lookup; the query Worker has an optional required-on-use `takeIncomingRelationSources` capability. Relation authorization, snapshot and dependency behavior remain with their owners. | The RQ01 integration deliberately proves a private relation query without Worker or mutation authority. It does not prove every Worker relation path or arbitrary cross-framework relation composition. |
| Application mutations | Current mutation composition reaches the restricted journal for `get`, `insert`, `patch`, `replace`, `delete` and bounded index operations. Preserve pending visibility, exact dependencies, schema/identity validation, outer-only publication, conflict retry eligibility and durable replay/outcome identity. | Native mutation and nested-call contracts exercise real analysis/activation/runtime/commit composition. Retained scalar/index/storage witnesses remain owner regressions. This does not authorize native hook replay. |
| Internal query/mutation calls | Current Worker construction admits manifest internal query/mutation entries; nested execution stays under the correct root lifetime, budgets, pending state and no-child-commit contract. Rejected admitted children fail the whole invocation even after parent catch. | The [current migration owner](../../../../roadmaps/49-application-analysis-migration.md) selects invocation-sticky failure and retires old SAP/FSV runtime profiles. The [historical internal-call record](../../../../roadmaps/45-private-internal-user-code-calls.md) is distinct. The shared current native mutation contract includes the genuine caught-child-write failure witness. Internal exports are not externally callable public functions. |
| Counts and aggregates | The native logical relational store has `count` and bounded `aggregate` contracts; those are shared core/native consumer obligations where admitted. | [Logical document model](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts) owns them. The inspected Application Worker capability does not expose a count/exists syscall. Do not infer Application count support from native storage capability or the new design's intended complete-query contract. |
| SDK query conveniences | [query.ts](../../../../packages/flarex/src/query.ts) exports `collect`, `take`, `first`, `unique`, ordering and pagination helpers over a supplied query executor. | These exports do not establish that every helper is connected to the current restricted Application Worker or that general filtering/aggregation is supported. Preserve named executing consumers; broader support requires its own connected witness. |

The older [experimental Application host](../../APPLICATION.md) is a separate,
bounded proof. Its JSON/numeric scalar, complete ascending-range and unsupported
feature limits must not be substituted for the current active Application
runtime's support level. Conversely, active runtime support does not establish
that the experimental candidate already implements it.

## Query, finite mutation and durable obligations

Queries close their snapshot and do not acquire mutation publication authority.
The [session owner map](../../../../packages/persistence-postgres/src/execution/session/README.md)
distinguishes `finiteRoot` and `durableOperations` entry/replay contracts.
[finiteActivation](../../../../packages/persistence-postgres/src/execution/session/finiteActivation.ts)
and [finiteSession](../../../../packages/persistence-postgres/src/execution/session/finiteSession.ts)
own finite reservation, authentic capture and recovery;
[durableActivation](../../../../packages/persistence-postgres/src/execution/session/durableActivation.ts)
retains independently durable operation activation/replay. Neither is a general
permission to hold SQL across Application code or merge all native profiles.

The current
[finite execution owner](../../../../packages/executor/src/mutation/execution/finitePointMutationExecution.ts)
checks authentic capture/claim state, freezes/verifies complete work and settles
through the point commit owner. Its
[recovery owner](../../../../packages/executor/src/mutation/recovery/finitePointMutationRecovery.ts)
resolves existing outcomes before eligible continuation or whole-attempt retry.
The new read path must not silently retire stored session formats, attempt
anchors, grant identity, cancellation or unknown-COMMIT obligations. Inventory
their actual retained consumers/data before removing a profile or schema.

## Actions, tasks and reactivity consumers

Actions and tasks are retained callers of Application query/mutation and shared
authority/outcome infrastructure, not a request to rewrite those engines.
[ApplicationActionSystem](../../../../packages/standard-application-invocation/src/ApplicationActionSystem.ts)
and [action host composition](../../../../packages/standard-application-invocation/src/ApplicationActionHostComposition.ts)
retain direct invocation/effect uncertainty, source authority, callback and result
contracts. Remote effects stay outside the Application persistence transaction.

[ApplicationTaskComputeDelivery](../../../../packages/standard-application-invocation/src/ApplicationTaskComputeDelivery.ts)
receives distinct query and mutation callback authorities. The
[Task owner](../../../../roadmaps/durable-task-engine/README.md) and clean API
roadmap own task start/read/wait/cancellation/history and remaining scheduling,
public and hosted gates. Retain supported callback, result, recovery and lifecycle
behavior while changing the core beneath it. Do not infer scheduled or production
Task support from these exports.

The query system's evaluation receipts feed the existing
[query-sync owner](../../../../roadmaps/query-sync-engine/README.md). Dependency
and timestamp changes must migrate that real consumer where affected. This
baseline does not claim the replacement has subscription hosting or reopen
replication.

## Existing executable witnesses to preserve

These files were inspected as source; none was executed for this baseline.
PostgreSQL suites use the ordinary-role environment/URL guards at their owner;
their presence or a skipped run is not a passing real-database result.

| Witness family | What its assertions establish within the declared fixture |
| --- | --- |
| [Native query contract](../../../../packages/system-test/test/contracts/applicationNativeQueryContract.ts), [PGlite entry](../../../../packages/system-test/test/integration/applicationNativeQuery.test.ts), [PostgreSQL entry](../../../../packages/system-test/test/integration/applicationNativeQuery.postgres.test.ts) | Fresh Worker/source loads, snapshot revalidation and point reads; head movement selects a new revision. The PostgreSQL entry also covers blocked-writer snapshot pinning, retained-history floor and client release. |
| [Native mutation](../../../../packages/system-test/test/integration/applicationNativeMutation.test.ts), [PostgreSQL entry](../../../../packages/system-test/test/integration/applicationNativeMutation.postgres.test.ts), [nested contract](../../../../packages/system-test/test/contracts/applicationNativeMutationContract.ts) | Atomic commit/replay identity, duplicate/in-progress handling and request-key mismatch; OCC whole-attempt behavior and authority movement. Nested staged delete is visible to child/parent and publishes one outcome/tombstone under the parent. |
| [Standard query owner tests](../../../../packages/standard-application-invocation/test/ApplicationQuerySystem.test.ts), [relation owner tests](../../../../packages/standard-application-invocation/test/ApplicationRelationQuerySystem.test.ts) | Input/auth/source coherence, capability forwarding, receipts and refusal before business reads; these owner tests must not be relabeled full hosted integration proof. |
| [Private relation PGlite entry](../../../../packages/system-test/test/integration/applicationRelationQuery.pglite.test.ts), [PostgreSQL entry](../../../../packages/system-test/test/integration/applicationRelationQuery.postgres.test.ts) | Exact private logical incoming-relation read and authorization/shape refusal, with no Worker/mutation authority claim. |
| [Rows](../../../../packages/persistence-postgres/test/storage/documents/appRows.test.ts), [PostgreSQL rows](../../../../packages/persistence-postgres/test/storage/documents/appRows.postgres.test.ts), [indexes](../../../../packages/persistence-postgres/test/storage/indexes/appIndexEntries.test.ts), [PostgreSQL indexes](../../../../packages/persistence-postgres/test/storage/indexes/appIndexEntries.postgres.test.ts) | Historical row/index semantics at their persistence owners; preserve them when adapting the PostgreSQL miss reader. |
| [Native actions](../../../../packages/system-test/test/integration/applicationNativeAction.test.ts), [PostgreSQL actions](../../../../packages/system-test/test/integration/applicationNativeAction.postgres.test.ts) | Existing direct action replay/effect and child-call obligations in their fixtures. |
| [Connected tasks](../../../../packages/system-test/test/integration/applicationTaskSystemConnected.test.ts), [PostgreSQL tasks](../../../../packages/system-test/test/integration/applicationTaskSystemConnected.postgres.test.ts), [fresh-host takeover](../../../../packages/system-test/test/integration/applicationTaskSystemFreshHostTakeover.test.ts), [PostgreSQL takeover](../../../../packages/system-test/test/integration/applicationTaskSystemFreshHostTakeover.postgres.test.ts) | Real Task Worker query/mutation callbacks, supervision, durable outcomes and recovery for the selected modes. |

The [architecture test map](../../../../roadmaps/execution-architecture/architecture.md#find-the-corresponding-tests)
and [executor guide](../../../../packages/executor/README.md) own the wider owner/
mixed-consumer enumeration. Preserve the relevant native graph rather than
copying business logic into a new benchmark harness.

## Source capture and open gates

Capture date: 2026-10-28. The following finite list identifies the inspected live
entry points, contracts, generated Worker artifact, first-slice owners and source
fixtures. These hashes describe bytes, not passing tests or an exhaustive
transitive source closure. Per-app artifact authority still comes from the
actual source root, manifest, schema/function-catalog/publication and target
digests checked by `ApplicationWorkerDefinition`; retain those exact installed
identities when a concrete workload is selected.

Repository HEAD at capture: `2fadeab2ae2dafc0283c60813a26f21f52cadbde`.

SHA-256:

```text
8ed21a8ea1d59870455800f72474374ad8efe0b0d1bcc4217bb41355e4422e93  packages/application-invocation/src/Query.ts
81514cbe4c1c99145415a9766ceb781e4d0de7a118936c07cbc142d313f974a5  packages/standard-application-invocation/package.json
2cbded4dcfa24694dd19ddeaf11c8dea9de512ee976de4c5e1ba61e0b8ffdd73  packages/standard-application-invocation/src/ApplicationQuerySystem.ts
e37a79bc6ae3128f8096a24f66ca30875ece4e77a905b7489ba4d4c6a0d68404  packages/standard-application-invocation/src/ApplicationMutationSystem.ts
5e7c5aaa3e0a2f72a5aa3b7d520f3782593c650b3063a40432602925cce91f83  packages/standard-application-invocation/src/ApplicationRelationQuerySystem.ts
caa93c0c6a869be3dd3b5955126776c021b9139479d8743c07e4d06b4d5e5fb3  packages/function-runtime/src/functionApiCore.ts
a261f456a9f6094c9447a6e695860a37fa604f3394a022cb4cbbd536c77ddf40  packages/function-runtime/src/applicationFunctionRuntimeV1.ts
cd207e9f175ab8c189ad9448e8fd1cf982b9c2cd6d94b10029237d338bd6d820  packages/flarex-protocol/src/application-worker-v1.ts
93ca63161677cfa0b236463cb9e3a90e8f1726ca40ae39be7d5d3cfeec698c2f  packages/flarex-backend/src/artifactRuntime/ApplicationWorkerDefinition.ts
bcd661b46cedbab34149ee892f017a697ae7e5d1f8d8f8eead96a4fd0eb282ea  packages/flarex-backend/src/artifactRuntime/ApplicationWorkerCore.generated.ts
f80d6d6ec9e86d83897e9fb5a5273032eaf7760e0ab621d4eedda66165ef1b26  packages/flarex-backend/src/artifactRuntime/ApplicationPointMutationRunner.ts
36d6932ef92642299db36bd541e0f898fc4191834afe51bffb5f1caf4823eecd  packages/executor/src/mutation/journal/applicationPointMutationJournalCapability.ts
d22aa02b647d772810f26625924ebc9c46c2426ec9d2be4b69dcafcfe290a2da  packages/executor/src/mutation/execution/finitePointMutationExecution.ts
2ed7eac4c555227b9815c906a90d319b8bc9b8e682669737de6f2f934227a4e7  packages/persistence-postgres/src/application/applicationQuerySnapshot.ts
65f2dfbeb1bd638046c1a39d4fd0ea2b96a25548e12843b0d34a729ac83bf9c1  packages/persistence-postgres/src/application/applicationMutationAdmission.ts
c504f36d069545e94e185fdd1cc2432906e92cbd43f9f9a84596a8724b30ddb6  packages/persistence-postgres/src/execution/journal/contracts.ts
d43ea3e9db2fa25884b11ea20757c82747714021741b63707c18dd51be5a5abd  packages/persistence-postgres/src/execution/session/finiteActivation.ts
10831c77015b109a7e3005838bb848b47454882aa9a76daf6d9fbbeb8d54cd44  packages/persistence-postgres/src/execution/session/durableActivation.ts
4cf244ffdc54cc65c7cd238062b30d0e908c95c3d09960b0eb75cfc78c6d6ed4  packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts
3497bb32b515680197217f0460fd1ea0771e621e9f21879c7b1e867f6e7ad682  packages/system-test/support/applicationNativeQueryHarness.ts
7ee0f288ee264c59cd9364df0e36e34d3cd3e2a37a66f6f5dcf996e16e18b7ee  packages/system-test/support/applicationNativeMutationHarness.ts
4112245bfce686425496428fcaa7f952ea0c3ac60f0af264e58bcfb8ed3c03b2  packages/persistence-postgres/src/application/activation/capture.ts
77149ec65a7607db90180d8b97d3246b612aaa584e2771a79d9cbc0478df8a32  packages/persistence-postgres/src/application/activation/metadataProjection.ts
e2f28a9f422b2a86742b3366fb13665bb8a916389f4f9325ca80e76113d02853  packages/flarex-protocol/src/logical-storage-requirements.ts
7a7cc2c69344ce67a460112e6b6fc4b03fa37f26df5474baea821f902a409731  packages/flarex-protocol/src/relational-schema/access.ts
```

Relevant shared-worktree changes were already present in
`application/activation/capture.ts`, `activation/metadataProjection.ts`, protocol
`logical-storage-requirements.ts` and `relational-schema/access.ts`. They are
included in this capture as dirty inputs, not claimed as owned or reviewed
by this task. Existing executor benchmark logs/prepared-database evidence were
also dirty and are not new measurements. No source, runtime or foreign change
was modified by this documentation task.

Before accepting a replacement, close the affected source/workload closure,
confirm owner handoffs and rerun applicable owner/consumer witnesses on both
database lanes. Explicit gates remain for full Worker range/relation branch
coverage, any new count/query-builder exposure, action/task callback continuity,
all relevant writers, deployed/actual DO behavior and complete-request
performance. Standalone Application targets and native mutation targets remain
separate under [VALIDATION.md](../../VALIDATION.md#acceptance); no absent baseline
or missing capacity target is invented by this record.
