---
name: payload-flarex-integration
description: Plan, implement, refactor, or review Payload integration with Flarex. Use for the Payload database adapter, Local API composition, collection contracts, request lifecycle, queries, population, and integration cleanup. Ground types and reuse in the pinned Payload source and keep Flarex authority explicit. Not for unrelated Payload websites or content editing.
---

# Payload integration with Flarex

Build the requested CMS outcome through Payload's native behavior and Flarex's
admitted storage capabilities. Keep operation contracts precise, construction
cohesive, and repeated policy with one owner. A package move, interface check,
or passing conformance suite does not establish that the implementation is
well organized or reusable.

Follow the checkout's `AGENTS.md` for scope, approval, ownership, validation,
review, and commits. This skill supplies integration design guidance; it does
not authorize new capabilities or broaden a cleanup into a framework rewrite.

## Ground the work in the executing source

Locate the enclosing Flarex repository root. Paths below are relative to that
root. Start with the sources relevant to the requested outcome:

- `design-notes/flarex-db-accepted-design.md`,
  `design-notes/flarexdb-payload-relational-adapter.md`, and
  `roadmaps/16-package-boundaries.md` for accepted authority and package owners.
- [Shared logical storage](../../../design-notes/flarexdb-shared-logical-storage.md)
  and its [roadmap](../../../roadmaps/shared-logical-storage/README.md) for the
  accepted three-consumer storage, relationship and schema-evolution target.
- `roadmaps/flarexdb-framework-integration/07-payload-adoption.md` and its
  focused preflight for current scope. The exact-release contract and
  `preflight/payload-release-capability-map.json` identify compatibility evidence.
- `packages/payload-adapter/`, its package manifest, the lockfile, and the
  installed Payload exports, declarations, and implementation. Compare a pinned
  source snapshot only after verifying which package copy executes.
- The connected persistence facade, command host, Application analysis, and
  consumer tests for the capability actually being changed.

Keep release numbers, capability status, test counts, and implementation
checkpoints in their current owners instead of copying them into this skill.
Inspect only the native paths needed for the work: Local API operations,
configuration sanitation, request transactions, query combination, field
traversal, population, errors, or internal collection access.

Trace the actual call from admitted command through Payload Local API, access,
validation and hooks, adapter method, Flarex capability, and returned result.
Calling `payload.db.*` directly does not prove the Local API lifecycle. Native
storage adapters are useful contract evidence, but their SQL, migrations, and
transaction mechanisms are not automatically suitable Flarex dependencies.

## Design for Application, Payload and Medusa together

Application, Payload and Medusa target logical schemas over generic shared
physical storage and shared logical evolution mechanics. The project is in
development: core storage, relations, query/index contracts and execution flows
may be redesigned around all three. Do not freeze Application-shaped internals
or create adapter workarounds to preserve them. Preserve intended framework
behavior and actual durable/public obligations, not unshipped mechanisms.

Payload collections may declare relationships with Application and admitted
Medusa records in either direction. Trace stable scoped endpoint identities,
forward population and reverse queries, target authorization, draft/version and
soft-delete visibility, cardinality and deletion policies. Keep a single
authoritative reference or rich Link record with derived indexes. A relationship
does not grant target mutation authority, bypass hooks/access checks, or turn
independent API calls into one atomic operation.

Use real Local API calls in the roadmap's early three-consumer proof, including
schema changes that affect another framework's references. Consolidate logical
planning, validation/build, progress/recovery and readiness at shared owners;
compare Application evolution with the framework coordinator and redesign gaps.
Payload configuration and conversion meaning remain Payload-owned. Avoid a
second logical migration engine or successful no-op migration methods. Platform
physical upgrades remain distinct. Shared rows and standalone population tests
do not establish cross-framework integrity or coordinated schema evolution.

## Reuse behavior and types from their real owners

Before adding a helper, decoder, interface, field list, or dispatcher, search
for its responsibility in Payload and Flarex. Name the candidate owner and
compare input strictness, defaults, error order, mutation, lifetime, and
authority. Reuse native normalization, validation, hooks, and result behavior
where they fit; keep only the required translation or admitted restriction in
the adapter. If reuse is blocked by storage or host coupling, evaluate a narrow
seam change at the correct owner before copying the algorithm.

Use Payload's exported operation types or types derived from its adapter
members for framework calls. Its broad generic types do not prove Flarex's
closed collection contract. Represent the admitted operation arguments and
results explicitly, deriving types from their authoritative schema or decoder.
Do not maintain a parallel interface and unrelated handwritten validator.

Keep JSON/unknown at genuine wire and foreign boundaries. Decode before internal
use, preserving the correlation between an operation and its arguments/result.
Prefer directly bound operation handlers when they remove string dispatch;
retain an exhaustive discriminated union when it represents a real protocol
alternative. Do not replace a justified union with casts or a registry chain.
Keep framework-required generic assertions localized and explain the runtime
evidence behind them; never cast JSON to a document merely to satisfy a caller.

