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

## Private Admin Product creation

`@flarex/medusa-http/admin-product` exports `createAdminProductHttpHandler` for
the selected pinned `POST /admin/products` handler. The matching scoped Effect
namespace host is `@flarex/medusa-http/admin-product-effect`. The native manifest
renderer builds the separate Admin Product manifest.

The route requires a trusted host principal resolver, native `user`
authentication and an injected evaluator for all three pinned creation policies:
Product, Inventory Item and Price. An executor credential or an unverified token
payload grants no admin access. This profile does not provide general RBAC or
every native authentication method.

The actual read owner supplies `admitProductRefetchFields`, which rejects
unsupported projections before creation. Requests must explicitly select fields
admitted by that owner, for example `?fields=id,title,handle,status`. The broader
native default graph fails before the workflow runs. Native body validation and
the existing Product workflow retain their own input rules and bounded support;
title-only creation does not satisfy the native option rule.

The handler awaits the native `create-products` workflow, then independently
refetches through native `query.graph`. A later refetch failure cannot undo the
already committed workflow. This layer does not retry creation.
