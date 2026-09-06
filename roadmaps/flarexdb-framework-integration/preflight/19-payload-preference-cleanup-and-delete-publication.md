# Payload Preference Cleanup And Delete Publication

Status: preference value/schema, exact binding admission, and bounded cleanup
with authenticated receipts are implemented privately. Atomic lifecycle
publication and Payload adapter routing remain pending; successful Payload
deletion remains blocked.

## Reproduction And Evidence

With pinned `payload@3.88.0`, Admin disabled, `lockDocuments: false` on every
collection, dormant `users`, and fail-closed KV, create a scalar `posts` row and
call `payload.delete({ collection: "posts", id, req, depth: 0 })` through its
admitted CMS host. Payload first calls `db.deleteOne` for content, then always
calls `db.deleteMany` on `payload-preferences` with:

```ts
{ key: { in: [`collection-posts-${id}`] } }
```

The pinned [delete operation](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/collections/operations/deleteByID.ts)
and [preference cleanup](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/preferences/deleteUserPreferences.ts)
make this call regardless of whether any matching preference exists. Disabling
Admin and document locks does not remove the obligation.

The accepted scalar profile expected complete content CRUD without runtime
internal-collection access. The actual pipeline crosses the deferred lifecycle
boundary. The private adapter rejects `deleteMany:payload-preferences`; the
shared PGlite/native PostgreSQL scenario verifies the original row remains and
no revision, index, unique key, commit, fact, retained outcome, wake or scope
clock changes. Create, reads, count, update and fixed nested-hook behavior have
positive evidence; a direct adapter delete is not a substitute for Local API
success. The existing delete assertion remains a refusal/rollback regression
until this prerequisite is implemented.

## Recommended Boundary And Implementation Order

Complete the required cleanup through real, reserved Payload lifecycle storage
before advancing to content relationships. Preserve the Application content
owner and the existing outer CMS transaction. This is a bounded lifecycle
extension, not general `deleteMany`, preference API or dashboard parity.

1. Define a private owner-qualified preference record and deterministic schema
   artifact installed by the existing coordinator. Preserve the pinned record's
   ID, key, user discriminator/ID and JSON value. Its user reference is opaque
   lifecycle data in this cutline; no auth mutation, population or polymorphic
   Application relationship is admitted. Prove that this representation can
   retain the pinned data without claiming those deferred behaviors.
2. Admit that exact lifecycle binding beside the existing content binding.
   Validate matching target, scope, storage generation, fence, availability,
   installed/readiness evidence and pinned configuration/provenance. A slug,
   raw table name or content-only token grants no lifecycle authority. The
   current CMS admission rejection of lifecycle bindings changes only under
   this separately approved contract.
3. Add one operation-specific cleanup port. It accepts only the single
   `collection-posts-<admitted deleted ID>` key emitted by this pipeline, with
   the same live request authority and transaction. Correlate that ID with the
   pending content deletion. Bound matches to the existing CMS identity budget;
   detect overflow before deletion and roll back the whole command. Reject all
   other collections, predicates, keys and bulk operations before SQL. A zero
   match is valid only after an actual query of the admitted lifecycle store.
4. Issue owner-authenticated lifecycle deletion receipts and collect them with
   the content materialization receipts. Persist lifecycle change facts at the
   same scope commit sequence as the content fact, retained result and wake.
   Before coding this publication step, pin its private fact codec/catalog and
   retention contract with the existing commit/feed owner. It must retain exact
   deleted lifecycle identity without exposing preference values. No silent
   relational side effect, synthetic receipt, second commit engine or generic
   publisher registry is admitted. A required shared publication/schema change
   outside this specified family returns to its owner for preflight.
5. Complete actual Payload delete on both drivers. Test empty and matching
   preferences, unrelated key/scope preservation, overflow, missing/stale
   binding, nested failure after cleanup, rollback at each publication boundary,
   replay, native competing requests, interruption and lost COMMIT recovery.
   Seed preferences through a private test-only lifecycle authority, never a
   public preference route or ordinary Application write bypass.

The first implemented slice installs the preference schema through the existing
coordinator and admits its exact content-plus-lifecycle binding. The
cleanup/receipt slice is also implemented; publication follows separately.
Delete stays unsupported until the final combined proof passes.

## Implemented Storage And Admission Contract

The source-private `payloadPreferences` owner defines one Payload-owned
`payload-preferences` lineage. The coordinator injects its existing `scope_uuid`
column and scope foreign key. Authored fields retain storage generation, record
ID, nullable key/JSON value, opaque user collection/ID, and created/updated
instants. The primary key and key lookup index include storage generation and
the coordinator's scope prefix. `users` is the only admitted user discriminator;
this is storage preservation, not auth or polymorphic relation execution.
Capture rejects NUL and unpaired UTF-16 surrogates in all strings and JSON keys
before returning a record, preserving PostgreSQL text/JSONB representability.

