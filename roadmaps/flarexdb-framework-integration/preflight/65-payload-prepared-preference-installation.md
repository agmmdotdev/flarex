# Payload Prepared Preference Installation

Status: proposed; host-lifetime and rebinding decision requires owner approval.

## Outcome And Evidence

Reuse the existing shared installation preparation/acceptance owner for the
private CMS preference installation. Remove full installation graph restoration
from each ready-host request without caching request authority or weakening
fresh evidence comparison. This follows [prepared Application admission](./64-payload-prepared-admission.md),
not a second implementation of it.

Current `cmsTransaction/admission.ts` calls `lockBindingInstallation` and retains
a `RestoredFrameworkSchemaAvailabilityHead` for every preference-enabled root
request. `payloadPreferences/binding.ts` uses that graph to check the admitted
fresh profile; `payloadPreferences/cleanup.ts` walks its physical layout for
deletion. Conversely, `commerceTransaction/host.ts` already prepares an immutable
installation description once and `commerceTransaction/admission.ts` invokes
`acceptPreparedInstallation` with fresh head/evidence checks per transaction.
The shared contract and integrity inventory are in
[installation runtime redesign](../installation-runtime-redesign.md).

The existing Payload latency workload includes preference storage, so it is the
nearest connected measurement and delete-cleanup proof. Its current span filter
does not isolate installation acceptance. Add that attribution before claiming
its contribution or predicting a reduction. The remaining Application input
preparation is a separate cost and is not removed by this proposal.

## Recommended Contract

1. A preference-enabled CMS host resolves its selected lifecycle binding through
   trusted binding/authority owners during construction. Reuse
   `prepareInstallationRuntime` before publishing the host. Retain one bounded
   description per host; no map, timer, global cache, connection, transaction,
   restored graph, or mutable request state. Construction performs metadata
   reads and validation, never schema installation or DDL.
2. Every request and retained replay keeps current scope, Application, binding,
   preference availability and evidence acceptance. Call the existing prepared
   installation acceptor at the present CMS preference lock position. Preserve
   exact target/reference checks, row-fingerprint coverage and all integrity
   refusals. An unchanged stored digest alone remains insufficient.
3. Preference verification and deletion consume narrow, immutable data from the
   existing installation runtime owner. Use its canonical physical layout and
   authoritative decoder; do not synthesize a restored repository capability or
   duplicate a layout schema. Preserve every existing fresh-profile predicate,
   including plan version, admission profile and residual requirements. Any
   necessary pure-data projection extension belongs to that shared owner.
4. Keep the existing caller construction shape. Callers do not pass physical
   identifiers or reconstruct evidence. A changed lifecycle installation or
   availability reference fails closed and requires an explicit new `bind`.
   Content-only binding changes with the same lifecycle reference retain their
   existing fresh admission checks. No automatic refresh or cold-path fallback
   may bless changed evidence. Hosts without preferences retain their current
   behavior and must refuse later unprepared preference activation.

The deliberate behavior change is that preference-enabled `bind` now performs
database preparation and can reject unavailable installation state early;
installation replacement requires rebinding. This is why implementation waits
for an explicit decision rather than treating the change as helper cleanup.

## Owners, Alternatives And Cleanup

- Extend: shared installation pure runtime data only where existing fields cannot
  express current Payload checks; CMS construction/admission and preference
  verification/cleanup consume that owner.
- Replace/delete: CMS's per-request cold graph restoration and retained restored
  graph. No parallel fast/slow modes for the same prepared host.
- Retain: full restoration for installation preparation, migration and repository
  inspection; independent cold consumers retain their actual contracts.
- Reject: Payload adapter caches, cached successful authority verdicts, skipping
  preferences on reads, TTL refresh, changing locks, arbitrary SQL shortcuts,
  reduced integrity coverage, schema migrations or a new installation engine.
- Defer: Application input-read consolidation, arbitrary Payload profiles,
  generalized lifecycle migrations, public APIs and deployment activation.

## Validation And Completion

First expose existing installation/binding spans in the opt-in benchmark and
classify their SQL work. Compare construction separately from reused-host
requests; report rather than discard startup cost. Freeze the compared source
checkpoints and serialize measurements with neighboring tasks. Require fewer
steady-state installation statements and an improved complete-request median
on the same workload; do not promise a latency threshold from static tracing.

Use both PGlite and ordinary-role PostgreSQL. Prove first construction, repeated
commands and retained replay, missing/foreign targets, evidence mutation with
unchanged digest, withdrawal/replacement, explicit rebind, no-fallback refusal,
concurrent and interrupted construction, and availability lock retention through
settlement. Preserve actual Payload delete/preference cleanup, rollback-only
hooks, unique errors, relation/join profiles and connected Commerce regressions.
Assert ready-host operations do not reconstruct the installation graph.

Run affected typechecks, lint, source/promotion guards when tracked integration
tests change, and both final project reviewers. Update owning current-status
documentation, remove measurement-only scaffolding, stop owned resources, and
commit only the completed approved slice. No production latency claim follows
from local conformance or benchmark results.
