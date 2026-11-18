# Native Payload Delete And Preference Cleanup

Status: implemented privately for fresh logical-source and finite
mixed attempts. General preference CRUD and cross-framework relationships remain
separate gates.

## Connected Contract

Real Payload delete stages content absence and its exact native preference key.
The source admits the existing reserved preference installation through its
checked lifecycle binding. Only the trusted outer owner deletes matching
preferences, publishes lifecycle facts and settles content/Application/commerce
changes. Empty matches require a real bounded query. No callback holds a SQL
transaction, performs cleanup DML or receives installation/finalizer authority.

Reuse the existing lifecycle artifact, installation acceptor, cleanup validation,
bounded SQL and fact codec. Generalize their CMS admission coupling, rather than
copying them into the adapter. The physical preference family retains its existing
full-proof CMS consumers and durable identities; migration to generic logical
preference rows remains with shared storage's structural cutover. No data reset,
new installation engine, public bulk delete or arbitrary internal collection is
authorized.

## Owners And Cutover

- Binding verification admits the checked logical Payload source as an
  alternative content identity for the existing preference lifecycle binding.
- Logical CMS admission retains the exact prepared installation and revalidates
  it at transaction-owned use and settlement. Missing or replaced lifecycle
  authority fails closed; content-only profiles retain refusal.
- Cleanup captures only the deleted document's exact collection/key. Final
  publication rechecks absence against the entire root, authenticates source
  ownership and applies real cleanup under the scope lock. It uses the existing
  prefix/fact/clock owner and uncertain-outcome recovery.
- Finite receipts retain bounded cleanup intents through freeze and publication;
  no successful operation acknowledges independently. Existing durable-operation
  profiles keep their prior contracts. Native delete is admitted only after its
  required cleanup authority is present.
- Replace the relationship integration test's trusted document-delete shortcut
  with real Payload delete. Preserve core regression coverage and other
  supported standalone consumers; remove displaced refusal and assembly only
  where this connected migration replaces them.

## Owner Corrections And Proof Boundaries

The ordinary-role PostgreSQL witness exposed a retained-profile installer
composition limit: its maintenance artifact reader authenticated the target DB
even when the original artifact repository belonged to a separate control DB.
Expected: retain the original bounded catalog reader and installation checks.
Actual: `invalidControlSessionComposition` before installation. Correct the
installation owner's explicit catalog selection and authenticate the repository/
database pair; same-database consumers retain the dedicated-backend reader.
Neither the Payload adapter nor test harness may duplicate installation logic.
The same retained installer verified every registered endpoint as `dataRuntime`,
incorrectly rejecting an existing `activationWriter` endpoint. Preserve each
registered access profile in the shared privilege verifier. Keep the actual
ordinary-role runtime protections enabled. Grant no business-table rights to
registered `controlRead` endpoints; their catalog-read profile and verifier
continue to refuse business-table writes. Maintenance invalidates prior serving
proofs, so fresh test composition installs before issuing serving/activation
proofs and reuses the ordinary scope provisioner and fixed installer.

The retained three-source Currency/Payload/Application consumer also exposed an
older shallow contribution copy that dropped the shared insertion-root identity.
Expected: its genuine closed graphs remain admissible after capture. Actual:
`invalidAuthority` from shared contribution validation on both drivers. Replace
that duplicate capture with the existing shared document detachment owner;
preserve proof checks and the composite profile's cleanup refusal.

Use genuine Local API delete for empty/matching preferences, exact collection and
scope isolation, reference restriction and clear-then-delete, create-then-delete,
late rollback, caught failure, conflict/retry, retained replay and real PostgreSQL
COMMIT-response loss. Reject malformed/unrelated cleanup selectors and missing or
withdrawn lifecycle authority. Account for generated rows with no final revision:
no lifecycle fact may invent a content revision or weaken the retained fact FK.
Validate PGlite and ordinary-role PostgreSQL, Pinggg `tsc-rs`, affected regression
tests and guards, lint and both read-only reviews. SQL observation of the empty
match uses the PGlite lane; PostgreSQL retains real outcome/fact and recovery
witnesses. The shared PostgreSQL test fixture adds only a pre-serving installation
phase; Medusa business implementation remains outside this slice.
Performance optimization and hosted activation remain deferred.
