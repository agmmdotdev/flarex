# Prepared Definition And Explicit Audit

Status: implemented within approved preflight 76. Ordinary steps still restore
full stored history. This slice removes repeated structural-handler preparation
within a run and establishes a source-private read-only audit; it does not enable
the direct-dependency transition or establish linear installation complexity.

## Immutable preparation

`migrationCoordination/definition.ts` prepares the existing target-bound
structural runner and direct dependency ordinals once per coordinator run. The
claim retains only those immutable execution values. Every transaction still
restores its live head, fence, lease, base availability and receipt history.
Uncertain-outcome recovery uses the same definition with a distinct recovery
session. Stored receipt issuance continues to use the exact restored plan's
step handles; execution uses the prepared runner's captured step handles.

Retain the existing structural runner as the authority for target/plan checks and
fixed handlers. Replace discarded and repeated runner preparation in the
coordinator. Do not add a stored-authority cache, second issuer, public token,
schema, identity, transaction owner or activation path.

## Explicit audit

`migrationCoordination/verify.ts` accepts a target, captured expected plan and
the existing transaction budgets. It reads and locks the current collision head,
fully restores selected history, verifies exact projected progress, checks that
the plan's entire receipt-root inventory equals the selected prefix, and observes
the catalog against that prefix. Receipted operations must remain exact; later
structural operations must be absent. Future validation operations create no
structure and are not treated as unreceipted objects.

The result is an absent or verified diagnostic snapshot with completion counts.
It is neither readiness nor permission to advance, activate or skip later checks.
The operation performs no metadata writes, DDL or repair. Changed canonical
bytes, mismatched progress, extra receipt roots and unreceipted structure fail
closed through existing repository and structural-runner error owners.

## Retained work and completion gates

The explicit audit currently uses the full restoration owners and their existing
graph bounds. [Receipt lookup indexes](./80-receipt-lookup-indexes.md) remove
repeated plan-step and dependency-row scans within those readers. It is not yet
the O(N + E) verifier, privileged-repair workflow or
trusted installer facade. Those owners and the direct-dependency normal step
must be completed before retiring ordinary full reconstruction. Final readiness
continues through the existing coordinator's full validation/publication owner.

Prove one runner preparation per uninterrupted run, absent/partial/settled audit
without head mutation, corruption refusal and unreceipted DDL refusal on both
PGlite and the protected ordinary-login PostgreSQL target. Preserve additive,
takeover, restart, rollback and uncertain-COMMIT regressions, and connected
Product and Payload installation/binding proofs. PGlite is functional evidence;
neither lane alone establishes deployment readiness or a performance result.
