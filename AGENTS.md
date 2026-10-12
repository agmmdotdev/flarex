# Flarex Agent Rules

Keep shared policy here; domain architecture and status belong in design notes
and living roadmaps, API guidance in skills, review methods in `.codex/agents/`,
and chronology and validation receipts in Git.

## Authority And Architecture

Use accepted design notes, especially `design-notes/flarex-db-accepted-design.md`,
then the owning roadmap and task scope, current code/schemas/tests, and pinned
primary sources. Git supplies provenance, not current architecture. Read status
labels literally; proposals and prototypes do not override accepted decisions.
`roadmaps/README.md` indexes owners; `roadmaps/16-package-boundaries.md` governs
dependencies and utility placement.

- Preserve the portable Convex developer model; inspect Convex first and record
  necessary Cloudflare, partitioning, licensing, or product divergences.
- Postgres alone owns committed application data, settlement, history, facts,
  and durable outcomes. Cloudflare coordination, caches, freshness state, and
  publication prefixes are not commit authority.
- Keep native Application OCC and framework-compatible Payload/Medusa profiles
  distinct. Shared persistence does not imply one universal transaction API.
- Framework adapters own their lifecycle and business semantics; only the
  trusted outer owner settles. Untrusted code must never receive raw database,
  transaction, scope-clock, commit, or finalizer capabilities.
- Runtime hosts are adapters. Trusted transaction logic stays framework-neutral.
  The production target is a private Cloudflare Worker using service bindings
  and cache-disabled Hyperdrive; compatibility hosts keep their recorded gates.
- Never hold a database transaction across untrusted execution, workflow pauses,
  or remote effects. Preserve lock order, fencing, idempotency, cancellation,
  rollback-only behavior, uncertain-outcome recovery, and atomic publication.
- Application reads record exact dependencies; writes retain revision/tombstone
  history. Independent committed calls do not become atomic implicitly.
- Backend analysis owns deployed-function metadata; managed execution artifacts
  remain invisible to application developers. Unsupported capabilities fail
  closed. Bounded tests do not establish deployment, scale, or arbitrary
  framework support.

## Ownership And Changes

- Scope work by authority, lifecycle, resources, compatibility, and activation;
  do not cap connected outcomes by file count. Reuse existing owners and types
  before adding interfaces, validators, codecs, services, or helpers.
- Generic utilities are total, deterministic, domain-neutral dependency leaves.
  Protocol, canonical encoding, crypto, Effect, persistence, host, framework,
  test, and authority policy stay with their actual owner.
- Existing code or fixtures alone do not prove compatibility obligations.
  Preserve supported public contracts, live traffic, external identities, and
  named durable data. Prefer clean replacement otherwise; retained duplicates
  need a named consumer/obligation and removal gate.
- Migrate callers and remove displaced code, exports, dependencies, fixtures,
  and stale documentation in the same scope. Preserve behavioral coverage;
  durable tables/data require an approved migration or reset disposition.
- Preserve unrelated shared-worktree changes. Inspect status and overlap; stage
  only owned paths/hunks. The main thread owns edits and Git; reviewers are
  read-only.

Adapters translate contracts; they must not repair shared-owner defects with
direct SQL, duplicate enforcement, extra transactions/lifetimes/recovery paths,
looser limits, swallowed failures, fallback behavior, or weakened tests.
Preserve a failing witness, identify its owner, record expected/actual behavior
and disposition in the owning roadmap, and tell the user. Stop dependent work
until that core correction is authorized; existing explicit in-scope approval
counts. Fix the correct owner and rerun owner and consumer regressions.
Test-harness defects may be fixed in scope, but harnesses must not reproduce
shared system logic. A passing rerun alone does not prove an intermittent
failure's root cause.

Use plain current names and `Legacy...` for retained displaced implementations.
Reserve `V1`/`V2` for real coexisting or decodable compatibility contracts.
Do not opportunistically rename symbols or add unneeded legacy/dual paths.

## Skills And Checks

Apply repo-local Medusa/Payload integration skills for their respective adapters.
For Effect or plain TypeScript whose semantics require Effect constructs, read
`.agents/skills/effect-ts-patterns/SKILL.md` and
`.codex/agents/effect-review-guide.md` before implementation/refactoring.
Apply `effect-ts-error-handling` when classification, recovery, retry, foreign
error mapping, or boundary logging changes.

For material JS/TS changes in configured Oxlint roots, run `pnpm lint:core` and
`pnpm lint:diff` before review, then `pnpm lint:diff -- --staged` on the exact
index before commit. No baselines, blanket disables, severity downgrades, or
assertion laundering. Policy/rule/scope changes require the `flarex-oxlint`
skill; `tools/oxlint/README.md` owns detailed commands.

Run affected typechecks, tests, builds, and source/compatibility guards.
Schema, transaction, isolation, locking, migration, outbox, and query-plan claims
require both PGlite and focused ordinary-role real Postgres validation; report
them separately. Use workspace-wide checks only for cross-cutting changes.
Stop owned Wrangler, Workerd, database, and temporary runtime resources.

## Review And Commit

Before committing significant code changes, spawn both read-only project agents:
`typescript-diff-reviewer` (TypeScript, contracts, reuse, Effect quality) and
`code-quality-diff-reviewer` (systems, data, trust, concurrency, recovery, tests).
Use model `gpt-6.1-sol` with `reasoning_effort: high` for both reviewers.
Significant includes behavior, public types/contracts, schemas/migrations,
non-trivial refactors, and material test expectations. Docs-only, formatting,
generated refreshes, and minor mechanical changes do not require these agents.
Give both the exact base/checkpoint, owned paths/hunks including untracked files,
contract, and validation evidence. Fix findings and rerun affected validation;
rerun both agents after substantive code changes. Their prompts own review
methods and evidence reporting.

After successful implementation, documentation, required review, cleanup, and
verification, create one scoped imperative Git commit without another request.
Do not commit failing or incomplete work unless explicitly requested; report
the blocker instead. Report the commit ID/title and material validation limits.

Update living roadmaps only when durable domain truth changes. Accepted design
notes own architecture; code/schemas/tests own behavior. Do not add commit logs,
review/test receipts, or rewrite roadmaps to justify accidental drift. Use
`roadmaps/_domain-template.md` when no focused owner exists.
