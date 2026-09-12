# Commerce JSON Identity And Retained Outcomes

Status: proposed; implementation approval pending. This is the focused shared
owner correction exposed by approved preflight 59 A. It does not approve native
Link cardinality changes, ShippingProfile activation, or a new execution profile.

## Outcome And Why Now

Let the existing single-module and atomic commerce commands carry their declared
bounded JSON inputs and outputs, including native Medusa operator objects and
well-formed Unicode field names. Preserve exact request identity, conflicting
key refusal, atomic publication and verified result replay in their current
owners. Application runtime values retain their existing codec and semantics.

The immediate consumer gate is preflight 59 A's Sales Channel and stored Link
inequality reads. SQL inequality is implemented in the pending slice, but these
root reads fail before native dispatch. Native Link's internally constructed
cardinality query does not itself cross the root argument boundary: the witness
does not establish that every ShippingProfile workflow necessarily hits this
failure. It establishes a shared mismatch in the commerce command JSON contract,
which should be corrected before claiming the connected prerequisite complete.

## Authority And Exact Evidence

Accepted boundaries are `design-notes/flarex-db-accepted-design.md` (reserved
commerce data, shared publication, distinct execution profiles) and
`roadmaps/16-package-boundaries.md` (framework translation above persistence).
The integration owner is roadmap 06 and preflights 47/59. Medusa's exact baseline
remains the fork recorded in `third_party/medusa/SOURCE.json` at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, baseline 2.13.4. The executable native
`packages/medusa-modules-sdk/src/link.ts` constructs `$ne` existence filters.

The preserved authored witnesses are:

- `packages/medusa-adapter/test/product-sales-channel-link.test.ts`: a root
  Link count with `sales_channel_id: { $ne: ... }` should return filtered rows
  and the pre-pagination count.
- `packages/medusa-adapter/test/sales-channel-binding.test.ts`: the same operator
  on the explicitly admitted Sales Channel ID should execute through its own
  profile, without granting inequality to arbitrary fields.

Their recorded failure is `CommerceTransactionError(reason: invalidAuthority)`
with `CommitProtocolV1Error(issue: invalidValue, component: successfulResult,
path: $)`. The previous implementation turn executed these witnesses; this
preflight is source research, not a new database validation run.

| Current owner | Coupling that must be addressed |
| --- | --- |
| `commerceTransaction/host.ts` | Identity/access policy, command envelope including JSON arguments, and successful result all use `canonicalizeSuccessfulResultV1Effect`. Retained results return `valueJson` directly. |
| `atomicCommerce/configuration.ts`, `request.ts`, `execution.ts`, `host.ts` | Policy/event/budget identity, request evidence, result encoding and retained replay have the same Application-value coupling. |
| `flarex-protocol/src/commit-protocol.ts` | The successful-result API deliberately encodes Application runtime values, not arbitrary ordinary JSON. Its JSON-named verifier still verifies a Flarex value envelope; it is not an ordinary-JSON alternative. |
| `flarex-protocol/src/value.ts` | Application object fields deliberately reject reserved `$` prefixes and non-ASCII/control field names. These are not Medusa bugs and must not be relaxed globally. |
| `commitPublication/scopePublicationModel.ts`, `publication.ts` | Shared contribution types refer to Application result evidence; publication hardcodes the Application value-codec version for every outcome. |
| `schema.ts`: `fx_system_idempotency` | Available outcomes require `result_value_codec_version = 1`. No ordinary-JSON result encoding is represented. |
| `committedPointOutcome.ts` | Bounded SQL transfer checks, scalar validation and byte/digest verification all assume Application value evidence. Changing only the commerce writer would break replay. |
| `pointCommitTransaction.ts` | Its under-lock outcome inspection shares scalar evidence validation. It must remain explicitly Application-only after a new result encoding is admitted. |

All persistence paths above are under `packages/persistence-postgres/src/`.
CMS and cross-domain hosts also call the Application canonicalizer. They are
connected regression consumers, not automatically migrated JSON profiles here.
Application transaction/session/stored-attempt result evidence remains unchanged.

