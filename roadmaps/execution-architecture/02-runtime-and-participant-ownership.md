# Native Runtime And Participant Ownership

Status: **implemented; local consumer and installation cutover complete.** The owner authorized this
organization slice after the full draft moved into the main repository.

## Connected Outcome

An ordinary Payload runtime supplies the same native create, update and read
behavior to direct callers and the existing Application mutation participant.
The Application consumer no longer needs a conformance runtime to obtain its
participant dispatcher. Fixed hooks, access scenarios, counters and raw-instance
inspection belong to explicit test support. Existing Medusa module and finite
workflow construction remain their native behavior owners.

First stabilize the imported read draft: correct publication of admitted Payload
views, finish the retained physical fixture installation contract, resolve the
imported lint findings and reconcile the exact Medusa source provenance. This
is correctness and organization work; latency tuning remains paused.

## Evidence At Slice Entry And Existing Owners

- Payload `composition.ts` combined native instance acquisition,
  optional fixed test behavior, direct hosts and raw instance exposure.
- Ordinary `makePayloadRuntime` already avoids scenario hooks. Preserve the
  scalar witness showing fixture-like titles behave as ordinary data.
- `mixedConformance.ts` owned the only borrowed create/update/findByID dispatcher.
  Consequently the real Application fixture constructed test runtimes to obtain
  ordinary participation. Move that responsibility to the adapter runtime.
- Medusa already owns native Product commands, module construction and
  `product-attempt.ts`. Its method participant admits update/retrieve/listByHandle;
  the selected launch workflow separately admits variant creation. Preserve this
  exact scope. Do not promote the upstream-test service proxy into runtime.
- [Accepted design](../../design-notes/flarex-db-accepted-design.md),
  [package boundaries](../16-package-boundaries.md) and the
  [architecture map](architecture.md) govern authority and dependency direction.

## Organization And Contracts

| Owner | Responsibility |
| --- | --- |
| Payload `runtime/native.ts` | One native instance, bridge, native commands and scope/liveness ownership |
| Payload `direct/binding.ts` | Bind genuine full-proof and read-only hosts to that native instance |
| Payload `participant/binding.ts` | Exact admitted method selection and existing borrowed CMS deadline, completion, failure and revocation behavior |
| Payload `testing/` | Existing fixed conformance profiles, hooks, access policies, counters and native inspection |
| Payload ordinary runtime entry | Accept only authenticated compiled collections; compose ordinary capabilities |
| Medusa native module/workflow owners | Retain existing shared mechanics and business behavior |
| Application fixture | Select runtime, supply trusted attempt dependencies and observe test events; no private Payload execution algorithm |

Before: the Application fixture selects a conformance runtime, calls its
`invoke` against a borrowed CMS context, then closes or aborts that borrowed
lifetime itself. After: an ordinary adapter participant binds the native
commands and owns that same CMS lifecycle. Test runtimes use that binding too;
the fixture retains only its actual outer attempt scope and fault observations.
Retries still create fresh scoped native instances. A continued cancelled hook
must lose access to its old context.

## Stabilization Boundaries

Read projection publication must distinguish table definitions from admitted
views. View-only sources retain their authenticated candidate evidence but issue
no definition-serving projection. Preserve missing-definition refusal and test
composition plus repeated backfill on PGlite and ordinary-role PostgreSQL.

