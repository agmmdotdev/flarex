# Native API Key module and workflows

## Status and authority

Status: the bounded private publishable API Key module and all five workflow
roots are implemented with PGlite and ordinary-role PostgreSQL execution proof.
Original failing native controls remain separate from the approved corrected
creation and Link controls. The native Link owner retains durable operation
receipts and pair revisions, with bounded ordinary-role PostgreSQL proof for
concurrency, fencing, replay, response loss and publication after commit.
Native Link PGlite execution remains unavailable for its generated MikroORM
EntitySchema; the private borrowed Link profile has both-driver adapter proof.
Current-source Pingdotgg Rust semantic checks, native package emission, source
provenance and focused review establish this finite private slice. They do not
establish arbitrary Medusa modules, hosted execution, Worker secret keys or
storefront authentication. API Key ownership is independent of concurrent Order,
Cart, Tax and Payment implementations in the same checkout.

The reference is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, authenticated by
`third_party/medusa/SOURCE.json` and `SOURCE_SHA256SUMS`. Accepted shared logical
storage, module-owned commerce semantics and the existing trusted outer
transaction/workflow owner remain authoritative. This work changes no Convex
developer-facing API or native Application OCC profile.

## Selected connected outcome

The bounded private outcome is native publishable API Key creation, lifecycle
management and association with existing Sales Channels. The source contains
five roots: `createApiKeysWorkflow`, `updateApiKeysWorkflow`,
`revokeApiKeysWorkflow`, `deleteApiKeysWorkflow` and
`linkSalesChannelsToApiKeyWorkflow`. Admission covers these exact private roots and their checked profiles; the
presence of other workflows in the pinned source island grants no admission.

Native API Key persistence has one `ApiKey` model: generated identity, token,
salt, redacted token, title, type, last-use time, creator, revoker, revocation
time and managed timestamps/deletion. Token uniqueness, revocation/type indexes
and managed-field behavior belong to checked native DML and shared persistence.
The separately stored `PublishableApiKeySalesChannel` Link connects API Key and
Sales Channel identities; it is not an API Key-local relation pivot.

Creation resolves only `Modules.API_KEY`, calls the native module with the input
array, returns complete native DTOs and retains the created IDs. The root also
composes the native `apiKeysCreated` hook. Empty creation still resolves the
module and invokes its method; empty retained compensation returns before
resolving the module.

Update derives its preimage projection from the actual update shape, lists the
matching keys, updates them and retains their previous data. Its original undo
upserts the retained IDs and titles. Revocation and deletion are explicitly
`noCompensation` steps; cancellation does not imply unrevoke or row recreation.
Deletion also invokes the common remote-Link removal step. Those lifecycle
choices require separate evidence from atomic transaction rollback.

The private workflow SDK records `noCompensation` on a staged step invocation.
The source adaptation retains that flag for revocation and deletion at the
invocation, erases their empty compensators and supplies the SDK's explicit
void `WorkflowResponse` for deletion. The full source guard authenticates these
exact changes. Creation, update and Link association keep their genuine
retained inverses with explicit transaction-covered admission.

Sales Channel association always resolves and calls the native Sales Channel
validation step, including an empty `add` array. The Link step resolves LINK
before its empty-input guard. Nonempty addition/removal calls genuine Link
create/dismiss; retained undo dismisses created links and recreates dismissed
links. Both-driver controls cover empty branches, partial failures, already-present
and missing links, retained inverses, replay and superseded compensation within
the checked association profile.

## Native creation-compensation mismatch

The original `createApiKeysStep` retains only key IDs and compensates by calling
`deleteApiKeys(createdIds)`. The module's ordinary deletion method first lists
keys whose `revoked_at` is null or later than the current time. If any exist it
throws `MedusaError.Types.NOT_ALLOWED` with
`Cannot delete api keys that are not revoked` before calling generated physical
deletion. Original PGlite and ordinary-role PostgreSQL execution confirm that fresh publishable and secret
keys remain unrevoked and stored when retained creation cancellation fails.
A deliberately failing parent reaches the genuine child inverse and also
leaves its created key active. Normal deletion, successful update undo,
irreversible revocation and scheduled-revocation deletion refusal remain
separate native controls.

