# Maintain Application relations in the joint native command

Status: **Independent current-core, accepted-direction and pinned-Convex challenge
and peer exchange complete; bounded replacement selected; runtime unstarted**.
This is a writer-closure prerequisite of
[maintained relation readiness](./04c3a-maintained-relation-readiness.md), not
proof of historical coverage or completion of Standard cutover.

Convex pin: `84fbb0e70b4e857913673871cb847ad11a55f3d5`.
The [mechanism record](../divergences/cross-domain-application-relation-maintenance.md)
owns the necessary native-profile adaptation.

## Source challenge and counterexample

The joint command admits Application, Payload and Currency sources and merges
their contributions into one materialization. Its
[materializer](../../../../packages/persistence-postgres/src/frameworks/crossDomainCommand/materialization.ts)
currently supplies `relations: null`. Source-table disjointness prevents duplicate
owners; it does not prove disjointness from Application relation endpoints.

The host accepts a genuine `payload.content-relations` source. Native create
writes a non-null relation ID as an ordinary document field, without an explicit
reference-replacement or set-null intent. The joint refusal of those intents
therefore does not exclude this writer. Native strong-reference validation does
not maintain Application edges, incoming adjacency and R03 facts.

A genuine overlapping V3/R02 fixture must demonstrate this path before claiming
runtime closure: native authors/articles, an Application-owned scalar audit
table and Currency, with a joint article create referencing a seeded author.
The source predicts a committed article without Application sidecars. This is
an unexecuted witness at selection, not a measured failure or passing result.

## Selected replacement and ownership

- In the existing joint host, use
  [current binding preparation](../../../../packages/persistence-postgres/src/application/activation/currentBinding.ts)
  to stage the complete generation: shared catalog, all three source
  preparations and the source CMS materialization template. Current request-only
  selection deliberately removes retained preparation and cannot lend the pair.
- Construct the existing
  [source CMS template](../../../../packages/persistence-postgres/src/frameworks/cmsTransaction/contribution.ts)
  with that generation's original retained binding and control database. Source
  and binding must share the exact `charge` and `onDispose` lifetime. Do not
  combine a staged relation loan with source preparations from the outer root.
- Every source admission consumes that same original accepted binding through
  `withEntry`. At joint close, authenticate the template against the actual
  Payload admission and transaction using its existing owner.
- Feed the complete genuine relation pair to the existing joint materializer.
  Its command uses the original Application relation schema; map **every**
  Application, Payload and Currency table to its actual logical-source schema
  with `sourceSchemaVersionByTable`. Preserve current row/dependency/index/unique
  validation and source ownership.
- Retain one combined `prepareDelta`, lower and
  [publication](../../../../packages/persistence-postgres/src/frameworks/crossDomainCommand/publication.ts).
  Do not separately prepare a CMS delta, add SQL, grant raw capabilities, create
  another transaction/publisher or turn a failed loan into absent relations.
- Preserve request evidence version 2, outcome-first replay, `recoverOnly`,
  timeout, native callbacks, failure latches and outer-only settlement. Existing
  relation-free/Legacy absence remains issuer-authenticated.

The host/materialization worker owns the three joint runtime files and necessary
same-owner types. The witness worker owns genuine fixture composition and
connected tests, reusing native compiler, analysis, candidate, build, binding and
Currency/Payload execution owners. They coordinate the prepared-template handoff
and preserve unrelated shared-worktree changes. The coordinator owns these
records, integration checks, review and the eventual connected scoped commit.

## Required evidence and removal

- Preserve a real failing overlapping witness before the runtime correction.
  Neither the existing scalar Currency fixture nor standalone CMS alone proves
  this combination.
- Genuine joint creation maintains incoming results, exact edge/adjacency and
  R03 facts, with Application and logical-source schema IDs deliberately distinct.
- Native replay invokes neither native command twice and writes one durable
  outcome/publication. A late real relation/publication fault rolls back every
  participant, sidecar, fact and outcome.
- Target-delete restriction still holds; stale, foreign, copied or disposed
  preparations fail before native work. Supported relation-free controls retain
  their current behavior.
- Verify current-binding refresh, exact original generation and all three source
  admissions; remove the displaced request-only selection/null handoff.
- PGlite and ordinary-role PostgreSQL, affected Oxc checks, source/compatibility
  guards, lint, both mandatory reviews, cleanup and scoped commit remain gates.

This corrects future joint writes. Historical gaps, serving validation, read
coverage floors and baseline activation remain with 04C3A. Replication is deferred.
