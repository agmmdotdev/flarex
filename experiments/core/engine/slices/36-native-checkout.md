# Full native checkout through Core

Status **Implemented. PGlite and ordinary-role PostgreSQL acceptance complete.**

Flarex baseline `7cadd9859f10e5499143d15afb39cac57daac202`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent challenge

- Current Core and consumers. The genuine checkout root has an eighteen-source
  ordinary profile and a nineteen-source Customer profile. Fifteen exact
  sources already have Core issuers. Use the shared twelve-model fresh Cart,
  generated Order, and complete Fulfillment definitions. Issue the exact
  one-table Order Cart, Order PaymentCollection, Cart Promotion and Customer
  AccountHolder Links from the executing metadata. The three-table Cart
  Promotion preimage profile has a distinct contract. Keep the root's existing
  methods, graph admission, 512-call budget, scope exclusion, queued operation
  scheduling and Customer resource digest. Both checkout profiles already fit
  the Core native host's participant limits.
- Pinned Convex. `crates/database/src/transaction_index.rs` merges pending keys
  and tombstones only in the fetched interval. `query/index_range.rs` records
  examined intervals, including the exact miss at EOF. This covers the first
  Order Cart lookup and later pending Link reads. `transaction.rs` restores
  pending writes and indexes on child rollback. `committer.rs` checks published
  and accepted-pending conflicts before durable save. `crates/model/src/session_requests/mod.rs`
  reads the exact outcome key before the application runner replays or runs
  the body and stores a fresh result in the same transaction. Reuse the Core
  index, pending write, settlement and recovery owners for checkout.
- Accepted direction. Keep genuine Capture and Refund accounting, Customer
  account context and Inventory demands with the Order, Cart and Link writes
  and critical pending-cancellation `order.placed` event. Prepare existing
  Payment history through real separately settled capture and refund roots.
  The checkout compensator is marked transaction-covered. A failed checkout
  rolls back as one root. The dedicated tests of genuine retained Customer
  Payment and Inventory inverses still invoke their callbacks in later keyed
  roots. Standalone Order and Payment finance are separate consumers.

The agents exchanged counterexamples about existing Refund history, the
twelve-model Cart definition and same-Cart contention. On one Core generation
the scope grant is acquired before the snapshot. Two distinct keys completing
the same Cart must converge to one Order and one placed event. The old SQL
lock-timeout classifier describes the Legacy session. Test the Core contract
directly and record an actual witness if the Core owner fails.

This reuses [native root participation](../divergences/native-root-participation.md),
[ordinary index observations](../divergences/native-ordinary-index-observations.md),
[scope exclusion](../divergences/native-scope-exclusion.md),
[relational value semantics](../divergences/native-relational-row-values.md)
and [foreign-key enforcement](../divergences/native-relational-foreign-keys.md).
The static challenge establishes no new mechanism divergence.

## Checkout source admission

The PGlite witness swapped the two authentic Order Link selectors while
retaining their genuine modules. Each selector passed the installed definition
check and the root reached a wrong-table failure inside the Link callback.
The independent follow-up assigned the missing module-to-source pairing to the
checkout graph. Convex resolves component references and validates function
metadata against the same binding it invokes in `crates/model/src/components/mod.rs`,
`crates/udf/src/validation.rs` and `crates/isolate/src/environment/udf/async_syscall.rs`.

The checkout graph now requires an issued selector for each exact role and
semantic source key before host preparation. Its Inventory source slot remains
`inventory` and its execution participant remains `inventory_commands`. Core
continues to authenticate the installed definition, scope and digests. The
paired regression exercises both authentic swapped selectors and a wrong
definition issued under the correct slot, with no host preparation or durable
change. This is a Medusa profile precondition.

## Root scope proof scheduling

The connected Inventory PGlite witness reached the genuine parallel checkout
branch. Its locking resource checked the root's live scope grant directly
while a queued participant held the borrowed manager. The lifetime correctly
rejected that direct access as `overlappingOperation`. The ordinary,
Customer, Address and retained Inventory inverse cases passed.

Convex awaits each syscall batch in `crates/isolate/src/environment/udf/mod.rs`.
`phase.rs` lends the transaction to a child and restores it before the next
call uses it. The independent follow-up found the native root's grant proof
was missing from the existing FIFO that already schedules root calls. Run its
manager checkpoint and grant authentication together in that queue. Borrowed
proofs stay with the active child. The native locking callback runs after the
proof returns and can submit its own calls. The existing grant, deadline, queue
cap and failure ownership apply. The proof does not take another grant or
charge a database operation. This restores the recorded scope exclusion and
root participation contracts.

## Ownership and acceptance

- The Medusa adapter owns the four Link definitions and the native checkout
  graph and commands. The checkout fixture assembles real sources,
  initialization, workflow hosts and event storage through the existing Core
  owners. Retire the displaced Legacy fixture and its synthetic source
  assembly. Keep shared module runtime construction and the Legacy Link
  compilers still used by separate AccountHolder and finance consumers.
- Move all four checkout suites covering the genuine complete root, Customer
  context, address copying, and Inventory. Preserve exact decimal accounting,
  partial and full Refund history, native callback failures after writes,
  retained inverse semantics, same-Cart convergence, competing last-stock
  attempts and exact cohort refusal. Preserve the Customer Session's ordinary
  and digested identity checks. Run the paired drivers with existing bounds.
- Observe actual Core business revisions, indexes, events and committed
  outcomes. Verify a shared settlement timestamp, callback-free same-key
  replay, lost acknowledgement recovery and refusal of mismatched source
  authority before execution. Distinguish a terminal failed request record
  from publication of business changes when comparing rollback snapshots.
- Prove source provenance and retain each genuine checkout index requirement,
  including the Customer Link. The fresh Cart source also carries its three
  creation records. Rerun the existing Core Order and exact-price checkout
  gates and the adjacent retained Payment probes. Run scoped types, lint,
  compatibility guards and both reviews before the checkpoint.

Both checkout profiles and the native scope-exclusion regressions passed on
both drivers. The Legacy full-checkout assembly is retired. The standalone
Finance roots retain their separate cutover gate.
