# HTTP Static Manifest Migration Goal

Created in:

- `113d1993ec Track HTTP static manifest migration goal`

## Goal

Move HTTP route ownership out of the app-owned Cloudflare proof manifest and
into package-owned Medusa static manifests, while preserving the real Medusa
route handlers, middleware, feature-flag behavior, workflow calls, and
validation gates.

This goal exists to make `apps/medusa-cloudflare` a thin composition root. The
app may select Cloudflare bindings and merge manifests, but it should not own
Medusa route discovery, route lists, middleware ownership, services, workflows,
or bootstrap behavior.

## Stop Condition

Stop this route-ownership migration when all currently app-owned route groups
in `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` are one of:

- `Moved`: listed in a package-owned Medusa static manifest, regenerated,
  covered by an appropriate smoke or integration gate, and removed from the
  app-owned proof generator.
- `Deferred`: intentionally left out with a documented reason, owner boundary,
  and the runtime work required before moving it.

When there are no `Pending` rows left, switch effort to the HTTP
adapter/runtime boundary instead of continuing route-list churn.

## Active Tracking Contract

This is the active implementation goal for the HTTP route-ownership phase.
The stopping ledger is the table in this file, not the app proof generator
alone. A route group is not considered complete until the checklist row,
runtime behavior record, validation result, and commit hash are all recorded.

At the start of each implementation turn:

1. Pick one `Pending` route group unless the user explicitly asks for planning
   or review only.
2. Move that group through package-owned static manifest ownership, or mark it
   `Deferred` with the concrete runtime blocker.
3. Do not rerun or re-document already `Moved` groups unless the current slice
   changed their code, manifest entry, middleware behavior, or validation
   assumptions.

At the end of each completed route slice:

1. Update `Current Count`.
2. Change the touched row from `Pending` to `Moved` or `Deferred`.
3. Record the implementation commit hash in the touched row.
4. Record the behavioral difference and validation in
   `runtime-bootstrap-and-http.md`.
5. Record the next route-ownership step in
   `../cloudflare-port-refactor-plan.md`.

## Progress Rule

After each implementation turn:

1. Update exactly the rows touched in this file.
2. Record the implementation commit hash.
3. Update `runtime-bootstrap-and-http.md` with the behavioral difference from
   original Medusa.
4. Update `cloudflare-port-refactor-plan.md` if the sequence or next step
   changed.
5. Keep the validation commands specific to the route group touched.

## Current Count

- Package-owned groups moved or already package-owned: 40.
- App-owned groups still pending: 0.
- Total tracked logical groups in this goal: 40.

## Package-Owned At Goal Creation

| Status | Group | Package manifest | Implementation commit |
| --- | --- | --- | --- |
| Moved | Admin currencies | `packages/medusa/static-http-manifests/store-admin.json` | recorded in `runtime-bootstrap-and-http.md` |
| Moved | Store currencies | `packages/medusa/static-http-manifests/store-admin.json` | recorded in `runtime-bootstrap-and-http.md` |
| Moved | Store product tags | `packages/medusa/static-http-manifests/store-admin.json` | `1b27116222` |
| Moved | Store product types | `packages/medusa/static-http-manifests/store-admin.json` | `5e9832e146` |
| Moved | Store collections | `packages/medusa/static-http-manifests/store-admin.json` | `877aaaba66` |
| Moved | Store regions | `packages/medusa/static-http-manifests/store-admin.json` | `4fc76f1142` |
| Moved | Store payment providers | `packages/medusa/static-http-manifests/store-admin.json` | `6322c01c37` |
| Moved | Store products | `packages/medusa/static-http-manifests/store-admin.json` | `41a7d9e3df` |
| Moved | Store product variants | `packages/medusa/static-http-manifests/store-admin.json` | `a4f0c863dc` |
| Moved | Store locales | `packages/medusa/static-http-manifests/store-admin.json` | `320e061ae8` |
| Moved | Store shipping options | `packages/medusa/static-http-manifests/store-admin.json` | `0f1f2a6c6b` |

## Remaining App-Owned Groups

These groups were still owned by
`apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` when this
goal document was created. Change rows from `Pending` to `Moved` or `Deferred`
as route ownership changes.

