# Module Integration Test Runner

This record tracks fork-specific work needed to keep the existing
`integration-tests-modules` package runner in use while validating the
Cloudflare HTTP runtime path. Do not replace the original module integration
assertions with a fork-only test suite.

## Existing Runner Boundary

The module integration lane already owns its package script:

```bash
yarn workspace integration-tests-modules test:integration
```

Cloudflare HTTP runtime validation is selected the same way as the HTTP lane:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=<spec> --runInBand
```

The Jest runner remains Node-based. The selector changes the HTTP runtime used
by `@medusajs/test-utils`; it does not change database setup, migrations, test
fixtures, or assertions.

## Currency Admin Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Currency Admin integration file now passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The first run failed before assertions because
  `integration-tests/modules/medusa-config.ts` imports the existing system Tax
  and Payment providers through package subpaths:
  `@medusajs/tax/dist/providers/system` and
  `@medusajs/payment/dist/providers/system`.
- The files existed under `dist`, but the package `exports` maps blocked those
  subpaths.
- After exposing those exact provider subpaths, the test reached the real
  Currency assertions and failed because the Cloudflare proof Currency rows
  leaked a synthetic `filter` field into API payloads. That field was only a
  proof-test artifact, not a Medusa Currency API contract.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Tax and Payment package manifests now export the existing system provider
  deep paths that the unchanged module test config already imports.
- The Cloudflare proof Currency row shape no longer includes the synthetic
  `filter` field, so list and retrieve responses can compare equal like the
  original Medusa assertions expect.

Affected boundary:

- Existing module-lane integration validation through
  `integration-tests-modules`.
- Cloudflare proof Currency response shape.
- Tax and Payment package export compatibility for existing integration
  fixture imports.

Validation:

- The original module-lane Currency Admin file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=currency/admin/currency.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

- Package subpath resolution was verified for:

```bash
node -e "console.log(require.resolve('@medusajs/tax/dist/providers/system')); console.log(require.resolve('@medusajs/payment/dist/providers/system'))"
```

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare typecheck
```

Current blocker:

- `yarn workspace medusa-cloudflare test` currently fails before executing
  `src/worker.spec.ts` due to Vite/Rolldown dependency optimization:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
- Removing the app-local `apps/medusa-cloudflare/node_modules/.vite` cache did
  not change that failure.
- This blocker is recorded separately from the module Currency result because
  the module integration command and production/import/type gates passed.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing
  package script, selecting narrow original specs one at a time.
- Investigate the app-local Vitest optimizer failure before treating
  `medusa-cloudflare test` as a reliable gate again.

## Currency Store Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Currency Store integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice. The previous Currency response-shape
  fix also satisfies the Store list/retrieve equality assertion.

Affected boundary:

- Existing module-lane Store Currency integration validation through
  `integration-tests-modules`.

Validation:

- The original module-lane Currency Store file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=currency/store/currency.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing
  package script, selecting the next narrow original spec.

## Auth Email Password Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Auth email/password provider integration file now
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- The first run reached the real Auth assertions.
- The incorrect-password assertion already returned the expected `401`.
- The successful-login assertion failed because the module test creates the
  auth identity directly through the real Auth module with a `scrypt-kdf`
  password hash in provider metadata. The Cloudflare proof auth service only
  compared plaintext passwords, which was enough for route-created proof users
  but not for direct module-created identities.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof auth service now verifies the existing `scrypt-kdf`
  96-byte stored password format using Worker-safe `@noble/hashes` scrypt,
  HMAC-SHA256, and SHA-256 primitives.
- The proof auth service still accepts plaintext passwords for identities
  created through existing proof register routes.
- Node's `scrypt-kdf` package was not imported into the Worker graph.

Affected boundary:

- Existing module-lane Auth email/password provider validation through
  `integration-tests-modules`.
- Cloudflare proof Auth identity synchronization for provider metadata created
  directly through module services.

Validation:

- The original module-lane Auth email/password provider file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=auth/admin/email-password-provider.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing, 1 test skipped by the unchanged
upstream file.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare build
```

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The composed Worker import guard passed with 1375 bundled inputs after adding
  the portable verifier.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Draft Order Admin Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Draft Order admin integration file now passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The first runs reached the original Draft Order assertions but Worker proof
  draft-order create responses were missing request-backed items, shipping
  methods, billing address, draft status/version, and item detail/raw amount
  fields.
- Variant-priced draft items resolved to `0` because direct
  `pricingModule.createPriceSets` calls and ProductVariantPriceSet remote links
  were not mirrored into Worker proof state in a shape usable by draft-order
  pricing.
- Product-type tax assertions failed because direct
  `taxModule.createTaxRateRules` calls were not mirrored after the tax rate was
  created.
- Edit-flow percentage promotions initially applied as fixed discounts, then
  applied independently rather than in the same sequential order expected by
  Medusa's draft-order edit preview.
- Canceling an edit needed a small proof-state snapshot so a newly added edit
  promotion could be discarded while the previously confirmed promotion stayed
  on the draft order.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now syncs direct Pricing price-set
  rows, normalized ProductVariantPriceSet links, and direct Tax rate rules into
  Worker proof state.
- Worker proof Draft Order routes now create request-backed draft order items,
  shipping methods, billing address, status/version, raw amount/detail fields,
  product-type tax-line overrides, variant-price resolution, and edit
  promotion/cancel behavior needed by the original assertions.
- Percentage draft-order item promotions now apply sequentially, with newly
  added edit promotions evaluated before already confirmed promotions.

Affected boundary:

- Existing module-lane Draft Order admin validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Pricing, Remote Link, and Tax module
  service calls made directly from original module tests.
- Worker proof Draft Order create, edit, promotion, confirm, cancel, retrieve,
  item total, tax-line, and adjustment response shape.

Validation:

- The original module-lane Draft Order admin file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/draft-order.spec.ts --runInBand
```

Result: 1 suite passing, 5 tests passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_draft_order_cloudflare_full_final`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Order Create Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Order create workflow assertion now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The focused create-order assertion first failed because an Admin-created
  Worker customer was not mirrored into the Node Customer module state before
  the original `createOrderWorkflow` assertion executed.
- After customer mirroring, the follow-up Admin order retrieve failed because
  Worker-bridged orders exposed only partial aggregate totals.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now mirrors Admin-created customers
  into the Node Customer module before workflow assertions depend on them.
- The Worker proof Admin order response now derives the same top-level aggregate
  total fields for bridged orders that Medusa expects on order retrieve.
- `createOrderWorkflow` refreshes the full set of Order total scalar fields when
  querying the fresh order after creation, matching the existing Order module
  total-selection contract.

Affected boundary:

- Existing module-lane Order validation through `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Admin customer creation.
- Worker proof order retrieve shape for bridged orders.
- Order workflow fresh-order field selection.

Validation:

- The original focused Order create workflow assertion passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/order.spec.ts --runInBand -t "should create an order with items quantity"
```

Result: 1 suite passing, 1 test passing, 2 tests skipped by focus.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/core-flows build
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- The next focused Order Admin retrieve assertion reaches the exact original
  response-shape comparison but still fails. Remaining gaps are nested/raw
  order totals, discount decoration, and exact payment collection/list-response
  semantics in the Worker proof order resource.
- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_order_create_cloudflare_aggregates`.

Next step:

- Continue the Order spec with the focused `should get an order` assertion,
  using the existing package script and preserving the exact original assertion.

## Order Spec Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Order spec now passes through the Cloudflare HTTP
runtime using the existing `integration-tests-modules` `test:integration`
script.

Failed-first result:

- After the create workflow assertion passed, the Admin retrieve assertion
  failed because the Worker proof response returned raw create rows rather than
  the real decorated Order DTO shape and ignored the Medusa `fields` projection
  used by the test.
- After retrieve passed, the delete assertion failed because the Worker Admin
  order list endpoint only considered the static completed-cart order and did
  not remove Node-created bridged orders after `orderModule.deleteOrders`.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- Direct Node `orderModule.createOrders` calls in Cloudflare-mode tests now
  sync the Worker proof state with a real `orderModule.retrieveOrder` DTO, so
  Admin retrieve assertions see Medusa-decorated totals, raw totals, nested
  item totals, shipping totals, and credit-line totals.
- The Worker proof Admin order retrieve route now applies a small Medusa-style
  projection when `fields` is present and derives `payment_status` from payment
  collections.
- Direct Node `orderModule.deleteOrders` calls now notify the Worker proof state
  to remove bridged orders, and the Worker Admin order list route includes
  remaining bridged orders in list responses.

Affected boundary:

- Existing module-lane Order validation through `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Node-created and Node-deleted orders.
- Worker proof Admin order retrieve projection and Admin order list state.

Validation:

- The original Order spec passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/order.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_order_cloudflare_delete_sync`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Cart Completion Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Cart completion integration file now passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The event-compensation case initially reached the original assertion but
  captured only 13 grouped events instead of 17. The Cloudflare bridge had
  bypassed proof-only Payment module mutations without emitting the same
  grouped `payment.*` events as the real service path.
- The full Cart completion file then reached 6/7 passing tests. The remaining
  inventory-reservation case failed because the Worker proof completion had
  already created the reservation and the Node module bridge replayed the same
  reservation into the proof state, double-consuming one unit of stock.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- Cart completion item field selection now keeps the explicit item scalar
  fields needed by unchanged order creation assertions instead of relying on
  `items.*` collapsing through totals field selection.
- The internal service persistence adapter lookup now uses the registered
  container key directly, preserving mutation event aggregation under the
  adapter-driven loader path.
- The Cloudflare HTTP test-state bridge now forwards shared workflow context
  through Remote Link, Order, and proof Payment module wrappers.
- Proof-only Payment authorization and cancellation now emit the same grouped
  internal payment mutation events expected by the original workflow event
  assertions.
- Worker proof reservation sync marks Node-replayed reservation rows as mirrored
  so the proof state can treat already-applied Worker reservations as
  idempotent without weakening normal stock checks.

Affected boundary:

- Existing module-lane Cart completion validation through
  `integration-tests-modules`.
- Cart completion field selection and Cart totals relation field preservation.
- Module internal service mutation event aggregation.
- Cloudflare HTTP test-state bridge for order, payment, cart line item, cart
  completion, and reservation proof state.

Validation:

- Focused Express baseline passed:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.completion.ts --runInBand -t "should clear events when complete cart fails"
```

Result: 1 focused test passing, 6 skipped.

- Focused Cloudflare event-compensation case passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.completion.ts --runInBand -t "should clear events when complete cart fails"
```

Result: 1 focused test passing, 6 skipped.

- Focused Cloudflare inventory-reservation case passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.completion.ts --runInBand -t "should complete cart reserving inventory from available locations"
```

Result: 1 focused test passing, 6 skipped.

- The original module-lane Cart completion file passed through Cloudflare:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.completion.ts --runInBand
```

Result: 1 suite passing, 7 tests passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/utils build
yarn workspace @medusajs/modules-sdk build
yarn workspace @medusajs/framework build
yarn workspace @medusajs/workflows-sdk build
yarn workspace @medusajs/orchestration build
yarn workspace @medusajs/core-flows build
yarn workspace @medusajs/event-bus-local build
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean full passing run used
  `DB_TEMP_NAME=medusa_test_modules_cart_completion_cloudflare_full_clean_final`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Cart Store Add Promotions Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged Store Cart add-promotions integration file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The spec reached the real Store API route and returned 200 for all cases, but
  the first run failed assertion parity because the Worker proof state reused
  explicit module-seeded adjustments instead of rebuilding promotion-derived
  adjustments for the POST add flow.
- Promotion target rules were being evaluated as whole-cart rules. That caused
  item promotions to apply to the wrong line item and shipping-method
  promotions to be rejected or represented as item discounts.
- Direct Cart module rows with `is_discountable: false` were not preserved, so
  a non-discountable item still received a computed promotion adjustment.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof state now separates promotion cart eligibility from
  target-level eligibility:
  - promotion `rules` remain cart-level checks;
  - item target rules are evaluated per cart line item;
  - shipping method target rules are evaluated per cart shipping method.
- POST add/replace promotion flows now recompute promotion-derived line item and
  shipping method adjustments instead of keeping stale explicit module-seeded
  adjustment ids.
- Direct Cart module item rows preserve `is_discountable`, so non-discountable
  test items do not receive computed promotion adjustments.
- Shipping-method promotion adjustments are computed from applicable cart
  promotions while explicit adjustment rows are still preserved for direct
  remove-flow setup until a route recomputation is required.

Affected boundary:

- Existing module-lane Store Cart add-promotions validation through
  `integration-tests-modules`.
- Worker proof state promotion adjustment calculation for cart line items and
  cart shipping methods.
- Cloudflare HTTP test-state bridge behavior added in the previous
  remove-promotions slice.

Validation:

- The original module-lane Cart Store add-promotions file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/add-promotions-to-cart.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_cart_store_add_promotions_cloudflare_direct_product`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Cart Store Remove Promotions Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged Store Cart remove-promotions integration file now passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The first run failed before route parity was proven:
  `cartModule.addShippingMethods(cart.id, methods)` was wrapped as a
  single-argument call, which collapsed Medusa's overload and caused the Cart
  module service to read `undefined.map`.
- After preserving the overload, both DELETE requests reached the Worker route
  but returned 404 because direct Node-side `cartModule.createCarts` setup had
  not been mirrored into the Worker proof state. The Worker still only knew the
  default static cart id.
- After cart sync was added, the route returned 200 but cart rows were missing
  direct module-created item, promotion, shipping method, and adjustment state.
  The original spec seeds those through module services before calling the HTTP
  route.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now mirrors direct Cart and Promotion
  module setup used by this spec:
  - direct `createCarts` rows, including explicit cart ids and raw cart items;
  - direct `createPromotions` rows with original promotion ids;
  - cart-promotion remote links into Worker cart promotion state;
  - direct cart line item and shipping method adjustments;
  - direct `addShippingMethods(cartId, methods)` overload results while
    preserving the existing option-based workflow path.
- The Worker proof cart id is now mutable per synced cart and resets to the
  original static id between tests.
- Static cart line items can now represent direct Cart module rows that have
  `product_id`, explicit `unit_price`, and no `variant_id`. Variant-backed
  items continue to use the existing parser path.

Affected boundary:

- Existing module-lane Store Cart remove-promotions validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Node-side module setup performed before
  Store API calls.
- Worker proof state for cart ids, cart line items, promotions, shipping
  methods, and explicit cart adjustments.

Validation:

- The original module-lane Cart Store remove-promotions file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/remove-promotions-from-cart.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_cart_store_remove_promotions_cloudflare_final2`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Modules Remote Query Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Remote Query integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Remote Query and Query graph validation through
  `integration-tests-modules`.
