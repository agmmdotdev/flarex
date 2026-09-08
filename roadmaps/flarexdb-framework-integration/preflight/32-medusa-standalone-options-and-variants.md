# Standalone Product Options And Variants

## Next Bounded Slice

Preflight prepared on 2026-09-08 after the keyed-update implementation in
[record 31](./31-medusa-keyed-updates-and-remaining-product-tests.md).
This is a proposal; it grants no additional command or repository admission.

The next useful slice is standalone option and variant creation through the
unchanged Product service. Both use already-installed tables and the shared
relational insert kernel. This proves existing-row association through another
real service path before the larger category/replacement/lifecycle work.

Two exact original cases from
[`events.spec.ts`](../../../packages/medusa-product/integration-tests/__tests__/product-module-service/events.spec.ts)
have prefix `Product injected event bus > ProductModuleService Events > `:

| Exact suffix | Expected events |
| --- | --- |
| `Product Variant Operations > should emit PRODUCT_VARIANT_CREATED event only when creating standalone variant` | One newly inserted variant; existing option values emit nothing |
| `Product Option Operations > should emit PRODUCT_OPTION_CREATED event on createProductOptions` | One new option and three new option values |

This would raise the two-file inventory from 15 to **17 admitted**, leaving
**39 blocked and one upstream skip**. It does not claim coverage of other
Product test files or general module parity.

## Pinned Service Evidence

At fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`,
[`createVariants_`](../../../packages/medusa-product/src/services/product-module-service.ts#L439)
requires each `product_id`, then lists options with `values` and existing
variants with `options` for the complete set of Product IDs. Its own
`assignOptionsToVariants` resolves title/value selections to existing value IDs;
`checkIfVariantWithOptionsAlreadyExists` rejects an existing combination. It
then calls the internal variant service's `create`. Preserve those methods and
their errors. The current adapter refuses these internal option/variant DALs.

[`createOptions_`](../../../packages/medusa-product/src/services/product-module-service.ts#L946)
requires each `product_id` and normalizes string values into `{ value }` rows
before calling the internal option service's `create`. The repository must
persist that normalized graph, not independently reproduce service validation.

The original beforeEach creates an existing Product graph. The variant case
adds the unused `large`/`green` combination; it must insert the variant and its
two declared variant/value pivot rows while retaining all existing values. The
option case inserts a new option with three values. Exact event cardinality is
therefore evidence of which rows were actually created, not merely a successful
foreign-key insert.

## Implementation Owners

1. **Adapter query profile:** admit table-bound option and variant reads with
   bounded `product_id` sets and exactly `values`/`options` population. Reuse the
   DML-derived relation descriptors and complete bounded read helper. Internal
   reads must not inherit the ordinary 15-row page or silently omit an existing
   variant used by the service's duplicate-combination check.
2. **Adapter graph capture:** extend the existing graph machinery to these
   selected roots. Derive IDs, prefixes, columns, parent foreign keys and pivot
   columns from imported models/checked DML. Preserve the distinction between a
   new option-value row and a reference to an existing option-value ID. Do not
   reinsert referenced values or duplicate the shared SQL kernel.
3. **Repository composition:** enable only option/variant create and the required
   reads, borrowing the same request manager and subscriber. Return the service's
   expected populated projection. Preserve immutable existing associations and
   fail a late FK/unique error atomically with the complete graph.
4. **Events and core:** reuse current created-mutation dispatch, authenticated
   primary/pair facts and local commit buffer. No new core table, operation mode,
   business outbox payload or durable event provider is expected. A discovered
   shared-owner defect still requires its own diagnostic preflight under
   `AGENTS.md`; this proposal does not authorize an incidental owner correction.
5. **Harness and provenance:** add only `createProductOptions` and
   `createProductVariants`, two commands and two exact original identities.
   Preserve upstream bytes, refresh reviewed promotion hashes, and update the
   inventory only after the original assertions pass.

## Acceptance And Remaining Gates

Run the two new originals plus the existing 15 on PGlite and ordinary-role
PostgreSQL with one installation per driver. Focused conformance must prove:

- existing options/values retain identity and stored values, with only the new
  variant and its pivots recorded; exact one/four created-event counts;
- missing Product/option/value and wrong-scope references roll back every new
  row, fact, receipt and wake; no transaction manager escapes;
- complete lookup beyond 15 options or variants, including duplicate-combination
  detection at the end of the bounded set;
- preserved service normalization, single/array results, retained-result replay,
  cancellation and late failure; unchanged graph/catalog/statement budgets.

Finish strict adapter/compatibility checks, source/browser guards, scoped lint,
both required reviewers and the exact staged gate. Reuse the passing shared
transaction proofs; broaden database suites only if shared implementation
changes or new evidence requires it.

Product/category creation and tree semantics still precede the entire original
Product update block. Relationship replacement, category hierarchy, lifecycle
cascades, variant images and the 1000-image case remain separate capabilities
described in [record 31](./31-medusa-keyed-updates-and-remaining-product-tests.md).
General Payload compatibility, mutable Module Links, query sync and production
serving remain outside this slice.
