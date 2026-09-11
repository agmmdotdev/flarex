# Commerce Installation And Profile Bindings

Status: proposed core contract; research approved, implementation not approved.

## Outcome And Owners

Unblock [Sales Channel foundation Gate A](./50-product-workflow-sales-channel-foundation.md):
one installed Product + Sales Channel schema, two explicitly authorized and
table-confined service profiles, independently executed through the existing
commerce host. This does not make their separate transactions atomic.

`packages/persistence-postgres/src/frameworkSchema/binding` owns canonical
binding values, activation and durable membership. `commerceTransaction` owns
authentication of the loaded profile, table capabilities and request admission.
The Medusa adapter owns configured metadata and native services. Neither owner
acquires the other's business or settlement responsibility.

Non-goals: same-installation atomic participants, stored Links, cross-module
graph queries, a workflow engine, multiple seeded modules on one installation,
new public APIs, existing-row module-set migrations or production activation.
The separately approved Sales Channel foundation resumes after this core gate.

## Evidence And Correction To The Earlier Plan

The accepted [Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary)
requires a complete configured supported set, with Flarex owning storage
admission and Medusa owning service/link behavior. The
[package boundary](../../16-package-boundaries.md) keeps database authority in
persistence, not in adapter glue. The existing
[binding contract](./13-application-projection-and-data-bindings.md) requires
authenticated loaded implementations, exact residual coverage, immutable
candidates and fenced activation. Those requirements remain.

Current source shows the narrower limitation:

- `frameworkSchema/binding/canonical.ts` permits one adapter/query/store triplet
  per commerce physical binding. Its V2 array also requires unique installation
  digests; two entries for the same installation are not an alternative.
- `commerceTransaction/binding.ts` requires all three entries to name the same
  loaded commerce profile and contract digest. For commerce, these are not three
  independently registered implementations.
- `frameworkSchema/binding/evidence.ts` selects one loaded profile by artifact
  and the first triplet entry's contract digest. Registering more profiles does
  not authorize them in the active candidate.
- `frameworkSchema/binding/profiles.ts` checks the flattened residual coverage.
  Commerce runtime verification does not separately dispatch adapter/query/store
  implementations. Keeping three repeated grants is not necessary for that proof.
- `commerceTransaction/admission.ts` re-reads the active candidate per request;
  `atomicCommerce/admission.ts` and `crossDomainCommand/binding.ts` also project
  an installation reference by stripping `profiles`. New fields must not leak
  into those exact-reference comparisons.
- `atomicCommerce/participants.ts` independently refuses duplicate installations.
  Removing that refusal is not part of this correction.

The retained `packages/medusa-adapter/test/sales-channel-binding.test.ts` witness
installs the 14-table candidate and reads the admitted Sales Channel table. It
characterizes `unsupportedProfile` for unbound Product access and `invalidInput`
for a proposed six-entry profile array. These are correct current refusals, not
authorization bugs. The missing outcome is explicitly authorized dual-profile
execution. The owning Gate A preflight records reproduction commands.

