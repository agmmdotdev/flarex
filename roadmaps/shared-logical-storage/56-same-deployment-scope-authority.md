# Same-deployment scope authority

Status: the control catalog permits multiple scopes under one deployment, its
deployment-only lookup refuses ambiguity, and the trusted relational command
host, Application snapshot/query readers, framework data-binding host,
Application readiness/activation, the selected point-mutation lifecycle,
managed-schema candidate validation/planning/application, and ordered-index
and unique-set builds, relation builds, and physical-definition lifecycle
subjects, plus the private three-source Currency announcement host and the
standalone and atomic commerce command hosts, and the CMS command host resolve
an exact scope. Some other binding/readiness inputs and framework command paths
still use deployment-only selection and therefore refuse a multi-scope deployment.
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
the exact revalidation. These snapshot consumers do not create the active
selection; the activation contract below supplies that selection.

The framework data-binding host now takes the trusted deployment/scope pair at
construction and resolves only that exact scope through the common authority
reader. Its private `deploymentId` input was replaced with `selection`; callers
and fixture inputs moved together. A two-shop binding witness reaches the
selected shop's missing binding head while a peer without provisioning fails
for that peer's receipt, on PGlite and ordinary-role PostgreSQL. This proves
selection before binding admission, not complete two-shop serving: other
data-plane entry points still depend on
deployment-only owners and fail closed until those owners migrate.

Application readiness, relation-readiness fold and both activation modes now
require a trusted scope ID alongside the deployment ID. They revalidate the
exact catalog row and located clock for settlement, replay and active reads.
The candidate-readiness, physical-definition readiness and non-empty unique-set
eligibility checks called from these flows also resolve their supplied scope
exactly. A second scope under
the deployment no longer makes an already-active Application unreadable;
PGlite and ordinary-role PostgreSQL cover both legacy and relation-aware
active selections, plus enabled unique-set eligibility with a peer scope.
This changes private readiness and activation inputs and
their test compositions; it does not turn a scope ID from application input
into authority.

Application mutation and action admission now revalidate the scope in their
claimed active selection. Point-mutation session activation, attempt load,
claim acquisition and renewal, attempt terminalization and discovery, journal
opening, stored-attempt and stored-commit evidence, and commit finishing,
rollback, publication and outcome recovery use the scope already pinned in
their trusted selection or stored authority. The exact catalog read still
checks deployment, placement, receipt where required, and clock. A selector
that combines one deployment with another deployment's scope fails as a
scope/deployment mismatch before entering the data target. The PGlite and
ordinary-role PostgreSQL finishing witnesses install a peer scope before
activation, journal opening/sealing and stored-evidence loading; the selected
scope then enters finishing. Separate two-scope witnesses cover activation and
scope-local discovery;
the old deployment-only lookup is deliberately ambiguous in those witnesses.
They are bounded lifecycle proofs, not full cross-framework serving or capacity.

Managed-schema planning selects the candidate publication's pinned scope and
compares it with the active selection. Candidate validation, index
reconciliation, ordered-index backfill, unique-set reconciliation/backfill and
workspace reclamation accept an explicit private scope ID and verify the exact
control-catalog row, placement and clock before target writes. The managed
apply owner passes its pinned plan scope through those steps. Catalog-only
definition and closure reads remain deployment-scoped; they do not select a
data-plane scope. PGlite and ordinary-role PostgreSQL witnesses add a peer
scope before candidate progression and index/unique builds, and the connected
managed-schema and Medusa Currency consumers exercise the migrated inputs.
This breaks private builder inputs and their fixture callers; it changes no
durable format.

Relation-build `advance`, `restart` and `readiness` now require the selected
scope alongside deployment and definition identity. Physical-definition
lifecycle subjects likewise carry the selected scope through preparation and
retirement. Both owners use the existing exact resolver against the control
catalog, placement, provisioning receipt and located clock before target work;
they no longer ask for one scope by deployment. The lifecycle request digest
still includes the resolved scope as before, so its stored request identity is
unchanged for an identical operation. PGlite and ordinary-role PostgreSQL
witnesses add a peer scope under the same deployment before building a relation
or preparing a physical-definition lifecycle subject; a peer without a located
clock is refused. Affected private input and fixture callers moved together.
Deployment-only selection remains for named runtime hosts and provisioning
paths; remove that resolver only after their callers receive exact authority.

The private Currency announcement host now receives a scope selected by its
trusted composition owner and resolves it through the control catalog before
preparing Application, Payload and logical Currency admissions. Each command
attempt and uncertain-outcome retry revalidates that same scope. Its PGlite
and ordinary-role PostgreSQL witnesses add an unprovisioned peer under the
same deployment: preparation refuses that peer for its missing provisioning
receipt, while the selected host commits and replays its three-source command
through one publication. A control-catalog read failure is a resource failure;
a resolved authority mismatch remains an invalid-authority failure. This
breaks only the private host input and its two
fixture callers; neither request data nor durable outcome format changes.
Standalone and atomic commerce hosts now require a scope selected by their
trusted composition owner. Logical preparation and each command attempt,
including recovery, resolve that exact control-catalog row and located clock.
The private host input breaks to require `scopeId` and an exact metadata reader;
existing host compositions and test fixtures move together. An unprovisioned
peer in the same deployment fails at preparation for its own missing receipt,
while the selected native Currency command and Category/Currency atomic command
commit and replay. PGlite and ordinary-role PostgreSQL cover that connected
consumer. This does not make an untrusted command argument a scope selector.
The CMS command host and Payload binding input now require the trusted selected
scope. Application-backed preparation rejects a scope that differs from its
prepared binding; preference preparation and logical-source preparation use
the shared exact resolver. Each read, write and uncertain-outcome retry resolves
that same scope before entering the target transaction. A catalog read outage
is a resource failure, while a scope mismatch is an authority refusal. The
private input break migrates Payload Local API composition and fixture callers;
request evidence and durable outcomes retain their existing scoped identity.
A PGlite and ordinary-role PostgreSQL Local API witness inserts an
unprovisioned peer under the same deployment, refuses its host, then creates,
reads and replays a selected-scope document through a newly bound Payload host.
This proves the selected CMS command path, not peer provisioning or complete
multi-shop Payload serving. Commit-event delivery retains its own exact-selection
cutover gate.

## Alternatives and remaining gate

- Keeping one scope per deployment while storing many deployments in generic
  physical tables is viable for that hosting model, but it cannot prove two
  shops in one deployment. It does not satisfy the explicit isolation gate.
- Selecting the first catalog row after dropping uniqueness is unsafe because
  it can silently route authority to another shop.
- Copying scope checks into Medusa or Payload would duplicate core authority.

Move the remaining deployment-only runtime owners together with their real
caller-supplied authority: binding's other readiness inputs, commit-event
delivery, and retained-history maintenance. Their present deployment-only
resolver must continue to refuse ambiguity until migrated, and then be removed
with its mock ports and fixtures.
The normal provisioning path also still creates or reuses one
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
