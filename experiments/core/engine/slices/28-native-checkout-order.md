# Checkout Order admission through Core

Status **Implemented and verified on PGlite and ordinary-role PostgreSQL
for the selected checkout Order participant.**

Flarex baseline `80567b909e4eda2272a414e9dd41ffb30aab1d9f`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

Move the existing checkout Order participant to the Core workflow host. Its
admitted cases include creation, deletion, Order transaction accounting,
native graph totals and the genuine retained creation inverse. The full
18-source Cart checkout, PaymentCollection checkout, and Order financial
workflows use separate Legacy compositions and have separate cutover gates.

## Independent findings and disposition

- The current-core challenge traced three consumers of the checkout Order
  fixture. It is the sole runtime caller of the shared Legacy Order
  initializer. Seven other files reference that initializer's types.
  The direct Order cutover supplies the generated definition and Core
  initialization. The existing Core workflow execution admits the genuine
  three method tokens and the graph read with call-local receipt evidence.
- The pinned Convex challenge traced nested mutation ownership through
  `crates/isolate/src/environment/udf/async_syscall.rs` and checkpoints and
  clamped child limits through `crates/database/src/transaction.rs`. Failed
  children restore pending writes and indexes while read evidence and used
  budget survive. The outer owner validates and settles once. The successful
  Medusa creation's later inverse is a new root using the retained IDs.
- The accepted-direction challenge traced the actual workflow binding,
  Core's call-local activity, and the existing physical graph receipt
  correlator. The hidden historical Item and Shipping wrapper witnesses
  require complete lifecycle evidence. An outsider holding an Address
  requires the final shared foreign-key check after a valid native receipt.
  The default accounting root must still refuse at its existing budget.

The agents exchanged these counterexamples and confirmed reuse of the existing
pending-row merge, outcome and event owners, the [native root
binding](../divergences/native-root-participation.md), the [ordinary-index
observation policy](../divergences/native-ordinary-index-observations.md)
and the [native foreign-key owner](../divergences/native-relational-foreign-keys.md).
The static trace establishes no new mechanism difference. An actual
missing-evidence failure belongs to the Core owner and requires a retained
witness before adapting runtime behavior.

## Owner and acceptance

- Bind the generated Order and event definitions through the existing Core
  workflow execution and native storage grant. Preserve the real callbacks,
  graph result, receipts and events. The direct write host does not carry the
  workflow receipt contract.
- Verify one root creates an Order, adds the 2.5 capture, and reads total
  6.25, paid 2.5, and pending 3.75. Keep the named 512-call accounting profile
  and the default 64-call refusal with complete rollback.
- Verify the distinct copied Address IDs, metadata, and supplied timestamps.
  The genuine inverse writes six tombstones. An outsider reference must
  produce a valid child-first native receipt and a final `invalidInput`
  rollback from the shared Core foreign-key owner.
- Keep both hidden historical wrapper `receiptMismatch` witnesses. Verify the
  genuine retained Order creation inverse in a later keyed root writes four
  tombstones and same-key replay adds nothing. Compare actual Core rows,
  revisions, indexes, outcomes and events.
- Move the three checkout Order test callers and retire both Legacy fixture
  files. Move Core seed types to the Core Order fixture, finance seeds to
  their finance fixture, and the shared resource identity to logical Currency.
  Retain the shared Order command builder and generated schema compiler for
  full checkout and PaymentCollection checkout. Their callers still use them.
- Run the 13 Order cases on PGlite and ordinary-role PostgreSQL in the
  native Order configuration. The retained Order case has its own file.
  The three adjacent Legacy Payment cases stay in their existing
  configuration, with the Legacy fixture owner provisioning their schemas
  on PostgreSQL. Run the native Order source proof, checkout and finance
  source guards, affected fast types, lint and both reviews.
