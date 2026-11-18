# Private Reference Save Authorization

## Status And Scope

Status: SA1 protected permission evidence, its shared V3/joint-source composition
prerequisite, bounded SA2 native authorized saves, SA3 concurrency/recovery
proof and SA4 selected private Worker-consumer cutover are implemented as backend
foundations. General serving/production activation remains gated. Public API
syntax remains a proposal.

The shared analysis/binding, retained ownership, finite admission and settlement
owners now support a private Application command-only write policy. Ordinary
Application mutations cannot write that table. Separate trusted command roots
can change its data; consuming roots obtain attempt-bound permission evidence
through exact Application point dependencies.

The implemented private outcome is an authorized native Payload article save with one optional
Product reference in the existing finite mixed root. Distinguish article write
access, permission to assign a target, permission to retain an existing target,
and permission to read a target. Keep the selected soft-delete retention and
hard-delete restriction. Only the trusted outer owner publishes.

Scope is fresh isolated private composition, database-only native operations and
bounded permission evidence. Public schema/SDK syntax, dashboards, general ACLs,
commerce population, reverse traversal and new-Product pending construction
remain separate gates. This work does not modify the concurrent Medusa session's
implementation, promoted sources, workflow contracts or roadmap.

## Current Sources Of Truth

- [Accepted database design](../../design-notes/flarex-db-accepted-design.md),
  [shared logical storage](../../design-notes/flarexdb-shared-logical-storage.md)
  and [package boundaries](../16-package-boundaries.md) govern architecture.
- The [cross-framework preflight](./cross-framework-reference-preflight.md)
  owns reference integrity, lifecycle and the broader CXR gates. This document
  refines its pending save-permission obligation; it does not close those gates.
- [Private read grants](../../packages/persistence-postgres/src/execution/journal/privateReadAccess.ts)
  and the [Payload read runtime](../../packages/payload-adapter/src/runtime/referenceRead.ts)
  authenticate fixed selections. [Connected read scenarios](../../packages/flarex-backend/test/mixedMutationPayloadReferenceReads.workerd.test.ts)
  distinguish their supported behavior from general authorization.
- [Payload operations](../../packages/payload-adapter/src/operations.ts),
  [native construction](../../packages/payload-adapter/src/runtime/native.ts),
  [strict inputs](../../packages/payload-adapter/src/inputs.ts) and
  [participant binding](../../packages/payload-adapter/src/participant/binding.ts)
  own Local API invocation, native access and borrowed lifecycle.
- [Participant admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts)
  and [journal operations](../../packages/persistence-postgres/src/execution/journal/participantOperations.ts)
  own genuine attempt/principal bindings, receipts and failure poisoning.
- [Strong-reference admission](../../packages/persistence-postgres/src/commit/publication/strongReferenceAdmission.ts)
  and [validation](../../packages/persistence-postgres/src/commit/publication/strongReferenceValidation.ts)
  own final integrity and derived reverse membership. The
  [reference lifecycle scenarios](../../packages/flarex-backend/test/mixedMutationPayloadCommerceReference.workerd.test.ts)
  remain required consumers.

The executing Payload peer is pinned to `3.88.0`. Its installed
`collections/operations/create.js` executes collection create access before
field/collection validation and change hooks. `updateByID.js` executes update
access with the point ID and input data before fetching the document;
`collections/operations/utilities/update.js` then supplies `originalDoc` to the
native hooks. Check that executing source again before implementation. Native
access on input alone cannot prove authorization of a hook-normalized final edge.

## Implemented Foundation And Remaining Gap

The existing publisher already checks original versus final edges, active
eligibility for new assignments, structural existence for retained edges and
restricted hard deletion. This is integrity enforcement, not a per-principal
permission decision. Do not add permissions to the database FK policy or weaken
integrity when a caller cannot see a Product.

The private read profile binds a fixed ID selection, native revision and content
identity to the admitted scope/principal and receipt identity. The journal checks
that principal digest against the admitted transaction session's
`identityAccessPolicySha256`. Equality authenticates the admitted evidence; it
does not discover current editor permissions or provide live revocation.