## Recommended Design

### One bounded JSON identity path in the existing commerce owner

Reuse `privateJsonData.ts` for detached, no-getter, bounded capture and the
existing `flarex-protocol/json` canonical ordering/UTF-8 measurement and encoding.
Reuse the existing private hashing owner. Do not invent a new JSON serializer,
filter codec, universal transaction API or per-module hash function.

Replace Application-value canonicalization of commerce policy and command
identity with canonical JSON bytes under fixed, non-JSON domain prefixes. Bind
the domain and chosen result encoding into the authenticated identity contract.
Use distinct domains for policy identity and single/atomic request evidence.
Retain every existing scope, epoch, generation/fence, installation, binding-head,
operation, participant, command/profile, event/subscriber/revision and explicit
call-budget identity input. Do not move authority acquisition or lock order.

The non-JSON prefix prevents an arbitrary old policy object or string from
impersonating the new hash preimage. Preserve semantic distinctions between
omitted and explicitly selected resource profiles. This replaces the current
commerce identity encoding; it is not a fallback or compatibility comparison.

### Ordinary JSON results in the shared retained-outcome owner

Extend the existing outcome contract with two real semantic encodings:
`application-value` and `json`. This is a closed encoding distinction, not an
entity discriminator or pluggable codec registry. The JSON encoder/verifier
belongs with persistence outcome evidence; both commerce hosts consume it.

For JSON results, store the ordinary canonical JSON UTF-8 bytes directly and
hash those exact stored bytes. Do not stringify JSON into an Application string,
encode it as Application bytes, escape object keys, or nest a compatibility
envelope just to pass the wrong value validator. Reuse the canonical JSON owner;
the result evidence type, verification and lifecycle remain outcome-owned.

The selected JSON contract is finite JSON primitives, dense arrays and captured
plain records, with well-formed Unicode keys/strings. `$ne`, `$in`, `$or`, and
objects resembling Application encoded-value markers remain ordinary JSON data.
No bigint, Date, undefined, functions, getters, sparse arrays or arbitrary class
instances are added. Preserve byte/depth limits and refusal of ill-formed Unicode.
Use the owner's existing JSON number normalization, including `-0` to `0`, and
make fresh and replayed results agree. JSON result size accounting is canonical
UTF-8 byte length, bounded by both the selected commerce budget and the existing
shared result/evidence ceilings; no limit increase is authorized.

The result decoder must bound transfer before parsing, decode UTF-8 strictly,
validate the JSON contract and canonical re-encoding, verify the digest, and
check the recorded size. Malformed stored evidence is corruption, not absence
or a retry invitation. Preserve defensive byte ownership and full unexpected
defect/interruption behavior. Correct malformed caller-data classification at
the JSON boundary; do not preserve a misleading `invalidAuthority` merely because
the old Application codec emitted it. Tests must retain refusal, not accept
formerly malformed data under a new spelling.

Choose the expected encoding at trusted resolver construction, with narrow
Application and JSON entry points if that keeps callers clearer. Share the
existing bounded query and evidence-verification mechanics. Never infer the
encoding from module names, function-path prefixes, caller payload shape or
trial decoding. Mismatched encoding fails closed before result-byte transfer.
Application callers remain Application-only; commerce selects JSON explicitly.
Returned domain values and replay behavior must not depend on fresh versus
retained execution.

### Schema And Migration Decision

Add one semantic `result_encoding` field to `fx_system_idempotency`, with a
closed `application-value`/`json` check. Retain it when an outcome expires, so
the expected family can still be checked without retained result bytes.

- Existing records are labelled `application-value`; do not re-encode their
  bytes, digests, request hashes or commit tokens.
- Available Application records retain value-codec version 1 and their exact
  existing validation and semantic-byte interpretation.
- Available JSON records have no Application value-codec version. Their bytes,
  digest and canonical-JSON byte count are required and bounded.
- Expired records retain only the encoding and existing expiry/identity/token
  evidence; result bytes, digest, size and Application codec version are null.

