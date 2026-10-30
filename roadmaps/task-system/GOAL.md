# Trigger-Derived Task Replacement Goal

Status: **active implementation goal; portable attempt-start component
implemented; connected replacement runtime not implemented**.
The owner authorized this goal after
accepting the independent Trigger fork and shared-core direction. This goal
supersedes the earlier documentation-only implementation boundary for this
domain. [README](./README.md) owns current domain status; the
[Task design](../../design-notes/task-system/README.md) owns architecture.

## Finish Line

Replace the custom Task lifecycle with one private independently maintained
`@flarex/trigger-run-engine` package, adopting actual connected Trigger engine
methods and tests. Migrate admitted consumers and remove the displaced lifecycle
and every Task-specific physical database representation. Preserve named durable
data and external identities through an explicit migration/reset disposition.
Generic Flarex physical infrastructure remains with its existing owners.

The goal is complete only when:

- Adopted engine methods execute creation, eligibility/capacity claims, start,
  heartbeat, completion, retry/delay, cancellation and recovery, including waits,
  native checkpoints and child outcomes required by the recorded consumers.
- All Task-owned scope/platform data uses private logical schemas. Shared core
  APIs own schema admission/installation/evolution, indexes, profile-correct
  reads, eligible DO cache reuse, settlement and durable publication. There is
  no separate Task database, cache, index engine or migration authority.
- Platform schema bootstrap and recovery work before the Task engine runs,
  independently of fabricated app analysis or app code redeployment. Schema
  admission, installation, readiness and activation retain separate guarantees.
- Source provenance/notices remain intact. The active fork has no Prisma,
  Redis, Redlock, full Trigger product infrastructure or runtime imports of the
  frozen reference. Unsupported features fail before creating obligations.
- Application, Payload where admitted, and actual native Medusa consumers use
  the same lifecycle. Native graphs, step retry, compensation and business
  meaning remain with framework owners. No stale worker may commit and no
  accepted child effect is blindly replayed.
- Cloudflare wake/timer/compute adapters use replaceable capabilities. Hints,
  queue acknowledgements, caches and process ownership are not commit authority.
  Required actual-host conformance and cold recovery pass before host admission.
- Scoped typechecks, guards, meaningful original/consumer tests, both database
  lanes and required reviews pass. Displaced callers/code/exports/dependencies,
  fixtures and physical setup paths are removed, with supported installs free
  of Task-specific physical objects and no permanent fallback or dual writes.

A scaffold, helper extraction, schema-only installation or one successful task
does not complete this goal. Unmet evidence, partial scope or exhausted context
does not change the finish line.

## Milestones

| Milestone | Required connected outcome |
| --- | --- |
| Source/consumer/core admission | Independent source challenge and peer exchange establish exact retained methods/tests, store operations, atomic records, supported consumers, bounds, core gaps and the first implementation contract |
| Installation and first engine proof | Authenticated shared-core Task schema installation plus retained methods execute the selected lifecycle, required wait/recovery branch and fresh-host recovery through logical storage |
| Shared indexing/cache and host proof | Every admitted writer participates in core publication; warm/cold reads, stale candidates, cache refresh, actual DO restart and injected Cloudflare delivery/timers/compute preserve the Task profile |
| Consumer cutover | Migrate complete Application and admitted framework behaviors, including reads/cancel/await, checkpoints, native failure/cleanup and committed child outcomes; remove each displaced path |
| Full retirement | Execute concrete data disposition, retire all old lifecycle/storage wiring and Task-only physical definitions/setup, and close supported-install and connected regression gates |

Milestones are outcomes, not a mandate for one package or commit per row. Admit
the smallest complete capability required by a real consumer; dependencies may
change the order. General populated-data evolution and arbitrary framework
support do not become prerequisites merely because shared APIs are required.

## Execution Contract

Follow [WORKFLOW](./WORKFLOW.md): independent source-grounded challenge before
each runtime slice, evidence exchange, coordinator convergence and explicit
worker ownership. Accepted routine adaptations and necessary internal breaks
within scope may proceed without repeated approval. Record unresolved changes
to guarantees and pause only the affected path; continue independent work.

The existing core refactor is a separately owned active goal. Inspect status and
overlap before assigning shared-owner changes; establish explicit ownership
handoff or an independent boundary before editing another session's work. Never
revert, stage or commit unrelated changes. Shared core defects are corrected at
their owner, not hidden by Task SQL, extra transactions or adapter recovery.
The owner requires the shared checkout: do not create a worktree to avoid
conflicts. Communicate directly with the active session, agree file/contract
ownership and resolve integration in place while preserving its work.

Postgres remains sole durable authority. Keep operation profiles distinct; no
transaction spans untrusted handler execution, remote effects or suspension.
Apply repository Effect/data/failure/lifetime guidance during implementation.
Follow current authorized checker/toolchain settings and scoped checks. Do not
run competing heavy database/benchmark jobs or restart paused benchmarks.

Significant code needs both project reviewers under AGENTS.md, independent of
pre-slice challengers. Fix findings, rerun affected validation/review, clean up
owned resources and commit each completed coherent slice. Git owns validation
receipts and chronology; design/status notes own durable domain truth.

## Scope Boundaries

The Trigger engine source pin and Convex database mechanism pin are recorded in
[REFERENCES](./REFERENCES.md). Trigger supplies lifecycle implementation; Convex
guides shared database mechanisms. Independent fork maintenance and adaptation
are accepted; upstream sync and broad Trigger feature parity are not goals.

No public API expansion, production rollout, additional cloud implementation,
general migration product or unspecified durable-data deletion is authorized.
Concrete unsupported requirements use [OPEN-QUESTIONS](./OPEN-QUESTIONS.md),
with source evidence and recommended disposition. The first admitted slice is
[source and installation contract](./slices/01-source-and-installation-contract.md).
