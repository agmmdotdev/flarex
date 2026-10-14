# Dependency validation and evidence lifetime

This is the delivered source-complete checkpoint. The approved
[query-required mixed read replacement](./20-query-required-read-execution-preflight.md)
supersedes its finite intermediate-read selection and protection contract and
is in progress. Full entry, final verification and retained direct/durable
profiles keep their complete obligations. The source-complete descriptions and
measurements below describe this checkpoint, not the successor's acceptance.

Status: **delivered for the existing private finite consumer graph; mixed latency
targets remain unmet.** The approved
private finite internal-read contract validates source-complete readiness, with
fresh required physical and mutable readiness checks; full entry, aggregate seal
and publication remain mandatory. Canonical bodies, heads, membership, closed
unique-set authentication and accepting-transaction authority/epoch guards
retain their existing protection. Wider metadata reuse and cheaper attestation
remain separately gated. The connected cutover implements the decisions below
together with the accepted prepared-execution amendment.

## Connected outcome and reason

The approved connected cutover is for existing private finite Product, selected
Payload and Medusa workflow consumers: internal checked reads validate a complete
trusted source dependency closure rather than all candidate definitions, with
bounded existing read batching where equivalent. Distinguish immutable schema
evidence from fresh authority/readiness; keep current full canonical bodies,
heads, membership authentication and physical checks, plus full entry, aggregate
seal and publication. Wider immutable reuse is a separate decision gate.

Source-complete closure is the implemented safe bound, not a promised minimal
plan or sufficient latency gain. Exact operation closure remains gated on a
focused planner contract proving completeness for every admitted path. Retain
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

The delivered graph retains snapshot, pending visibility, native lifecycle,
events and authoritative outcome. This
cutover adds no public API, framework operation, hosted activation, durable
workflow effect, core OCC relaxation, schema/data deletion or advanced evolution.
It adds no new relation/delete/search capability solely to exercise closure and
does not repair the separate publication-body proof limitation. Postgres remains
the only settlement authority; no SQL transaction spans
framework callbacks, sandbox execution, foreign capture or remote effects.

## Existing owners and executing callers

| Owner | Delivered behavior and responsibility |
| --- | --- |
| [Source admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts) | Complete authenticated candidate preparation and source-local evaluator definitions remain. `withBinding` verifies full readiness; `withReadBinding` lazily derives the complete requested source union and authenticates current binding/Application evidence. The distinct read scope shares only the exact issued request set under existing common identities in one accepting transaction, invoking each source's pin callback even on a hit. |
| [Logical readiness](../../packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts) and [binding check](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/logicalSchema.ts) | Full `prepared.inspect` and `verifyLogicalSchemaBindingInTransaction` remain. `selectSources` derives transitive source-complete closure from that preparation; `verifyLogicalSchemaReadBindingInTransaction` issues only selected readiness. Required index/unique/search builds and physical evidence remain fresh. Neither verdict can masquerade as the other. |
| [Application admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/applicationAdmission.ts) | Native Application/journal behavior retains full `withBinding`. This owner does not issue the document/relational participant lifecycle or its finite read verifier. |
| [Document](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/documentAdmission.ts) and [relational](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalAdmission.ts) admission | Entry pinning, full `verifyBinding`, seal and commit-authority verification retain `withBinding`. Separate `verifyReadBinding` uses `withReadBinding` only when the exact issued attempt profile is `finiteRoot`. Both execute the same source/head pin verification. Standalone and durable consumers retain full semantics. |
| [Working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts), [app rows](../../packages/persistence-postgres/src/storage/documents/appRows.ts), [query planner](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/query.ts), [relational query](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalQuery.ts) | Point, predicate, historical unique, range and hydration owners retain exact positive/negative conflict evidence and pending overlay. Indexed historical hydration reuses the app-row snapshot query/canonical decoder with bounded body projection and sequential trusted consumption; point and seed hydration retain their existing paths. |
| [Strong-reference projection](../../packages/persistence-postgres/src/storage/documents/logicalStrongReferenceProjection.ts) and [foreign keys](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalForeignKeys.ts) | Source/target identities, target keys, reverse indexes, liveness and deletion behavior contribute mandatory dependencies. A source bound must include these transitive obligations or remain full. |
| [Journal store](../../packages/persistence-postgres/src/execution/sessionJournalStore.ts), [checked kernel](../../packages/persistence-postgres/src/execution/session/attemptKernel.ts), [publication](../../packages/persistence-postgres/src/commit/point/README.md) | Own exact fenced root, checked transaction, aggregate seal, recovery and settlement. Retain full scalar authority and full terminal admission; scope shared evidence to its accepting transaction and revoke it on exit. |
| [Binding repository](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/repository.ts), [Application projection](../../packages/persistence-postgres/src/application/applicationBindingProjection.ts), [protected epoch](../../packages/persistence-postgres/src/execution/preparation/preparedMetadataEpoch.ts) | Keep full canonical selected bodies/sidecars and existing protected legacy Application exception. Wider immutable reuse requires its own complete writer proof, not a digest or process identity alone. |

