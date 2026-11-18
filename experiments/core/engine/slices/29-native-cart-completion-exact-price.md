# Cart completion and exact Cart-to-Order price through Core

Status **Implemented. PGlite and ordinary-role PostgreSQL verification passed.**

Flarex baseline `071406d44ee794f13151f892e6b2ebc5ebff0e42`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent findings and disposition

- The current-core challenge traced four Cart completion cases and two
  exact-price cases through the actual Cart completion command owner. The
  first root binds Cart. The second binds Cart and generated Order. Both
  previously provisioned through the larger Legacy PaymentCollection fixture.
- The pinned Convex challenge traced ordinary versioned keys through
  `crates/indexing/src/index_registry.rs`, equality-prefix and inequality
  compilation through `crates/common/src/query.rs`, and residual filtering
  through `crates/database/src/query`. Preserve the existing Medusa raw
  decimal companions and price precedence. Convex numeric types cannot carry
  the complete native decimal contract.
- The accepted-direction challenge found one source admission failure in the
  full nine-model Cart definition. Its CreditLine history index tests
  `deleted_at` outside the declared `(reference, reference_id)` tuple. The
  other thirteen non-null declarations fit the current owner. Cart totals
  read active CreditLines through the independent parent path.

The challengers compared a tuple-only index with residual filtering and a
deletion-first key. The former can exhaust the examined-row cap on active
siblings. The latter loses the declared reference prefix. The replacement uses
[compound non-null lowering](../divergences/native-compound-non-null-indexes.md)
with the existing ordinary range and residual owners.

## Owners and acceptance

- The shared relational lowerer admits the exact interval. The neutral fixture
  proved the logical examined-row bound, pending changes, conflict on interval
  entry, independent reverse access, guarded page refusal and prior shape
  refusals.
- The existing metadata compiler issues the complete Cart definition. Both
  workflows use Core installation and native events. The exact-price workflow
  binds generated Order. The Cart completion cases cover real empty Address operations,
  explicit null preimages, event and retained inverse, and the scalar and
  corrupted native result refusals.
- The exact-price cases check the stored Order line's exact decimal and raw
  price and the Summary's native numeric projection with its exact raw total.
  They verify four Order
  writes with one timestamp, one outcome and the four native Order
  creation envelopes, no Cart write and callback-free replay. The late failure
  consumes the actual created result after the genuine accepted Order receipt.
  Business rows and events roll back while Core retains the failed request state.
- The Legacy fixture retired its two profile switches and unused Order checkout
  return. The separate Legacy assemblies serve full Cart checkout,
  PaymentCollection checkout, finance, and Cart creation and refresh consumers.
- All six native cases and the neutral owner proof passed on PGlite and
  ordinary-role PostgreSQL. Adjacent Legacy cases passed through their
  fixture owner. Source provenance, affected types, lint and both independent
  reviews passed.
