# Native workflow diagnostics

Status **Implemented. PGlite and ordinary-role PostgreSQL acceptance complete.**

Convex `db914cf06e2b06ee985646611b9e12ed7a770318` routes console operations
through a synchronous unit-returning isolate operation in
`crates/isolate/src/ops/console.rs`. The UDF loop drains microtasks and detects
unhandled Promise rejections in `crates/isolate/src/environment/udf/mod.rs`.

Medusa's native `Logger.error` also returns void. Its Payment Session delete
step awaits the deletion promises and their catch handlers. Flarex's former
async composed logger returned an extra Promise that Medusa discarded. When a
provider deletion failed, rollback fenced commands before the catch finished.
The detached diagnostic then rejected with `closed` and missed the sink.

Flarex binds the admitted Payment logger as one bounded synchronous diagnostic
within the existing Medusa Promise owner. The trusted sink can observe the
failure during the active callback drain. Its lifetime ends at the existing
root fence. The logger carries no transactional capability and schedules no
async request work. Ordinary composed commands keep their existing admission,
fences and failure classification. The original provider failure remains in
the root's rollback Cause. The native program, workflow identity, storage and
commit authority stay with their existing owners.

The resource admits trusted host sinks that implement Medusa's synchronous
Logger ABI.

The [existing foreign Promise contract](./native-promise-draining.md) owns the
bounded drain. The [Cart PaymentCollection acceptance](../slices/34-native-cart-payment-collections.md)
uses genuine provider rejection to verify the diagnostic and unchanged stored
state. The resource test verifies synchronous return, no command capability,
and no delivery after close.
