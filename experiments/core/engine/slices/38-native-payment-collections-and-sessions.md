# Native Payment collections and Sessions through Core

Status **Translated. Paired acceptance complete for the selected workflows.**

Flarex baseline `44392ad585ec615fd7bce0abe2d541ce76be2d5a`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent challenge

- Current Core and consumers. Move the remaining Payment Session,
  PaymentCollection, and Customer AccountHolder and Address assemblies.
  Their one-, five-, and three-source profiles reuse the issued Payment, Cart,
  generated Order, Customer and three exact Link definitions. Reuse private
  event storage and native initialization. The collection fixture carries
  the genuine stored parent, callback-invoked child, and authorization/capture
  callers. The Customer Account fixture also owns the genuine Address roots
  and their retained restoration witnesses. The three Legacy assemblies have
  eight direct consumer suites.
- Accepted direction. Keep System-only provider admission, exact raw amounts,
  original native callbacks and conditional compensation markers, four-entry
  cohorts, existing per-root budgets and one outer PostgreSQL settlement. An
  authorized historical Session remains referenced by Payment. A cancelled
  collection skips captured Payments and changes status only if the root
  succeeds. Customer Account Link and Address restoration keep their existing
  read, event and failure boundaries. Fresh fixture installation has no
  populated conversion or public activation requirement.
- Pinned Convex. `phase.rs` and `async_syscall.rs` lend and return one
  transaction for a nested invocation. `transaction.rs` checkpoints writes
  and indexes while read dependencies and spent budget survive. Exact indexed
  absence and pending-row overlay are owned by `query/index_range.rs` and
  `transaction_index.rs`. The committer validates published and pending
  conflicts. `crates/model/src/session_requests/mod.rs` and the application
  runner look up the scoped request before the body and settle a successful
  outcome with the writes. The selected stored SDK declaration uses the
  existing atomic root outcome. Its children borrow the root, including a
  callback-invoked child whose refusal is caught by the native caller.

The peers exchanged counterexamples for same-Cart creation, a five-Session
cohort, and detached callback work. Preserve the existing Core race witness
where both attempts stage and one conflicts on the exact observed Link.
Replace Legacy-specific SQL waiting expectations with that existing Core
contract. Preserve the genuine no-provider overflow witness, captured Payment
protection and each callback's rollback and drain. One stored root produces
one outcome. Retained inverse callbacks use their later keyed roots.

Reuse [native root participation](../divergences/native-root-participation.md),
[ordinary index observations](../divergences/native-ordinary-index-observations.md),
[native workflow diagnostics](../divergences/native-workflow-diagnostics.md),
[recorded row restoration](../divergences/native-recorded-row-restoration.md)
and [protected outcome recovery](../divergences/native-protected-outcome-recovery.md).
The static challenge establishes no new physical or transaction mechanism.

## Ownership and acceptance

- Reuse existing Core bindings and verify each native facade's expected
  selector and semantic source key before host preparation. Keep the already
  issued Cart Link slot `link` and bind the Order Link's canonical
  `order_payment_collection_links` source to its collection workflow role.
  Retire the Legacy Payment bindings once the named callers move. Keep
  remaining unrelated Legacy consumers with their existing owners.
- Migrate the 59 existing Session, collection, reliability, stored parent,
  callback child, Customer Account and Address cases. Reuse the paired
  Native34 Cart race behavior and complete relevant linked checkout/finance
  regressions for changed shared facades. Prove exact scope isolation even
  with identical native IDs and request keys, replay without callbacks and
  one published outcome/event set. Assert terminal failed attempts separately
  from unchanged durable business rows, history, indexes and events.
- Run executing source provenance, scoped typechecks, lint, compatibility
  guards and both reviews. Prove the selected runtime separately on PGlite
  and ordinary-role PostgreSQL. Retire the three displaced fixtures and their
  checkout-only Link schema compilation entry points when callers allow.

The three Legacy fixture assemblies and two unused Link compiler exports are
retired. The migrated facades accept ordinary native bindings with the exact
issued selector and source identity. Stored roots and callback children use
the existing Core owner, with the same scope, replay and settlement rules as
the other native Payment and Customer workflows.