Separate trusted/default compiled collections retain their allow-all native
access profile. The selected reference-read runtime supplies real read access
and refuses writes. The selected save consumer below constructs only the
protected write runtime; it never falls back to either other profile. Test
instrumentation is not a permission authority or the normal construction path.

## SA1 Implemented Protected Permission Source

Ordinary Application ownership provides tracked reads and ordinary writes. It
cannot protect policy data from a same-root self-grant. The accepted correction
adds `application-command` ownership with the closed private policy identity
`application.reference-permissions` to the existing analysis/binding contract.
This is backend metadata, not selected public schema syntax.

The existing retained-claim owner prevents takeover of previously writable
tables, ownership transfer, removal or policy reinterpretation. Payload claims
retain their existing semantics. No migration, reset, backfill or change to
named durable data is part of this fresh-source profile.

The actual owners are:

- [Write-policy analysis](../../packages/analysis/src/applicationWritePolicy/model.ts)
  and [schema bindings](../../packages/flarex-protocol/src/application-schema-binding.ts)
  authenticate table ownership and policy hashes. Trusted analyzer hashing uses
  its captured host capability while application import-time crypto stays blocked.
- [Command authority](../../packages/persistence-postgres/src/application/ownership/Command.ts)
  binds opaque issuer evidence to the exact attempt, scope, table and retained
  policy. Only the private journal constructor can mint it after genuine ownership
  capture on a pristine finite root. Permission reads, existing point work and
  borrowed participant work exclude command acquisition. Command roots cannot
  issue consuming permission evidence or borrow framework operations.
- [Point operations](../../packages/persistence-postgres/src/execution/journal/pointOperations.ts)
  enforce ordinary insert/patch/replace/delete denial, including no-op writes and
  cached privileged receipts. Freeze closes the writer and retains separate opaque
  commit evidence. The [commit owner](../../packages/persistence-postgres/src/application/ownership/Commit.ts)
  authenticates that evidence against the current retained claim under the normal
  publication locks. It permits only the selected protected table; it supplies no
  unrestricted commit bypass or additional settler.
- [Private permission evidence](../../packages/persistence-postgres/src/execution/journal/privatePermissionEvidence.ts)
  strictly decodes the stored bounded policy and binds its principal and scope
  to the admitted root. It distinguishes missing facts (`None`), malformed stored
  data (corruption), and invalid authority. Issued evidence stops being usable
  when the root leaves its open lifetime. Copies and cross-attempt/principal
  reuse are refused.

The bounded policy document contains a format/version, principal scope/digest,
collection, relation, source create/update/delete decisions and at most 256
assignment/retention target IDs each. The fresh connected source stores it in
`audit.policy`; `posts` remains Payload-managed and `users` remains ordinary
Application data. Those fixture table names do not select a public permission
schema or generalized ACL engine. Only backend composition selects the policy
point; application arguments do not supply its authority.

The finite activation owner now carries genuine V3 schema, manifest-binding,
publication and retained ownership evidence through entry and settlement. This
bounded path requires no declared Application relations/edge definitions. The
joint-source extension below also accepts a genuine prepared original generation;
an active selection alone cannot substitute for that preparation. It preserves the legacy path
and does not fabricate legacy control rows for V3 evidence. Broader composite
finite profiles remain gated.

Finite publication also retains table identities from genuine Application point
receipts for read-only dependencies. Previously its contribution allowlist used
only Application write tables, rejecting a policy read when that table had no
write. The publication owner now separates that read selection from attempted
write ownership and maintenance. Exact point conflicts still govern freshness.

[Connected scenarios](../../packages/persistence-postgres/test/application/ownership/privateReferencePermissionScenario.ts)
exercise trusted policy create/revoke/delete, ordinary write refusal, read-only
publication, exact receipt replay, same-root and concurrent acquisition refusal,
closed/forged/cross-principal evidence, malformed/missing facts and a policy update
that makes a consuming root stale. The same scenario has PGlite and ordinary-role
PostgreSQL consumers. SA2 below adds native Payload access and effective-edge
authorization; SA3 below connects their concurrent freshness and recovery proof.