Runtime validation and static typing have different jobs. Native collection
validation still owns its defaults, required fields, and errors. An adapter
decoder may restrict supported inputs without recreating that lifecycle.
Use `.agents/skills/effect-ts-patterns/SKILL.md` and
`.codex/agents/effect-review-guide.md` for schema selection, composition, and
lifetimes. Apply `.agents/skills/effect-ts-error-handling/SKILL.md` when failure
classification, recovery, or boundary logging changes. Do not introduce
competing conventions.

## Share policy without merging distinct boundaries

Separate caller input from Payload's sanitized adapter input. For example, a
caller equality filter, an access-combined filter, and an authenticated loader
batch may share primitive rules while having different admitted shapes.
Moving them behind one permissive parser could expose an internal capability.

Centralize repeated field capabilities, bounds, and normalization rules only
where semantics agree. Keep the boundary-specific decoding and error mapping
explicit. Preserve omitted versus null, create versus patch, empty versus
missing collections, sort/page envelopes, and output ownership. Payload may
mutate population slots and sanitized options; do not lend it canonical cached
objects or frozen relation arrays.

Use authoritative profile metadata where it exists. If two representations
serve different owners, define the translation and a drift witness rather than
inventing a universal schema DSL. Keep profile configuration, provenance, and
authenticated digest semantics stable during structural cleanup.

Organize modules around responsibilities, not a target file length. A caller
should configure meaningful dependencies and invoke its operation without
rebuilding a private pipeline. Show a representative caller before and after
a construction refactor, including the exceptional case. Avoid factory stacks,
generic CRUD engines, giant barrels, and utility extraction that merely hides
the same complexity. Framework policy belongs in the adapter; domain-neutral
utilities must meet the repository's utility ownership rules.

## Separate conformance machinery from runtime behavior

Locate fixture collections, scenario-triggered hooks, fault injection, counters,
and raw-instance inspection before presenting a runtime as reusable. Give those
witnesses an explicit test-support owner and migrate their consumers. A testing
barrel alone does not isolate them if ordinary construction still installs them.

Keep one runtime implementation and a small internal construction seam that the
test harness can compose. A fixture wrapper must not copy request admission,
transaction logic, recovery, or publication. Do not replace fixed test hooks
with an arbitrary user callback/configuration API: that changes the admitted
execution contract. Check nested failure, cancellation, and replay tests before
moving instrumentation; counters may prove callbacks did not execute twice.

## Preserve authority and lifecycle

Payload owns framework behavior; Flarex owns authoritative schema admission,
rows, relation integrity, transactions, settlement, and publication. Keep native
Application and framework-compatible execution profiles distinct. Never repair
a shared-owner failure with adapter SQL, another transaction, looser limits,
swallowed errors, or a second recovery path. Apply the repository's owner-change
procedure when the required correction crosses that boundary.

Preserve same-request nesting, transaction-ID handling, rollback-only behavior,
scope/binding revalidation, and outer-only settlement. Missing standalone-read
state and an invalid presented mutation token are different cases. Keep runtime
closure and cancellation observable; a signalled Promise need not have stopped.
Do not hold database transactions over unadmitted hooks or remote effects.

Unsupported methods, fields, query forms, and internal collections must fail
according to the admitted contract. Do not inherit successful no-op transaction
or migration defaults, enable startup DDL, or infer broad compatibility from the
mandatory adapter interface being populated.

## Report core blockers and request the proper correction

When integration exposes a Flarex core blocker, explicitly tell the user what
failed and why the responsible owner must change. Preserve a reproducible
witness and record expected/actual behavior in the owning roadmap. Present the
recommended core correction, viable alternatives, affected consumers, risks,
compatibility/removal obligations and the nearest connected validation gate.
Ask for approval of that concrete correction before dependent implementation,
and explain/link the applicable approval rule. Continue independent investigation.
Do not use adapter SQL, duplicate enforcement, extra lifetimes, weakened tests,
limit increases or fallback paths to make the integration pass.

If an existing explicit core-correction approval already covers the same owner
and contract, state that coverage and continue without asking again. General
permission to redesign during development is not approval of every future core
change. A materially different contract needs a revised proposal. Ordinary
in-scope fixes and test-harness-only defects do not require repeated approval.

## Finish with removal and evidence

For cleanup, record retain/extend/replace/delete decisions and a concrete
retirement gate for any retained duplicate. Migrate actual callers and remove
obsolete assembly, exports, parallel validation, and scenario behavior from the
reusable path within the approved slice. Preserve meaningful test assertions.

Validate the claim through actual Local API calls and connected consumers,
including malformed/unsupported inputs and the relevant lifecycle failures.
For type improvements, prove invalid argument combinations fail to typecheck
and valid decoded values reach their handler without assertion laundering.
Use behavioral drift witnesses for shared policy, not tests that count helpers
or match source layout. Apply both database lanes when repository rules require
them; a passing rerun does not explain an intermittent timeout.

Supply reviewers with concrete before/after callers, retained boundaries, reuse
candidates, and removal evidence. Treat organization, duplicated policy, and
lost type information as reviewable debt with specific impact, even when tests
pass. Keep private conformance, public API, deployment, and production claims
separate in the owning roadmap.