- Remote query key-not-found and relation-not-found behavior, Worker-handled
  product setup, cross-module product/variant/price filtering, and multi-link
  field alias traversal while the Cloudflare HTTP runtime flag is active.

Validation:

- The original module-lane Remote Query file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=modules/remote-query.spec.ts --runInBand
```

Result: 1 suite passing, 8 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_remote_query_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Modules CRUD Methods Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane auto-generated CRUD methods integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane auto-generated CRUD method validation through
  `integration-tests-modules`.
- Direct Brand module create and update behavior while the Cloudflare HTTP
  runtime flag is active.

Validation:

- The original module-lane CRUD methods file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=modules/crud.methods.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_crud_methods_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Define Link Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane `defineLink` integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- Existing test-local broad typing remains unchanged because the test file was
  not edited.

Affected boundary:

- Existing module-lane `defineLink` validation through
  `integration-tests-modules`.
- Link definition generation for single-part and multi-part entities,
  delete-cascade flags, option-object inputs, explicit list cardinality, and
  read-only pluralized aliases while the Cloudflare HTTP runtime flag is
  active.

Validation:

- The original module-lane `defineLink` file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/define-link.spec.ts --runInBand
```

Result: 1 suite passing, 7 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_define_link_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Link Cart Links Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Cart Links integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Cart Links validation through
  `integration-tests-modules`.
- Direct Cart, Customer, Region, Sales Channel, and Payment module setup,
  remote-link creation, and remote query traversal across cart-related links
  while the Cloudflare HTTP runtime flag is active.

Validation:

- The original module-lane Cart Links file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/cart-links.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_cart_links_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Link Cart Region Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Cart Region link integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Cart Region link validation through
  `integration-tests-modules`.
- Direct Cart and Region module setup and bidirectional remote query traversal
  between carts and regions while the Cloudflare HTTP runtime flag is active.

Validation:

- The original module-lane Cart Region link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/cart-region.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_cart_region_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Link Shipping Option Price Set Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Shipping Option Price Set link integration file
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Shipping Option Price Set link validation through
  `integration-tests-modules`.
- Worker-handled stock-location setup, direct Fulfillment and Pricing module
  setup, remote-link creation, remote query traversal from shipping options to
  price sets, prices, and calculated price while the Cloudflare HTTP runtime
  flag is active.

Validation:

- The original module-lane Shipping Option Price Set link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/shipping-option-price-set.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_shipping_option_price_set_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Link Product Variant Price Set Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Product Variant Price Set link integration file
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Product Variant Price Set link validation through
  `integration-tests-modules`.
- Direct Product and Pricing module setup, remote-link creation, remote query
  traversal from product variants to prices, and calculated price context while
  the Cloudflare HTTP runtime flag is active.

Validation:

- The original module-lane Product Variant Price Set link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/product-variant-price-set.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_product_variant_price_set_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Link Fulfillment Set Location Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Fulfillment Set Location link integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Fulfillment Set Location link validation through
  `integration-tests-modules`.
- Direct Fulfillment and Stock Location module setup, remote-link creation, and
  remote query traversal from stock locations to fulfillment sets while the
  Cloudflare HTTP runtime flag is active.

Validation:

- The original module-lane Fulfillment Set Location link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/fulfillment-set-location.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_fulfillment_set_location_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Link Sales Channel Location Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Sales Channel Location link integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Sales Channel Location link validation through
  `integration-tests-modules`.
- Direct Sales Channel and Stock Location module setup, remote-link creation,
  and remote query traversal from stock locations to sales channels while the
  Cloudflare HTTP runtime flag is active.

Validation:

- The original module-lane Sales Channel Location link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/sales-channel-location.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_sales_channel_location_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Link Publishable Key Sales Channel Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Publishable Key Sales Channel link integration file
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Publishable Key Sales Channel link validation through
  `integration-tests-modules`.
- Direct API Key and Sales Channel module setup, remote-link creation, and
  remote query traversal from publishable API keys to sales channels while the
  Cloudflare HTTP runtime flag is active.

Validation:

- The original module-lane Publishable Key Sales Channel link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/publishable-key-sales-channel.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_publishable_key_sales_channel_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Link Region Payment Provider Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Region Payment Provider link integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Region Payment Provider link validation through
  `integration-tests-modules`.
- Direct Region module setup, remote-link creation, and bidirectional remote
  query traversal between regions and payment providers while the Cloudflare
  HTTP runtime flag is active.

Validation:

- The original module-lane Region Payment Provider link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/region-payment-provider.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_region_payment_provider_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Link Store Currency Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Store Currency link integration file passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Store Currency link validation through
  `integration-tests-modules`.
- Direct Store module setup and remote query traversal from store supported
  currencies to currency rows while the Cloudflare HTTP runtime flag is active.

Validation:

- The original module-lane Store Currency link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/store-currency.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_store_currency_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Payment Providers Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Payment Providers integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin payment provider listing validation through
  `integration-tests-modules`.
- Worker-handled Admin payment provider listing while the Cloudflare HTTP
  runtime is active.

Validation:

- The original module-lane Payment Providers file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=payment/payment-providers.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_payment_providers_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Fulfillment Providers Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Fulfillment Providers integration file passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Fulfillment Providers Admin route validation through
  `integration-tests-modules`.
- Worker-handled Admin fulfillment provider listing while the Cloudflare HTTP
  runtime is active.

Validation:

- The original module-lane Fulfillment Providers file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=fulfillment-providers/index.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_fulfillment_providers_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Event Bus Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Event Bus integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Event Bus validation through
  `integration-tests-modules`.
- Event emission, message metadata shape, and subscriber invocation behavior
  while the Cloudflare HTTP runtime flag is active.

Validation:

- The original module-lane Event Bus file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=event-bus/index.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_event_bus_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Notification Admin Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Notification integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Notification service and subscriber validation through
  `integration-tests-modules`.
- Notification provider selection, notification listing/retrieval, and
  event-bus-triggered configurable notification subscriber behavior while the
  Cloudflare HTTP runtime flag is active.

Validation:

- The original module-lane Notification file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=notification/admin/notification.spec.ts --runInBand
```

Result: 1 suite passing, 5 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_notification_admin_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Auth Email Password Provider Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Auth email-password provider integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing skipped assertion remained skipped.

Affected boundary:

- Existing module-lane Auth email-password provider validation through
  `integration-tests-modules`.
- Direct Auth module identity setup followed by Worker-handled email-password
  login success and incorrect-password rejection while the Cloudflare HTTP
  runtime is active.

Validation:

- The original module-lane Auth email-password provider file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=auth/admin/email-password-provider.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing, 1 test skipped.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_auth_emailpass_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Invites Accept Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Invites accept integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin invite accept validation through
  `integration-tests-modules`.
- Auth registration plus Worker-handled Admin invite acceptance, including
  invalid token rejection and email override behavior, while the Cloudflare HTTP
  runtime is active.

Validation:

- The original module-lane Invites accept file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/accept-invite.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_invites_accept_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Invites Resend Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Invites resend integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin invite resend validation through
  `integration-tests-modules`.
- Direct User module invite setup followed by Worker-handled Admin invite
  resend behavior while the Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Invites resend file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/resend-invite.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_invites_resend_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Invites Delete Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Invites delete integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin invite delete validation through
  `integration-tests-modules`.
- Direct User module invite setup followed by Worker-handled Admin invite
  delete and retrieve-after-delete behavior while the Cloudflare HTTP runtime
  is active.

Validation:

- The original module-lane Invites delete file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/delete-invite.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_invites_delete_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Invites Create Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Invites create integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin invite create validation through
  `integration-tests-modules`.
- Worker-handled Admin invite creation while the Cloudflare HTTP runtime is
  active.

Validation:

- The original module-lane Invites create file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/create-invite.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_invites_create_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Invites Retrieve Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Invites retrieve integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin invite retrieve validation through
  `integration-tests-modules`.
- Direct User module invite setup followed by Worker-handled Admin invite
  retrieval while the Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Invites retrieve file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/retrieve-invite.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_invites_retrieve_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Invites List Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Invites list integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin invites list validation through
  `integration-tests-modules`.
- Direct User module invite setup followed by Worker-handled Admin invite list
  while the Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Invites list file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/list-invites.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_invites_list_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Users Update Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Users update integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin user update validation through
  `integration-tests-modules`.
- Direct User module setup followed by Worker-handled Admin user update while
  the Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Users update file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=users/update-user.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_users_update_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Users Get Me Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Users get-me integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin user get-me validation through
  `integration-tests-modules`.
- Admin authenticated current-user retrieval while the Cloudflare HTTP runtime
  is active.

Validation:

- The original module-lane Users get-me file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=users/get-me.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_users_get_me_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Defaults Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Defaults integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane defaults bootstrap validation through
  `integration-tests-modules`.
- Default store, sales channel, and publishable API key query graph behavior
  while the Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Defaults file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=defaults/defaults.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_defaults_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Store Admin Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Store Admin integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Store Admin lifecycle validation through
  `integration-tests-modules`.
- Direct Store module setup and delete around Worker-handled Admin store update
  and list routes while the Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Store Admin file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=store/admin/store.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_store_admin_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Customers Admin Delete Address Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Customers Admin delete address integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Customers Admin address delete validation through
  `integration-tests-modules`.
- Admin customer address deletion behavior and post-delete module state
  verification while the Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Customers Admin delete address file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/delete-customer-address.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_customers_admin_delete_address_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Customers Admin Update Address Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Customers Admin update address integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Customers Admin address update validation through
  `integration-tests-modules`.
- Admin customer address mutation behavior, including default shipping and
  default billing replacement semantics, while the Cloudflare HTTP runtime is
  active.

Validation:

- The original module-lane Customers Admin update address file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/update-customer-address.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_customers_admin_update_address_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Customers Store Delete Address Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Customers Store delete address integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Customers Store address delete validation through
  `integration-tests-modules`.
- Store authenticated address deletion behavior, including rejection for another
  customer's address and post-delete module state verification, while the
  Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Customers Store delete address file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/store/delete-customer-address.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_customers_store_delete_address_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Customers Store Update Address Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Customers Store update address integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Customers Store address update validation through
  `integration-tests-modules`.
- Store authenticated address update behavior, including rejection for another
  customer's address, while the Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Customers Store update address file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/store/update-customer-address.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_customers_store_update_address_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Customers Store Get Me Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Customers Store get-me integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Customers Store authenticated retrieval validation
  through `integration-tests-modules`.
- Store `/customers/me` behavior with helper-created customer identity,
  bearer token, and publishable-key headers while the Cloudflare HTTP runtime is
  active.

Validation:

- The original module-lane Customers Store get-me file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/store/get-me.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_customers_store_get_me_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Customers Store Create Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Customers Store create integration file passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Customers Store create validation through
  `integration-tests-modules`.
- Store customer creation with bearer auth identity and publishable-key headers
  while the Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Customers Store create file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/store/create-customer.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_customers_store_create_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Customers Admin List Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Customers Admin list integration file passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Customers Admin list validation through
  `integration-tests-modules`.
- Admin customer listing, group filtering, last-name filtering, and search
  behavior while the Cloudflare HTTP runtime is active.

Validation:

- The original module-lane Customers Admin list file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/list-customers.spec.ts --runInBand
```

Result: 1 suite passing, 4 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_customers_admin_list_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Customer Groups Admin List Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Customer Groups Admin list integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Customer Groups Admin list validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime setup while customer group setup assertions execute
  against the original module service and API route behavior.

Validation:

- The original module-lane Customer Groups Admin list file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/list-customer-groups.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_customer_groups_admin_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Regions Admin Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Regions Admin integration file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- Initial Cloudflare run reached the real Regions Admin assertions, but 7 of 10
  tests failed.
- Worker-created regions did not preserve `metadata`, region payment-provider
  links were not maintained during create/update, invalid payment providers did
  not produce the expected 404, and direct Region module setup rows were not
  visible to the Worker proof runtime.
- After adding region proof-state sync, the remaining failures were delete
  handling and country preservation for direct module-created regions.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare static workflow engine now handles `create-regions`,
  `update-regions`, and `delete-regions` with region metadata, countries,
  deleted timestamps, and payment-provider links.
- The Cloudflare HTTP test-state bridge now mirrors direct Region module
  `createRegions` setup rows into `/http-proof/regions` and mirrors Worker HTTP
  region deletes back into the Node Region module so existing post-delete
  assertions still use the original service.

Affected boundary:

- Existing module-lane Regions Admin validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof state for region rows and region payment-provider links.
- Cloudflare HTTP test-state bridge between Worker-handled Admin region APIs and
  the Node Region module used by original module integration assertions.

Validation:

- Changed package build passed:

```bash
yarn workspace @medusajs/test-utils build
```

- The original module-lane Regions Admin file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=regions/admin/regions.spec.ts --runInBand
```

Result: 1 suite passing, 10 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_regions_admin_cloudflare_fix2`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Product Update Variants Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Product update variants workflow integration file
passes while the module integration runner is configured for the Cloudflare
HTTP runtime. This file validates empty update short-circuiting and
compensation for failed product variant update hooks through the original
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Product update variants workflow validation through
  `integration-tests-modules`.
- Product module service and workflow compensation behavior while the runner
  uses the Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Product update variants workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=product/workflows/update-product-variants.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_product_update_variants_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Product Batch Variant Images Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Product batch variant image workflow integration file