## Private Save Decisions

### SA2 Prerequisite: Protected V3 And Joint Sources

The protected permission table is authenticated by the V3 embedded write-policy
manifest. Mixed Payload/Product execution composes independent Application,
Payload and Medusa sources. Their shared owners now connect these paths:

- The [shared Application projection](../../packages/analysis/src/logicalApplicationSource.ts)
  consumes genuine V3 analysis and exact Payload compiler evidence. The
  [schema composer](../../packages/medusa-adapter/src/composition/schema.ts)
  delegates that projection instead of redefining Payload tables as Application
  tables. It retains command ownership and original placements. Global placement
  and V3 `_id` partition placement are admitted; other placement profiles refuse.
- The [logical schema admission owner](../../packages/persistence-postgres/src/storage/catalog/logicalSchemaAdmission.ts)
  authenticates the complete retained V3 manifest, schema and write-policy
  digests, exact source projection, stable identities and ownership. Missing,
  renamed, removed or reclassified retained tables refuse as `ownershipChanged`.
- The [composite finite preparation owner](../../packages/persistence-postgres/src/application/activation/finitePreparation.ts)
  borrows a genuine prepared original binding within the same authenticated
  host lifetime. Current finite entry compares the actual retained active head;
  the shared source catalog preserves native table/index definitions and admits
  only the exact compiler-derived reverse indexes added by the joint reference.
  Installed paired-anchor preparation and unsupported Application relations remain gated.

The [connected private save consumer](../../packages/flarex-backend/test/privatePayloadReferenceSaves.test.ts)
uses actual cold analysis, V3 readiness/activation, retained generation and native
Payload/Product admission. It replaces the former temporary refusal witness
with connected success and negative ownership assertions.

The implemented correction has this bounded contract:

1. Extend the shared Application source projection/composition owner to consume
   genuine V3 analysis and native Payload compiler output together. Select each
   table once by its authenticated schema/write owner; preserve command policy
   identity, Payload provenance, placements and stable table identities. Keep
   Application/Payload projection at a shared owner rather than adding a
   Payload-only bypass in the adapter or test harness. Medusa's compiler still
   supplies its own unchanged native definitions.
2. Extend logical catalog admission to validate the retained V3 ownership
   baseline against those actual source bindings. Admit only exact preserved
   ownership; refuse command-to-ordinary changes, Payload-to-Application changes,
   policy reinterpretation, removal and identity changes. This is a fresh private
   composition proof, not an approved migration/backfill of named durable data.
3. Extend genuine V3 finite preparation and source composition to borrow the
   original authenticated generation through the existing selection/lifetime,
   metadata and publication owners. Preserve the protected command claim and
   ordinary mutation denial after mapping the joint catalog. Do not fabricate
   legacy authority, weaken table comparisons, or introduce another settlement
   owner. Application relation and placement support must remain bounded by
   demonstrated compatibility; unsupported profiles still refuse.
4. Connect a protected policy point and native Payload article/Product source in
   one actual finite root as the basis for save grants. Verify ordinary
   self-grants remain impossible, exact permission dependencies reach publication,
   and binding/claim changes invalidate preparation. Use PGlite and an
   ordinary-role PostgreSQL target, plus the affected Worker consumers.
5. SA2 adds native source access and effective per-write reference
   decisions below. The shared projection replacement migrates its real
   callers and removes displaced assembly in the same scope. No Medusa service,
   workflow, promoted source or concurrent implementation change is selected.

Do not substitute ordinary Application policy records, untracked fixture grants,
adapter checks over request data, or a direct candidate that skips retained-owner
validation. Those would remove SA1's protected source rather than connect it.

### Native Save Policy

Use native Payload create/update/delete access with `overrideAccess: false` for
the source operation. Source authorization and target-reference authorization
must both succeed. Target read or discovery permission implies neither target
assignment nor commerce mutation permission.