Relational values and persisted owner codecs recognize Payload ownership.
Fresh installation is narrower: only the complete canonical pinned preference
artifact and source provenance receive `payload-preferences-fresh` admission.
Another Payload schema, lineage or source revision cannot acquire this
execution profile. Existing system/Medusa profiles retain their prior gates;
Payload additive upgrades remain closed. The metadata migration extends only
the existing collision-owner and admission-profile checks.

Binding preparation, activation and cold re-admission verify the exact artifact,
ready installation/availability receipt, sole binding-only adapter profile, and
pinned scalar content configuration/provenance. No query/store coverage is
claimed. CMS composition must explicitly supply its authenticated preference
target; content-only composition still refuses a lifecycle-bearing head, and a
preference composition refuses a missing lifecycle slot. Each CMS entry locks
and revalidates installation availability beside the scope/binding checks before
running the command. The binding grants no preference data operation or SQL
handle to the command. The subsequent cleanup composition grants only the
operation-specific port described below.

The shared driver scenario exercises installation, typed physical record
round-trip, cold selection, refusal of mismatched profile/readiness/artifact,
and withdrawal before command execution. Existing scalar Local API delete
continues to refuse mandatory preference cleanup. The focused manifest lanes
are `framework-payload-preferences-pglite` and
`framework-payload-preferences-postgres`.

## Implemented Cleanup And Receipt Contract

The transaction-owned cleanup port accepts only `{ key: { in: [key] } }` with
one `collection-posts-<ID>` key. Before SQL, the live CMS request owner validates
the context, transaction ID and write mode, and the document owner authenticates
that exact ID as a pending `posts` deletion. A fabricated ID, content-only
composition, alternate collection or predicate, repeated key, escaped context,
or mismatched request cannot acquire lifecycle mutation authority.

The port derives its qualified table and columns from the already admitted
installation. Every query includes the admitted scope UUID, storage generation
and exact key. It locks and reads at most the remaining identity budget plus
one; overflow fails before deletion. Only those selected identities are deleted,
and returned identities must exactly match. All operations share the outer CMS
transaction, request byte budget and cumulative lifecycle identity budget.

Each completed query/delete issues a private registered receipt containing the
pending content ID, cleanup key and exact deleted preference IDs. A real empty
query issues an empty receipt. No preference values enter this evidence. The
owner closes the complete receipt set, revalidates pending deletions and permits
one authenticated consumption by the same closing admission/lifetime. Commands
cannot supply or discard receipts to influence that set.

The host deliberately rejects every nonempty cleanup receipt set, including an
empty-match receipt, before the content-only publication participant runs.
Cleanup SQL therefore rolls back with all content, commit, fact, retained
outcome, index, unique-key, wake and clock state. The private Payload adapter
still rejects its `deleteMany` call; this slice proves the underlying CMS port,
not Local API delete success. No general relational mutation profile is promoted.

The shared driver scenario reuses the storage/binding fixture to prove empty and
matching cleanup, scope/generation/key isolation, overflow before deletion,
caught failure, failure after cleanup, stale request and withdrawn binding,
exact receipt contents, and full rollback. The next slice must pin the private
lifecycle fact codec/catalog and retention contract, integrate authenticated
receipts into the existing atomic publisher, then route the exact Payload call
and prove actual Local API deletion on both drivers.

## Ownership And Exclusions

Payload owns the cleanup selector and observable Local API behavior. The
coordinator owns physical lifecycle installation and readiness. Binding/CMS
admission owns capability and request lifetime. The existing Application and
commit/feed owners retain materialization, ordering, atomic publication and
recovery. The implemented synthetic relational mutation profile remains
noncommittable; this proposal does not promote it indirectly.

No auth operations, preference HTTP APIs, Admin, locks, jobs, migrations CLI,
user hooks, public `ctx.cms`, Worker, hosted or production activation is added.
No unbound-store empty response, successful unsupported-method stub, catch-and-
continue fallback, or post-commit cleanup may make deletion appear successful.

An alternative is to keep the private profile explicitly create/read/update
only. That preserves useful evidence but leaves the accepted scalar CRUD gate
open and does not advance the ordered relation/Medusa conformance gates.

The [accepted audit stop conditions](./07-payload-release-and-adapter-contract.md#stop-conditions)
and repository shared-owner rule governed the accepted storage/binding decision.
Current implementation deliberately stops before atomic publication and adapter
routing.