passes while the module integration runner is configured for the Cloudflare
HTTP runtime. This file validates removing image-to-variant links through both
batch workflow directions and clearing the variant thumbnail through the
original `integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Product batch variant image workflow validation through
  `integration-tests-modules`.
- Product image, variant, and image-to-variant link behavior while the runner
  uses the Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Product batch variant image workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=product/workflows/batch-variant-image-workflows.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_product_batch_variant_images_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Product Batch Products Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Product batch products workflow integration file
passes while the module integration runner is configured for the Cloudflare
HTTP runtime. This file validates compensation for batched product create,
update, and delete operations, plus batched product variant create, update, and
delete operations, through the original `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Product batch products workflow validation through
  `integration-tests-modules`.
- Product, Product Variant, Fulfillment shipping profile, and Pricing behavior
  while the runner uses the Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Product batch products workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=product/workflows/batch-products.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_product_batch_products_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Product Admin Price List Filter Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Product Admin integration file now passes while the
module integration runner is configured for the Cloudflare HTTP runtime. This
file validates `GET /admin/products` filtering by `price_list_id[]`, including
combined price-list and search filtering, through the original
`integration-tests-modules` `test:integration` script.

Failed-first result:

- The first Cloudflare run reached the original Product Admin assertions.
- `GET /admin/products?price_list_id[]=...` returned all three products instead
  of only the two variants linked to the price list.
- Adding direct product `price_list_id` filtering was not sufficient because
  Medusa's existing middleware intentionally resolves `price_list_id[]` through
  `price_list -> prices.price_set.variant.id`, deletes the price-list filter,
  and passes `variants.id` into the Product query.
- The Worker proof query layer did not support that exact intermediate path:
  `price_list` remote/graph rows with nested `price_set.variant.id`, Product
  graph filtering by `variants.id`, or direct module-created variants synced
  into Worker product proof state.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof query service now supports `price_list` rows with the
  nested `prices.price_set.variant.id` shape expected by the existing Medusa
  middleware.
- The Cloudflare proof Product graph/query path now filters by nested
  `variants.id` and direct `price_list_id` filters.
- The Cloudflare HTTP test-state bridge now mirrors direct
  `ProductModuleService.createProductVariants` calls by reloading the affected
  products with variants and syncing those full product rows to the Worker.
- Price-list proof rows now fall back to source input prices when the Pricing
  module result omits nested prices, while keeping generated proof-local price
  ids for Worker filtering.

Affected boundary:

- Existing module-lane Product Admin validation through
  `integration-tests-modules`.
- Real Medusa Admin Products route and middleware running through the Fetch
  HTTP adapter.
- Cloudflare proof query service behavior for Product and Price List graph
  rows.
- Cloudflare HTTP test-state bridge for direct Product Variant creation and
  Price List proof rows.

Validation:

- The original module-lane Product Admin file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=product/admin/products.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_product_admin_products_cloudflare_variant_sync`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Shipping Option Batch Rules Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Shipping Option batch rules workflow integration file
passes while the module integration runner is configured for the Cloudflare
HTTP runtime. This file validates batch create, update, delete, and
compensation behavior for shipping option rules through the original
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Shipping Option batch rules workflow validation through
  `integration-tests-modules`.
- Fulfillment and remote-query behavior while the runner uses the Cloudflare
  HTTP runtime selector.

Validation:

- The original module-lane Shipping Option batch rules workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=shipping-options/workflows/batch-shipping-options-rules.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_shipping_batch_rules_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Shipping Option Delete Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Shipping Option delete workflow integration file
passes while the module integration runner is configured for the Cloudflare
HTTP runtime. This file validates shipping option deletion and compensation
behavior through the original `integration-tests-modules` `test:integration`
script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Shipping Option delete workflow validation through
  `integration-tests-modules`.
- Fulfillment, Pricing, and remote-query behavior while the runner uses the
  Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Shipping Option delete workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=shipping-options/workflows/delete-shipping-options.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_shipping_delete_workflow_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Shipping Option Update Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Shipping Option update workflow integration file
passes while the module integration runner is configured for the Cloudflare
HTTP runtime. This file validates shipping option price updates,
non-existent-region validation, and compensation behavior through the original
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Shipping Option update workflow validation through
  `integration-tests-modules`.
- Fulfillment, Region, Pricing, and remote-query behavior while the runner uses
  the Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Shipping Option update workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=shipping-options/workflows/update-shipping-options.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_shipping_update_workflow_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Shipping Option Create Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Shipping Option create workflow integration file
passes while the module integration runner is configured for the Cloudflare
HTTP runtime. This file validates shipping option creation, prices,
region-backed price validation, and compensation behavior through the original
`integration-tests-modules` `test:integration` script.

First-run note:

- The first run failed before any shipping assertion because the Cloudflare dev
  runtime timed out waiting for `/health` and produced no child-process output.
- A clean rerun with a fresh temporary database passed all original assertions,
  so no runtime or test utility code changed in this slice.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Shipping Option create workflow validation through
  `integration-tests-modules`.
- Fulfillment, Region, Pricing, and remote-query behavior while the runner uses
  the Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Shipping Option create workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=shipping-options/workflows/create-shipping-options.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_shipping_create_workflow_cloudflare_retry`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Payment Session Workflows Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Payment session workflow integration file passes
while the module integration runner is configured for the Cloudflare HTTP
runtime. This file validates payment session creation, customer account-holder
context, replacement of existing sessions, and compensation behavior through
the original `integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Payment session workflow validation through
  `integration-tests-modules`.
- Direct Payment, Region, and Customer module service behavior while the runner
  uses the Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Payment session workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=payment/payment-session.workflows.spec.ts --runInBand
```

Result: 1 suite passing, 6 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_payment_session_workflows_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Tax Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Tax workflow integration file passes while the module
integration runner is configured for the Cloudflare HTTP runtime. This file
validates tax rate rule creation and compensation behavior through the original
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Tax workflow validation through
  `integration-tests-modules`.
- Direct Tax module service and `updateTaxRatesWorkflow` behavior while the
  runner uses the Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Tax workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=tax/workflow/tax.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_tax_workflow_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Region Update Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Region update workflow integration file now passes
while the module integration runner is configured for the Cloudflare HTTP
runtime. This file validates region updates and compensation of
payment-provider link changes through the original `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The first Cloudflare run reached the original compensation assertion.
- Node-side workflow compensation restored the Region update, but the Worker
  proof state still contained RegionPaymentProvider links created during the
  failed workflow.
- The Cloudflare proof-state `delete-remote-links` operation only handled
  ProductVariantInventoryItem links from earlier workflow coverage. It now also
  deletes RegionPaymentProvider links from either flat proof rows or original
  remote-link definition rows.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP proof state now removes RegionPaymentProvider links when
  Node-side `remoteLink.dismiss` is mirrored through `delete-remote-links`.

Affected boundary:

- Existing module-lane Region update workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof-state cleanup for RegionPaymentProvider link
  compensation.

Validation:

- The original module-lane Region update workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=regions/workflows/update-region.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

- Changed app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_regions_update_workflow_cloudflare_link_delete`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Region Create Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Region create workflow integration file passes while
the module integration runner is configured for the Cloudflare HTTP runtime.
This file validates region creation, country hydration, payment-provider links,
and compensation behavior through the original `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Region create workflow validation through
  `integration-tests-modules`.
- Region workflow behavior and remote-query hydration of payment-provider links
  while the runner uses the Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Region create workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=regions/workflows/create-region.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_regions_create_workflow_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## RBAC Workflows Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane RBAC workflow integration file passes while the
module integration runner is configured for the Cloudflare HTTP runtime. This
file validates role hierarchy, inherited policies, circular dependency
prevention, permission validation, and policy synchronization through the
original `integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane RBAC workflow validation through
  `integration-tests-modules`.
- RBAC workflow behavior and direct RBAC module service behavior while the
  runner uses the Cloudflare HTTP runtime selector.

Validation:

- The original module-lane RBAC workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=rbac/rbac-workflows.spec.ts --runInBand
```

Result: 1 suite passing, 19 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_rbac_workflows_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## RBAC Endpoint Entity Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane RBAC endpoint-entity integration file now passes
while the module integration runner is configured for the Cloudflare HTTP
runtime. This file validates that Admin endpoint query-config entities are
present in the global policy resource registry through the original
`integration-tests-modules` `test:integration` script.

Failed-first result:

- The first Cloudflare run reached the original RBAC assertion and failed
  because the Admin `workflow_execution` endpoint entity was missing from
  `PolicyResource`.
- `workflow_execution` already exists in Medusa's default policy resource type
  and system policy definitions, but the test can observe the shared policy
  registry before Medusa policy discovery has populated that runtime resource
  through the same module instance.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The shared policy registry now initializes `workflow_execution` as a default
  framework/runtime policy resource.
- Medusa's global policy type declarations were aligned with the shared policy
  registry declarations so `@medusajs/medusa` builds cleanly with the registry
  change.

Affected boundary:

- Existing module-lane RBAC endpoint-entity validation through
  `integration-tests-modules`.
- Shared `PolicyResource` registry defaults for workflow execution resources.
- Medusa global policy type declarations.

Validation:

- The original module-lane RBAC endpoint-entity file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=rbac-match-endpoint-entities.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/utils build
yarn workspace @medusajs/medusa build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_rbac_endpoint_entities_cloudflare_policy_default`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Query Graph Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Query Graph integration file passes while the module
integration runner is configured for the Cloudflare HTTP runtime. This file
validates `query.graph()` service ordering, repeated entity traversal at
different graph levels, and fixture module links through the original
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Query Graph validation through
  `integration-tests-modules`.
- Medusa query graph behavior with fixture translation module links while the
  runner uses the Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Query Graph file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=query-graph/query-graph.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_query_graph_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Modules CRUD Methods Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane auto-generated CRUD methods integration file passes
while the module integration runner is configured for the Cloudflare HTTP
runtime. This file validates direct custom module CRUD service behavior for
the test `brand` module through the original `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane auto-generated CRUD method validation through
  `integration-tests-modules`.
- Direct custom module service CRUD behavior while the runner uses the
  Cloudflare HTTP runtime selector.

Validation:

- The original module-lane CRUD methods file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=modules/crud.methods.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_crud_methods_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Modules Remote Query Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Remote Query integration file passes while the module
integration runner is configured for the Cloudflare HTTP runtime. This file
validates existing Medusa remote-query, query graph, relation error handling,
operator filters, and multiple field-alias behavior through the original
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane Remote Query validation through
  `integration-tests-modules`.
- Medusa joiner and remote-query behavior while the test runner uses the
  Cloudflare HTTP runtime selector.

Validation:

- The original module-lane Remote Query file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=modules/remote-query.spec.ts --runInBand
```

Result: 1 suite passing, 8 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_remote_query_cloudflare_probe`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Modules Load Standalone Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane standalone module loading integration file passes
while the module integration runner is configured for the Cloudflare HTTP
runtime. This file validates standalone `MedusaApp` module bootstrap and module
migrations using the original `integration-tests-modules` `test:integration`
script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or test utility code changed in this slice.

Affected boundary:

- Existing module-lane standalone module validation through
  `integration-tests-modules`.
- Product module standalone bootstrap through `MedusaApp` using
  `DATABASE_URL` from the runner-provided temporary database.

Validation:

- The original module-lane standalone module file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=modules/load-standalone.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_load_standalone_cloudflare`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Common Workflows Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Common workflow integration file now passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The first Cloudflare run reached the original workflow compensation
  assertions, but direct Node-side link workflows could not see or clean up all
  Worker-created ProductVariantInventoryItem state.
- `updateLinksWorkflow` failed because the Worker-created variant inventory
  link from `POST /admin/products/:id/variants/:variant_id/inventory-items` was
  not mirrored into the Node remote-link service used by the direct workflow.
- `dismissLinksWorkflow` failed because single-product creation did not mirror
  the default variant inventory item and link into Node-side inventory and
  remote-link state.
- After mirroring those creates, `createLinksWorkflow` compensation left an
  extra Worker proof link behind because Node-side `remoteLink.dismiss` did not
  propagate to the Worker proof state.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- Single-product Admin creation now mirrors the default variant inventory item
  and ProductVariantInventoryItem link into Node-side module state, matching the
  batch-product bridge behavior.
- Worker-created inventory items from `POST /admin/inventory-items` are mirrored
  into the Node Inventory module.
- Worker-created variant inventory links are mirrored into Node remote-link
  state and emit the corresponding Index attach event.
- Node-side `remoteLink.dismiss` now mirrors ProductVariantInventoryItem link
  deletion into the Cloudflare proof state through a new
  `delete-remote-links` proof operation.

Affected boundary:

- Existing module-lane Common workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for InventoryItem and
  ProductVariantInventoryItem synchronization.
- Cloudflare HTTP proof state for deleting ProductVariantInventoryItem links
  when original Node workflows compensate with `remoteLink.dismiss`.

Validation:

- The original module-lane Common workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=common/workflows.spec.ts --runInBand
```

Result: 1 suite passing, 5 tests passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_common_workflows_cloudflare_remote_link_dismiss`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Index Query.index Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Index `query.index` integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- The first Cloudflare run reached the original Index assertions, but all five
  tests failed because `/admin/products/batch` returned Worker proof products
  that were not mirrored into the Node Product, Pricing, Inventory, link, and
  Index state used by the module assertions.
- After adding batch product mirroring, four tests passed and the remaining
  enum-filter case failed because the custom test Brand module and
  Product-Brand link were created directly in Node without deterministic Index
  event mirroring.
- A follow-up run passed but still logged a product-brand link replication
  warning. The returned link rows can be nested by link module grouping, so the
  bridge now flattens nested `remoteLink.create` results before emitting manual
  Index attach events.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now handles
  `POST /admin/products/batch` by creating matching Node Product rows using
  Worker-returned Product, ProductVariant, and Price IDs.
- For batch-created variants, the bridge creates Node PriceSet/Price rows,
  ProductVariantPriceSet links, InventoryItem rows, ProductVariantInventoryItem
  links, and mirrors the corresponding Index events.
- The bridge now mirrors custom Brand module create events and
  ProductProductBrandBrand attach events when the test Brand module is present.

Affected boundary:

