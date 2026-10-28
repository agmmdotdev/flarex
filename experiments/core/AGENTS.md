# Experimental core rules

Root [AGENTS.md](../../AGENTS.md) applies. This file adds the experiment boundary;
it does not reproduce or weaken shared correctness, skills, review or commit rules.

## Scope

- Current work is design-only. Keep the discussion/proofs in `experiments/core/`
  and update their owning accepted-design/roadmap pointers together when the
  user requests a direction change. The accepted [refactor direction](./engine/REFACTOR.md)
  targets the existing core and integrations; no runtime edit follows from
  documentation approval. Preserve unrelated shared-checkout work.
- Experimental internal APIs, representations, SQL and physical storage may be
  replaced. Do not import active execution/admission/readiness/settlement machinery
  merely to make the prototype run; that would carry the design under test into
  the candidate. Reuse correct shared owners after a responsibility/dependency
  audit; do not rebuild them solely because they are in active packages.
- Keep experimental bridge/proof wiring here until a connected active-package
  migration is selected. Reuse existing native and sound adapter implementations;
  do not recreate all integration coverage in a second engine. Bridges translate;
  core modules own integrity, SQL, authorization gates, settlement and recovery.
- Use the current Payload/Medusa integrations as requirements evidence: inspect
  executing native lifecycle, observable results/errors, durable obligations,
  failure cases and supported integration branches. This is not a backward
  compatibility requirement for their internal adapter/core contracts. Derive
  the new execution design from those obligations; do not copy their repeated
  admission/readiness, repository handoffs, per-call construction or round trips.
  An old helper, interface or fixture alone does not make its sequence required.
  Preserve a boundary only for a named semantic obligation and executable witness;
  narrow implementation reuse still needs the dependency audit below.
- Treat current integrations as reusable implementation as well as requirements
  evidence. Before rebuilding a connected path, classify its native behavior,
  translation and execution plumbing as reuse, adapt or replace. Reuse sound
  implementations and behavioral assertions; replacement needs a concrete coupling
  or responsibility reason. New core injection must permit a new execution
  sequence, rather than emulate old internal contracts around it. Follow the
  reuse map in [engine/REFACTOR.md](./engine/REFACTOR.md) and the baseline evidence
  in IMPLEMENTATION.md before broad module expansion.
- Repository/workflow bridges, working-set contracts and atomic lifetime plumbing
  may be redesigned together here. Do not preserve old core-facing interfaces
  through compatibility wrappers merely to minimize adapter edits. Preserve
  required native behavior. The current documentation scope leaves integration
  code untouched; later selected replacements migrate the existing consumers.
- No active package may depend on this folder. Do not modify shared manifests,
  lockfiles, framework sources or production routes for experiment convenience.
  Local tooling must be explicit and must not add tests to ambient discovery.
- Use a unique disposable database or namespace and restricted serving role.
  Record ownership before acquisition. Cleanup must verify the exact owned target;
  never reset current integration databases, schemas or durable data.

## Design and iteration

- The current design discussion starts at [engine/README.md](./engine/README.md).
  Work through one active concept at a time using its decision register. Explain
  the Convex mechanism, alternatives, costs and failure cases before recording
  the owner's decision. Do not infer acceptance of later concepts from approval
  to explore the engine direction. Update the affected notes after each decision.
- Keep unresolved questions and their primary references in
  [engine/OPEN-QUESTIONS.md](./engine/OPEN-QUESTIONS.md). Focused concept notes link
  to that queue instead of maintaining competing lists. Queued concepts are not
  implementation tasks; record a decision or explicit deferral before moving on.
- Distinguish proposed, accepted, implemented and measured claims. Follow the
  accepted app/commit decisions in the register; unresolved protocols are not
  implied decisions. Replication is explicitly deferred. Documentation acceptance
  does not remove runtime checks, implement a host or approve source translation.
  Keep current behavior/measurements as baseline until a verified replacement.
- Inspect the corresponding pinned Convex owners before each engine design and
  later implementation slice, including relevant callers/tests. Follow the exact
  pin and [divergence rules](./REFERENCES.md#source-and-divergence-rules). Record
  mechanisms, invariants, concurrency/failure paths and the reason, replacement
  and required evidence for every difference; old plumbing alone is not a reason.
  Use executing native framework sources when Convex has no equivalent. Keep
  adapted mechanisms traceable to their pinned source files and symbols.
  Preserve PostgreSQL authority and Drizzle.
- Follow [MODULES.md](./MODULES.md). Define each contract at its actual owner;
  avoid a universal context, generic engine registry or options bag.
- TypeScript RAM caching is allowed. Choose existing libraries, local structures
  or SQLite indexes by required semantics and evidence, not by a Rust type name.
  A module must not add its own RPC, transaction or fresh admission by default.
- Distinguish immutable definitions, fresh observations, policy decisions and
  mutation authority. A type, hash, cached object or signature is not a fresh
  database verdict. Do not expose raw DB/commit capabilities to framework code.
- Every replacement states its hypothesis, removed interaction, affected
  guarantees and executable witness. Report remaining complete-request overhead.
- Specify operation shapes, indexed root ownership, invalidating writers and
  direct-command visibility/replay before their implementation. Use the concrete
  contracts in DESIGN.md and MODULES.md; keep before/after traces in the scoped
  implementation evidence. Separate modules must not introduce repeated admission.
- Preserve installation identity, selected-definition versions and authorization
  revocation as distinct concepts. Unrelated schema changes do not automatically
  invalidate the whole root. Missing writer/retention proof blocks check removal.
- Preserve supported observable behavior, not arbitrary implementation shape.
  Before changing failure order, identify effects, hooks, disclosures and durable
  obligations it protects. Unresolved ordering stays preserved. Tests alone do
  not establish that an internal sequence is a compatibility requirement.
- Runtime and schema choices are experimental until proved. Do not turn an
  unmeasured hypothesis into an accepted architecture claim.
- The initial candidate's scalar per-scope commit order remains baseline evidence.
  The successor may redesign it under the active ownership/acceptance concept;
  existing locks and layouts are not permanent constraints. A replacement must
  establish the required visibility, concurrency and recovery guarantees.
- Read the repo-local Effect skills and overlay for implementation. Keep pure
  calculation plain, pure fallible policy in Result, runtime decoding in Schema,
  and async work, cancellation and resources in Effect. Do not add per-field
  wrappers or bypass required constructs to pursue a benchmark.

## Evidence and completion

- Reuse native framework behavior and source provenance. Do not copy a service
  algorithm into the benchmark or weaken framework hooks to create a fast lane.
- Use module contract tests plus connected consumer tests; mocks cannot prove
  PostgreSQL isolation, permission, locking, query plans or recovery.
- Apply [VALIDATION.md](./VALIDATION.md) and root review requirements. Configure
  explicit local lint/typecheck/test scope when code is introduced; passing root
  commands that omit this folder is not evidence of checking the candidate.
- Significant code requires both root-mandated read-only reviewers. Docs-only
  work does not. Commit only owned completed work; failing experiments remain
  clearly rejected evidence, subject to the root commit rule.
- Parallel development is permitted; simultaneous benchmark load is not quiet
  performance evidence. Do not stop another chat's processes. Stop owned resources.
