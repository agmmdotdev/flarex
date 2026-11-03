# Generated serials and native Order creation on Core

Status **Implemented and verified on PGlite and ordinary-role PostgreSQL for
the Core allocator and both direct Order consumers.**

Flarex baseline `a4912fd1d7eec4b61522aef846c7801e81bb559c`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

Replace the shared generated default and both existing direct consumers.
Standalone Order creation and deletion admit one to four Orders and four
total digital or manual items. The other genuine consumer adds an Order
Change Action and receives its generated ordering. Both use the full
23-model generated Order source. Its five serial declarations cover Order,
Claim, Exchange and Return display IDs and Order Change Action ordering.
Definition installation grants only the explicitly selected commands.
Checkout, finance, and populated-definition upgrades have separate consumers
and acceptance gates.

## Independent findings and disposition

- Current Core refuses `serialNext` during relational lowering. The Legacy
  working set computes max-plus-one over complete bounded current membership,
  including pending changes and soft-deleted rows. The executing consumer
  contracts include explicit int32 values, batch order, overflow, rollback,
  same-key replay and hard-delete reuse. The production semantic owner is
  the trusted Core insert path before complete-row validation.
- Pinned Convex `database/src/query/index_range.rs` tracks the consumed
  directional interval or EOF, and `database/src/committer.rs` validates
  the published suffix and accepted pending writes. The table registry's
  derived allocation also uses its ordinary transaction. Reuse the translated
  Core query and commit owners for exact maximum evidence.
- The design challenge found that the two direct consumers' Medusa serial indexes are
  active-only. A fresh descending lookup also cannot use a remembered row
  at a newly changed key. If A was observed at 30, another root lowers A to
  1, and B is 20, the next allocation must refuse before showing 21. The
  converse case of A moving above a local pending key must also refuse.
  If the root allocated 11 from committed 10 and another root then inserts
  a distinct 100, the next allocation must reject the earlier suffix before
  exposing 101. An earlier EOF has the same dependency even without any
  remembered identities.

The complete membership approach would preserve the Legacy cutoff and keep
the scan on every allocation. The coordinator selects the indexed replacement
with the same signed-int32 and settlement rules and an examined-prefix budget.
The [generated serial divergence](../divergences/native-generated-serials.md)
records the resource distinction and why the change fits the existing logical
ownership. Keep the Legacy cap witness as historical behavior while its
remaining callers use that owner.

## Owner and acceptance

- Derive the backing from the authenticated required integer column. Use
  the shared lifecycle for ordinary index readiness. Preserve the identities
  of existing source indexes and the default preserve-only producer.
- Read the current admitted index and check earlier remembered observations and
  allocation intervals before deriving a value. Use existing directional pending index merging and
  exact timestamped consumed ranges. Capture committed suffix evidence and
  account for every examined identity, including a locally masked key.
  Keep allocation observations out of the native DAL call transcript.
- Allocate only for omitted or null values on actual inserts. Required
  entity-batch validation precedes originals and allocation. The duplicate
  entity-batch branch keeps its complete candidate validation before reporting
  primary conflict. Updates, replay and retained restoration preserve supplied
  values under their existing rules.
- Prove empty, negative, explicit, ordered multi-column batches, pending
  updates and tombstones, soft-delete retention, exhaustion, hard-delete reuse,
  rollback and reopened replay. Prove stale remembered maxima and competing
  empty-suffix readers fail without replaying a native callback. Include a
  large lower tail that fits the examined budget and a masked prefix that
  exceeds it.
- Reuse the direct native host and real callbacks for Order creation, full
  graph cleanup, and Action ordering. Keep actual stored numeric values,
  genuine DTOs and event observations. Prove the full admitted maximum and
  late failure, then retire both dedicated Legacy fixtures. Retain the
  shared Legacy fixture for checkout.

Require focused PGlite and ordinary-role PostgreSQL on the Core owner and
both genuine consumers. Run adjacent preserve-mode Order and native index
owner cases, affected fast types, executing Source and promotion guards,
lint, and both reviews.
