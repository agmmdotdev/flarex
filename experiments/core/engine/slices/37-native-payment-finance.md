# Native Payment and Order finance through Core

Status **Implemented. PGlite and ordinary-role PostgreSQL acceptance complete.**

Flarex baseline `41131dd492e3a7caba9484a6640933ef5fa949bc`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent challenge

- Current Core and callers. The genuine Payment finance facades and retained
  checkout callbacks have a three-source Legacy assembly. Reuse the existing
  Payment, generated Order and Order PaymentCollection Link issuers and the
  private event source. Move the separate one-source System Payment lifecycle
  assembly and the one-source stored Link read assembly in the same slice.
  The Legacy Payment Session and PaymentCollection fixtures have distinct
  lifecycle roots. They retain their gate, including collection setup that
  shares the Authorization and Capture facades.
- Accepted direction. Keep the exact local System provider, original graph and
  callbacks, four-entry cohorts, default 64-call refusal and named 512-call
  finance allowance. The single refund includes actual Order credit-line
  creation, confirmation and undo with nonempty versioned Item and Shipping
  rows. Native Summary presentation stays numeric and stored amount companions
  retain the exact decimal. Preserve the real empty Link branch, captured and
  refunded IDs, and the historical Session referenced by a Payment. Both local
  driver roles use fresh logical installation. Provider effects and populated
  migrations have separate admission gates.
- Pinned Convex. `crates/isolate/src/environment/udf/async_syscall.rs` lends the
  transaction to one child and restores the parent. `crates/database/src/transaction.rs`
  checkpoints pending writes and indexes while observations and consumed budget
  survive child failure. `transaction_index.rs` merges pending values and
  tombstones into examined ranges. `query/index_range.rs` records exact consumed
  ranges including EOF. `crates/model/src/session_requests/mod.rs` reads the
  exact request record and the application runner saves the outcome with the
  writes. Reuse the existing Core owners for ordered Link and relation reads,
  generated serial observations, settlement and replay.

The peers challenged a batch refund whose native step catches a later refusal,
an Order Change Action created without `ordering`, and a retained checkout
inverse. A caught refusal keeps the root rollback-only. The generated Order
source uses the existing max-plus-one owner for the omitted Action field and
retains native Order version calculation. A retained inverse uses a later
explicit root and the actual retained callback input. It preserves the referenced
Session while recreating the replacement and accounting for the exact refund.

Use the existing [native root participation](../divergences/native-root-participation.md),
[ordinary index observations](../divergences/native-ordinary-index-observations.md),
[generated serial semantics](../divergences/native-generated-serials.md),
[relational row values](../divergences/native-relational-row-values.md) and
[outcome recovery](../divergences/native-protected-outcome-recovery.md).
The static challenge establishes no new persistence mechanism difference.

## Ownership and acceptance

- Medusa owns exact installed slot-to-source pairing. Reuse the checkout
  selector matcher for native Payment, Order and Link participants before
  host preparation. Core continues to authenticate active definition, scope
  and configuration digests. Single and batch Refund require Core bindings.
  Preserve the Legacy branch of the shared
  Authorization and Capture facades for the named Session and Collection
  lifecycle callers. Retire the three selected Legacy fixture assemblies.
- Move the 31 existing cases across linked finance, single refund, System
  lifecycle, retained checkout Payment steps and direct Link read. Preserve
  the authentic four-of-four Link, four-of-five refusal, historical row filter
  and coherent smaller host budget. Seed the fifth stored Capture through the
  Core installation owner and verify refusal before provider execution.
- Observe actual Core business revisions, indexes, events and terminal request
  records. Verify one settlement for the linked Payment and Order changes,
  callback-free same-key replay, lost acknowledgement recovery, rollback after
  a native caught refusal and authentic selector mismatch before the host.
  Preserve retained inverse success and failed late writes. Compare the same
  explicit amounts, generated Action order and Summary versions in both drivers.
- Verify executing native source provenance and scoped types, lint, both
  reviews and portability. Run PGlite and ordinary-role PostgreSQL separately.

The selected finance, retained Payment and stored Link cases passed on both
drivers. The three Legacy assemblies are retired. Payment Session and
collection lifecycle remain separate cutovers, with their shared
Authorization and Capture calls verified on PGlite.
