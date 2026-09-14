# Commerce Installation And Profile Bindings

## Shared Logical Storage Authority

Storage target correction: [shared logical storage](../../../design-notes/flarexdb-shared-logical-storage.md)
and its [replacement gates](../../shared-logical-storage/README.md)
supersede this record's physical Medusa/module-table destination and any
per-deployment schema recommendation. Retain applicable source provenance,
framework semantics and completed implementation evidence. Generated-table DDL,
physical index/FK mappings and their tests describe the displaced baseline;
they are not a compatibility obligation or permission to extend it as the
platform destination. Inventory retained system/lifecycle consumers separately.
Target migration remains unimplemented.

Status: approved private core contract complete.
The owner confirmed development-only use with no production data or retained
compatibility obligation, and approved clean replacement of the old encodings.

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

## Module-Neutral Design Requirement

Sales Channel exposes the missing core capability; it does not define a special
case in its implementation. The reusable outcome is authorization of independent
execution profiles over one installed schema. This belongs to the existing
framework-compatible commerce lane, not a new universal Application/Payload
transaction API.

Core must operate only on authenticated installation evidence, profile contracts,
table/key identities and admitted capabilities. It must contain no Product or
Sales Channel imports, hard-coded module/table names, per-module switches, special
two-module branches, or exceptions in an adapter to bypass core admission.

For another module within the supported capability contract, the expected change
is its Medusa-owned checked schema, native service composition and profile
declaration. The configured owner supplies that profile through the same binding
constructor. No binding codec, admission algorithm, registry layer or core factory
must change merely because a module is added. Callers must not rebuild readiness,
hashing or authorization internals from multiple imports.

This is not a promise that every future module's behavior is already supported.
Multiple seeded profiles, shared-table permissions, cross-profile relationships
and same-installation atomic execution remain distinct missing capabilities.
Their limits must be expressed and tested by capability, not by module identity.
If a later workflow requires one, correct its shared owner once under a focused
contract and test independent consumers; do not add a Sales Channel, Inventory
or other module exception. This binding correction must not need to be repeated
for each module, and must not be presented as completion of those other gates.

Make this an implementation acceptance gate: core conformance uses independently
defined neutral schema/profile fixtures, not renamed copies of adapter logic.
Exercise a third disjoint profile and different declaration order without core
edits. Product + Sales Channel remains the separate connected consumer proof.

## Evidence And Correction To The Earlier Plan

The accepted [Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary)
requires a complete configured supported set, with Flarex owning storage
admission and Medusa owning service/link behavior. The
[package boundary](../../16-package-boundaries.md) keeps database authority in
persistence, not in adapter glue. The existing
[binding contract](./13-application-projection-and-data-bindings.md) requires
authenticated loaded implementations, exact residual coverage, immutable
candidates and fenced activation. Those requirements remain.

The displaced implementation had the following limitation:

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

The connected `packages/medusa-adapter/test/sales-channel-binding.test.ts` witness
installs the 14-table candidate, preserves `unsupportedProfile` for unbound
Product access, then explicitly authorizes both confined profiles through
`makeCommerceBinding`. Core-neutral conformance owns the three-profile,
cross-table refusal, revocation and old-triplet rejection assertions.

The pinned fork remains `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
`core/core-flows/src/product/workflows/create-products.ts` invokes the native
Sales Channel association step. That step, at
`core/core-flows/src/sales-channel/steps/associate-products-with-channels.ts`,
resolves Link and calls `create`/compensating `dismiss` for nonempty inputs.
Binding two endpoint services advances that dependency but does not implement
the native Link branch. No fork business-contract change is proposed here.

## Current Stored Contract

Redesign the current binding contract under plain semantic names such as
`CommerceBinding` and `makeCommerceBinding`. Do not introduce V2/V3 API families
or retain multiple execution designs. Keep the Application/Payload semantics
unchanged. Each current commerce entry contains:

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
const candidate = yield* bindings.prepare({ ...currentBase, commerce: [commerce] });
```

The example is inside an Effect generator; it is an API-shape proposal.
`currentBase` belongs to the redesigned current contract, not a spread of an old
stored frame with its discriminator retained. Callers do not select an API version.
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
| Retain | Application/Payload behavior, seeded singleton behavior, transaction and publication ownership. No old commerce binding reader is retained: the owner confirmed no production data or supported external compatibility obligation. |
| Extend | Existing binding capture, membership verification and request admission for the redesigned current contract. Preserve Product/Currency service behavior without preserving their old assembly machinery merely because it exists. |
| Replace | Commerce's repeated triplet assembly with one readiness coverage set and direct profile references. All active producers/consumers use the current semantic API. Payload/test-only policies are not generalized. |
| Delete | Old codecs/assembly without a demonstrated obligation, after migrating callers and preserving meaningful safety assertions. Move core assertions from the temporary adapter diagnostic to core regressions; retain connected consumer assertions. Remove duplicated setup and provisional exports. |

The current `flarex.data-binding-set` frame has no version property and always
uses a commerce array. Earlier versioned frames are rejected, never stripped or
reinterpreted. The codec rejects a version property even when its other fields
match the new contract. No Legacy reader, fallback execution or dual write exists.
Repository producers and restart fixtures are migrated together. Existing private
development databases containing old candidates must be recreated before reuse;
this implementation does not delete or rewrite a user's database automatically.

Existing SQL tables store canonical bytes and installation sidecars rather than
one row per profile; no SQL migration is currently proposed. Any required data
migration or destructive retirement needs its explicit scope and approval.

Rejected alternatives: widening one profile to every table hides module authority;
multiple triplets duplicate readiness and preserve the wrong grouping; duplicate
physical installations contradict the configured candidate; swapping activation
per command introduces races; adding a generic permission registry duplicates
the existing opaque profile owner. Merely raising an array limit solves none of
the identity, coverage, activation or request-admission requirements.

## Validation And Completion

- Canonical values: current-contract deterministic ordering,
  hostile inputs, duplicates, unknown members, empty/oversized lists, coverage
  errors, profile conflicts and tampered bytes. If a legacy reader is required,
  prove exact-byte/digest restoration and old-format refusals separately. Otherwise
  migrate fixture assertions to the current contract and delete obsolete codec
  scaffolding; preserve corruption and unsupported-encoding coverage.
- Real owner scenario on PGlite and ordinary-role PostgreSQL: one installation,
  one sidecar, two disjoint profiles, separate successful reads and writes. Assert
  each profile cannot access the other's tables, spoof a token/digest, or use an
  unbound profile. Cover schema-only token refusal, overlapping grants and
  cross-profile FK/cascade refusal before any binding activation.
- Module independence: define neutral core fixtures without Medusa adapter
  imports; add a third profile by declaration alone, vary names/order and exercise
  the same constructor/admission path. Check changed core sources for module-name
  branches and new reverse dependencies. Retain meaningful failure assertions in
  core and real native-service behavior in the adapter rather than duplicating
  business logic in a test harness.
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

Retain the existing cold-installation deadline and the open reliability limitation
in [the timeout investigation](./49-medusa-postgres-timeout-investigation.md).
Run constrained serial database validation on Windows. A setup timeout before
binding construction is not a passing consumer proof; a subsequent passing run
does not establish its cause or resolve the broader storage-stall investigation.

This core capability does not complete Sales Channel native service compatibility,
stored Links, shared-installation atomic execution or Product workflow integration.
