# Native Cart Customer selection

## Status and authority

Status: native contract characterized; adapter prerequisites remain pending.
The original Customer branch is the next
independent Cart child after the implemented Inventory confirmation branch.
The shared [Boolean partial-index prerequisite](../../shared-logical-storage/70-boolean-partial-unique-indexes.md)
is implemented independently. Shared optional-resource resolution and adapter
admission remain pending.

The executing reference remains Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The selected native step is
`cart/steps/find-or-create-customer.ts`. Accepted framework/storage boundaries
and the existing queued workflow owner remain authoritative. Standing approval
covers necessary core corrections; native business changes require their own
decision. No new native business correction is selected here.

## Connected native contract

Compose the genuine step as one private workflow and one Customer participant.
Both inputs omitted return before Customer resolution. Explicit null and empty
values instead resolve Customer, then may skip all method calls. Preserve that
distinction. The native step's undefined output keys and the SDK's serialized
empty workflow result are separate observable boundaries.

A truthy Customer ID is retrieved first; missing or deleted IDs fail without
email fallback. A truthy email then reaches native validation and lowercasing,
including after account retrieval. Email-only selection uses the first ID-ordered
native list result without an account preference. An account is returned
unchanged. A guest with a different normalized email selects an existing guest
for that email or creates one through scalar `createCustomers`.

The inverse physically deletes only when the native step retained that it
created a Customer. Preserve the scalar call and actual retained Customer ID.
This ID-only native compensator does not establish generation-safe ownership,
arbitrary descendant support or concurrent create idempotency.

The read helpers genuinely resolve optional Caching before their uncached
callback. Reuse authenticated resource absence and the existing lifetime owner;
do not substitute a provider or omit native resolution. Country ordering and
the pending Cart Address, Cart-Promotion and Promotion business decisions are
independent of this child.

The actual SDK child container is the resolution boundary. Its uncached read
path requires requested optional absence to preserve the live request owner.
Complete that shared workflow prerequisite and its native utility export closure
separately from the Cart context adapters and pending business decisions.

## Native persistence and serialization

Bind the four actual Customer models and their internal services. Reuse the
existing checked DML, named repository, call-local receipt, event, lifecycle and
Promise/Cause owners. General Customer, Group and Address CRUD are outside this
workflow surface.

Native Customer creation invokes `createCustomerAddresses([])` through the real
service and borrowed context. Its empty internal create returns before a
repository insertion; serialization still receives `([], { populate: true })`.
Customer creation serialization also receives `populate: true`. Admit those
actual calls without inventing an empty relation result or a second manager.

Native creation returns complete scalar Customer fields plus initialized empty
`groups` and `addresses`. Ordinary retrieve/list results omit those unpopulated
keys. Reuse the native creation-only relation initializer and checked relation
descriptors, as Shipping Profile creation already does. `populate: true` does
not authorize unconditional relation reads or filling every read with arrays.

The original checked decoder refuses the actual Boolean-and-active Address
unique indexes. The prerequisite corrects the existing neutral schema/index
owners; it does not drop indexes because this child creates no Addresses.
The native compiler and ordinary-role PostgreSQL catalog agree on active-only
membership. Physical inverse descendants and retained history still require
bounded complete selection or an explicit refusal.

## Admission plan and remaining gates

1. Use the shared predicate support, preserving old identities, selectors,
   unique claims and supported consumer regressions.
2. Retain the genuine Customer characterization with original repositories, SDK
   child container and local EventBus. Preserve null/empty branches, ID and email ordering, mixed
   account/guest cohorts, actual DTOs, empty Address calls, context identities,
   native failures, cancellation, late failure and retained inverse closure.
3. Complete shared optional-resource resolution and its native utility exports,
   then promote the exact native step and email helper with precise exports and
   provenance. Implement the narrow Customer adapter and genuine wrapper using
   existing construction owners; retain unsupported-method refusal.
4. Measure complete forward and retained-inverse calls/events before selecting
   resources. No larger allowance is selected by this plan.
5. Validate both adapter database lanes, affected types/builds/source/portable
   checks and lint, obtain both required reviews, then commit the complete slice.

Original failing witnesses and corrected candidates remain separate. A harness
observer must preserve native Proxy targets, receivers, contexts and Promise
outcomes. Observer failures refuse the diagnostic packet; they do not establish
native business behavior or justify a fork correction.

This preflight admits no complete Cart root, Cart writes, general Customer
workflow surface, remote provider or hosted activation.
