# Native Cart creation and refresh through one Core source

Status **Implemented. PGlite and ordinary-role PostgreSQL verification passed.**

Flarex baseline `148cbe7bde668530d146d4a9cab915bd47a2f997`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent findings and disposition

- The current-core challenge traced three single-Cart consumers with 10 native
  creation, seven creation-refresh and nine creation-ownership cases. They
  share a twelve-model definition. The nine original models retain their
  columns, indexes, outgoing foreign keys and checks. Cart and Address gain
  incoming ownership claims.
- The pinned Convex challenge traced logical component schema preparation,
  successful-root outcomes in `crates/model/src/session_requests/mod.rs`, and
  fresh document identities in `crates/database/src/bootstrap_model/user_facing.rs`
  and `crates/database/src/transaction_id_generator.rs`. Medusa can reuse a
  business ID. A retained handle in a new root must verify its original
  generation and distinguish an already compensated operation.
- The accepted-direction challenge confirmed that Core authenticates the issued
  logical source and exact command tokens. It rejects overlapping logical
  definitions within one bundle. Default completion and read commands can
  bind the same twelve-model source with their existing nine-model native
  metadata and bounded grants.

The challengers selected one fresh twelve-model Core Cart source. Move the
existing Core emitter to the creation compiler and bind both Native29 workflows
to it. Keep the nine-model Legacy compiler for its full checkout and
PaymentCollection consumers. The full Cart creation root still mounts 18
sources and needs the shared `CommerceStore.related` port for automatic
Promotion. Populated source evolution has a separate gate.

A delete and reinsert under the same business key can retain children under
Core's final-state foreign-key semantics. The genuine Cart compensation path
uses the existing child-first lifecycle to remove the old claim before reuse.
The [generation records](../divergences/native-cart-creation-generations.md)
preserve this native obligation with the existing scope exclusion and settlement
owners.

The Legacy Tax inverse test expects the later receipt to include a pending
soft-deleted row from a wider parent scan. The migrated run reached the real
inverse and failed that expectation. Its active Core interval returned the
replacement Tax row and excluded the earlier soft-deleted row. Keep the inverse
and rollback assertions and both tamper refusals. Use the earlier accepted
receipt to supply the genuine excluded row in the negative packets.

## Connected acceptance

- The 26 migrated cases, six completion and price cases, and the new
  creation-to-completion case passed on the same twelve-model source. Source
  proof covers command admission and executing provenance for the nine Medusa
  models and three authored fork models.
- The four-Cart and eight-Address case preserves 37 forward mutations and
  envelopes and 37 inverse mutations with 13 inverse envelopes. It retains
  exact decimals above 2^53, the 512-call scope-exclusive profile and refusal
  without that profile.
- The ownership cases verify child-first claim removal, stale-handle refusal
  after same-root reuse, both Address reverse reads, soft-deleted outside
  references, orphan handling, late rollback, callback-free same-key replay
  and a fresh-key already-compensated verdict.
- The three displaced Legacy assemblies retired. The five cases for the full
  Legacy Cart assembly also passed on both engines. Source and portability
  guards, affected typechecks, lint and both reviews passed.
