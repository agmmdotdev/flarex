# Exact Decimal Index Projections

Status: implemented private index capability under the shared-storage completion
goal. Calculated Pricing and commerce adoption remain subsequent connected work.

## Connected Outcome

Carry an authenticated exact-decimal projection from private logical index
declarations through analysis, immutable bindings, physical requirements, builds,
write maintenance and indexed reads over existing shared rows. Compare actual
range/order results with PostgreSQL numeric on representative Pricing amounts,
including precision beyond binary64, equivalent scales and exponent spellings.
This supplies the missing ordered-value contract needed by calculated Pricing;
it does not admit the full native calculation or replace commerce storage yet.

The pinned Pricing repository selects by price-set/currency, checks nullable
quantity limits, joins active/time-valid price lists, counts matching price and
list rules, then orders by list presence, rule specificity and exact amount.
Existing commerce creation preserves decimal strings and raw companions, but
shared indexes currently sort those strings lexically. A string index or binary64
conversion cannot fulfill that contract. Full rule/list execution follows this
projection through the remaining connected query and commerce cutover packages.

## Design And Owners

Logical ordered indexes may declare `decimalFields`, a distinct ordered subset
of their indexed field paths. The physical definition authenticates the decimal
projection at those paths; omission preserves the native Application value domain.
Projection is an index contract, not a new document value type or hidden stored
companion. Original decimal text/raw metadata remains in the authoritative row.

The protocol owner parses bounded finite decimal strings exactly and produces a
canonical sign/exponent/significand order key. Shared ordered bytes carry that key
inside the existing ordered-index codec; no global native float ordering changes.
Equivalent scales and exponents compare equally. Null and missing remain distinct
existing ordered values; a decimal projection does not define uniqueness policy.
Invalid values fail with a typed refusal. Input, significant-digit and exponent
limits are explicit, and the existing total encoded-key budget still applies.

The ordered key codec applies the authenticated projection itself. Its decoder
requires canonical projected bytes and returns canonical decimal text, so key
round trips remain exact without rewriting the authoritative row's spelling.
Callers cannot encode a native string key under a decimal physical definition.

The admitted profile accepts at most 2,040 ASCII text characters and 1,024
significant digits. The written exponent is between -16,383 and 131,071;
the written fractional scale must leave a coefficient power of at least -16,383,
and the normalized scientific magnitude may not exceed 131,071. Zero spellings
normalize to one key within those limits. This is a bounded finite-decimal subset,
not every PostgreSQL numeric input. Special values, whitespace and native numbers
are refused. The existing whole-tuple key budget can further limit compound keys.

Analysis and catalog owners preserve and verify every projection bit. The existing
build and materialization owners derive entries from authoritative documents;
query bounds use the same projection. Application indexed pending reads must use
the same keys. CMS/Payload ordinary query selection refuses decimal-projected
indexes until its query grammar explicitly admits that comparison domain.

The public SDK authoring API, legacy deployment/partition storage and declarative
semantic artifact emission explicitly refuse this private projection. Their
current native-value metadata cannot preserve it. Private canonical declarations,
analysis, joint candidate composition and authoritative schema publication retain
it. Managed schema comparison requires build/validation for a projection change;
an unchanged descriptor/field list cannot authorize metadata-only activation.

Those retained native-value surfaces still serve their existing callers. Their
projection refusal is removed only when their replacement or admitted format
preserves the same authenticated comparison contract; expanding public authoring
or legacy host capability is outside this slice.

## Replacement, Validation And Completion

Extend the existing logical/physical index contracts and their exact integrity
comparisons. Remove any touched reconstruction that drops projection metadata;
do not add a second decimal store, adapter SQL, per-shop DDL, duplicate build
engine, compatibility reader or generated numeric companion. Existing native
indexes retain their definitions and bytes. Changing an existing logical index's
projection requires a new authenticated physical definition/build and activation;
never reinterpret populated index entries or reset retained data silently.

Prove declaration capture/integrity, build over existing rows, shared write and
pending-read maintenance, exact equality/ranges/order, invalid-value refusal and
rollback, scope isolation and query-plan selectivity on PGlite and ordinary-role
PostgreSQL. Compare bounded decimal cases and generated pairs with PostgreSQL
numeric, including signs, zero, scales, exponents and precision boundaries.
Complete affected typechecks/lint, both required reviews, cleanup and one coherent
commit. Decimal indexes alone are not Pricing parity or a capacity claim.