The shared publication contribution carries properly constructed encoding-aware
result evidence. Publication writes that evidence; it no longer hardcodes every
outcome as an Application result. App-specific brands and evidence types must
not be asserted onto ordinary JSON bytes. Keep common byte/size mechanics neutral
and the two decoder contracts explicit. Update shared SQL transfer guards,
captured scalar validation, expiry fixtures and the point-commit inspector
together. Unknown or contradictory encoding/state/version combinations must
fail both database checks and resolver validation.

This schema extension needs approval. It adds neither a commerce-only outcome
table nor another publication/retention/recovery path. Choose the next migration
number only when implementation starts; preserve existing migration history.

## Compatibility And Cleanup

The user has described development-only commerce integration without production
data. This proposal relies on clean replacement of the private commerce encoding,
not on replaying its old keys under new semantics. Application compatibility is
a real, separate contract and is retained.

| Classification | Decision and gate |
| --- | --- |
| Retain | Application value codec, successful-result wire evidence, point/session/stored-attempt contracts, existing Application outcome bytes and verified replay. Prove these unchanged through owner regressions. |
| Extend | Shared idempotency schema, publication contribution and bounded resolver for explicit JSON result evidence. Keep one settlement and recovery owner. |
| Replace | Single and atomic commerce policy/request/result encoding and replay selection. Both must switch coherently; callers keep ordinary JSON APIs. |
| Delete | Displaced commerce Application-encoding calls and obsolete identity assembly after replacement tests pass. No old/new comparison, wrapper decoder, new V2/V3 API or registry. |
| Defer | CMS/cross-domain JSON activation, native Link's same-batch correction, ShippingProfile, broader module filters, full Product workflow and production exposure. Run shared-consumer regressions without silently widening their contracts. |

Do not automatically delete databases, outcome rows or user data. Existing private
commerce outcomes remain labelled by their actual old Application encoding;
reusing their key with a new commerce identity must conflict, never re-execute or
reinterpret the stored result. New development proofs use fresh configured
fixtures/keys. No commerce legacy reader is retained. If a live compatibility
obligation is discovered, stop for a revised decision rather than adding dual
behavior. Existing supported Application APIs may keep concrete compatibility
version names; new current helpers use semantic unversioned names.

## Validation And Completion Gates

1. Keep the two failing native-root inequality assertions. Add independent neutral
   single and atomic command witnesses for JSON arguments, results and policy
   identity before correcting each path. Exercise a scalar result, arrays,
   `$`/Unicode keys and encoded-marker lookalikes without Medusa imports in core.
2. Prove canonical key-order stability, changed array/value distinction, number
   normalization, domain separation from old identities, and unchanged binding,
   participant/event/revision/resource-profile identity sensitivity.
3. Prove fresh result equals stored replay; reused keys with changed arguments,
   identity or encoding refuse; replay after uncertain settlement performs no
   second mutation/publication; retained/expired/corrupt outcomes stay distinct.
4. Validate both encoding families, migration/backfill of available and expired
   records, malformed combinations, bounded result transfer, wrong-family
   refusal before decoding, canonical/digest/size corruption and byte ownership.
   Preserve Application result evidence and under-lock outcome tests unchanged
   except explicit encoding metadata needed by the shared schema extension.
5. Preserve late/caught-failure rollback, cancellation/escaped resources, scope
   isolation, settlement and publication behavior. No transaction is held over
   new remote work; no owner or budget is added to make a test pass.
6. Run focused PGlite and ordinary-role PostgreSQL lanes separately for both
   single/atomic owners, shared publication/outcome/migration, and the pending
   Medusa consumers. Finish preflight 59 A's full validation, promotion receipts,
   source/portability guards, affected typechecks, core/diff lint, both project
   reviewers and exact staged checks before one coherent implementation commit.

The pending inequality implementation is not complete until the connected
read witnesses pass through their real root APIs. This preflight does not turn
native Link's expected-failing cardinality witness into supported behavior.
Return for its separate correction decision before ShippingProfile activation.
