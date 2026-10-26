# Experimental core rules

Root [AGENTS.md](../../AGENTS.md) applies. This file adds the experiment boundary;
it does not reproduce or weaken shared correctness, skills, review or commit rules.

## Scope

- Work in `experiments/core/`. Read active code and source references as evidence.
  Preserve unrelated shared-checkout changes, including active Medusa work.
- Experimental internal APIs, representations, SQL and physical storage may be
  replaced. Do not import active execution/admission/readiness/settlement machinery
  merely to make the prototype run; that would carry the design under test into
  the candidate. Narrow reuse needs a named responsibility and dependency audit.
- Keep experimental framework bridges and comparison wiring here. Native framework
  packages may supply business behavior. Bridges translate; core modules own
  integrity, SQL, authorization gates, settlement and recovery.
- Repository/workflow bridges, working-set contracts and atomic lifetime plumbing
  may be redesigned together here. Do not preserve old core-facing interfaces
  through compatibility wrappers merely to minimize adapter edits. Preserve
  required native behavior and keep active integration files untouched.
- No active package may depend on this folder. Do not modify shared manifests,
  lockfiles, framework sources or production routes for experiment convenience.
  Local tooling must be explicit and must not add tests to ambient discovery.
- Use a unique disposable database or namespace and restricted serving role.
  Record ownership before acquisition. Cleanup must verify the exact owned target;
  never reset current integration databases, schemas or durable data.

## Design and iteration

- Follow [MODULES.md](./MODULES.md). Define each contract at its actual owner;
  avoid a universal context, generic engine registry or options bag.
- Distinguish immutable definitions, fresh observations, policy decisions and
  mutation authority. A type, hash, cached object or signature is not a fresh
  database verdict. Do not expose raw DB/commit capabilities to framework code.
- Every replacement states its hypothesis, removed interaction, affected
  guarantees and executable witness. Report remaining complete-request overhead.
- Preserve supported observable behavior, not arbitrary implementation shape.
  Before changing failure order, identify effects, hooks, disclosures and durable
  obligations it protects. Unresolved ordering stays preserved. Tests alone do
  not establish that an internal sequence is a compatibility requirement.
- Runtime and schema choices are experimental until proved. Do not turn an
  unmeasured hypothesis into an accepted architecture claim.
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
