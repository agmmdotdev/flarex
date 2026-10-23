# Private Authorized Reverse-Reference Reads

## Status And Scope

Status: RR1-RR3 are implemented for protected read evidence, complete bounded
indexed-membership feasibility, private authorized finite pages and selected
concurrent freshness/recovery. RR4 private serving cutover remains pending. The private RR1 probe
returns no article, identity, count or cursor, and has no Worker/public entry
point. Reverse pages have backend construction only; Worker/public serving,
production capacity and workload-specific plan claims remain
outside this implemented inventory.

The selected outcome is an authorized, bounded enumeration of Payload articles
whose optional scalar reference points to one existing, active Medusa Product,
with Application consumption inside the existing finite mixed root. The article
field remains authoritative. Reverse membership remains a derived ordered index.
Actual collection and field names come from the authenticated composition;
fixture names are not a public schema contract.

The [SA1-SA4 save authorization](./reference-save-authorization-preflight.md) and
[LB1-LB4 binding lifecycle](./reference-schema-binding-lifecycle-preflight.md)
inventories are implemented for their selected profiles. They do not establish
reverse discovery. RR1 adds tracked read-policy evidence; it does not enable
reverse discovery. This work extends CXR2 in the
[cross-framework preflight](./cross-framework-reference-preflight.md).

Public declarations, generated handles, SDK signatures, dashboards, general
query functions, reactive traversal, automatic commerce population, new-Product
construction and CXR3's Medusa-originating extension remain separate. The other
session's Medusa implementation and promotion/workflow roadmaps are untouched.

## Current Sources Of Truth