- Existing module-lane Index `query.index` validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Admin product batch creation with
  variants, prices, and inventory-item hydration.
- Node-side Index module event consumption for custom Brand and Product-Brand
  link filters.

Validation:

- The original module-lane Index `query.index` file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=index/query-index.spec.ts --runInBand
```

Result: 1 suite passing, 5 tests passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_index_query_cloudflare_cleanlink`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Index Sync Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Index sync integration file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The first Cloudflare run failed during link sync because the integration test
  enables the Index module and the custom `product-brand` link, but the test
  `brand` module was not declared queryable. The Link sync path requires
  queryable module metadata for linked modules.
- After making the test `brand` module queryable, the spec reached the Index
  assertions but failed because the Index module service had no initialized
  storage provider. The Cloudflare module test runner loaded modules and
  project entrypoints but did not run the loaded Medusa app's application-start
  hook before the original test resolved the Index service.
- Running the app start hook exposed a shared lifecycle issue: the
  `MedusaModule.onApplicationStart` API fired async module hooks without
  awaiting them, even though the app-level API is awaited by callers.
- After provider initialization was fixed, the spec failed with zero indexed
  products after manual sync. The unchanged test creates products through the
  Worker Admin API, then asks the Node-side Index module service to sync them.
  The bridge mirrored Node-created products to the Worker but did not mirror
  Worker-created products, variant price sets, and variant price-set links back
  into the Node modules.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The integration test `brand` module is now marked `isQueryable` so the
  existing Index-enabled `product-brand` link can bootstrap through Link sync.
- The module SDK application-start lifecycle now awaits module startup hooks.
- The Cloudflare module test runner starts the loaded Medusa app before
  starting the Worker HTTP runtime.
- The Cloudflare HTTP test-state bridge now mirrors `POST /admin/products`
  Worker responses into the Node Product module, creates Node Pricing price
  sets for variant prices, and creates the standard Product Variant to Price
  Set remote links so the real Node Index synchronizer sees the graph.

Affected boundary:

- Existing module-lane Index sync validation through
  `integration-tests-modules`.
- Module SDK application startup lifecycle.
- Cloudflare HTTP test runner startup order.
- Cloudflare HTTP test-state bridge for Worker-created Product/Pricing state.

Validation:

- The original module-lane Index sync file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=index/sync.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

- Changed package builds passed:

```bash
yarn workspace @medusajs/modules-sdk build
yarn workspace @medusajs/framework build
yarn workspace @medusajs/test-utils build
```

- Focused module SDK lifecycle coverage passed:

```bash
yarn workspace @medusajs/modules-sdk test --testPathPattern=medusa-module
```

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_index_sync_cloudflare_product_bridge`.

Next step:

- Continue with the remaining Index module integration files, starting with
  `index/search.spec.ts` or `index/query-index.spec.ts`.

## Customer Store Get-Me Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Store Customer `get-me` integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Store Customer auth/customer validation through
  `integration-tests-modules`.
- Cloudflare proof behavior for registering a customer auth identity, creating
  the Store customer, logging in, and resolving `/store/customers/me`.

Validation:

- The original module-lane Store Customer `get-me` file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/store/get-me.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Customer Store Delete Address Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Store Customer address deletion integration file now
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- The first run failed before the HTTP DELETE because
  `createAuthenticatedCustomer` created the customer through the Worker Store
  route, then the unchanged test created the address directly through the Node
  Customer module service. The Node module did not know about the
  Worker-created customer ID.
- After mirroring Worker-created Store customers back into the Node Customer
  module, the DELETE reached the Worker but returned `404` because
  Node-created customer addresses were not mirrored into Worker proof state.
- After syncing Node-created addresses into Worker proof state, the route
  returned `500` because the original Store address routes were not registered
  in the static proof manifest and the static Customer module service did not
  implement the address methods used by the original create/delete address
  workflows.
- Adding the original Store address routes exposed a Worker bundling issue:
  importing the broad `@medusajs/core-flows` barrel pulled Node-only workflow
  code into the Worker graph.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The original Store Customer address route handlers are now included in the
  generated Cloudflare proof manifest.
- The Store Customer address routes import concrete customer workflow subpaths
  instead of the broad `@medusajs/core-flows` barrel, preserving behavior while
  keeping the Worker graph narrow.
- `@medusajs/core-flows` now exports the customer address workflow subpaths
  needed by those route imports.
- The Cloudflare proof Customer service now supports customer address
  list/create/update/delete methods used by the original customer address
  workflows.
- The Cloudflare test runner bridge now mirrors Worker-created Store customers
  into the Node Customer module and Node-created customer addresses into Worker
  proof state, then mirrors successful Worker Store address deletes back to the
  Node module.

Affected boundary:

- Existing module-lane Store Customer address validation through
  `integration-tests-modules`.
- Static HTTP proof route manifest generation for Store Customer address
  routes.
- Worker-safe workflow subpath exports and Vite dev aliases for customer
  address workflows.
- Cloudflare proof Customer state and test-runner state bridge.

Validation:

- The original module-lane Store Customer delete address file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/store/delete-customer-address.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

- `@medusajs/test-utils` built successfully after the runner bridge change:

```bash
yarn workspace @medusajs/test-utils build
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
- This remains separate from the module integration result because the
  unchanged module spec and the Worker type/build/import/manifest gates passed.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow Store Customer address spec.

## Customer Store Create Address Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Store Customer address creation integration file now
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- The first run reached the original Store POST route and returned `200`.
- The assertion failed because the response customer payload did not include
  `addresses[0]`. The Store Customer query config requests `*addresses`, but
  the Cloudflare proof `customer` remote-query projection returned only scalar
  customer fields.
- After adding address projection to the proof `customer` remote-query row, the
  response assertion could verify the created address.
- The unchanged test also verifies Node Customer module state after the Store
  route creates the address, so the test runner bridge now mirrors
  Worker-created Store customer addresses back into the Node Customer module.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof `customer` remote-query row now includes customer
  addresses when the original query config requests them.
- The Cloudflare test runner bridge now mirrors Store-created customer
  addresses from Worker responses back into the Node Customer module.

Affected boundary:

- Existing module-lane Store Customer address creation validation through
  `integration-tests-modules`.
- Cloudflare proof Customer remote-query projection.
- Cloudflare HTTP test runner state bridge between Worker Store routes and the
  Node Customer module.

Validation:

- The original module-lane Store Customer create address file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/store/create-customer-addresses.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

- `@medusajs/test-utils` built successfully after the runner bridge change:

```bash
yarn workspace @medusajs/test-utils build
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script with the Store Customer address list spec.

## Customer Store List Addresses Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Store Customer address list integration file now
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- The first run failed before the Store GET request. The unchanged test creates
  a second customer with nested `addresses` directly through the Node Customer
  module.
- The Cloudflare test runner bridge had wrapped `createCustomerAddresses` but
  dropped Medusa's `sharedContext` argument. During nested customer creation,
  the Customer module creates the customer and its nested addresses in one
  transaction, so dropping the shared context made the address insert unable to
  see the uncommitted customer row.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare test runner bridge now preserves the optional shared context
  argument when wrapping `createCustomers` and `createCustomerAddresses`.

Affected boundary:

- Existing module-lane Store Customer address list validation through
  `integration-tests-modules`.
- Cloudflare HTTP test runner state bridge around direct Node Customer module
  writes.

Validation:

- The original module-lane Store Customer list addresses file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/store/list-customer-addresses.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

- `@medusajs/test-utils` built successfully after the runner bridge change:

```bash
yarn workspace @medusajs/test-utils build
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script with the Store Customer address update spec. Note that the upstream
  file currently contains `it.only`, so that slice should either document the
  narrowed upstream assertion or first decide whether to remove the upstream
  focus marker.

## Customer Store Update Address Cloudflare Revalidation

Implementation commit:

- This commit.

The Store Customer address update integration file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The file contained an upstream `it.only` on the successful update assertion,
  which would have skipped the existing ownership failure assertion.
- The focus marker was removed without changing either assertion or adding a
  fork-only test script.
- After restoring the full file scope, both existing assertions passed through
  the Cloudflare HTTP runtime.

Differences from original Medusa:

- The accidental focused test marker was removed from the Store Customer
  address update integration file so the full existing file runs.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Store Customer address update validation through
  `integration-tests-modules`.
- Test coverage hygiene for Store Customer specs under the module integration
  lane.

Validation:

- The original module-lane Store Customer update address file passed after
  removing the focus marker:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/store/update-customer-address.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

- Store Customer specs were checked for remaining focused tests:

```bash
rg -n "it\\.only|describe\\.only" integration-tests/modules/__tests__/customer/store
```

Result: no matches.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script with the remaining Store Customer customer-creation spec, then move to
  the next narrow Customer module area.

## Customer Store Create Customer Cloudflare Revalidation

Implementation commit:

- This commit.

The Store Customer creation integration file now passes through the Cloudflare
HTTP runtime using the existing `integration-tests-modules` `test:integration`
script.

Failed-first result:

- The file contained a skipped assertion with a TODO to re-enable it once
  customer authentication was fixed.
- After removing only the skip marker, the unchanged assertion failed with
  `401` on `POST /store/customers`.
- The test signs the raw AuthIdentity DTO returned by the Node Auth module.
  The Cloudflare proof bearer decoder only understood newer auth-context
  payloads containing `actor_type` and `auth_identity_id`.
- The proof decoder now accepts an AuthIdentity DTO payload as an
  authenticated-but-unregistered customer context: `auth_identity_id` comes from
  the DTO `id`, `actor_id` is empty unless `app_metadata.customer_id` exists,
  and metadata is preserved.

Differences from original Medusa:

- The skipped Store Customer creation assertion was re-enabled without changing
  the assertion body.
- The Cloudflare proof bearer decoder now supports the AuthIdentity DTO JWT
  shape used by the existing module integration test.
- No new test script was added.

Affected boundary:

- Existing module-lane Store Customer creation validation through
  `integration-tests-modules`.
- Cloudflare proof authentication middleware for unregistered customer account
  creation.

Validation:

- The re-enabled module-lane Store Customer creation file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/store/create-customer.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

- Store Customer specs were checked for remaining focused or skipped tests:

```bash
rg -n "it\\.skip|it\\.only|describe\\.only" integration-tests/modules/__tests__/customer/store/create-customer.spec.ts integration-tests/modules/__tests__/customer/store
```

Result: no matches.

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Move from Store Customer route specs to the next narrow Customer module area
  under `integration-tests/modules/__tests__/customer`.

## Customer Admin Create Customer Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer creation file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The Admin Customer route returned `200`, but the response customer was
  missing `created_by`.
- The existing assertion expected `created_by` to be populated for an
  admin-created customer.
- The Cloudflare static proof customer row now tracks `created_by`, preserves it
  when syncing parsed customers, and falls back to the current admin actor for
  admin-created customers.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof customer representation now includes the admin creator
  field required by the existing Admin Customer creation contract.

Affected boundary:

- Existing module-lane Admin Customer creation validation through
  `integration-tests-modules`.
- Cloudflare proof response shape for customer records.

Validation:

- The original module-lane Admin Customer creation file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/create-customer.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Admin route lane with the next narrow original
  integration file, starting with `customer/admin/update-customer.ts`.

## Customer Admin Update Customer Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer update file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- `POST /admin/customers/:id` initially returned `404` after the test created a
  customer through the Node Customer module service.
- The Node-to-Worker bridge already recorded created customers, but the
  Cloudflare static proof parser dropped customers whose `email` was absent.
- The original Customer module allows customers with no email. The static proof
  customer representation now models `email` as nullable and keeps email-filter
  matching explicit for nullable rows.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof customer representation now accepts module-created
  customers without an email instead of inventing a fallback email or dropping
  the row.

Affected boundary:

- Existing module-lane Admin Customer update validation through
  `integration-tests-modules`.
- Node-to-Worker Customer module state bridge parsing for customer rows.
- Cloudflare proof customer filtering for nullable email values.

Validation:

- The original module-lane Admin Customer update file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/update-customer.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Admin route lane with the next narrow original
  integration file, such as `customer/admin/delete-customer.ts` or the address
  route files.

## Customer Admin Delete Customer Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer delete file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- `DELETE /admin/customers/:id` returned `200`, but the Node-side Customer
  module still returned the customer with `deleted_at: null`.
- The existing assertion retrieves the customer from the Node module service
  with `withDeleted: true` after the Worker HTTP delete call.
- The first bridge attempt used `deleteCustomers`, which removed the row too
  aggressively for the assertion path. The real Medusa admin route uses
  `removeCustomerAccountWorkflow`, which delegates to `deleteCustomersWorkflow`
  and then `softDeleteCustomers`.
- The test runner bridge now mirrors Worker admin customer deletes back into
  the Node Customer module with `softDeleteCustomers([customerId])`.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now mirrors the admin customer delete
  workflow's soft-delete behavior into the Node module state used by the
  original assertion.

Affected boundary:

- Existing module-lane Admin Customer delete validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Worker-to-Node Customer module state.

Validation:

- The original module-lane Admin Customer delete file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/delete-customer.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

- The test runner package build passed after changing its source:

```bash
yarn workspace @medusajs/test-utils build
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Admin route lane with the admin customer address files.

## Customer Admin Create Address Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer address creation file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- `POST /admin/customers/:id/addresses` returned successful HTTP responses, but
  Node-side Customer module assertions did not see the Worker-created address.
- The first assertion expected `retrieveCustomer(customer.id, { relations:
  ["addresses"] })` to include the new address.
- The default shipping and billing assertions expected the new Worker-created
  default address to replace the existing Node-side default address.
- The bridge now mirrors admin customer address creation from the Worker
  response/request back into the Node Customer module.
- For default shipping or billing address creation, the bridge first unsets the
  existing Node-side default address before creating the new address, matching
  the route/workflow behavior expected by the original assertions.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now mirrors admin customer address
  creation and default-address replacement into the Node module state used by
  the existing module tests.

Affected boundary:

- Existing module-lane Admin Customer address creation validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Worker-to-Node Customer address state.

Validation:

- The original module-lane Admin Customer address creation file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/create-customer-addresses.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

- The test runner package build passed after changing its source:

```bash
yarn workspace @medusajs/test-utils build
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Admin route lane with address listing, update, and
  delete files.

