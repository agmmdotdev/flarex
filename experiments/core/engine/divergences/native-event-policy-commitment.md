# Native event policy and committed request identity

Status: **Challenged bounded replacement implemented with paired neutral,
cold-dispatcher and admitted native workflow proof; populated conversion remains gated.**
Owner: [ordinary native workflows and Tax](../slices/17-native-atomic-workflows-and-tax.md).

## Source mechanism and native need

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` stages private/system
documents in the same transaction and publishes them through one accepted write
set and fenced persistence batch. It supplies no Medusa producer revision,
contract, subscriber or delivery policy. The existing
[native event owner](./native-durable-event-delivery.md) provides those native
semantics over logical records in the five physical tables.

Its selected Native16 source binds one exact policy in the installed source.
Ordinary admitted workflows in one app prepare distinct producer revisions,
contract subsets and subscribers. Installing a separate app/event source per
workflow, or mutating an installer-owned policy roster at runtime, would change
the existing native composition lifecycle. A fixture policy registry is not a
replacement for the shared owner.

## Selected replacement

Preserve the fixed-policy source and stored shapes for its actual existing
consumers. Add a stable, explicitly distinct root-bound private event storage
definition for fresh ordinary workflow instances. It uses the same three logical
event families over the existing physical tables; its family record carries the
private committed-request linkage. This is a real coexisting storage contract,
not a second persistence engine or an automatic populated-source conversion.

The trusted prepared workflow's exact event policy is part of its canonical Core
root contract. Only actual issued event operations under the current root claim
can obtain the owned request evidence: scope/epoch, root definition hash, request
key/hash and canonical root metadata frame. The frame contains prepared contract
and source/command metadata, not business arguments or callback state. Persist
its exact canonical JSON as bounded text, using the existing packed-metadata
pattern, so metadata depth does not become a new document-depth limitation.
Decode through the authoritative schema, require canonical text and independently
verify the frame digest. Do not let a caller supply an arbitrary expected policy
to stage storage.

Derive the family ID from the canonical scope/epoch/root-hash/key/request-hash
identity. On cold reads, the Core owner independently hashes the owned metadata
frame and resolves the actual committed native-root request for that correlation
in the same app namespace. Only that committed contract supplies the expected
policy. Verify the derived family ID, envelope request group, producer/contract/
subscriber identities, family digest and delivery records through existing owners.
Historical profile withdrawal does not require rebuilding a live policy roster.
No-event workflows produce no family. Complete native outcome DTOs stay unchanged.

Cold family discovery and direct reads select the same strict header decoder
from the authenticated storage definition. Discovery supplies only a cursor;
delivery still verifies the committed root and historical subscriber policy
before claiming and acknowledging work through the existing dispatcher.

An event header cannot authorize its own policy. Changing its policy and envelopes
and recomputing their digest must fail against the actual committed root. Linking
family A to another committed root B must fail the deterministic family identity
or group check. This retains the existing fixed-policy corruption boundary; it
does not claim cryptographic detection of an attacker who consistently rewrites
all authoritative database data, or stronger same-policy payload guarantees than
the fixed-policy owner supplies.

Capture/share the immutable prepared metadata once, charge real retained bytes,
and respect current root-frame/document/request ceilings. Oversized metadata must
refuse before native hooks; do not raise limits or add a duplicate configuration
registry to make fixtures pass. Current committed request anchors must remain
available for required family verification/delivery; any later outcome retention
must preserve that relationship before activation. No implicit request TTL is
introduced by this extension.

## Required proof and cutover

Use independent neutral same-app workflows with different exact policies,
duplicate contract names across policies, empty events, forged operation evidence,
policy/producer/subscriber mismatch, coordinated tamper, committed-root transplant,
foreign namespace, lost ACK and cold historical reads after profile withdrawal.
Include nonempty discovery through the actual dispatcher, durable acknowledgement
of the original subscribers and a repeat scan with no redelivery.
Repeat through genuine Product/Currency and complete Tax workflows on PGlite and
ordinary-role PostgreSQL. Keep original fixed-policy Native16 event/recovery tests
and unchanged outcome shapes. Migration of populated fixed-policy event data is
a named later cutover gate, not a reset authorized by fresh fixture installation.

The [event definition](../../../../packages/persistence-postgres/src/commit/events/coreDefinition.ts)
authenticates the fixed/root-bound storage mode. The
[event store](../../../../packages/persistence-postgres/src/commit/events/coreStore.ts)
stages actual issued evidence and verifies cold families against the committed
request through the [Core root identity owner](../../../../packages/persistence-postgres/src/core/nativeRootRequest.ts).
The [ordinary native execution owner](../../../../packages/persistence-postgres/src/frameworks/atomicCommerce/nativeExecution.ts)
prepares one family in the same root and preserves complete outcomes.
