# Repository Operations

## Goal

Flarex should operate as an independent project with durable, evidence-backed
agent rules, scoped checkpoints, and reviewers that evaluate both systems
correctness and the quality of TypeScript/Effect implementation.

## Current Durable State

- `custom/cloudflare-executor` is its own Git repository with
  `https://github.com/agmmdotdev/flarex.git` as `origin`. The parent Convex
  checkout ignores it, while remaining available as the primary Convex behavior
  reference.
- `AGENTS.md` owns durable workspace workflow: design challenge, implementation
  preflight, design precedence, living-roadmap maintenance, reviewer cadence,
  proportional validation, and automatic scoped commits.
- Git owns chronological implementation history. Domain roadmaps own current
  architecture, rationale, status, gaps, direction, and correctness gates; they
  do not duplicate commit logs or verification receipts.
- The main thread owns all writes and Git operations. Reviewer subagents are
  read-only and review only the current changed checkpoint.
- Significant code changes use two standing reviewers:
  `typescript-diff-reviewer` and `code-quality-diff-reviewer`. Docs-only,
  formatting-only, generated refresh, and minor mechanical changes do not
  require them.
- Reviewer behavior is defined in `.codex/agents/`. When Effect is in scope,
  both reviewers must read `.codex/agents/effect-review-guide.md`, apply its
  examples and exceptions, and report the Effect constructs they actually
  inspected.

## Standing Reviewer Responsibilities

The TypeScript reviewer owns static/runtime contract agreement, public API
compatibility, exact success/failure/requirement channels, Schema and encoded
shape agreement, service and Layer dependency types, tagged errors, type
soundness, and reuse of stable repo-owned types.

The code-quality reviewer owns behavioral and data correctness, trust and
transaction boundaries, reliability, lifecycle and concurrency, performance,
operability, maintainability, test quality, and idiomatic Effect composition.

Both reviewers remain risk-adaptive. Effect-specific checks add to rather than
replace their broader responsibilities. An explicit Effect guide violation in
new code may be reported as a low-severity concrete defect even before it
causes a runtime failure; higher severity still requires evidence of real
correctness, security, data-loss, compatibility, reliability, or operational
impact.

## Effect Review Boundary

The shared Effect guide records the durable distinctions established from the
current Effect v4 source and application evidence:

- observable Effect-producing operations and service-method implementations
  normally use named `Effect.fn`;
- reusable internal Effect functions may use unnamed `Effect.fn` for a stack
  boundary without an implicit span;
- demonstrated hot-path or deliberately zero-instrumentation Effect functions
  may use `Effect.fnUntraced`;
- pure functions remain ordinary TypeScript;
- standalone Effect values and one-off inline composition may use
  `Effect.gen`;
- concise pipelines and lifecycle-owned host bridges are judged by their real
  boundary rather than a syntax-only rule;
- typed error provenance, exact `A`/`E`/`R`, Layer closure, Scope and structured
  concurrency, runtime placement, Schema compiler placement, observability,
  and Effect-native tests are part of the review, not optional extras.

Existing inconsistent code is migration input, not authority for new changes.
Reviewers do not turn a checkpoint review into an unrelated repository-wide
Effect migration.

## Authority And Reference Sources

- `AGENTS.md` is the workspace workflow authority.
- `.codex/agents/*.toml` is the source of truth for each reviewer.
- `.codex/agents/effect-review-guide.md` is the shared Effect review decision
  guide and contains checked-in examples.
- `opensrc/repos/github.com/effect-TS/effect-smol` is the preferred local API
  and library-pattern reference when available.
- `opensrc/repos/github.com/pingdotgg/t3code` provides curated application
  examples, diagnostics, and lint patterns; it is evidence rather than a
  uniformly correct authority.
- The parent `convex-backend` checkout remains the source reference for
  Convex-inspired behavior.

The local `opensrc/` cache is optional and may be refreshed for deeper research.
The checked-in shared guide keeps the reviewer decision rules available when
that cache is absent.

## Known Limitations

- Source snapshots can lag their upstream repositories; version-specific APIs
  must be checked against the Effect version installed by Flarex.
- Standing reviewers do not replace focused security, database, migration,
  Cloudflare-host, or real-Postgres validation when a future slice crosses
  those boundaries.
- The repository still contains legacy wrapper-style Effect functions and
  manual runtime bridges. They should be corrected in approved, bounded slices
  rather than silently used as precedent or swept into unrelated changes.
