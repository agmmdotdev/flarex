# Native Cart context reads through Core

Status **Implemented. PGlite and ordinary-role PostgreSQL verification passed.**

Flarex baseline `19974eabc64f50d81aff05bc54f385a5dd5608b7`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent challenge

- The current-owner trace follows the genuine Cart context workflow through
  Store defaults, counted Region graph and Sales Channel retrieval and
  validation. Move all three participants to one Core host. Reuse the existing
  Store and Sales Channel sources. Issue the complete two-model Region source
  with the `iso_2` Country key, nullable Region foreign key, and active
  `(region_id, iso_2)` uniqueness. Retire the dedicated Legacy context fixture.
- Pinned `query_impl.ts` implements first as take one. The limit and index
  range in `crates/database/src/query/limit.rs` and `index_range.rs` stop
  without a lookahead and only record exhaustion at EOF. Medusa selects its
  first Region after a counted read. Reuse the complete Core index range and
  pending overlay. Two matching Regions and a one-row window must yield count
  two while populating Countries only for the selected Region.
- The accepted-direction trace preserves distinct native empty, null,
  missing, deleted and omitted selectors. A genuine explicit miss omits the
  Region result. A null or empty Store default reaches the counted query
  and produces native null. The existing
  [Cart context contract](../../../../roadmaps/flarexdb-framework-integration/preflight/160-native-cart-creation-workflow.md)
  owns active Country selection and `iso_2` order. Keep native graph-only
  Region access and authenticated optional Caching absence.

The peer exchange selected ordinary Core roots and existing receipt
validation. Successful reads settle a result-only outcome. Verify no
business writes or events and callback-free same-key replay. A caught
forbidden Region write must still fail the root and publish no success.
Keep the named Legacy full Cart, checkout and Shipping Option Region
consumers until their connected cutovers.

## Connected acceptance

- Move the eleven existing context cases. Preserve default and explicit
  branches, optional absence, typed refusal and independent scoped instances
  with the same endpoint IDs on one physical fixture.
- Prove the real counted Region window and complete observed root cohort,
  with exact read receipts. The selected Region's Country range can observe
  deleted rows. Only its active Countries contribute to the receipt count
  and result.
- Authenticate executing sources and the complete native Region schema.
  Run the affected contracts, paired PGlite and ordinary-role PostgreSQL,
  scoped types, lint, source and portability guards, and both reviews.
- Full Cart still needs Payment, full Fulfillment, Cart Promotion Link and
  Cart PaymentCollection Link after this cutover.
