# CE2 Required Ordered Index Composition

Status: implemented for Application material publication/proof and the shared
CMS/cross-domain participant. [Legacy-writer exclusion](./21-ce2-legacy-writer-exclusion.md)
also closes material and attempted legacy publication under active heads.

## Outcome And Owners

Application row publication must not interpret missing intrinsic/developer
index ports as an empty maintained set. Both ports must be issued by their
existing core factories for the same control database as serving schema
authority. The exact developer requirement lookup from slice 19 remains the
definition owner; the intrinsic owner retains its table-owned locator.

Register intrinsic ports with their constructing control database, as developer
ports already are. Put the pair's composition predicate with shared document
materialization. Native publication and rollback proof apply it to material
Application writes, after committed-outcome recovery and preliminary authority
checks, before definition preparation or transaction writes. Reuse the existing
Application-capable stored-commit authority ports type, including its control
database reference, rather than invent another authority container.

CMS and cross-domain writes pass the existing control database explicitly to
the shared participant. That owner verifies the resolved schema's issuer and
both ordered-index port issuers. Presence alone and structural callback copies
are insufficient. This check is composition, not cached request authorization;
current active selection, scope fences and transaction admission stay fresh.

## Breaks, Alternatives And Cleanup

Application material writers with missing, copied or foreign-database ports
now fail closed. Migrate every affected caller/fixture to real issued ports.
The shared participant and private CMS preparation signature gain the explicit
control database; update both CMS and cross-domain callers together. No durable
format, schema migration or public developer API changes are required.

Do not add a fallback locator, a second catalog verifier, adapter SQL or an
optional bypass. The lower `pointCommitTransaction.postgres.test.ts` publication
fixtures and the executor's `pointMutationExactRuntimeRunner.ts` and
`pointMutationSessionActivation.ts` consumers still exercise their existing
non-Application profile;
their material and attempted writes now refuse against active Application
obligations. No optional serving composition is justified by those fixtures.
Zero-material native outcomes do not require index mutation capabilities.

## Validation And Completion

The native Application-generation witness refuses missing intrinsic/developer
ports, structural copies, foreign-database ports and missing control evidence
before row/index/publication changes, for both publication and rollback proof.
It retains a valid commit and proves committed-outcome replay with invalid new
write composition. The shared participant refuses the same port substitutions,
a copied schema and a foreign control database. PGlite and ordinary-role
PostgreSQL exercise these paths; the existing Currency/Payload/Application
command proves the migrated cross-domain caller. Retain affected typechecks,
lint and both read-only reviews as the change gate.

The Application relation-commit fixture now prepares real ordered-index builds
and issued ports while preserving its locked-active-schema rejection witness.
The write-policy fixture provides its actual control database and ordered ports;
lower legacy proof fixtures keep their explicitly limited profile.

This establishes required issued composition. Binding
to continuous maintenance, reader/build/activation cutover and removal of
coverage updates remain subsequent CE2 work. Existing locks, coverage updates,
unique-constraint behavior and request isolation remain in force.