The executing consumer chain is the private Worker/executor participant bridge
into journal admission, then `prepareLogicalSourceEvidence` through the three
source admission owners. Native [Product](../../packages/medusa-adapter/src/modules/product/attempt.ts)
uses the borrowed relational facade; selected Payload Local API access,
validation and hooks use document admission; finite
[workflow runtime](../../packages/medusa-adapter/src/workflow/runtime.ts) composes
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

## Approved private internal-read contract

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
   required relation/target/delete dependencies. A multi-source bundle derives
   one complete union from its actual issued source states, never its adapter
   method list. Derive that union lazily and share its common proof only within
   the accepting read transaction under the exact requested source set and the
   existing common owner, scope, clock, schema and manifest identities. Every
   source still checks its own method/root authority and pinned head on a cache
   hit. Full proofs remain distinct; no subset or superset proof can be reused.
   Common union readiness precedes ordered source pin checks, retaining the
   former full-common-check failure order. A later source's required readiness
   can therefore refuse before the first source pin without changing typed
   failure classes.
   Predicate and page planning
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

The accepted prepared-execution rule now permits this owner-approved private
finite internal-read scope change. Standalone and durable-operation reads retain
full readiness. A selected verdict cannot authorize entry, aggregate seal or
publication. The old scalar readiness selector is removed; callers use the
complete issued source set rather than a compatibility wrapper.

## Bounded historical hydration

Indexed hydration reuses the existing app-row snapshot query/canonical decoder
for already decoded, distinct requested identities. Consumption follows
requested order: decode, dependency observation, budget charge and working-set
state update. The internal batch is bounded at 256 identities; the existing
live-set wrapper retains its 128-identity limit. Missing rows, tombstones,
duplicate refusal, historical snapshots and exact negative dependencies retain
their owner semantics. Pending/local reuse adds no database admission, while
the next uncached read repeats its fresh checked transaction.

SQL projects all metadata and full bodies through the first row crossing the
initial remaining byte budget, capped at 1 MiB; later bodies are withheld.
Reaching a withheld body is an internal defect, never synthesized absence,
tombstone or corruption, and does not trigger a fallback read. Canonical
corruption in the crossing body precedes its byte charge; an earlier budget
refusal precedes a later malformed body. Unexpected tombstone bodies are not
masked. This preserves the existing exposure of a malicious crossing body's
stored bytes rather than claiming an absolute malicious-payload transfer bound.
The consumer cannot skip an uncached live row: observation and state update
remain sequential. Point and seed hydration are unchanged; no foreign callback
runs inside SQL.

## Cost result and remaining direction

