# Native Fulfillment delivery preflight

Status: implemented as private bounded native Delivery integration. One existing
Fulfillment with up to four Items and four Labels runs through the genuine
durable parent and stored update child, trusted Task execution and short
authenticated commerce calls. The native owner correction is explicitly
approved. General coordination, in-flight claim recovery and public/hosted
activation remain separate.

## Native authority and connected closure

Authority is Medusa 2.13.4 at pinned revision
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` in
`third_party/medusa/SOURCE.json`. Paths below are relative to
`third_party/medusa/upstream/`.

- `packages/core/core-flows/src/fulfillment/workflows/mark-fulfillment-as-delivered.ts`
  exports `markFulfillmentAsDeliveredWorkflow`, with native ID
  `mark-fulfillment-as-delivered-workflow`. It acquires the fulfillment ID lock
  with timeout 2 seconds and TTL 10 seconds; executes singleton RemoteQuery for
  `id`, `delivered_at`, `canceled_at`; validates deliverability; generates
  `delivered_at: new Date()`; runs `updateFulfillmentWorkflow` as a child;
  releases the lock; and returns the actual updated DTO.
- The same file owns `validateFulfillmentDeliverabilityStep`: canceled wins
  over already delivered. There is no shipped, packed, Option or provider
  eligibility guard.
- `packages/core/core-flows/src/common/steps/use-remote-query.ts` calls the
  genuine callable Query with `entryPoint: "fulfillment"`, `variables: { id }`,
  the three fields, and `throwIfKeyNotFound: true`, returning the first entity.
  The executing owners are `packages/core/modules-sdk/src/remote-query/query.ts`
  and `remote-query.ts`, including the native RemoteJoiner and real module
  fetches. Observed module fetch is `FulfillmentModuleService.listFulfillments`,
  with an ID array, the three selected fields, no relations and `take: null`.
- `packages/core/core-flows/src/locking/steps/acquire-lock.ts` and
  `release-lock.ts` use the native Locking service. Acquire retries at the
  default 0.3-second interval using `timers/promises`; its compensation releases
  the retained keys. Release has no inverse. Both steps skip in a child when
  the real context supplies `parentStepIdempotencyKey` and
  `executeOnSubWorkflow` is absent.
- `packages/modules/locking/src/loaders/static-providers.ts`,
  `services/locking-provider.ts`, `services/locking-module.ts` and
  `providers/in-memory.ts` own actual registration, provider selection,
  acquire/release, expiry and ownership behavior.
- The existing `fulfillment/workflows/update-fulfillment.ts`,
  `fulfillment/steps/update-fulfillment.ts` and native
  `packages/modules/fulfillment/src/services/fulfillment-module-service.ts`
  retain their retrieve, projected preimage, hydration, update, serialization,
  event and inverse responsibilities. The reached transform Date is serialized
  by the native SDK before the service call.

## Immutable native evidence and boundary

Packet: `%TEMP%/flarex-145-native-fulfillment-delivery-witness`.
Runner SHA256:
`93ec1f94a96cc0fb3d973192dad3e2bf718499d0bd0da1d63b39114e2899aefa`.
The authoritative full report is
`unchanged-native-postgres-runs/2026-10-19T08-20-15.464Z-14344/report.json`, SHA256
`2613e442cc3f863915e4a3fb04377fcd881f26520f8cf80fefd36cd274b1669c`.
Its 24 complete case artifacts have matching recorded byte lengths and SHA256
values. All preparations fulfilled, all targets executed through genuine
transactions, and all cohort constraints and cleanup failures are empty.
There are 48 successful owned-schema absence proofs and 24 actual empty-lock
cleanup proofs. A separately executed nominal run remains in the same packet.
The original 141/142/143/144 packets and observations remain unchanged.

The fixture uses the original SDK, workflow and step bodies, default native
MikroORM conversion, repository/service loaders and PostgreSQL connection helper.
The role is ordinary: no superuser, database-creation or role-creation privilege.
Each case owns fresh Fulfillment twelve-table and Stock Location two-table
schemas. Actual native creation/update/history owners arrange and assert raw
declared data, Item/Label identities/counts/values/history, quantities, Address,
FKs, markers and guard instants before the target. The nominal case has two
active Labels; the maximum has four Items and four active Labels. The missing
target is proved absent separately from its protected root.

Query is genuine `RemoteQuery` wrapped by genuine `createQuery`, using actual
loaded Fulfillment/Stock Location service views, native joiner metadata and the
exact native GraphQL schema-merge helper. There is no custom fetch callback or
synthetic Fulfillment DTO. `indexModule` is undefined; this is a selected static
two-module graph, not exhaustive app/Link/index-module or hosted proof.

Locking uses the original static loader, real Awilix cradle, original module and
provider service, and the actual singleton `InMemoryLockingProvider`. Provider
class, registration, selected default and injected real ORM manager are checked.
Its no-model DI construction is separate from the two schema modules. It proves
this local native provider, not distributed Locking or full application bootstrap.
Actual provider Map snapshots are diagnostics, not a fabricated lock authority.

Retained child results are recursively read from actual native
`WorkflowResult.transaction` objects after native transaction identity checks.
The original transaction is canceled through its scheduler. No parent context,
child transaction, retained DTO, provider body or compensator is reconstructed.
Scoped-container resolution observations are incomplete; they are not an
exhaustive resolution inventory. Native calls, Query results, SQL, raw rows and
actual transaction metadata establish the selected execution.

## Observed native behavior

Fifteen forward targets finish `done`; the nine `reverted` targets are the
guard/Query/timeout controls and the injected late parent failure. All fifteen
separately requested original-transaction inverses finish `reverted` without
errors. A fulfilled operation wrapper alone is not a successful business result;
the native state and native errors remain in each artifact.

| Cases | Raw observed behavior |
| --- | --- |
| 001, 002 | Shipped nominal and nonshipped maximum both deliver; shipment is not required. Repeat 001 refuses already delivered and unlocks. |
| 003–005, 008–009 | Canceled refuses before delivered; shipped does not change that ordering. Already delivered refuses when not canceled. No stored row or module event changes; acquired key is released by compensation. |
| 006–007 | Missing and historical roots fail in actual singleton Query with `not_found`, `Fulfillment id not found: <id>`. Acquired key is released; no business update/event occurs. |
| 010–017 | Packed-only, null/historical/detached Option, historical/null/unregistered Provider, and historical Address controls all deliver. No Manual provider invocation occurs. |
| 018–019 | Genuine child execution skips native locks. Explicit original parent cancellation and injected late parent failure revert the actual delivery/update children and restore `delivered_at: null`. |
| 020 | Genuine preheld key causes eight failed native acquire attempts and a reverted acquire step, before Query or any Fulfillment call. Held owner/expiry remain unchanged; no release, storage mutation or event occurs. |
| 021 | After one genuine acquire failure, the independent actor releases its own native key; the second acquire succeeds, then normal delivery/release and original cancellation execute. |
| 022 | With an actual 0.8-second prehold, three acquire attempts fail and the fourth succeeds after native expiry, then delivery/release and inverse execute. |
| 023 | A genuine child delivers and cancels while an external key is held. Both phases have zero Locking calls and leave the exact held owner/expiry unchanged. |
| 024 | Original standalone cancellation releases a newer owner's key; see the unchanged ownership hazard below. |

The observed full phase durations for timeout, timed release and TTL cases are
approximately 2151, 330 and 937 milliseconds. These include fixture snapshots
and instrumentation; they are individual characterizations, not latency
acceptance criteria or a general timing guarantee. The contention actor observes
an actual provider rejection before its real delayed release; no native return
or retry implementation is substituted.

Successful delivery changes only target `delivered_at` and `updated_at` in the
raw tables. Separate inverse restores the old delivered value while advancing
the native update stamp. Items, Labels, Address rows, protected sibling root and
other tables retain their complete raw values, including child timestamps.
The native returned DTO contains the complete root, hydrated Items/Labels and
owning reference presentations. Historical Option masks the returned Option ID
and relation while its raw FK remains unchanged. Historical Provider and Address
retain their owning ID/reference presentation; null Provider remains null.

The update child reads `{ select: ["delivered_at"], relations: [] }` and retains
exactly `{ id, delivered_at: null }` in these successful cohorts. It does not
retain Label or Item DTOs for this update. Forward and separate inverse each
emit one native `fulfillment.fulfillment.updated` module emit group. Late parent
failure has two actual groups, forward and inverse, and leaves only target
`updated_at` different from the initial raw row. Guard/Query/timeout refusals
emit no module event. Native compensation is distinct from an atomic Flarex
publication or rollback.

## Lock ownership hazard and child distinction

Standalone forward acquires without `ownerId`, then releases with a key array
and an ownerless options object. Original cancellation still executes acquire's
retained release compensation. With no intervening lock, that release returns
`false` and the workflow still reverts its business update.

Case 024 first finishes delivery and releases the key. A genuine subsequent
acquire establishes owner `native145-new-owner` with a future expiry. Original
scheduler cancellation then calls the real module/provider
`release([id], {})`; it returns `true`, and the raw provider Map changes from
that newer owner's key to empty. This is an observed native ownership hazard,
not a harness cleanup action or a Flarex implementation result. The original
packet and exact callback arguments/results must remain the comparison baseline.
The separately witnessed correction below has an explicit owner decision;
the unchanged observation remains the compatibility baseline.

Cases 018/019/023 retain genuine delivery-child flow metadata with nonempty
`parentStepIdempotencyKey` and `hasSkippedSteps: true`. Delivery and inverse have
no Locking service/provider calls. Case 023 additionally proves the held key is
unchanged through both phases. The flow's individual native Step instances are
opaque in diagnostics; the actual metadata, executed definition, absence of
Locking calls and unchanged key jointly establish the source-defined skip path.
The wrappers supply no synthetic parent key and do not prove outer exclusion.

## Approved owner-bound correction witness

The approved delivery-only correction derives an explicit owner from the actual
native transaction identity and supplies that owner to acquisition, release and
the retained acquisition compensator. Timeout, TTL, Query, business guards,
update and inverse bodies stay native. The explicit decision covers this native
business-lifecycle change; the unchanged packet remains the comparison baseline.

The separate `%TEMP%/flarex-145-owned-lock-candidate` packet preserves its source
overlay and executed observations. Runner SHA256 is
`30b0cf6066b8b50979a9529c66ba8e1b53914454952c402c5c6faeefcebfb8c3`;
the full report is
`candidate-native-postgres-runs/2026-10-19T08-36-33.992Z-7468/report.json`.
This candidate is **not accepted**: cases 020–022 fail their genuine contention
constraints. Their target phases reach Query and release without an actual
provider acquire. The transformed lock input therefore does not establish the
required exclusion. Keep the failed artifacts and actual acquire-call guard;
do not label those cases successful timeout/retry/TTL proof or weaken the
harness to accept them. The unchanged native packet remains the baseline.

The failed object-valued transform exposes a pinned SDK resolution collision:
`proxify.ts` wraps property access in a `target` transform, while
`resolve-value.ts` interprets a resolved object with a `key` property as its
internal key/value wrapper. The candidate's lock object is therefore not a
safe property-access target. This diagnosis does not authorize a global SDK
change.

The separate `%TEMP%/flarex-145-owned-lock-candidate-v2` packet retains the
original direct `key: id` at acquire and release. One genuine native transform
returns only `fulfillment-delivery:${transactionId}`, using the actual
`context.context.transactionId` and refusing an absent or empty identity.
Both callbacks receive that owner; acquisition's original StepResponse retains
it for the actual native compensator. No parent context, transaction identity,
provider result or inverse is synthesized. The native timeout, TTL, retry,
Query, guards, update and compensation bodies remain unchanged.

The revised runner SHA256 is
`c29ce78ae9e1a50445817a7e4ec2badd98500fedac1d064e913acdb422ac4929`;
the workflow overlay SHA256 is
`8ce2e288a6b27df4a74ab953013bce095250fa728418ae981d141e5182fb8b91`.
Its complete 24-case report is
`candidate-native-postgres-runs/2026-10-19T08-45-45.362Z-3224/report.json`,
SHA256 `52c3a0ed8d0dbd76ff35bde98d168ec573bf94afd001f49fc13ab659c711a970`.
All cases execute after fulfilled preparation, with no cohort, ownership-audit
or cleanup failures. Artifact lengths and hashes match the report. Case names,
forward states and separate inverse states match the unchanged baseline.

Standalone cases positively observe actual service and provider acquisition;
successful acquisition and native release retain the actual flow owner.
Guard compensation and original cancellation use that same retained owner.
The unchanged contention constraints pass for timeout, timed release and TTL
expiry. Genuine child cases still skip Locking without fabricated metadata.
Case 024 observes the original inverse release with its old owner and leaves
the newer owner's complete key, owner, expiry and pending-promise state
unchanged. Its artifact is
`cases/024-original-standalone-cancellation-with-a-newer-native-owner-lock.json`,
SHA256 `50f4816cbe64cc6f6e5fa1a8706d8a227602c5e2258c4fbc76eaa7eeb36cb47c`,
478032 bytes.

The implemented workflow uses the approved transaction-derived owner for
acquire, release and retained compensation, preserving a newer owner's lock
when an older Delivery cancels. The native candidate alone supplies no Flarex,
restart or distributed-locking proof. The private adapter contract below and
the cold native packet have distinct boundaries. The unchanged baseline and
failed first candidate remain preserved.

## Implemented private execution profile

`medusa.fulfillment.delivery` accepts only `{ id }` for one existing Fulfillment
with up to four Items and four Labels. The existing native durable interpreter
runs the parent and genuine stored synchronous update child outside SQL.
Acquire/retry and release execute through the native callback journal outside
database loans. Three short Task-authenticated commerce calls perform singleton
Query, projected preimage retrieval and the actual native update. Confirmed
update settlement precedes the native forward release.

The local Fulfillment factory owns the same twelve-table source, native
constructor, Date normalization, hydration, causal receipts and events. Its
explicit count-free `listFulfillments` capability serves the selected singleton
Query and native missing-ID error without manufacturing a count. Consumers
requiring counts retain their counted capability and refuse list-only reads.
Unsupported ordering and pagination stay refused. The combined
Option/Fulfillment factory is outside this singleton profile.

Each commerce child selects the existing shipment allowance of 128 calls with
the normal 64-event, 1 MiB and ten-second limits. A separate exact
`{ id, data: { delivered_at: null } }` command carries the genuine retained
inverse; only that command admits Task control. The original native scheduler
and update compensator supply its preimage. Neither current storage nor whole
transaction rollback substitutes for the native business inverse.

The trusted Task owner retains input commitments, grants, heartbeat, lease
expiry, subject issuance/revocation, cancellation and completion. This profile
requires its exact bound policy, at least three attempts and at least
two-minute lease and maximum-duration limits. Explicit bounded advances expose
no confirmation wait or autonomous scheduler. Cancellation observed after a
native call replaces the ordinary subject with a genuine current control
subject before compensation.

The existing authenticated Task checkpoint store uses CAS and the named
`medusa.native-checkpoint.compound.json.v1` codec for the native parent and one
stored child under its existing 1 MiB cap. Input, run, child topology, retained
native identity and state remain checked by their owners. Native serialized
child hydration is reused; no child-hydration SDK fork or separate checkpoint
authority is introduced. A foreign boundary rejection preserves the first
sticky core Cause; it cannot become an ordinary native business failure.

## Locking lifecycle and recovery boundary

The host binding owns the real native Locking module, static provider loader
and in-memory provider lifecycle, drains owned callbacks and closes the native
provider/container. The portable module removes only the unused ORM manager
injection. Acquisition, arbitration, soft expiry and owner-aware release remain
native. The actual transaction-derived owner is supplied to both forward lock
calls and the retained acquisition compensation.

Every ordinary database child requires a same-host, same-subject acquisition
observation whose conservative monotonic age is less than ten seconds. A stored
callback receipt does not confer a live claim. Task attempt fencing and this
observation are not resource-lock fencing. Contention waits hold no SQL loan;
unsupported or uncertain callback failures retain their sticky Cause and
recorded uncertainty.

Cold terminal checkpoint recovery can finish native event policy and return the
stored result without another database write or acquisition. Genuine current
control can cancel the original stored update child and perform owner-aware
release. A fresh ordinary subject cannot resume in-flight database work from
an old acquisition receipt; it refuses visibly and leaves Task recovery with
the existing owner. This profile provides no in-flight reacquisition, arbitrary
checkpoint replay, full host/provider restart guarantee, distributed exclusion
or fencing.

Forward events remain held until successful native terminal policy, including
terminal recovery after lost acknowledgement. Cancellation clears currently
held forward and inverse events; previously published forward events remain
published. Task completion and event eligibility retain their separate owners.

General Query/Locking, other providers, Order delivery, populated upgrades and
public/hosted activation remain unadmitted. The general coordination roadmap
remains pending for additional providers and stronger guarantees. Product
chunked file import and Product export remain deferred.

## Cold native child recovery witness

A separate ordinary-role PostgreSQL witness reloads the genuine parent and
stored child in a fresh native interpreter process, using the unchanged pinned
SDK. The native `LocalWorkflow.cancel` path detects the serialized child
transaction and reloads its original identity from native storage before
compensating. No child-hydration fork is needed.

The immutable packet is `%TEMP%/flarex-145-recovery-proof`. Its executed runner
SHA256 is `ee812d19fba019504abd5fef1f5f900267b2fe8e1be870e4bc03ea7bd50e1047`.
Report `candidate-native-postgres-runs/2026-10-19T09-06-12.588Z-14656/report.json`
has SHA256 `7c517183c94e26fbe987ce83aea0afcd27b397502c55ec5a40c108ea36aa61d0`.
The actual child inverse restores null `delivered_at`; the newer provider lock
remains unchanged. Missing child checkpoints and mismatched storage-key/model
identities are refused before a service RPC loan. This proves cold interpreter
recovery with a live parent service/provider via transparent RPC and a fixture
checkpoint store. It does
not establish full host restart, Task authority, distributed locking or
production activation; those remain distinct from adapter admission.
