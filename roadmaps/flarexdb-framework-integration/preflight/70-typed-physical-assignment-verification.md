# Typed Physical Assignment Verification

Status: candidate withdrawn; no runtime or type-contract change retained.

## Outcome, Owners And Non-Goals

Preserve the concrete name-assignment frame type produced by the existing
physical-value verifier, so its consumers do not structurally validate the same
immutable frame again after every successful verification or exact-byte cache
hit. This is a persistence-owned API correction, not a Medusa capability or a
new validation/cache framework.

The primary owners are `relationalSchema/physical/canonical.ts` and the existing
assignment entry in `migrationCoordination/planVerificationScope.ts`, under
`packages/persistence-postgres/src`. The three literal name-assignment call sites
are in `migrationCoordination/physicalNameAssignmentRepository.ts` and
`migrationCoordination/storedRestoration.ts`. Their database projection checks
and restored-reference issuance remain their responsibility.

This advances the seventeen-table Product/ShippingProfile installation witness
in [record 66](./66-connected-product-shipping-profile.md). It does not complete
that integration, prove all installation costs resolved, or authorize a wider
ledger-verifier refactor. No module-specific branch, schema, table, stored format,
new cache, capacity increase, transaction change, public export, tracing removal,
or timeout change is proposed.

The accepted FlarexDB design and package roadmap 16 retain database authority in
Postgres. [Record 27](./27-product-installation-reconstruction-cost.md) owns the
existing pure-verification and database-read lifetimes. [Record 68](./68-shared-installation-read-pass-overhead.md)
withdrew the tracing-only experiment; it is not an implemented prerequisite.
[Record 69](./69-located-transaction-static-drizzle-metadata.md) is a separate
located-transaction metadata correction and must not be mixed into attribution
or this commit.

## Current Evidence And Challenged Assumptions

The earlier actual fixture trace records roughly 188,000 assignment metadata
restorations and about 706 plan restorations for the 106-step installation.
Those counts are not counts of SHA-256 calculations. The physical-value verifier
already retains verified name-assignment frames under exact digest and byte
comparison in the bounded pure-verification scope.

Current source establishes the narrower duplicate:

1. `verifyStoredRelationalPhysicalValue` selects the name-assignment contract.
   Cold verification checks canonical encoding, digest, complete structure,
   embedded name evidence and derived spelling. Its result is detached and
   recursively frozen. An exact-byte warm hit returns that verified frame.
2. The function nevertheless declares `JsonObject` as its result, and its
   assignment cache also erases the frame type to `JsonObject`.
3. `restoreStoredRelationalPhysicalNameAssignment` immediately calls
   `isStoredRelationalPhysicalNameAssignmentFrame` again. This recursively checks
   exact own-data keys, namespace/name fields, identities, UTF-8 bounds and
   spelling shape, even for a warm verified frame. The two other literal callers
   repeat the same guard for their own diagnostic operation.
4. Separate row checks still compare storage ID, collision, namespace, spelling
   and name digest. Those comparisons authenticate fresh database projections;
   they are not redundant merely because the canonical frame is typed.

An inspector CPU sample of the unchanged assignment path in the actual
inventory-only fixture attributes approximately 2.4 seconds of inclusive samples
to `isStoredRelationalPhysicalNameAssignmentFrame`. General stored-canonical
decoding also accounts for about 2.4 seconds, while encoding and copying appear
elsewhere. These inclusive quantities overlap and are not additive or predicted
savings. The profile covers fixture work, not only the installation timer;
asynchronous Effect stacks do not provide complete logical call attribution.
Inspector positions refer to transformed modules, so source ownership is based
on symbols and the connected source trace, not sampled line numbers alone.

The recorded run used ordinary-role PostgreSQL and selected only the existing
inventory assertion; native operation assertions were filtered. The separate
record 69 candidate was present in the shared checkout for the recorded profile.
This is assignment-path attribution, not an exact whole-checkout baseline or a
before/after comparison of either correction. Local diagnostic output is retained
under `work/validation/shared-installation-profile/assignment-reconstruction-cpu.log`;
the temporary inspector setup/configuration was removed. No runtime correction
was made during this investigation.

The source also shows an exact-SQL-match path rebuilding canonical byte arrays
and driver-shaped assignment rows before decoding them. That is a separate
follow-up candidate. Eliminating it would require a carefully specified
SQL-result-to-restored-reference contract. Do not silently include that larger
change or conflate all its cost with the repeated structural guard.

## Recommended Contract And API

Refine the existing verifier's result for its existing literal `nameAssignment`
input to `RelationalPhysicalNameAssignmentFrame`. Preserve that concrete type
through the existing bounded assignment-verification entry. Keep one authoritative
implementation of structural and semantic verification; the signature must
describe its actual successful runtime result, not assert a type over unchecked
JSON. A focused internal typed operation is acceptable if necessary for sound
implementation; it must not become a second validator or public construction API.

Representative caller, before:

```ts
const frame = yield* verifyStoredRelationalPhysicalValue({
  kind: "nameAssignment", canonicalBytes, sha256Hex,
});
if (!isStoredRelationalPhysicalNameAssignmentFrame(frame)) {
  return yield* corrupt();
}
// Compare this read's actual database projections with frame.
```

After:

```ts
const frame = yield* verifyStoredRelationalPhysicalValue({
  kind: "nameAssignment", canonicalBytes, sha256Hex,
}); // RelationalPhysicalNameAssignmentFrame
// Keep the same comparisons against this read's actual database projections.
```

