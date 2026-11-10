# Private Medusa HTTP

## Store Currency reads

This package serves `GET /store/currencies` and `GET /store/currencies/:code`.
The pinned Medusa handlers use their original route middleware, validators,
field selection and response envelopes. The Store namespace supplies CORS,
publishable-key validation, locale handling and optional customer authentication.

`createStoreCurrencyHttpHandler` takes the Store origin policy and a factory
that creates a scope for each request. Register the Currency `remoteQuery`,
the publishable-key and Sales Channel `query.graph`, and a logger. A trusted
host can supply a verified customer identity or a server-backed session.

Use `makeStoreCurrencyEffectHttpHandler` from `@flarex/medusa-http/effect` to
mount the namespace in a scoped Effect HTTP host. Closing its scope releases
the Web handler.

The build-time manifest lives in `static-manifest.json`. Run `pnpm generate`
after changing its route or middleware entries. Run `pnpm check:generated`
to verify the checked-in static imports against the framework renderer.

## Private Admin Products

`@flarex/medusa-http/admin-product` exports `createAdminProductHttpHandler` for
the selected pinned `POST /admin/products`, `GET /admin/products`,
`GET /admin/products/:id`, and `POST /admin/products/:id` handlers. The matching scoped Effect
namespace host is `@flarex/medusa-http/admin-product-effect`. The native manifest
renderer builds the separate Admin Product manifest.

The route requires a trusted host principal resolver, native `user`
authentication and an injected evaluator for all three pinned creation policies:
Product, Inventory Item and Price. An executor credential or an unverified token
payload grants no admin access. This profile does not provide general RBAC or
every native authentication method.

The actual graph owner supplies `admitProductRefetchFields`, which validates
the complete response projection without reading storage before creation or
update. Both operations accept native default fields, including variant prices,
or an explicit supported selection. Native body validation and the existing
Product workflows retain their own input rules and bounded support; title-only
creation does not satisfy the native option rule.

The handler awaits the native `create-products` workflow, then independently
refetches through native `query.graph`. A later refetch failure cannot undo the
already committed workflow. This layer does not retry creation.

The detail POST retains the pinned existence check, `update-products` selector
and update input, and subsequent independent graph refetch. It inherits the
native `/admin/products/*` Product read policy; this promotion does not introduce
a different authorization rule. The existing bounded update workflow owns
Product reconciliation, variant pricing and supported relationship changes.
Inventory links remain intact when an existing variant's price is changed.
Unsupported update inputs refuse before mutation, and a later response-refetch
failure cannot undo an already committed update. This layer does not retry it.

Both reads require a verified native user and the native Product read policy.
The detail route returns the native `Product not found` response when the graph
contains no Product. The list route retains the pinned validators, default limit
of 50, offset, count metadata, and price response remapping. The graph
owner admits projections and relationships, including pricing and inventory
links; a selected HTTP route does not enable arbitrary graph entry points.

The Core profile admits ID, handle, title, status, collection/type, category and
variant-option selectors, free-text search, and the native Sales Channel filter.
Ordering supports ID, handle, title and status. Timestamp ordering returns
HTTP 400 under the current relational-read profile.
Expanded pages must fit the existing Link planner's 128-source/target bounds.
Unsupported selector/operator combinations return HTTP 400.

The pinned Price List filter middleware retains its remote-query dependency;
`price_list_id` returns HTTP 400 until the Pricing read profile is extended.
The native `index_engine` flag retains its alternate query dispatch and the
private profile refuses the unsupported index service.
