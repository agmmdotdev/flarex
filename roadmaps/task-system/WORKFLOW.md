# Task Replacement Workflow

Status: **accepted execution workflow under the active [goal](./GOAL.md)**.
This adapts the [current core replacement workflow](../../experiments/core/engine/REFACTOR.md#convex-guided-replacement-workflow)
to Trigger-derived Task replacement. Architecture remains in design notes;
this file owns how challenged slices become implemented/reviewed cutovers.

## Authority And Records

- [README](./README.md): current status and correctness gates.
- [GOAL](./GOAL.md): implementation scope, finish line and exclusions.
- [REFERENCES](./REFERENCES.md): exact sources, executing owners and reuse map.
- [DECISIONS](./DECISIONS.md): accepted/proposed/superseded implementation choices.
- [OPEN-QUESTIONS](./OPEN-QUESTIONS.md): one unresolved queue with affected paths.
- [Baseline](./baseline/README.md): real consumers, obligations and data owners.
- [Slices](./slices/README.md): bounded contracts, source challenge and convergence.
- [Divergences](./divergences/README.md): necessary changes to adopted mechanisms.

Git owns chronological receipts. Do not duplicate architecture or keep multiple
question lists with competing status. Accepted, implemented and measured are
separate claims; a reference test or a passing fixture alone proves none of the
unexecuted consumer/host/scale obligations.

## Independent Challenge Before Runtime Edits

The coordinator records responsibility, checkpoint, owned paths, real consumers
and expected cleanup. Assign independent read-only agents to challenge:

| Perspective | Required evidence |
| --- | --- |
| Trigger source | Actual methods, constructors, transitive calls, original tests, policy/error branches and Prisma/Redis/product coupling |
| Current Task consumers | Executing callers, durable/public obligations, native continuation/checkpoint/compensation behavior, replay identities and meaningful witnesses |
| Shared core and accepted direction | Actual installation/catalog/readiness APIs, transaction/freshness/settlement profiles, index/cache writer participation and pinned Convex database mechanisms |

Agents form independent initial findings before exchanging evidence. Challenge
concrete races and failure paths, not only file structure: lost enqueue wake,
duplicate claim/start, stale fence, uncertain commit, cached absence, concurrent
capacity, timeout/confirm/cancel winners, partial fan-out and repeated children.
The coordinator covers gaps and resolves competing ownership claims.

Before code assignments, record **current owner -> adopted mechanism ->
keep/adapt/replace -> atomic units and bounds -> witnesses -> removed code**.
Link each necessary divergence. An unsettled guarantee pauses its affected
path for a decision; ordinary in-scope adaptation does not require another
permission round. Missing evidence stays open rather than becoming an assumed pass.

## Coordinated Implementation

Reconcile each storage-facing slice against the accepted Convex
[core and physical-schema translation](../../experiments/core/engine/REFACTOR.md#core-and-physical-schema-translation-plan).
Current APIs, layouts, installation sequences and migration contracts are inputs
to keep/adapt/replace, not compatibility obligations. Prove any required old
writer or named retained data and its disposition before preserving coexistence
plumbing. The Trigger fork keeps Task lifecycle ownership above shared core.

Assign worker agents explicit file/responsibility ownership, exact contracts,
dependencies and validation. Tell every worker that others share the codebase:
preserve their edits, coordinate shared types/contracts and never revert others'
work. Parallelize independent owners and serialize overlapping changes/handoffs.
Do not use a worker assignment to bypass the preceding read-only challenge.
Use the current shared checkout. The owner explicitly excludes creating a
worktree to bypass conflicts; communicate with the other session and resolve
ownership and integration directly before overlapping edits.

Retain actual Trigger method/control flow and relevant original assertions.
Adapt constructor/resource/store/coordination seams directly. No fake Prisma
client, legacy `decide` callback, duplicated retry policy or Task-specific
database/cache/installer may stand in for shared-owner correctness.

Root AGENTS.md governs skills, checkers, lint, both-driver and actual-host
validation. Apply Effect patterns/error guidance to contracts and implementation.
Typecheck with Oxc `tsrs --fast --noEmit`; do not substitute native `tsc` or
`tsgo`. For the new engine run
`pnpm --dir packages/trigger-run-engine exec tsrs -p tsconfig.json --fast --noEmit`.
Use the equivalent scoped Oxc command for affected existing packages, including
when their older package scripts still select native TypeScript.
Bound tests by their claimed evidence, not by weakening failures or mirroring
the shared implementation in a harness. Stop owned runtime resources and avoid
competing heavy work in the shared checkout.

## Reviews And Completion

Before significant code commits, run both read-only project agents:
`typescript-diff-reviewer` and `code-quality-diff-reviewer`, each with
`gpt-6.1-sol`, `reasoning_effort: high`, exact base, owned tracked/untracked
paths, contract and validation evidence. Pre-slice agents are not substitutes.
Rerun affected validation and reviews after substantive fixes as AGENTS.md requires.

Complete consumer migration and displaced-code cleanup in the same coherent
capability. Retain an old path only for a named unmigrated consumer/durable
obligation with an exit gate. Stage only owned paths/hunks and commit completed
passing work. Do not mark the overall goal complete until every finish-line
condition is met, and honor an explicit pause. One bounded source/installation/
engine proof is an intermediate milestone.
