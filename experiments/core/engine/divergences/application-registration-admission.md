# Application registration admission

Status: **Necessary host extension implemented and reviewed for the bounded fresh
ordinary profile; wider activation gates remain.**

Owner: [whole-function executor cutover](../slices/17-executor-cutover.md).
Reference: Convex `db914cf06e2b06ee985646611b9e12ed7a770318`, schema
metadata and `SchemaModel` submit/validate/activate lifecycle.

## Pinned mechanism and required difference

Convex stores schema state and the raw schema in `_schemas`. Submitting a pending
schema creates its user tables before validation and activation. Keep that
ordering, index lifecycle, transaction observation and publication machinery.

The private Flarex executor must distinguish a retry of its interrupted fresh
registration from unrelated tables or an installation with the same schema but a
different source or program closure. Source's schema text alone cannot prove that
host admission. Rejecting every existing table would also reject a legitimate
retry after pending preparation has committed.

## Shared owner and representation

Extend the existing logical `_schemas` document with optional
`applicationRegistration` provenance. The shared Core captures a canonical frame
from the trusted deployment/scope/epoch, source and analyzer identities,
compatibility and generation settings, serialized schema and complete expected
program publication. Secret signing and cursor material is excluded. No physical
table, adapter journal, second installer or second settlement owner is added.

The schema preparation transaction checks fresh admission before creating user
tables. An identical pending or validated proposal may resume only with its exact
declared table closure and no unrelated data or programs. Activation rechecks
admission and publishes the matching program closure atomically. An identical
active retry may contain application data and returns the installed registration
without creating another publication. Plain schema/program administration cannot
omit or replace the reserved provenance to bypass these checks.

Catalog range observations, schema state dependencies and ordinary data reads
make concurrent foreign table, row or program creation conflict or refuse. The
configured executor consumes this Core capability; it does not reproduce the
admission algorithm with preflight table inspection.

Schema discovery always observes the table catalog and schema-state ranges,
including absence across namespaces. The complete program catalog is observed
when checking fresh/pending program absence, authenticating registered closure,
returning memoized active authentication or abandoning a candidate. Unregistered
discovery that does not consume program closure adds no whole-program dependency;
ordinary program publication retains its exact revision/head observations and
independent accepted saves. Full closure checks still include unexpected programs
and zero-table/zero-program registrations.

Profile reads return compact provenance and program identities. Full closure
authentication is reused through the existing immutable-registry validation
pattern within one open Core database. Reads still record catalog/schema
dependencies before a cache hit; registry replacement and cold reconstruction
revalidate. This avoids re-encoding every embedded manifest on each invocation
without caching live authority or returning mutable program metadata buffers.

## Preserved and changed guarantees

PostgreSQL remains the only durable authority. Schema/index readiness and
program publication use existing Core transactions. Untrusted invocation cannot
register or choose a persistence target. This bounded fresh profile refuses
unrelated existing data; it does not migrate or reset legacy deployments.

The extra provenance is an explicit host admission contract without a pinned
Convex equivalent. Ordinary unregistered Core and native schema behavior retain
their existing contracts. Runtime upgrade of a registered profile and migration
of existing deployment storage require their own conversion contract.

## Required witnesses and limits

Prove interrupted pending and validated preparation across reconstruction,
identical populated active retry, source/program mismatch, untagged lookalikes,
extra tables/data/programs, omission bypass and competing registrations through
the shared PGlite and ordinary-role PostgreSQL scenario runner. Prove actual
configured Worker/DO registration and lost-acknowledgement recovery through local
Workerd. Managed deployment, capacity and performance remain separate gates.
