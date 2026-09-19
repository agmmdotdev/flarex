# CE2 Legacy Writer Exclusion

Status: implemented; continuous-maintenance activation remains subsequent work.

## Outcome And Owner

Close the legacy-generation bypass in the existing Application write-ownership
commit guard. Under the scope-clock lock, an active Application head of any
contract excludes legacy material writes and authenticated attempted writes,
including insert/delete pairs with no final rows. Missing attempted-write
evidence also refuses. Contract 3 keeps its existing stronger generation rule.
Contracts 1/2 may settle an authenticated read-only legacy attempt; this does
not change rows or index memberships. Existing dependency validation remains.

Use the already-read active-head status; no second catalog query, adapter gate,
legacy index engine or maintenance registry is needed. The scope clock orders
this guard against activation. A durable prior outcome must replay before new
write admission, including after Application activation.

## Breaks And Consumer Inventory

Legacy runtime attempts can execute or recover their journals but cannot publish
new writes after an Application becomes active. The executor's
`pointMutationExactRuntimeRunner` and `pointMutationSessionActivation` retain
their named non-Application execution consumers; they do not gain Application
write authority. Stored-attempt publication and rollback proof share the same
decisive transaction guard. Lower publication tests without an active head
remain valid primitive tests and cannot establish continuous serving authority.

Migrate the natural relation-source writer fixture to actual Application
mutation admission, verified grant/session activation and issued ordered-index
ports. Reuse the grant fixture with the existing native activation regression;
do not install Application authority by updating legacy session rows.
Keep its original relation conflict, retry and readiness proofs. Retain legacy
read-only relation witnesses only with authenticated empty attempted-write sets.
Do not relabel a legacy writer as Application with a caller-supplied generation
flag, weaken assertions or install an alternate materialization path.

No durable format changes or data deletion are needed. This closes legacy
writer exclusion; activation-bound continuous maintenance and coverage-write
removal remain subsequent work under preflight 18.

## Validation And Completion

Exercise contracts 1/2 through real activation and legacy publication/proof
refusal, including material and net-zero attempts and missing attempted-write
evidence. Verify refusal leaves rows, indexes, commits, outcomes and scope clocks
unchanged. Preserve pre-activation durable replay and no-active legacy writes.
Use both PGlite and ordinary-role PostgreSQL; verify an activation holder blocks
the commit guard and the released waiter sees the new head. Keep contract-3,
native Application and relation-source consumer regressions, typecheck, lint and
both read-only reviews. Remove the permissive active legacy write branch and
reconcile current roadmap claims in the same commit.
