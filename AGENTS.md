# Flarex Agent Rules

This file is the compact, always-loaded operating policy for agents working in
this repository. Architecture, rationale, capability status, implementation
notes, compatibility inventories, exact commands, and test receipts belong in
their owning design notes, roadmaps, skills, or Git history.

## Purpose And Authority

Flarex is a Convex-inspired, Postgres-authoritative backend hosted on
Cloudflare. Postgres is the only authoritative committed application-data
store. Cloudflare hosts sandboxed execution, service bindings, WebSockets,
coordination, and explicitly non-authoritative freshness or cache state.

Use current evidence in this order:

1. Accepted design notes for cross-domain architecture, trust boundaries, and
   replacement policy, especially `design-notes/flarex-db-accepted-design.md`.
2. The relevant living domain roadmap and approved focused preflight.
3. Current schemas, code, and decisive tests for exact implemented behavior.
4. Checked-in primary sources such as Convex or a pinned framework fork for
   compatibility semantics.
5. Git history and older checkpoints for chronology and provenance only.

Read status labels literally. A prototype, proposal, deferred idea, existing
code path, or newer timestamp does not override an accepted design. Verify the
current owner and status instead of copying historical assumptions.

Use plain, unversioned names for the accepted current implementation and
`Legacy...` for a retained displaced implementation. Use `V1`, `V2`, and
similar suffixes only for concrete compatibility contracts that may coexist or
require exact decoding or migration. Do not opportunistically rename symbols,
add dual paths, or preserve legacy code without an owner-approved slice and a
proven compatibility obligation.

## Durable Architecture Invariants

- Preserve the Convex developer mental model and core behavior where portable.
  Inspect Convex first; record each necessary Cloudflare, partitioning,
  licensing, or product divergence in the owning roadmap.
- Postgres owns authoritative state, transaction settlement, commit history,
  facts, and durable outcomes. A cache, actor, host, adapter, or publication
  prefix is not commit authority.
- Native Application OCC and framework-compatible Payload or Medusa relational
  profiles may share persistence and publication infrastructure without
  becoming one universal transaction or journal API.
- Keep framework lifecycle and business semantics with their framework adapter.
  Only the trusted outer owner settles. Never expose raw database, transaction,
  scope-clock, commit, or finalizer capabilities to untrusted code.
- Runtime hosts are adapters, not executor core. Keep trusted transaction logic
  in framework-neutral packages. The production host target is a private
  Cloudflare Worker through service bindings and cache-disabled Hyperdrive;
  compatibility hosts retain their recorded gates.
- Do not hold a database transaction across untrusted execution, workflow
  pauses, or remote effects. Preserve lock order, fencing, idempotency,
  cancellation, rollback-only behavior, uncertain-outcome recovery, and atomic
  publication.
- Application reads must record exact dependencies and writes must retain
  revision/tombstone history. Independently committed calls do not silently
  become one atomic mutation.
- Keep backend analysis authoritative for deployed function metadata and keep
  Flarex-managed execution artifacts invisible to application developers.
- Unsupported capabilities fail closed. Do not present a bounded test,
  compatibility adapter, HTTP success, or private profile as production,
  deployment, scale, or arbitrary-framework proof.

The accepted architecture and current package responsibilities are indexed in
`roadmaps/README.md`; repository-wide dependency rules and utility ownership
are owned by `roadmaps/16-package-boundaries.md`.

## Design Challenge And Capability Approval

Treat user proposals, markdown, current code, and the agent's first idea as
hypotheses. Before a meaningful implementation capability, inspect the accepted
design, owning roadmap/preflight, current code and tests, related completed or
deferred work, and the governing primary source. Challenge duplicate authority,
unsafe trust or transaction boundaries, stale assumptions, missing failure or
recovery behavior, premature abstractions, and unnecessary compatibility.

Discuss one proportional preflight with the user before implementation. State:

1. the coherent outcome, affected owners, and explicit non-goals;
2. why it should happen now and the nearest end-to-end proof it advances;
3. the evidence and owning design or roadmap;
4. challenged alternatives and the recommended direction; and
5. validation, compatibility, cleanup, and completion gates.

When legacy or displaced paths are involved, classify them as retain, extend,
replace, or delete and name the evidence and retirement gate for anything kept.
Do not begin the capability until the user approves it. Approval then covers
ordinary in-scope implementation, test fixes, validation, roadmap
reconciliation, required review reruns, cleanup, and one coherent commit.

Pause for a new preflight only when evidence requires a materially different
owner, trust/authority boundary, schema or migration, transaction contract,
public contract, identity/version, compatibility obligation, routing, or
activation decision. An additional in-scope file, ordinary implementation
detail, or test failure does not by itself require another approval. Discussion,
research, documentation, formatting, and mechanical work do not need a
ceremonial preflight.

## No Glue-Fixing Core Owners

Adapters may translate framework-owned inputs, outputs, lifecycle callbacks,
errors, and capabilities. They must not compensate for a defect, missing
invariant, or insufficient contract in a shared or core owner.

When an integration, system test, or application simulation exposes a
shared-owner problem:

1. preserve or strengthen the failing witness;
2. identify the responsible owner and trust boundary;
3. record the reproducible scenario, expected and actual behavior, evidence,
   and current disposition in the owning roadmap or design note; and
4. tell the user and stop at that ownership boundary until a core correction is
   explicitly approved.

Do not make the consumer pass by weakening assertions or validation, raising or
bypassing limits locally, introducing direct SQL or storage access, creating a
second transaction, lifetime, publication, or recovery path, duplicating core
logic, swallowing failures, or adding fallback, comparison, or dual behavior.
Test-harness-local defects may be corrected within the approved slice, but a
test package must not reproduce shared system logic.

