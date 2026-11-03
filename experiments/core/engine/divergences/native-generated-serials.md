# Native generated serials

Status **Implemented for fresh generated-serial definitions. The neutral owner
and both direct Order consumers passed paired acceptance.**

Convex `db914cf06e2b06ee985646611b9e12ed7a770318` allocates opaque document
identities through the transaction ID generator. Table numbers are derived
from observed registry membership and installed through ordinary transactional
writes. Neither mechanism defines a numeric framework field.

Medusa's pinned Drizzle `applyGeneratedSerialValues` uses the current maximum
plus one for a nonprimary serial column. An empty set starts at one. A
negative maximum increments as stored. Current soft-deleted rows participate,
physical deletions release their values, and explicit values and pending
changes affect the next row in the same ordered batch. PostgreSQL sequences
and monotonic high-water marks cannot reproduce those rules.

Translate the maximum lookup as a descending, limited ordinary Core query,
with the existing snapshot and pending index merge. Lower each authenticated
`serialNext` declaration to an unconditional backing on its serial field.
An active-only index prefix cannot provide the maximum. No separate counter
record, physical table, independent transaction or adapter SQL participates.

The consumed upper interval includes its winner and all greater keys. The
empty result consumes EOF. The installed index and the observed committed
membership use the same transaction authority and timestamped acceptance as
ordinary native observations. Validate relevant earlier remembered identities
and consumed allocation intervals before using fresh indexed state. Retain an
already observed complete table through its remembered originals and pending
writes. A moved or removed remembered maximum or a distinct new member in a
previously consumed suffix must cause a conflict before a different value is
exposed.

The Legacy owner's complete-table read imposes a private cohort-size cutoff.
The replacement charges examined committed and pending identities and bytes
through the existing limits. Unexamined lower keys no longer consume the
maximum lookup's allowance. A masked upper prefix that cannot be proved
within those limits still refuses. The [connected slice](../slices/27-native-order-generated-serials.md)
owns both counterexamples and the paired validation gate.