- [Accepted database design](../../design-notes/flarex-db-accepted-design.md),
  [cross-framework relationship contract](../../design-notes/flarexdb-shared-logical-storage.md#cross-framework-relationship-contract)
  and [package boundaries](../16-package-boundaries.md) govern authority.
- [Private point-read scenarios](../../packages/flarex-backend/test/mixedMutationPayloadReferenceReads.workerd.test.ts),
  [read access issuer](../../packages/persistence-postgres/src/execution/journal/privateReadAccess.ts)
  and [Payload reference-read runtime](../../packages/payload-adapter/src/runtime/referenceRead.ts)
  establish the existing fixed-selection read profile.
- [Protected permission evidence](../../packages/persistence-postgres/src/execution/journal/privatePermissionEvidence.ts)
  and [private save consumer](../../packages/flarex-backend/src/privatePayloadSaveConsumer.ts)
  establish tracked, attempt-bound save evidence and trusted serving composition.
- [Reverse-read evidence](../../packages/persistence-postgres/src/execution/journal/privateReverseReadEvidence.ts),
  [private admission](../../packages/persistence-postgres/src/execution/journal/privateReverseReadAccess.ts),
  [CMS feasibility probe](../../packages/persistence-postgres/src/frameworks/cmsTransaction/privateReferenceProbe.ts)
  and [connected RR1 scenarios](../../packages/flarex-backend/test/privatePayloadReverseReadEvidence.test.ts)
  establish the selected protected read and shared indexed-membership foundation.
- [Private native page runtime](../../packages/payload-adapter/src/runtime/referencePages.ts)
  and [connected RR2 scenarios](../../packages/flarex-backend/test/privatePayloadReversePages.test.ts)
  connect authorized pages to native Product receipts and Payload point hydration.
- [Concurrent freshness](../../packages/flarex-backend/test/privatePayloadReverseFreshness.test.ts),
  [replacement/frontier/failure semantics](../../packages/flarex-backend/test/privatePayloadReverseRecovery.test.ts)
  and [committed recovery](../../packages/flarex-backend/test/privatePayloadReverseRestart.test.ts)
  connect native pages and Application consumption to existing publication,
  whole-root replacement and durable outcome owners.
- [Reference selection](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts),
  [activation projection](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/strongReferenceProjection.ts)
  and [publication validation](../../packages/persistence-postgres/src/commit/publication/strongReferenceValidation.ts)
  own checked endpoints, reverse-index identity and final integrity.
- [Logical working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts),
  [index reads](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/indexReads.ts)
  and [query selection](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/query.ts)
  own scoped snapshot reads, pending documents and membership/page evidence.
- [Journal indexed queries](../../packages/persistence-postgres/src/execution/journal/indexedQueries.ts)
  and [relation reads](../../packages/persistence-postgres/src/execution/journal/relationReads.ts)
  establish existing Application dependency profiles, not a cross-framework grant.
- [Payload bounded joins](../flarexdb-framework-integration/preflight/23-payload-bounded-reverse-joins.md),
  [indexed queries](./05-indexed-payload-queries.md) and
  [Payload adoption](../flarexdb-framework-integration/07-payload-adoption.md)
  retain their exact standalone, native and mixed-operation boundaries.

The executing peer is `payload@3.88.0`, pinned in the adapter manifest. Its
installed `collections/operations/findByID.js` executes native read access,
combines access constraints with the ID query and performs native read hooks.
The adapter's [operation owner](../../packages/payload-adapter/src/operations.ts)
sets `overrideAccess: false` and owns the borrowed request/transaction identity.
Recheck that executing contract before implementation; a raw adapter read does
not prove the native lifecycle.

## Current Architecture And Capability Gaps

| Existing owner | Implemented behavior | Missing selected proof |
| --- | --- | --- |
| Private point-read issuer/runtime | Fixed source/target ID selections bind scope, principal, method, source and native revision to the genuine attempt. Payload access uses a private request token. Admitted denial poisons the root. RR2 also requires a genuine target grant and completed native receipt | A point ID alone grants no reverse-discovery authority; broader principal policies remain separate |
| Protected permission reader | Command-only Application storage and one tracked-point acquisition path for separate strict save and read policy records. RR1 read evidence binds allowed Product enumeration and source article identities to the real principal/attempt | Native read/discovery serving. Existing save-policy fields retain only create/update/delete and assign/retain semantics |
| Strong-reference projection/publication | Authenticated source field, target key and reverse ordered index; retained soft-delete membership and complete indexed hard-delete restriction | Read-side selection/issuance and finite snapshot/pending enumeration under principal authorization |
| Logical document/index owners | Snapshot capture, pending working set, bounded membership and examined-page evidence. RR2 adds a selected private document-reference page over the same capture, root and final-validation owners | Ordinary finite document `find` still requires complete bounded membership through `readFiniteIndexRows`. The private page is no general document-query API or cross-request cursor |
| Journal Application index/relation reads | Developer-index resolution and native Application relation dependency handling | Developer-index resolution selects `access.kind === "developer"`; native incoming relations use edge definitions. Neither can be relabeled as a strong-reference index capability |
| Payload native participant binding | Borrowed create/update/delete/findByID; standalone indexed find/count and bounded native joins have separate proof | Borrowed find/count and cross-framework reverse discovery remain unadmitted. Adding a method name to the allowlist cannot establish the missing authority, paging or dependencies |

The proposed reuse path is authenticated logical-reference selection through
the existing logical document/index and finite capture/validation owners, then
native Payload point hydration for authorized identities. Do not use native
Payload join declarations to name an unregistered commerce collection, copy
commerce records into CMS, scan every article, or expose the publisher's current
index scanner as an application read.

These are admission boundaries and unproved extensions, not reproduced defects
in a supported reverse-page capability. RR1 connects the existing complete
bounded indexed-read path without changing shared index/settlement semantics.
Keep its executable witnesses before extending that owner for RR2. If work finds a
shared defect, record expected/actual behavior and ownership here, preserve the
failure, and stop dependent work for the AGENTS.md correction checkpoint.
Fixtures and adapters must not substitute direct SQL or duplicate validation.

## Invariants And Trust Boundaries

Only trusted backend composition selects the reference definition, protected
policy point and read profile. The genuine finite attempt binds deployment,
scope, principal, snapshot, source/content/native identities and active binding.
Application input cannot supply policy evidence, source/table/index identities,
raw transactions, native access options or commit capabilities. Equal Product
keys in different shops do not select the same authorized endpoint.
Product text keys are not Application document IDs. Decode article identities
against the authenticated source table and resolve the Product key through its
installed scoped target identity; neither table nor scope follows from spelling.

The existing protected command-only Application write policy is the owner for
read-policy changes. Reuse its analysis, ownership, admission and publication
mechanics; do not create an adapter permission store. The proposed read policy
is a separate private record contract, not a reinterpretation of save-policy
create/update/delete, assign or retain fields. No existing durable record is
silently rewritten. RR1 stores the separately tagged
`flarex.private-reference-read-permissions` record in the existing registered
command-only Application policy table. Its strict decoder owns principal,
collection/reference, bounded Product text keys and article document IDs.
The selected private fixture uses `audit` under
`application.reference-permissions`; no physical table, migration, reset or
reinterpretation of an existing save record is introduced.

Read evidence must come from a real tracked protected point read, including a
missing-policy observation, and remain bound to that attempt and principal.
Missing or denied policy cannot fall back to fixed-ID/default/allow-all runtime
construction. Invalid stored policy remains a trusted corruption failure;
infrastructure, interruption and full cleanup Causes keep their existing owners.

Only the existing trusted outer publisher settles. A reverse read is read-only;
it grants no article mutation, Product mutation, cascade, assignment or retention
right. Independent calls remain independent. No transaction spans untrusted
Worker execution or remote work, and no second query/transaction/recovery owner
is introduced.

## Proposed Private Profile And Decisions

### Permission And Visibility

Use one selected scalar reference, one admitted Payload collection and one
existing active Product per enumeration. The first private policy separates
permission to enumerate this Product's incoming references from permission to
read each source article. The proposed read-policy record selects the principal,
collection/reference, allowed Product identities for enumeration and allowed
article document identities for source reads. Empty Product selection denies
enumeration; empty article selection yields no visible articles for an otherwise
authorized target. Both identity selections are bounded by existing private
grant/capture limits. Arbitrary predicates and a general authorization engine
are outside this profile; do not raise limits to fit a test.

The Product must pass its existing admitted native point-read path and target
read selection. A wrong-shop, missing, hidden or soft-deleted Product produces
the existing opaque unavailable outcome before article enumeration. Retention
of a stored reference does not make a soft-deleted Product discoverable.
Restore permits a newly authorized attempt, not reuse of a stale capability.

Trusted source visibility is evaluated before offering a candidate identity to
application code. Hydrate admitted identities through actual Payload Local API
findByID at depth zero, real read access and native hooks in the same borrowed
root. The read-policy selection must drive that native access; the Worker cannot
supply user/context/overrideAccess or a more permissive runtime.

Filtering and failure are different operations. A candidate hidden by the closed
policy is omitted by trusted selection. An admitted native read that fails must
still poison the root; do not catch its rejection and continue with a partial
successful page. Denied source identities and documents are never serialized.
Read hooks that change projected fields do not become reference authority;
membership comes from the checked effective stored source transition.

Neither source membership nor assignment/retention permission proves read
access. Enumeration output cannot authorize a later save. Hard-delete restrict
continues to inspect all live referencing sources, including sources invisible
to this principal, independently of the returned page.

### Paging, Continuations And Budgets

Use the installed leading-reference ordered index with exact Product-key
equality and its authenticated physical ordering/tie-breaks. Bind order to the
actual selected spec and stable row identity; do not sort a truncated window.
The selected result is a bounded page of authorized articles with continuation
only when another authorized result is established. Raw membership lookahead
does not establish visible lookahead. No exact totals or hidden-member counts
are included.

The first proposed continuation is private and attempt-local. Its owner must
bind it to the exact reference/index/spec, Product key, scope, schema/binding,
snapshot, principal/read-policy evidence, ordering and relevant pending state.
It must not disclose raw hidden row identities or accept a forged/rebound
position. Representation stays with the trusted read owner; no public cursor
encoding or new durable cursor service is selected here. Closure, whole-root
replacement or relevant pending membership changes invalidate continuation;
restart enumeration under the new state rather than mixing pages.

Charge inspected memberships, hidden candidates, row/native hydration, lookahead,
bytes, statements/captures, elapsed work and cumulative root usage through
existing resource owners. A small output limit is not a scanned-work bound.
Continue past hidden candidates only within those bounds, until visible
lookahead or real exhaustion is proved. Exhaustion of the work budget refuses
the operation and poisons the mixed root; it is not a successful truncated page
or a false empty/exhausted result. Do not add offset scans or whole-shop counts.

### Snapshot, Pending State And Freshness

All membership, permission, Product and source reads use the same finite root's
snapshot and exact required dependencies. Record examined index intervals,
negative/empty ranges, lookahead/exhaustion, relevant source/target points and
protected policy observations through existing capture, freeze and publication
owners. Row-change facts or a final existence check alone cannot detect a
concurrent insertion into an empty reverse range.

Merge real Payload create, reassignment, clear and delete transitions through
the existing pending-document owner. A source appears once in its effective
membership, disappears from its old target, and is absent after deletion.
Preserve Application overlays if admitted alongside it. A committed-only index
scan or Application-only point overlay cannot supply this guarantee.

Authorization is snapshot-based with publication validation for Application
consumption. A revocation visible at entry refuses. A later conflicting policy,
membership, consumed source/target or metadata change must prevent stale
consumption from publishing and use existing whole-root replacement rules.
Do not claim immediate revocation of information already observed, universal
phantom protection outside the inspected dependency, or an automatic retry
inside a page read. General read-only query serving remains separately gated.

## Implemented Capabilities And Known Limits

RR1 uses the existing protected command writer, tracked point/ownership capture
and real finite source admission. One shared protected acquisition path selects
the save or read decoder; no second permission store or query snapshot is added.
Missing policy returns tracked absence, while wrong contract/corrupt data remains
a typed corruption failure. Derivation denies missing policy or an unselected
Product and refuses foreign principal/attempt, non-command storage, wrong source
article table and unsupported reference selection.

The backend-only `private-reference-membership-probe` requires a genuine
reference/index selection and an issued read-evidence capability. It borrows
the existing CMS/document working set and records complete bounded equality
membership through finite storage capture. It discards all source values and
returns null. It is not a native Payload read, an authorization-filtered page or
a Product visibility check. The ordinary Payload borrowed method allowlist and
Worker construction remain unchanged.

The connected scenarios preserve exact index identity and a scan-free graph for
empty/nonempty membership, receipt replay and native pending creation in one
evaluator. A CMS test-support observer checks the actual query result, including
the pending article identity and one execution across replay; this observation
is not operation input or caller output. Sequential later publication of a new reference or read-policy change
invalidates the frozen reader before its publication; creating a previously
missing policy also conflicts. These prove dependency delivery to existing
final validation. RR3 adds actual concurrent publication-order barriers below.

RR2's backend-only `private-reference-page` requires the separate protected read
evidence and a completed native Product retrieve receipt from this same root,
under an issuer-authenticated target point grant. The checked reference catalog
resolves the target table/source; the root's effective Product point must remain
active. Missing, hidden, foreign-principal/scope and soft-deleted targets cannot
authorize source enumeration. The ordinary native Payload method allowlist is
unchanged.

The document owner reads equality-bound snapshot index windows in the installed
physical key order, including the creation-time suffix and row-ID tie break.
It merges actual Application/native pending rows, filters the protected article
selection before native hydration, and records examined page intervals and EOF.
Allowed articles and the visible successor run real Payload `findByID` with
depth zero, `overrideAccess: false`, scoped access and native hooks in one
borrowed CMS invocation. A successor's native failure aborts the entire page.
There is no exact count, raw scanner or hidden position in the output.

Continuation tokens are random, opaque and retained only by the original root.
They bind the exact issued child admission (and therefore reference, index/spec,
policy, target, source/native identities, principal and binding snapshot) and
relevant source-write generation. A relevant pending transition invalidates
continuation; unrelated membership edits and read hydration do not. Root closure
or replacement cannot reuse the token. The existing call, byte, capture,
deadline and root resource owners remain authoritative, with explicit per-call
and cumulative-root inspected-membership accounting. Hidden-heavy overflow
refuses atomically; a small output limit is no scan-budget exemption.

Connected RR2 scenarios cover hidden candidates around visible results,
all-hidden/empty pages, native hooks and visible lookahead, receipt replay,
forged/rebound continuations, pending reassignment/clear/delete, unrelated versus
relevant edits, pending creation, soft-delete/restore and native/capacity failure
rollback. The explicit-ID policy cannot authorize an unknown future generated
article identity: the pending-create scenario verifies its real membership is
examined and remains hidden, using a trusted query observer rather than an
output-only empty assertion. RR3 extends these bounded cross-driver semantics;
Worker serving remains RR4.

RR3 connects the existing page path to real Application writes and finite
executor replacement. Ordinary-role PostgreSQL observes distinct backend PIDs
and real scope-lock wait edges for both publication orders of enumeration and
article-selection revocation, insertion into an empty range, membership removal,
consumed article/Product changes, Product soft deletion and binding withdrawal.
The empty-range witness has no source point dependency: its installed index
dependency prevents the phantom. A reader ordered first may commit; a relevant
change ordered first prevents stale Application consumption from publishing.
PGlite establishes the corresponding serial semantics, not concurrent overlap.

The examined physical prefix, EOF and consumed points define the freshness
frontier. A new tail membership outside the non-exhausted captured prefix can
coexist with publication; inserting an earlier membership into that prefix or
changing a captured source point conflicts. This is neither collection-wide
phantom protection nor a promise that only returned documents are observed.
Actual whole-root replacement advances fence/snapshot, re-reads protected
policy and native data, discards the losing Application insertion, and refuses
the abandoned root's access and continuation. A newly denied enumeration cannot
hydrate articles. Receipt replay preserves the earlier observation without
native hooks; it does not refresh policy or permit stale publication.

Catching an admitted native failure cannot revive the root. Interruption after
native hydration and before receipt acknowledgement aborts it, revokes its
access, drains the owned operation and closes the native scope. This bounded
cancellation point does not establish arbitrary foreign-Promise cancellation.
Committed Application consumption survives permission/binding withdrawal,
producer host/native-scope closure and reconstruction from durable configuration
and selector alone. PostgreSQL additionally forwards real COMMIT, independently
observes durability, then loses its response. Resolution and repeated fresh-pool
recovery return the stored outcome without re-enumeration, native hooks or
duplicate rows/facts/outcomes. PGlite covers reconstruction semantics only;
database/control-plane crash recovery remains outside this inventory. RR3 uses
the existing owners without a second validation, retry or recovery algorithm.

Existing point-read, save-authorization, integrity/delete, preference-cleanup and
LB1-LB4 proofs retain their exact scopes. Payload-to-Payload bounded joins remain
a separate implemented profile. No public or hosted capability is enabled.

Drafts, versions, localization, many-valued references, reverse native Links,
custom sorting, counts, cross-request cursors, database/control-plane restart,
reactivity and broader principal policies remain outside the selected profile.
Later support must have its own admission and lifecycle evidence.

## Target Direction And Next Correctness Gates

| Gate | Connected outcome and exit criteria |
| --- | --- |
| RR1: protected read evidence and shared admission feasibility | Implemented for the separate protected record and backend-only complete-membership probe above. Genuine command writes, positive/missing reads, issuer/principal/attempt/source selection, empty/nonempty indexed capture and native pending creation reach real final validation. Sequential late reference/policy commits refuse stale publication. Paged visibility, Product native access and actual overlap remain later gates; no new shared index/settlement algorithm was required |
| RR2: authorized finite reverse pages | Implemented for the selected private profile above: protected policy, separate native Product grant/receipt, authorized native Payload hydration, visible lookahead, deterministic attempt-local continuation, pending membership, exact examined dependencies and atomic capacity refusal. No broad borrowed find/count admission, Worker/public operation or raw scanner exposure |
| RR3: concurrent freshness and recovery | Implemented for the selected private page/Application-consumption profile above: both observed PostgreSQL publication orders, exact prefix/negative dependencies, genuine whole-root replacement, caught native failure, bounded pre-ack cancellation/drain, receipt/outcome replay and real lost-COMMIT resolution after permission/binding withdrawal. Closed-producer reconstruction uses durable configuration/selector only and does not re-enumerate. PGlite proves serial/reconstruction semantics, not overlap or acknowledgement loss |
| RR4: selected private serving cutover and cleanup | Connect the real Worker/RPC consumer to normal protected read construction. Keep denied/foreign/forged input opaque, native failure poisoning and current source identity intact. Migrate only the selected consumer and remove displaced assembly after parity. Reconcile supported/refused profiles and retain named fixed point-read, standalone join, save and lifecycle consumers. Public and hosted entry points remain disabled |

The next implementation is RR4's selected private Worker/RPC consumer and
cleanup. Preserve RR1-RR3's authority, complete-membership, native-page,
freshness and recovery witnesses. Public API design remains separate.

## Validation, Cutover And Cleanup

PGlite must cover the permission/visibility matrix, deterministic pages, pending
membership, exact dependencies and rollback under capacity/native failures.
Focused ordinary-role PostgreSQL must additionally show distinct backend
identities and real barriers for claimed ordering, generated query plans and
bounded retrieval under skew/hidden-heavy fan-out. Report those lanes separately;
an indexed catalog definition or a passing small fixture proves no selective
plan, capacity target or hosted behavior.

Exercise at least two principals and two scopes with equal Product keys, hidden
sources before/between/after visible sources, no visible sources, forged/stale
selection and cursor input, and unrelated state changes that should remain
reusable. Compare returned native values and document identities, affected
dependencies and the rows/revisions/indexes/facts/events/outcomes appropriate to
each witness. Check hard-delete restriction even when this principal sees no
articles. Tests arrange genuine commands and observe results; they implement no
permission evaluator, index merge, publication or retry algorithm.

Use affected Pinggg `tsc-rs` checks, source/compatibility guards, lint and both
required read-only project reviewers for implementation. Stop owned database and
Worker resources. Git owns validation receipts, not this living roadmap.

Inventory consumers and durable contracts before replacement. Keep existing
save-policy bytes and point-read/default/standalone obligations unless explicitly
migrated. Remove only displaced selected-consumer construction after the new
private path passes; preserve meaningful native access, deletion/preference,
failure/recovery and cross-driver regression coverage. No data reset, migration,
unowned Medusa edit or compatibility removal is authorized by this document.

## Convex Compatibility And Flarex Divergences

The local [Convex query contract](../../../../npm-packages/convex/src/server/query.ts)
provides indexed bounded reads and pagination while preserving explicit function
composition. Keep that developer model. This private contract adds scoped
cross-framework strong-reference identity, native owner access and trusted
permission evidence over Postgres. Its attempt-local filtered pages do not
claim Convex cursor compatibility, a public join API, reactive pagination or
one universal framework OCC profile.
