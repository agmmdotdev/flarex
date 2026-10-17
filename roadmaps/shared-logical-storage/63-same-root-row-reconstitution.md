# Same-Root Row Reconstitution

## Status And Scope

Status: checked neutral storage mechanics are implemented; the connected Store
update admission retains its separate validation gate. This operation serves
trusted synchronous logical participants. It does not reconstruct committed
history or admit external saga compensation.

Native Store relation clearing captures complete prior child DTOs, physically
removes those children, then retains a callback that reinserts their identities
and creation timestamps. Ordinary graph creation correctly refuses unproven
managed fields. The adapter must not strip those fields or invent a timestamp
exception to hide the mismatch.

## Accepting Owner And Contract

The logical relational store optionally exposes `reconstitute(context, rows)`.
The trusted participant must explicitly select `allowReconstitution: true` and
provide logical receipt validation. Capture accepts only the literal selection,
physical participants refuse it, and the selected participant names enter the
prepared execution identity. Other logical profiles retain their previous
identity and do not expose the method.

The working set authenticates a complete supplied native row against the exact
canonical preimage of its latest physical deletion in this live root. It checks
the admitted table and native key, latest deletion attempt, complete field
equality, active soft-delete state where applicable, and absence of a live or
ambiguous replacement. A DTO, copied timestamp or matching external ID alone
does not grant reconstitution. There is no insertion fallback.

Reconstitution uses the existing pending document and normal write machinery.
It preserves logical identity, logical creation time, native identity and proven
native creation time. Existing table mechanics refresh managed update columns
using the accepting transaction timestamp. The ordinary delete and insertion
attempts remain available to call receipts, while committed facts/revisions
describe the final durable row transition.

The operation retains normal source admission, cancellation, rollback-only,
capture/byte/identity/attempt limits, unique-key validation, final foreign-key
checks and singular settlement. It returns native write rows, never a database,
history, clock or settlement capability. Persisted deletion from an earlier root,
durable overlays without retained deletion contents, occupied keys, changed
preimages and repeated use while live are refused.

## Consumer Boundary

The shared Medusa replacement profile can explicitly route absent non-root
complete managed DTOs to this checked operation. The module still decodes its
native shapes and verifies ownership, results, performed actions and events;
core alone proves the deleted origin and manages timestamps. Ordinary creation,
partial DTO reinsertion and profiles without this selection keep their existing
paths. There is no Store-specific storage branch.

No schema, durable codec, data reset, backfill, source ownership transfer or
hosted activation is included. Supporting restoration across committed roots
would need a separately defined durable history and identity contract.

## Correctness Gates

Neutral PGlite and ordinary-role PostgreSQL proofs must begin with a committed
row, then exercise deletion and reconstitution inside one actual exclusive
atomic root. Check original internal/native identity, preserved creation time,
accepting update time, exact attempts, net facts/revisions, replay and rollback.
Refuse altered business/owner/managed fields, missing deletion, soft-delete-only
history, occupied or ambiguous keys, repeated use, later roots and omitted or
malformed admission. Failed, caught and cancelled roots must publish nothing.

The Store consumer must exercise genuine clear-to-retained-inverse callbacks in
the same accepting root, with ordinary creation/deletion and shared replacement
regressions. Native metadata and historical-tombstone compensation limitations
remain framework behavior, separate from exact failed-root rollback.
