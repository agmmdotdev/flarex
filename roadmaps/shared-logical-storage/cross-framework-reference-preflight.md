# Private Cross-Framework Reference Foundation

## Status And Scope

Status: the owner selects retained references on Product soft deletion and
restricted hard deletion for the first private backend slice. The bounded
integrity/lifecycle implementation is described below; general authorized
traversal and the complete CXR1-CXR4 proof remain pending. Public and hosted
capabilities are not enabled by this slice.

The first connected outcome is one optional reference from a Payload article
to an admitted Medusa Product, consumed by Application campaign logic in the
existing finite mixed root. This is a foundation for explicit owner operations,
not a public relation API. Public declaration syntax, generated handles,
`ctx.cms`/`ctx.commerce` signatures and dashboard interfaces remain proposals in
the [developer-contract note](../flarexdb-framework-integration/preflight/unified-application-cms-commerce-developer-contract.md).
This preflight selects none of those interfaces and introduces no new public
API examples.

This documentation task leaves the other session's Medusa implementation,
promotion records, workflow roadmaps and shared runtime edits untouched. Future
Medusa extension or lifecycle changes require an ownership checkpoint before
editing those paths. A Payload-only workaround cannot satisfy that dependency.

## Current Sources Of Truth

- [Accepted database design](../../design-notes/flarex-db-accepted-design.md) and
  [cross-framework relationship contract](../../design-notes/flarexdb-shared-logical-storage.md#cross-framework-relationship-contract)
  own architecture; [package boundaries](../16-package-boundaries.md) own placement.
- [Early cross-framework proof](./README.md#early-cross-framework-proof) requires
  all three producers, both reference directions, indexed reads, lifecycle,
  authorization, schema dependency and recovery evidence. Article-to-product
  alone cannot close that gate.
- [Mixed Payload relationships](../mixed-mutation-core/payload-relationships-attempt-preflight.md)
  and [delete/preference cleanup](../mixed-mutation-core/payload-delete-preferences-preflight.md)
  own the implemented native Payload foundation.
- [Payload's pinned capability map](../flarexdb-framework-integration/preflight/payload-release-capability-map.json)
  records `payload@3.88.0`; [Medusa's source manifest](../../third_party/medusa/SOURCE.json)
  records the fork baseline. Check executing promoted packages and installed
  native source before changing either adapter; snapshots alone prove no runtime
  capability. Native Payload population resolves registered collection loaders,
  not arbitrary commerce sources.
- [Runtime admission correction](./25-cross-source-runtime-admission.md) records
  the earlier unsupported-extension boundary. Current code and connected tests
  determine its present implementation; its description predates the native
  Payload-reference lowering and shared publication enforcement below.
- [Deferred evolution](./deferred-framework-schema-evolution.md) owns later
  conversions, populated-data upgrades and write-owner transfers.

## Implemented Foundation And Specific Gaps

| Owner and current source | Implemented behavior | Required connected extension |
| --- | --- | --- |
| [Candidate contract](../../packages/flarex-protocol/src/logical-schema-candidate.ts) | Qualified endpoints, source-owned strong-reference extensions, exact nullable string/document-ID fields, single text primary keys, schema-derived liveness and explicit soft-delete retention | Broader endpoint/cardinality and visibility profiles retain their gates; existing simple-policy definitions keep their meaning |
| [Payload compiler](../../packages/payload-adapter/src/collections.ts) | Scalar collections and one optional, monomorphic, nonlocalized relationship within the configured Payload collection set | Compiler-authenticated external reference field; native `relationTo` cannot simply name an unregistered commerce collection |
| [Shared requirement lowering](../../packages/flarex-protocol/src/logical-storage-requirements.ts) and [activation projection](../../packages/persistence-postgres/src/storage/documents/logicalStrongReferenceProjection.ts) | Derive/reuse reverse indexes and resolve authenticated endpoint identities and target key claims | Carry the selected reference policy through build/readiness, binding and every relevant writer |
| [Source admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts) and [readiness](../../packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts) | Checked native document relation lowering and dependency closure over strong-reference endpoints | Connected per-profile token-issuance/refusal proof for cross-framework reads and writes; metadata or dependency closure alone grants no new operation |
| [Publication gate](../../packages/persistence-postgres/src/commit/publication/strongReferenceAdmission.ts) and [validation](../../packages/persistence-postgres/src/commit/publication/strongReferenceValidation.ts) | Authenticated changed-row facts, final-state target validation, reverse maintenance and indexed restrict checks under the scope-write lock | Selected cross-framework lifecycle behavior and proof across direct and borrowed endpoint writers |
| [Native Payload population](../../packages/payload-adapter/src/population.ts) | Bounded population of admitted Payload collection targets | A commerce population bridge is separate work; explicit private composition is the initial read path |

Reuse these owners. Do not describe the shared relation engine as absent, or
describe its existing primitives as proof of cross-framework serving. Before
implementation, retain a precise admission matrix and executable witness for
each supported/refused source profile. Reconcile the earlier runtime-admission
note with that evidence rather than removing refusals globally.

The candidate decoder now admits precisely one string/document identity plus
null, matching the native Payload compiler's optional scalar text output.
Arbitrary mixed unions and wrong-table typed identities still refuse. No fake
product, empty-string sentinel, mandatory-field workaround or unchecked cast is
introduced.

## Implemented Private Integrity Slice

The explicit optional `onTargetSoftDelete: "retain"` policy is authenticated in
the existing candidate, activation projection and binding. It is admitted only
with the target's checked soft-delete capability. Omitting it preserves the
existing simple liveness/restrict semantics and serialized meaning.

Shared publication reuses its original-row observation to distinguish retained
edges from new assignments. New assignments require an active final target;
retained edges require structural existence. Validation caches distinguish
those demands. Reverse membership persists across target soft deletion, and
hard deletion checks it even when the original target was already soft-deleted.
Only the existing trusted publisher settles.

The [connected private Worker scenario](../../packages/flarex-backend/test/mixedMutationPayloadCommerceReference.workerd.test.ts)
uses real native Payload scalar CRUD, explicit Product reads and Application
writes in the finite root, plus existing native Product lifecycle/event paths.
The existing fixture now forwards extensions through the real composition owner;
it supplies no enforcement. No Medusa implementation, public facade, commerce
population bridge or general permission engine is added. This is the first
integrity slice, not completion of the wider authorization, reverse-read or
CXR3/CXR4 gates.

The selected [PostgreSQL overlap scenarios](../../packages/flarex-backend/test/mixedMutationPayloadCommerceConcurrency.postgres.test.ts)
use distinct authenticated ordinary-role backends and observe actual
`pg_blocking_pids` edges. Explicit barriers cover new assignment versus Product
soft/hard deletion and clear versus hard deletion in both lock orders. The
native lifecycle host explicitly selects the existing `scopeExclusive` profile;
the mixed root uses its existing publication lock. These scenarios establish
the selected invariant under serialization, not independent-write throughput,
all native execution profiles or permission/binding-change races.

The [connected recovery scenarios](../../packages/flarex-backend/test/mixedMutationPayloadCommerceRecovery.workerd.test.ts)
exercise caught late native failure, cancellation after staging a reference,
and whole-root retry after a real Product read conflict on both database lanes.
Failed roots publish no rows/history/indexes/facts/events/outcomes and leave no
ghost edge restricting a subsequent native hard delete. PostgreSQL additionally
loses the real COMMIT response after an independent connection observes the
durable commit: resolution and replay preserve the reference and all three
owners without rerunning native operations. This is selected record-mutation
recovery evidence; it does not close schema/dependency activation recovery.

## Selected First Private Backend Profile

Use a private Payload scalar field carrying the native Product text primary
key, with an authenticated cross-source extension declaring its reference
semantics. The field name is a fixture detail, not a public schema commitment.
The Payload compiler still owns its field/default/validation behavior; the
composition owner authenticates the endpoint and policy. Optionality must be
proved through native omission, explicit null, create and update behavior.

Resolve the commerce key through the installed target identity and scoped
unique-claim owner. A commerce key is not an Application document ID. Never
infer the target table from its spelling or resolve an ID against another
shop. The article field is the single authoritative reference; reverse index
entries are derived and have no independent write surface. Do not copy Product
records into a second CMS-owned collection.

Real Payload Local API create/update/findByID/delete and the existing admitted
Product service/command path remain the operation boundaries. Trusted private
composition performs a separate Product read when needed. No nested Product
create/update/delete follows from writing or traversing the article field.
Keep direct-write ownership refusal and content deletion/preference cleanup.

Only fresh isolated installations, the existing finite database-only root and
the selected standalone endpoint writers are covered initially. General drafts/versions/localization,
many/joins, arbitrary hooks, remote effects, durable suspended workflows and
public/hosted serving retain their gates. Unsupported configurations refuse at
admission; a draft read cannot silently return a published or current record.

## Selected Lifecycle Policy And Shared Core Correction

The owner selects the initial outcome: require an active Product when creating a new
reference, preserve existing identities across Product soft deletion, and
restrict hard deletion while references remain. This intentionally strengthens
hard-deletion behavior for explicitly participating commerce targets only.
Native Module Links and extension-free Product behavior retain their own
contracts; their presence does not select this stronger policy.

| Event | Selected integrity behavior and remaining access obligations |
| --- | --- |
| Create or change a non-null article reference | Target must exist, belong to the same authorized shop and be active in the admitted final state; check assignment permission again on save |
| Clear the optional reference or delete the article | Remove its derived membership; invoke no commerce mutation; article deletion retains native preference cleanup |
| Soft-delete a referenced Product | Preserve the stored reference and reverse membership; native commerce lifecycle/events remain owned by Medusa |
| Edit unrelated article data while its Product is soft-deleted | Permit retention with article permission and an explicit retain-existing policy; do not treat unchanged identity as a new assignment |
| Resolve an unavailable or unauthorized target | Return only the outcome permitted by the read profile; do not expose Product details or distinguish hidden from missing targets to an unauthorized caller |
| Restore the Product | Existing reference may resolve again after normal read authorization; native restore/unique conflicts still apply |
| Hard-delete a Product referenced by an existing article | Refuse atomically, including when the Product is already soft-deleted |
| Clear/delete every referencing article and hard-delete its Product in one admitted root | Permit only if the complete final graph and native commerce constraints allow it; no automatic cross-owner cascade |

The prior liveness projection could not express this policy. Its one
`targetLiveness` predicate governs both required targets and target transitions;
`softDeleteNull` plus restrict treats soft deletion as loss of liveness. The
candidate decoder also requires liveness to match the native soft-delete
capability, so setting Product liveness to `current` is not a valid shortcut.
The original validation rechecked changed source rows, and its target transition
check skipped a previously non-live target. The shared correction addresses both
boundaries; merely relaxing assignment validation would have left unsafe gaps.

The implemented integrity correction belongs to the shared authenticated policy,
activation/projection and publication owners: distinguish assignment eligibility
from retained endpoint existence and read visibility. Validate new edges against
active targets; validate retained edges and hard deletion against structural
existence, including reverse membership after soft deletion. Derive whether an
edge is new from trusted original/final state, not caller-supplied flags. Recheck
scope, existence and the applicable assignment/retention authorization on save.
Creation followed by deletion in the same root cannot leave a retained edge.

A same-value assignment is retention only when the trusted original edge really
exists. A missing structural target is an integrity failure, never an ordinary
soft-deleted result. Current simple liveness/restrict definitions retain their
meaning; any new policy needs explicit schema encoding, installation and
readiness proof. Do not silently upgrade existing installations.

The existing strict-live policy still restricts both soft and hard deletion
while referenced. It remains an explicit separately encoded behavior, not a
fallback for the selected retention policy. General assignment/retention/read
permission outcomes in the table remain an access-boundary proof obligation;
the private trusted-principal fixture does not establish them for public callers.

## Reads, Authorization And Pending State

### Implemented Private Point-Read Profile

The [connected authorized-read scenarios](../../packages/flarex-backend/test/mixedMutationPayloadReferenceReads.workerd.test.ts)
select a bounded trusted-host grant for one Payload collection and explicit
source/target IDs. The shared private read guard authenticates the native source,
method, finite attempt scope and signed grant's principal digest before lending
the native operation. These grants are trusted composition input, never
application arguments or evidence supplied by a picker.
The canonical grant, native code revision and Payload content identity are bound
into the admitted participant profile revision. Existing source-bundle and receipt
checks therefore keep replay attached to the exact selection; a differently
pinned grant cannot borrow the original admission.

Payload executes its real Local API read access with `overrideAccess: false`.
The selected native point-ID predicate receives a request-local opaque token;
request arguments cannot supply user/context/access overrides. Its compiler-owned
configuration and native field/result handling remain intact. Product reads use
the existing native `retrieve` operation behind the explicit target-ID grant.
The connected profile admits only these two read methods, not discovery or CMS/
commerce mutations. The article's authorized scalar reference and the separately
authorized Product result are not a population bridge or a copied Product record.

Both reads retain the finite root's normal snapshot and exact dependencies.
Application consumption may publish through the existing outer owner; a changed
source or target must conflict before that publication and retry from a fresh
root. Native identities resolve in the admitted shop even when two shops on the
same storage use the same Product key.

Hidden, missing, soft-deleted, foreign and forged-input reads produce the same
opaque Worker boundary failure. Native causes remain with the trusted RPC owner.
An admitted read failure poisons the root, including when application code catches
the rejection; this profile does not convert denial into a successful null result.
Pre-admission method refusal invokes no native mutation. Trusted fixture/default
profiles retain their separate contracts; this is not universal authorization for
all application database reads or a public serving capability.

The grant is a fixed selection for the attempt. Dynamic permission revocation,
authorization races on save, general assignment/retention permissions, native
access predicate trees, drafts/versions, pending new-Product construction,
authorized reverse traversal and general query/reactive composition remain gated.
No public API syntax is selected here.

The save authorization foundation is tracked in the
[private save-time authorization preflight](./reference-save-authorization-preflight.md).
It separates native article write access from target assignment/retention and
requires protected permission dependencies to survive through publication.
SA1 implements protected Application command-only policy writes and tracked
private permission evidence. SA2 connects protected V3 joint-source composition,
native source access and effective assignment/retention checks. SA3 adds the
bounded backend concurrent revocation, replay, retry and outcome-recovery proof.
SA4 connects the selected private Worker consumer with protected-save journal
binding and opaque caught-refusal rollback, and removes its allow-all joint-save
assembly. General serving/production activation remains gated; fixed read grants
do not authorize saves.

### Remaining Read And Composition Contract

The [private authorized reverse-read preflight](./reference-reverse-read-preflight.md)
owns the next bounded CXR2 work after LB4. RR1 implements separate protected
read-policy evidence and a backend-only complete indexed-membership probe through
real finite capture and final validation. RR2-RR4 retain authorized pages, native
visibility, broader pending membership, concurrent freshness and private serving
cutover. No authorized reverse-page operation or public API is enabled.

Use bounded explicit point reads for forward resolution and the installed
leading-reference index for reverse membership. Reverse reads have deterministic
keyset continuation, scope/schema-bound cursors and separate per-page and total
operation budgets. A page is not complete membership or an exact total count.
Integrity restrict checks must not depend on the caller's visible reverse page.
Resource overflow refuses the operation with full rollback; never truncate a
constraint check successfully.

Payload owns content access/validation/hooks, Medusa owns commerce behavior, and
the trusted composition boundary enforces the admitted principal's commerce
discovery, assignment, retention and read permissions. Existing allow-all private
fixtures do not establish that access contract. Prove a bounded principal matrix
through the real boundary, without inventing a general authorization engine.
Picker/discovery results cannot authorize a later save. Private trusted native
options must not turn an application request into an access bypass.

Within a finite root, newly created and updated targets and reverse membership
must be visible through the existing pending owner. Capture exact required
dependencies, including missing targets and indexed membership, through the
appropriate execution owner. Product row-change facts alone are not Application
OCC evidence. If the composed read shape cannot record those dependencies,
refuse it until that owner supports it; do not fall back to untracked direct
reads. General cross-framework query functions and reactive traversal remain
separate proofs.

Independent committed calls remain independent. Direct Payload/commerce
operations use their admitted execution profiles; borrowed operations cannot
start a second transaction owner or settle independently. Only the trusted outer
publisher commits rows, indexes, history, lifecycle facts, events and durable
outcome. No SQL transaction spans untrusted execution or remote work.

## Implementation Gates And Ownership

| Gate | Connected outcome and exit criteria |
| --- | --- |
| CXR1: policy and authenticated endpoints | Retention/hard-delete policy and exact nullable identity admission are implemented for the selected private profile. The bounded private point-read grant checks real scope/principal/source/method admission and opaque read refusals. General principal permissions and the full supported/refused profile matrix remain gated. Missing, wrong-owner, wrong-table and unsupported definitions must refuse before capability issuance. No Medusa edit occurs before the ownership checkpoint. |
| CXR2: article-to-product mutation and reads | The private native mutation and authorized explicit point-read verticals use one finite root and shared lifecycle/dependency owners. Selected distinct-connection scope-lock races, protected permission/binding-change races and record-mutation failure/retry/recovery are covered by their private SA/LB inventories. Authorized reverse reads, general principal policies and pending new-Product construction remain pending. Preserve standalone endpoint-write safety and existing Payload-to-Payload/delete-preference behavior. This vertical does not close the broader gate. |
| CXR3: three-owner and opposite-direction proof | Add a real compiler-admitted Medusa-owned extension referencing Payload or Application, through its owner's native operation path. Choose the extension with the Medusa owner; no fixture-only field or direct generic patch of commerce rows. Prove Application-owned references/consumption and all relevant target transitions with explicitly selected source-lifecycle rules. Native rich Link behavior remains separately characterized. |
| CXR4: dependency activation and recovery | LB1-LB4 prove the selected reference admission/refusal, fresh/stale serving, metadata/withdrawal versus save ordering, historical activation recovery and already-committed save replay after later withdrawal. PostgreSQL acknowledgement loss follows independently observed real COMMIT; reconstructed target pools retain the available control catalog. Broader readiness/build transitions, framework/installation profiles and database/control-plane restart are not established by that inventory. General populated-data conversions and ownership transfers remain deferred. |

The implemented bounded CXR4 inventory and its remaining limits are specified by the
[private schema and binding lifecycle preflight](./reference-schema-binding-lifecycle-preflight.md).
Its LB1-LB4 gates are implemented for the selected protected save consumer:
admission/refusal, supported transitions, stale-use, concurrency and committed
recovery have bounded witnesses. Broader profiles, database/control-plane restart
and uncommitted redispatch remain outside that proof. This selects no public API,
Medusa implementation change or advanced evolution.

Protocol/schema evidence belongs to `flarex-protocol` and producer analysis;
installation/readiness, reference indexes and integrity belong to
`persistence-postgres`; finite root/dependency/recovery composition belongs to
the existing executor owners. Payload configuration/native invocation belongs
to `payload-adapter`, and Medusa service/model/lifecycle semantics to its
existing adapter/promoted-source owners. Extend actual owners and types rather
than creating a relation coordinator, second catalog or generic CRUD facade.

## Required Evidence Before A Capability Is Enabled

- **Native semantics and identity:** real Local API and admitted Product
  operations; omission/null/preservation/reassignment; malformed/wrong-table
  targets; equal local keys across two shops; foreign/stale authority refusal.
- **Permissions and reads:** distinguish discovery from assignment/read; revoke
  permission between discovery and save; no nested commerce write authority;
  hidden/unavailable outcomes; forward point and reverse paged results; pending
  membership after create, reassignment, clear and delete.
- **Lifecycle:** active and already soft-deleted Product hard deletion; unrelated
  article edits; restore and native unique conflicts; deletion after clearing
  references; unchanged simple-policy and native-Link regressions.
- **Concurrency:** distinct PostgreSQL connections and explicit barriers for
  reference insertion versus soft/hard deletion in both orders, clear versus
  delete, and permission/binding change versus save. Every legal ordering keeps
  the selected invariant; scope-lock serialization is safety evidence, not
  independent-operation throughput evidence.
- **Atomicity/recovery:** late failure, caught failure/rollback-only behavior,
  conflict/retry from a fresh root, duplicate invocation/replay, cancellation,
  uncertain COMMIT resolution before replay, and matching rows/indexes/history/
  preference cleanup/facts/events/outcome. Real lost-COMMIT evidence is a
  PostgreSQL lane; bounded PGlite simulations are labeled separately.
- **Selective access and bounds:** representative reverse fan-out and actual
  PostgreSQL query plans, complete restrict outcomes, bounded page/byte/work
  accounting and atomic capacity refusal. No whole-shop scan, capped-page
  integrity shortcut or arbitrary limit increase.
- **Activation:** missing/incompatible endpoint, changed policy, stale binding,
  incomplete reverse build and unsupported profile refuse; no catalog-only
  success is reported as runtime relationship support.

Run fast PGlite semantics and focused ordinary-role real PostgreSQL validation
separately, then the affected connected Worker regressions. Use Pinggg `tsc-rs`
for affected package typechecks, required lint/source guards and both read-only
project reviewers for significant implementation. These are proof obligations;
Git owns chronological validation receipts. Native-relative performance,
capacity and hosted production acceptance remain separate open gates.

Extend the [candidate contract tests](../../packages/flarex-protocol/test/logical-schema-candidate.test.ts)
and real [Payload relationship](../../packages/flarex-backend/test/mixedMutationPayloadRelationships.workerd.test.ts)
and [delete/preference](../../packages/flarex-backend/test/mixedMutationPayloadDelete.workerd.test.ts)
Worker scenarios at their existing owners. Add the connected cross-framework
witness there or in its actual consumer's test owner; fixtures must not implement
reference enforcement, permission decisions or a second publication pipeline.

## Cutover, Cleanup And Deferred Work

Before implementation, identify retained codec/installation/receipt obligations
and the callers displaced by the selected policy. Migrate affected private
consumers and remove superseded refusal/translation paths only for the admitted
profile after connected proof. Keep unsupported policies refused; retain existing
simple-policy, Payload population, native Link and extension-free commerce
coverage. No named durable environment, row, history or outstanding attempt is
reset, deleted or reinterpreted by this preflight.

Do not expand general preference CRUD, Payload parity, CMS generation, public
syntax, generated operation handles, dashboards, arbitrary nested graph writes,
cross-shop/distributed transactions, full migration orchestration or reactive
subscriptions to make this private vertical appear complete. A later commerce
population bridge must preserve target access/lifecycle and native Payload
loader behavior; explicit composition here does not claim that bridge exists.

## Convex Compatibility And Flarex Divergence

The local [Convex database contract](../../../../npm-packages/convex/src/server/database.ts)
distinguishes typed/normalized identity from existence and permits absent reads.
Preserve explicit mutation composition. An authenticated strong reference adds
an intentional Flarex integrity contract; ordinary stored IDs do not acquire
foreign-key behavior. Shared Postgres publication enforces the chosen policy
while Application OCC and native framework execution remain distinct.
