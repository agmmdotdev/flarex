# Payload Preference Cleanup And Delete Publication

Status: proposed owner extension, awaiting explicit approval. The private scalar
Local API proof is partial; successful deletion remains blocked. This note
records an actual integration finding, not a defect in the CMS content owner.

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

The first implementation slice after approval is the preference value/schema
artifact and exact content-plus-lifecycle binding admission, with its refusal
proofs. The cleanup/receipt and publication steps follow as complete bounded
slices. Delete stays unsupported until the final combined proof passes.

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
and repository shared-owner rule require this separate decision. Current
implementation deliberately stops at the refusal boundary.