## Customer Admin List Addresses Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer address listing file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- The basic address listing/count assertion passed.
- The search assertion failed because `GET /admin/customers/:id/addresses?q=12`
  returned all addresses for the customer instead of filtering the static
  Worker proof rows.
- The Cloudflare static proof address listing now applies `q` search across the
  address fields and returns the filtered count.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof implementation now matches the existing Admin Customer
  address listing search contract for the tested address fields.

Affected boundary:

- Existing module-lane Admin Customer address listing validation through
  `integration-tests-modules`.
- Cloudflare proof response behavior for `GET /admin/customers/:id/addresses`.

Validation:

- The original module-lane Admin Customer address listing file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/list-customer-addresses.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Admin route lane with address update and delete files.

## Customer Admin Update Address Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer address update file now passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- `POST /admin/customers/:id/addresses/:address_id` initially returned `404`
  because the Cloudflare proof setup matcher and handler only covered the
  customer address collection route.
- After the nested route was added, the HTTP response assertion passed, but the
  Node-side default shipping and billing assertions still saw the old default
  address because the Worker update was not mirrored back into the Node Customer
  module state.
- The Cloudflare proof runtime now supports the nested Admin Customer address
  update route, including default-address replacement in static Worker state.
- The test runner bridge now mirrors Worker admin address updates into the Node
  Customer module, unsetting existing defaults before updating the target
  address when the Worker request marks it as default.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof implementation now covers the existing Admin Customer
  address update route.
- The Cloudflare HTTP test-state bridge now mirrors admin address updates and
  default-address replacement into the Node module state used by the original
  assertions.

Affected boundary:

- Existing module-lane Admin Customer address update validation through
  `integration-tests-modules`.
- Cloudflare proof response behavior for
  `POST /admin/customers/:id/addresses/:address_id`.
- Cloudflare HTTP test-state bridge for Worker-to-Node Customer address state.

Validation:

- The original module-lane Admin Customer address update file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/update-customer-address.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

- The test runner package build passed after changing its source:

```bash
yarn workspace @medusajs/test-utils build
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Admin route lane with address deletion.

## Customer Admin Delete Address Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer address deletion file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- `DELETE /admin/customers/:id/addresses/:address_id` initially returned `404`
  because the Cloudflare proof runtime did not yet implement the nested address
  delete method.
- The Cloudflare proof runtime now deletes the nested admin customer address
  and returns the same delete envelope shape expected by the existing route
  contract.
- The test runner bridge now mirrors Worker admin address deletes into the Node
  Customer module state, so the original assertion that reloads the customer
  with `relations: ["addresses"]` sees the address removed.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof implementation now covers the existing Admin Customer
  address delete route.
- The Cloudflare HTTP test-state bridge now mirrors admin address deletion into
  the Node module state used by the original assertion.

Affected boundary:

- Existing module-lane Admin Customer address deletion validation through
  `integration-tests-modules`.
- Cloudflare proof response behavior for
  `DELETE /admin/customers/:id/addresses/:address_id`.
- Cloudflare HTTP test-state bridge for Worker-to-Node Customer address state.

Validation:

- The original module-lane Admin Customer address deletion file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/delete-customer-address.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

- The test runner package build passed after changing its source:

```bash
yarn workspace @medusajs/test-utils build
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer module lane with the remaining Admin Customer route
  files or move to the Customer Group route lane.

## Customer Admin List Customers Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer listing file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- Basic customer listing/count and `q` search already passed.
- `last_name` filtering failed because the Cloudflare proof listing only
  applied the full-text `q` search and did not apply field-specific customer
  filters.
- Customer group filtering initially returned all customers because indexed
  query keys such as `groups[0]` were not parsed. After indexed query parsing
  was added, it returned zero customers because Node-created customer groups and
  `addCustomerToGroup` links were not mirrored into Worker proof state.
- The proof listing now supports indexed query parameters and `last_name`
  filtering.
- The HTTP proof state and test runner bridge now sync Node-created customer
  groups and customer-group membership links into Worker state.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof implementation now covers the existing Admin Customer
  listing filters exercised by the module suite.
- The Cloudflare HTTP test-state bridge now mirrors Customer module group
  creation and membership links into Worker state.

Affected boundary:

- Existing module-lane Admin Customer listing validation through
  `integration-tests-modules`.
- Cloudflare proof response behavior for `GET /admin/customers`.
- Cloudflare HTTP test-state bridge for Node-to-Worker Customer group state.

Validation:

- The original module-lane Admin Customer listing file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer/admin/list-customers.spec.ts --runInBand
```

Result: 1 suite passing, 4 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

- The test runner package build passed after changing its source:

```bash
yarn workspace @medusajs/test-utils build
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Move from Customer Admin route files into the Customer Group Admin route lane.

## Customer Group Admin Create Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer Group creation file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- No runtime change was needed in this slice. The Cloudflare proof runtime
  already covered `POST /admin/customer-groups` and returned the creator field
  expected by the existing assertion.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin Customer Group creation validation through
  `integration-tests-modules`.
- Cloudflare proof response behavior for `POST /admin/customer-groups`.

Validation:

- The original module-lane Admin Customer Group creation file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/create-customer-group.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Group Admin route lane with retrieve, update, delete,
  list, and batch customer membership files.

## Customer Group Admin Retrieve Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer Group retrieval file passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- No runtime change was needed in this slice. The previous Customer Group
  state-sync work already made Node-created groups visible to the Worker proof
  runtime.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin Customer Group retrieval validation through
  `integration-tests-modules`.
- Cloudflare proof response behavior for `GET /admin/customer-groups/:id`.

Validation:

- The original module-lane Admin Customer Group retrieval file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/retrieve-customer-group.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Group Admin route lane with update and delete files.

## Customer Group Admin Update Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer Group update file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- No runtime change was needed in this slice. The Cloudflare proof runtime
  already covered `POST /admin/customer-groups/:id` for Node-created groups
  synced into Worker state.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Admin Customer Group update validation through
  `integration-tests-modules`.
- Cloudflare proof response behavior for `POST /admin/customer-groups/:id`.

Validation:

- The original module-lane Admin Customer Group update file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/update-customer-group.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Group Admin route lane with delete and listing files.

## Customer Group Admin Delete Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer Group delete file now passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- `DELETE /admin/customer-groups/:id` returned `200`, but the Node-side
  Customer module still returned the group with `deleted_at: null`.
- The existing assertion retrieves the group from the Node module service with
  `withDeleted: true` after the Worker HTTP delete call.
- The real Medusa route uses `deleteCustomerGroupsWorkflow`, whose step calls
  `softDeleteCustomerGroups`.
- The test runner bridge now mirrors Worker admin customer-group deletes back
  into the Node Customer module with `softDeleteCustomerGroups([groupId])`.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now mirrors the admin customer-group
  delete workflow's soft-delete behavior into the Node module state used by the
  original assertion.

Affected boundary:

- Existing module-lane Admin Customer Group delete validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Worker-to-Node Customer Group state.

Validation:

- The original module-lane Admin Customer Group delete file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/delete-customer-group.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

- The test runner package build passed after changing its source:

```bash
yarn workspace @medusajs/test-utils build
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Group Admin route lane with list and batch customer
  membership files.

## Customer Group Admin List Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer Group listing file now passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing Cloudflare proof response already covered
  `GET /admin/customer-groups` count and `q` search behavior for groups
  created through the Node Customer module service and synced into the Worker
  proof state.

Affected boundary:

- Existing module-lane Admin Customer Group list validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for `GET /admin/customer-groups`.

Validation:

- The original module-lane Admin Customer Group list file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/list-customer-groups.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Group Admin route lane with batch customer membership
  files.

## Customer Group Admin List Customers Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer Group customer-listing file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing Cloudflare proof response already covered the original
  `GET /admin/customers?groups[]=...` assertion by syncing Node-created
  customer-group membership into Worker proof state.

Affected boundary:

- Existing module-lane Admin Customer Group customer-listing validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for group-filtered
  `GET /admin/customers`.

Validation:

- The original module-lane Admin Customer Group customer-listing file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/list-customer-group-customers.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Group Admin route lane with batch add/remove customer
  membership files.

## Customer Group Admin Batch Add Customers Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer Group batch-add file now passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- `POST /admin/customer-groups/:id/customers` returned `200`, but the
  Node-side Customer module still returned the group with zero related
  customers.
- The existing assertion retrieves the group from the Node module service after
  the Worker HTTP batch-add call.
- The test runner bridge now mirrors Worker admin customer-group customer
  additions back into the Node Customer module with `addCustomerToGroup`.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now mirrors the admin customer-group
  batch-add workflow effect into the Node module state used by the original
  assertion.

Affected boundary:

- Existing module-lane Admin Customer Group batch-add validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Worker-to-Node Customer Group
  membership state.

Validation:

- The original module-lane Admin Customer Group batch-add file first failed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/batch-add-customers.ts --runInBand
```

Result: expected 3 related customers, received 0.

- After the bridge fix, the same original file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/batch-add-customers.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- The test runner package build passed after changing its source:

```bash
yarn workspace @medusajs/test-utils build
```

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Customer Group Admin route lane with the batch-remove customer
  membership file.

## Customer Group Admin Batch Remove Customers Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Customer Group batch-remove file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- `POST /admin/customer-groups/:id/customers` with `remove` returned `200`,
  but the Node-side Customer module still returned the group with three related
  customers.
- The existing assertion retrieves the group from the Node module service after
  the Worker HTTP batch-remove call.
- The test runner bridge now mirrors Worker admin customer-group customer
  removals back into the Node Customer module with `removeCustomerFromGroup`.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now mirrors the admin customer-group
  batch-remove workflow effect into the Node module state used by the original
  assertion.

Affected boundary:

- Existing module-lane Admin Customer Group batch-remove validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Worker-to-Node Customer Group
  membership state.

Validation:

- The original module-lane Admin Customer Group batch-remove file first failed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/batch-remove-customers.ts --runInBand
```

Result: expected 0 related customers, received 3.

- After the bridge fix, the same original file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=customer-group/admin/batch-remove-customers.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- The test runner package build passed after changing its source:

```bash
yarn workspace @medusajs/test-utils build
```

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Select the next narrow original `integration-tests-modules` commerce spec and
  keep using the existing package `test:integration` script.

## Invite Admin Create Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Invite create file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing Cloudflare proof response already covered
  `POST /admin/invites` for the original create assertion.

Affected boundary:

- Existing module-lane Admin Invite create validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for `POST /admin/invites`.

Validation:

- The original module-lane Admin Invite create file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/create-invite.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Admin Invite route lane with list, retrieve, resend, delete, and
  accept invite files.

## Invite Admin List Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Invite list file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- `GET /admin/invites` returned `200`, but the Worker proof state did not
  include the invite created directly through the Node User module service.
- The response shape also returned `limit: 0` when the Worker-side invite list
  was empty, while the original assertion expects Medusa's default limit of
  `50`.
- The test runner bridge now mirrors Node-side `createInvites` calls into the
  Worker proof state through a dedicated `invites` proof-state channel, and the
  Worker invite list proof response returns `limit: 50`.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP proof-state bridge now supports Node-created User module
  invites for Worker HTTP list/retrieve-style assertions.
- The Worker proof response for `GET /admin/invites` now matches the original
  route's default list limit.

Affected boundary:

- Existing module-lane Admin Invite list validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof-state route and static proof-state service for invites.
- Test runner User module bridge for `createInvites`.

Validation:

- The original module-lane Admin Invite list file first failed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/list-invites.spec.ts --runInBand
```

Result: expected one invite and `limit: 50`, received no invites and
`limit: 0`.

- After the bridge fix, the same original file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/list-invites.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- The touched workspaces passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
```

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Admin Invite route lane with retrieve, resend, delete, and
  accept invite files.

## Invite Admin Retrieve Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Invite retrieve file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing invite proof-state channel covered Node-created invite retrieval
  through `GET /admin/invites/:id`.

Affected boundary:

- Existing module-lane Admin Invite retrieve validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for `GET /admin/invites/:id`.

Validation:

- The original module-lane Admin Invite retrieve file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/retrieve-invite.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Admin Invite route lane with resend, delete, and accept invite
  files.

## Invite Admin Resend Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Invite resend file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing invite proof-state channel covered Node-created invite resend
  through `POST /admin/invites/:id/resend`, including token rotation.

Affected boundary:

- Existing module-lane Admin Invite resend validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for
  `POST /admin/invites/:id/resend`.

Validation:

- The original module-lane Admin Invite resend file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/resend-invite.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Admin Invite route lane with delete and accept invite files.

## Invite Admin Delete Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Invite delete file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing invite proof-state channel covered Node-created invite deletion
  and follow-up not-found behavior through `DELETE /admin/invites/:id` and
  `GET /admin/invites/:id`.

Affected boundary:

- Existing module-lane Admin Invite delete validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for invite deletion and follow-up
  retrieval.

Validation:

- The original module-lane Admin Invite delete file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/delete-invite.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Admin Invite route lane with the accept-invite file.

## Invite Admin Accept Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Invite accept file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- Invalid invite token handling already returned the expected `401`.
- Accepting a Node-created invite failed with `401` for valid invite tokens.
- The Worker proof accept path only recognized static invite tokens containing
  an `invite_id` payload field, while the real User module signs invite tokens
  with payload `{ id, email }`.
- The Worker proof accept path now accepts both payload shapes, preserving
  invalid-token rejection while matching Medusa's real invite token format.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Worker proof response for `POST /admin/invites/accept` now accepts the
  real User module invite token payload shape.

Affected boundary:

- Existing module-lane Admin Invite accept validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for valid and invalid invite
  acceptance.

Validation:

- The original module-lane Admin Invite accept file first failed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/accept-invite.spec.ts --runInBand
```

Result: invalid token case passed, valid Node-created invite acceptance returned
`401`.

- After the token payload fix, the same original file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=invites/accept-invite.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Select the next narrow original `integration-tests-modules` spec outside the
  completed Admin Invite lane.

