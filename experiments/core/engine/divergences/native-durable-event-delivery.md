# Native durable events and delivery records

Status: **Selected native Core implementation and connected proof complete;
remaining-consumer migration and retirement gates remain open.**
Owner: [Native Product slice](../slices/16-native-product-links-and-references.md).

## Pinned mechanism and need

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318`
`crates/database/src/bootstrap_model/system_metadata.rs` stores internal
records through the ordinary transaction. Its models own required internal
cleanup. It does not provide Medusa's existing attested event contracts,
ordered immutable event family or per-subscriber fenced delivery semantics.

The retained native publication contract durably commits event envelopes, event-family
count/digest and delivery records alongside the idempotency outcome.
Returning messages in result JSON would lose an existing obligation.

## Replacement and guarantees

[`coreDefinition.ts`](../../../../packages/persistence-postgres/src/commit/events/coreDefinition.ts)
compiles an optional `flarex.native-events` source owned by `system`, with three
private logical table roles: family, envelope and delivery. Its authenticated
source includes the exact producer revision, contract identities and subscribers.
The expected schema bundle authenticates the complete source on reopen. Ordinary
Application access and another native source cannot borrow its event binding.
Unrelated profiles do not acquire mandatory builtin or bootstrap records.

[`nativeHost.ts`](../../../../packages/persistence-postgres/src/frameworks/commerceTransaction/nativeHost.ts)
retains genuine
[`Commerce event capture and sealing`](../../../../packages/persistence-postgres/src/frameworks/atomicCommerce/events.ts).
The trusted host captures command, initialization, policy and resource identities;
the business facade never receives the private event operations. The host checks
its bounded lifetime, prepares the complete native deletion closure, seals and
consumes the authentic event closure, and stages it through the event child of
the same Core root as the business mutations and request outcome. Finalization,
accepted-prefix validation, durability and publication remain Core responsibilities.
Native callbacks and event decoders do not become replayable mutation bodies.

[`stageCoreCommitEventFamily`](../../../../packages/persistence-postgres/src/commit/events/coreStore.ts)
captures and validates the complete family before its first insertion. It verifies
the ordered envelope digest, policy identity, subscriber uniqueness and complete
record values. These Core-owned records have no managed defaults or native merge
decisions. Ordinary authenticated `operations.insert` retains schema, native-key
uniqueness, generated IDs, index dependencies and SYSTEM accounting. There is no
event-specific SQL writer, second publisher or second transaction for family
creation. Empty event lists do not create a family header. Dense surviving-array
ordinals retain the existing publisher's cancellation projection. Framework
lifecycle maps and root events remain framework-owned; deleting several graph
rows need not produce an event for each row.

## Family order, repair and delivery

The family header witnesses the complete count and digest. The reader verifies
contiguous ordinals, full `EventEnvelope` values and the exact delivery projection
before exposing or claiming a family. Business event IDs use scope, epoch,
family ID and ordinal; existing retained physical event IDs are not rewritten.

`nextFamily` uses a bounded ordinary native index page over family IDs. This is
an opaque private repair cursor, **not commit-sequence ordering between independent
roots**. Order inside a family is preserved. A completed pump scan resets its
cursor; the next scan revisits due retries, missing historical handlers and
families published behind the previous cursor. No raw persistence feed bypasses
retention or supplies another ordering authority.

`makeCoreCommitEventStore` and `makeCoreCommitEventPump` in
[`coreStore.ts`](../../../../packages/persistence-postgres/src/commit/events/coreStore.ts)
revalidate the same issued binding for short Core read/write operations. Delivery
retains subscriber revision matching, attempt limits, monotonic fences, owner
and lease checks, due times, retry backoff and terminal settlement. Handlers run
outside those operations. Lease recovery can redeliver externally executed work;
stable event/delivery IDs support subscriber idempotency, not exactly-once external
delivery. Core conflicts do not add a new automatic retry owner.

A store retains one admitted selection and its opaque verified-family and claim
tokens. Schema activation can revoke that selection; the store does not silently
replace its authority or retry through a fresh binding. A trusted caller must
explicitly bind the event definition and construct a new store profile. Fresh
Product profiles likewise construct fresh business and event children together;
already issued profiles retain their guards. App-owner reconstruction rebuilds
generation-local profiles after fencing and reconciliation, while recovery of a
healthy owner is not a profile-refresh API.

The event boundary preserves the original Core failure inside its typed error
and maps every typed reason in a complete Cause without dropping defects or
interruption. Semantic duplicate/query failures remain invalid input; budget
exhaustion remains a limit failure; stale claims and corruption remain distinct.
Unknown persistence outcomes require existing Core recovery, not native replay.
Eligibility hold/release references are rejected by this selected store until
their connected owner is migrated.

## Retained owners and removal gates

The selected Core native host does not fall back to the retained physical event
publisher. The following owners still have named unmigrated consumers:

| Retained owner | Remaining consumer and removal gate |
| --- | --- |
| [`commerceTransaction/publication.ts`](../../../../packages/persistence-postgres/src/frameworks/commerceTransaction/publication.ts) and [`atomicCommerce/execution.ts`](../../../../packages/persistence-postgres/src/frameworks/atomicCommerce/execution.ts) | Retained physical/logical commerce hosts and atomic workflow composition still publish captured events here. Migrate their genuine module, workflow, compensation and mixed-root consumers to the shared Core before removing this dispatch. Product workflow composition is broader than the selected original-service runner. |
| [`events/store.ts`](../../../../packages/persistence-postgres/src/commit/events/store.ts) and [`events/pump.ts`](../../../../packages/persistence-postgres/src/commit/events/pump.ts) | Retained direct reader/pump consumers include Product tag workflows, sales-channel/shipping-profile workflows, variant-pricing workflows, inline import/recovery, fulfillment delivery, durable notifications and atomic task children. Their existing tests remain behavioral witnesses; they are not proof that every old fixture is a public compatibility obligation. Migrate the actual selected consumer and delivery behavior before retiring its old store construction. |
| [`events/eligibility.ts`](../../../../packages/persistence-postgres/src/commit/events/eligibility.ts) and [`trustedWorkflowEventEligibilityStore.ts`](../../../../packages/persistence-postgres/src/tasks/trustedWorkflowEventEligibilityStore.ts) | Trusted workflow task groups and atomic task-child settlement still own held/released/cleared eligibility. Their authenticated group lifecycle and durable task decisions must move together before the physical eligibility families or exported eligibility API can be removed. |
| [`publication/prefixProjection.ts`](../../../../packages/persistence-postgres/src/commit/publication/prefixProjection.ts), [`prefixWriter.ts`](../../../../packages/persistence-postgres/src/commit/publication/prefixWriter.ts) and [`events/schema.ts`](../../../../packages/persistence-postgres/src/commit/events/schema.ts) | Physical commit headers, envelope/delivery projections and installation support remain shared with retained publication paths. Application finite/durable publication, CMS publication and the retained cross-domain publisher also use that publication owner, even when they contribute no events. Retire the event projections only after their producers/readers and named durable data are accounted for; retiring the entire publisher additionally requires those remaining engine consumers to migrate. |

No named retained event dataset is reset, converted or assigned a new identity by
this implementation. Retirement requires an explicit inventory and approved data
disposition, migrated consumers and removal of displaced schemas, installers,
exports and fixtures while preserving their required behavioral coverage. These
retained owners are full-goal migration work, not a permanent parallel event engine.

## Required proof and limits

Complete connected proof for exact ordered families and corruption refusal, atomic rollback,
lost acknowledgement/cold replay without native reexecution, subscriber isolation,
claim fencing and delivery settlement on both database lanes. A test bus observing
returned JSON alone cannot establish durability. The complete original Product
inventory, its cleanup/lifecycle closure, ordinary-role PostgreSQL and PGlite
conformance, actual Worker consumers and required independent reviews remain
completion gates. Bounded event scenarios do not establish all workflow consumers,
eligibility migration, hosted delivery or retirement.