The original module integration tests explicitly revoke both publishable and
secret keys before successful deletion and separately require unrevoked
deletion to fail without removing rows. The ordinary deletion restriction is
intentional native behavior, not an accidental adapter incompatibility.

The native creation step and native API Key module own this mismatch. An
adapter must not bypass it with direct SQL, quietly revoke keys, weaken the
normal deletion guard, suppress compensation errors or substitute whole-root
rollback for retained native undo.

An original-runtime witness must establish both a separately committed
creation/cancellation and a late failing parent, including the remaining stored
keys, compensation handler errors, normal deletion restrictions and unrelated
row preservation. Original and corrected-native witnesses must remain distinct.
The SDK's public `errors` field selects invocation errors; compensation evidence
must also inspect the native transaction's complete error list and state.
The original failing parent's SDK wrapper reports `Unknown error` for the child
compensation failure. A diagnostic wrapper observes the genuine deletion
rejection and rethrows the same error with the original receiver and arguments;
it does not replace that SDK result or alter the native function body.

The owner approved the first of these native-owner corrections:

- A dedicated creation-compensation operation could reuse generated physical
  deletion inside the native module transaction while preserving ordinary
  guarded deletion. This introduces an explicitly privileged inverse contract
  that must be confined to the retained created identities and shared request
  authority. It does not invent revocation attribution or revocation events.
- Explicitly revoke and then normally delete the created keys. The current
  retained IDs do not identify a revoker; choosing the original creator changes
  the retained payload. Revocation adds update events and must handle missing,
  immediately revoked and future-revoked keys. Blindly replaying revocation is
  invalid for already-revoked secret keys. Two independently committed calls
  also introduce a revoked-but-not-deleted partial outcome requiring recovery.

The selected operation is `revertCreatedApiKeys`, with a native transaction,
native deletion events and generated physical deletion. Its public service
type must declare the operation explicitly; the ordinary `deleteApiKeys` guard
and method remain unchanged. No revocation actor or revocation update is added.
Missing identities are a no-op; already-revoked and future-revoked created keys
must also be removed, with unrelated rows preserved. Only trusted retained
creation compensation may expose this operation; it must not become an
ordinary user-dispatchable deletion command or a generic force flag.

The second alternative is not selected. The private adapter confines the
corrected native inverse to trusted retained creation compensation.
Corrected-native controls on both drivers prove deletion-only events, successful retained
cancellation and late-parent cleanup, missing-ID replay and deletion after
immediate or scheduled revocation. Their original failing controls remain
separate. This proof does not establish the later adapter boundary or general
Link-bearing cancellation.

The connected Link roots retain a separate original-native SQL preflight.
Their generated native model is a MikroORM EntitySchema; the pinned PGlite
module test adapter accepts portable DML models. A substitute model would not
establish compatibility with that native generated mapping. The prepared
original-Link baseline therefore targets ordinary-role PostgreSQL and makes no
native PGlite Link claim. Both-driver private-adapter validation remains required.

## Native Link compensation blockers

Status: original ordinary-role PostgreSQL execution confirms four native-owner
failures. Empty association cancellation and cancellation of a genuinely new
association remain positive controls. Existing unrelated key and Link rows are
preserved. The owner explicitly approved the native corrections below. Corrected-native
execution and both-driver private-adapter validation establish bounded
association and guarded deletion with API-only irreversible Link cleanup.

| Trigger | Required result | Original native result |
| --- | --- | --- |
| Add an already-active association, then cancel | Preserve the preexisting association | Cancellation dismisses it |
| Remove an absent association, then cancel | Keep it absent | Cancellation creates it |
| Add a duplicate pair while removing another association | A failed workflow preserves the original association | Create rejects while the parallel dismiss remains committed; the failed step has no retained inverse |
| Delete a revoked associated key, then cancel | Preserve irreversible key deletion without dangling active associations | The key remains deleted while remote-Link compensation restores its association |

