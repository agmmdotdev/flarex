# Native checkout workflow

## Status and authority

Status: preflight; the explicit atomic declaration profile is approved. Its
finite SDK correction retains the native storage declarations and requires the
trusted execution port to select the atomic outcome policy before any callback.
No checkout runtime or new Cart/Order write profile is admitted by this document.

The executing reference is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, specifically
`cart/workflows/complete-cart.ts`. Preserve its complete native root, actual
steps, validation, hooks, compensation and already-completed Cart branch.
Accepted framework/storage boundaries and the existing transaction owners remain
authoritative. The proposed first profile uses existing Carts and local System
payments; Cart creation and remote gateways retain separate gates.

## Connected owners and prerequisite order

The root reads the actual Order-Cart Link and complete Cart graph, validates its
Payment sessions before the hook, and creates an Order only when no Order-Cart
Link exists. The creation branch validates Shipping, translates stored Cart
items, addresses, adjustments, tax lines and credit lines through native helpers,
creates the Order, reserves Inventory, registers Promotion usage, creates Links,
marks the Cart complete and captures `order.placed`. Payment authorization occurs
after these operations, followed by actual capture transactions and native hooks.
Retrying the same Cart with another request identity must preserve the existing
Order branch as well as the outer owner's same-request replay contract.

Reuse the Payment collection/session/authorization and Order-finance owners.
Checkout still requires native Order creation/deletion, Cart completion writes
and their retained inverse, the Order-Cart Link and the complete selected Cart
graph. Existing Cart payment reads do not admit this graph or any Cart mutation.
Managed Inventory reservation needs its actual Inventory and Locking owners;
the existing read-only confirmation capability is insufficient. Empty Inventory
and Promotion inputs must reach the genuine native early-return branches before
their resources may be absent. Populated branches require their genuine owners.

Complete Cart creation is separate from completing an existing Cart. Its pending
Country ordering, Address inverse, Cart-Promotion inverse and Promotion candidate
selection decisions must not be silently accepted through this checkout work.
The uncommitted Cart context-read candidate belongs to the stopped Cart session
and is not a substitute for admitted checkout graph reads.

## Approved workflow declaration disposition

The native root declares `{ name: "complete-cart", store: true,
idempotent: false, retentionTime: 259200 }`. The predecessor finite SDK admitted only
the name and exact `idempotent: false` configuration. The preserved SDK witness
originally received `unsupportedProfile` before the composer was invoked. Its owner is
`packages/medusa-workflows-sdk/src/definition.ts`, not a Cart or Payment adapter.

Storage and retention are behavioral declarations: the pinned SDK passes them
to the native workflow manager and orchestrator. The finite profile instead
borrows one outer atomic root, outcome and replay owner. Merely deleting these
options or accepting them as ignored metadata would not establish native stored
execution or three-day retention. A named compatibility disposition must bind
the declarations to the actual execution owner before dependent root admission.
Standalone resumable execution, automatic expiry and a second outcome/replay
store are not established by the current finite SDK.

Approved disposition: the finite owner admits only the exact native stored
declaration above and retains both fields in prepared workflow identity. The
trusted execution port must explicitly select `atomicRootOutcome`; the existing
atomic Medusa host supplies this policy. The complete child closure is checked
before any parent callback, so nesting cannot bypass policy refusal. Declarations
without storage keep their existing behavior and strict option checks.

The user explicitly accepts one outer durable atomic outcome and its existing
replay/retention policy in this private System-provider profile. This is not
native resumable step history or automatic three-day expiry. No new storage,
scheduler, child commit or replay mechanism is added. Neutral SDK cases and a
genuine native Cart collection child establish the declaration, policy, durable
replay and late-failure rollback boundaries before checkout-root admission.

## Bounded Order creation consumer

Native Order creation preparation reuses the existing Order persistence,
complete-row, exact-number, query, graph insertion and physical lifecycle owners.
The initial consumer admits one to four Orders and four total digital/manual
items, without Address, shipping, adjustment, tax-line or credit-line writes.
Order display identities use the existing scoped generated-serial contract.
The native owner creates Summary values and Item wrappers, returns its actual
selected DTO and deletes the complete newly created graph through `deleteOrders`.
Root totals are not part of that default native creation selection; Summary
accounting and the actual flattened Item values retain their native result shape.

`decorateCartTotals` mutates source Line Items with native calculated BigNumbers
before the public Order owner creates them. The named creation DAL omits only
those known non-stored totals and native ephemeral ownership/quantity inputs;
stored numeric fields still use the existing exact encoder. Caller-supplied
computed totals, identities and unadmitted graph writes are refused at input.
The financial profile retains its original model set and mutation permissions.

The consumer establishes native creation, generated display identity, complete
physical graph cleanup, same-request replay and whole-root late-failure rollback.
Generic identity heads and revision history remain after deletion; the complete
created graph must have current tombstones. Its native event observations are
diagnostic. Production workflow resources, call-local creation/deletion receipts
and committed event admission remain required before checkout may invoke this
owner.

## Callback child workflow prerequisite

The pinned `compensate-payment-if-needed` callback invokes
`refundPaymentAndRecreatePaymentSessionWorkflow(container).run({ input })`.
The predecessor finite SDK exported a definition object with composition-time
`runAsStep`, without the native callable factory or an authenticated callback
child runner. Its strict step configuration also refused an explicit
`invokedWorkflows` declaration. Two neutral witnesses preserve those failures.
The owners are the existing finite definition, prepared identity and execution
port, not a checkout adapter or a second workflow host.

Approved correction: declare the finite child closure at preparation, retain its
identity and limits, and bind the native callback invocation to the actual live
parent container/occurrence and caller-owned port. Check the complete child
closure before callbacks, preserve resource admission, exact captures, sticky
failure and owner cleanup, and refuse foreign or expired bindings. No child
commit, independent retry, new root, replay store or global mutable runner is
admitted. The user separately approved this bounded callback-child correction.

The finite implementation prepares authentic declared child definitions and
includes their transitive identities and node counts in the parent. Each child
may run once per actual step callback occurrence through the exact native
`workflow(container).run({ input })` shape. Per-callback container views retain
the parent's authenticated resource selection and revoke when the callback
settles. Undeclared, repeated, malformed and unfinished calls fail through the
existing Promise/failure owner; caught child rejection cannot allow settlement.
Nested and parallel occurrences retain independent identities. Native Cart
collection child execution proves one outer outcome, reopened-host replay and
complete write/event rollback for late failure, caught refusal and unfinished
child execution on both database drivers. Checkout's retained Payment inverse
still needs its own declared native child closure before root admission.

## Admission gates

Run the genuine root and retained inverses on PGlite and ordinary-role PostgreSQL.
Require successful placement, native already-linked retry, same-request replay,
cross-shop refusal, exact totals and raw amounts, Payment validation/authorization
failure, late-hook rollback, Cart completion restoration, complete Order/Link
cleanup and committed event accounting. Competing completion must publish at most
one Order for the Cart through the existing trusted transaction owner.

Any proposed managed Inventory, populated Promotion, captured-Payment compensation
or durable workflow branch needs its own complete reachable closure. A bounded
System-provider result does not establish hosted checkout, gateway recovery or
arbitrary Cart workflows.
