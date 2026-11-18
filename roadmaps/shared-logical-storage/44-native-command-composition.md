# Native command composition

Status: implemented for selected scalar and Product-tag native commands.

## Outcome and owners

Repeated scalar and Product-tag native calls, including child workflows, share
one logical source and one atomic root. The persistence owner validates each
outer call before it returns, using its captured events and command-local
mutation/lifecycle/intent evidence and the pending rows at that instant. Medusa
owns semantic receipt validation. Nested service commands remain inside their
outer call; neither a workflow nor a validator receives settlement authority.

The workflow resource binder also makes invocation of any unselected native
method a sticky refusal. Property inspection remains inert, including Promise,
JSON and symbol probes. Explicit event-bus lifetime refusals retain their error
classification.

## Evidence and challenged alternatives

At the completed public Category cutover, scalar receipt validation accepted only
one write per participant. Product tags manually partitioned an entire transcript
to support child workflows. Final pending rows cannot describe an earlier call
after later updates. Splitting mutations in each consumer therefore cannot be a
general composition contract. The authenticated outer call in atomic execution
is the correct owner for immediate validation and local ordinal rebasing.

Use an explicit call validator, mutually exclusive with the existing aggregate
validator. Direct Category/Collection commands now share the Product call policy
under [their semantic cutover](./45-category-collection-command-composition.md).
Keep aggregate validation for the preceding-read Category/Collection membership
workflows, Option, lifecycle, Pricing and Link consumers whose whole-root evidence
has not moved. Their removal gate is equivalent per-call semantic proof,
including preceding reads and deferred transitions. Do not silently reinterpret
their final-row evidence or claim arbitrary Product composition.

Manual refused-method lists are incomplete by construction. Replace them with
one invocation boundary in the existing scoped binder, preserving finite typed
selection and the Promise owner's first-refusal and cleanup behavior.

## Contract changes, cutover and cleanup

Scalar logical policies and Product-tag policy callers move to call validation.
Product-tag action selection belongs to its module policy; remove the separate
composition policy and migrate its consumers. Remove refusedMethods and its
module registration lists. These are private construction contracts, with no
durable data or schema migration. Bind validation mode into request identity so
an old aggregate request cannot replay under different validation semantics.
Receipt refusal now occurs before the native call returns. When the framework
re-enters its refused root, the existing lifetime reports `rollbackOnly` with
the original `receiptMismatch` cause; no later hook runs. Tests must authenticate
both that retained cause and absence of publication. The Pricing source guard
checks the sole admitted native method; runtime refusal no longer needs a
second inventory of every unsupported method.

Retain physical compatibility profiles for their existing unported consumers.
Collection replacement workflow admission, broader relationship composition,
query capacity, structural migration consolidation, remote effects, production
activation and new framework capabilities remain outside this slice.

## Completion gates

Prove repeated and mixed scalar and Product-tag calls, child workflows, pending
reads, exact module/workflow events, late malformed receipts, caught unsupported
calls, complete rollback and replay without re-execution. Exercise the existing
affected consumer regressions, focused PGlite and ordinary-role PostgreSQL
lanes, typechecks, lint and both project reviews. Remove displaced helpers and
lists in the same scoped commit; record remaining semantic migration gates in
the owning roadmap.
