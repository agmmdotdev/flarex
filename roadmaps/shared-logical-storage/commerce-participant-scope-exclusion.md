# Commerce participant scope exclusion

## Status And Scope

Status: implemented as an internal core capability. It owns authentication of
the existing atomic commerce scope exclusion from issued participant contexts.
Native Link receipts and API Key workflow admission retain their separate
[preflight](../flarexdb-framework-integration/preflight/api-key-workflows.md).

## Current Sources Of Truth

The [accepted design](../../design-notes/flarex-db-accepted-design.md) keeps
framework commerce execution distinct from Application OCC. The atomic commerce
execution owner and commerce context issuer own this guard. The neutral
`participantScopeExclusionScenario.ts` exercises the real admission and bounded
request lifetime; existing logical insertion-order scenarios retain root controls.

## Current Architecture

The root guard authenticates an issued atomic context and checks the selected
`scopeExclusive` profile against its real transaction's exact scope observation.
Participant calls receive issued commerce command contexts instead of the atomic
root. The previous root-only guard rejected those contexts at the type boundary
(`CommerceCommandContext` is missing atomic root capabilities). Passing a manager,
copying the root or using an adapter flag cannot establish the missing authority.

The correction registers an internal proof for each exact command context. Every
check enters that context's existing bounded lifetime before inspecting the real
outer profile and scope observation. Recursive commands and nested borrows use
their own issued manager lineage. The proof does not submit work to the root FIFO
while a participant already occupies that FIFO.

## Invariants And Trust Boundaries

- No raw transaction, clock, finalizer or new public context field escapes.
- Copies, proxies, foreign and expired contexts cannot reuse issuer identity.
- Authentic nonexclusive contexts fail with `unsupportedProfile`; standalone
  commerce contexts have no atomic exclusion authority.
- Existing accounting, refusal latching, lock order and settlement remain owned
  by the bounded request and atomic execution owners.
- This creates no transaction, retry, compensation or exclusion fallback.

## Decisions And Rationale

The existing core guard accepts both issued root and participant contexts because
the core already owns their common exclusion lifetime. A private issuer registry
preserves capability identity without broadening the public commerce context or
having the adapter manufacture authority.

## Convex Compatibility And Flarex Divergences

This is a private framework-compatible execution profile. It changes no Convex
developer API, Application dependency tracking or OCC behavior. Postgres remains
the commit and scope-lock authority.

## Implemented Capabilities

The neutral PGlite and ordinary-role Postgres scenarios exercise live root,
participant, recursive and nested-borrow checks with immediate and queued
scheduling, and copied/proxied/expired/default-profile refusal. Existing shared
physical-installation and relational reference-checkpoint scenarios preserve
their authority, budget, cancellation, recovery and publication contracts.

## Known Gaps And Next Correctness Gates

This guard alone does not admit native durable Link operations or API Key
association workflows. Those consumers must prove their own receipt, fencing,
event and compensation contracts through the authentic borrowed context. Future
consumers must select the existing exclusion profile through their trusted host
and preserve issuer identity and bounded manager lifetime.