The pinned fork remains `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
`core/core-flows/src/product/workflows/create-products.ts` invokes the native
Sales Channel association step. That step, at
`core/core-flows/src/sales-channel/steps/associate-products-with-channels.ts`,
resolves Link and calls `create`/compensating `dismiss` for nonempty inputs.
Binding two endpoint services advances that dependency but does not implement
the native Link branch. No fork business-contract change is proposed here.

## Recommended Stored Contract

Use a new persisted data-binding-set codec version (V3), not a new runtime family
or version-suffixed service API. Keep the Application/Payload slots unchanged.
Each commerce entry contains:

```text
one existing InstallationBindingReference
coverage: exact readiness requirement/physical-evidence pairs, once
profiles: [{ profileId, contractSha256 }, ...]
```

This separates physical readiness from execution authorization without creating
another registry or a per-module descriptor DSL. Do not copy table capabilities,
command names or event handlers into the binding: the existing authentic profile
and host registrations already own them. A digest is a pin, not a capability.

Contract rules:

1. Commerce installations remain unique and sorted by installation digest. Keep
   at most eight installations and the existing 1 MiB candidate bound. Cap the
   total authorized commerce profiles across the candidate at eight, preserving
   the current loaded-profile budget rather than allowing eight times eight.
2. Every installation has a nonempty profile list, sorted by profile ID. Reject
   duplicates and conflicting digests for one ID within that installation.
   Profile identity is installation-qualified; IDs are not global module names.
3. Retain at most 64 unique coverage pairs per installation. Sort by the existing
   owner/lineage/capability identity ordering and require exact readiness coverage;
   reject missing, extra, duplicated or mismatched evidence. Flattening the old
   triplet must not weaken table/column or physical-capability comparison.
4. Resolve every entry to an authentic registered `CommerceProfile` with exact
   artifact identity, physical layout, profile ID and contract digest. Validate
   all members at preparation, activation and full current-binding acceptance;
   never select whichever loaded profile happens to match first.
5. A multi-profile installation is initially limited to existing local, unseeded
   profiles. Require disjoint table capability sets. Every relationship or
   application-table foreign key touching a granted table must remain inside
   that same profile's granted set; scope-authority FKs are unchanged. This keeps
   implicit cascades/reference operations from crossing module authority. Tables
   may remain ungranted, but a granted table cannot reach them through those
   schema edges in this bounded profile. Product's local pivots remain Product's.
6. Preserve singleton Currency initialization and its exact seed receipts.
   Multiple seeded profiles, shared-table grants and cross-profile relational
   edges fail closed; this gate does not generalize those contracts.

The existing `CommerceSchemaProfile` remains installation-only and cannot enter
the execution-profile list. No module-name switch or Sales Channel knowledge is
added to core. Unsupported profiles retain typed admission failures.

## Construction API And Request Behavior

Trusted composition should not manually assemble repeated role strings or hash
contracts. Add one value-construction function under the binding owner, exposed
only through the existing trusted commerce facade. Illustrative caller:

```ts
// Before: fixture code maps readiness profiles and rewrites three IDs/digests.
const commerce = yield* makeCommerceBinding(readyAvailability, [
  product.profile,
  salesChannel.profile,
]);
const candidate = yield* bindings.prepare({ ...base, version: 3, commerce: [commerce] });
```

The example is inside an Effect generator; it is an API-shape proposal.
The constructor captures caller-owned values before suspension, consumes existing
readiness evidence and authentic profile tokens, and produces immutable value
data. It creates no registry, host, activation or transaction. `bindings.prepare`
still independently validates the proposal against authoritative current state.
Medusa's configured owner wraps this preparation so application consumers do not
import the binding's private assembly pieces.

Keep `makeLocalCommerceHost` and direct service command APIs unchanged. Per-request
admission reads the active candidate, matches the exact physical reference and
the requested profile's ID/digest, and issues only that profile's existing
transaction-lifetime capability. It must not union the installation's grants.

Use one explicit installation-reference projection owned by the binding module
in commerce, atomic and cross-domain consumers. Mechanical adaptation of these
consumers must preserve their current cardinality and activation limits. In
particular, cross-domain composition remains one selected commerce profile;
the atomic participant duplicate-installation refusal remains tested.

No new settlement, lock or publication owner is needed. Keep scope-clock and
physical-installation lock ordering, one sidecar per physical installation,
availability revalidation, expected-head compare-and-swap, activation request
identity and uncertain-outcome recovery. Prepared installation caches remain
non-authoritative. After removing a profile via normal activation, an already
constructed host must fail its next new request; merely registering an extra
profile must never make it executable. In-flight settlement retains the existing
scope-clock serialization contract, not a new cancellation promise.

## Compatibility And Alternatives

| Action | Decision and retirement gate |
| --- | --- |
| Retain | Exact V1/V2 decoding and immutable candidate/activation bytes. The model, repository and binding value tests explicitly support those persisted contracts. Keep legacy cardinality/coverage validation before projecting a singleton execution grant; do not reinterpret six old entries as valid. Retire readers only with a separate evidence-backed stored-data/support decision. |
| Extend | Existing binding capture, membership verification and request admission for V3. Existing Product/Currency hosts and their single-profile behavior remain valid. New shared-candidate construction emits V3; no automatic rewrite of old candidates. |
| Replace | Commerce's repeated triplet assembly in the new configured path with one readiness coverage set and direct profile references. Use one authorization algorithm after validated wire-version projection, not fallback execution paths. Payload/test-only profile policies are not generalized. |
| Delete | Move the core admission assertions out of the temporary adapter diagnostic into core regressions; retain connected Product/Sales Channel assertions in the consumer. Remove duplicated setup and provisional exports once the supported constructor owns them. |

V3 is justified by a changed persisted grammar with retained exact-byte readers,
not by the age of the implementation. Existing SQL tables store canonical bytes
and installation sidecars rather than one row per profile; no SQL migration is
proposed. If implementation finds an additional storage or public compatibility
obligation, stop and revise this preflight.

Rejected alternatives: widening one profile to every table hides module authority;
multiple triplets duplicate readiness and preserve the wrong grouping; duplicate
physical installations contradict the configured candidate; swapping activation
per command introduces races; adding a generic permission registry duplicates
the existing opaque profile owner. Merely raising an array limit solves none of
the identity, coverage, activation or request-admission requirements.

## Validation And Completion

- Canonical values: V1/V2 exact-byte/digest restoration; V3 deterministic ordering,
  hostile inputs, duplicates, unknown members, empty/oversized lists, coverage
  errors, profile conflicts and tampered bytes. Preserve old format refusals;
  update the unsupported-version witness to an actually unsupported version.
- Real owner scenario on PGlite and ordinary-role PostgreSQL: one installation,
  one sidecar, two disjoint profiles, separate successful reads and writes. Assert
  each profile cannot access the other's tables, spoof a token/digest, or use an
  unbound profile. Cover schema-only token refusal, overlapping grants and
  cross-profile FK/cascade refusal before any binding activation.
- Activation/lifetime: missing implementation, stale placement/availability,
  stale Application/head, withdrawal, profile revocation with a preconstructed
  host, restart/cold restoration, exact activation replay, request conflict and
  uncertain-outcome recovery. Prepared-but-unactivated candidates grant nothing.
- Connected evidence: rerun the combined Product/Sales Channel admission witness
  with both authorized profiles; do not replace the preserved negative controls
  with success expectations for an unauthorized profile. Native Sales Channel
  service compatibility is completed in the resumed Gate A, not inferred here.
- Regressions: existing framework bindings, Currency seed gating, Product scoped
  commands, multi-installation atomic commands, CMS/Payload and cross-domain
  selection. Prove same-installation atomic participants still refuse. Retain
  ordinary commit facts, rollback-only lifetime and publication assertions.
- Apply affected strict typechecks, core/diff/staged lint, boundary guards and
  both required project reviewers to the final owned code checkpoint. Move the
  diagnostic coverage, reconcile owning roadmaps and create a scoped core commit
  before completing the remaining Sales Channel promotion/service work.

This document is a source-backed proposal, not a claim that V3 or dual-profile
admission exists. No runtime behavior changed during this preflight.
