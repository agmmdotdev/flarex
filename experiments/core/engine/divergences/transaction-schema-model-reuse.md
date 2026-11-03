# Transaction-owned schema model reuse

Convex `db914cf06e2b06ee985646611b9e12ed7a770318`
`crates/database/src/bootstrap_model/schema/mod.rs::SchemaModel::new` creates
a borrowed transaction/namespace struct. Rust methods are shared machine code.
The TypeScript translation's model constructs traced Effect functions and child
models as instance fields. Rebuilding it for each document repeats that work.

Create it lazily inside the transaction's existing ownership boundary and
reuse the same receiver. Read the live registry and dependency recorder on
each operation. The model retains only transaction-bound accessors and child
models, without caching schema results, validation or authority. This keeps
the schema read order and same-transaction writes, including failure markers.