No new selector, module tag or dispatcher is introduced. The existing `kind`
selects an actual canonical-value decoding contract, not a commerce entity or
generic CRUD abstraction. Other physical-value kinds keep their current behavior;
do not migrate all verifiers merely to make return types uniform.

Cold verification must still establish every existing predicate and semantic
check before success is retained. A cache hit must still require exact owned
bytes and digest; the type alone is never a cache admission or database authority
claim. Preserve first-failure order, original typed failures, defects,
interruption and diagnostic operation mapping. If achieving sound refinement
requires a materially different shared canonical-decoder contract, stop for that
owner's preflight rather than widening this slice.

## Preservation And Cleanup Inventory

- Retain: SQL reads, complete exact-byte and sidecar comparisons, row decoders,
  storage IDs, collision/namespace/owner comparisons, name digest and spelling
  checks against stored columns, fresh restored-reference registration, lock/CAS
  boundaries, rollback and uncertain-outcome behavior.
- Retain: cold canonical and name-semantic verification, exact-byte warm matching,
  existing 512-entry/2 MiB assignment retention, one-operation pure lifetime,
  512-reference database read passes, cancellation cleanup and all deadlines.
- Extend: concrete result typing and the existing assignment entry only; typed
  success must be earned by the existing verifier and survive immutable reuse.
- Delete: only the three redundant caller-side structural guards and imports
  made unused by that migration. Keep the structural validator at its actual
  raw-input owner. There is no legacy/data migration or coexistence obligation.
- Defer: synthetic-row elimination, prepared assignment projections, event or
  receipt typing, memo-key/capacity changes, broad tracing changes, installed
  schema changes and ShippingProfile runtime activation.

Reject a type assertion, digest-only trust, global verified-object registry,
second cache, adapter fast path, or new restoration certificate. The minimal
correction preserves evidence already established by the existing owner.

## Disposition And Remaining Boundary

The experiment used a fixed shared-runtime checkpoint after record 69 was
implemented. Its candidate preserved the concrete assignment type in the
existing verifier and cache entry and removed only the three caller guards.
Focused adversarial checks established cold validation, exact-byte warm reuse,
both retention limits, cancellation cleanup and fresh stored-projection
rejection. The two-driver repository witness changed from two structural checks
per warm read to zero, while still issuing a fresh restored reference. The
concrete result type also passed the persistence typecheck.

That deterministic work reduction did not establish the agreed reproducible
meaningful installation benefit. Two clean candidate installation/cold-reopen
runs per driver were compared with unchanged baseline runs before and after
the candidate. PGlite showed a modest reduction, but PostgreSQL candidate and
baseline timings overlapped. An additional candidate launch that briefly
overlapped the tail of typechecking was excluded from the comparison. All clean
timing runs were serialized and used the same inventory assertion, seventeen
tables, 106 steps and unchanged deadline. Numerical receipts belong in Git;
the local experiment is retained under
`work/validation/typed-assignment-verification/`.

The candidate and its candidate-specific tests were removed. The four runtime
files match the accepted baseline: the verifier and assignment entry still
return/store `JsonObject`, and all three caller guards remain. There is no new
cache, decoder, authority, schema, deadline or retained overload. Broader
candidate regressions and significant-code reviews were not pursued after
withdrawal; passing focused correctness checks does not override the performance
acceptance gate.

The unchanged core completed both installation/cold-reopen control runs on both
drivers. This is bounded inventory evidence, not a diagnosis or resolution of
the earlier intermittent timeouts. Native ShippingProfile operation assertions
were filtered, and Link/connected-workflow completion remains unproved. Record
66 must reassess its shared-installation gate on the current core before
resuming those proofs; another speculative core abstraction is not a prerequisite
established by this experiment. Synthetic-row elimination and wider verifier
changes remain separate, unapproved boundaries.

## Validation And Completion Gates

These were the approved candidate's gates. The reproducible-benefit gate was
not met, so the withdrawal branch applies rather than implementation completion.

Before implementation, establish a stable shared-worktree checkpoint including
the disposition of record 69. Do not attribute a moving neighbor's change to
this candidate. Keep heavy database work serialized.

Require a compile-time witness for the concrete successful result and a
deterministic cold/warm runtime witness showing that repeated structural checks
are removed while cold validation still executes. Exercise malformed frames,
changed bytes under an old digest, invalid embedded name/spelling evidence,
different targets/collisions, retention overflow, failure then retry, cancellation
and escaped verification contexts. Do not weaken defensive raw-input validation.

Run focused physical-value/stored-restoration and assignment/plan repository
regressions on PGlite and ordinary-role PostgreSQL. Preserve warm-success then
changed stored bytes/projections rejection, missing assignments, physical-name
conflicts and distinct plan-step authority. Run existing fresh/additive and
Product/SalesChannel consumer regressions for a retained candidate. The existing
two-driver warm plan-corruption witness was exercised during investigation; it
does not substitute for the candidate's assignment-specific adversarial cases.

Compare an unchanged baseline with at least two uninstrumented candidate
installation/cold-reopen runs per driver using the same seventeen-table fixture
and 90-second deadline. Report the structural-check work reduction separately
from timing. Require reproducible meaningful improvement before retaining the
performance correction; do not select only favorable samples or claim the
intermittent storage/timeout investigation resolved. If it fails that gate,
withdraw the candidate and record the result.

For retained code, run affected typechecks, core/diff/staged lint, both required
read-only reviewers and final scoped checks. Remove temporary diagnostics, stop
owned resources, reconcile current roadmaps and create one scoped commit only
after verification. Native ShippingProfile/Link/workflow completion remains a
separate gate after the shared installation boundary is satisfactory.