| Status | Group | Current app-owned source | Notes | Commit |
| --- | --- | --- | --- | --- |
| Moved | Admin plugins and feature flags | `adminRouteFolders` | Package-owned manifest now lists both routes; app proof generator no longer scans this group. | `75a4675c6d` |
| Moved | Store carts | `cartRouteFiles` | Package-owned manifest now lists the cart routes and middleware; app proof generator now emits no Medusa-owned route entries. | `b8a38b2dcd` |
| Moved | Admin collections | `adminCollectionRouteFiles` | Package-owned manifest now lists list/retrieve/product-link routes and middleware; app proof generator no longer scans this group. | `6377bb0add` |
| Moved | Admin regions | `adminRegionRouteFiles` | Package-owned manifest now lists list/retrieve routes and middleware; app proof generator no longer scans this group. | `87704c1440` |
| Moved | Admin promotions | `adminPromotionRouteFiles` | Package-owned manifest now lists the promotion create/list route and middleware; app proof generator no longer scans this group. | `88b8bb97e5` |
| Moved | Admin price preferences | `adminPricePreferenceRouteFiles` | Package-owned manifest now lists list/retrieve routes and middleware; app proof generator no longer scans this group. | `a58462ad86` |
| Moved | Admin tax regions | `adminTaxRegionRouteFolders` | Package-owned manifest now lists list/retrieve routes and middleware; app proof generator no longer scans this group. | `d94b84148e` |
| Moved | Admin shipping option types | `adminShippingOptionTypeRouteFolders` | Package-owned manifest now lists list/retrieve routes and middleware; app proof generator no longer scans this group. | `445ee5c0b6` |
| Moved | Admin shipping options | `adminShippingOptionRouteFolders` | Package-owned manifest now lists the scanned shipping option routes and middleware; app proof generator no longer scans this group. | `e0bd3015a5` |
| Moved | Admin shipping profiles | `adminShippingProfileRouteFolders` | Package-owned manifest now lists list/retrieve routes and middleware; app proof generator no longer scans this group. | `8cddeab413` |
| Moved | Admin fulfillment providers | `adminFulfillmentProviderRouteFiles` | Package-owned manifest now lists the provider list route and middleware; app proof generator no longer scans this group. | `8f20d3d8ff` |
| Moved | Admin fulfillment sets | `adminFulfillmentSetRouteFolders` | Package-owned manifest now lists fulfillment-set and service-zone routes plus middleware; app proof generator no longer scans this group. | `b9778a542d` |
| Moved | Admin stock locations | `adminStockLocationRouteFiles` | Package-owned manifest now lists list/retrieve/link routes and middleware; app proof generator no longer scans this group. | `a0b0d3bd90` |
| Moved | Admin products | `adminProductRouteFiles` | Package-owned manifest now lists the app-owned product routes and middleware; app proof generator no longer scans this group. | `b9bb22f9fc` |
| Moved | Admin inventory | `adminInventoryRouteFiles` | Package-owned manifest now lists inventory item and per-item location-level routes plus middleware; app proof generator no longer scans this group. | `37339eedad` |
| Moved | Admin reservations | `adminReservationRouteFiles` | Package-owned manifest now lists list/retrieve routes and middleware; app proof generator no longer scans this group. | `7e00e5a719` |
| Moved | Admin translations batch | `adminTranslationRouteFiles` | Package-owned manifest now lists the feature-flagged batch route and middleware; app proof generator no longer scans this group. | `2111498a2e` |
| Moved | Admin locales | `adminLocaleRouteFiles` | Package-owned manifest now lists feature-flagged locale list/retrieve routes and middleware; app proof generator no longer scans this group. | `8e43da3078` |
| Moved | Admin product tags | `adminProductTagRouteFiles` | Package-owned manifest now lists the route and middleware; app proof generator no longer scans this group. | `bdf646dd8b` |
| Moved | Admin product types | `adminProductTypeRouteFolders` | Package-owned manifest now lists list/retrieve routes and middleware; app proof generator no longer scans this group. | `1928a2252f` |
| Moved | Admin product categories | `adminProductCategoryRouteFolders` | Package-owned manifest now lists list/retrieve/product-link routes and middleware; app proof generator no longer scans this group. | `720ef3f74b` |
| Moved | Admin refund reasons | `adminRefundReasonRouteFolders` | Package-owned manifest now lists list/retrieve routes and middleware; app proof generator no longer scans this group. | `69e1cfa9ee` |
| Moved | Admin stores | `adminStoreRouteFiles` | Package-owned manifest now lists list/retrieve routes and middleware; app proof generator no longer scans this group. | `2bb555b8df` |
| Moved | Admin sales channels | `adminSalesChannelRouteFiles` | Package-owned manifest now lists list/retrieve/product-link routes and middleware; app proof generator no longer scans this group. | `67d45fd3b4` |
| Moved | Admin API keys | `adminApiKeyRouteFiles` | Package-owned manifest now lists list/retrieve/revoke/sales-channel routes and middleware; app proof generator no longer scans this group. | `8c940d966c` |
| Moved | Auth | `authRouteFiles` | Package-owned manifest now lists dynamic auth provider routes and middleware; app proof generator no longer scans this group. | `13ea2356fe` |
| Moved | Store customers | `storeCustomerRouteFiles` | Package-owned manifest now lists customer account routes and middleware; app proof generator no longer scans this group. | `7bd87d25a7` |

## Recommended Order

1. Move small admin read/config route groups first:
   Admin plugins and feature flags, Admin stores, Admin product tags, Admin
   product types.
2. Then move medium admin commerce metadata groups:
   Admin collections, regions, sales channels, price preferences, refund
   reasons.
3. Then move fulfillment, inventory, and tax groups:
   Shipping profiles, shipping option types, fulfillment providers, fulfillment
   sets, stock locations, inventory, reservations, tax regions.