The association step retains requested operations rather than actual changes.
The original starts create and dismiss concurrently and returns compensation
data only after both finish. The API Key association step/workflow owns actual-preimage
selection, retention of real changes and compensation of completed operations
when a later operation fails. The native API Key deletion workflow separately
owns alignment of remote-Link cleanup with its explicitly irreversible key
deletion. The shared remote-Link removal step remains compensatable for its
other callers; changing its global behavior would exceed this correction.
API-only irreversible Link cleanup must depend on successful guarded key
deletion: an unrevoked-key refusal must preserve existing associations. Merely
disabling its compensator while retaining independent execution would introduce
another partial-failure bug. Cleanup failures must remain visible and require
an explicit recovery disposition; separate native calls do not become atomic.

The original authenticated SQL witnesses remain separate from any corrected
candidate. A correction must use genuine native Link operations and native
workflow compensation, preserve failures and event behavior, and establish its
own original/corrected controls before dependent adapter work resumes. Adapter
SQL, fabricated preimages, input refusal that hides these native cases, and
whole-root rollback substituted for retained compensation are not corrections.

The approved candidate retains native association-presence preimages and uses
the native failed-step response contract to compensate completed or uncertain
create/dismiss operations. Sequential mutation calls preserve a deterministic
remove-after-add order. The compensator reconciles actual native state against
only those targeted preimages, preserving unrelated associations. A dedicated
API Key cleanup step follows successful guarded deletion, has no inverse, and
surfaces native cascade-error tuples. A subsequent explicit deletion request
can retry Link cleanup for an already-deleted key. Corrected ordinary-role
PostgreSQL controls establish these single-workflow behaviors, including
successful no-op invocation and clean cancellation. The common removal step is
unchanged.

A separate genuine native two-workflow barrier exposes an additional ownership
defect in this candidate. Both workflows read the same pair as absent, both
native creates succeed, and cancelling the second workflow removes the first
workflow's successful association. Current-state reconciliation against a
Boolean preimage cannot distinguish that association's owner. The native Link
mutation/serialization owner must provide atomic capture and mutation plus a
fenced, recoverable compensation outcome, or admission must enforce a precise
serialized lifetime that excludes later retained cancellation. Existing row IDs
and millisecond timestamps are not a universal revision: native restore may
preserve the ID. No generic receipt/fence contract is established by the
single-workflow controls. The approved durable correction below owns this race; the presence-only
candidate remains inadmissible.

### Approved durable Link operation correction

The owner approved durable native operation receipts and fenced compensation.
The presence-only candidate is insufficient and must not be admitted. The
selected native Link profile requires two new native DML records alongside its
rich Link rows: an operation receipt keyed by the invoking step's stable
identity, and a pair revision keyed by the native service and normalized
endpoint tuple. Pair revisions survive physical Link deletion. These records
belong to the native Link owner, not the adapter or workflow host.

Every mutation route in the enabled family, including ordinary create,
dismiss, soft deletion, restoration and physical deletion, must rotate a fresh
pair revision in the same transaction as its Link change. Native construction
must refuse missing or mismatched revision dependencies. An existing row ID or
timestamp is not the fence. Existing unrelated Link profiles retain their
current model and admission; no deployed profile, durable table or data is
silently migrated or reset.

A named operation routes to exactly one native Link module. Native standalone
execution owns a serializable transaction and refuses externally supplied
transactions. The private profile borrows the existing authenticated scope
exclusion and outer root; a profile string does not establish that authority.
The adapter introduces no additional transaction, SQL enforcement, settlement
owner or recovery loop.

Apply persists its exact ordered request, actual changed pairs, previous
presence, resulting revision and native event intent atomically. Same-identity
replay returns its durable outcome; changed-request replay refuses. A terminal
cancelled or compensated operation never reapplies. Compensation uses the
retained invocation identity, because the native SDK's compensation handler has
a different idempotency key. The private finite SDK must derive step identity
from trusted root identity and complete prepared-node occurrence paths, without
depending on names, object identity or completion order.

