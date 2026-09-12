# Product Shipping Profile Foundation: Preflight

Status: A implemented, including the approved preflight 60 shared-owner correction.
Gate C in preflight 58 is complete. B remains unapproved; no Fulfillment/Link
activation. [Preflight 61](./61-native-link-batch-cardinality.md) implements the
native router correction.
[Preflight 63](./63-native-singular-link-storage.md) implements the singular storage
foundation and native endpoint protection; it is not B activation approval.

## Outcome And Recommendation

Advance Product creation with the native ShippingProfile service and
ProductShippingProfile Link. The intended connected proof creates one profile,
one Sales Channel and a bounded simple Product batch, associates returned IDs
through both native Link steps, reads pending roots, and commits once.

The approved scope is **A: the bounded shared inequality prerequisite
and native cardinality characterization** below. Do not start broad Fulfillment
promotion or declare the new Link supported before those results. B describes
the intended module/workflow scope, but its activation depends on A and any
separately approved native correction exposed by characterization.

Shipping profiles are optional when omitted from native Product input. This is
an adjacent implementation choice, not a claim that every Product requires
Fulfillment. Pricing, Inventory/Stock Location, the full Product composer and
its transitive execution audit remain separate work. Customer is not required.

## Authority And Current Sources

- Accepted Medusa boundary in `design-notes/flarex-db-accepted-design.md`:
  reserved Link entities are authoritative; Flarex owns scope, settlement,
  publication and replay. Medusa owns Link cardinality and service semantics.
- `roadmaps/16-package-boundaries.md` and integration preflight 47: reuse
  existing shared mechanics and native owners, not consumer SQL or registries.
- Adoption roadmap 06, preflights 50/56/57/58 and workflow foundation 10:
  selected native workflows, same-installation profiles, stored many-to-many
  Links and transaction-covered compensation are present.
- Pinned fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, baseline 2.13.4,
  recorded in `third_party/medusa/SOURCE.json`.
- Executable Link/router/query code lives in `packages/medusa-*`.
  Fulfillment and the ProductShippingProfile definition remain comparison-only
  under `third_party/medusa/upstream/`; they are not runtime dependencies.

The original preflight was source-only. A now has executable neutral reader,
native router and connected consumer witnesses. Its unresolved boundaries are
recorded below. Prior Gate C results do not prove the new model or cardinality.

## Exact Native Trace

Native paths below are relative to
`third_party/medusa/upstream/packages/`.

| Owner | Required behavior and dependency |
| --- | --- |
| `core/core-flows/src/product/workflows/create-products.ts` | Maps created Product IDs to supplied `shipping_profile_id`, filters absent profile IDs, invokes `createRemoteLinkStep`. Full workflow also requires options, variants and other dependencies; it is not admitted here. |
| `core/core-flows/src/common/steps/create-remote-links.ts` | Resolves native `link` before the empty-list return. Nonempty input calls `link.create`; response/compensation both contain the supplied definitions, not generated Link rows. Compensation calls `dismiss` unless input is falsy; an empty array is truthy. |
| `core/core-flows/src/fulfillment/steps/create-shipping-profiles.ts` | Resolves Fulfillment, calls `createShippingProfiles`, returns rows and captures IDs. Compensator calls `deleteShippingProfiles` for nonempty IDs. |
| `modules/fulfillment/src/services/fulfillment-module-service.ts` | Create uses native manager/event decorators, scalar/array normalization, `shippingProfileService_.create` and base serialization. The inner create returns early for an empty array. No provider call occurs on this path. |
| Same service: deletion | Both hard and soft deletion validate `shipping_options.id` before delegating. Do not implement deletion as unconditional row removal or assume an empty unavailable relation. |
| `modules/fulfillment/src/models/shipping-profile.ts` | Native `sp` ID, required name/type, nullable metadata and active-name uniqueness. It has an inverse `shipping_options` relationship. The native service does not supply a default type. |
| `modules/link-modules/src/definitions/product-shipping-profile.ts` | Native `product_shipping_profile` table, `prodsp` identity and Product/Fulfillment routing. Product side has `hasMany: true`; ShippingProfile side does not. Product's exposed profile is singular; a profile can serve many Products. |

Promote only required steps with narrow exports and explicit
`transactionCovered` registration. Preserve their invocation and inverse bodies,
including the different empty-input behavior. This root must never execute the
deletion compensator: its database changes are covered by the existing outer
transaction. Do not claim saga or deletion support from that annotation.

## Fulfillment Closure Is Not Its Granted Capability

The native static manifest lists twelve models: FulfillmentAddress, Fulfillment,
FulfillmentItem, FulfillmentLabel, FulfillmentProvider, FulfillmentSet, GeoZone,
ServiceZone, ShippingOption, ShippingOptionRule, ShippingOptionType and
ShippingProfile. ShippingProfile imports ShippingOption; that model reaches
zones, providers, rules, types and fulfillments, which close over the remaining
models. The module service also imports provider and rule utilities and native
joiner/schema metadata. Merely moving one model file is not a truthful promotion.

