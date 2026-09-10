# Durable Workflow Events

## Status And Scope

Status: implemented for private atomic Product-tag creation, update and deletion, together with
[native Medusa integration](./10-medusa-workflow-integration.md).
Groups spanning multiple committed steps remain deferred.

The [native workflow composition capability](./15-native-workflow-composition.md)
replaces the private single-contract participant slot with finite authenticated
internal event selection. Core checks the adapter-selected token against both
the participant and root policies and binds that association into replay identity.
Mixed-operation parents retain actual module event names. Event envelopes,
storage, publication and delivery retain their existing owners.

This adds durable intent and a private recoverable delivery pump to the first
real workflow, using the existing commit owner. It does not activate a
production event provider, general subscriber API, Task workflow or second
commit/feed authority.

## Owners And Capability Boundaries

| Existing owner | Reuse and limit |
| --- | --- |
| [Product local policy](../../packages/medusa-adapter/src/product-local-events.ts) | Reuse payload capture and row/lifecycle correlation. It validates module events and invokes a supplied local destination; it has no durable event record. |
| [Commerce host](../../packages/persistence-postgres/src/commerceTransaction/host.ts) | Its local buffer is delivered after acknowledged completion and discarded during uncertain-result recovery. Preserve that supported profile; select durable mode explicitly. |
| [Atomic host](../../packages/persistence-postgres/src/atomicCommerce/host.ts) | Admits selected participant/event definitions explicitly; the event-free profile still refuses capture. |
| [Shared publication](../../packages/persistence-postgres/src/commitPublication/publication.ts) | Reuse one sequence, header, retained result, common wake and physical commit. Consumes the authenticated single-use event contribution in that same publication. |
| [Commit wake](../../packages/persistence-postgres/src/commitWakeOutbox.ts) | Its kind and claims serve deployment-sync wakes. Fencing, database time and retry mechanics are useful reference; its acknowledgement is not a business-subscriber acknowledgement. |
| [Task delivery](../../packages/persistence-postgres/src/taskComputeDeliveryRepositoryV1.ts) | Records reference Task definitions, runs and requested effects. Do not create Tasks or relabel Task evidence just to deliver atomic workflow events. |
| [Legacy outbox](../../packages/persistence-postgres/src/outbox.ts) | Carries legacy deployment commit/document summaries. It is not the new relational business-event payload owner. |

The accepted [publication architecture](../flarexdb-framework-integration/04-transactions-and-commit-publication.md)
requires typed event intents tied to the same commit and common wake. The private atomic profile implements that contract; standalone local Product
delivery retains its separate supported behavior.

## Selected Event Semantics

The [Product-tag workflow](../../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/create-product-tags.ts)
uses public Product creation and
[emitEventStep](../../third_party/medusa/upstream/packages/core/core-flows/src/common/steps/emit-event.ts).
Preserve both contracts:

- Module creation events use existing checked Product policy and metadata.
  The derived tag event is `product.product-tag.created`; retain the actual
  scalar/batch payload and internal-event routing information.
- The workflow event is `product-tag.created`, from the pinned
  [workflow constants](../../third_party/medusa/upstream/packages/core/utils/src/core-flows/events.ts).
  The event step emits one `{ id }` message per tag. Do not collapse these two
  names/meanings or classify them as duplicate events.

Medusa owns payload/name policy. Core owns authenticated capture, resource
accounting, commit identity and delivery evidence. A native event definition
can bind a typed decoder and authorized producer; arbitrary names with arbitrary
JSON are not that contract. The first admission is limited to these events and
a finite registered destination set.

Correlate module events with real participant facts through existing policy.
Correlate create/update workflow tag IDs with successful admitted command output.
The [deletion workflow](./13-product-tag-deletion.md) instead names requested IDs,
including missing or already-deleted rows after successful no-op calls. Validate
those IDs against captured inputs of successful outer commands. Its module
events still require actual managed row transitions. This ephemeral evidence is
not persisted step history and introduces no event storage or delivery format.
Do not derive every business event from row changes or let caller metadata
select another scope, event contract or destination.

## Atomic Group And Publication

A group belongs to one root workflow request. It is assembled inside that
transaction and becomes eligible only when all admitted steps/hooks succeed.
The outer owner seals eligibility; no callback invokes subscribers or commits.
Failure discards the group with the database rollback.

No persisted open-group state machine is needed for this atomic profile.
Release/clear methods are refused in this profile. Group strings confer no
authority. No cross-run clearing, pause across commits or after-commit release
is admitted.

The outer owner seals the contribution after module/fact and workflow
validation, then persists it with row facts, result and the common wake.
Contributions bind admission, transaction, lifetime, scope and execution identity
and are consumed once. Event-only publication still needs an authorized producer.
Empty tag input emits no tag events; existing zero-event commands keep their
behavior.

The additive migration adds an immutable committed-event family and durable
delivery state, with a completeness witness associated with the commit. Exact
schema spellings/indexes follow persistence conventions; logical requirements:

