# Native Promise and Cause preservation preflight

## Status and authority

Status: the bounded internal Cause boundary is implemented at the existing
Promise and bounded-lifetime owners, with authenticated completion through its
connected consumers. This failure/lifecycle correction has separate authority
from native Cart write admission and native business compensation changes.

The accepted framework boundary and Effect failure contract require typed
domain failures, defects, interruption and complete Causes to remain distinct.
Native Medusa business behavior, settlement and compensation retain their
existing owners. No resource limit, transaction lifetime or retry changes are
part of this correction.

## Observed mismatch and owners

The native Variant/item pricing characterization already exposes genuine
TypeErrors for missing calculated prices. The original adapter preserved the
error as an `adapterFailure` cause but changed its Effect failure classification.

An isolated diagnostic using the real Commerce service bridge, Promise owner,
bounded lifetime and context confirms two mismatches without database claims:

| Input outcome | Required outer outcome | Original outer outcome |
| --- | --- | --- |
| Genuine native `MedusaError` | Typed `adapterFailure` retaining original error/type/message | Preserved |
| Native `TypeError` | Defect retaining the original error | Typed `adapterFailure` |
| Owned typed failure with finalizer defect | Both original Cause reasons | Only the typed failure |

The original Promise owner used `runPromiseWith`, which squashed the owned Cause
before foreign code saw a rejection. Workflow and service bridges classified
arbitrary rejections as typed failures. Repository transaction callbacks, composed
resources, mutation-event dispatch and Variant-Pricing Link routing have
connected conversions. Changing only the final catch cannot recover a Cause
already squashed earlier.

The bounded request and FIFO owners already own sticky failure state. Reuse
their authority and first-Cause semantics rather than adding an adapter latch
that competes with them. Closing the original Promise owner joined runners
through `allSettled`; cleanup defects require explicit preservation rather
than assuming that joining alone transports their outcome.

The domain projection is another confirmed owner boundary. An inner operation
can latch its typed failure before an outer finalizer adds a defect. Projection
rebuilds the typed Reason identity, so the completed Cause cannot enrich that
original root chain by identity alone. The corrected projection must translate
only Reason identities it actually issued back to their original root Reasons.
Preserve the initiating failure while accepting its authenticated completion;
unrelated later failures must not replace it. Error-value or structural matching
does not establish that provenance.

A real strict-profile storage witness confirms an additional identity boundary:
Effect adds stack annotations by cloning Reasons. The inner bridge retains the
finalizer defect, but a trusted caller can catch that bridge outcome and the
root seal then retains only its earlier typed prefix. Direct Reason identity
alone therefore does not prove a completed chain. The lifetime must authenticate
its own issued chain across annotation cloning, preserve later annotations and
return the authenticated Cause for transport. Error-value or structural matching
cannot replace that authority. The original failing witness remains separate
from candidate validation.

Pure charge results introduce a further boundary: the installed Effect runtime
can rebox a failed `Result` when `flatMap` propagates it. A later ordinary
`Effect.fromResult` creates a new Reason and loses the charge refusal's issued
origin. The lifetime's `fromResult` restores the Cause only for the exact failure
receipt returned by that lifetime or its domain projection. Callers preserve
those receipts through direct `Result.gen` propagation. Copied or reboxed
results remain ordinary, unauthenticated results. Independent preparation
budgets retain their existing conversion and lifetime.

The logical working set has a connected instance of that defect: its real
insert charge and shared-root cached-row observation both lose a later
finalizer defect at root seal when their charge receipts pass through ordinary
conversion. Its observation, hydration, output, attempt, row-use and derived-key
folds therefore enter Effect through the same lifetime conversion. Failed
row-use results propagate directly through `Result.gen`; `flatMap` must not
rebox them before that boundary. Independent local preparation budgets keep
their separate owner.

## Implemented owner boundary

The existing Promise owner captures `runPromiseExitWith` outcomes and uses a
private receipt registry for transport. Native `MedusaError` and existing
Commerce failures retain typed behavior; other foreign throws remain defects.
Single error identities are retained when unambiguous, and distinct annotated
Causes sharing one error receive distinct opaque receipts.

The context-bound `recordFailure` operation reuses the bounded lifetime's first
failure state. It authenticates live handles without granting data access,
charging another call, or permitting settlement. Private issued origins survive
Effect's annotation cloning and permit completion of the initiating Cause with
its finalizer reasons. Domain projection preserves only translations it issued.
Foreign, revoked and post-seal recording cannot mutate commit authorization.

`withClose` joins runners and cancellation finalizers, combines their outcomes
with the body, and synchronously records the complete joined Cause before
returning. Late asynchronous callbacks remain closed. The atomic outer owner
records the authenticated completion before propagation; it alone settles.
Connected Commerce, CMS, preference, cross-domain, FIFO and storage charge
consumers use this same lifetime rather than creating another failure latch.

## Correction contract

1. Preserve the complete owned Exit/Cause before Promise conversion. If an
   internal transport receipt is necessary, authenticate it with the existing
   process-local owner. Arbitrary thrown Causes, lookalike objects or `cause`
   properties must not acquire trusted transport meaning.
2. Classify native rejections once at their actual boundary: preserve existing
   typed Commerce failures and genuine native `MedusaError` behavior; preserve
   workflow-definition refusal at its current owner; restore authenticated
   owned Causes; keep other foreign throws as defects. Any additional expected
   foreign error family needs evidence from its native owner.
3. Register the first complete refusal before foreign code can catch rejection
   and continue. Determine any necessary narrow context operation from the
   actual lifetime/FIFO contracts; retain confinement and revoked-handle checks.
   A live parent can poison its own root while a child owns data access, but
   successful seal is a fence: post-seal recording must not change commit
   authorization. Join finalizers and record their outcome before that fence.
4. Join cancellation and finalizers before return, retain their complete
   outcomes and avoid registering or combining the same failure twice. Preserve
   tracing-context isolation and the current cleanup/deadline owners.
5. Migrate all connected callback seams together. Keep APIs and implementation
   with the existing adapter and transaction owners; add no universal service
   registry, new settlement path or alternate transaction lifetime.

The existing Promise-owner test pins raw single-rejection identity at an
internal transport boundary. Disposition that assertion explicitly if transport
changes: original business errors and original defect identities must remain
observable at their restored owning Effect boundary. An internal assertion is
not evidence for dropping finalizer defects.

## Required verification

- Genuine native domain failures: missing Price List/Variant, missing currency,
  unpublished Variant, missing PriceSet Link and nonpositive quantity preserve
  their typed native error behavior and rollback.
- Genuine native pricing dereferences retain `Die(TypeError)` with original
  identity and unchanged storage/events.
- An owned typed failure plus finalizer defect survives repository, service and
  workflow crossings with all reasons and without duplicate registration.
- Foreign transport lookalikes remain defects. A caught rejection cannot turn
  the owning root into success or permit later work through escaped handles.
- Owner cancellation preserves interruption, joins SQL/finalizers, and retains
  a cancelled sibling's finalizer defect beside the initiating failure. An
  `AbortError` name alone does not establish interruption.
- Atomic failed workflows roll back without automatically executing their
  transaction-covered inverse callbacks. Explicit retained inverse workflows
  preserve their actual identities, preimages and behavior; durable SDK
  compensation remains a separate owner.

Preserve the original diagnostic and validate the corrected candidate
separately. Run focused owner controls and genuine workflow consumers on PGlite
and ordinary-role PostgreSQL, affected types/builds/source checks and lint,
then both required read-only reviews before committing the correction.
