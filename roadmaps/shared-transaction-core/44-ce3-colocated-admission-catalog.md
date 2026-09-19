# Colocated Admission Catalog Reads

Status: implemented colocated catalog reader correction. Scope-wide writer
serialization and complete-request reference/capacity gates remain open.

## Evidence And Decision

The complete CMS load witness exposes catalog acquisitions while the business
transaction owns its scope clock. An isolated warm eight-row insert performs
eight such acquisitions: five schema-binding/artifact reads, two unique-set
closure reads and one unique-declaration read. These are in prepared Application
binding acceptance, not the document validator or materializer. Preparation also
performs substantial SQL before the business transaction; this slice does not
claim to eliminate that work or all causes of the load refusals.

Reuse the accepting transaction for these reads when the registered located
target and control database are exactly the same database object. Retain schema
correlation, canonical artifact verification, closure/declaration checks and
target lifecycle protection. Separate control placement continues to use its
own catalog reader; do not route it through a target merely because table names
or server addresses match. The shared readiness/schema/lifecycle owners select
the reader, without a CMS adapter override or a new settlement authority.

For colocated snapshot reads, catalog evidence follows the transaction's
repeatable-read snapshot, just like its target evidence. Command reads remain
read committed. Separately placed catalog observations still do not constitute
an atomic cross-database snapshot. No new control write locks, extra transaction,
retry, admission limit or timeout changes are introduced.

## Contracts, Alternatives And Cleanup

The private lifecycle catalog validator must receive the accepting transaction;
update its existing caller and remove its unconditional pool acquisition. The
prepared active-read owner retains its already located target for exact database
selection. The schema resolver reuses its existing validation implementation
through a private transaction-aware entry point. No public API, schema, durable
format or data reset is required.

Moving catalog validation earlier would change the admission observation point;
skipping it would weaken integrity. Raising pool capacity or shortening retries
would leave nested acquisition intact. Neither is the selected correction.
Retain normal pre-transaction preparation and separately placed catalog reads
as live responsibilities, not compatibility paths. Remove transient SQL tracing
after preserving the regression witness and source attribution.

## Validation And Completion

Prove cold and warm full CMS requests, readback and replay with only one available
pool connection after fixture construction. The previous implementation must
fail the witness. Preserve exact durable effects and no replay callback execution.
Run shared PGlite correctness, ordinary-role PostgreSQL admission/concurrency
and separate-placement regressions, then repeat the unchanged load grid. Keep
refusals and all offered requests in the performance report; removing nested
acquisitions is not by itself a scalability or throughput claim.

Verify fresh catalog corruption rejection through prepared acceptance, exact
database composition and drained clients. Run affected typechecks, lint, both
project reviews and staged lint. Reconcile this status and the owning roadmap,
then commit the coherent implementation and cleanup.

The one-available-connection witness covers cold/warm writes, snapshot readback
and replay. Colocated binding/closure corruption must be rejected from the
accepting transaction, and separate-placement corruption must still be read
from the registered control database. These are correctness and progress gates;
they do not establish production capacity. Colocated snapshot semantics are
also source-derived from the selected repeatable-read transaction; a dedicated
concurrent catalog-update snapshot witness is not part of this slice.

The original unconditional catalog acquisitions are replaced in the prepared
admission path. Existing standalone resolution, lifecycle settlement and
pre-transaction preparation retain their own readers. No temporary compatibility
path or SQL-tracing code remains.

## Admission Deadline Witness

The overload check also exposes PostgreSQL statement deadline SQLSTATE `57014`
on the scope-clock acquisition, before command execution. The original baseline
accepted only lock deadline `55P03`; that assumed a unique deadline winner that
the server does not guarantee. The correctness witness therefore requires an
explicit `lockForOrdinaryWrite` scope-clock owner failure, only those two SQL
states across all typed failure reasons, no defect/interruption/uncertain outcome,
no callback execution and successful-only durable state before any explicit retry.
It does not accept arbitrary statement failures or turn refusals into successes.
The unchanged zero-refusal performance target remains separately recorded.
