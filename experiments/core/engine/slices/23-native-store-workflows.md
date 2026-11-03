# Native Store consumer replacement

Status: **Shared-owner correction and connected consumer replacement implemented
with required scoped validation and review. Broader native, hosted, Task and
performance gates remain open.**

Baseline: `be67fb91198c2bfce73d401786a845f16c4ea729`.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
Medusa fork: `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, baseline 2.13.4.

This continues the [full goal](../GOAL.md) and
[ordinary consumer retirement](./16b-legacy-entrypoint-retirement.md).
Replace the complete admitted Store creation, update and deletion construction.
Keep all 77 original registrations, including six PostgreSQL-only cases. Source
counts are inventory, not execution evidence. API Key has no Store business
dependency and follows as its own complete five-root closure, including rich
Link operation receipts and pair revisions. Paused finite, Task and performance
work stay paused; the full goal and their separate gates remain open.

| Original suite under `packages/medusa-adapter/test/` | Expanded cases | PostgreSQL-only |
| --- | ---: | ---: |
| `logical-store-create-workflow.test.ts` | 30 | 2 |
| `logical-store-update-workflow.test.ts` | 34 | 3 |
| `logical-store-deletion-workflow.test.ts` | 13 | 1 |
| **Total** | **77** | **6** |

One additional genuine Store/Pricing lost-acknowledgement recovery case brings
the connected Store inventory to 78. The explicit Source lane also runs the
eight existing provenance cases: 86 total, with six PostgreSQL-only cases.

## Independent challenge and decision

Three read-only agents independently examined the current Core, accepted direction
and pinned Convex/native sources, then exchanged counterexamples. They converged
on one actual shared-owner gap, rather than a new Store-specific storage policy.

Store update selects `reconstitution: "advanceUpdatedAt"`. Its real full-clear
inverse sends complete retained child rows to `store.reconstitute`. Core native
preparation currently rejects that policy and its store exposes no such method.
Existing recorded-row replay is broader: it can prove committed history and
preserves timestamps. It cannot replace the narrower accepting-root contract.

Translate the already accepted
[same-root reconstitution contract](../../../../roadmaps/shared-logical-storage/63-same-root-row-reconstitution.md)
at the existing transaction/native-host owners. The dedicated
[divergence](../divergences/native-same-root-row-reconstitution.md) records why
native compensation requires this checked exception. Reuse `deletedDocuments`,
`deletedBy`, pending values, first originals, mutation activity, normalization,
staging, indexes and native batch rollback. No separate evidence ledger,
historical lookup, adapter SQL or insertion fallback.

Pinned `database/src/writes.rs` retains first originals and requires genuinely
fresh ordinary internal IDs; `transaction_index.rs` merges pending writes and
suppresses pending deletions. `Transaction::apply_function_runner_tx` requires
the same begin timestamp, and `committer::validate_commit` validates accepted
and published writes before final coalescing. Keep these mechanisms. Convex has
no native Medusa child-inverse contract and supplies no Store business policy.
Application retry/session behavior does not authorize native callback replay.
The pinned writes/index blobs are respectively
`916bf904972cb99334c1074e20629ee7a429c906` and
`43f3ee368d96ce9fec804508a19fd6505719853f`.

Store's promoted service preserves the pinned body with the recorded portable
import and erased `normalizeInput` visibility seam. Keep the existing exact
body/emitted guard in `check-medusa-currency-promotion.mjs`. The explicit Store
Vitest configuration reuses the actual SSR Source-resolution gate, including
Store and Pricing entry/implementation hashes; default ignored `dist` exports
are not evidence of current Source execution.

## Invariants and counterexamples

Reconstitution authenticates the complete active canonical row from the latest
physical deletion in this live accepting root, for the same admitted table,
native key and source. Preserve internal/native identity and both creation
times. `advanceUpdatedAt` uses the accepting root's managed update timestamp;
`preserveTimestamps` retains the proven timestamps. Keep selected policy separate
from recorded-row replay and bind it into frozen invocation, prepared identity
and recovery. Omission exposes no method; mismatched policy cannot recover an
outcome. No public database, history, clock or settlement authority escapes.

Refuse altered body/owner/key/managed fields, missing or stale deletion evidence,
soft-delete-only evidence, committed historical tombstones, cross-table/source
proof, live or ambiguous destinations and repeated use while live. Preserve
unique/FK checks, limits, cancellation, rollback-only and single settlement.
A caught refusal or later failure must publish nothing. A same-policy durable
outcome recovers without invoking the native callback again.

## Native closure and behavior

- Creation/update install Store 3 plus Pricing 6 business tables through existing
  Core Source producers and shared five-table logical installation.
- Deletion installs Store 3 and uses the genuine empty-family Link router; it
  needs no Link storage. Default Region/Channel/Location values are scalar
  pointers and grant no endpoint mutation authority.
- Creation keeps raw currency-key Map deduplication. Update keeps raw duplicates
  and ordering, skips Pricing for omitted/empty currencies, and can update Pricing
  for nonempty currencies even when no Store matches.
- Preserve scalar/array shapes, native selected inverses, partial-projection and
  metadata limitations, child ordering, events, historical-descendant lifecycle
  behavior, untouched neighbors and complete failed-root rollback.
- Creation/update keep named 128-call profiles, queued root/borrowed execution
  and existing byte/row/event limits. Deletion keeps its ordinary profile.
- Update and its Pricing competitor explicitly select scope exclusion. Selected
  callbacks wait; ordinary deletion bodies may execute while settlement waits.
  Replace obsolete SQL-lock inspection with actual Core admission/acceptance
  barriers. Do not serialize every callback.

The consumer race witness checks actual readiness-return ordering and preserves
ordinary deletion body entry plus stale-settlement refusal. It does not observe
private queue insertion or establish universal scheduling; the neutral Core
scope-exclusion contract retains that separate owner proof.

## Coordinated ownership

- Core worker owns `src/core/api.ts`, `src/core/transaction.ts` and new paired
  neutral `nativeReconstitution*` tests under persistence-postgres. Reuse real
  owner state and ordinary machinery; retain immutable first originals.
- Native-host worker owns atomic/commerce native invocation admission and store
  exposure plus focused actual-host policy/identity/recovery tests. Coordinate
  the exact Core method contract with the Core worker; no parallel substitute.
- Store worker owns selected Store workflow test construction, Core fixture
  assembly and dedicated old Store fixture retirement after their last imports
  move. Reuse existing native methods and assertions; no adapter repair of Core.
- Root owns this plan/divergence/goal pointers, source resolution/provenance,
  shared fixture reservations, integration, two-driver resources, review and
  exact-owned staging/commit. Shared unrelated WIP remains excluded.

Workers are not alone in the worktree and must accommodate others without
reverting their changes. Preserve shared Legacy helpers with named API Key,
direct-service, finite, Task or performance consumers and a removal gate.
Inspected fixtures establish no external durable dataset or data reset authority.
No new physical tables, migrations, reset, backfill or hosted activation is needed.

## Acceptance gates

Before acceptance, run neutral same-root proof on PGlite and ordinary-role real
PostgreSQL, including both timestamp policies, identity/refusal, unique/FK,
rollback/cancellation and actual host policy/recovery boundaries. Run all 77
original Store cases on PostgreSQL; PGlite retains the six explicit PostgreSQL-only
skips. Exercise genuine clear-to-retained-inverse and semantic scope-exclusion
races. Retain connected recorded-row replay, native atomic admission, scope
exclusion and affected common workflow regressions.

Require genuine current Source execution/provenance guards, affected typechecks,
core/diff/exact-staged lint, portability checks, both mandated read-only reviews,
owned-resource shutdown and unrelated-byte preservation. No reduced assertion,
blanket skip, widened profile, presence-only compensation, retry engine or
compatibility wrapper may manufacture a passing result. Record durable domain
truth here; Git and external receipts own validation chronology.
