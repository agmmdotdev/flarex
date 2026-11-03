# Native API Key consumer replacement

Status: **Complete bounded consumer replacement; the full goal remains open.**

Baseline: `6c1694b80d9f5208c7c54744899b2fadcf7672f9`.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
Medusa fork: `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, baseline 2.13.4.

This continues the [full goal](../GOAL.md) after the accepted
[Store replacement](./23-native-store-workflows.md), following the native
[API Key preflight](../../../../roadmaps/flarexdb-framework-integration/preflight/api-key-workflows.md).
Translate the complete already-admitted five-root graph. Do not reduce it to
credential CRUD or replace durable Link compensation with presence checks.
Paused finite, Task and performance implementation stays paused.

## Independent challenge and selected boundary

Current-core, accepted-direction and pinned-source agents independently traced
the actual producers, native graph, data model and Core owners, then exchanged
counterexamples. They found two missing Core schema wrappers and Legacy consumer
assembly, with no demonstrated missing shared Core primitive. Source inspection
does not prove runtime correctness: preserve a failing witness and correct the
actual owner if migration exposes a gap. Record any newly necessary mechanism
divergence before changing affected behavior.

| Root | Exact business sources and grants |
| --- | --- |
| Create | API Key 1; create plus private retained creation inverse |
| Update | API Key 1; list/update plus workflow-only title restoration |
| Revoke | API Key 1; native revoke and its required validation queries |
| Delete | API Key 1 + rich Link 3; guarded key deletion before hidden Link cleanup; no Sales participant |
| Associate Sales Channels | Sales Channel 1 + rich Link 3; Sales validation and native apply/compensate; no API Key existence/read grant |

The union is five business tables. Rich Link comprises
`publishable_api_key_sales_channel`, `link_workflow_operation` and
`link_pair_revision`. Receipts and pair heads have independent identities and no
FK/cascade to the association row: physical Link deletion must retain them.
Keep ordered endpoint-tuple identity; display `id` is not its primary key.
Existing private Core event/outcome storage remains separate from this count.
All storage uses shared logical installation over the existing five physical
tables. No new physical table, populated conversion or dataset reset is justified.

Add Core variants beside `compileApiKeyDefinition` and
`compileApiKeySalesChannelLinkDefinition`, preserving the complete normalized
sources and native keys/write profiles `medusa.api-key` and
`medusa.apiKeySalesChannel`. Reuse existing capture/bundle/Core-definition owners.
Sales Channel already has its Core producer. Ordinary Core rows, exact activity,
uniqueness, budgets, scope exclusion and root outcomes supply the shared mechanics.

## Native contracts and decisive counterexamples

Preserve publishable `pk_` creation, deliberate unhashed public token and empty
stored salt, complete native DTO ordering and salt omission. Secret creation,
scrypt and authentication remain outside scope. Native secret-type validation
queries used by revocation remain necessary and do not grant secret writes.
Keep unchanged-title filtering, projected retained title preimages, native Date
handling, scheduled revocation and unrevoked/future-revoked deletion guards.

`revertCreatedApiKeys` bypasses the ordinary revocation guard only as the trusted
creation inverse. Creation's public command list remains create-only; its inverse
is workflow-only. Lifecycle exposes update/revoke/remove, keeping listing and title
restoration private. Revoke/delete retain `noCompensation`. Deletion's actual
prepared dependency must complete guarded key removal before irreversible Link
cleanup. A failed accepting root still rolls back all sources/events; that is
distinct from undoing an already committed native operation.

Keep the authored promoted native Link protocol and receipt validation owners:

- Exact ordered operation request replay; acquire/rotate the complete sorted
  pair-head cohort before invoking native writes.
- Every selected native mutation rotates a revision, including deletion of an
  already inactive association. Owner-local caches retain only verified writes.
- Compensation authenticates the durable operation, all `afterRevision` and
  `afterActive` fences before touching any pair. Equal presence does not prove
  ownership. Add/remove/add ABA must reject the old inverse.
- Compensation before apply inserts a cancelled durable record. Late apply loses;
  cancelled/compensated terminal replay cannot resurrect work or duplicate events.
- Same-request deletion replay changes nothing. A new request for a missing Key
  intentionally rotates its retained inactive pair head without another Link event.
- Complete historical association bound remains eight; a ninth association or
  cleanup failure rolls back preceding Key deletion, heads, receipts and events.
- One unrevoked Key preserves the entire selected state. Duplicate additions,
  changed/reordered operation requests and superseded inverses retain native refusal.

Trusted invocation identity already exists. Core supplies `eventGroupId =
requestKey`; the promoted SDK derives identity from that root, complete prepared
frame path and node/occurrence position. The existing native helper applies its
domain-tagged SHA256. Retained compensation uses the original invocation identity,
not its new callback identity. Add no identity adapter, random operation ID or
crypto owner. Borrowed Link execution must authenticate actual Core scope exclusion
and open/settle no second transaction. Preserve named 128-call association allowance,
ordinary default-budget refusal, selected root/borrowed queueing and all other limits.

## Source provenance and complete inventory

The four existing suites under `packages/medusa-adapter/test/` register 30 cases,
with no parameter expansion or PostgreSQL-only skips. These are inventory counts,
not execution evidence.

| Original suite | Cases |
| --- | ---: |
| `logical-api-key-creation-workflow.test.ts` | 9 |
| `logical-api-key-lifecycle-workflow.test.ts` | 6 |
| `logical-api-key-deletion-workflow.test.ts` | 7 |
| `logical-api-key-association-workflow.test.ts` | 8 |

One creation recovery case, one deletion default-profile control and five
association protocol/recovery cases extend the consumer inventory to 37. The
explicit Source lane adds 20 execution-provenance cases, for 57 total. These
include lost acknowledgements, actual ABA, cancellation before apply, changed
ordered requests and same-operation races;
they exercise native owners rather than reimplementing the protocol in a harness.

Keep original DTO, ordering, empty/missing/no-op, managed-input, privileged-inverse,
revocation, aggregate bounds, scope, replay, event, rollback and retained-protocol
coverage. Replace Legacy revision decoding with actual Core evidence. Add focused
creation/association lost-ACK recovery and missing ABA/cancellation/request-identity
or same-pair concurrency witnesses through real owners where not already covered.
Preserve adjacent pure input/output/workflow-definition and SDK step-identity tests.

Pinned Convex first-original/pending-index/committer mechanisms remain applicable;
its Application mutation retry does not authorize native callback replay. The
Medusa API Key source guard authenticates approved private inverse, Link operation,
sequencing and no-compensation adaptations. Rich operation contracts/store/service/
models are authored promoted native corrections, not unchanged fork files.
`check-medusa-link-operation-source.mjs` owns those seams. Keep both provenance layers.

Default package exports can execute ignored `dist`. Extend the actual Vitest SSR
Source-resolution/entry/leaf/hash proof to API Key, Sales, Link root/service/protocol
models, native SDK and all five Core Flow entry points. Existing Source exports or
equality guards alone do not prove which implementation executes.

## Coordinated ownership and cleanup

- Producer worker owns only the two schema-owner Core wrappers and direct producer
  tests. Reuse existing normalization/capture; no business or Core algorithm rewrite.
- Scalar worker owns creation/lifecycle suites and their shared Core API Key fixture,
  pure graph/failure helpers, and retirement of the old base fixture after all
  callers migrate. Coordinate shared helper exports with the rich-Link worker.
- Rich-Link worker owns deletion/association suites, their Core assembly and the
  two dedicated old rich fixtures, plus the trusted deletion facade and its named
  policy selection. Preserve native protocol and call/event receipts.
- Root owns this plan/goal pointers, Source runner/provenance, shared fixture
  reservations, integration, ordinary-role resources, validation, reviews and commit.

Workers are not alone and must accommodate others without reverting their edits.
Retire the three dedicated `logical-api-key*fixture.ts` constructions after all
four suites migrate. Retain shared Currency and Legacy Sales fixtures: named
Product-shipping, legacy Product creation and Sales runner consumers still use
them. No inspected fixture establishes an external durable dataset or reset right.

## Acceptance boundary

Four revoked Keys and eight selected associations require 65 calls through the
genuine native Source graph. Both Core and retained Legacy construction refuse
final runtime result capture under the ordinary 64-call profile, after tentative
business mutations and five native events. No Core-only duplicate admission was
identified. The selected correction belongs to the trusted deletion facade:
choose its named 128-call policy through the existing atomic host, retaining
authenticated limit identity and recovery. Do not change shared accounting,
generic limits or native protocol mechanics.

Keep the authentic default-64 complete native graph as a separate full-root
rollback control. The named profile must complete maximum deletion and the
intended late-failure probe, and recover a lost commit acknowledgement without
re-entering native deletion. Cold pair-head rotation retains ordered individual
writes and authoritative rereads; cache only written, verified heads belonging
to the exact owner. All data, byte, event, deadline and identity bounds remain.

Bounded acceptance covers the complete original family and added protocol and
recovery cases on PGlite and ordinary-role PostgreSQL. It includes genuine
retained inverses separately from failed-root rollback, callback-free committed
outcome recovery, native fencing/cancellation/request identity, scope exclusion,
connected owner regressions and executing Source and portability proof. Both
required code reviews are complete. Wider hosting, populated-data conversion,
additional consumers and performance gates remain open under the full goal.