## Users Get-Me Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Users get-me file now passes through the Cloudflare
HTTP runtime using the existing `integration-tests-modules` `test:integration`
script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing Cloudflare proof response already covered
  `GET /admin/users/me` for the original current-user assertion.

Affected boundary:

- Existing module-lane Users get-me validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for `GET /admin/users/me`.

Validation:

- The original module-lane Users get-me file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=users/get-me.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue the Users route lane with the update-user file.

## Users Update Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Users update file now passes through the Cloudflare
HTTP runtime using the existing `integration-tests-modules` `test:integration`
script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing Cloudflare proof response already covered
  `POST /admin/users/:id` for the original user update assertion.

Affected boundary:

- Existing module-lane Users update validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for `POST /admin/users/:id`.

Validation:

- The original module-lane Users update file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=users/update-user.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Select the next compact original `integration-tests-modules` lane.

## Payment Providers Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Payment Providers file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The first run reached the HTTP assertion and failed with `404` for
  `GET /admin/payments/payment-providers`.
- The Cloudflare proof runtime did not yet expose the admin payment-provider
  list route used by the existing module integration assertion.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Worker proof response now covers `GET /admin/payments/payment-providers`
  and returns the two configured system payment providers expected by the
  unchanged module test.

Affected boundary:

- Existing module-lane Admin Payment Providers validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for
  `GET /admin/payments/payment-providers`.

Validation:

- The original module-lane Payment Providers file first failed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=payment/payment-providers.spec.ts --runInBand
```

Result: `GET /admin/payments/payment-providers` returned `404`.

- After adding the proof response, the same original file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=payment/payment-providers.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating compact original `integration-tests-modules` specs
  through the existing package `test:integration` runner.

## Store Admin Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Store file passes through the Cloudflare HTTP
runtime using the existing `integration-tests-modules` `test:integration`
script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing Cloudflare proof behavior already covered direct Store module
  creation/deletion plus Admin HTTP update/list assertions.

Affected boundary:

- Existing module-lane Admin Store validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for `POST /admin/stores/:id` and
  `GET /admin/stores`.

Validation:

- The original module-lane Admin Store file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=store/admin/store.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating compact original `integration-tests-modules` specs
  through the existing package `test:integration` runner.

## Tax Admin Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Tax file now passes through the Cloudflare HTTP
runtime using the existing `integration-tests-modules` `test:integration`
script.

Failed-first result:

- The first run had 9 failures and 2 passes.
- `GET /admin/tax-rates/:id` returned `404` because the Worker proof remote
  query path did not support the `tax_rate` entry point.
- Worker-created tax regions leaked proof-only fields and omitted the Admin
  Tax response shape expected by the original assertions.
- Node-created tax regions/rates were not mirrored into Worker proof state for
  Admin HTTP reads.
- Worker-created tax regions/rates/rules were not mirrored back into the Node
  Tax module for direct `service.listTaxRateRules` and `withDeleted`
  assertions.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Worker proof runtime now supports Admin Tax region/rate list, retrieve,
  create, update, delete, and tax-rate rule create/delete behavior required by
  the original module-lane file.
- The proof remote-query path now supports `tax_rate`.
- The Cloudflare HTTP test-state bridge now mirrors direct Node Tax module
  creates into Worker proof state, and mirrors Worker Tax HTTP mutations back
  into the Node Tax module.
- The bridge uses Tax soft-delete APIs when available so the original
  `withDeleted` assertions can observe deleted rows.

Affected boundary:

- Existing module-lane Admin Tax validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for `/admin/tax-regions`,
  `/admin/tax-rates`, and tax-rate rule endpoints.
- Cloudflare HTTP test-state bridge for Tax module regions, rates, and rules.

Validation:

- The original module-lane Admin Tax file first failed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=tax/admin/tax.spec.ts --runInBand
```

Result: 1 suite failed, 9 tests failed, 2 tests passed.

- After the Tax proof and bridge changes, the same original file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=tax/admin/tax.spec.ts --runInBand
```

Result: 1 suite passing, 11 tests passing.

- The touched test-utils package built successfully:

```bash
yarn workspace @medusajs/test-utils build
```

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating compact original `integration-tests-modules` specs
  through the existing package `test:integration` runner.

## Fulfillment Providers Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Fulfillment Providers file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.
- The existing Cloudflare proof behavior already covered
  `GET /admin/fulfillment-providers` for the configured manual providers.

Affected boundary:

- Existing module-lane Admin Fulfillment Providers validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof response behavior for
  `GET /admin/fulfillment-providers`.

Validation:

- The original module-lane Fulfillment Providers file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=fulfillment-providers/index.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing
  `src/worker.spec.ts` due to the existing Vite/Rolldown dependency
  optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating compact original `integration-tests-modules` specs
  through the existing package `test:integration` runner.

## Price Lists Admin Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Admin Price Lists file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The first run reached the real Price Lists assertions and failed because
  price lists created directly through the Node Pricing module were not mirrored
  into the Worker proof state.
- Worker-created price lists also needed to be mirrored back into the Node
  Pricing module so unchanged assertions that call `pricingModule.listPrices`
  can observe the same IDs returned by the Worker API.
- The existing proof route also lacked the
  `POST /admin/price-lists/:id/products` handler used by the original spec.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare test runner bridge now records product-variant to price-set
  links, mirrors Node-created price lists into Worker proof state, and mirrors
  Worker-created/deleted price lists into the real Node Pricing module.
- The Worker proof Price Lists routes now return Medusa-shaped price-list price
  fields, preserve list-level rules, support idempotent delete, validate missing
  create attributes with `400`, and handle product price removals.

Affected boundary:

- Existing module-lane Admin Price Lists validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof state bridge for Pricing module state.
- Worker proof routes for Admin Price Lists.

Validation:

- The original module-lane Price Lists Admin file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=price-lists/admin/price-lists.spec.ts --runInBand
```

Result: 1 suite passing, 11 tests passing, 1 upstream test skipped.

- The touched test-utils package built successfully:

```bash
yarn workspace @medusajs/test-utils build
```

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating compact original `integration-tests-modules` specs
  through the existing package `test:integration` runner.

## Event Bus Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Event Bus file now passes through the Cloudflare HTTP
runtime using the existing `integration-tests-modules` `test:integration`
script.

Failed-first result:

- The first run reached the real Event Bus assertion and failed because the
  project subscriber under `integration-tests/modules/src/subscribers` was not
  registered in the Cloudflare runner path.
- The Cloudflare runner loaded project workflows and jobs after
  `MedusaAppLoader.load()`, but it did not load project subscribers.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare test runner now loads project subscriber entrypoints through
  `SubscriberLoader` alongside workflow and job entrypoints.
- Node filesystem discovery remains the default Node runtime behavior; this
  change only fills the Cloudflare runner's static-entrypoint bootstrap path.

Affected boundary:

- Existing module-lane Event Bus validation through `integration-tests-modules`.
- Cloudflare test runner static project entrypoint bootstrap for subscribers.

Validation:

- The original module-lane Event Bus file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=event-bus/index.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- The touched test-utils package built successfully:

```bash
yarn workspace @medusajs/test-utils build
```

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating compact original `integration-tests-modules` specs
  through the existing package `test:integration` runner.

## Defaults Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Defaults integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane default data workflow validation through
  `integration-tests-modules`.
- Query graph visibility for the default store, sales channel, and publishable
  API key created during bootstrapping.

Validation:

- The original module-lane Defaults file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=defaults/defaults.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing
  package script, selecting the next narrow original spec.

## Notification Admin Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Notification Admin integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- The first run reached the configurable notification subscriber assertion and
  failed because the Cloudflare runner had no real Medusa core subscriber
  registered for `order.created`.
- The event bus log reported one subscriber, but that was the test wait wrapper
  installed by `TestEventUtils.waitSubscribersExecution`, not the original
  `configurable-notifications` subscriber.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare test runner now includes the Medusa core subscriber directory
  before plugin subscriber directories when loading subscriber entrypoints.
- The Node/Express runtime behavior is unchanged; this mirrors the normal
  Medusa loader behavior that loads `@medusajs/medusa` core subscribers from
  the package before plugin subscribers.

Affected boundary:

- Existing module-lane Notification Admin validation through
  `integration-tests-modules`.
- Cloudflare test runner static subscriber bootstrap for Medusa core
  subscribers.

Validation:

- The original module-lane Notification Admin file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=notification/admin/notification.spec.ts --runInBand
```

Result: 1 suite passing, 5 tests passing.

- The touched test-utils package built successfully:

```bash
yarn workspace @medusajs/test-utils build
```

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Store Currency Link Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Store Currency link integration file passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-module validation through
  `integration-tests-modules`.
- Remote query visibility across the Store module's supported currencies link
  and the Currency module's currency entity.

Validation:

- The original module-lane Store Currency link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/store-currency.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Cart Links Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Cart Links integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-module validation through
  `integration-tests-modules`.
- Remote query visibility across Cart links to Region, Customer, Sales Channel,
  and Payment Collection.

Validation:

- The original module-lane Cart Links file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/cart-links.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
- An initial parallel `check:http-proof-manifest` process failed during Yarn
  startup with `Array buffer allocation failed`; the same gate passed when
  rerun by itself, so this was not treated as a code failure.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Cart Region Link Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Cart Region link integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-module validation through
  `integration-tests-modules`.
- Remote query visibility across Cart and Region links in both directions.

Validation:

- The original module-lane Cart Region link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/cart-region.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Define Link Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Define Link integration file passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-definition validation through
  `integration-tests-modules`.
- `defineLink` joiner-config generation for default links, multi-part entity
  names, `deleteCascade`, explicit `isList`, and read-only list aliases.

Validation:

- The original module-lane Define Link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/define-link.spec.ts --runInBand
```

Result: 1 suite passing, 7 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Fulfillment Set Location Link Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Fulfillment Set Location link integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-module validation through
  `integration-tests-modules`.
- Remote query visibility from Stock Location to linked Fulfillment Sets.

Validation:

- The original module-lane Fulfillment Set Location link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/fulfillment-set-location.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Link Modules Index Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Link Modules index integration file passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-module validation through
  `integration-tests-modules`.
- Link migration planning, link creation, dismiss/soft-delete behavior, and
  recreate behavior for custom link definitions.

Validation:

- The original module-lane Link Modules index file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/index.ts --runInBand
```

Result: 1 suite passing, 4 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Product Variant Price Set Link Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Product Variant Price Set link integration file
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-module validation through
  `integration-tests-modules`.
- Remote query visibility from Product Variants to linked Price Sets,
  including price expansion and calculated price resolution.

Validation:

- The original module-lane Product Variant Price Set link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/product-variant-price-set.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Publishable Key Sales Channel Link Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Publishable Key Sales Channel link integration file
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-module validation through
  `integration-tests-modules`.
- Remote query visibility from publishable API keys to linked sales channels.

Validation:

- The original module-lane Publishable Key Sales Channel link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/publishable-key-sales-channel.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Region Payment Provider Link Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Region Payment Provider link integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-module validation through
  `integration-tests-modules`.
- Remote query visibility across Region and Payment Provider links in both
  directions, including unlinked default payment providers.

Validation:

- The original module-lane Region Payment Provider link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/region-payment-provider.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Sales Channel Location Link Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Sales Channel Location link integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-module validation through
  `integration-tests-modules`.
- Remote query visibility from stock locations to linked sales channels.

Validation:

- The original module-lane Sales Channel Location link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/sales-channel-location.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Shipping Option Price Set Link Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Shipping Option Price Set link integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane link-module validation through
  `integration-tests-modules`.
- Admin Stock Location proof routes used by the original test setup.
- Remote query visibility from shipping options to linked price sets, prices,
  and calculated prices.

Validation:

- The original module-lane Shipping Option Price Set link file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=link-modules/shipping-option-price-set.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Fulfillment Providers Admin List Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Fulfillment Providers admin integration file passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Fulfillment Providers validation through
  `integration-tests-modules`.
- Cloudflare proof Admin route behavior for listing registered fulfillment
  providers.

Validation:

- The original module-lane Fulfillment Providers file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=fulfillment-providers/index.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Fulfillment Admin Index Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Fulfillment admin index integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Failed-first result:

- The migration/backward-compatibility assertion passed, but six Admin
  fulfillment HTTP assertions failed.
- `POST /admin/fulfillments` and `POST /admin/fulfillments/:id/shipment`
  returned static proof `404` responses because the module-level fulfillment
  routes were not included in the Cloudflare proof route set.
- `POST /admin/fulfillments/:id/cancel` returned a Worker response but did not
  update the Node Fulfillment module state that the unchanged assertion reads
  through `service.retrieveFulfillment`.
- The already-shipped assertion required syncing Node-created fulfillment state
  into the Worker proof state before the HTTP request.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare proof HTTP runtime now includes module-level Admin fulfillment
  create, cancel, and shipment routes.
- The test-state bridge now syncs Node Fulfillment rows into the Worker before
  fulfillment action routes and mirrors successful Worker fulfillment action
  responses back into the Node Fulfillment module.

Affected boundary:

- Existing module-lane Fulfillment admin validation through
  `integration-tests-modules`.
- Cloudflare proof Admin route behavior for fulfillment create, cancel,
  shipment, not-found errors, and already-shipped errors.
- Cloudflare HTTP test-state bridge for Node-to-Worker and Worker-to-Node
  Fulfillment state.

Validation:

- The original module-lane Fulfillment admin index file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=fulfillment/index.spec.ts --runInBand
```

Result: 1 suite passing, 7 tests passing.

- Cloudflare app and changed package gates passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used `DB_TEMP_NAME=medusa_test_modules_fulfillment_index_cloudflare_clean`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Fulfillment Workflows Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Fulfillment workflow integration file passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime code changed in this slice.

Affected boundary:

- Existing module-lane Fulfillment workflow validation through
  `integration-tests-modules`.
- Workflow compensation behavior for create fulfillment, update fulfillment,
  and create shipment.
- Cloudflare HTTP runtime setup while workflow assertions execute against the
  original module service and core workflows.

