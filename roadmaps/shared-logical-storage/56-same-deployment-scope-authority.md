# Same-deployment scope authority

Status: the control catalog permits multiple scopes under one deployment, its
deployment-only lookup refuses ambiguity, and the trusted relational command
host and Application snapshot/query readers select an exact scope. Framework
binding, Application activation/readiness and point-mutation entry points still
use deployment-only selection and therefore refuse a multi-scope deployment.
Full Application/Payload/Medusa same-deployment isolation is not yet claimed.

## Preflight and selected contract

The accepted design makes `scope_id` the data-plane authority and derives it
from a trusted session or grant. A unique `fx_control_scope.deployment_id`
instead forced one scope per deployment. Removing that unique constraint alone
would let an unordered `LIMIT 1` route a request to an arbitrary shop. The
control catalog now keeps a nonunique deployment lookup index and the existing
scope identity and `(scope_id, deployment_id)` constraints. A deployment-only
lookup returns a scope only when exactly one exists; otherwise it raises an
explicit, non-retryable authority ambiguity error. Callers with a trusted `(deploymentId, scopeId)`
selection read the exact scope and verify its deployment, persisted placement,
provisioning receipt where required, and located clock.

This correction changes the internal catalog cardinality and the relational
host constructor contract. It does not authorize a scope ID from an untrusted
command input. A host owner must derive the ID from its authenticated session
or grant. Retaining deployment-only resolution for its named unmigrated
consumers is a fail-closed transition, not an alternate multi-scope route.

The nearest connected consumer is the trusted relational command host. It now
receives the exact scope from its owner and uses the shared resolver before
the transaction. The old host input shape is intentionally broken; test and
host callers supply their trusted scope. The migration drops only the obsolete
unique constraint and creates a nonunique deployment index; it neither rewrites
nor deletes existing scope rows. Existing one-scope deployments remain valid.

The Application data-snapshot resolver now requires a trusted deployment/scope
selection and reads that exact catalog row and clock. A deployment-only caller
must migrate to an authenticated session or grant selection; there is no
fallback to the first scope. Application query and relation-query snapshots
already receive a nominal active selection containing scope authority, so they
revalidate that exact scope instead of querying by deployment again. This
breaks the private snapshot context's authority-port type and the exported
data-snapshot resolver input. A two-scope catalog/clock witness verifies
independent tokens and wrong-deployment refusal. A connected Application query
opens from an already authenticated active selection after a second scope is
added to its deployment, on both storage drivers; deployment-only revalidation
would refuse that query. The existing relation-query system also exercises
the exact revalidation. These consumers
do not create the active selection, so activation/readiness remains the next
functional gate before same-deployment Application serving is possible.

## Alternatives and remaining gate

- Keeping one scope per deployment while storing many deployments in generic
  physical tables is viable for that hosting model, but it cannot prove two
  shops in one deployment. It does not satisfy the explicit isolation gate.
- Selecting the first catalog row after dropping uniqueness is unsafe because
  it can silently route authority to another shop.
- Copying scope checks into Medusa or Payload would duplicate core authority.

Move the remaining deployment-only runtime owners together with their real
caller-supplied authority: framework data binding and its readiness inputs,
Application readiness/activation and point mutation, followed by Medusa/Payload
commands. Their present deployment-only resolver must continue
to refuse ambiguity until migrated, and then be removed with its mock ports
and fixtures. The normal provisioning path also still creates or reuses one
scope per deployment; a multi-shop provisioning identity and idempotent
creation contract must be selected before claiming general hosting support.
Its bootstrap verifier reports a multi-scope deployment as blocked, including
`multipleScopeDeployments` in its in-process parity counts, rather than
promising that its deployment-only repair pass can fix a missing clock.
`deployments` now counts distinct deployments even when the joined inventory
contains several scope rows. This changes the report shape but no durable
format; its callers and tests must use the new count.
The final gate is a connected two-scope, same-deployment Application/Payload/
Medusa row and relationship proof, including colliding local IDs, wrong-scope
refusal, rollback/replay, and ordinary-role PostgreSQL concurrency. Bounded
multi-shop capacity remains a separate measurement gate.

The catalog and exact-resolution behavior require PGlite and ordinary-role
PostgreSQL migration/constraint witnesses. The relational host requires both
driver suites. Typecheck, lint, migration consistency and both read-only
reviews close this bounded core slice; they do not complete the final gate.