After approval, fix the narrowest correct owner, retain its trust and lifecycle
semantics, remove diagnostic or compatibility scaffolding without a proven
obligation, and rerun both owner and consumer regressions. A passing rerun does
not establish the root cause of an intermittent failure.

## Implementation Scope And Ownership

- Work in coherent, bounded capabilities. Bounded means explicit authority,
  ownership, resource, compatibility, and activation limits; it does not mean
  artificially tiny files, turns, or commits.
- Reuse an existing owner before creating another interface, validator, codec,
  service, registry, transaction API, or helper. Repetition alone does not make
  a helper generic.
- Keep generic utilities total, deterministic, domain-neutral dependency
  leaves. Protocol, persistence, host, framework, test, authority, crypto,
  canonical encoding, Effect, and compatibility policy stay with their real
  owner. Apply `roadmaps/16-package-boundaries.md` for detailed cases.
- Compatibility is evidence-triggered, not code-triggered. Existing code,
  fixtures, and regression tests do not alone establish a shipped obligation.
  Prefer clean replacement when no durable data, live traffic, external
  identity, or supported public contract requires coexistence.
- Preserve unrelated work in shared worktrees. Inspect status and overlap,
  stage explicit owned files or hunks, and never revert, rewrite, or absorb
  another task's changes.
- The main thread owns every file edit and Git operation. Reviewer agents are
  read-only.

## Integration, Effect, And Oxlint Routing

For Payload integration planning, implementation, refactoring, or review, apply
`.agents/skills/payload-flarex-integration/SKILL.md` for native reuse, typed
operation boundaries, runtime/test separation, and cleanup evidence.

Any agent implementing or refactoring a flow that uses or semantically requires
Effect, Schema, Result, Option, Exit, Match, Config, Context, Layer, Scope,
Fiber, Effect HTTP, Effect tests, runtime bridges, or typed Effect errors must
read and apply `.agents/skills/effect-ts-patterns/SKILL.md` and
`.codex/agents/effect-review-guide.md`. Also apply
`.agents/skills/effect-ts-error-handling/SKILL.md` when failure classification,
recovery, retry, foreign error mapping, or boundary logging changes.

Apply those standards during implementation, not only review. Preserve exact
data contracts, expected failures versus defects/interruption, evaluation and
first-failure order, dependency requirements, and request/transaction/Worker/
Durable Object lifetimes. The skills own API-selection detail and examples;
do not reproduce their cookbook here.

For materially changed JavaScript or TypeScript in configured Oxlint roots, run
`pnpm lint:core` and `pnpm lint:diff` before significant review, then
`pnpm lint:diff -- --staged` against the exact index before commit. Do not add
baselines, blanket disables, severity downgrades, assertion laundering, or
unrelated cleanup. Changes to Oxlint policy, rules, severity, provenance, or
scope must apply `.agents/skills/flarex-oxlint/SKILL.md` and its full validation.
`tools/oxlint/README.md` owns command and rollout details.

## Review, Validation, And Git

Before committing a significant code change, spawn both project reviewers:
`typescript-diff-reviewer` and `code-quality-diff-reviewer`. Significant means
behavior, public contract/type, schema/migration/data model, non-trivial
refactor, or material test-coverage/expectation change. Docs-only, planning,
formatting, generated refreshes, and minor mechanical changes do not require
them; ordinary investigation and test-fix loops use main-thread self-review.

The TypeScript reviewer owns TypeScript design, responsibility and utility
placement, reuse of existing owners and types, API/runtime contract agreement,
type soundness, typed errors, Effect applicability, and Effect composition and
implementation quality. The code-quality reviewer owns behavioral/data
correctness, trust, transactions/concurrency, reliability, performance, operability,
maintainability degradation, failure modes, and test adequacy. Their source of
truth is `.codex/agents/`. If substantive code changes after review, rerun both
reviewers against the final diff. The main thread triages findings, makes all
fixes, and reruns validation.

Give both reviewers the exact base/checkpoint, owned paths or hunks (including
untracked files), approved contract, and validation evidence. Keep that scope
stable during review; unrelated dirty work is not part of the checkpoint.
Reviewers must investigate connected contracts and existing owners or concrete
failure scenarios, and report evidence and gaps alongside findings. Passing
checks, coverage counts, and no findings do not establish review depth. The
reviewer prompts own the investigation and reporting details.

Validate proportionally with affected typechecks, focused tests, builds, source
or compatibility guards, and lint. Schema, transaction, isolation, locking,
migration, outbox, and query-plan claims require both a fast PGlite lane and a
focused ordinary-role real-Postgres lane. Keep those results distinct; a small
or passing test does not prove production performance, Cloudflare behavior, or
deployment readiness. Run workspace-wide commands only for genuinely
cross-cutting changes. Stop any owned Wrangler, Workerd, database, or temporary
runtime resources after validation.

After a repository-changing capability is implemented, documented, reviewed
when required, and successfully verified, create one scoped Git commit without
waiting for another request. Never commit known-failing or incomplete work
unless the user explicitly asks. Stage only owned files/hunks, use an imperative
title, and report the commit ID and title. If verification fails, leave the work
uncommitted and explain the blocker.

## Living Roadmaps

Roadmaps own current architecture, rationale, domain status, known gaps,
direction, and correctness gates. Accepted design notes own cross-domain
decisions; code, schemas, and tests own exact behavior; Git owns chronology and
verification receipts.

Update a roadmap only when durable domain truth changes. Do not add commit IDs,
commit summaries, reviewer receipts, test receipts, or chronological checkpoint
logs. Verify claims against current evidence, remove or clearly mark superseded
statements, and never rewrite a roadmap merely to legitimize accidental code
drift. Use `roadmaps/_domain-template.md` when no focused owner exists.