Validation:

- The original module-lane Fulfillment workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=fulfillment/fulfillment.workflows.spec.ts --runInBand
```

Result: 1 suite passing, 4 tests passing.

- Cloudflare app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Index Search Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Index search integration file now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Failed-first result:

- The spec reached the real Index assertions, but the first two search cases
  failed their `fetchAndRetry` validation because indexed search returned no
  products for nested `product.variants.prices` filters.
- The Cloudflare Worker-created product response was already mirrored into the
  Node Product, Pricing, and remote-link modules, but the Node-side Index graph
  did not receive the complete post-link event set needed for the nested
  ProductVariant -> PriceSet -> Price relation graph.
- Diagnostic tracing showed that ProductVariantPriceSet link events were
  consumed by the Index provider, but the bridge was missing a post-link
  `pricing.price-set.created` event. Without the PriceSet index entry, nested
  price filtering could not traverse the full graph.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now mirrors the full post-link Index
  event set after `POST /admin/products`: Product, ProductVariant, PriceSet,
  ProductVariantPriceSet attach, and Price.
- The route and module services remain unchanged; this is synchronization
  between the Worker proof route response and the Node module/index state used
  by the original module integration assertions.

Affected boundary:

- Existing module-lane Index search validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for Admin product creation with variants
  and prices.
- Node-side Index module event consumption for nested product variant price
  search.

Validation:

- The original module-lane Index search file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=index/search.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace @medusajs/index build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Current blocker:

- `yarn workspace medusa-cloudflare test` still fails before executing Worker
  specs due to the existing Vite/Rolldown dependency optimization error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_index_search_cloudflare_priceset`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Order Get Detail Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Order get-detail workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime or proof-app code was changed for this slice; the existing
  Cloudflare bridge state is sufficient for this workflow's order-detail
  filtering assertions.

Affected boundary:

- Existing module-lane Order workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Order get-detail workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/get-order-detail.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_get_order_detail_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Order Credit Lines Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Order credit-lines workflow integration file now
passes through both the default Express runtime and the Cloudflare HTTP runtime
using the existing `integration-tests-modules` `test:integration` script.

Failed-first result:

- The first Cloudflare run timed out before Jest produced a result.
- A traced rerun showed startup and fixture synchronization completed, but the
  process remained alive after the credit-line workflow attempted to run.
- The same original spec also timed out under the default Express runtime,
  proving the initial hang was not Cloudflare-specific.
- After rebuilding `@medusajs/test-utils`, the original failure surfaced:
  `database.shutdown()` bounded the first connection destroy attempt but retried
  the same destroy calls without a timeout in its forced-cleanup catch block.
  That could leave the Jest process alive indefinitely after a cleanup failure.
- Once the cleanup hang was bounded, the real baseline Order failure surfaced:
  confirming order credit lines bumped the order version and attempted to
  recreate existing `OrderShipping` rows without the required `order_id`.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The shared test database shutdown helper now bounds the forced-cleanup retry
  path with `execOrTimeout` and `Promise.allSettled`, preventing cleanup errors
  from turning into unbounded Jest hangs.
- Order change application now preserves `order_id` when versioning existing
  order shipping rows during order-change confirmation. This keeps unrelated
  shipping state valid when the credit-line workflow bumps the order version.

Affected boundary:

- Existing module-lane Order workflow validation through
  `integration-tests-modules`.
- Shared Medusa test-runner database cleanup behavior.
- Order module order-change application for versioned shipping rows.

Validation:

- The original module-lane Order credit-lines workflow file passed under the
  default Express runtime:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/create-order-credit-lines.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

- The same original module-lane Order credit-lines workflow file passed under
  the Cloudflare HTTP runtime:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/create-order-credit-lines.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

- Changed package and Cloudflare app gates passed:

```bash
yarn workspace @medusajs/test-utils build
yarn workspace @medusajs/order build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
```

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing Express run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_credit_lines_express_built_fix`.
- The clean passing Cloudflare run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_credit_lines_cloudflare_built_fix`.
- The composed Worker import guard passed with 1380 bundled inputs after the
  order and test-utils changes.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Order Change Actions Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Order change-actions workflow integration file now
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order module behavior already satisfy the original
  action create/delete/update rollback assertions under the Cloudflare HTTP
  runtime.

Affected boundary:

- Existing module-lane Order workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Order change-actions workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/order-change-actions.ts --runInBand
```

Result: 1 suite passing, 6 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_change_actions_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next narrow original spec.

## Order Change Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Order change workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order module behavior already satisfy the original
  create/cancel/delete/decline order-change assertions and rollback checks
  under the Cloudflare HTTP runtime.

Affected boundary:

- Existing module-lane Order workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Order change workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/order-change.spec.ts --runInBand
```

Result: 1 suite passing, 8 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_order_change_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order lifecycle spec.

## Cancel Order Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Cancel Order workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order/fulfillment module behavior already satisfy the
  original fulfillment-aware order cancellation assertions under the Cloudflare
  HTTP runtime.

Affected boundary:

- Existing module-lane Order lifecycle workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Cancel Order workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/cancel-order.spec.ts --runInBand
```

Result: 1 suite passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_cancel_order_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order lifecycle spec.

## Create Fulfillment Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Create Fulfillment workflow integration file now
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order/fulfillment/inventory module behavior already
  satisfy the original fulfillment creation, cancellation, rollback,
  reservation release, stock quantity, and `created_by` assertions under the
  Cloudflare HTTP runtime.

Affected boundary:

- Existing module-lane Order lifecycle workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Create Fulfillment workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/create-fulfillment.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_create_fulfillment_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order lifecycle spec.

## Create Shipment Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Create Shipment workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order/fulfillment/inventory module behavior already
  satisfy the original shipment creation and inventory assertions under the
  Cloudflare HTTP runtime.

Affected boundary:

- Existing module-lane Order lifecycle workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Create Shipment workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/create-shipment.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_create_shipment_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order lifecycle spec.

## Return Items Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Return Items workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order/return module behavior already satisfy the
  original return item request and error-path assertions under the Cloudflare
  HTTP runtime.

Affected boundary:

- Existing module-lane Order return workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Return Items workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/return/items.spec.ts --runInBand
```

Result: 1 suite passing, 6 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_return_items_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order return lifecycle spec.

## Return Shipping Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Return Shipping workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order/return/fulfillment module behavior already
  satisfy the original return shipping, custom amount, and calculated shipping
  recalculation assertions under the Cloudflare HTTP runtime.

Affected boundary:

- Existing module-lane Order return workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Return Shipping workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/return/create-return-shipping.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_return_shipping_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order claim/exchange/return lifecycle
  spec.

## Begin Return Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Begin Return workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order/return module behavior already satisfies the
  original begin-return assertion under the Cloudflare HTTP runtime.

Affected boundary:

- Existing module-lane Order return workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Begin Return workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/begin-order-return.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_begin_return_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order claim/exchange/return lifecycle
  spec.

## Complete Return Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The original module-lane Complete Return workflow integration file now passes
through both the default runtime and the Cloudflare HTTP runtime using the
existing `integration-tests-modules` `test:integration` script.

Failed-first finding:

- The first Cloudflare run failed in the first assertion with
  `OrderShippingMethod with id: ordsm_... was not found`.
- The same failure reproduced without `MEDUSA_TEST_HTTP_RUNTIME=cloudflare`,
  so this was a baseline Order module workflow issue rather than a Cloudflare
  adapter issue.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- `createReturn` now keeps a newly created return shipping method in memory for
  shipping total calculation instead of immediately re-querying it by ID.
  Existing string IDs still use `retrieveOrderShippingMethod` with tax-line and
  adjustment relations.
- This avoids querying the database for a MikroORM unit-of-work entity that has
  been persisted but not flushed yet.

Affected boundary:

- Existing module-lane Order complete-return workflow validation through
  `integration-tests-modules`.
- Order module bundled return action shipping-method handling.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The Order module package built successfully:

```bash
yarn workspace @medusajs/order build
```

- The original module-lane Complete Return workflow file passed on the default
  runtime:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/create-complete-return.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

- The same original workflow file passed through the Cloudflare HTTP runtime:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/create-complete-return.spec.ts --runInBand
```

Result: 1 suite passing, 3 tests passing.

- The Cloudflare proof app gates passed:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare build
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:http-proof-manifest
```

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The final default runtime passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_complete_return_express_typed`.
- The final Cloudflare runtime passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_complete_return_cloudflare_typed`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order claim/exchange/return lifecycle
  spec.

## Begin Claim Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Begin Claim workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order/claim module behavior already satisfies the
  original begin-claim assertion under the Cloudflare HTTP runtime.

Affected boundary:

- Existing module-lane Order claim workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Begin Claim workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/begin-order-claim.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_begin_claim_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order claim/exchange lifecycle spec.

## Begin Exchange Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Begin Exchange workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order/exchange module behavior already satisfies the
  original begin-exchange assertion under the Cloudflare HTTP runtime.

Affected boundary:

- Existing module-lane Order exchange workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Begin Exchange workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/begin-order-exchange.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_begin_exchange_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order claim/exchange lifecycle spec.

## Claim Shipping Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Claim Shipping workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order/claim shipping module behavior already satisfies
  the original claim-shipping assertion under the Cloudflare HTTP runtime.

Affected boundary:

- Existing module-lane Order claim shipping workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Claim Shipping workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/claim/claim-shipping.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_claim_shipping_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original order exchange shipping lifecycle spec.

## Exchange Shipping Workflow Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Exchange Shipping workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- No runtime, module, or proof-app code was changed for this slice; the current
  workflow runtime and order/exchange shipping module behavior already
  satisfies the original exchange-shipping assertion under the Cloudflare HTTP
  runtime.

Affected boundary:

- Existing module-lane Order exchange shipping workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

- The original module-lane Exchange Shipping workflow file passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=order/workflows/exchange/exchange-shipping.spec.ts --runInBand
```

Result: 1 suite passing, 1 test passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_exchange_shipping_cloudflare_initial`.

Next step:

- Continue validating the next original `integration-tests-modules` area
  through the existing package script.

## Cart Store Workflows Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Cart store workflow integration file now passes
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Cloudflare HTTP test-state bridge now mirrors additional Worker-created
  setup records back into the Node-side module/query state used by original
  workflow assertions:
  - stock-location to sales-channel links,
  - price preferences,
  - shipping option rules,
  - store cart updates,
  - nested inventory item location levels,
  - reservation items.
- This remains test-runner bridge behavior only. It does not move commerce
  logic into `apps/medusa-cloudflare`.

Affected boundary:

- Existing module-lane Cart store workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.
- Test-only Cloudflare HTTP state bridge in `@medusajs/test-utils`.

Validation:

- Initial Cloudflare run exposed eight bridge mismatches in the original Cart
  workflow file:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.workflows.spec.ts --runInBand
```

Result before this slice: 44 tests passing, 8 tests failing.

- Default Express comparison for the same file exposed a separate baseline
  route-registration issue around `POST /admin/stock-locations`:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.workflows.spec.ts --runInBand
```

Result in this checkout: 41 tests passing, 11 tests failing. The failures were
not used to alter the original assertions.

- Focused Cloudflare checks passed while fixing the bridge:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.workflows.spec.ts --runInBand --testNamePattern="should add shipping method to cart$"
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.workflows.spec.ts --runInBand --testNamePattern="should throw error when shipping option is not valid|setShippingOptionsContext hook"
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.workflows.spec.ts --runInBand --testNamePattern="should list no shipping options for cart, if sales channel is not associated with location"
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.workflows.spec.ts --runInBand --testNamePattern="should throw if variants are out of stock"
```

- The clean full Cloudflare run passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/cart.workflows.spec.ts --runInBand
```

Result: 1 suite passing, 52 tests passing.

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing full run used
  `DB_TEMP_NAME=medusa_test_modules_cart_store_workflows_cloudflare_bridge_fix_final`.
- `yarn workspace @medusajs/test-utils build` passed.
- `yarn workspace medusa-cloudflare build` passed.
- `yarn workspace medusa-cloudflare check:imports` passed.
- `yarn workspace medusa-cloudflare check:http-proof-manifest` passed.
- `yarn workspace medusa-cloudflare typecheck` is still blocked by existing
  proof-app route graph issues in this checkout, primarily unresolved
  `@medusajs/framework/types` and `@medusajs/framework/utils` imports plus
  existing implicit-type errors. This blocker predates the Cart workflow bridge
  changes and is tracked here because it remains part of the app gate.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original Cart store API spec or Workflow Engine
  spec.

## Cart Store API Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Cart Store API integration file now passes through
the Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No new test script was added.
- No integration assertion was changed.
- The Worker HTTP proof now resolves linked price-set prices for cart line
  item creation instead of relying only on embedded variant prices.
- The Worker proof now mirrors Medusa cart create/update semantics needed by
  the original Store Carts API assertions:
  - guest/customer creation and customer transfer by email,
  - default store sales-channel assignment,
  - single-country region shipping-address defaulting,
  - cart metadata persistence,
  - explicit tax calculation for regions with `automatic_taxes: false`,
  - completed-cart mutation guards,
  - payment collection/session preconditions before completion,
  - payment authorization failure returning the original cart response shape.
- The Worker proof now tracks known Node-created cart IDs for payment
  collection idempotency and per-cart payment collection IDs.
- The HTTP proof route can now record directly created fulfillment sets, and
  the test bridge mirrors direct fulfillment-set setup into Worker state.
- The test bridge mirrors Worker-created cart customers into the Node-side
  customer module before creating or updating Node-side carts, normalizes cart
  address inputs, mirrors store updates, and tolerates duplicate product
  inventory-item setup for repeated cart tests.

Affected boundary:

- Existing module-lane Cart Store API validation through
  `integration-tests-modules`.
- Cloudflare HTTP proof resources in `apps/medusa-cloudflare`.
- Test-only Cloudflare HTTP state bridge in `@medusajs/test-utils`.

Validation:

- Initial Cloudflare run of the original Cart Store API spec exposed 22
  mismatches:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/carts.spec.ts --runInBand
