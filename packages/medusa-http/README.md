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
`GET /admin/products/:id`, `POST /admin/products/:id`, and
`DELETE /admin/products/:id` handlers. The matching scoped Effect
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

The detail DELETE retains the pinned inherited Product read policy and explicit
Product delete policy, native query validation and `delete-products` workflow.
It returns the native `{ id, object: "product", deleted: true }` envelope without
an existence prefetch or response refetch. Missing and already-deleted IDs keep
native success behavior. The existing deletion workflow owns soft deletion,
Pricing and Link cleanup, and exclusive managed Inventory ownership checks;
shared Inventory records remain subject to those native rules. The same Core
source identities and atomic settlement owner serve creation, update and deletion.

The same namespace also serves `GET /admin/products/:id/variants`,
`GET /admin/products/:id/variants/:variant_id`, and
`POST /admin/products/:id/variants`. The pinned handlers retain native query
defaults, field/price remapping, pagination/counts and Product ownership filters.
Collection creation runs `create-product-variants` and independently refetches
the parent Product, with response fields admitted before mutation. The inherited
Product read policy applies to every route; detail reads add Product Variant
read and creation adds Product Variant create. A missing or wrong-parent detail
retains the pinned HTTP 200 empty-object response.

`POST /admin/products/:id/variants/:variant_id` runs native
`update-product-variants` with both the Variant ID and Product ID in its
selector, then independently refetches the parent Product. Response fields are
admitted before mutation. It inherits Product read and Product Variant read
policies from the pinned middleware. A wrong-parent selector updates nothing
and returns the unchanged URL parent. The existing workflow owns price updates
and Inventory Link dismissal when inventory management is disabled; it retains
other variants' links. A later refetch failure does not undo the committed
workflow, and the HTTP layer does not retry it.
The bounded selector-update profile refuses a body `id` with HTTP 400 before
durable acquisition, even when it matches the URL. The native HTTP validator
accepts this field, but the native service lets it override the selected ID;
this profile retains IDs exclusively in the selector.

Variant list reads can request `inventory_quantity`. The selected native wrapper
and availability utility compute total availability from rich Inventory links
and native stocked/reserved level quantities. Unmanaged Variants omit the field.
The read profile reuses the existing quantity serializer and protected Core
read commands; native cache hints do not enable a separate cache. Variant ordering
currently admits ID only, with the existing graph and workflow resource bounds.
Inventory expansion and quantity requests retain an eight-Variant-ID and
eight-Inventory-Item-ID cohort limit; larger cohorts return HTTP 400, including
when a default list page exceeds those limits.
Variant deletion remains unselected.

Product Option collection and detail routes serve native `GET` and `POST`.
Reads use the `product_option` graph entry point, retain the parent filter,
and return native `product_options` list metadata or `product_option` detail.
Default fields are `id,title`; explicit fields can include the native Value
relation. The graph retains its existing ID ordering and query bounds.
A missing or wrong-parent detail retains the native empty-object HTTP 200.

Option creation runs `create-product-options` with the URL Product ID; update
runs `update-product-options` with both Option and Product IDs. Each validates
its parent response projection before mutation, then refetches independently.
Native policies require Product read on both routes and additionally Product
Option read on detail; the pin adds no separate create or update policy.
The existing workflow profile admits at most four Options and four Values per
Option in one input. Omitted update Values retain their identities; matching
strings reuse existing identities, while explicit `values: []` clears Values
and their Variant pivots through native replacement. Pricing and Inventory
links keep their own lifecycle. Wrong-parent updates return the unchanged
parent. Option deletion remains unselected pending parent-qualified deletion.
The bounded Option update workflow also refuses a body `id` with HTTP 400 before
acquisition, including a matching ID; native normalization could otherwise
override the selector. The HTTP Option bodies reject `metadata`, while direct
private Option workflow inputs support it.

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
