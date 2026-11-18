# CMS Command Contribution And Settlement

Status: implemented. This is the CMS preparation and settlement prerequisite for
completion-plan package 1; it does not activate concurrent writers.

## Outcome And Breaks

Replace the write-only CMS contribution with complete bounded command evidence:
point reads including absence/tombstones, collection-scan frontiers, unique-key
observations including transient attempts, final changes and attempted writes.
The document owner issues and consumes this evidence within one admission and
lifetime. Shared materialization validates point dependencies; the CMS
contribution owner validates collection and eager-unique observations. No
adapter-owned transaction, public lock API or automatic callback retry is added.

Preference cleanup becomes a captured intent during the command and bounded
SQL at settlement. The admitted adapter deleteMany returns no selected IDs and
exposes no intervening preference readback. Malformed selectors, unbound tables
and non-pending deletions still fail during command execution. Stored selection,
overflow and SQL failures now occur at settlement and roll back the entire
command; callback-local catch cannot suppress them. This is an intentional
private timing/error-stage break, not a successful no-op delete.

Read observations consume the existing request byte and identity budgets,
including absent IDs. Repeated missing reads reuse their captured absence.
Some formerly admitted near-budget commands now refuse because their complete
evidence costs more; no limit is raised or bypassed. The selected reference
fixtures reflect this accounting and cache behavior without expanding their
operation profile. Earlier timing reports are not measurements of this new
contract. A changed read decision has the private `writeConflict` disposition;
malformed stored evidence remains corruption, with no automatic callback retry.

Migrate standalone CMS and the existing composite consumer together. Keep one
physical transaction and one publisher. Preference identities must remain
bounded before DELETE; exact deleted-set verification, publication facts,
generation/scope confinement and rollback remain mandatory. Delete the old
callback-side DML/receipt path when the intent-based path is installed.

## Evidence And Alternatives

The replaced documents contract retained rows read without writing them but
dropped them from its final contribution and omitted missing reads. Its
contribution validation equated dependencies with attempted writes. That could
not establish command decisions once writers overlap; the complete contribution
now preserves both attempted-write dispositions and independent read decisions.

The current bounded collection query scans the whole admitted logical table
before applying its in-memory predicate. A table frontier is therefore its
actual read domain, not a substitute for an existing narrow index dependency.
Retain precise point dependencies for point queries. A later indexed query
implementation must provide its own narrower predicate evidence.

Reusing the existing point dependency validator, table frontier reader and
unique slot reader avoids another OCC engine. The subsequent
[CMS concurrency cutover](./64-cms-concurrent-command-settlement.md) replaces
callback-wide publication exclusion together with bounded capture and request
exclusion. Final validation and materialization retain publication protection.

## Validation And Completion

Cover read-only decisions in mutating commands, absent/tombstone reads, complete
and empty scans, repeated/pending reads, net-zero writes, unique observations,
resource limits, immutable/single-use closure ownership and both settlement
consumers. Prove preference rows survive callback execution, are removed by
settlement, and roll back on overflow, post-delete failure and publication
failure. Retain real Payload Local API deletion, replay and confinement tests.
Run affected PGlite and ordinary-role PostgreSQL lanes, types/lint and both
reviews. No lock, throughput or concurrent-writer improvement is claimed here.
