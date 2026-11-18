# Native Shipping Option Rule Batch through Core

Status **Complete for the admitted standalone native workflow. Paired database acceptance complete.**

Flarex baseline `fc2154263e3b7e557ed0ac97b7a45a9c71adbaf7`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent challenge

- Current Core and consumers. The standalone Rule Batch has one Legacy fixture
  caller. Move that caller and the genuine create, update, and delete branches
  and retained callbacks to the exact eight-table Fulfillment source. Shipping
  Option update owns its separate Rule reconstitution profile. Keep its contract
  and prove the shared repository still serves both profiles.
- Accepted direction. The [Rule Batch preflight](../../../../roadmaps/flarexdb-framework-integration/preflight/136-native-shipping-option-rule-batch-workflow.md)
  admits four raw entries per branch, twelve distinct Rules, four Option parents,
  128 calls and 64 events. Preserve the genuine parallel workflow, the trusted
  queued operation lane, native validation, and projected inverse inputs. Fresh
  recreation of a deleted external ID uses ordinary Core insertion and allocates
  a fresh internal identity and insertion generation.
- Pinned Convex. `writes.rs:241–255,313–355` coalesces by internal identity and
  retains the original revision. `transaction.rs:1188–1248,1351–1363` stages
  exact point reads and misses. `transaction_index.rs:179–249` overlays pending
  writes, `query/index_range.rs:218–252` records consumed intervals and EOF, and
  `committer.rs:924–975,1035–1046` validates published and pending writes.
  Reuse the translated pending-write, index, and acceptance owners.

The pinned SQLite workflow rejected missing-parent create then delete and invalid
retarget then delete. Create reached SQLite's FK constraint. Retarget failed the
native relationship lookup before SQL update. In a two-row create, the missing
parent won when its row came first and the occupied ID won in reverse order.
The Legacy PGlite workflow accepted both invalid overlaps and committed two
events each. It reported the occupied ID in both input orders. The SQLite
retarget case exercised native compensation. The portable workflow must preserve
the refusal origin and publish atomically through the existing root owner.

## Ownership and acceptance

Extend the existing [reference checkpoint owner](../divergences/native-reference-checkpoints.md)
to check each selected native write before advancing to the next row. Reuse the
indexed target read, authority, accounting, and authenticated failure evidence.
Select the behavior through trusted participant preparation and identity for
the standalone Rule profile. Keep Tax Region's entity-batch checkpoint and
normal final integrity. Validate the actual Option observations in Rule receipts.

Use the established before-settlement diagnostic seam for a competing Option
deletion after the Rule has observed it. Prove exact conflict, rollback, and no
publication. Prove a missing target at the first probe separately. Preserve
callback-free replay, scope isolation, insertion order, and the admitted resource
bounds. Retire the standalone Legacy initializer once its genuine caller moves.

Run neutral checkpoint cases, all Rule Batch branches and inverses, and shared
Shipping Option-update controls on PGlite and ordinary-role PostgreSQL. Run the
affected type, source, portability, and exact-stage checks and both independent
reviewers before commit.
