# Private Cross-Framework Reference Foundation

## Status And Scope

Status: backend implementation proposal; no cross-framework capability is
implemented or enabled by this document. Preparing this preflight does not
authorize the proposed lifecycle change or runtime cutover. Existing scoped
approvals retain their own authority.

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
| [Candidate contract](../../packages/flarex-protocol/src/logical-schema-candidate.ts) | Qualified endpoints, source-owned strong-reference extensions, document IDs or single text primary keys, schema-derived liveness and restrict policy | Admit the exact optional/nullable source shape and selected lifecycle policy without reinterpreting existing definitions |
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

The current candidate accepts plain string/document-ID reference fields, while
optional native Payload scalar text is compiled as a nullable union. That is a
real contract gap for this optional commerce reference. Correct the shared
endpoint decoder and compiler evidence together; do not require a fake product,
empty-string sentinel, a mandatory field or a weaker unchecked cast.

## Proposed First Backend Profile

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

Only fresh isolated installations and the existing finite, database-only
mutation profile are proposed initially. General drafts/versions/localization,
many/joins, arbitrary hooks, remote effects, durable suspended workflows and
public/hosted serving retain their gates. Unsupported configurations refuse at
admission; a draft read cannot silently return a published or current record.

## Proposed Lifecycle Policy And Required Core Correction

Recommended initial outcome: require an active Product when creating a new
reference, preserve existing identities across Product soft deletion, and
restrict hard deletion while references remain. This remains a proposal,
including its intentional effect on explicitly participating commerce targets.
Native Module Links and extension-free Product behavior retain their own
contracts; their presence does not select this stronger policy.

| Event | Proposed behavior |
| --- | --- |
| Create or change a non-null article reference | Target must exist, belong to the same authorized shop and be active in the admitted final state; check assignment permission again on save |
| Clear the optional reference or delete the article | Remove its derived membership; invoke no commerce mutation; article deletion retains native preference cleanup |
| Soft-delete a referenced Product | Preserve the stored reference and reverse membership; native commerce lifecycle/events remain owned by Medusa |
| Edit unrelated article data while its Product is soft-deleted | Permit retention with article permission and an explicit retain-existing policy; do not treat unchanged identity as a new assignment |
| Resolve an unavailable or unauthorized target | Return only the outcome permitted by the read profile; do not expose Product details or distinguish hidden from missing targets to an unauthorized caller |
| Restore the Product | Existing reference may resolve again after normal read authorization; native restore/unique conflicts still apply |
| Hard-delete a Product referenced by an existing article | Refuse atomically, including when the Product is already soft-deleted |
| Clear/delete every referencing article and hard-delete its Product in one admitted root | Permit only if the complete final graph and native commerce constraints allow it; no automatic cross-owner cascade |

The current liveness projection cannot express this policy. Its one
`targetLiveness` predicate governs both required targets and target transitions;
`softDeleteNull` plus restrict treats soft deletion as loss of liveness. The
candidate decoder also requires liveness to match the native soft-delete
capability, so setting Product liveness to `current` is not a valid shortcut.
Existing validation rechecks changed source rows, and its target transition
check skips a previously non-live target. Merely relaxing assignment validation
would therefore neither permit safe unrelated article edits nor protect hard
deletion of an already soft-deleted Product.

The proposed correction belongs to the shared authenticated policy,
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

Alternative for a smaller initial profile: restrict both soft and hard deletion
while referenced, matching the current projection's semantics. This changes the
editorial outcome and still needs cross-framework proof; it is not an automatic
fallback if retained-reference implementation is difficult. Resolve the policy
choice before implementing or enabling it. This preflight recommends the
retained-reference outcome but does not mark that choice accepted.

## Reads, Authorization And Pending State

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
| CXR1: policy and authenticated endpoints | Resolve lifecycle choice and exact private principal/read outcomes. Inventory current source refusals and direct/borrowed endpoint writers. Admit optional/null text references through real Payload compiler output, the native Product primary key and shared candidate/activation owners. Missing, wrong-owner, wrong-table and unsupported definitions refuse before capability issuance. No Medusa edit occurs before the ownership checkpoint. |
| CXR2: article-to-product mutation and reads | Run native Payload and Product operations plus an Application campaign mutation in one finite root. Prove selected lifecycle behavior, pending forward/reverse reads, permission checks, complete shared maintenance and one settlement. Preserve standalone endpoint-write safety and existing Payload-to-Payload/delete-preference behavior. This is the first vertical, not completion of the broader gate. |
| CXR3: three-owner and opposite-direction proof | Add a real compiler-admitted Medusa-owned extension referencing Payload or Application, through its owner's native operation path. Choose the extension with the Medusa owner; no fixture-only field or direct generic patch of commerce rows. Prove Application-owned references/consumption and all relevant target transitions with explicitly selected source-lifecycle rules. Native rich Link behavior remains separately characterized. |
| CXR4: dependency activation and recovery | Refuse incompatible endpoint/policy candidates without changing active authority/data. Prove fresh binding/build/readiness, stale capability refusal, admitted rebinding, recovery and concurrent-write safeguards. General populated-data conversions and ownership transfers remain deferred. |

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
project reviewers for significant implementation. This document records future
proof obligations, not successful test receipts. Native-relative performance,
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
