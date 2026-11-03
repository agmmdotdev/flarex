# Native Cart PaymentCollection creation and refresh through Core

Status **Implemented. PGlite and ordinary-role PostgreSQL acceptance complete.**

Flarex baseline `24d6255f686d7786c4153e31fa2b0ad18fd6c7c4`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent challenge

- Current Core and consumer trace. Fresh native Cart creation calls refresh
  with no collection and observes no Payment writes. A persisted association
  reaches the native Cart total, collection and active Session graph. Refresh
  compares exact amounts and currency, deletes selected Sessions and updates the
  collection. The genuine create workflow computes the amount from the same
  Cart raw total and attaches the generated collection through native Link.
  The narrower refresh-only slice could seed that association. The peer
  challenge selected both roots to verify the real Link writer, its inverse,
  duplicate refusal and atomic settlement with collection creation.
- Pinned Convex trace. `query/index_range.rs` records the consumed interval and
  exhausts it at EOF. `transaction_index.rs` overlays pending inserts and
  tombstones over the snapshot. `writes.rs` preserves the first original and
  final update. `committer.rs` checks both published and accepted conflicts.
  Reuse Core's existing index, pending, original and commit owners. An empty
  active Session range still depends on matching inserts. No retry policy is
  added. Native replay and fencing stay with the existing workflow owner.
- Accepted native direction. Mount the complete nine-table Payment source,
  the genuine Cart PaymentCollection Link and the existing complete Cart on
  one Core binding. Expose only the existing named profiles. Preserve nullable
  AccountHolder email outside its required provider/external identity key,
  the Payment Provider pivot, and the mandatory Payment-to-Session reference
  with no delete cascade. Native Link supplies its existing graph and receipt
  authority without endpoint FKs. [Native exact and raw values](../divergences/native-relational-row-values.md)
  retain their established representation. The selected System provider has
  local deterministic deletion behavior. PostgreSQL settles business changes,
  events and the workflow outcome atomically.

## Connected failure witness

The PGlite refresh test injects one failure at the genuine local System
provider's Session deletion. The native root returns a failure and the test
observes a later unhandled `CommerceTransactionError` with reason `closed`.
The source already awaits the Session deletion chain. Its catch calls native
`Logger.error`, whose synchronous ABI the composed resource binder wrapped in
a Promise. The failure fenced the Promise runner before the admitted callback
finished its catch. The Medusa resource owner now invokes the synchronous
diagnostic within the existing callback drain. The same regression observes
one diagnostic, the original provider defect and unchanged committed state.
See [native workflow diagnostics](../divergences/native-workflow-diagnostics.md).

## Connected acceptance

- Run the genuine collection create and refresh roots. Attach the real Link,
  create a pending System Session through its existing bounded native root,
  and verify changed total, currency-only, equal amount, unlinked and
  completed/missing create behavior. Observe exact update/deletion receipts,
  active indexes and callback-free same-key replay. Verify same-scope duplicate
  creation and one successful settlement in the concurrent case.
- Verify late rollback, retained collection and Link inverses, exact amount
  restoration beyond binary64's integer boundary, and the existing Cart
  adjustment read constraint. A failed Session deletion, including the
  mandatory Payment reference case, must preserve original Session, Payment,
  collection and publication state. Verify logical isolation for the issued
  bindings and failure before callback for incompatible authority.
- Run executing source/schema provenance, PGlite and ordinary-role PostgreSQL,
  affected native guards, scoped types and lint, and both reviews. Record any
  actual mechanism correction at its owner before changing it.
- Retain the distinct Legacy Order, provider authorization/capture, stored
  parent, callback child, broader payment reliability and checkout consumers
  until their own connected Core gates. Full Cart still requires complete
  Fulfillment and Cart Promotion Link in the same root. Network providers and
  public activation stay outside this bounded private profile.

Paired verification passed. The duplicate standalone Legacy Cart tests and
their displaced fixture operations are retired. The retained Collection,
Session, stored parent, callback child and reliability fixtures passed on
PGlite.