| Effective operation | Required decision and integrity |
| --- | --- |
| Create without a target, or with null | Source create permission; no target permission demanded |
| Create with a target, or replace a target | Source create/update permission and explicit assignment permission for the new scoped target; final target must be active |
| Edit unrelated fields while retaining the target | Source update permission and explicit retain-existing permission for that edge; structural target must exist, including when soft-deleted |
| Explicitly write the same target | Retention only with the genuine original-edge and pending-state evidence described below; never trust a caller's retention flag |
| Clear the optional target | Source update permission; no target read, assignment or retention permission needed to remove the edge |
| Delete the article | Native source delete permission and existing preference cleanup; no target permission or commerce write implied |

The implemented private profile uses an explicit bounded retain-existing grant. It
may permit retaining a Product the editor cannot currently read. Such a grant
does not return Product details. Revoking retention may block unrelated article
edits until the reference is cleared; it does not silently delete content or
erase the stored reference. This policy remains distinct from soft-delete
retention, which only establishes structural eligibility.

Classification uses trusted source state. For a given save, retention requires
the same target in the committed original edge and the source's current pending
state before that save. A create or reattachment after a clear requires
assignment permission, even if a later final value equals the original value.
Repeated native writes cannot turn a refused intermediate assignment into a
successful save by clearing it later. An unchanged reference newly assigned
earlier in this root retains that assignment obligation.

Native defaults, validation and admitted hooks may change the effective field.
Authorize the effective edge reaching the pending owner, not only the request
patch or a pre-hook picker selection. Omission preserves native update behavior;
omission on create cannot claim a previously existing edge. Every admitted
native write path, including supported nesting, must produce covered evidence.
Unsupported hook/nesting profiles refuse admission.

### Implemented SA2 Boundary

The journal derives an opaque save capability from the genuine SA1 fact and
finite source admission. Its canonical identity includes the policy point,
permission decisions, collection/relation and native/content/source revisions;
the existing receipt owner binds that identity as the selected profile revision.
The capability cannot outlive its root or be used with another attempt/bundle.

The private Payload save runtime consumes source decisions through native access
with an opaque request context and `overrideAccess: false`. Its only writer is
the borrowed CMS participant. The existing working-set transition owner checks
effective values after native normalization and compares genuine committed,
pending and prior-attempt state. Denial poisons the root. Source create/update/
delete decisions remain independent of target assignment/retention; no Product
write or target-read authority is granted.

Connected scenarios cover omitted/null references, source denial before change
hooks, assignment, explicit same-value retention, retention without Product
visibility, clear/reattach, repeated pending assignment, fixed hook target
normalization, soft-deleted retention versus new assignment, forged authority,
replay without rerunning hooks, stale permission publication, and delete/preference
cleanup. Fixed instrumentation is source-private test support; arbitrary hooks
and cross-operation nesting are not enabled by the normal runtime.

### Implemented SA3 Boundary

The [PostgreSQL concurrency consumer](../../packages/flarex-backend/test/privatePayloadSaveConcurrency.postgres.test.ts)
schedules actual protected-policy and authorized-save publishers. Distinct
ordinary-role backend PIDs and `pg_blocking_pids` establish both scope-lock
orders. A save ordered first commits before the revocation; revocation ordered
first makes the save's exact permission point stale. Later saves observe the
revoked assignment decision. No extra permission query or lock owner is added.

The same consumer loses a real COMMIT acknowledgement only after an independent
connection observes the durable save, then commits revocation before the
publisher resolves its uncertainty. Existing outcome resolution returns the
original committed result and replay publishes no duplicate content, history,
index, fact, event or success outcome. Recovery does not require fresh permission
for a write that already committed.

The [recovery consumer](../../packages/flarex-backend/test/privatePayloadSaveRecovery.test.ts)
also runs on PGlite and ordinary-role PostgreSQL. A genuine changed capability
cannot replay another capability's receipt: the existing sequence owner returns
`requestMismatch` without executing hooks. A subsequent real write uses the new
decision and its denial poisons the root. Exact replay after policy revocation
does not rerun hooks and cannot bypass the original permission dependency at
publication. Cancellation after native work and staged Application work retains
interruption, closes capability use and prevents publication of either write.

