# Commerce command registration bound

Status: preflight complete; separate shared-owner approval required.
Baseline: 08a3c422. Record 45's text predicate is approved; this registration
change is not. The current Product gate remains 182 originals plus one skip
per driver, with 23 internal Product cases remaining.

## Reproducer and ownership boundary

The Record 45 implementation draft adds six fixed internal Product commands
to the existing 61 commands. The resulting 67-command catalog is rejected
during makeLocalCommerceHost composition, before any original test executes.

Owner: @flarex/persistence-postgres private commerce host.
src/commerceTransaction/host.ts:99 refuses when allowed.size exceeds
commerceLimits.calls (64), as part of its invalidAuthority check. The same
constant also bounds statement execution in store.ts. The scale profile's
request call budget does not change this host registration check.

Expected for the proposed compatibility slice: admit the six authenticated
fixed commands and run the complete original file through the existing host.
Actual: invalidAuthority at host composition; all 23 declarations skipped by
the failed beforeAll, then the exact coverage reporter rejects the run.
Evidence: external work/validation/internal-product-third-pglite.log
(80.547 seconds, zero original cases executed). This is a capacity admission
boundary, not a Product assertion failure or a text predicate failure.

AGENTS.md requires shared-owner defects/capabilities exposed by a system test
to be recorded and separately approved. Record 45 explicitly preserved limits;
its text-predicate approval does not admit changing this host registry bound.
Disposition: shared host unchanged. The unfinished adapter draft was archived,
and active adapter files, promotion manifest and case inventory were restored.

## Recommended coherent follow-up

Introduce one private commandDefinitions limit of 128 and use it only for
the host's authenticated command catalog size check. Preserve the existing
64 statement limit and every profile-specific per-request call, row, byte,
time and event bound. This separates two already distinct concepts: registered
operations available to a host and operations executed by a request.

Then resume the six fixed commands and finish Record 45's complete 23-case
slice, full 205-original gate plus one skip, and its adapter/lifecycle/event
regressions on PGlite and ordinary-role PostgreSQL in the same capability.

128 is a proposed finite catalog ceiling that accommodates 67 definitions
without coupling registry growth to transaction execution budgets. It is not
a performance or production claim.

Alternatives challenged:
- Raising calls also expands statement execution: unnecessarily broad.
- Removing existing commands loses admitted compatibility.
- Grouping unrelated operations into caller-selected dispatch commands obscures
  the existing fixed-command admission boundary.
- Splitting this single compatibility host solely to evade its current bound
  does not prove the requested whole command catalog.

Keep the authenticated command tokens, name uniqueness/grammar, reserved name,
mode checks, immutable capture, scoped manager, settlement and execution bounds.
Extend only registry cardinality. No schema, migration, persisted contract,
public API, second transaction owner, workflow or Module Link storage change.

## Proof and recovery

Add focused host composition tests: 128 distinct authentic definitions admitted,
129 refused, duplicate names/unrecognized tokens/reserved names still refused.
Prove that executing commands retains the existing statement and request limits.
Run the approved original and boundary suites, compiler/provenance/bundle gates,
both standing reviewers and exact staged lint before the coherent checkpoint.

Draft recovery:
C:/Users/Admin/Documents/Codex/2026-09-08/ok-n/work/internal-product-draft/
contains tracked.patch, seven new files, and receipt.json with baseline and
SHA-256 digests. Verify the receipt and git apply --check before restoring.
The draft passed the three adapter compiler projects, but has no passing
internal Product runtime proof. Fixtures and original assertions are unchanged.
Do not treat this artifact as completed or activate it without validation.

General test cleanup and Jest/Vitest promotion policy remain deferred until
the user-requested remaining compatibility cases are complete.
