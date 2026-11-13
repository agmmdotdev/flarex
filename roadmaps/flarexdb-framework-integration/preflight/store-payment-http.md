# Store Payment Collection and Payment Session HTTP

Status: private bounded HTTP promotion complete; production activation remains gated.

## Scope and native ownership

The selected routes are `POST /store/payment-collections` and
`POST /store/payment-collections/:id/payment-sessions`. They use the existing
private Effect HTTP host, native publishable-key and locale middleware, strict
body validators, field parser and response envelopes from the pinned Medusa fork.
The existing System provider, Payment module, Cart totals and stored Module Links
own commerce behavior. No remote gateway or checkout-completion HTTP is selected.

Collection POST accepts only `{ cart_id }`. It first reads the genuine
Cart–PaymentCollection Link and returns an existing collection without executing
a mutation workflow or validating the Cart again. This branch also returns an
existing collection for a completed Cart or a Cart without a Sales Channel.
When absent, the genuine collection workflow runs as an actual child under the
trusted atomic owner, preserving native lock skipping, completed-Cart refusal,
stored Cart totals, collection creation and Link creation. Its ordinary
twelve-model Cart read view does not inherit Shipping's Sales Channel gate.

Session POST accepts only `{ provider_id, data? }`. Customer identity comes from
the verified optional Customer principal, never a body or actor header. One
prepared native Session root supports both guests and existing Customers. The
Customer branch retains genuine saved-Address selection, default-billing fallback,
account-holder creation or reuse, and the Customer–AccountHolder Link. Existing
Customer read and account profiles retain their own email and cohort restrictions.
The local provider is `pp_system_default`; other providers refuse before execution.

AddressManagement admits the native Customer service's local `addresses`
population through its existing Customer source and declared DML relationship.
The four-row bounds and exact receipt comparison remain in force. Receipt
reconstruction reuses the existing ID ordering owner over authenticated read
observations. The base checkout scalar profile retains its scalar restriction.

The Session handler's native callable workflow entry is translated to the
existing workflow-engine request port for the same workflow ID and input. This
is an HTTP/framework fork seam. It grants no callback-parent authority and adds
no SDK execution mode. Native workflow definitions, module methods and retained
inverses remain unchanged.

## Persistence, reads and resources

The serving catalog adds the existing Customer–AccountHolder schema as its
twenty-first native source. Collection execution selects Cart, Payment and the
Cart Link; Session execution selects Payment, Customer and the account Link.
Original source selectors and issuer tokens remain authoritative. The native
container resource name `link` does not create another persistence source.
PostgreSQL alone settles each root, its events and durable outcome. The queued
atomic host retains sticky refusal, scope exclusion, rollback and replay.

The public graph uses the existing independent protected reads for Cart Links
and Payment rows. Complete response fields are admitted before either handler,
including before the collection route's initial read. Session responses refetch
the committed collection through the native `refetchPaymentCollection` helper.
Defaults are `id`, `currency_code`, `amount` and all native Session fields.
The genuine native Query owns field selection, Link expansion and the response
mask. Numeric companions appear when the native selection includes them.
Neither route adds `cart.updated`.

The same native Query and RemoteJoiner programs serve existing Cart, Store and
Admin reads and workflow query calls. The
[Local Graph Query owner](../../workflow-foundations/06-local-graph-query.md)
defines that replacement. Actual endpoint declarations accompany stored Link
metadata even for a Link-only query; they confer no endpoint read capability.
The protected dispatcher retains original command tokens and invocation-local
cohort admission, including the four-Session public read ceiling.

Store is unreachable from the public Cart/Shipping read graph, so that facade
does not acquire a Store read host. Native Cart creation retains its Store
participant. Session-only Customer/account capabilities stay internal to their
workflow and require no additional public read hosts. The combined host admits
its prepared roots within the combined host's 35-host and 8 MiB limits, shared
with the [completion profile](./store-cart-completion-http.md). Each Payment
root retains three participants and the existing 512-call Payment allowance;
participant, byte, event and per-module limits are unchanged.

The public Payment read cohort remains four Sessions. The native Session workflow
retains authorized Sessions while replacing the others. Four retained authorized
Sessions can therefore become five after successful creation. The independent
default response refetch then refuses its unsupported cohort after settlement;
the fifth Session remains committed. A refetch failure is not evidence of business
rollback, and the HTTP adapter neither retries nor adds a pre-read or compensating
transaction. The bounded witness preserves both the native mutation and the
separate read limit.

Independent challenges of current Core, accepted direction and actual pinned
Convex found no required Core mechanism change or divergence for these routes.
Existing logical schemas and lifecycle owners are reused; no physical commerce
table, populated-data migration or reset is selected. Actual Workerd acceptance
uses the existing `nodejs_compat` host profile and cache-disabled Hyperdrive;
it does not establish arbitrary providers, capacity or production deployment.
