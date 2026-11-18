# Internal Category Boundary Cutover

Status: selected cutover implemented under the shared-storage completion goal.

## Connected Outcome

Move the three private internal Category boundary tests from the generated
Product profile to the admitted logical Product source. Extend the existing
silent internal Category create receipt to native update and delete calls,
keeping the direct internal service's lack of module events distinct from the
public Category service. The trusted atomic owner retains settlement,
idempotent replay, generic row and index updates, and rollback.

The existing create receipt and Category/Currency atomic command prove the
source can execute internal Category creation. The physical Product runner
still owns pinned public Category behavior and other Product methods; moving
its full fixture without those runtime contracts would misstate completion.
This slice changes only private test and logical receipt contracts, with no
named durable-data conversion or reset. No duplicate physical/logical reader
or fallback is introduced.

## Correctness And Removal Gates

Authenticate the selected command, input/result shape, ordered logical
attempts, owned Category table, allowed operations and zero module
events. Retain native rank/path maintenance and parent/child constraints; do
not replace the Medusa service algorithm. Prove silent facts, replay, a late
array-member rollback, refusal of invalid arrays and authority fields, and a
separate public Category event path. Run PGlite and ordinary-role PostgreSQL,
typechecks, source guards, lint and both read-only reviews. Remove the
physical-only boundary import/file and adjust the source inventory in the
same commit. Keep the pinned public Category runner until its named cutover.
Internal calls that mutate product/category pivot rows remain on that runner;
this receipt refuses them rather than granting unchecked relationship writes.
The receipt checks the pinned service's one-step sibling rank shifts for each
selected root transition and confines path maintenance to descendants of a
requested parent move, following ordered attempts when an ancestor and
descendant both move in one array. A moved root's path must match its observed
new parent path. It refuses an unrequested root rank/path change. Direct
creation accepts generated IDs and native rank clamping; it requires a handle
before service execution because the direct pinned service does not derive one.

Shared storage coalesces an insert followed by an in-transaction rank change
into one final row revision. The ordered attempts remain authenticated by the
logical receipt; publication records the two final Category rows rather than
the physical profile's three intermediate facts. No external fact consumer or
named durable environment depends on the displaced private test history.
