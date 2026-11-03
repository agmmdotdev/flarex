# Native Customer selection and Cart group reads through Core

Status **Implemented. PGlite and ordinary-role PostgreSQL verification passed.**

Flarex baseline `562199e51d49af2de7f2e89bfdeace23e87364b5`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent challenge

- Current owners trace the genuine Cart find-or-create step and the counted
  Customer group read. Issue the full four-model source with the active
  email/account and Boolean Address constraints, historical Address FK
  access, and both explicit membership foreign keys. Use the existing
  native repositories, graph population, receipts, and inverse. Retire the
  dedicated Legacy selection host and move its shared row seeds to a data
  fixture.
- Pinned `crates/common/src/query.rs`, `crates/database/src/transaction_index.rs`
  and `crates/database/src/query/index_range.rs` own the bounded prefix,
  pending overlay and consumed range. Medusa orders its email list by native
  ID and selects the first result after the list completes. Keep both
  admissible matches and the complete counted group selection. A first-row
  query would lose receipt and count evidence.
- The accepted-direction challenge separated selection and counted reads
  from Address/Account management and cross-module checkout Links. Keep the
  private selection command surface, ordinary root, existing resource bounds
  and one settlement. A competing write is checked by existing Core range,
  uniqueness and FK validation. The admitted native profile adds no automatic
  callback replay or concurrent creation guarantee.

The peer exchange identified two storage witnesses. Core preserves the pinned
Convex create-then-delete record from `crates/database/src/writes.rs` and
`committer.rs`. The genuine inverse must leave the live Customer rows and
indexes unchanged, with one new anonymous tombstone, no predecessor, and
both native events in order at the same successful settlement. An aborted
inverse must leave the complete business snapshot unchanged. This replaces
the Legacy fixture's zero-revision assertion with the exact Core contract.

Group reads preserve deleted pivot membership and exclude deleted targets.
The existing [storage-insertion ordering](../divergences/native-relational-query-plans.md)
uses Core creation time and a stable storage ID. Parallel pivot writers
could allocate and settle in different orders. The selected Customer
profiles admit no membership writer, and the bounded proof uses ordered
initialization and an actual pending fixture write. Reassess this ordering
with a connected witness before admitting independent membership writers.

## Connected acceptance

- Move the 32 native selection and six counted-read cases to the shared
  event-backed Core fixture. Check actual source provenance, full schema
  admission, both Address default constraints, and genuine FK refusal.
- Preserve omitted, null and empty branches, ID-before-email failure,
  account/guest ordering, the native empty Address call, ordered events,
  replay, and the existing call limits. Exercise one historical Address,
  excessive descendants and refusal of historical membership before writes.
- Preserve three ordered graph observations, tamper refusals, pending
  membership, rollback, and same-physical isolation across independent
  scoped instances.
- Keep the named full Cart, checkout and Address/Account Legacy assemblies
  while their connected source and command gates remain open. Full Cart also
  needs Region, Payment, full Fulfillment, Cart Promotion Link and Cart
  PaymentCollection Link.
- Run affected source and portability guards, types, lint, paired PGlite
  and ordinary-role PostgreSQL proofs, and both independent reviews.