The retained physical installer uses the already-approved
[maintenance contract](../core-performance/standalone-read-redesign-preflight.md#retained-physical-fixture-installation-under-maintenance).
Its fixed operation reuses canonical framework planning, execution and receipts
on the maintenance owner's exact dedicated backend. Ordinary installed DDL is
explicitly refused. Newly created physical tables receive admission protection
before reopen; original history/sealing predicates must also verify. Backend
failure leaves the installation draining. Recovery occurs through a fenced
successor after predecessor closure, never an ordinary-pool fallback.
Migrate real Commerce and Payload preference fixture consumers together.

The Payload preference consumer also exposed a CMS closure mismatch: settlement
rechecked a live pending-deletion capability after closing its working set. The
CMS owner now derives cleanup authority from the exact consumed document closure,
admission and closing request lifetime. Callback access still requires live
pending state. Preserve forged, foreign, missing-deletion and escaped-capability
refusals and the existing rollback/publication witnesses.

## Alternatives And Cleanup

Keep one native behavior implementation. Separate direct and participant binding
because their execution owners differ. Do not run a direct host inside a borrowed
mutation or introduce a universal CRUD/transaction dispatcher. Extracting only a
testing barrel would leave runtime ownership unchanged; moving the existing test
proxy wholesale would promote scenario semantics into ordinary execution.

Delete displaced Payload composition/conformance paths after their consumers
move. Preserve scenario revision strings and authenticated source identities;
file movement does not justify changing replay contracts. Update source receipts
only for reviewed real source changes, retaining pinned upstream provenance.
Keep the physical profile only for its named unmigrated consumers and existing
retirement gate. No compatibility wrapper is needed for moved private imports.

No schema reset, durable-data deletion, public API, arbitrary hooks, arbitrary
native methods, hosted activation, composed Application query or new workflow
capability is part of this slice.

## Validation And Completion

Prove ordinary Payload direct create/update/read and an ordinary participant
create/update/read through the actual workerd Application root with Product work.
Require pending visibility, one outer outcome and atomic publication. Retain
conformance proofs for native errors, late validation, unsupported methods,
cancellation, continued hooks, replay and fresh retry instances. Retain the
existing selected Medusa direct/method/workflow witnesses.

Run affected typechecks, core/diff lint, source provenance guards, PGlite and
ordinary-role PostgreSQL owner/consumer tests, and the connected workerd proof.
Installation witnesses cover exact target, ordinary refusal before work, added
table protection, canonical replay, draining/fencing and refused corrupt reopen.
Both project reviews assess the final source and connected failure contracts.
Remove displaced imports and stop owned test resources. Commit only a coherent,
verified checkpoint; imported unfinished work does not become complete merely
because this slice depends on it.

### Native Installation Cutover And Retained Gates

Commerce, Payload preferences, DataBinding, relational transactions and native
text-set preparation use the fixed maintenance operation. No current native
caller requires the ordinary pooled installer or a second physical namespace.

The completion cutover replaces the native coordinator fixture family with
`retainedPhysicalInstallation` tests against the fixed operation. Keep canonical
graph, claim, additive-plan and budget behavior in their existing PGlite owners.
The native replacement covers receipt/event/head and DDL atomicity, actual
blocked SQL and COMMIT cleanup, durable outcomes after lost acknowledgements,
exact original guard integrity, independent namespace progress and fresh-process
reconstruction. Historical receipt remapping and protection-migration rollback
remain in `frameworkCoordinatorMetadataProtection.postgres.test.ts`, alongside
ordinary runtime privilege and late-child sealing checks.

The superseded ordinary installer authority, pooled-client recovery,
second-schema restart and native additive fixtures are removed. Their old query-plan and
phase measurements do not establish performance for the maintenance profile.
No deployed schema, stored receipt format or named durable data is deleted by
this test/construction cutover. Native additive evolution requires a later
approved maintenance operation and connected proofs before it can be claimed.

The text-set corruption witness exposed a distinction between canonical replay
and physical verification: `installFresh` may return a durable completed result
without observing the current physical constraint. The maintenance owner also
calls the existing installer's explicit verifier before reopening. A changed
constraint fails with `catalogMismatch` and leaves the namespace draining.
This reuses the structural verifier on the same dedicated backend; it does not
add an adapter probe or change the stored receipt contract.

Private contracts removed by this cutover are the ordinary PostgreSQL migration
target factory, pooled recovery transport, installer-role fixture, second-schema
fixture placement and restart-credential plumbing. All current native callers
use the fixed operation. The PGlite target remains an explicit test driver.

Blocked native work uses the exact authenticated backend cancellation key,
bounded drainage and dedicated transport close. Cleanup errors remain visible
and the installation stays draining on failure. Native evidence covers direct
non-TLS PostgreSQL; hosted pooling and TLS cancellation remain unproved.
The shared foreign cancellation packet adapter is still duplicated with the
physical-session owner. Consolidating that transport primitive belongs to the
later execution/persistence organization slice, with separate lifetime policies.
