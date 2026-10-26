# Correctness and performance gates

No gate has passed for the experimental core. Documentation checks establish only
that the implementation brief and source references are coherent.

## Three comparison lanes

| Lane | Purpose |
| --- | --- |
| Native Payload/Medusa | Complete business reference using genuine framework behavior |
| Active Flarex | Current complete behavior and measured overhead baseline |
| Experimental Flarex | Candidate with its declared full guarantees and supported profile |

All lanes must execute the same admitted business graph, data size, selections,
hook branches and complete result assertions. Native independent framework commits
are not atomic mixed execution: explicitly attribute Flarex's additional snapshot,
OCC, history and atomic outcome obligations. Do not pretend that difference proves
either unavoidable overhead or equal semantics.

Use the existing harness semantics and native workload definitions. Local
experimental wiring may invoke them; it must not rewrite business work to suit
the candidate. Record a missing match as a missing match, not a synthetic baseline.

## Required behavioral witnesses

| Area | Witnesses |
| --- | --- |
| Access | Foreign tenant/source/method, revoked principal, denied membership/body access, stale capabilities; no protected body escapes before acceptance |
| Generation/readiness | Concurrent activation/retirement, unrelated unavailable index, required unavailable index, maintenance crash/reopen and actual protected-writer enforcement |
| Snapshot/dependencies | Read-your-writes, repeated point read, missing row, insert/update/delete phantom, bounded pagination and changed membership, retained-history expiry |
| Native contracts | Payload Local API access/default/validation/hooks/nesting; Medusa service normalization/errors/visibility; exact values/null/omitted fields; complete results |
| Settlement | Same-row conflicts, independent writes, concurrent unique claims, reference races, atomic cross-framework rollback, history/index/fact/event/outcome agreement |
| Failure/recovery | Caught rejection still poisons root where required, cancellation during each owned phase, late callback, stale attempt, lost COMMIT response, idempotent resolution before replay |
| Resources | Bounded rows/bytes/time/cache lifetime, cancellation settlement/quarantine, all owned resources closed, no transaction across untrusted callbacks or remote effects |
| Modularity | A material module implementation can be replaced through its declared contract without rewriting framework business behavior or unrelated lifecycle owners |

Expected failures, defects and interruption stay distinct. For error-order changes,
include a witness showing which callback, external effect or disclosure can occur
before refusal. Preserve unresolved barriers. Each gate runs on PGlite and focused
ordinary-role PostgreSQL when it claims database semantics; report the two lanes
separately. Mocks and PGlite alone do not establish real PostgreSQL behavior.

## Measurement protocol

- Pin source and settings before and after each run. Active integration is moving:
  Git HEAD alone is insufficient when inputs are dirty. Retain hashes of every
  executing candidate, active/native implementation and workload file.
- Separate installation/preparation/seeding/readback/cleanup from request time.
  Request time includes admission, business work, native hooks, result handling
  and confirmed settlement. Report cold/preparation costs separately.
- Use matched alternating complete-request comparisons after at least five
  warmups and at least 30 measured pairs, preferably 100 for acceptance. Keep
  every sample/failure; calculate percentiles of paired differences.
- Run quiet latency, client CPU and SQL/profiler diagnostics separately. Label
  CPU quantum and observer costs. Driver-await elapsed time is not client CPU
  or exclusive PostgreSQL execution. Do not add nested timing spans.
- Report latency median/P95, paired excess, client CPU, server timing where
  available, peak memory, exchanges, statements, checkouts, explicit transactions,
  rows/bytes and publication work. Distinguish implicit SQL transactions.
- Use ordinary-role PostgreSQL with durability settings matching the reference.
  Faster tests obtained by disabling durability do not qualify.
- Concurrent coding can continue. Quiet measurement requires no competing heavy
  benchmark/test load; record interference and rerun invalid comparisons. Never
  stop another owner's resources to obtain an idle machine.

## Acceptance

The existing complete mutation targets remain **at most 5 ms added median and
10 ms added P95 latency**, and **at most 16 ms median added client thread CPU**,
against the matched native graph. Report CPU below measurement resolution as
unresolved, not zero. These are inherited goals, not predicted prototype results.
See the [native baseline contract](../../roadmaps/mixed-mutation-core/26-native-business-baseline-preflight.md)
and [CPU gate](../../roadmaps/mixed-mutation-core/27-shared-execution-evidence-redesign-preflight.md#full-document-pipeline-redesign).

First-workload measurements guide iteration but do not establish full acceptance.
All five existing complete graphs must pass before claiming the experiment meets
the mutation performance goal. If standalone read tuning is included later, use
its separately owned targets; do not substitute mutation budgets for read goals.

Also vary touched rows, unrelated schema size, index/relation fanout, batch size,
concurrent roots and scope distribution. Record the changed variable and all
limits. Flat helper counts do not prove scale; hot shared locks can erase a
single-request win. Hosted claims require the actual Worker/Hyperdrive lane.

Do not weaken correctness assertions, remove necessary business branches, raise
limits or change a baseline to pass. An experiment can be informative and still
fail acceptance. Preserve that disposition and select a different hypothesis.

## Reviews and checks

Run explicit experimental typechecks/lint/build/source guards plus affected
behavioral suites. Root lint commands may omit this directory; inspect their
scope. Significant code requires the two reviewers specified in root AGENTS.md,
with exact owned paths/checkpoint and both-driver evidence. Re-review substantive
changes. No runtime tests or reviewer passes are claimed by this documentation.
