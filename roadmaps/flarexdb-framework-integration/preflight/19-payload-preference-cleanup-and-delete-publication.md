# Payload Preference Cleanup And Delete Publication

Status: preference value/schema, exact binding admission, and bounded cleanup
with authenticated receipts, atomic lifecycle publication and exact Payload
adapter routing are implemented privately. The closed scalar Local API delete
path succeeds under exact combined content/lifecycle admission.

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
boundary. The content-only composition rejects required preference cleanup; its
shared PGlite/native PostgreSQL regression verifies the original row remains and
no revision, index, unique key, commit, fact, retained outcome, wake or scope
clock changes. Create, reads, count, update and fixed nested-hook behavior have
positive evidence; a direct adapter delete is not a substitute for Local API
success. That content-only assertion remains a refusal/rollback regression beside the
combined-binding positive deletion proof.

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
cleanup/receipt and atomic publication slices are also implemented, including
the final combined Payload deletion proof.

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
and withdrawal before command execution. Content-only scalar Local API delete
continues to refuse mandatory preference cleanup; the combined binding succeeds. The focused manifest lanes
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

The CMS participant consumes the complete cleanup closure alongside its
authenticated document closure. It publishes deletion identities with content,
commit, retained outcome, index, unique-key, wake and clock state in one outer
transaction. Empty cleanup is a real query with no lifecycle fact children.
The adapter routes only the pinned `payload-preferences` selector through the
port. No general relational mutation profile is promoted.

The shared driver scenario reuses the storage/binding fixture to prove empty and
matching cleanup, scope/generation/key isolation, overflow before deletion,
caught failure, failure after cleanup, stale request and withdrawn binding,
exact receipt contents, and full rollback. The publication scenario proves actual
Payload deletion, empty and matching preferences, exact-256 and cumulative
two-key overflow boundaries, every publication fault boundary, nested failure,
replay and retention corruption/refusal. Native PostgreSQL additionally proves
competing same-key requests, interruption after cleanup, and lost-COMMIT
recovery on a fresh connection without callback replay.

## Ownership And Exclusions

### Accepted Private Publication And Retention Contract

The bounded publisher extension uses `fx_system_commit_payload_preference_deletion`
as a typed private fact family (codec version 1), with a separate
`payload_preference_deletion_count` on the existing scope commit header. The
Application row-change count and public Application feed shape keep their
existing meaning. The family is not a generic relational feed or publisher API.

Each child contains scope UUID, epoch UUID, commit sequence, contiguous family
ordinal, storage generation, exact preference artifact SHA-256, preference ID,
and the correlated deleted content table/row identity. It stores no preference
value, user reference, or arbitrary metadata. The header bounds this family to
256 children. A composite foreign key binds the child to its exact header;
another binds its content identity to the same-epoch Application revision.
The CMS participant additionally requires the correlated final disposition to
be a content deletion. Empty cleanup has no children and count zero. A net-zero
created/deleted content row may have empty cleanup, but cannot publish a
nonempty lifecycle deletion without a final content tombstone.

The CMS participant consumes the authentic, complete cleanup closure itself,
alongside the authentic document closure from the same working set. It derives
the child records after validating receipts and final content dispositions.
The existing allocation, materializer, commit header, retained result, outbox
and scope-clock publisher remain the sole transaction/ordering authority.
Every failure, interruption or uncertain decision follows the existing outer
transaction and retained-outcome recovery rules; callbacks are not replayed
after ambiguous COMMIT.

Children are retained exactly with their header under the existing retained
history floor, not under a new TTL or independent purge job. The existing
compactor verifies the header count against contiguous child ordinals, deletes
and verifies the exact family, then removes the header in the same transaction.
Corrupt or missing evidence blocks compaction. No schema installation is kept
alive by a foreign key from history: the exact artifact hash is self-contained
identity provenance. Public lifecycle subscriptions and production compaction
activation remain outside this private integration gate.

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

The [accepted audit stop conditions](./07-payload-release-and-adapter-contract.md#stop-conditions)
and repository shared-owner rule governed the accepted storage/binding decision.
Current implementation stops at the private scalar profile. Content relations,
general lifecycle operations and public/production activation remain gated.
