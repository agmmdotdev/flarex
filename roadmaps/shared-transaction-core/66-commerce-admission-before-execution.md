# Commerce Admission Before Protected Execution

Status: implemented across standalone, atomic and existing composite hosts.

## Outcome And Scope

Standalone commerce, atomic commerce and the existing Currency/Payload/Application
composite validate installation and binding metadata before ordinary publication
exclusion. They then enter protected execution using a fresh clock. This removes
metadata validation from the same-scope exclusive section without pretending that
direct relational callbacks have native/CMS buffered OCC semantics. Callbacks,
business SQL, materialization and publication remain serialized for these profiles.

The commerce admission owner issues one explicit publication-entry decision for
the exact live admissions in a physical transaction. Stores refuse business writes
without that entry; finalizers consume its fresh clock. Composite lowering and its
Application absence observations use the same final clock. This is private owner
coordination, not a universal transaction API or new integration capability.

## Lock Inventory And Chosen Protocol

Ordinary command: scope KEY SHARE; installation availability SHARE; accepted
Application readiness and binding-head SHARE; immutable installation evidence and
request identity checks; scope NO KEY UPDATE; durable request replay check; command
execution and final publication. Concurrent duplicates may prepare metadata but
cannot execute callbacks before the authoritative outcome check under exclusion.

Standalone reads retain repeatable-read KEY SHARE and gain no write permission.
Bootstrap retains its initial FOR UPDATE, then enters the same publication gate;
reacquisition of a weaker mode does not release its strong lock. Ordinary composite
execution replaces its unnecessarily strong FOR UPDATE with this coordinated path.

Binding/activation/retention/revocation owners remain scope FOR UPDATE first.
Installation availability uses its own locked head: runtime retains SHARE through
execution and publication, excluding availability transitions. Ordinary writers do
not mutate that metadata. No store/business/build UPDATE lock moves ahead of the
publication lock, and no direct-SQL callback is retried automatically.

Rejected alternatives: rebasing an old clock by sequence arithmetic; mutating the
admission clock identity used by accepted bindings; letting business SQL run under
KEY SHARE; repeating full admission after publication; and adding a clock-first
fallback. Keep the admission sample immutable and register the fresh publication
clock separately for its exact token lifetime. Capture and reserve the exact
member list before awaiting the clock; revalidate liveness afterward. Pending
entry cannot authorize writes or admit an overlapping entry, and failed entry
cleans only its own reservation. Freeze issued member lists so callback mutation
cannot change which admissions are revoked.

## Breaks, Cleanup And Proof

Private stores and finalizers now require explicit publication entry. Migrate
all three host owners together; remove eager ordinary scope exclusion and use the
issued fresh clock throughout finalization. No public API, stored format or durable
data migration is needed. No old execution branch remains. Prepared installation
integrity hashing is retained; protected-root optimization is a separate remaining
gate, not justified by this lock change.

Prove real PostgreSQL admission while another same-scope callback/publication is
held; dense independent settlements; duplicate replay without callback rerun;
snapshot and lifecycle protection; cancellation and uncertain outcome recovery.
Exercise standalone, atomic/shared-installation and the actual fixed composite.
Use fast-driver witnesses for premature-write refusal and finalization, retain
framework adapter regressions, run affected typechecks/lint and both read-only
reviews, reconcile current roadmaps and commit. Admission overlap alone makes no
throughput or all-shops scalability claim.
