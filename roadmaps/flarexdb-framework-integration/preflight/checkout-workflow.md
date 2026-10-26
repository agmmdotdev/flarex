# Native checkout workflow

## Status and authority

Status: preflight; the explicit atomic declaration profile is approved. Its
finite SDK correction retains the native storage declarations and requires the
trusted execution port to select the atomic outcome policy before any callback.
The connected checkout runtime and Cart writes remain gated. The bounded Order
participant below extends its existing owner for isolated checkout admission.

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
diagnostic. The separate checkout participant now authenticates call-local
creation/deletion receipts and committed module events before root admission.

## Bounded Order checkout participant

The existing Order construction, repository, exact-value, query and lifecycle
owners now expose an explicit `order.checkout` profile. Each creation/deletion
call admits one digital/manual Order, up to four Line Items and no Address,
shipping, tax-line, adjustment or credit-line creation. The same participant
retains native financial methods needed by checkout and Payment accounting;
the original financial profile retains its model set and mutation permissions.

Creation receipts reuse genuine native total calculation and DTO formatting,
checked stored rows, relationally lowered literal defaults and exact encoders.
The trusted generated-serial owner still owns allocation, scope, concurrency
and dependency proofs. Its complete existing Order support observations remain
checked preimages rather than invented native DAL reads. Default results select
both absent Address slots; empty repeated target families are admitted without
admitting populated repeated aliases. Receipts bind every mutation, exact read
transcript, returned DTO and ordered module event to this actual call.

Public deletion reuses native `deleteOrders` and the existing physical graph
correlator for the complete Order cascade and standalone Line Items. The native
barrier between those two graphs remains explicit. The finite deletion profile
requires absent Addresses, Changes and Shipping; full newly created graph
cleanup and its root/Line Item events are authenticated.
These gates include authenticated historical preimages: hidden Shipping/Change
wrappers are refused, and every historical Item must reference a Line Item in
the native cleanup selection. This prevents physical cascades from removing
hidden wrappers while leaving their standalone rows behind.

Isolated atomic roots prove creation, reopened replay, native capture accounting,
complete deletion, late-failure rollback and refusal of tampered real receipts.
Ordinary creation retains the default request-call limit. The connected financial
probe uses the existing named Payment/Order finance allowance, and retains a
default-limit rollback witness. This does not set checkout's whole-root budget
or admit the complete Cart graph, Cart writes, cross-module Links or checkout
root by itself.

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

## Native selected-field correction

The pinned `completeCartFields` included `raw_sales_channel_id` beside the actual
text `sales_channel_id`. Cart DML defines no such raw companion and the native
totals owner generates raw values for numeric totals only. The preserved
checkout field witness admits the real text scalar through the existing native
query/capture/projection path, then receives `unsupportedProfile` for the raw
field selected by the genuine native constant. This is an invalid native field
selection, not a missing storage column or numeric codec.

Approved disposition: remove only `raw_sales_channel_id` from the native complete
Cart field list, retaining `sales_channel_id` and every genuine numeric raw total.
The owner is `packages/medusa-core-flows/src/cart/utils/fields.ts`; its pinned
source guard must record the exact authorized correction. Do not silently drop
this field in a Cart adapter, loosen the projection owner or invent raw text
presentation. The user authorized this native-owner correction. The executing
list removes that single field; its exact source guard refuses retaining the
invalid selector or changing another field, genuine raw total or field order.

## Admission gates

The user authorized two native inverse owner corrections.
The retained Payment marker selects `payment.customer.id`, although the pinned
Payment DML and Link definitions expose no Customer relation on Payment. The
focused native-field witness admits its other fields and refuses that selector.
Payment Session already persists the native creation context, including its
customer identity; the corrected native marker selects that context and derives
the optional customer ID there. Do not invent a Payment/Customer Link or silently
drop an invalid relation in the query owner.

The genuine refund-and-recreate-session child refunds a captured Payment, then
the native session-creation workflow selects every existing Session for
deletion. Its authorized Session is still referenced by the retained Payment,
so shared FK enforcement correctly refuses the delete and rolls back the whole
root. The preserved connected witness expects a replacement Session and exact
Order accounting but receives `invalidInput` at FK delete enforcement. The
native replacement selector now retains authorized historical Sessions while
replacing un-authorized Sessions; native FK enforcement and financial history
must remain intact. The Order creation step and its retained inverse pass
independently. Neither defect authorizes changing storage constraints or
discarding native Payment history.

Production recreation is admitted only as the declared retained marker child;
its Payment and Collection identities come from the same authenticated Session
graph. The isolated child host is a test probe, not a standalone public root
accepting independently selected financial identities. Native Order creation
and both retained inverses remain independently exercised before whole-root
checkout admission.

Review also preserved a native batch-refund precision witness: a full refund of
`9007199254740993.0000` is rejected because the root selects public Capture and
Refund `amount` numbers and sums their rounded values. The Capture presents as
`9007199254740992`, although its raw amount and the requested refund remain
exact. This precedes the Refund DAL and is owned by native
`payment/workflows/refund-payments.ts`, not a storage numeric constraint.
The approved native correction selects genuine raw Capture/Refund amounts and
prefers them for native refundable-amount validation,
keeping the public numeric DTO fields, exact projection checks and over-refund
refusal. No adapter rounding or larger numeric tolerance is admissible.
The connected unlinked-Payment probe also preserves an authored selected-view
gap: native optional singular Order Links omit their alias when absent, while
the refund view required a present object-or-null field. The named view now
admits the metadata-owned omitted alias and still checks every present field;
shared graph projection, Link queries and the native optional-chain branch stay
with their existing owners. This unlinked branch is required after checkout's
Order/Link inverse has already removed the failed placement graph.

The independent native Session-root witness also confirms a second precision
defect: a Collection whose raw amount is `9007199254740993.0000` creates a Session
with raw amount `9007199254740992.0000`. The native session workflow selects
only public Collection `amount` and forwards that rounded number into creation.
The approved native selector/transform selects `raw_amount` and prefers it,
retaining the original both-root prerequisite and connected replacement assertions,
numeric DTO presentation and the
existing scalar fallback for a DTO without a raw companion. Any named native
Session input admission reuses the existing strict native raw encoder;
storage JSON and companion-field refusal must remain intact.

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
