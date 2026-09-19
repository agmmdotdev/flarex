# Active Publication Deadline And Recovery

Status: connected PostgreSQL deadline witness implemented under standing
core-redesign approval. The coordinated concurrency replacement remains open.

## Contract And Source Finding

The active concurrency baseline holds a publication before COMMIT. Before
changing that exclusion, prove what happens when its owner never resumes.
The PostgreSQL relational session already creates one absolute physical deadline
before connection acquisition and passes it through callback execution and
settlement. CMS's operation-level lifetime checks are not the only timeout.
`physicalSession/postgres.ts` bounds the callback, drains or quarantines pending
work and owns rollback/uncertain-settlement classification. Keep that authority;
do not add a second CMS timer based solely on the absence of a host-local timeout.

The selected proof stalls at the existing `afterPreferenceFacts` hook, after
actual rows, indexes, unique claims and publication families have been written,
but before advancing the clock or attempting COMMIT. The physical deadline must
end the request, interrupt its callback, and release or quarantine the connection.
The failed attempt must leave every inventoried durable family unchanged and
must not automatically execute the command again. An explicit later submission
of the same request key may run after confirmed rollback; successful settlement
then makes further submissions replay the one result.

This advances CE3's cancellation and lock-lifetime evidence through a real active
CMS consumer. It is not a replacement for uncertain-COMMIT recovery: this fault
occurs before the COMMIT decision. Preparation before the main relational session
remains outside its deadline and still has separate scope-clock dependencies.

## Owners, Alternatives And Breaks

Extend the existing PostgreSQL active-concurrency witness and reuse its real
fixture, publication hook, inventory and ordinary-role session. No alternate
transaction runner, test-only timeout policy, callback retry or error conversion
is introduced. Keep the physical error provenance visible rather than treating
every failure as a CMS `deadlineExceeded` error. A test watchdog is only a larger
failure bound and must not be the mechanism that makes the witness pass.

No runtime, public API, schema or durable-format change is planned. No displaced
production path exists to retain. PGlite continues to cover ordinary rollback and
replay through its existing shared CMS scenario; its worker-backed test session
is not the PostgreSQL physical deadline implementation and cannot prove this
driver's timeout/quarantine behavior.

## Validation And Completion

Require the physical callback deadline in the failure cause, completed callback
cleanup, no automatic rerun, unchanged scoped durable inventory, and a successful
explicit retry followed by durable replay. Check pool quiescence and the timed-out
backend's transaction release. Run the existing active concurrency and CMS
PGlite/PostgreSQL scenarios, including lost-COMMIT recovery, then affected
typecheck, lint, both project reviews, resource cleanup and one scoped commit.

Do not report the whole request as deadline-bounded or the critical section as
shortened. Same-scope preparation still waits, and the coordinated concurrency
and readiness-preparation replacements remain open.
