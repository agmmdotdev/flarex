---
name: medusa-flarex-integration
description: Plan, implement, refactor, or review Medusa integration with Flarex core. Use for Medusa modules, repository and service contracts, module links, workflow integration, fork adaptations, and integration API cleanup. Favor native Medusa reuse, small shared mechanics, explicit module extensions, and dependency-driven end-to-end proofs. Not for unrelated Medusa storefront work.
---

# Medusa integration with Flarex

Build the requested commerce outcome using Medusa-owned behavior and Flarex-owned
authority. Reuse contracts and implementations where they fit; deliberately
change Medusa internals where they do not. Do not recreate Medusa in the adapter,
preserve unnecessary layers for their own sake, or make Flarex core commerce-aware.

This skill guides design decisions, not capability approval. Follow the current
checkout's `AGENTS.md` for preflight, ownership boundaries, review, validation,
and commits. Creating or invoking this skill does not authorize broad cleanup,
new capabilities, source promotion, or changes to accepted architecture.

## Start from the outcome and exact source

This is a repository-local skill. Locate the enclosing Flarex repository root;
all paths below are relative to that root, not this skill's directory. Inspect
the relevant current sources:

- `design-notes/flarex-db-accepted-design.md` and
  `roadmaps/16-package-boundaries.md` for authority and package placement.
- `roadmaps/flarexdb-framework-integration/06-medusa-adoption.md` and the owning
  focused preflight for the requested capability. For shared adapter mechanics,
  start with `preflight/47-medusa-shared-persistence-adapter.md` in that domain.
- `roadmaps/workflow-foundations/` when workflow execution is involved.
- `third_party/medusa/SOURCE.json`, the relevant pinned sources under
  `third_party/medusa/upstream/`, and the actual executable/promoted package
  sources, manifests, and tests. Establish which copy executes before editing.

Use current code and decisive tests to establish implementation, not an old
roadmap summary or a different upstream release. Do not copy capability status,
test counts, commit receipts, or a fixed module sequence into this skill.

For an integration goal, name the exact native workflow or service operation
and trace its steps, child workflows, container resolutions, DML models,
repositories, links, queries, hooks, and events. Inspect transitive calls and
empty-input behavior; an optional payload does not necessarily remove a runtime
dependency. Distinguish a module dependency from a provider, HTTP bootstrap,
administrative lifecycle, or production deployment requirement.

Choose the next connected proof from that graph. A module being a useful generic
adapter test does not make it a prerequisite for the user's workflow. Integrate
the required module, link/query boundary, and native workflow branch together
where feasible; do not postpone all integration until standalone modules pass.

## Reuse first; change the correct owner when necessary

Before writing adapter logic, find the native owner of normalization, defaults,
selectors, relation behavior, serialization, lifecycle, events, and workflow
semantics. Prefer actual Medusa services and methods over reproducing their
algorithms. Reuse checked DML and relation metadata where it is authoritative;
TypeScript DTOs are not runtime validators, and HTTP schemas are not automatically
valid persistence contracts.

Classify a mismatch before choosing a fix:

| Mismatch | Direction |
| --- | --- |
| Framework input/output or lifecycle translation | Keep a narrow Medusa adapter at the boundary. |
| Reusable Medusa behavior coupled to an ORM, container, or host | Consider extracting the portable behavior or changing the Medusa fork's seam, instead of copying it into Flarex glue. |
| Missing invariant or insufficient contract in a shared owner | Preserve the failing witness, identify that owner, and obtain approval for its correction. Do not compensate in the consumer. |
| Genuine module-specific behavior | Keep a named module extension that uses the shared mechanics. |

Medusa core is not untouchable. A scoped fork change is a valid, sometimes better,
integration solution. Explain the existing behavior, mismatch, proposed contract,
affected consumers, and compatibility consequences in the preflight. Distinguish
an internal portability/refactor change from an intentional business or public
contract divergence; the latter needs an explicit decision, not a silent patch.

Classify what actually needs compatibility: commerce behavior, supported public
APIs, persisted data and identities, or internal implementation details. Internal
classes, dependency containers, ORM assumptions, and helper layouts are not
automatically compatibility obligations. Preserve the required contract, not
every mechanism that currently implements it. Neither Medusa nor Flarex should
be changed by default; the mismatch and ownership evidence determine the target.

When changing the fork or promoted implementation, follow the checkout's source
island/promotion policy, preserve original provenance, and update applicable
source receipts or guards honestly. Do not edit a comparison snapshot merely to
make parity pass. Retain original compatibility witnesses; separately test and
label any approved divergence. Never claim unchanged upstream compatibility for
behavior deliberately changed in the fork.

## Core special cases are a last resort

A module exposing a core limitation is evidence of a missing capability, not a
reason to design core around that module. Prefer a module-neutral correction in
the existing owner, expressed through actual contracts and capabilities. Another
module within that supported contract should need declarations and its genuine
adapter extensions, not another core branch, factory or binding redesign.

Introduce module-specific core behavior only when absolutely necessary. Before
proposing an exception, demonstrate all of the following in the preflight:

