# Dependency validation and evidence lifetime

Status: **focused proposal for contract agreement; no runtime cutover.** This
preflight makes the next validation-cost direction concrete. The
[accepted prepared-execution rule](../../design-notes/flarex-db-accepted-design.md#prepared-execution-integrity),
[finite-root contract](./08-fundamental-latency-redesign-preflight.md),
[attempt-local boundary](./11-attempt-admission-preflight.md) and
[compact checked-access contract](./12-compact-checked-access-preflight.md)
remain current until the decisions below are accepted and proved. Preparing
this proposal does not authorize a new metadata threat or protection contract.

## Connected outcome and reason

Recommend one connected cutover for existing private finite Product, selected
Payload and Medusa workflow consumers: internal checked reads validate a complete
trusted source dependency closure rather than all candidate definitions, with
bounded existing read batching where equivalent. Distinguish immutable schema
evidence from fresh authority/readiness; keep current full canonical bodies,
heads, membership authentication and physical checks, plus full entry, aggregate
seal and publication. Wider immutable reuse is a separate decision gate.

Source-complete closure is the first safe bound, not a promised minimal plan or
sufficient latency gain. An exact operation closure may replace that bound in
this same connected cutover only if the executing storage planner proves
completeness for every admitted path. Otherwise use the source bound and retain
full checks for paths whose closure is unproved. Do not create a universal
dependency registry, parallel evaluator or adapter-owned readiness policy.

The [retained compact-access evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/compact-checked-access/README.md)
has 120 successful traced/untraced samples, fewer dispatches and higher warm
latency; no cause for the latency changes is established. Product, Product plus
Payload, mixed workflow and standalone workflow warm p50 are
867.8 / 1,067.8 / 1,954.1 / 303.8 ms; traced SQL counts are
990 / 1,274 / 1,997 / 354 and transaction counts 41 / 52 / 78 / 6.
Repeated validation remains an observed work owner. Table-reference diagnostics
cannot attribute CPU or causal request cost; older Node isolate inspector
evidence is not a current complete CPU profile.

The nearest proof is the same real connected graph with unchanged snapshot,
pending visibility, native lifecycle, events and authoritative outcome. This
proposal adds no public API, framework operation, hosted activation, durable
workflow effect, core OCC relaxation, schema/data deletion or advanced evolution.
It adds no new relation/delete/search capability solely to exercise closure and
does not repair the separate publication-body proof limitation. Postgres remains
the only settlement authority; no SQL transaction spans
framework callbacks, sandbox execution, foreign capture or remote effects.

## Existing owners and executing callers

| Owner | Current behavior and proposed responsibility |
| --- | --- |
| [Source admission](../../packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts) | `prepareLogicalSourceEvidence` prepares whole-candidate readiness before filtering evaluator tables, indexes and unique definitions by source. `withBinding` authenticates current selected binding and Application evidence. Keep contract/source/head authentication here; derive trusted dependency selection without letting adapters select a weaker proof. |
| [Logical readiness](../../packages/persistence-postgres/src/logicalStorageReadiness.ts) and [binding check](../../packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts) | `verifyLogicalSchemaBindingInTransaction` invokes full `prepared.inspect`. It checks all required indexes, the complete closed unique set and search readiness. Separate full acceptance from selected dependency readiness explicitly; neither verdict may masquerade as the other. |
| [Application admission](../../packages/persistence-postgres/src/logicalDocuments/applicationAdmission.ts) | `withAdmission` calls selected `withBinding`; this owner does not issue the document/relational participant lifecycle or per-read `verifyBinding`. Keep native Application/journal behavior intact and migrate only actual affected callers. |
| [Document](../../packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts) and [relational](../../packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts) admission | Source construction, entry pinning, per-read `verifyBinding`, seal admission and commit-authority verification share `withBinding`. Migrate finite internal reads together; entry, seal, publication, standalone and durable consumers retain full semantics. |
| [Working set](../../packages/persistence-postgres/src/logicalDocuments/workingSet.ts), [query planner](../../packages/persistence-postgres/src/logicalDocuments/query.ts), [relational query](../../packages/persistence-postgres/src/logicalDocuments/relationalQuery.ts) | Actual point, predicate, historical unique, range and hydration paths determine data dependencies. Own bounded read composition here, preserving pending overlay and exact positive/negative conflict evidence. |
| [Strong-reference projection](../../packages/persistence-postgres/src/logicalStrongReferenceProjection.ts) and [foreign keys](../../packages/persistence-postgres/src/logicalDocuments/relationalForeignKeys.ts) | Source/target identities, target keys, reverse indexes, liveness and deletion behavior contribute mandatory dependencies. A source bound must include these transitive obligations or remain full. |
| [Journal store](../../packages/persistence-postgres/src/sessionJournalStore.ts), [checked kernel](../../packages/persistence-postgres/src/transactionSessionActivation.ts), [publication](../../packages/persistence-postgres/src/pointCommitTransaction.ts) | Own exact fenced root, checked transaction, aggregate seal, recovery and settlement. Retain full scalar authority and full terminal admission; scope shared evidence to its accepting transaction and revoke it on exit. |
| [Binding repository](../../packages/persistence-postgres/src/frameworkSchema/binding/repository.ts), [Application projection](../../packages/persistence-postgres/src/applicationBindingProjection.ts), [protected epoch](../../packages/persistence-postgres/src/preparedMetadataEpoch.ts) | Keep full canonical selected bodies/sidecars and existing protected legacy Application exception. Wider immutable reuse requires its own complete writer proof, not a digest or process identity alone. |

The executing consumer chain is the private Worker/executor participant bridge
into journal admission, then `prepareLogicalSourceEvidence` through the three
source admission owners. Native [Product](../../packages/medusa-adapter/src/product-attempt.ts)
uses the borrowed relational facade; selected Payload Local API access,
validation and hooks use document admission; finite
[workflow runtime](../../packages/medusa-adapter/src/workflow-runtime.ts) composes
Product, Pricing and Link sources through the same borrowed root. Per-read
verification precedes working-set database reads; aggregate seal reauthenticates
admitted child capabilities, and publication verifies source contributions in
its own transaction. The existing transaction-local sharing scope is reusable
mechanics, not a cross-transaction admission cache.

Pinned [Convex transaction](../../../../crates/database/src/transaction.rs)
owns read/write/index/schema state and records schema lookup dependencies. This
supports evidence following its owner, not PostgreSQL parity or SQL held across
callbacks. Exact framework anchors remain with [01](./01-application-product-attempt-preflight.md),
[02](./02-payload-local-api-attempt-preflight.md) and [03](./03-finite-medusa-workflow-preflight.md).

## Proposed read contract

1. Authenticate the finite root and full selected source at entry. Prepare
   detached bounded schema evidence through existing canonical decoders and
   issuer/lifetime owners. Method grants authorize an invocation; they do not
   identify the tables, indexes, constraints or relations it will read.
2. Before each actual internal database read, retain fresh exact scope,
   placement, storage generation/fence, revocation, session/lease/claim/journal
   lifecycle, expiry and post-lock database-time checks. Compare current binding,
   source and Application pins; preserve the admitted snapshot and reject
   mismatch rather than reinterpret prepared rows. Keep final full protected
   epoch/catalog verification in the accepting transaction.
3. Validate the complete dependency closure selected by trusted storage owners
   before reading data. Start with all definitions for the admitted source plus
   required relation/target/delete dependencies. Predicate and page planning
   chooses indexes; historical uniqueness adds its matching retained ordered
   index, unique definition and negative membership evidence. Relation traversal,
   target existence and deletion add target keys and reverse indexes even when
   the caller did not explicitly name them. Pending/local reuse must not hide a
   newly required database dependency.
4. Distinguish full closed-unique-set authentication from selected unique build
   readiness. Preserve complete set authentication and closure unless an explicit
   alternate protection contract is accepted. A selected list is not proof that
   no definition is missing, extra or moved into the predicate. Do not pass a
   selected verdict to full-entry, seal or publication consumers.
5. Required definitions that become unready refuse before data access. An
   unrelated definition becoming unready after entry may cease blocking an
   internal source read; its result remains tentative and full aggregate seal
   still refuses durability. This deliberately changes internal-read refusal
   timing, not successful whole-mutation acceptance. Preserve full terminal
   checks until a separately agreed dependency closure covers every terminal
   obligation.
6. Batch equivalent same-owner readiness and row hydration within existing
   bounds and checked transactions. Preserve lock order/strength, post-wait
   snapshots and time, missing/extra/duplicate checks, first-failure order and
   the existing bounded concurrent-coverage refresh. Do not parallelize shared
   transaction statements or combine observations whose order is correctness.

The accepted design currently says every actual database access retains its
existing full source/readiness checks. Accepting this private internal-read
scope change therefore requires an explicit amendment to that rule alongside
the implementation scope; a smaller selected reader alone cannot authorize it.

## Evidence lifetime and protection decisions

| Evidence | Authentication and lifetime disposition |
| --- | --- |
| Candidate/source definitions, stable identities, manifests, relation projections, ordered/search/unique specifications and complete unique closure | Existing bounded immutable preparation may be reused with fresh owned authentication. Reuse as a substitute for that authentication is permitted only for the existing protected projection or an explicitly approved complete writer protection contract. |
| Binding head, activation, candidate bodies and complete physical lanes | Keep fresh locked selection, canonical bytes/length/digests, endpoint correlation and exact lane membership. Same stored digest does not protect changed bytes or sidecars. |
| Application active selection, relation-bearing descendants and activation policy | Keep fresh head/activation/policy correlation and full unprotected body checks. The existing ten-table legacy epoch covers neither all relation-bearing descendants nor control metadata. |
| Index/unique/search build states, physical-definition lifecycle and frontiers | Keep selected required lifecycle/generation/fence/maintenance/cursor/coverage and ordered timestamp validation fresh. Ordinary publication can advance coverage; that movement must not accidentally invalidate immutable structure or authorize stale readiness. Missing lifecycle rows and negative predicates are dependencies. |
| Live physical indexes | Keep current table/index identity, validity/readiness, predicate absence, key order/count, method, columns and operator-class verification. Logical digests and build coverage do not authenticate CREATE/DROP/ALTER/rename/replacement. |
| Session/scope/lease/claim/journal authority and protected epoch | Keep live exact checks and accepting-transaction tail guard. Prepared schema evidence is never an authority token or a cached DB admission. |

Any wider protection proposal must inventory all canonical writers plus direct
SQL, fixtures, migration, restore, repair and privileged DDL. It must cover
INSERT/UPDATE/DELETE/TRUNCATE, zero-row statements where relevant, predicate
absence, missing/extra members and OLD/NEW key movement into or out of every
selected set. Watched columns require an explicit disposition for every
currently authenticated field. Named writers and readonly types do not prove
immutability; runtime table DML grants remain part of the threat surface.

Existing [catalog-integrity witnesses](../../packages/persistence-postgres/test/applicationPreparationCatalogIntegrity.test.ts)
change bytes, JSON and closure without changing stored digest/head.
[Search batch witnesses](../../packages/persistence-postgres/test/logicalSearchBuildBatchScenario.ts)
rename or replace a same-name GIN with wrong columns or
operator classes while source/coverage remain unchanged. Preserve their full
authentication and immediate fresh refusal where currently required. Changing
that threat contract requires an explicit accepted-design decision, not removal
of a failing witness or an unrelated-definition classification.

These materially different decisions remain explicit gates before dependent
implementation, rather than extra phases silently added to this cutover:

- Wider target/framework/control metadata invalidation: exact tables/fields,
  complete writers, ordinary coverage versus structure separation, installation
  and existing-data attestation/migration disposition.
- Reduced catalog attestation: choose either connection-scoped proof with exact
  backend identity and reconnect/pool invalidation, or an installation-scoped
  certificate with enforced maintenance generation and fresh installation/login
  checks. The latter is a new authority contract. Current database-object tokens,
  `PoolClient` quarantine identity, TTL and cache-disabled Hyperdrive prove neither.
- Privileged maintenance enforcement: admission stop, drain/quarantine, repair,
  generation/installation change, stale-proof destruction, reattestation and
  resume. The existing quiescence requirement is not an implemented complete
  maintenance barrier; this document does not invent one.
- Control/target evidence: separate databases have no atomic joint generation;
  preserve their owned checks until an explicit coordination contract exists.
- Physical DDL facts and tamper threat: retain fresh physical/catalog checks
  unless a complete replacement and altered witness disposition are approved.

## Cutover, validation and completion

Replace the private finite internal-read readiness contract at source admission,
logical readiness and borrowed working-set boundaries together. Migrate all
affected Application, Product, Payload and workflow consumers and tests; remove
displaced repeated wrappers/exports and diagnostic scaffolding in this coherent
slice. Extend existing planners and admission owners rather than add a generic
registry or second codec. Retain full paths for named actual consumers: entry,
aggregate seal, publication, standalone reads, `durableOperations`, activation,
reload/acquisition and recovery. These are current obligations, not temporary
compatibility fallbacks. Any displaced path temporarily kept needs its specific
unmigrated caller and removal gate.

No journal/profile/event format, durable row identity or existing-data reset is
proposed for source-read selection. If writer protection requires schema or
durable-format changes, inventory them and obtain that specific decision before
dependent work. No old attempt is reinterpreted, no named durable data deleted.
Apply the repository Effect skills/overlay: authoritative runtime contracts,
precise failure/requirement channels, sequential validation, ordinary absence
distinct from corruption/refusal/resource failure, scoped evidence revocation
and existing cancellation/recovery. Framework semantics stay with their owners.

Completion is one connected implementation:

- PGlite and ordinary-role PostgreSQL owner/consumer witnesses for required and
  unrelated readiness changes at entry/read/seal/publication. Prove a required
  miss refuses before its data read; prove an unrelated post-entry miss permits
  the proposed internal read but full seal refuses durability. Exercise empty,
  missing, extra and reordered closure members, planner alternatives,
  historical uniqueness, target/reverse/delete dependencies and pending reads.
- Ordinary PostgreSQL distinct connections for ordered locks, blocked reads and
  fresh post-wait time/selection, concurrent coverage/frontier progress and
  persistent misses, epoch change/contention, wrong scope/fence, revocation,
  expiry, lost claim and privilege/corruption witnesses. Retain the three-refresh
  bound, full set/body authentication and live physical replacement tests.
- Real Product, selected Payload Local API and finite workflow success, late
  failure, conflict/retry, events, replay, cancellation and uncertain-COMMIT
  recovery, plus standalone regression. Preserve exact positive/negative
  dependencies, atomic effects and one retained outcome. Keep both database
  lanes distinct; a passing rerun does not establish an intermittent root cause.
- Targeted CPU/decode/hash, driver-awaited DB time and lock-wait observations
  only to answer closure scope, batching or evidence-lifetime decisions. Record
  unavailable attribution. Driver await includes transport, server work and
  waits. After correctness, compare quiet traced smoke and matched untraced
  distributions on the same four graphs, preserving workload/deadline/recovery,
  lifecycle and zero-exclusion policy. Goals remain mixed warm p50
  100 / 200 / 500 ms, p95 200 / 400 / 1,000 ms; standalone median below 400 ms
  and regression strictly below 10%. These are goals, not promised gains or
  native ORM/hosted/throughput claims. Fewer SQL statements alone is insufficient.
- Affected typechecks/builds/source guards and lint, both standing reviewers on
  the exact owned final diff, substantive-fix re-review, cleanup, staged lint and
  one scoped commit after successful validation. Unmet latency goals remain
  recorded; do not weaken integrity to meet them.

Agree source-complete internal reads and retained full authentication/terminal
boundaries first; resolve wider protection or attestation before dependent work.
