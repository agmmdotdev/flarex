# Flarex Roadmaps

## Purpose And Authority

This folder contains living domain truth, focused execution plans,
compatibility inventories, legacy proposals, and completed initiative records.
Those categories are intentionally different. A file's presence under
`roadmaps/` does not make every statement in it an active requirement.

Roadmaps do not replace more precise authorities:

- code, schemas, and tests own exact implemented behavior;
- accepted design notes own cross-domain architecture according to
  [`../AGENTS.md`](../AGENTS.md);
- active domain roadmaps own current domain architecture, rationale, status,
  gaps, and direction;
- focused plans own ordered implementation gates; and
- Git commits and pull requests own chronological implementation history and
  verification receipts.

Use [`_domain-template.md`](./_domain-template.md) when creating or compacting
a living domain roadmap.

## Maintenance Rule

Update a roadmap when a durable domain fact changes: scope or ownership,
architecture or invariants, rationale, Convex compatibility, implemented
capability status, known gaps, target direction, sequencing, or correctness
gates. A code touch alone is not a reason to update a roadmap.

Do not add commit IDs, commit messages, per-turn change summaries, reviewer
receipts, verification command receipts, or chronological checkpoint sections
to living roadmaps. Existing accumulated checkpoint sections are compaction
inputs; do not extend them. Older file-local append instructions are
superseded by this policy.

When prose and implementation differ, determine whether the implementation
drifted or an accepted decision changed. Fix accidental code drift; update
stale roadmap truth when the direction genuinely changed. Never rewrite a
roadmap merely to legitimize an unreviewed divergence.

## Classification Meanings

| Classification | How agents should use it |
| --- | --- |
| Active authority | Read before changing that domain. Keep its current architecture, status, gaps, and direction accurate. |
| Focused execution plan | Use for ordered gates and exit criteria. A checked item is status, not a request to append history. |
| Accepted deferred contract | Preserve its decisions as prerequisites, but do not start implementation before the owning execution gate. |
| Active inventory — compaction pending | Useful current behavior and migration evidence, but verify every claim against code and higher authorities. Compact before treating it as durable domain truth. |
| Prototype or compatibility inventory | Use as regression and provenance evidence. Port only still-intended semantics; migration inputs exist only when a shipped obligation is proven. It does not define the replacement target. |
| Legacy or superseded | Do not extend or implement from it. Use only for provenance and regression/migration context. |
| Completed initiative record | Historical closeout and proof context. It is not an active backlog or architecture authority. |

## Start Here

