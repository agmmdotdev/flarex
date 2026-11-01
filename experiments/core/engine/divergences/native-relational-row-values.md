# Native relational row values

Status: **Shared row/query semantics extracted and used by the selected Currency
runtime; broader native value profiles remain gated.** This records row semantics, not a second
persistence engine or general relational feature activation.

## Source mechanism

At Convex `db914cf06e2b06ee985646611b9e12ed7a770318`, documents, table validators
and ordinary indexes are the storage model. Source does not install Medusa DML,
apply native relational defaults or maintain Medusa exact/raw numeric pairs.
Keep the translated document, revision, index and acceptance owners. Native
rows remain documents in the same five physical tables.

## Necessary difference

The genuine Currency service supplies a checked relational source. Its declared
column types, required values, defaults, exact/raw agreement, managed timestamps
and soft-deletion fields are required native behavior. A Source object validator
alone does not express all of those rules. Adapter-only validation would permit
another admitted writer or corrupt stored row to bypass them.

Authenticate the producer's relational table and capabilities, then compile the
existing shared row-local semantics once. Core owns enforcement on admitted
native reads and writes; the adapter retains native coercion, BigNumber
conversion, DTOs and error presentation. Do not accept executable validators
from callers or duplicate the relational schema beside its authenticated source.

## Translation

Extract the SQL-free row-local owner from
`storage/documents/logicalDocuments/relationalRows.ts` into the persistence value
owner. Existing retained callers and the translated core must use that same
implementation. Keep canonical capture, failure provenance, validation order,
defaults, nullable omission and managed updates. SQL REAL conversion, serial
allocation, old catalog requirements, canonical legacy IDs and old index/unique
materialization stay with their existing owners until their own replacement.
Extraction must preserve their ownership checks rather than add public ways to
assert that a row was validated or converted.

Likewise, share the existing pure relational query compiler for its envelope,
predicates, selected access, ordering and projection metadata. Retained execution
keeps canonical/REAL validation and PostgreSQL predicate issuance; Core native
operations supply fully validated rows to the pure compiler. Do not import old
SQL/working-set authority merely to reuse its query grammar, or reproduce that
grammar in a Currency adapter.

For selected Currency, `decimal_digits` is `doublePrecision`; signed-int32 rules
apply only to declared integer columns. `rounding` remains an exact decimal and
must agree with `raw_rounding`. Raw precision 20 is the default, not the only
valid precision. Use one trusted root timestamp for native managed fields,
separate from Source `_creationTime`. Currency requires no decimal ordered index
in this slice. Unknown capabilities and unsupported column types fail closed.

## Proof and removal

Preserve current row-value/default/provenance witnesses while extracting. Prove
the actual Currency service, exact companions, corruption refusal and timestamp
behavior through the translated owner on PGlite and ordinary PostgreSQL before
cutover. Passing pure helper checks alone does not activate the new native path.
Retained SQL mechanics have named old consumers; the new Core path must not
import their transaction, catalog, ID or publication authority.

The [ordinary workflow/Tax continuation](../slices/17-native-atomic-workflows-and-tax.md)
now selects REAL representation for its complete admitted Tax consumer. Its
[dedicated value contract](./native-real-values.md) implements the selected portable
submitted/immediate/cold canonical-decimal boundaries, with its named native-parser
difference. Paired owner and complete admitted Tax proof do not activate serial allocation or general
native column types. Reuse this shared row-value owner rather than importing old
catalog, SQL transaction or publication authority into the translated Core.

The same native lifecycle owner preserves the authentic invocation's active
restore policy. Default Product restore leaves an already-active row unchanged;
admitted Tax inverse profiles can explicitly require a real update through
`allowActiveRestoreUpdate`. Forward that captured policy into the shared Core
patch/managed-timestamp owner, keeping original creation fields, final integrity,
activity, budgets and events. It is not a caller-set DAL option or an adapter
timestamp repair. Both default and selected behavior need neutral and genuine
consumer proof; unsupported option keys fail closed.