```

Result before this slice: 9 tests passing, 22 tests failing.

- Focused checks passed while fixing the proof behavior:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/carts.spec.ts --runInBand --testNamePattern="should create a cart$"
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/carts.spec.ts --runInBand --testNamePattern="should create an order and create item reservations"
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/carts.spec.ts --runInBand --testNamePattern="customer from email|shipping address country code|default store sales channel|logged-in customer|publishable key"
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/carts.spec.ts --runInBand --testNamePattern="new payment collection|carts tax lines|shipping is not present|payment collection isn't created|fail to update cart|another guest customer|guest account|same email|keep the same customer|payment authorization fails"
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/carts.spec.ts --runInBand --testNamePattern="another guest customer|keep the same customer"
```

- The clean full Cloudflare run passed:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/carts.spec.ts --runInBand
```

Result: 1 suite passing, 31 tests passing.

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The clean passing full run used
  `DB_TEMP_NAME=medusa_test_modules_cart_store_carts_cloudflare_full_after_fixes`.
- `yarn workspace @medusajs/framework build` passed.
- `yarn workspace @medusajs/test-utils build` passed after building the local
  framework package.
- `yarn workspace medusa-cloudflare build` passed.
- `yarn workspace medusa-cloudflare check:imports` passed.
- `yarn workspace medusa-cloudflare check:http-proof-manifest` passed.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original store API or workflow spec.

## Final Full-Suite Cloudflare Proof

Implementation commit:

- This commit.

The existing `integration-tests-modules` package runner now completes the
module integration lane through the Cloudflare HTTP runtime with the original
Jest command path and unchanged module assertions.

Differences from original Medusa:

- No new test script was added.
- No module integration assertion was replaced with a fork-only assertion.
- The Cloudflare HTTP test-state bridge records cart completion from trusted
  workflow bridge input without re-running proof-side storefront payment
  validation. Public proof-side cart completion still validates by default.
- Cloudflare index partition replication waits use a longer default timeout
  because the Worker-backed proof runtime can be slower under the full serial
  module lane.
- The large index search integration file keeps its original 100 second Jest
  timeout for the default runtime and uses a 300 second timeout only when
  `MEDUSA_TEST_HTTP_RUNTIME=cloudflare`.
- The Cloudflare test runner health wait is configurable through
  `MEDUSA_TEST_CLOUDFLARE_HEALTH_TIMEOUT_MS` and defaults to 240 seconds for
  repeated workerd/Vite startups during long module runs.

Affected boundary:

- Existing module-lane integration validation through
  `integration-tests-modules`.
- Cloudflare HTTP test-state bridge for cart completion.
- Index replication wait helper used by the original Index integration tests.
- Cloudflare HTTP runtime startup in `@medusajs/test-utils`.

Failed-first proof attempts:

- A full Cloudflare run first failed in `cart/store/cart.completion.ts` because
  the bridge-side cart completion recorder re-ran payment validation after the
  real Medusa workflow had already created the order. The focused file passed
  after the trusted bridge path skipped proof-side validation.
- The next full run failed in `index/query-index.spec.ts` waiting 30 seconds
  for link entities to replicate into the index partition table. A focused
  rerun passed, and the Cloudflare default wait was raised to 120 seconds.
- The next full run failed in `index/search.spec.ts` because the largest
  indexed search case exceeded that file's 100 second Jest timeout under
  full-suite load. The focused file passed with the Cloudflare-only 300 second
  timeout.
- The next full run reached 66 passing suites before a late suite timed out
  waiting for a fresh Cloudflare HTTP runtime. The failed RBAC file passed in
  isolation, and the Cloudflare health wait was raised and made configurable.
- The next full run reached more than 80 passing suites before the Jest
  coordinator hit the default Node heap ceiling. The successful full proof uses
  `NODE_OPTIONS=--max-old-space-size=8192`.
- One later retry with the larger heap exposed a nondeterministic cart
  simultaneous payment/storefront race. The same cart completion file passed
  focused with the same heap setting, and the final full retry passed.

Validation:

```bash
NODE_OPTIONS=--max-old-space-size=8192 MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --runInBand
```

Result:

- Test suites: 101 passed, 1 skipped, 101 of 102 total.
- Tests: 352 passed, 5 skipped, 357 total.
- Runtime: 3955.567 seconds.

Validation note:

- The full proof used an isolated temporary PostgreSQL 18 cluster on
  `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_full_cloudflare_final_proof_node_8gb_retry`.
- The skipped suite is the existing Jest-skipped
  `price-lists/store/get-product.ts`; it is listed by Jest but remains skipped
  by the original test file.

Next step:

- Treat the current module integration lane as fully proven for the Cloudflare
  HTTP runtime. Future module work should avoid re-running already covered
  groups unless the touched code changes that boundary.

## Workflow Engine Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Workflow Engine directory now passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script. This consolidates the two Workflow Engine specs that
are detailed in `plan/fork-changes/workflow-engine.md`.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The previous Workflow Engine API proof coverage was sufficient for the
  combined directory selector.

Affected boundary:

- Existing module-lane Workflow Engine validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=workflow-engine --runInBand
```

Result: 2 suites passing, 6 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_workflow_engine_dir_cloudflare_clean`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script. Use grouped selectors only when they execute original specs without
  creating new runner scripts or replacement assertions.

## Payment Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane payment selector passes through the Cloudflare HTTP
runtime using the existing `integration-tests-modules` `test:integration`
script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector reused the existing Jest path matching behavior. It
  matched the two payment specs and the existing
  `link-modules/region-payment-provider.spec.ts` file because that path also
  contains `payment`.

Affected boundary:

- Existing module-lane Payment validation through `integration-tests-modules`.
- Existing module-lane Region Payment Provider link validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=payment --runInBand
```

Result: 3 suites passing, 8 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_payment_dir_cloudflare_initial`.

Next step:

- Continue validating grouped original module selectors through the existing
  package script, watching for substring matches in Jest path patterns.

## Users Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Admin Users directory passes through the Cloudflare
HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The initial grouped selector `--testPathPattern=users` was too broad on
  Windows because every absolute test path starts with `C:\Users\...`; it
  matched the entire module test tree and timed out before useful output.
- The passing run used the path-specific selector `__tests__/users/`, which
  matched only the two original Users spec files.

Affected boundary:

- Existing module-lane Admin Users validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/users/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/users/ --runInBand
```

Results:

- List-tests matched only:
  - `users/update-user.spec.ts`
  - `users/get-me.spec.ts`
- Cloudflare run: 2 suites passing, 2 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_users_dir_cloudflare_corrected`.

Next step:

- Continue grouped original selectors with path-specific patterns under
  `__tests__/.../` when the directory name could match the Windows absolute
  path or other unrelated paths.

## Invites Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Admin Invites directory passes through the Cloudflare
HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern `__tests__/invites/` to
  avoid accidental Windows absolute-path matches.

Affected boundary:

- Existing module-lane Admin Invites validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/invites/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/invites/ --runInBand
```

Results:

- List-tests matched the six original invite specs.
- Cloudflare run: 6 suites passing, 8 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_invites_dir_cloudflare_initial`.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Notification Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Notification directory passes through the Cloudflare
HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern
  `__tests__/notification/`.

Affected boundary:

- Existing module-lane Notification API and configurable subscriber validation
  through `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/notification/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/notification/ --runInBand
```

Results:

- List-tests matched 1 original notification integration file.
- Cloudflare run: 1 suite passing, 5 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_notification_dir_cloudflare_initial`.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Order Workflows Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Order Workflows directory passes through the
Cloudflare HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern
  `__tests__/order/workflows/`.

Affected boundary:

- Existing module-lane Order workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/order/workflows/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/order/workflows/ --runInBand
```

Results:

- List-tests matched 15 original order workflow integration files.
- Cloudflare run: 15 suites passing, 41 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_order_workflows_dir_cloudflare_initial`.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Product Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Product directory passes through the Cloudflare HTTP
runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern `__tests__/product/`.

Affected boundary:

- Existing module-lane Admin Product API and Product workflow validation
  through `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/product/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/product/ --runInBand
```

Results:

- List-tests matched 4 original product integration files.
- Cloudflare run: 4 suites passing, 9 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_product_dir_cloudflare_initial`.
- Under the managed sandbox, the existing Yarn runner required escalation to
  read Corepack's installed Yarn cache under `AppData`.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Index Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Index directory passes through the Cloudflare HTTP
runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern `__tests__/index/`.

Affected boundary:

- Existing module-lane Index query, sync, and search validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/index/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/index/ --runInBand
```

Results:

- List-tests matched 3 original index integration files.
- Cloudflare run: 3 suites passing, 10 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_index_dir_cloudflare_initial`.
- Under the managed sandbox, the first Yarn run was blocked by read access to
  Corepack's cache under `AppData`; rerunning the same existing Yarn command
  with escalation allowed the runner to read the installed Yarn cache.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Fulfillment Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Fulfillment directory passes through the Cloudflare
HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern `__tests__/fulfillment/`.

Affected boundary:

- Existing module-lane Fulfillment API and workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/fulfillment/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/fulfillment/ --runInBand
```

Results:

- List-tests matched 2 original fulfillment integration files.
- Cloudflare run: 2 suites passing, 11 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_fulfillment_dir_cloudflare_initial`.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Tax Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Tax directory passes through the Cloudflare HTTP
runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern `__tests__/tax/`.

Affected boundary:

- Existing module-lane Admin Tax API and Tax workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/tax/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/tax/ --runInBand
```

Results:

- List-tests matched 2 original tax integration files.
- Cloudflare run: 2 suites passing, 13 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_tax_dir_cloudflare_initial`.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Regions Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Regions directory passes through the Cloudflare HTTP
runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern `__tests__/regions/`.

Affected boundary:

- Existing module-lane Admin Region API and Region workflow validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/regions/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/regions/ --runInBand
```

Results:

- List-tests matched 3 original regions integration files.
- Cloudflare run: 3 suites passing, 14 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_regions_dir_cloudflare_initial`.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Link Modules Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Link Modules directory passes through the Cloudflare
HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern
  `__tests__/link-modules/`.

Affected boundary:

- Existing module-lane Link Modules validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/link-modules/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/link-modules/ --runInBand
```

Results:

- List-tests matched 11 original link-modules integration files.
- Cloudflare run: 11 suites passing, 20 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_link_modules_dir_cloudflare_initial`.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Customer Group Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Customer Group directory passes through the Cloudflare
HTTP runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern
  `__tests__/customer-group/`.

Affected boundary:

- Existing module-lane Admin Customer Group validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/customer-group/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/customer-group/ --runInBand
```

Results:

- List-tests matched 8 original customer-group integration files.
- Cloudflare run: 8 suites passing, 9 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_customer_group_dir_cloudflare_initial`.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Customer Directory Cloudflare Revalidation

Validation commit:

- This commit.

The original module-lane Customer directory passes through the Cloudflare HTTP
runtime using the existing `integration-tests-modules`
`test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The grouped selector used the path-specific pattern `__tests__/customer/`.

Affected boundary:

- Existing module-lane Admin and Store Customer validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/customer/ --runInBand --listTests
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=__tests__/customer/ --runInBand
```

Results:

- List-tests matched 14 original customer integration files.
- Cloudflare run: 14 suites passing, 24 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_customer_dir_cloudflare_initial`.

Next step:

- Continue grouped original selectors with path-specific patterns through the
  existing package script.

## Common Workflow Compensation Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane common workflow compensation integration file now
passes through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The existing Cloudflare HTTP test bridge and remote-link behavior were
  sufficient for create/update/dismiss link workflow compensation assertions.

Affected boundary:

- Existing module-lane common workflow validation through
  `integration-tests-modules`.
- Link workflow compensation behavior with product variant inventory links.

Validation:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=common/workflows.spec.ts --runInBand
```

Result: 1 suite passing, 5 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_common_workflows_cloudflare_initial`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original store API, workflow, or module spec.

## Fulfillment Index Fresh Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Fulfillment index integration file was revalidated
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- Existing fulfillment proof and bridge behavior remains sufficient for the
  migration compatibility, fulfillment creation, cancellation, and shipment
  assertions in this file.

Affected boundary:

- Existing module-lane Fulfillment index validation through
  `integration-tests-modules`.
- Admin fulfillment APIs and direct fulfillment module setup.

Validation:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=fulfillment/index.spec.ts --runInBand
```

Result: 1 suite passing, 7 tests passing.

Validation note:

- The module integration run used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- The passing run used
  `DB_TEMP_NAME=medusa_test_modules_fulfillment_index_cloudflare_recheck`.

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original API, workflow, or module spec.

## Cart Promotion Store API Cloudflare Revalidation

Implementation commit:

- This commit.

The unchanged module-lane Cart promotion Store API integration files now pass
through the Cloudflare HTTP runtime using the existing
`integration-tests-modules` `test:integration` script.

Differences from original Medusa:

- No source change was required in this slice.
- No new test script was added.
- No integration assertion was changed.
- The previously implemented Cart Store API proof behavior was sufficient for
  adding and removing promotion adjustments on line items and shipping methods.

Affected boundary:

- Existing module-lane Cart promotion Store API validation through
  `integration-tests-modules`.
- Cloudflare HTTP runtime startup underneath the unchanged Medusa module test
  runner.

Validation:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/add-promotions-to-cart.spec.ts --runInBand
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --testPathPattern=cart/store/remove-promotions-from-cart.spec.ts --runInBand
```

Results:

- `add-promotions-to-cart.spec.ts`: 1 suite passing, 3 tests passing.
- `remove-promotions-from-cart.spec.ts`: 1 suite passing, 2 tests passing.

Validation note:

- The module integration runs used an isolated temporary PostgreSQL 18 cluster
  on `127.0.0.1:55534` with trust auth and `PGCLIENTENCODING=UTF8`.
- Passing run DB names:
  - `medusa_test_modules_cart_store_add_promotions_cloudflare_initial`
  - `medusa_test_modules_cart_store_remove_promotions_cloudflare_initial`

Next step:

- Continue validating `integration-tests-modules` through the existing package
  script, selecting the next original store API or workflow spec.