Undo verifies every affected pair's revision before changing any pair, then
persists its compensated state atomically with the inverse. An intervening
mutation is an explicit conflict, including restore/dismiss ABA and a later
write that happens to reproduce the same presence. A durable compensated
receipt is the retry witness after an undo response is lost. An absent receipt
does not by itself prove rollback while apply may still finish; a committed
terminal cancellation record must arbitrate that operation identity against a
late apply before reporting not-applied.
Cancellation retains the exact request too; a changed-request retry or inverse
cannot reuse that identity against an earlier operation. Durable changes must
belong to the retained request and match its add-then-remove final target.

The private outer publication owner retains atomic event authority. Native
standalone event intents and stable identities do not establish exactly-once
delivery or remove its commit-to-publication recovery limit. Native proof must
keep regular-writer event publication after its owning transaction outcome;
collecting those events inside the transaction does not authorize publication
before a successful commit. Durable intents preserve native event boundaries:
one event per action batch, with a scalar ID for one row or an ordered ID array
for multiple rows. Compensation dismisses new associations before restoring
prior associations. The ordinary builder and durable protocol reuse the native
event payload projection. The private borrowed profile captures these events
through the existing outer publication owner.
Native proof must
separate transaction rollback, uncertain apply, uncertain undo and publication
outcomes. The native receipt/revision owner and its corrected concurrency,
replay, response-loss, all-writer and bulk-publication witnesses are implemented
and have bounded ordinary-role PostgreSQL proof. The private borrowed integration has bounded both-driver proof. This does not
establish native Link PGlite support, arbitrary batch scale or standalone
commit-to-publication recovery.

## Association request profile

The genuine four-add/four-remove association exceeds the ordinary 64-call
request allowance. Its default-profile refusal remains a separate control and
must leave the complete logical inventory unchanged. This is bounded native
composition cost, not evidence of a shared persistence defect.

Association selects the named 128-call allowance through the existing trusted
workflow policy and atomic host. The atomic owner includes this selection in
request identity, enforces it and preserves physical participant caps. Business
inputs cannot select a limit. Four additions, four removals, 64 events, ordinary
byte/deadline limits and the genuine retained inverse remain bounded separately.
Creation, update, revocation and deletion keep their existing selections.

The native protocol retains the initial combined sorted rotation and individual
cold or mixed head writes. Only heads actually written and reread-verified may
be reused within the exact active transaction; absence and ordinary read-only
observations are not cached. Existing wholly held head updates retain fresh
nonces, invalidation before writing and complete verification before cache
refresh. This work makes no further native fencing or performance change.
The named maximum forward, replay and retained inverse have both-driver private
adapter proof. The ordinary default-budget refusal remains a separate control.
Native Link keeps CommonJS output with package-local NodeNext resolution;
emitted-package imports and declarations remain separate validation gates.

## Association default compatibility

The pinned workflow applies `input.add ?? []` during composition, when `add`
is a deferred reference. An omitted addition therefore reaches the native Sales
Channel method as an own `id: undefined` selector and reads unrelated channels.
The exact private read profile correctly refuses the resulting omitted ID.
The original native read and private refusal remain preserved witnesses.

The native workflow candidate now resolves `add ?? []` with its existing
runtime `transform` owner before validation. An empty or remove-only request
uses the exact empty selector and reads no channels. This intentionally changes
the accidental read footprint; the public void result, nonempty-add validation,
Link request and retained compensation handle are unchanged. The validation
step itself is unchanged, and its unused output grants no compatibility
obligation to the broad read. No adapter wildcard, global SDK default or new
workflow step is introduced. Corrected native and private validation cover this default resolution, the
named maximum-cohort allowance and the separate default-budget refusal.

## Shared serializer prerequisite

The native API Key module serializes scalar rows with `{ populate: true }`.
The shared scalar repository previously refused every defined serializer option;
adapting API Key by dropping that argument would conceal the owner mismatch.
The neutral `scalar-serialization-options.test.ts` witness targets the existing
scalar owner directly, with all database operations scripted to fail.

