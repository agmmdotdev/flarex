# Native Cart Customer selection

## Status and authority

Status: implemented private bounded Customer selection profile; shared
prerequisites implemented. This independent Cart child retains the genuine
selection step, scalar guest creation and its physical inverse. It does not
admit the complete Cart root.

The shared [Boolean partial-index prerequisite](../../shared-logical-storage/70-boolean-partial-unique-indexes.md)
is implemented independently. Shared [requested optional-resource resolution](../../workflow-foundations/11-workflow-host-composition.md#requested-optional-resources)
and the unchanged native cache utility export closure are implemented separately
from the Customer adapter.

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
The shared workflow prerequisite and its native utility export closure are
implemented separately from the Cart context adapters and pending business
decisions. Only authenticated, explicitly declared absence is supported;
required and undeclared lookups remain sticky refusals.

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

## Bounded persistence profile

The private profile exposes only `retrieveCustomer`, `listCustomers`, scalar
`createCustomers` and scalar `deleteCustomers` to the genuine selection step.
Reads retain complete scalar Customer DTOs and at most two native ID-ordered
email matches. One invocation can create at most one guest. It installs all
four genuine models and retains both active Boolean Address unique indexes;
the genuine empty `createCustomerAddresses([])` call and
`serialize([], { populate: true })` remain inside the same borrowed context.

The retained inverse selects one Customer and complete history of at most one
Address, including a deleted Address. Larger Address cohorts refuse before
mutation. Any active or deleted Customer–Group membership also refuses before
writes. The original native deletion witness leaves explicit membership rows
orphaned; the adapter does not introduce a cascade to repair that business
behavior. The original witness remains authoritative, and membership-bearing
native deletion requires a separate business decision and native inverse proof.
Independent Groups remain unchanged.

This profile keeps the default call, event and other resource limits. It
selects the existing queued root and borrowed-operation scheduling without a
new allowance. The native ID-only inverse still does not prove generation-safe
ownership or arbitrary descendant support.

## Admission boundary

1. The original native characterization remains separate from the adapter
   candidate, including the membership-orphan witness and explicit refusal.
2. Private admission covers connected scalar selection, guest creation, complete
   DTOs, empty Address calls, native failures/events and retained
   inverse on PGlite and ordinary-role PostgreSQL. Active and deleted Address
   history, excessive descendants and active/deleted membership refusal before
   writes remain explicit boundaries.
3. Complete Cart composition, broader Customer methods and membership-bearing
   physical deletion require their own connected admission.

Original failing witnesses and corrected candidates remain separate. A harness
observer must preserve native Proxy targets, receivers, contexts and Promise
outcomes. Observer failures refuse the diagnostic packet; they do not establish
native business behavior or justify a fork correction.

This preflight admits no complete Cart root, Cart writes, general Customer
workflow surface, remote provider or hosted activation.
