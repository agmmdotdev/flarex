# Strong-reference identity and reverse-index preparation

Status: implemented candidate and shared-definition correction. Cross-source
runtime admission remains closed until target liveness, deletion, traversal and
concurrency enforcement run through every affected writer.

## Trigger and owner

The accepted candidate allowed a `strongReference` to any pair of matching text
fields. A non-unique target such as `Product.handle` or an Application `title`
does not identify one durable record. The same type comparison also prevented a
Medusa text field from targeting a document `_id`. The shared definition builder
installed only producer-declared indexes, so a candidate could lack the complete
reverse access needed to restrict target deletion. These are shared candidate
and storage-definition defects, not Medusa or Payload adapter workarounds.

The protocol candidate now admits only a document `_id` or a relational
single-column text primary key as a strong-reference target. A typed document
ID source retains its declared target-table binding; an ordinary string or
relational text source may carry either target identity format. Runtime must
decode and verify the actual value before it can serve. The same candidate can
still contain independently owned Application, Payload and Medusa sources.
Source and target column names must be addressable as literal top-level ordered
index fields. A dotted relational column name would otherwise be interpreted
as a nested document path; incompatible decimal-formatted source indexes are
also refused at candidate admission.

The shared definition compiler derives one unconditional ordered reverse index
per source table and field when no producer index already supplies that leading
field. This reuses an existing complete path and avoids a duplicate write cost.
It allocates through the existing stable index catalog and build/readiness
owners, without generated framework tables or a second migration mechanism.
Primary target lookup uses the document identity or admitted relational primary
key; a later runtime slice must authenticate its concrete ready index or row
identity in the selected transaction.

## Contract break and cutover

This deliberately rejects previously admissible candidate metadata that named
a non-unique target field. The prior metadata had no serving token or runtime
data contract, so there is no supported row conversion or dual decoder. The
candidate composition witness now uses a Medusa-originating text field into an
Application `_id` as a structural example; it does not claim that the native
Product service writes such a field or that the relationship executes. The
actual native extension must use a supported Medusa model/fork seam before
runtime admission. Persisted development candidates using the old shape require
an explicit reset or re-admission decision; this slice performs no silent data
deletion.

## Connected proof and remaining gate

The real schema composer produces Application/Payload/Product definitions.
Candidate decoding refuses non-identity targets, and shared definition allocation
derives the missing Product reverse index on PGlite and ordinary-role PostgreSQL
without generated Product tables. This witness does not yet prove the derived
index build or serving readiness. A joint candidate with Application and Payload references into
Product still refuses affected runtime hosts while an unrelated Currency host
serves. This proves preparation and safe refusal, not relation execution.

The next connected slice must bind the authenticated extension set to the
selected runtime head and install a shared settlement check for source writes,
target delete/restore and races, including soft-delete and Payload draft policy.
It must preserve one publication owner and indexed forward/reverse traversal,
then replace common source-admission refusal only for completely enforced
profiles. Application OCC, Payload and Medusa writers must all be covered; a
composite-host-only check would leave ordinary writes able to violate the
relation. Add two-shop, pending read, concurrent insert/delete, rollback and
uncertain-COMMIT witnesses before calling the strong reference executable.
