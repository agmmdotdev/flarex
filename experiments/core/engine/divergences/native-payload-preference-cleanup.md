# Confined native Payload preference cleanup

Status: **Selected native model/lifecycle extension implemented with connected
two-driver proof; broader native and hosting gates open.** The [optional-one continuation](../slices/14-native-reference-integrity.md)
owns scope, installation and cutover. Convex pin:
`db914cf06e2b06ee985646611b9e12ed7a770318`.

## Pinned mechanism and native requirement

Source has no Payload preferences. Its
[CronJob model](../../../../../../crates/model/src/cron_jobs/mod.rs) demonstrates
explicit owned cleanup: delete the model record and its indexed NextRun/logs
through the same transaction. This is not a generic foreign-key cascade and
grants no mutation rights over a different owner.

Existing admitted Payload deletion requires exact internal preference cleanup
under an authenticated installed lifecycle and transaction-owned pending-delete
proof. It includes a legitimate insert-then-delete with final absence; arbitrary
IDs, a failed delete, or a borrowed root without cleanup authority do not qualify.
Native Local API hooks, same-request lifetime and root-only settlement remain.

## Selected logical translation

Install complete confined preference definitions/indexes logically above the
five core physical tables. Reuse existing exact selector/intent capture where
sound, replacing SQL storage locator evidence with authenticated installed
logical schema/index/source readiness. This is not permission for ordinary
`deleteMany`, user collection access to internal preferences, migrations or other
unsupported Payload internal collections.

The transaction owner issues deletion evidence and validates final pending state;
the CMS owner derives only the exact admitted cleanup and applies it through the
same kernel. Neither adapter nor fixture owns another validator, SQL transaction,
finalizer, compensation route or successful no-op fallback.

The joint root remains create-only without cleanup. A later trusted profile
activation authenticates the installed policy/capability, uses persisted authority
revocation and rebinds standalone deletion. A fixture boolean or bare epoch bump
does not establish installation. Old joint bindings fail before callbacks and
after cold reconstruction. This capability transition is separate from the
named populated scalar-to-relation schema successor.

## Executing owners and proof

`payloadPreferences/nativeSource.ts` owns the actual logical model and
`makePayloadPreferenceNativeDefinition`. `nativeCleanup.ts` issues
`makePayloadPreferenceNativeCleanup` only after regenerating and matching exact
model/provenance metadata, active schema/authority and real root bindings. Core
admits the authenticated add-only source generically, without duplicating the
Payload model. Its transaction owns `pendingDelete`/`assertPendingDelete`.
The existing cleanup recorder captures exact selectors and the CMS native host
applies them through the sole native root before finalization.

Prove forged/foreign/stale capability refusal, absent/incomplete installation,
wrong collection/scope/selector, delete failure and insert-delete cases; preserve
unrelated preference records, atomic rollback, cancellation and outcome recovery.
Prove stale joint rejection before both callbacks followed by authentic new
standalone behavior, including relation restrict failure without preference
loss. Run genuine Local API and separate PGlite/ordinary PostgreSQL witnesses.

Retained developer-UDF finite-root cleanup, private Product reference recovery
after withdrawal and other Legacy preference consumers keep named migration
gates. No deployed native host or performance result is claimed.
