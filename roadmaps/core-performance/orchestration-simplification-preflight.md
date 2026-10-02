# Orchestration Simplification: Selected Replacement

Status: **the selected standalone-read and installation lifecycle replacement is
implemented for its local profiles.** Consumer cutover is complete. The owner
accepted the recorded latency for now; tuning is paused and the full performance
targets remain unproven.

The [first connected slice](./standalone-read-redesign-preflight.md) owns the
operation graph, integrity amendment, writer/lease contract, caller migration,
strict native latency/scaling gates and implementation order. The
[accepted design](../../design-notes/flarex-db-accepted-design.md#selected-standalone-read-replacement)
is the authority for the selected mechanism changes. The
[target index](./orchestration-target-design.md) retains the separate deferred
finite graph; its recovery decisions do not belong to standalone retrieval.

## Required Guarantees And Replaceable Mechanisms

| Preserve | Replace where the named cutover proves the guarantee |
| --- | --- |
| Postgres-authoritative scope, placement and current access | Repeated scope/metadata construction in each layer |
| Immutable schema/protection authenticity | Request-time whole-catalog/function/trigger reattestation; move structural proof to managed installation lifecycle |
| Actual query-serving eligibility | Whole-source readiness and unrelated definition traversal |
| Exact native results, missing/error, visibility and snapshot | Adapter-local assembly and extra transaction factories |
| Revocation, version/generation changes, cancellation and safe result release | Full immutable rebuilding as a substitute for compact current checks |
| Bounded resource ownership and closed capability refusal | Repeated preparation rather than an existing bounded host lease |

No SQL spans untrusted code. Cached metadata is not authority. A verified digest
identifies immutable bytes; it does not prove writer policy or current readiness.
The actual standalone profile must not inherit finite claims/journals merely
because they supply an existing helper.

## Challenged Alternatives

- **Keep all checks and combine SQL:** rejected as the primary design. The failed
  publication experiment reduced dispatches without passing latency. Count server
  work, not just transport.
- **Narrow query readiness but retain all hot structural attestation:** insufficient
  as the selected outcome. It leaves a known independent overhead owner untouched.
- **Cache `ready`, a role verdict, or a connection object:** rejected. Fresh
  admission belongs to the actual transaction, especially with transaction pooling.
- **Run the full proof once per cold Worker:** rejected as moving amplification.
  Installation verification belongs to controlled installation changes; cold
  preparation loads authenticated query-required metadata and remains charged.
- **Lock the existing global invalidation epoch at request entry:** rejected as a
  local shortcut. It changes writer lock order and can deadlock. A separate
  installation interlock needs full writer and contention proofs.
- **Treat arbitrary privileged edits as safely detected by a token:** rejected.
  The selected trust contract requires managed maintenance and explicitly trusts
  installation administrators; out-of-protocol repair requires stopped service.
- **Create a general deployment/migration platform first:** rejected. Implement
  only the bounded installation interlock, invalidation and recovery needed to
  make this read replacement sound.

## Decisions Selected Now

1. Query-required read readiness replaces whole-source serving readiness for
   named standalone readers, with explicit unused-definition refusal changes.
2. Managed installation integrity replaces repeated structural attestation;
   its permissions, maintenance gate and crash behavior ship in the same slice.
3. The existing host preparation owner gains a concrete bounded reusable
   immutable lifetime; cold/miss and pooling behavior are part of the contract.
4. Strict complete-request native overhead and unrelated-schema scaling gates
   replace acceptance by dispatch count or the old 400 ms guardrail.
5. Shared native consumers are migrated and displaced code removed together.
   Finite settlement/recovery and unrelated host pooling remain deferred.

These decisions do not establish implementation correctness. The implementation
must inventory actual writers/callers and prove races before omitting a check.
A discovered gap requires correction at the responsible core owner. Do not add
an adapter workaround, silently weaken a guarantee or repeat a generic approval
request for an already selected in-scope replacement.

## Evidence And Delivery Limits

The [native ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-retrieval/README.md)
establishes bounded scalar/collection DTO and missing-error parity, extensive
metadata work and delivered construction/acceptance improvements. It does not
prove arbitrary Product relation support, hosted latency or the new target.
Current functions and source inventories are listed in the first-slice preflight;
framework release/promotion authority remains in its existing owner.

The publication candidate is correctness-reviewed but performance-rejected,
uncommitted and excluded from the clean redesign baseline. Its partial correction
was withdrawn; preserve all evidence and do not resume that experiment as an
implicit dependency. The [publication handoff](./publication-source-proof-preflight.md)
owns its history. The unresolved mixed regression and startup variation remain
unexplained, not a reason to promise or require a host rewrite now.

Complete the installation/preparation/transaction/native-read cutover as one
substantial slice. Focused component checks help implementation; only the complete
native and scaling gates, connected correctness, final reviews and cleanup close
the slice. No new all-server profiling program or unrelated feature is a
prerequisite. Report unavailable measurements as unavailable.
