# Native entity-batch validation and reference checkpoints

Status: **Bounded shared extension implemented with paired neutral and complete
admitted Tax workflow proof; arbitrary ORM flush remains unsupported.**
Owner: [ordinary native workflows and Tax](../slices/17-native-atomic-workflows-and-tax.md).

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` validates document
operations and shares nested pending writes, then produces a final transaction
for OCC and accepted-prefix validation. Ordinary table-typed IDs do not assert
native foreign-key existence and provide no ORM flush checkpoint.

The admitted Tax Region native service stages complete entity groups and flushes
references before its afterCreate/event boundary. Existing witnesses also require
whole-group required/CHECK validation before specified earlier identity/unique
errors. Moving these failures solely to final acceptance would change native
callbacks, error presentation and event order.

Extend the existing shared mutation/FK owners with those bounded phases. A
checkpoint receives only authentic source-confined capabilities, reads the actual
current pending state, records exact target/dependency evidence and returns
authentic origin/child/target failure evidence through the Commerce failure owner.
Tax presents that evidence; it must not recheck constraints or mint authority.
Do not finalize, publish, widen capabilities, erase sticky failure, refund consumed
work or create an intermediate SQL transaction/lifetime. Normal final integrity
and accepted-prefix checks still run after a successful checkpoint.

Prove foreign source/table refusal, pending parent/child visibility, group error
order, callback suppression, unchanged native presentation, rollback and mixed
Cause behavior. A target changed after checkpoint must conflict or fail final
integrity without replaying native effects. Use neutral owners plus the complete
Tax Region/native retained inverse consumer on both database lanes. This record
does not add resumable transactions or admit arbitrary ORM flush semantics.

The [Core transaction owner](../../../../packages/persistence-postgres/src/core/transaction.ts)
implements entity-batch phases and source-confined `checkpointReferences` over
its actual pending writes and dependencies. The
[native Store](../../../../packages/persistence-postgres/src/frameworks/commerceTransaction/nativeStore.ts)
exposes only the authenticated invocation's selected checkpoint capability;
the shared failure owner preserves authentic evidence for Tax presentation.

The [Rule Batch continuation](../slices/42-native-shipping-option-rule-batch.md)
requires a checkpoint at each selected native statement. Pinned Medusa refuses
an invalid Option reference before advancing to the next Rule, including when a
later branch deletes that Rule. The existing Core checkpoint owns the indexed
target read and authenticated failure evidence. A trusted Rule participant
selects statement checkpoints for ordinary writes. The Tax Region profile
continues to select the whole-table checkpoint at its entity-batch boundary.
