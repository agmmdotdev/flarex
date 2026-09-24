# Core relational fan-out transition

Status: accepted design correction; implementation pending under the standing
shared-storage goal. The selected ProductType delete remains safely bounded.

## Trigger and ownership

Native ProductType deletion detaches each Product with the deleted `type_id`
before removing the Type. On the selected logical source,
`product-lifecycle.ts` reads one capped referencing page, while the shared
logical participant retains at most 128 observed identities per command.
The reverse index correctly avoids unrelated Products, but a Type referenced
by 128 Products already exceeds the working-set identity budget once its Type
row is included. `limitExceeded` rolls back the command. This is a correctness
boundary, not general native deletion parity. The same structural limit can
affect Collection detachment, Product graph cascades and future cross-framework
relationships; fixing only the Type adapter would retain the wrong owner.

The accepted [fan-out contract](../../design-notes/flarexdb-shared-logical-storage.md#bounded-high-fan-out-relationship-transitions)
places complete reverse selection and atomic maintenance in shared relation and
transaction ownership. The Medusa service still decides to delete a Type and
which native events to emit. Core decides how a declared nullable reference is
changed and settles all derived storage and recovery evidence.

## Challenged alternatives and recommended direction

- Raising `identities` from 128 to a larger constant postpones the same failure
  and scales heap, facts and lock time with fan-out. It is useful only as a
  measured resource setting, not the relationship design.
- Paging in `product-lifecycle.ts` under the current working set still hits its
  total identity bound. Committing pages separately exposes partial detach and
  changes the native transaction contract.
- A generic SQL `UPDATE` on opaque stored documents skips revision history,
  index/unique maintenance, facts and settlement recovery.

Design a core-owned relational transition operation compiled from authenticated
logical FK metadata. It selects a complete, scope-confined reverse key range
with stable keyset progress; applies bounded batches within one trusted
transaction; records the same row/index/unique/history/fact effects as ordinary
logical writes; and validates membership against concurrent reference changes
before one commit/publication. Keep a separate total affected-row/time/byte
budget. If that budget is exceeded, roll back the entire operation with a
capacity error. Do not promise an unbounded single transaction.

The current `LogicalDocumentChanges` arrays and per-request `rows`/`dependencies`
maps assume every changed identity fits in memory. The implementation preflight
must choose a bounded transaction-local accumulation or staging representation
that preserves their validation, retry and recovery semantics; changing only
the read limit is insufficient. The trusted owner must not hold a transaction
while calling untrusted code, pausing a workflow or performing remote effects.
Cross-owner changes require an explicit source-owner policy, so the first
implementation witness is a module-local nullable reference.

## Coherent implementation and acceptance gate

1. Inventory the logical row, index, unique, revision, attempt, dependency,
   publication and recovery writers that consume a closed working set. Define
   the replacement contribution contract and an explicit total-work budget.
2. Implement and test a neutral declared `set null` transition with indexed
   reverse selection, complete membership, rollback and concurrent insert or
   delete conflict. Keep one outer settlement authority.
3. Move the native Type delete onto that operation and remove its adapter-side
   referencing-row enumeration. Exercise more than 128 Products referencing
   one Type, including exact null detach, row/index/history/fact consistency,
   event/outcome replay, two-shop isolation and injected late failure on
   PGlite and ordinary-role PostgreSQL. Repeat with concurrent reference
   insertion on PostgreSQL.
4. Apply the same owner to other declared module-local transitions when their
   existing consumers move. Remove displaced lifecycle loops and any obsolete
   resource assumptions in the same connected implementation slices.

This preflight changes private core contribution and adapter DAL contracts as
needed. It does not change public Medusa APIs or authorize a data reset. A
high-fan-out refusal remains explicit until the new native witness passes; a
performance claim requires bounded multi-shop and hot-tenant measurements.
