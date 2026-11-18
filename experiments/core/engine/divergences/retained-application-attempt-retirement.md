# Retained Application attempt retirement

Status: **Owner retirement policy accepted / Independent challenge and peer
exchange complete; lifecycle direction selected, runtime unstarted / Unmeasured**.
The [slice](../slices/04c3d-retained-application-attempt-retirement.md) owns the
connected schema, classification, routing and validation gates.

## Pinned mechanism

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`, session requests
contain successful outcomes only. The runner checks the committed result before
the body and writes success in the same transaction as business changes.
Conclusive OCC rejection can retry the body; uncertain persistence reuses the
write packet or shuts down and reloads behind the PostgreSQL lease.

Inspect [the actual runner](../../../../../../crates/application/src/application_function_runner/mod.rs),
[session requests](../../../../../../crates/model/src/session_requests/mod.rs),
[session types](../../../../../../crates/model/src/session_requests/types.rs),
[committer](../../../../../../crates/database/src/committer.rs),
[database reload](../../../../../../crates/database/src/database.rs) and
[PostgreSQL lease](../../../../../../crates/postgres/src/lib.rs). There is no
upstream incomplete durable journal or corresponding retirement test to copy.

## Why and how Flarex differs

Old Application durable journals can have incomplete range-completion evidence.
Later queries cannot reconstruct their original pending state. The owner selected
retirement after conclusive PostgreSQL reconciliation while preserving historical
bytes. Existing Flarex abort/expiry deletes that evidence, so it cannot simply be
wrapped or renamed.

Add an in-place, non-executable retained retirement state through the existing
lifecycle/settlement owner. Preserve original session/journal/lease/child evidence;
keep ordinary payload-cleared terminals distinct. Authenticate exact affected
Application durable evidence, drain/fence old publication under existing locks,
recheck the outcome, and settle the transition atomically. Project explicit
application non-success only after confirmed settlement. Unknown acknowledgement
reconciles the same outcome/retained marker and never permits another body.

Cover actual Standard, redispatch, direct finishing/publication and recovery
entrances before a sweep. Native child records do not turn their Application root
into an excluded native profile. Standalone native, finite and historical system
contracts remain separate. Keep the original finite snapshot lease and prohibit
renewal; no new retention/deletion policy is introduced.

Do not copy upstream session cleanup: it deletes old successes, whereas retirement
must preserve existing committed outcomes and historical evidence under their
current expiry/tombstone contracts. Do not treat a missing result lookup, an idle
snapshot helper, a cancellation signal or an old seal digest as noncommit proof.

## Remaining proof and costs

The dedicated durable discriminator/decoder/client reason and classification
contract still need exact owning fields before implementation. No producer-version
marker exists, so unprovable original range completion must remain explicit.
Late publishers, unknown retirement acknowledgements, cleanup, full byte
preservation and actual consumer routing require both-driver/ordinary-PostgreSQL
witnesses. Managed host cutover/fencing is a gate; new code alone does not fence a
running older host.

This is bounded cold recovery/classification work, not a new mutation success path,
cache authority or performance claim. No runtime retirement or data reset has yet
been implemented.