- Event identity is scope/epoch/commit sequence/event ordinal, independent of
  name or payload. Preserve observed emission order and distinct identical
  payloads; delivery retries retain the identity.
- Store event-contract identity, producer/workflow revision and group
  correlation, bounded canonical payload/metadata and routing information.
  Missing or extra event rows must be detectable from the committed completeness
  witness. All belong to the authenticated commit.
- Pin the finite subscriber set and handler revision for the committed event.
  Delivery identity includes that subscriber identity. Restart cannot substitute
  an unrelated current handler; missing retained revisions stay pending/blocked.
- Store delivery state, attempt/next-attempt information, claim owner,
  monotonically fenced generation, lease expiry and bounded failure evidence.
  Delivered and terminal-failure receipts are distinct.

This is an additive system migration and shared publication contribution.
Preserve native/Application, CMS, Currency, Product and wake behavior, including
old commits with no events. Do not add business payload kinds to the current
deployment-sync wake decoder or enqueue independently after commit.

## Stored Contract And Bounds

Migration 0091 adds fx_system_commit_event and fx_system_commit_event_delivery.
The existing header records event_count and event_sha256. The digest covers the
canonical ordered envelopes, including payload, routing, contract/producer
revision, group and pinned subscribers. Delivery verifies that digest, contiguous
ordinals, exact subscriber/revision membership and valid delivery state before
claiming. Missing/extra rows and changed payloads fail closed. Partial header
indexes serve event discovery and event-free history compaction so their bounded
pages do not scan long runs of the excluded family.

Capture allows at most 64 messages, 8 subscribers and 65,536 bytes per envelope,
under the existing shared root budget. Claims use database time, a 30-second
lease, monotonic fences and at most 5 attempts. Retry delay grows from 1 second
up to 60 seconds; typed failure codes are bounded and retained. Handler execution
has a 1-second cooperative timeout. Defects/interruption leave a lease for repair.
This bounds trusted work; it cannot preempt arbitrary synchronous JavaScript.

Ordinary commit-history compaction excludes all event-bearing headers, including
terminal deliveries. Root-result expiry is independent. Automatic event pruning
is unimplemented, so this private profile intentionally retains those families.

## Delivery And Recovery

The first host is private and explicitly invoked with a finite subscriber set.
It discovers committed pending work through trusted scope authority, claims in
a short transaction, invokes the destination outside that transaction, and
settles in a fresh short transaction. Never retain the business SQL manager or
scope lock while invoking a subscriber. Reuse authority and database-time rules.

The common wake remains a promptness hint with its existing consumer semantics.
Do not let this pump steal or acknowledge deployment-sync work. Repair discovery
must find pending committed deliveries even when the post-commit call or wake
is lost. Its durable state tracks delivery of the single committed event family;
it is not an independently writable second event feed. The private pump returns a commit cursor: callers scan to the end and restart
from zero on a later repair pass so delayed retries and unavailable handler
revisions are revisited. Each page invokes at most 64 deliveries; it does not
claim ahead while a previous handler runs. Production polling/wake fan-out
remains a later host decision.

Delivery is at least once: destination success followed by a lost acknowledgement
can cause invocation again with the same event/delivery identity. Claim fencing
prevents stale settlement, not duplicate external effects. A Flarex-writing
subscriber should use that identity with an admitted idempotent command in its
own transaction. External destinations require their own idempotency or
reconciliation contract and are outside the first proof.

Store emission order; do not promise global subscriber completion order.
One failed subscriber must not repeatedly invoke another that has acknowledged
the event. Retryable failures remain pending under bounded retry policy;
terminal failures remain visible. Retention cannot delete pending, claimed or
unresolved terminal work, and cannot depend on root-result availability.
Automatic pruning and administrative redrive remain separate gates.

The committed root result stays final if a destination fails. Adapt the pinned
export behavior that calls `flow.cancel` on release failure. Post-commit errors
update delivery evidence; they cannot roll back rows, invoke Product-tag delete
compensation or replace the retained successful workflow result.

## Validation Contract

Prove these with the actual workflow on PGlite and ordinary-role PostgreSQL:

1. Exact names/payloads for both families, one root commit, and no subscriber
   visibility of pending business state before commit.
2. Hook/step/capture/publication failure leaves no business rows, event intent,
   delivery rows or successful outcome. Caught refusal remains fatal.
3. Lost commit acknowledgement recovers original result and events without
   rerunning steps. Root replay adds no event identity.
4. Restart after commit/before delivery discovers work without an in-memory
   buffer, including after root-result expiry. Interruption before commit
   publishes nothing.
5. Claim crash, destination failure, lost acknowledgement and expired lease
   recover with stable identity. Stale workers cannot settle newer claims.
   Partial subscriber success is preserved.
6. Scope, epoch, subscriber revision, producer identity, byte/message bounds,
   malformed stored state, completeness mismatch and unauthorized clear/release
   fail closed. Existing publication and wake proofs remain intact.

Migration, capture, durable pump and actual workflow form one completion
contract. An emit mock, local callback or happy path alone does not close it.