However, the source/model closure does **not** automatically require twelve
new installed tables or twelve admitted service APIs:

- Capture the actual complete native metadata, then explicitly select the
  ShippingProfile physical table for the create/scalar-read profile. Preserve
  its real columns, lifecycle/defaults and partial unique index. Its inverse
  has-many edge is not itself an outgoing physical foreign key.
- Retain the native relationship metadata; refuse unadmitted hydration and
  deletion. Do not replace the model with a fabricated scalar DML clone or
  report unavailable shipping options as an empty relation.
- Reuse the native Fulfillment service and actual internal service construction.
  Keep its dependencies honest and its exposed methods narrow. Other internal
  methods must not gain table/provider authority merely because their source
  or constructors are present. No dummy provider or no-op service stand-ins.
- Construction/serialization/source-closure proof is a B entry gate. If the
  actual service cannot be composed this way without fabricated dependencies,
  stop and propose a native owner extraction; do not silently install the whole
  fulfillment subsystem or copy its business method into the adapter.

The intended fresh configured set therefore adds two selected tables to Gate
C's fifteen: `shipping_profile` and `product_shipping_profile`. Seventeen is a
proposed selected-schema inventory, not a compiled or installed result.
Any additional necessary table or changed relation contract requires explanation
and a revised schema decision before installation.

## A. Shared Inequality And Cardinality Prerequisite

### Deterministic contract gap

The executable `packages/medusa-modules-sdk/src/link.ts` native create method
checks existing conflicting associations before writing. For this definition
it issues a list query of the following shape, with `take: 1`:

```ts
{ $or: [{ shipping_profile_id: { $ne: "sp-new" }, product_id: "prod-one" }] }
```

Before A, the Link adapter field decoder accepted IDs/membership, not `$ne`.
`packages/medusa-adapter/src/query/predicate.ts` and the core commerce reader
lacked scalar inequality. Submitting that native predicate through the Link
policy was refused rather than finding a conflicting row. A now implements the
bounded shared operation described below; this historical prerequisite is not
a remaining query gap. No stored ShippingProfile run establishes its support.

Approved A scope:

1. Preserve failing adapter/core witnesses before changing either owner.
2. Add one explicit module-neutral non-null text inequality operation through
   the existing bounded commerce reader. Specify SQL `<>` semantics: null
   column values do not match; null operands, non-text fields, malformed objects
   and unadmitted columns fail closed. This is not arbitrary SQL or full ORM
   operator support. Reuse existing parameterization, scope binding, ordering,
   byte/operand/node/depth budgets and request lifetime.
3. Translate native text-ID `$ne` in the shared Medusa predicate owner through
   an explicit admitted field capability. Keep existing equality/membership
   behavior unchanged; do not widen all module filter DTOs automatically.
4. Prove this on neutral renamed text columns and another existing supported
   module profile, plus the real native cardinality query shape. Run both
   PGlite and ordinary-role PostgreSQL owner/consumer lanes.

This is the approved core query-capability extension. It is
not a shipping-profile branch. Rejected alternatives: adapter post-filtering
breaks bounded existence/count/pagination semantics; local SQL bypasses the
existing authority; a second transaction changes the atomicity contract;
rewriting native cardinality around weaker equality queries adds a different
algorithm merely to hide the shared read gap. No public API/version suffix,
new execution profile or budget increase is proposed.

### Native same-batch risk must be characterized

Before preflight 61, the native router accumulated all uniqueness filters, read
existing rows, then passed the whole batch to the service without comparing
incoming partners. Its generator still declares the two
endpoint columns as the physical primary key; it does not derive a unique
`product_id` constraint from `hasMany`.

The original source-derived counterexample was: on empty storage, create
`(product-1, profile-A)` and `(product-1, profile-B)` in one batch. Both
pre-insert existence checks can be empty, and the composite keys differ.
The authored `packages/medusa-adapter/test/native-link-cardinality.test.ts`
initially confirmed that the actual native router delegated both conflicting
tuples after one existing-row query. The actual structural generator declares composite
endpoint identity and no endpoint-only unique index. The test also characterizes
exact duplicate delegation, multiple Products sharing a profile, repeated
same-pair checks and refusal when the service reports an existing conflict.
Preflight 61 converts the expected-failing witness to ordinary pre-delegation
refusal, using native metadata for all four cardinalities without changing
duplicate-tuple delegation. The service boundary is a recording stub, not a stored Fulfillment
implementation; this does not claim persisted ShippingProfile conformance.