The [bundled series](../../packages/flarex-backend/benchmarks/mixed-mutation-core/bundled-dependency-validation/README.md)
retains the same profiles and effects. Warm outer p50/p95 is
**940.7/1,166.4, 1,087.1/1,176.3, 1,787.7/1,960.0 and 319.8/403.4 ms**.
SQL dispatches are **988 / 1,252 / 1,979 / 354**, compared with compact access
**990 / 1,274 / 1,997 / 354**; transactions remain **41 / 52 / 78 / 6**.
Observed medians change **+8.4% / +1.8% / −8.5% / +5.3%**. Latency does not
improve across all workloads: Product, Product + Payload and standalone medians
rise; mixed workflow falls. No cause for the distribution changes is established.
Mixed warm p50/p95 targets remain unmet. Standalone retains its below-400-ms
median and strictly-below-10% regression gate; its 403.4 ms p95 and all outliers
remain visible. The artifact package owns exact distributions and limits.

The [separate-closure checkpoint](../../packages/flarex-backend/benchmarks/mixed-mutation-core/dependency-validation/README.md)
retains its original samples and verified historical source receipt. Its
workflow has 2,501 dispatches: distinct source closures repeat common binding
and readiness work inside a bundle transaction. The delivered union avoids
that repetition while preserving ordered individual source checks. It does
not reduce transaction counts or establish the cause of a latency difference.

Further cost work requires a focused preflight and an end-to-end acceptance
question. Exact operation closure needs completeness proofs at the actual
planner/evaluator for reads, historical uniqueness, references and terminal
obligations; method grants are insufficient. Canonical body decode/hash and
driver/server/wait costs need attributable measurements before selecting a
different owner or protection lifetime. Wider framework/control protection,
connection or installation attestation and privileged maintenance enforcement
retain the explicit gates below. No new metadata cache or cheaper authority
path follows from these measurements.

## Evidence lifetime and protection decisions

| Evidence | Authentication and lifetime disposition |
| --- | --- |
| Candidate/source definitions, stable identities, manifests, relation projections and ordered/search specifications | Existing bounded immutable preparation may be reused with its existing owned authentication. Reuse as a substitute for that authentication is permitted only for the existing protected projection or an explicitly approved complete writer protection contract. |
| Complete canonical unique closure and unique specifications | The existing configured-control preparation owner authenticates the complete closure and retains detached bounded evidence. Both full and selected acceptance use that evidence and check fresh target build readiness in the accepting transaction; neither path rereads the control closure there. This cutover adds no cache/protection contract or control-target coordination. Fresh accepting control-closure authentication requires a separate contract gate. Preserve canonical corruption-before-preparation proofs and the existing accepting binding authentication. |
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

Existing [catalog-integrity witnesses](../../packages/persistence-postgres/test/application/applicationPreparationCatalogIntegrity.test.ts)
change bytes, JSON and closure without changing stored digest/head.
[Search batch witnesses](../../packages/persistence-postgres/test/storage/search/logicalSearchBuildBatchScenario.ts)
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

## Cutover and retained completion obligations

The private finite internal-read contract is replaced across source admission,
logical readiness and borrowed working-set boundaries. Affected Product,
Payload and workflow consumers use the existing admission/planner owners;
native Application/journal behavior retains its full path. There is no generic
registry, second codec or retained scalar-selector compatibility API.
Full paths remain for named actual consumers: entry,
aggregate seal, publication, standalone reads, `durableOperations`, activation,
reload/acquisition and recovery. These are current obligations, not temporary
compatibility fallbacks. Any displaced path temporarily kept needs its specific
unmigrated caller and removal gate.

The runtime attempt root carries the mandatory profile from its exact admitted
attempt; durable source bindings project their existing fields explicitly.
No journal/profile/event format, durable row identity or existing-data reset is
changed for source-read selection. If wider writer protection requires schema or
durable-format changes, inventory them and obtain that specific decision before
dependent work. No old attempt is reinterpreted, no named durable data deleted.
Apply the repository Effect skills/overlay: authoritative runtime contracts,
precise failure/requirement channels, sequential validation, ordinary absence
distinct from corruption/refusal/resource failure, scoped evidence revocation
and existing cancellation/recovery. Framework semantics stay with their owners.

The connected implementation retains these obligations:

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

The source-complete internal-read cutover is delivered. Whole-goal latency and
activation gates remain open; resolve any wider protection, operation closure
or attestation contract before dependent implementation.
