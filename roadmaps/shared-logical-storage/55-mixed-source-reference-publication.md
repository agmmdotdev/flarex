# Mixed-source reference publication

Status: implemented under the shared-storage standing approval. Joint
parent/child creation, full same-deployment multi-scope isolation and uncertain-COMMIT
recovery remain separate gates. The [scope-authority correction](./56-same-deployment-scope-authority.md)
establishes exact core selection but does not migrate all framework entry points.

The private Currency announcement admits one Application insert, one Payload
document insert and one native Currency write into a single logical delta and
publication. The connected reference-bearing command proves that the common
validator sees both source rows after materialization and before the one commit
clock advances.

## Contract and ownership

The composite host, source admissions, generic materializer and shared
publisher remain the owners. A live Product is an independently committed
target. A successful mixed command creates real Application and Payload sources
that both name that Product; a missing target rolls back Currency, Payload and
Application together. Replay returns the committed outcome without new rows or
facts. Subsequent Product soft deletion is restricted while either source
remains live. The command does not make Product creation part of the same
settlement, and cannot stand in for parent/child ordering proof.

No API or data-format break is required. Shared-owner corrections stay in the
core rather than bypassing the validator in the command or adapter. The witness
compares authoritative row, commit and outcome inventory for rollback and
replay on PGlite and ordinary-role PostgreSQL. Separate gates own
same-deployment multi-scope isolation, joint parent/child creation and
uncertain-COMMIT recovery.

The developer-index build query locks rows in index-ID order and matches them
to definitions by ID. Definition order is independent; pairing by array
position could report false stored corruption when several indexes are selected.

The mixed profile cannot assign all indexes on an Application table to
Application maintenance: a source-bound reverse reference index may also live
on that table. Application admission identifies
its declared developer indexes by stable logical identity, and the mixed
publisher selects index coverage by definition ID. Creation-time indexes retain
table ownership. The composite publication boundary preserves a
strong-reference rejection as invalid input. The current binding and publisher remain the only
authorities; no second write or fallback path is introduced.

An Application-declared index and a strong-reference reverse index can resolve
to the same physical definition. The common validator accepts verified active
Application maintenance, checks that its pending entries match final source
rows, and leaves coverage advancement to the
Application materializer. Source-bound reverse indexes retain explicit coverage
advancement. This preserves one physical index and one maintenance writer.