The selected correction admits exactly this option only through an explicit
checked native DML profile with no relationships and no foreign keys. The base
scalar table type deliberately omits relationships and grants no such option.
The correction validates the supplied partial or
complete scalar rows against the existing DML projection contract, and preserves
detached mutable native DTOs and normal request bounds. Native API Key formatters
mutate their serialized DTOs; private canonical capture stays separate.
Relationship-bearing profiles, unknown
flags, accessors and corrupt projections retain refusal. It does not add relation
population, database lookups or another serializer authority. The shared
creation-presence work remains with its separate owner and must be preserved.
The neutral witness reached this refusal while its ordinary undefined-options
control passed. The shared correction has neutral serializer controls and
both-driver native creation and lifecycle consumer proof. The witness harness
uses the real Result-to-Effect boundary.

## Native revocation query gate

Native revocation validates selected secret keys with `revoked_at < new Date()`
even when the requested keys are publishable. The shared query owner previously
admitted timestamp greater-than but refused less-than. A neutral indexed timestamp
witness preserves this failure; native validation must not be skipped or
reimplemented in the adapter. The [shared timestamp comparison preflight](../../shared-logical-storage/indexed-timestamp-less-than.md)
owns the explicitly approved and implemented correction, with both-driver
validation. Creation does not depend on that query extension.

Native revocation queries and updates pass genuine Date values. The API Key
boundary uses the existing native date-record capture for `revoked_at` and its
comparison operands before ordinary JSON queue capture. Other values, managed
timestamps, descriptor checks and resource bounds retain their usual owners;
this does not grant general Date coercion to shared JSON or bypass scheduling.

The lifecycle profile selects at most four explicit IDs and admits title
updates, retained title restoration, native revocation and guarded native
deletion. Creation compensation is absent from that profile. The retained
upsert's ignored return still undergoes complete native row validation before
the private transport discards it. Bounded creation, title update with retained
restoration, and revocation have both-driver execution proof. The connected association and guarded deletion profiles have separate
both-driver execution proof. Deletion receipts correlate complete native
preimages by identity while preserving scalar receipt ordinals and native DTO
ordering; caller selector order does not define DAL deletion order.

## Runtime and security boundaries

The private module uses the existing portable joiner builder with the same
`ApiKey` model explicitly supplied. This replaces native Node filesystem model
discovery; it does not change linkable keys, model identity or business methods.
The source guard authenticates this exact adaptation and the native inverse.

Publishable generation uses cryptographic randomness and a `pk_` token whose
stored and initially returned forms are the same. Secret generation uses an
`sk_` token, random salt and scrypt; subsequent native reads suppress the secret
token and salt. A Node secret-key control does not establish Worker secret-key
support: the pinned crypto helper explicitly refuses secret generation without
a scrypt-capable runtime adapter. The first proposed Worker-capable slice is
publishable keys; secret-key support retains a separate runtime gate.

Never log tokens, salts or hashing inputs in preflight reports. API Key records
and Links remain authenticated commerce data; generating a key does not by
itself install storefront HTTP authentication, authorize a caller, activate
Sales Channel visibility or grant access to raw database/finalizer capability.

## Remaining activation gates

Preserve the separate original and corrected-native controls, genuine retained
inverses, event correlation, replay, late-parent rollback, ordinary deletion
restrictions and confinement of the privileged creation inverse. Keep the named
association allowance and its default-profile refusal explicit.

The admitted slice remains private and bounded. Worker secret-key generation
requires a scrypt-capable runtime adapter and separate proof. Hosted execution,
storefront authentication, broader module/workflow profiles, arbitrary batch
scale and standalone native Link commit-to-publication recovery retain their
own activation gates. Reuse existing DML lowering, checked receipts, native
events, queued workflow scheduling and shared logical persistence when extending
this outcome.

The other sessions' source, shared metadata, staged work and runtime resources
retain their existing owners. Use Pingdotgg Rust `tsc-rs` for typechecks and
coordinate shared validation and metadata changes in this checkout.