- The exact required behavior and a reproducible witness, grounded in the native
  contract or an explicitly approved divergence.
- Why existing composition, a module-owned extension, a scoped fork adaptation,
  and a reusable correction at the shared owner cannot correctly satisfy it.
- Why core is the necessary owner, the narrow scope and affected consumers,
  preserved authority/compatibility invariants, and removal or reassessment gate.

Obtain explicit approval for that exception. Convenience, a passing module test,
an existing special case, or avoiding work in the correct owner is not evidence
of necessity. Do not disguise an exception as a generic registry or weaken core
validation to accommodate it. Genuine business-specific behavior normally stays
in its module; do not invent a universal abstraction merely to eliminate it.

For a reusable core claim, test independent neutral fixtures and another supported
profile through the same path, with no module-name branches or adapter imports in
core. Keep the native module/workflow proof separate. Future unsupported semantics
may require new shared capabilities; they do not justify per-module glue fixes.

## Small shared mechanics and clean construction APIs

Prefer one cohesive construction entry point per responsibility. A consumer
should supply its real configuration and dependencies, not reconstruct a private
pipeline from many helper imports. Keep preparation and wiring inside the owning
module while preserving visibility of meaningful capabilities and lifetimes.
Fewer imports are a symptom of good encapsulation, not a reason for a giant
barrel, service locator, global registry, or god object.

For a construction/API refactor, show a representative caller before and after.
Check what it must import, configure, construct, and understand, including the
module-specific extension case. An API is not simpler if fewer imports conceal
more configuration, implicit authority, or a harder-to-follow execution path.

Use a small base factory for genuinely shared work, then direct method bindings
and named module extensions. Composition is enough unless inheritance has a
concrete benefit. Do not generate a universal CRUD surface: count, listAndCount,
upsert, tree behavior, graph operations, and lifecycle methods have distinct
native contracts and need only be exposed where admitted and required.

Before introducing an abstraction, ask:

- Does it remove duplicated behavior or protect an invariant, rather than just
  move lines behind another name?
- Can existing types, metadata, or an existing owner express this directly?
- Can the caller bind the actual service method instead of encoding an entity
  name or operation tag that another dispatcher must interpret?
- Does adding a module require only declarations and genuine extensions, or
  another branch in shared code?

Avoid entity-name switches, redundant `kind`/`type` tags, descriptor DSLs,
registry chains, and factory-on-factory wiring when direct composition suffices.
This is not a blanket ban on discriminated unions or metadata: keep tags that
represent real semantic alternatives, protocol contracts, or safety boundaries.
Do not replace a justified union with unsafe casts in the name of simplicity.

Keep framework-neutral persistence in its core owner; shared Medusa mechanics
in their Medusa owner; module semantics in their module. Do not move contextual
policy into generic utilities merely to reduce imports. For shared-algorithm
claims, renamed metadata or a genuinely different consumer can expose hidden
entity assumptions without inventing a general platform in advance.

## Preserve authority and observable contracts

Only the trusted Flarex outer owner settles authoritative Postgres changes.
Reusing Medusa does not grant its callers raw SQL, transaction handles, commit
facts, or finalizers. Preserve distinct execution profiles; independently
committed service calls are not automatically one atomic workflow.

Use the existing workflow runtime where its admitted contracts fit. Add execution
capabilities from actual workflow requirements, not a speculative universal
engine. Do not keep a database transaction open over remote effects or workflow
suspension, or assume whole-root rollback replaces all compensation semantics.
Stored Module Links are not the same as module-local relation pivots; prove their
endpoint composition, storage constraints, lifecycle, and publication contracts.

During cleanup, preserve evaluation order, omitted versus empty inputs, scalar
versus array results, insert versus upsert, listAndCount shape, receiver binding,
managed-field refusal, events, resource accounting, and transaction lifetime.
Capture and validate the full native result before a projection can discard
data. Route Effect and failure-semantic work through the existing repository
skills rather than introducing a competing error or lifetime convention here.

## Finish with removal and connected evidence

Include a retain/extend/replace/delete inventory for displaced paths. Retain a
legacy or parallel implementation only for a demonstrated compatibility
obligation with a retirement gate. Migrate callers and remove obsolete assembly,
registrations, duplicate algorithms, unnecessary exports, and diagnostic
scaffolding within the approved slice. Move meaningful regression assertions to
the replacement owner; remove obsolete test scaffolding without deleting its
behavioral coverage. Removal is a completion gate, not an unspecified later
cleanup. Do not expand into unrelated cleanup merely because more exists.

Validate the native module/service behavior and the real connected workflow
branch, not only helper mocks. Keep upstream assertions and fixtures as regression
evidence and add boundary tests for the new capability. Select failure, scope,
constraint, replay, event, and recovery witnesses according to the changed
contract; run both PGlite and ordinary-role PostgreSQL for storage/transaction
claims. A passing rerun does not explain an intermittent failure.

Apply the repository's typecheck, source-preservation, portability, lint, review,
and scoped-commit requirements. Report what is actually proven and what remains
gated. Keep durable capability and cleanup decisions in the owning roadmap;
do not present a private module or workflow proof as full Medusa or production
support.