Whole-root retry and redispatch use the existing
[finite execution owner](../../packages/executor/src/mutation/execution/finitePointMutationExecution.ts),
its genuine journal/activation, nonacceptance proof, replacement entry, liveness
and terminalization. A copied conflict or reused retry ticket grants no retry.
The fresh attempt preserves the request/session, advances its fence/snapshot,
reads policy again and constructs a new save capability. Changed-but-allowed
policy reruns native work and commits only the replacement result; revocation
stops native source access before change hooks and durably aborts the attempt.
Redispatch after later revocation returns an existing committed result without
native reexecution; a durably aborted attempt remains rejected.

These are backend/private-API proofs. The selected composition refuses an
ordinary unguarded Payload facade and invokes only the protected save capability.
SA4 below connects that capability to the selected private Worker consumer.
External revocation systems, arbitrary hooks, generalized ACLs and production
activation remain outside this bounded database-local profile.

### Implemented SA4 Boundary

The source-private [serving composition](../../packages/flarex-backend/src/privatePayloadSaveConsumer.ts)
acquires protected permission evidence and constructs the normal Payload save
runtime once within each pristine finite attempt's Scope. Only trusted backend
composition selects the policy point, principal and native profile. The Worker
receives no policy selector, grant object, target lists or direct Payload writer.
The selected joint-save witness no longer constructs an allow-all runtime.
Separate trusted/default and reference-read consumers retain their own profiles;
none is a fallback for a refused save.

The [journal owner](../../packages/executor/src/mutation/journal/pointMutationJournal.ts)
binds the genuine attempt's save capability to its declared participant and
native revision. Protected and ordinary calls reuse the same invocation,
serialization, claim checks, receipt handling and failure projection. The selected
facade routes admitted operations only through that protected binding, refusing
other collections, read methods and commerce mutation. Ordinary Application
writes still use their existing ownership checks.

The protected read occupies syscall 1. The private mixed Worker entrypoint
accepts the trusted starting cursor, so Application and Payload operations
continue at syscall 2 under existing receipt and operation budgets. This changes
neither the public request schema nor the ordinary Worker entrypoint. Publication,
retry, revocation freshness and uncertain-outcome resolution remain with the
existing finite executor and Postgres owners.

The [selected Worker consumers](../../packages/flarex-backend/test/privatePayloadSaveServing.workerd.test.ts)
run against PGlite and ordinary-role PostgreSQL through the real journal RPC
session. Allowed create/update and Application work publish together. Source,
assignment and retention denial, forged native authority, nested target writes,
ordinary content writes, self-grants and unselected read/commerce operations
cannot publish, including when application code catches a refusal. Native
permission details stay behind the opaque RPC failure; the existing safe
managed-table denial message remains its distinct contract. Explicit clear and
delete need no target grant. Revocation after a Worker receipt prevents stale
publication; the actual whole-root retry acquires fresh policy and refuses the
revoked write. Serving assembly adds no policy evaluator or recovery loop.
Missing, malformed and foreign-principal policy facts stop before Worker/native
construction. Interruption after actual native work disposes and joins the owned
Worker before RPC/native drain completes; staged Application/content work cannot
publish. The transport retains interruption and cleanup failures together.

This is the selected private proof entrypoint, not the ordinary production
dispatcher or a public CMS endpoint. Wider serving activation, arbitrary native
hooks and general CMS authorization remain separate gates.

## Permission Freshness And Publication

SA1 reads bounded permission facts through the existing finite snapshot/dependency
owner. Its fresh private Application policy point carries the admitted principal
and scope plus source-operation and target assignment/retention decisions.
The command-only ownership and opaque read evidence above protect that source;
the harness supplies data and invokes real backend owners. It implements no
permission evaluator or separate SQL ACL store.

