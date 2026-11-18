---
name: medusa-flarex-integration
description: Plan, implement, refactor or review Medusa modules, services/repositories, Module Links, workflows, fork adaptations and integration cleanup with Flarex. Reuse native behavior and keep framework/core ownership explicit. Not for unrelated storefront work.
---

# Medusa Integration With Flarex

Use Medusa-owned commerce behavior and Flarex-owned authority. Follow
`AGENTS.md` for scope, core corrections, cleanup, validation and review; this
skill does not authorize capabilities or source promotion.

## Evidence And Outcome

Paths below are relative to the enclosing Flarex root. Inspect the relevant
accepted design, `roadmaps/16-package-boundaries.md`,
`roadmaps/flarexdb-framework-integration/06-medusa-adoption.md`, and
`roadmaps/workflow-foundations/` for workflow work. Shared adapter evidence is
`roadmaps/flarexdb-framework-integration/preflight/47-medusa-shared-persistence-adapter.md`.

Verify `third_party/medusa/SOURCE.json`, pinned upstream source, and the actual
executable/promoted packages, manifests and tests. Establish which copy executes;
an old snapshot or newer upstream release does not prove current behavior.

Trace the requested native workflow/service through child workflows, container
resolution, DML, repositories, links, queries, hooks and events, including
transitive and empty-input dependencies. Distinguish module requirements from
providers, bootstrap, administrative lifecycle and hosted activation. Deliver
the connected workflow branch; a useful generic module fixture is not an
automatic prerequisite.

## Framework And Core Ownership

| Mismatch | Correct direction |
| --- | --- |
| Input/output or lifecycle translation | Narrow adapter |
| Portable native behavior coupled to ORM/container/host | Change the fork seam or extract native behavior before copying algorithms |
| Insufficient shared invariant/contract | Correct the shared owner under AGENTS.md; no consumer workaround |
| Genuine module behavior | Named module extension using shared mechanics |

Reuse native normalization, defaults, selectors, relations, serialization,
events and workflow semantics. Checked DML/relationship metadata may own a
contract; DTOs and HTTP schemas do not automatically validate persistence input.
A scoped Medusa fork change is valid when evidence identifies it as the correct
owner. Explain affected consumers and compatibility; business/public divergence
needs an explicit decision. Follow source-island/promotion policy and preserve
provenance/guards, original compatibility witnesses and separately labeled
divergence tests. Do not edit comparison snapshots to make parity pass.

Prefer module-neutral core corrections. A module-specific core exception needs
a native witness, evidence that composition/module extensions/fork seams/shared
correction cannot satisfy it, the necessary core owner and narrow scope,
preserved invariants, and a removal/reassessment gate. Obtain explicit approval;
passing a fixture or adding a generic registry is insufficient. Prove reusable
claims with neutral fixtures and another supported profile, separately from the
native module/workflow proof.

## Storage, Relationships And Workflows

Use the accepted [shared logical storage design](../../../design-notes/flarexdb-shared-logical-storage.md)
and [roadmap](../../../roadmaps/shared-logical-storage/README.md). Do not preserve
deployment-specific commerce table generation or overlapping migration engines
as the destination. Native compilation/business conversion remains framework
owned; shared logical planning/build/readiness/recovery and physical upgrades
have distinct owners.

Cross-consumer relationships need scoped endpoint identities, indexed forward/
reverse access, authorization, soft deletion and schema dependencies. Keep one
authoritative reference or rich Link record. Traversal neither grants mutation
rights nor creates atomic cross-framework calls/cascades. Stored Module Links
and module-local relation pivots need distinct endpoint/storage/lifecycle proofs.

Use the existing workflow runtime where admitted; do not invent a universal
engine or hold transactions over remote effects/suspension. Whole-root rollback
does not replace native compensation. [Advanced evolution](../../../roadmaps/shared-logical-storage/deferred-framework-schema-evolution.md)
remains deferred: no general model upgrades, populated-data conversions,
ownership transfers or new migration engine without their authorized scope.
Record blockers and continue independent work; no legacy fallback.

## Construction And Validation

Keep one construction entry point per responsibility, shared Medusa mechanics
in their owner, and genuine module extensions explicit. Prefer direct method
bindings/composition to entity switches, registry chains, factory stacks or
universal CRUD engines. Preserve justified discriminated unions and metadata;
fewer imports alone do not prove simpler APIs. Show before/after caller burden,
including the exceptional module case.

Preserve evaluation order, omitted/empty input, scalar/array results,
insert/upsert, listAndCount, receiver binding, managed-field refusal, events,
resource accounting and transaction lifetime. Validate the full native result
before projection. Apply repo-local Effect skills for failure/lifetime changes.

Migrate callers and preserve regression coverage while removing displaced
assembly/registrations/exports/algorithms; retain duplicates only for a named
obligation and removal gate. Prove real native service/workflow branches, not
only helper mocks, including relevant failure/scope/constraint/replay/event/
recovery cases and upstream assertions. Apply both database lanes and source/
portability guards as required by AGENTS.md. Keep capability/status truth in
the owning roadmap and report only the level of support actually proven.
