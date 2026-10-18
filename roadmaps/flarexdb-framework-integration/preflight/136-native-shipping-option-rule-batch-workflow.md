# Native Shipping Option Rule batch preflight (136)

Status: implemented as a bounded private portable integration. Native
service/callback behavior includes genuine in-process scheduling and automatic
compensation characterization. The finite SDK output-representation correction
and paired portable forward/retained-callback integration are implemented. This
record admits no public/hosted activation or populated upgrade.

## Complete outcome and native authority

Integrate the genuine `batchShippingOptionRulesWorkflow` and its create, update
and delete steps, including their retained callbacks, over existing Options.
Native authority is Medusa 2.13.4, commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, authenticated by
`third_party/medusa/SOURCE.json` and `SOURCE_SHA256SUMS`. Native paths below are
relative to `third_party/medusa/upstream`.

- `packages/core/core-flows/src/fulfillment/workflows/batch-shipping-option-rules.ts:76–99`
  normalizes nullish action inputs to empty arrays, registers the three genuine
  branches with `parallelize`, and returns a transform containing created,
  deleted and updated in that order.
- `fulfillment/steps/create-shipping-option-rules.ts:12–49` always resolves
  Fulfillment and invokes native creation, including an empty array. It retains
  actual created IDs; its inverse skips absent/empty IDs and otherwise performs
  native physical deletion.
- `fulfillment/steps/update-shipping-option-rules.ts:23–64` skips absent/empty
  data before resolving Fulfillment. Otherwise it lists projected originals,
  invokes native array update, and retains those originals for native update.
- `fulfillment/steps/delete-shipping-option-rules.ts:15–68` skips absent/empty
  IDs before resolving Fulfillment. Otherwise it lists active projected rows,
  physically deletes the raw requested IDs, returns those raw IDs, and retains
  the selected rows for genuine creation.

There is no Query, Link, provider, hook, child workflow, explicit workflow event,
File, Region, lock or pause. Module event infrastructure remains mandatory even
for an empty root. Promotion changes only existing portable SDK/Modules/direct
imports, erased type seams and transaction-covered compensation metadata.

The native public result DTO declares arrays even where empty update/delete
callbacks return undefined. A private named composer result adds undefined to
those two indexed DTO fields so the finite SDK can type the unchanged runtime
composition. Exported native DTOs and runtime defaults remain unchanged; source
guards authenticate this type-only annotation seam.

## Native module and persistence semantics

Reuse the genuine Fulfillment service and `validateAndNormalizeRules` utility;
do not copy its truthiness, operator or boolean business algorithm into the
adapter. The utility validates the complete Rule fields even for public partial
Update DTOs. Missing/falsy attribute, operator or value refuses before boolean
normalization: false, zero, null and empty string refuse, while true can become
the string `"true"`. The in/nin operators require arrays; other operators refuse
array/object values. Whole-array validation precedes mutation. Preserve input
mutation and native failure order rather than supplying adapter defaults.

The Rule model owns generated sorul IDs, required attribute/operator and Option
reference, nullable JSON value and managed timestamps. Public DTOs are not the
runtime model decoder. Capture complete actual rows before projection; preserve
scalar/array shape, generated/supplied IDs, original ordering, duplicate and
missing target behavior, historical visibility and parent retargeting.

Native Drizzle selection implicitly includes the primary key even when the
delete step's explicit select omits id. Its retained rows omit managed
timestamps. Physical deletion's inverse therefore recreates original external
IDs with fresh native managed timestamps; it is not exact-preimage restoration.
Active-only preimage selection and broader physical historical deletion can
produce a different retained cohort. Preserve authentic inverse validation
failures for stored nullable/opaque values instead of widening validation.

Raw delete output and projected retained rows follow native selector ordering;
physical deletion events in the pinned SQLite comparison follow storage
insertion order. Select the existing identity-bound storage-insertion ordering
capability for this Rule participant and authenticate its ordered-identity read
transcript against the complete physical mutation/event cohort. Recreated
external IDs receive fresh insertion generations. Keep lifecycle planning and
application with their existing owner; do not sort events or preimages into a
single common order.

Use ordinary logical insertion for recreated Rules, with fresh internal identity
and accepting generation. Existing Store exact-preimage reconstitution serves a
different contract and must not be relaxed for this workflow. A committed-delete
recreation witness remains required separately from same-root delete/recreate.