Read permission facts afresh for each save attempt. Discovery/picker output,
previous read grants, a supplied policy digest or a cached positive decision are
not save authority. Missing policy facts deny; their absence still needs exact
dependency evidence. Malformed stored policy is corruption, not an allow or an
ordinary denial. No remote permission call occurs within a database transaction.

The dependency and source/target evidence must survive receipt capture, freeze
and final publication through the existing owners. Select this ordering:

- A revocation committed before a new save's snapshot is observed by that save.
- A revocation committed after the snapshot but before the save's publication
  makes the permission dependency stale. Refuse publication; any permitted
  whole-root retry reads fresh policy and reauthorizes native operations.
- A save ordered first under the existing publication locks may commit. A later
  revocation governs later saves; it does not retroactively undo the commit.

Prove both lock orders with distinct ordinary-role PostgreSQL connections. An
extra unlocked permission check just before COMMIT does not close this race.
The first profile refuses permission-record mutation within the consuming root;
trusted policy changes use a separate authorized command and the same commit
authority. External identity-provider revocation and general operational grant
revocation are not established by this database-local witness.

## Private Capability And Owner Contract

This section describes private owner obligations, not public function signatures.

The trusted composition owner derives a scoped save capability from genuine
attempt admission and protected policy evidence. Bind the principal, source
collection/table, declared relation, native/content policy revision, admitted
methods, bounded target decisions and dependency identity. Keep it opaque to
application arguments. Reuse existing canonical binding and receipt owners;
the exact write selection must affect replay identity just as the read grant
does. Do not reuse the read-only grant as assignment authority or rename it into
a universal permission capability.

| Owner | Required extension or preserved responsibility |
| --- | --- |
| Trusted finite composition and journal in `persistence-postgres` | Authenticate save grants; capture protected permission dependencies; bind invocation/receipt identity and reject stale, forged or cross-attempt evidence |
| `payload-adapter` | Construct native source access from the trusted grant using an opaque request context; preserve real Local API access, normalization, hooks and results; forward effective writes through the existing borrowed owner |
| Existing logical pending/write owner | Authenticate each effective source transition and retain bounded authorization evidence; reuse trusted original/pending state rather than accepting caller flags |
| Existing freeze/publication owners | Require complete evidence for the selected profile and validate permission dependencies with all other conflicts before settlement; keep structural relation enforcement principal-independent |
| Existing Medusa owner | Preserve native Product methods, lifecycle and events; this slice selects no new Product write, service override or workflow change |
| Host/test harness | Supply genuine authority and data, schedule barriers and observe results; implement no permission evaluation, reference classifier, recovery or publication |

No raw database, transaction, scope-clock, commit or finalizer capability enters
application code or native callbacks. Native access may consume a private
captured decision; it cannot acquire another transaction. User-controlled
`user`, `context`, `overrideAccess`, grant bodies or permission selectors remain
outside the strict operation input contract.

The selected authorized profile must not lend an ordinary database patch or an
alternative unguarded source writer. Separate trusted/default fixtures retain
their recorded scope; they are never a fallback after this profile refuses.
Admission must cover any direct endpoint writer included in the selected proof,
or explicitly refuse that entry point. Reuse existing lifetime, expiry, fencing,
size and operation budgets rather than broadening them for permission evidence.

Reuse the shared integrity owner's original/final observations where their
semantics match. Per-operation pending transitions additionally need their
existing pending owner; final graph equality cannot erase an earlier denial.
If reuse needs an owner seam, change that owner rather than copying reference
classification into the adapter, tests or a new relation coordinator.

## Failure, Replay And Recovery

Authorization denial follows the existing admitted-operation failure path and
poisons the root, including when application code catches it. No partial
Application/content/commerce write, index update, preference cleanup, lifecycle
fact, event or durable success outcome may publish. Keep native and typed
internal causes with the trusted owner and retain the opaque Worker refusal
contract. Infrastructure failures, corruption, defects and interruption must
not be converted into permission-denied success or swallowed.

