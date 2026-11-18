# Cumulative Request Budget Equivalence

Status: bounded cumulative read/insert witnesses implemented; complete-request
CE0 acceptance remains open.

## Outcome And Owners

Exercise the fixed first-insert and standalone point-read references at the
shared request byte boundary. Existing oversized-input/document witnesses do
not establish accounting for many individually valid documents. Use the actual
CMS host, independent references, admitted schema/indexes and bounded lifetime
on PGlite and ordinary-role PostgreSQL.

Use legal scalar titles containing JSON-escaped control characters. Their
canonical JSON representation is larger than their ordered-index representation;
this reaches the cumulative command budget while each document and index key
remains admissible. Prove that smaller requests succeed and larger requests
refuse with `limitExceeded`, with no durable effect from the refused request.
Include repeated and distinct read identities so omitted output charging or
incorrect cache charging changes the observed boundary.

The fixed fixture admits 23 distinct large documents and refuses 24; it admits
31 returned copies of one cached document and refuses 32. Each attempted read
executes once, performs the expected distinct point fetches, and publishes
nothing. Both complete result arrays fit the single-value command byte bound.
At 32 inserts the smaller titles succeed while the larger titles exhaust the
cumulative budget before materialization; the same larger title succeeds alone.
These are workload boundaries for this fixture, not general row-count limits.

## Design Challenge And Cutover

Do not reduce limits, bypass an index, inject an accounting result, or substitute
a synthetic lifetime for the real request. Keep codec and lifetime owners common
and disclosed. Tests compare integrated behavior; they cannot independently
certify the shared accounting implementation or establish an exact one-byte
boundary for every authority/configuration. Pin adjacent workload sizes where
practical and state that distinction explicitly.

No production API, schema, authority, lock, or persisted format changes. Keep
single-value limit witnesses and existing rollback/recovery coverage. Failed
mutations must leave no outcome and allow a corrected explicit request under
that unused key; successful requests retain cross-engine replay without another
callback. No compatibility path or runtime capability is introduced.

## Validation And Completion

Require exact successful results, full scoped inventory equality after refusal,
callback counts, cache-fetch counts and drained ordinary-role PostgreSQL pools.
Run focused tests in both database lanes, affected types/lint and both read-only
reviews. Remove temporary probes, reconcile roadmaps and commit. Complete CE0
equivalence, numerical performance targets and paired timing remain open.