4. Complete. No app-owned route groups remain in this migration goal.

The route-ownership migration is complete. Further HTTP work should move to
the shared HTTP adapter/runtime boundary instead of continuing route-list
churn.

## Post-Goal Additions

| Status | Group | Package manifest | Notes | Commit |
| --- | --- | --- | --- | --- |
| Moved | Admin workflow subscriptions | `packages/medusa/static-http-manifests/store-admin.json` | Added after the original route-list migration because the Fetch adapter gained SSE support. The real subscription handlers now run through the static manifest; proof-only workflow setup endpoints remain app-owned. | This commit |
| Moved | Admin Index | `packages/medusa/static-http-manifests/store-admin.json` | Added after the original route-list migration because the real Index feature flag and auth middleware can now execute in the Fetch proof runtime. The real details and sync handlers now run through the static manifest; the app supplies only a proof index service and query fixture. | This commit |
| Moved | Admin workflow execution reads | `packages/medusa/static-http-manifests/store-admin.json` | Added after the original route-list migration because the real read handlers can now execute against a Worker-safe workflow execution remote-query fixture. The proof setup still owns workflow execution mutation endpoints. | `ec9d2c37d9` |
| Moved | Admin workflow execution run | `packages/medusa/static-http-manifests/store-admin.json` | First workflow execution mutation route moved after adding Worker-safe proof `IWorkflowEngineService.run(...)` behavior. Step success/failure endpoints remain app-owned until their service methods are supported. | `c37f2cb984` |
| Moved | Admin workflow execution step success | `packages/medusa/static-http-manifests/store-admin.json` | Added after the proof Workflow Engine service gained `setStepSuccess(...)` support. Step failure remains app-owned until `setStepFailure(...)` is supported separately. | `16018e93c9` |
| Moved | Admin workflow execution step failure | `packages/medusa/static-http-manifests/store-admin.json` | Added after the proof Workflow Engine service gained `setStepFailure(...)` support. The workflow execution Admin route group is now fully package-owned for the current proof surface. | `c606fe1dfa` |
| Moved | Admin Users reads | `packages/medusa/static-http-manifests/store-admin.json` | Added after the Admin Users middleware import was made portable and the proof runtime gained a `user` remote-query fixture. Retrieve-by-id, mutations, and roles remain app-owned until moved separately. | `e921934cbe` |
| Moved | Admin Users retrieve-by-id | `packages/medusa/static-http-manifests/store-admin.json` | Added as a method-specific static manifest entry that imports a portable `GET` helper for `/admin/users/:id`. The normal Medusa `route.ts` still exports all methods for Node/Express, while Worker static bootstrap avoids pulling mutation-only core-flows into the bundle graph. Mutations and roles remain app-owned until moved separately. | `84d9e35197` |
| Moved | Admin Users roles read | `packages/medusa/static-http-manifests/store-admin.json` | Added as a method-specific static manifest entry that imports a portable `GET` helper for `/admin/users/:id/roles`. The normal Medusa roles `route.ts` still exports all methods for Node/Express, while Worker static bootstrap avoids pulling role mutation workflows into the bundle graph. Role assign/remove paths remain app-owned until moved separately. | `357f927abe` |
| Moved | Admin Users role assignment | `packages/medusa/static-http-manifests/store-admin.json` | Added as a method-specific static manifest entry that imports a portable `POST` helper for `/admin/users/:id/roles`. The helper preserves the real Medusa workflow call while passing the request container through the workflow run options so the Worker proof runtime can execute the existing role-assignment workflow without app-side route reimplementation. Role removal paths remain app-owned until moved separately. | `4c200ba1a4` |
| Moved | Admin Users role removal | `packages/medusa/static-http-manifests/store-admin.json` | Added method-specific static manifest entries for `DELETE /admin/users/:id/roles` and `DELETE /admin/users/:id/roles/:role_id`. The helpers preserve the real Medusa role-removal workflow while passing the request container through workflow run options, and the proof setup no longer intercepts either removal path. User update/delete paths remain app-owned until moved separately. | `23a55a2127` |
| Moved | Admin Users update | `packages/medusa/static-http-manifests/store-admin.json` | Added a method-specific static manifest entry for `POST /admin/users/:id`. The helper preserves the real Medusa user-update workflow and response contract, while the proof runtime supplies a Worker-safe user module service and no longer intercepts the update path. User delete remains app-owned until moved separately. | `3b4b5af33f` |
| Moved | Admin Users delete | `packages/medusa/static-http-manifests/store-admin.json` | Added a method-specific static manifest entry for `DELETE /admin/users/:id`. The helper preserves the real Medusa remove-user-account workflow and response contract, while the proof runtime supplies Worker-safe user soft-delete, auth metadata update, link cascade, and remote-query fixtures and no longer intercepts the delete path. | `71aafe9079` |

## Validation Baseline

Every moved route group should run the relevant subset of:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Add narrower route-specific smoke assertions when the group introduces a new
behavior class, such as auth, feature flags, workflow calls, file uploads,
provider calls, or link-table mutations.
