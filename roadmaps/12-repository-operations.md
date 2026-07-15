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
- Effect implementation and review use the global `effect-ts-patterns` skill
  plus `.codex/agents/effect-review-guide.md`. The skill owns reusable workflow
  and curated examples; the checked-in overlay owns Flarex's version-specific
  APIs, contracts, Cloudflare boundaries, and reviewer responsibility split.
- The Effect standard is active during implementation rather than deferred to
  review. Neighboring inconsistent code is not precedent, and bounded
  behavior-preserving touched-flow debt is corrected in the approved slice
  when focused validation exists.
- Effect review includes the smallest connected operation, service/Layer,
  runtime boundary, and direct call path. Concrete pre-existing debt may be
  reported when the diff materially exercises or relies on it, but reviewers
  do not roam unrelated files or turn checkpoints into package-wide migrations.

## Standing Reviewer Responsibilities

The TypeScript reviewer owns static/runtime contract agreement, public API
compatibility, exact success/failure/requirement channels, Schema and encoded
shape agreement, service and Layer dependency types, tagged errors, type
soundness, and reuse of stable repo-owned types.

The code-quality reviewer owns behavioral and data correctness, trust and
transaction boundaries, reliability, lifecycle and concurrency, performance,
operability, maintainability, test quality, and idiomatic Effect composition.

Both reviewers remain risk-adaptive. Effect-specific checks add to rather than
replace their broader responsibilities. An explicit Effect guide violation
introduced by the diff or pre-existing in its materially touched flow must be
reported when it is concrete and actionable, normally as a low-severity defect
when it has not yet caused a runtime failure. Pre-existing findings are labeled
touched-flow debt and must explain the connection to the change. Higher
severity still requires evidence of real correctness, security, data-loss,
compatibility, reliability, or operational impact.

## Effect Implementation And Review Boundary

The global skill and Flarex overlay record the durable distinctions established
from the current Effect v4 source, Flarex code, and curated T3 Code application
evidence:

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
- Effect v4 `Result`, not v3 `Either`, carries recoverable failure as data;
  `Option` is for intentional absence, while `Exit` is reserved for complete
  Cause-aware outcomes at lifecycle, runtime, diagnostic, and test boundaries;
- simple Boolean guards remain ordinary TypeScript, while tagged and structural
  unions use exhaustive Match patterns or exhaustive `switch` / `never` checks
  when a hidden fallback would make future variants unsafe;
- `Effect.match` is for pure branches and `Effect.matchEffect` for effectful
  branches; `pipe` supports clear linear composition and `Effect.gen` is
  preferred when several dependent binds, loops, or branches are clearer
  imperatively;
- ordinary outbound HTTP in Effect-native services uses an injected Effect
  `HttpClient` with explicit status, decoding, timeout, and retry policy;
  Cloudflare service-binding and Durable Object `fetch` calls remain narrow
  platform adapters rather than being mechanically treated as Internet HTTP;
- typed error provenance, exact `A`/`E`/`R`, Layer closure, Scope and structured
  concurrency, runtime placement, Schema compiler placement, observability,
  and Effect-native tests are part of the review, not optional extras.

Existing inconsistent code is migration input, not authority for new changes.
Reviewers do not turn a checkpoint review into an unrelated repository-wide
Effect migration.

## Authority And Reference Sources

- `AGENTS.md` is the workspace workflow authority.
- `.codex/agents/*.toml` is the source of truth for each reviewer.
- `C:\Users\Admin\.codex\skills\effect-ts-patterns\SKILL.md` is the global
  implementation and review workflow; its optional references contain the
  detailed pattern catalog and curated examples.
- `.codex/agents/effect-review-guide.md` is the concise Flarex overlay for
  installed-version facts, contracts, platform boundaries, review scope, and
  reviewer ownership.
- `opensrc/repos/github.com/effect-TS/effect-smol` is the preferred local API
  and library-pattern reference when available.
- `opensrc/repos/github.com/pingdotgg/t3code` provides curated application
  examples, diagnostics, and lint patterns; it is evidence rather than a
  uniformly correct authority.
- The parent `convex-backend` checkout remains the source reference for
  Convex-inspired behavior.

The local `opensrc/` cache is optional and may be refreshed for deeper research.
The global skill and checked-in overlay keep the decision rules available when
that cache is absent.

## Known Limitations

- Source snapshots can lag their upstream repositories; version-specific APIs
  must be checked against the Effect version installed by Flarex.
- Standing reviewers do not replace focused security, database, migration,
  Cloudflare-host, or real-Postgres validation when a future slice crosses
  those boundaries.
- The repository still contains legacy wrapper-style Effect functions and
  manual runtime bridges, raw-fetch/JavaScript error subsystems, and
  non-exhaustive conditional flows. They should be corrected incrementally
  when a change materially touches them and the correction fits the approved
  slice, rather than silently used as precedent or swept into unrelated work.