For a first orientation to how one real FlarexDB point mutation crosses the
Dynamic Worker, trusted executor, commit compiler, and Postgres boundary, start
with the
[`Runtime Entry Map`](./flarexdb-foundation/README.md#runtime-entry-map).
It distinguishes the routed `legacy_v1` runtime, the private `flarexdb_v1`
foundation, the first end-to-end `C07` milestone, and the conditional SessionDO
journal optimization.

When changing architecture or implementing a gate, read authorities in this
order:

1. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
2. [`../design-notes/flarex-commerce-cms-v1-schema-cutline.md`](../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
3. [`flarexdb-foundation/README.md`](./flarexdb-foundation/README.md)
4. The focused foundation plan for the active gate
5. The relevant active domain authority below

Protocol-only `O03-A1`, verified-authentication-provenance `O03-A2a`, and the
host-neutral policy, issuance/signing, verification, and key-lifecycle kernel
at `O03-A2b` are complete. The three-checkpoint `O03-A2` sequence and parent
`O03-A` are complete: corrected O03-A2c closes located current-epoch admission
and schema-neutral two-sided point-mutation preparation. Operational revocation
and hosted Worker/key adapters are deferred to their first consumers. The
sequence is owned by
[`flarexdb-foundation/02-occ-and-transactions.md`](./flarexdb-foundation/02-occ-and-transactions.md)
with domain rationale in
[`31-hosted-project-identity-and-auth.md`](./31-hosted-project-identity-and-auth.md).

## Active Domain Authorities

| Roadmap | Domain authority |
| --- | --- |
| [`06-dynamic-worker-execution.md`](./06-dynamic-worker-execution.md) | Managed execution artifacts, local Miniflare and hosted Dynamic Workers, sandbox capabilities, runtime identity, and syscall execution. |
| [`09-sdk-and-cli-fork.md`](./09-sdk-and-cli-fork.md) | Public SDK, generated APIs, clients/React, CLI/codegen/deploy, test package relationship, and npm distribution. |
| [`10-runtime-validation.md`](./10-runtime-validation.md) | Layered validators, protocol decoding, active metadata checks, commit validation, stored corruption detection, and error boundaries. |
| [`11-testing-and-simulation-strategy.md`](./11-testing-and-simulation-strategy.md) | Evidence lanes, proportional validation, real-Postgres/Cloudflare proof boundaries, cleanup/receipts, and deterministic simulation direction. |
| [`13-convex-first-system-porting.md`](./13-convex-first-system-porting.md) | Cross-system rule: inspect/port Convex first and document narrow Flarex divergences. |
| [`14-local-dev-server.md`](./14-local-dev-server.md) | Local runtime composition, Vite lifecycle, reload cutover, persistence, cleanup, and legacy/Postgres mode selection. |
| [`15-test-sdk.md`](./15-test-sdk.md) | Public real-runtime test harness, typed invocation helpers, client/WebSocket bridge, lifecycle/reset, and trusted test-authority limits. |
| [`16-package-boundaries.md`](./16-package-boundaries.md) | Workspace package ownership, dependency direction, public/internal surfaces, host composition, and boundary enforcement. |
| [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md) | Source-package analysis authority, candidate push lifecycle, final codegen, artifact validation, and activation gates. |
| [`18-react-client-hooks.md`](./18-react-client-hooks.md) | React provider/hooks, query state and subscription lifecycle, mutation ergonomics, routing boundaries, and parity gates. |
| [`20-postgres-executor.md`](./20-postgres-executor.md) | Trusted Postgres executor, hosted Worker, storage generations, and replacement data authority. |
| [`21-cloudflare-freshness-cache.md`](./21-cloudflare-freshness-cache.md) | Postgres-authoritative sync, per-scope coordination, recovery, delivery boundaries, and deferred caches. |
| [`35-commit-compiler-and-session-intent.md`](./35-commit-compiler-and-session-intent.md) | Logical session journal, trusted planner/executor split, exact snapshots, idempotency, and conditional SessionDO journaling. |
| [`42-standard-application-apis.md`](./42-standard-application-apis.md) | Stable workspace-internal application stage APIs; definition preparation and request-scoped authenticated analysis are implemented, with registration and invocation still gated. |

## Cross-Cutting Engineering Guidance

| Guidance | Purpose |
| --- | --- |
| [`effect-native-guidance/`](./effect-native-guidance/README.md) | Active Effect implementation guidance derived from current executor, Postgres persistence, protocol, backend, host, and test patterns. It defines target boundaries and incremental adoption rules without becoming a file-by-file migration plan. |

## Accepted Architecture Directions Pending Preflight

These records preserve an accepted boundary and rationale, but deliberately do
not authorize implementation. Complete and accept the mandatory preflight in
the owning record before creating packages, moving contracts, or migrating
consumers.

| Decision record | Classification | Purpose |
| --- | --- | --- |
| [`39-canonical-declarative-program-contract.md`](./39-canonical-declarative-program-contract.md) | Accepted direction; preflight required | Standard versioned contract chain between developer definitions, direct fixtures, artifact generation, analysis, verification, and runtime projection without making SDK objects downstream authority. |
| [`40-host-neutral-function-runtime.md`](./40-host-neutral-function-runtime.md) | FAC01-FAC19 complete; FAC20 preflight required | Shared user-code execution semantics with Cloudflare Dynamic Worker and in-process adapters while preserving executor and FlarexDB authority and retaining platform evidence. |
| [`durable-task-engine/README.md`](./durable-task-engine/README.md) | DTE04-A1 complete; Roadmap 04 active | Aggregate/effect JSON envelopes and the lifecycle projection are implemented; READ COMMITTED locking, database-clock, retry, and discovery decisions are closed for later checkpoints, while missing canonical task-definition and input-reference owners still block DDL, run creation, and concrete adapters. |

## Foundation Execution And Deferred Contracts

| Plan | Classification | Purpose |
| --- | --- | --- |
| [`flarexdb-foundation/README.md`](./flarexdb-foundation/README.md) | Focused execution index | Master status, wave order, hosted gate, and cross-plan invariants. |
| [`flarexdb-foundation/01-schema-and-migrations.md`](./flarexdb-foundation/01-schema-and-migrations.md) | Active focused execution plan | Target schema/catalog, codecs, app storage, readiness, activation, prototype retirement, and conditional shipped-state migration. |
| [`flarexdb-foundation/02-occ-and-transactions.md`](./flarexdb-foundation/02-occ-and-transactions.md) | Active focused execution plan | Exact snapshots, OCC dependencies, atomic commit lane, retry classes, retention, clean prototype retirement, and conditional live migration. |
| [`flarexdb-foundation/03-commit-compiler.md`](./flarexdb-foundation/03-commit-compiler.md) | Active focused execution plan | Retired standalone `C01`, completed inert `C02` protocol, active `C03`–`C09` compiler gates, and conditional `C07A`. |
| [`37-production-redelivery-and-c06b.md`](./37-production-redelivery-and-c06b.md) | Active focused execution plan | Production exact-attempt runtime hosting, one bounded scheduled-event composition, trigger activation, and stable C06-B finish/lost-outcome dispatch. |
| [`41-private-standard-application-composition-and-real-system-harness.md`](./41-private-standard-application-composition-and-real-system-harness.md) | Active focused execution plan | Internal deterministic application corpus, workload policy, and private real-system harness over the Standard Application APIs and existing production-domain owners. |
| [`43-first-flarexdb-system-api-vertical.md`](./43-first-flarexdb-system-api-vertical.md) | Active; `FSV01`-`FSV06`, `C03-V`, `FSV06-A1`, `FSV06-A2`, and no-go preflight `FSV07-P` complete | The first relation-free private Standard vertical reaches an authoritative SAP04 point mutation through shared-primary activation, scoped validation, candidate-bound R2 exact runtime dispatch, and the existing C07 owners. FSV07-P identifies the exact legacy `/invoke` caller and blocks routing on H05-B, S02-D2, S02-E, hosted redelivery/observability, request-key, identity, and response-parity gates. Every production caller remains unchanged. |
| [`44-second-flarexdb-system-api-point-query-vertical.md`](./44-second-flarexdb-system-api-point-query-vertical.md) | Complete private vertical; `PQV-A1`, `PQV-A2`, and `SAP05` complete | The second private vertical now reaches one validated Standard point-query result through a Scope-owned target-native snapshot and candidate-bound R2/Workerd runtime, with zero mutation publication. It remains route-independent and does not reopen roadmap 43, authorize FSV07, or stabilize a public query SDK. |
| [`45-private-internal-user-code-calls.md`](./45-private-internal-user-code-calls.md) | `SAP06-A1`, `SAP06-A2`, and `SAP06-A3` complete privately | The combined mutation internal-call profile keeps query and mutation children inside the exact SAP04 Worker, parent C03 journal/overlay, OCC, and outcome under the accepted no-child-savepoint first-slice semantics; no schema, route, production caller, or child publication is added. |
| [`46-private-standard-edge-action-vertical.md`](./46-private-standard-edge-action-vertical.md) | AAV-A1/AAV-A2/SAP07 accepted and complete privately | One private route-independent public action composes active selection, AAV-A1 durable request/outcome and expiry-recovery authority, the AAV-A2 candidate-bound host, and R2 result replay. It adds no route, schedule, durable-task lifecycle, or production caller. |
| [`47-aav-a1-direct-action-and-shared-effect-authority.md`](./47-aav-a1-direct-action-and-shared-effect-authority.md) | Accepted and complete privately | Direct action request/outcome authority uses one invocation row; shared external-effect uncertainty uses one evidence row and distinct parent subjects. Canonical bodies remain in R2, Task System lifecycle is not duplicated, and AAV-A2/SAP07/routes remain excluded. |
| [`48-aav-a2-candidate-bound-edge-action-runtime.md`](./48-aav-a2-candidate-bound-edge-action-runtime.md) | Accepted and complete privately | Implements the private candidate-bound action target/profile/ABI, host-owned canonical egress policy, fresh Worker Loader isolation, authenticated outbound/callback bridges, and resource ceilings with no schema, SAP07, route, or production behavior. |
| [`flarexdb-foundation/04-payload-relational-contract.md`](./flarexdb-foundation/04-payload-relational-contract.md) | Accepted deferred contract | Relation semantics and stable occurrence identity required before `R01`/`R02`/`S12`/`C09`. |
| [`flarexdb-foundation/05-managed-schema-deployment.md`](./flarexdb-foundation/05-managed-schema-deployment.md) | Accepted deferred contract | Migrationless developer experience and managed schema safety classes; implementation remains deferred. |

## Active Inventories Awaiting Compaction

These files have an active durable boundary but still mix it with chronological
implementation evidence. Read the named current section, verify against higher
authorities/current code, and compact the historical tail before promoting the
whole file to an active domain authority.

| Roadmap | Current durable boundary |
| --- | --- |
| [`31-hosted-project-identity-and-auth.md`](./31-hosted-project-identity-and-auth.md) | The top section records completed O03-A grant authority, including A2c's located-epoch and two-sided preparation boundaries; operational revocation/hosted adapters remain deferred, and the identity-plumbing tail remains historical inventory. |

## Prototype And Compatibility Inventories

These files preserve implemented prototype behavior, regression evidence, and
conditional migration inputs if a shipped obligation is ever discovered. Their
existence does not create a compatibility requirement. Replacement architecture
lives in the active authorities and foundation plans.

| Roadmap | Replacement authority |
| --- | --- |
| [`01-backend-data-model-and-do-shape.md`](./01-backend-data-model-and-do-shape.md) | FlarexDB accepted design and foundation schema plan |
| [`03-occ-and-transactions.md`](./03-occ-and-transactions.md) | Foundation OCC plan and roadmap 35 |
| [`04-indexes.md`](./04-indexes.md) | Foundation schema/codec plan |
| [`05-sync-and-subscriptions.md`](./05-sync-and-subscriptions.md) | Roadmap 21 |
| [`05-sync-protocol-implementation.md`](./05-sync-protocol-implementation.md) | Roadmap 21 plus current protocol/code/tests |
| [`23-hosted-runtime-core.md`](./23-hosted-runtime-core.md) | Roadmap 20 and the foundation hosted proof gate |

## Legacy Or Superseded Files

Do not extend these files as active design.

| Roadmap | Reason |
| --- | --- |
| [`02-schema-placement-and-shards.md`](./02-schema-placement-and-shards.md) | Durable Object shard/storage assumptions are superseded by Postgres `scope_id` authority. |
| [`07-cross-shard-workflows.md`](./07-cross-shard-workflows.md) | Proposed PartitionDO coordinator model is superseded; no accepted generic cross-shard transaction API exists. |
| [`08-projections.md`](./08-projections.md) | PartitionDO-driven global projection proposal is unimplemented and not an active replacement requirement. |
| [`12-repository-operations.md`](./12-repository-operations.md) | Current repository workflow, standing reviewer ownership, and shared Effect-review boundary; `AGENTS.md` remains the workflow authority and Git owns chronological history. |
| [`19-function-routing-and-shard-policy.md`](./19-function-routing-and-shard-policy.md) | Public shard/partition routing policy is legacy prototype behavior. |
| [`breif-left-things-to-do-after-effect-ts-migration.md`](./breif-left-things-to-do-after-effect-ts-migration.md) | Point-in-time status snapshot is stale; current status lives in domain authorities and focused plans. |

## Completed Initiative Records

These files are retained for closeout evidence and provenance, not as active
backlogs. Completed goal checklists must not be restarted simply because they
contain old “next slice” or append-history instructions.

| Roadmap | Completed initiative |
| --- | --- |
| [`36-stored-attempt-capability-runtime-modularization.md`](./36-stored-attempt-capability-runtime-modularization.md) | Stored-attempt capability runtime modularization |
| [`22-effect-migration-checklist.md`](./22-effect-migration-checklist.md) | Effect migration |
| [`24-shared-artifact-runtime-host-kit.md`](./24-shared-artifact-runtime-host-kit.md) | Shared artifact-runtime host kit |
| [`25-shared-artifact-runtime-host-kit-goals.md`](./25-shared-artifact-runtime-host-kit-goals.md) | Host-kit goal checklist |
| [`26-execution-artifact-lifecycle-parity.md`](./26-execution-artifact-lifecycle-parity.md) | Execution artifact lifecycle parity |
| [`27-execution-artifact-lifecycle-parity-goals.md`](./27-execution-artifact-lifecycle-parity-goals.md) | Lifecycle parity goal checklist |
| [`28-authoritative-analysis-effect-quality.md`](./28-authoritative-analysis-effect-quality.md) | Authoritative backend analysis quality stream |
| [`29-authoritative-analysis-effect-quality-goals.md`](./29-authoritative-analysis-effect-quality-goals.md) | Analysis quality goal checklist |
| [`30-effect-runtime-boundary-cleanup.md`](./30-effect-runtime-boundary-cleanup.md) | Effect runtime-boundary implementation stream; retain the enforcement rule, but the slice checklist is complete pending only historical closeout wording. |
| [`32-hosted-project-identity-and-auth-goals.md`](./32-hosted-project-identity-and-auth-goals.md) | Completed hosted identity/auth goal archive |
| [`33-auth-provider-platform.md`](./33-auth-provider-platform.md) | Completed auth-provider platform boundary and final audit record |
| [`34-auth-provider-platform-goals.md`](./34-auth-provider-platform-goals.md) | Completed auth-provider platform goal archive |

## Compaction Status

The current active-inventory queue is complete. Future compaction should still
be driven by authority risk rather than file size: inspect accepted design and
current evidence, preserve only durable decisions and open gates, remove
chronological narration, and separately commit each domain-scoped rewrite.