Same-attempt receipt replay must use the exact authenticated save grant and
retain the permission dependency without executing native hooks again. A policy
change must not let a cached result bypass publication validation. A changed
grant cannot borrow or replay the old admission. Proven precommit conflict may
retry only through the existing replay-safe whole-root owner.

Unknown COMMIT follows existing outcome resolution before any retry. Recovery
returns a known committed outcome even if permission was subsequently revoked;
it is not a new write authorization. A known rejection is not a successful save.
Cancellation/closed authority cannot mint or reuse a live save capability.

## Next Correctness Gates

| Gate | Status and exit criteria |
| --- | --- |
| SA1: protected permission evidence | Implemented for the bounded private source above: command-only ownership, genuine V3 finite admission, tracked policy reads, opaque attempt/principal evidence, missing/corruption distinctions and same-root acquisition refusal. |
| SA2: native authorized saves | Implemented for private optional-one Product references: protected V3 joint composition, native create/update/delete access, effective assignment/retention checks, null/omitted/same-value, clear/reattach, repeated-call and delete/preference behavior. No nested commerce write authority or public save API. |
| SA3: atomic freshness and replay | Implemented for the bounded private backend profile: distinct ordinary-role PostgreSQL lock orders, changed-capability receipt refusal, stale exact replay, genuine one-shot whole-root retry with fresh permission acquisition, interruption/denied-root rollback and durable outcome recovery after later revocation. |
| SA4: consumer cutover and cleanup | Implemented for the selected private Worker consumer: normal protected-save construction, real journal/RPC binding, trusted operation cursor, opaque caught-refusal rollback and fresh retry. Its allow-all joint-save assembly is removed; distinct trusted/default and read-only profiles remain. General serving authorization and production dispatch are not established. |

Required connected evidence includes source-only write permission, read/discovery
without assignment, assignment without source write, allowed assignment, denied
retention, retention without Product visibility, soft-deleted retention versus
new assignment, hidden/missing/foreign targets, explicit clear/delete without
target grants, hook-normalized target changes, forged overrides/context/grants,
wrong principal/scope/revision and policy changes after receipt capture.
Denied cases compare row/history/index/fact/event/outcome state and actual opaque
Worker responses; native access and operation counters prove the executing path.

Implementation requires fast PGlite semantics and focused ordinary-role real
PostgreSQL validation reported separately, affected connected Worker consumers,
Pinggg `tsc-rs`, lint/source guards and both required read-only project reviews.
The bounded SA1-SA4 foundations establish no performance acceptance or
production authorization claim.

The selected successor is the
[private schema and binding lifecycle preflight](./reference-schema-binding-lifecycle-preflight.md).
Its LB1-LB4 proof remains pending. It reuses protected saves to distinguish
editor-policy freshness from schema/source/dependency and binding lifecycle;
SA1-SA4 completion does not establish support for those transitions.

## Cutover, Data And Deferred Work

Plan against fresh isolated policy/source data first. There is no approved reset,
backfill, reinterpretation of outstanding attempts or migration of named durable
data. Preserve real receipt/outcome identities and the independent existing
default/read profiles. Any later incompatible internal contract must migrate
its actual callers and remove displaced assembly in the same scope.

Defer public APIs, generalized permission engines, external revocation feeds,
arbitrary native access predicates/hooks, draft/version/localization behavior,
many/joins, pending new Products, reverse traversal, opposite-direction Medusa
extensions and dependency-changing schema activation. Those gates remain in
their owning roadmaps; this preflight neither expands nor closes them.

## Convex Compatibility And Flarex Divergence

The local [Convex database contract](../../../../npm-packages/convex/src/server/database.ts)
keeps explicit operation composition and distinguishes typed IDs from existence.
Retain that developer model. Flarex's declared strong-reference integrity and
framework-owned source/target permission boundaries are deliberate additions;
they do not turn ordinary IDs into relations or permit nested writes through a
reference. Native Application OCC, Payload lifecycle and Medusa business
semantics remain distinct under one trusted settlement owner.
