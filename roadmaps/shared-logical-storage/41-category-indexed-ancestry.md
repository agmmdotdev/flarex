# Indexed Category ancestry admission

Status: selected under the shared-storage completion goal.

## Connected outcome

An internal Category create or move currently reads every active Category before
checking whether its proposed parent creates a cycle. Once an otherwise
unrelated catalog exceeds the complete-set read limit, a selected write fails.
The native public Category suite remains on the physical Product runner; its
logical cutover will need this bounded prerequisite, plus exact public event
and Product–Category membership receipts.

## Owner and replacement

Medusa owns the Category tree and the rule against parent cycles. Its adapter
should inspect only the changed nodes and their ancestors, using Flarex's
scoped logical identity index and the same pending-row view as the command.
This changes the private adapter validation path, not native Category behavior,
the core row/index/transaction owner, or the public DTO. Complete ancestry is
still required: an actual chain beyond the declared query budget must refuse,
never be accepted from an incomplete page.

Raising the catalog limit would postpone the failure and charge an unrelated
shop catalog to each small write. An adapter SQL query or a second transaction
would bypass the shared owner. The selected path reuses its indexed logical
read and checks proposed parent changes within the same command.

The pinned service still counts siblings, and the repository reads all siblings
when inserting at a rank. A large *single sibling group* is a separate
capacity gate; this slice does not claim arbitrary Category breadth, deep
trees, or the public Category suite cutover. Record that limit before choosing
the next Category scale slice.

## Acceptance and cleanup

With more than 256 unrelated Categories installed, one selected child creation
and a cycle rejection must work on PGlite and ordinary-role PostgreSQL. Preserve
the current internal Category suite, exact path/rank behavior and atomic refusal
on both drivers. Run affected typecheck, source guard, lint and both required
read-only reviews. Remove the catalog-wide validation read and any test-only
diagnostics in the same commit; leave the physical public runner only for its
named unported methods.