The native router and preflight 63 storage corrections are implemented. Do not silently
deduplicate, select the last profile, serialize a bad batch into changed business
semantics, or add an adapter-only unique index that hides the native contract.
Same-scope root serialization addresses competing requests; it does not repair
two contradictory rows submitted in one batch.

### Resolved shared-owner boundary: commerce JSON identity and outcomes

The native-root inequality witnesses exposed an Application-value codec in
commerce request identity and successful results. Reserved operator keys were
rejected before dispatch. Approved [preflight 60](./60-commerce-json-identity-and-outcomes.md)
corrects both single and atomic commerce owners: canonical ordinary JSON,
domain-separated request/policy identities, explicit retained-result encoding,
and the existing bounded replay/publication machinery. Application value
semantics remain unchanged; the adapter does not rewrite filters to bypass them.

The shared `textNotEqual` reader now reaches the native-root consumers.
Inequality is granted only to selected Link IDs and the Sales Channel ID.
Neutral renamed-column witnesses preserve parameterization, null exclusion,
scope isolation, pre-pagination count and existing resource limits.
Malformed caller Unicode remains refused as `invalidInput`, without retaining
the old codec's misleading `invalidAuthority` classification.

Native Link's separate in-batch cardinality correction is implemented in
[preflight 61](./61-native-link-batch-cardinality.md). The separately approved
[preflight 63](./63-native-singular-link-storage.md) closes native scalar-Link
active uniqueness and endpoint protection, with neutral direct-service,
restore and physical contention proofs. It does not activate B: Fulfillment
construction/source closure and connected ShippingProfile admission still need
their own bounded decision.

## B. Connected Module And Workflow Direction

After A and any required cardinality correction:

- Add one cohesive Fulfillment shipping-profile preparation entry point with
  native create and scalar retrieve/list/count, checked metadata, events and
  workflow registration. Do not expose general Fulfillment CRUD. Deletion,
  shipping-option relation behavior, rates, providers and shipment execution
  remain closed until separately proved.
- Extend the current native Link construction owner for the two checked link
  definitions. Share only the real repeated repository/schema/event mechanics;
  preserve direct bindings and named definition-specific capabilities. No
  entity-name switches, synthetic discriminators or universal CRUD factory.
- Keep a single native `link` workflow resource. Its confined profile may own
  both selected Link tables, while Product, Sales Channel and Fulfillment retain
  separate profiles in the same configured installation. Do not introduce a
  second resolver, transaction or publication owner.
- The proof calls the Sales Channel association and shipping-profile Link steps
  separately, in native Product order. Native Link.create fans out mixed-family
  batches through `promiseAll`; arbitrary mixed-family create calls are not
  implicitly admitted by this sequential proof. Reject them at the declared
  private input boundary until their lifecycle semantics are separately proved.
- Use a named connected facade over the existing SDK/host, not the full native
  `createProductsWorkflow` name. Reuse Gate C's simple input as a starting point,
  but remeasure the complete new envelope; its old maximum is not a free budget
  grant. No chunked commits or raised limits to make it fit.

Consumer shape stays explicit: an installed Product/Sales Channel/Fulfillment/
Link set, existing execution factory, reviewed revision and subscribers go into
one workflow preparation facade. The caller does not import repository builders,
method tokens, event decoders, Link router construction or graph internals.

## Compatibility, Cleanup And Completion Gates

The pinned shipping-profile integration file has five cases. Three exercise
creation and native events/duplicate-name refusal; one deletes an unlinked
profile; one builds provider-backed shipping options and checks protected
deletion. Preserve the original source and assertions. A creation-only
activation cannot claim all five cases or full Fulfillment compatibility;
record selected cases and explicit deferred deletion scenarios honestly.

Retain existing Gate C and B3 profiles/tests as supported independent proofs,
not legacy fallbacks. Extend shared predicate and Link mechanics at their owners;
replace repeated selected-Link assembly only when the replacement carries its
old tests. Delete provisional assembly, fake services and diagnostic bypasses.
No production data migration/coexistence obligation has been established; use
a fresh selected schema candidate, not an opportunistic rewrite of old installs.

B completion requires native create/Link invocation and compensator
characterization; pending and committed endpoint/Link reads; exact module event
and fact evidence; active/deleted/repeated/conflicting pair semantics; late
failure and caught-refusal rollback; generated IDs; replay/revision/uncertain
settlement; cancellation/escaped resources; subscriber failure; scope/profile
isolation; and an exact-backend/blocker PostgreSQL concurrency witness.
Keep native/service proofs separate from schema-only and routing mock tests.

Preserve installation and request deadlines. A setup timeout must remain
visible; a successful rerun does not diagnose it. Validate PGlite and ordinary-role
PostgreSQL separately, plus affected types, unchanged regressions, provenance,
portable source closure, lint and both required reviewers before implementation
commits. Full Product workflows, additional modules, remote effects, suspension
and production exposure remain gated.