## Framework output owner correction

Native `create-step-handler.ts:94–101`, `DistributedTransaction.addResponse`,
`resolve-value.ts:36–42` and `workflow-export.ts:176` jointly own referenced step
output representation. A raw void/null callback is serialized as native workflow
data; the resolver's nullish fallback can return that envelope. An explicit
StepResponse with undefined output has different nested property behavior.
Literal undefined, a skipped branch, ignored output, direct void root, hooks
and child workflow results must remain distinct.

The finite SDK preserves the native envelope for referenced raw undefined/null
callbacks and the distinct nested omission behavior of explicit undefined
StepResponses. Its regular callback/resolution owner uses private
prepared-reference provenance, preserving capture limits, interruption,
retained inputs and unknown-reference refusal. Provenance never enters capture
or callback values. No Rule-specific defaults, second resolver or blanket JSON
conversion is introduced. The existing direct void-root transport seam remains
separately owned. Authored fixture probes that intend literal null or explicit
void completion use genuine StepResponse wrappers with their existing codecs.

Migrate affected private SDK consumers and preserve meaningful native-derived
reference, parallel, hook, child, branch, cancellation and capture regressions.
This is a framework compatibility correction; no native business change is
selected. Durable engine and host activation are not implicitly broadened.

## Parallelism, bounds and shared ownership

Native builder/orchestrator code registers same-depth create/update/delete
siblings and starts their handlers concurrently. Completion and awaited DAL
calls can interleave. Compensation sorts by depth; it does not guarantee reverse
sibling order. A diagnostic sequential callback roundtrip cannot establish
native scheduler overlap or automatic inverse outcomes. Genuine native
in-process execution establishes successful complete four-create/four-update/
four-delete forward execution and automatic cancellation. Same-ID update/delete
can succeed forward while its update compensation fails before sibling
recreation; fresh same-ID create/delete can complete and cancel. Occupied-ID
creation, validator failure and a genuine late parent failure retain native
failure/compensation outcomes. Actual sibling compensation starts in declared
create/update/delete order. Preserve those observations without promising every
possible interleaving or repairing native inverse behavior.

Retain genuine portable sibling scheduling and the existing trusted queue for
individual DAL jobs. Do not serialize whole branches or impose disjoint IDs to
avoid a mismatch. Characterize the genuine native in-process orchestrator with
real Fulfillment/Drizzle storage, then pair actual overlap and compensation
observations with the portable root. Native scheduler bootstrap, durable engine,
HTTP and portable atomic settlement are separate evidence boundaries.

Select zero to four raw entries per action, up to twelve affected distinct Rule
identities and four existing Option parents, under existing byte/row/catalog
bounds. Reuse the existing eight-table Fulfillment source and FK graph; this
grants no Option CRUD/provider authority. No schema/core extension is presumed.

The selected named profile admits 128 calls and retains 64 events. Complete
retained-callback composition exceeds the original 64-call allowance. The full
four-create/four-update/four-delete root uses 43 bounded request entries forward
and 75 including all actual retained callbacks on both database lanes. Separate
method costs and event arithmetic do not replace this complete-root acceptance.
This allowance is scoped to this identity; other profiles and resource limits
retain their own selections.

## Implementation and acceptance sequence

1. Preserve the SDK differential failure, correct its actual owner, migrate
   affected private consumers and close native scheduler characterization.
2. Promote the unchanged root/three steps with exact runtime, public type,
   import, source-pair and retained-callback mutation guards.
3. Implement one checked Rule module/repository/receipt family and batch facade,
   reusing native normalization, scalar/query/event mechanics, source lineage,
   constructor and trusted queue.
4. Prove complete maximum forward/inverse graphs, empty and individual branches,
   projection/recreation/history, raw selectors, overlaps, forged outputs/events,
   scope/replay/lifetime, cancellation, sticky rollback and relevant reference
   races on PGlite and ordinary-role PostgreSQL. Run SDK and affected native
   Fulfillment/Product consumer regressions separately.
5. Complete types/builds, source/provenance/browser guards, lint, both required
   read-only reviews, owned-resource cleanup and one scoped commit.

General Shipping Option creation, Location–Fulfillment Set installation and
deletion migrations, chunked Product file import and Product export remain
separate work.
