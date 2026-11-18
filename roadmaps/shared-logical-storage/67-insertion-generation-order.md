# Protected insertion-generation order

Status: implemented for the selected bounded profiles on PGlite and ordinary-role
PostgreSQL. Native ServiceZone update consumes this contract.
This does not change framework business behavior or public document values.

## Authority and required behavior

Native Geo relation hydration orders by physical insertion rather than text ID.
The existing logical relational read permits only declared scalar column order,
so old children inserted Z,A are presented A,Z. Preserve this failing boundary
until the neutral owner supplies authentic order; adapters cannot repair it with
history reads, cached row positions, guessed timestamps or synthetic DML fields.

Neither Application `_creationTime` nor existing publication change ordinals is
insertion-generation evidence. Working-set creation clocks are seeded separately
per participant; existing attempt and insertion counters are also participant-local. Interleaved sources
can therefore invert same-commit creation timestamps. Final row changes are
sorted by table/row identity, so publication ordinals do not retain insert order.
The retained first identity revision supplies its commit sequence but cannot
recover the same-commit tie or later physical reconstitution generation.

The shared row owner retains a protected pair: actual accepting commit sequence
and root-global insertion attempt ordinal. The pending ordinal comes from a new
protected common-root allocator, independent
of existing participant-local counters and call/source-local ordinal rebasing.
Genuine bounded lifetime projections share one issuer token; authenticated
finite-root evaluator aliases are bound before allocation. Independently used
namespaces cannot be merged. Final settlement alone
assigns its commit sequence. No participant, native callback or adapter receives
commit allocation or editable ordering metadata. Issuer-owned insertion evidence
binds the ordinal to its actual allocator namespace, scope, exact table, internal
document identity and canonical after digest. The closed graph has a separate
issuer-owned root binding; detachment retains both bindings by identity, so
transferring a foreign root handle and claim cannot relabel another graph.
The complete graph/root/scope binding is required even when it contains no
inserts or only unknown old generations. Removing every optional ordinal, proof
and generation from a copied issued graph must refuse, rather than downgrade
the command to an old unknown profile. Trusted CMS closure enrichment preserves
the original graph binding; lower storage read-dependency checks grant no graph
or publication authority. Final pending
generations must match the latest authentic insertion attempt for the row.

True insertion and physical reconstitution create a fresh generation. Repeated
ordinary updates, soft deletion and restore preserve the existing generation.
Reconstitution may reuse internal identity and Application creation time while
moving to the insertion tail. Insert then delete has no final live member;
unused ordinal gaps have no meaning. Pending fresh generations follow all
committed generations and compare by their actual common root ordinal.
Committed generations compare by scope-local commit sequence then ordinal.
Duplicate/ambiguous pairs refuse rather than falling back to ID ordering.

The pair belongs to authoritative row revisions so exact current and historical
snapshot versions retain their generation. It is separate from canonical
document bytes, Application `_creationTime`, framework created_at and public
projection fields. Existing row/index/unique/reference/fact/publication ownership
and the one outer settlement remain unchanged. Replay and uncertain-outcome
recovery reuse committed metadata; failure/rollback persists no new generation.

## Named read admission and evidence

The selected logical participant option is `allowStorageInsertionOrder?: true`,
bound into trusted preparation and identity/replay checks. Read syntax uses
`order: { kind: "storageInsertion", direction: "asc" | "desc" }`, distinct from
ordinary `{column,direction}` ordering. Omitted selection retains existing
profiles. The option grants neither hidden field projection nor unbounded reads.

Initial admission requires complete bounded indexed candidate coverage. Existing
FK/predicate membership, history candidates, residuals, byte/identity limits,
frontier OCC and row-use dependencies remain complete. Sort the authenticated
cohort before presentation/projection; never select an ID prefix then resort it.
Arbitrary insertion-order paging or an unindexed global scan is not admitted by
this correction. Snapshot and pending overlay semantics remain version-bound.

Ordered reads retain optional `orderedIdentities` in core-owned relational read
activity: the actual returned native primary-key tuples in presentation order.
This evidence authenticates the adapter's returned order without exposing the
storage pair or granting caller-authored receipts. Query, counts, complete
membership and ordinary observed-row evidence retain their existing meanings.

Fresh genuine atomic/cross-domain logical and finite-root inserts/reconstitutions
record intrinsic order regardless of read allowance. This allows a later
admitted ordered reader to consume rows created by these existing writers.
The independently durable nonfinite borrowed journal keeps its existing protocol
and does not retain this private generation evidence. New rows from that lane
remain unknown to ordered reads; enabling ordered selection there requires a
separate durable-owner proof and protocol disposition. The read capability is still explicitly selected;
recording hidden intrinsic evidence does not expand public query support.

## Durable migration boundary

Use an additive migration for the nullable protected revision pair, completeness/
range checks and required birth uniqueness. Existing rows with no authentic
evidence remain unknown. Existing profiles continue to read/write their data;
new ordered selections fail closed when any selected row generation is unknown.
Ordinary updates cannot invent a missing birth ordinal. No guessed backfill,
document rewrite, table reset or implicit populated-source upgrade is permitted.

Old-row readiness requires separately authenticated original insertion evidence
or an explicit approved migration/reset disposition. Retained identity roots,
wall timestamps and sorted publication facts are not general backfill evidence.
Fresh native private compositions can select the new capability without claiming
that populated framework installations acquired historical order.

History compaction preserves the generation on every retained revision and must
not make current order depend on retained commit feeds or native business events.
Version-bound metadata decoding and final revision verification detect malformed,
partial, future or ambiguous pairs. Application data and other profiles keep
their established contracts during the additive upgrade.

## Acceptance boundary

The bounded PGlite and ordinary-role PostgreSQL proofs establish neutral same-root and
interleaved-participant insertion order, cross-request/backward-clock order,
committed/pending/snapshot coherence, physical delete/reinsert and reconstitution,
ordinary lifecycle position retention, complete indexed FK coverage and real
concurrency conflicts. Cover unknown old rows, populated additive migration,
corruption/ties, cancellation, caught refusal/rollback-only, replay, revocation
and scope isolation. Application, Payload/CMS and Medusa read/write, publication,
history and lifecycle consumers retain their existing profiles. Native
ServiceZone preimage/output ordering has a separate connected consumer proof;
neutral support alone does not admit other workflow or query families.
