# Native REAL value representation

Status: **Selected portable value contract implemented with paired owner and
complete admitted Tax proof; broader native types/data conversion remain gated.**
Owner: [ordinary native workflows and Tax](../slices/17-native-atomic-workflows-and-tax.md).

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` stores and indexes
Float64 values through its ordinary value/ordered-key owners. Admitted native
Medusa Tax Rate declares SQL REAL. Its existing shared-logical path converts the
submitted decimal through PostgreSQL REAL with `extra_float_digits=1`, stores
the canonical decimal value, and retains native immediate-result behavior.
That native contract is not ordinary Source Float64 storage.

The owner selected portable exact decimal-to-binary32 rounding with ties-even
and no database conversion calls in
[Q12](../OPEN-QUESTIONS.md#q12---portable-real-rounding-or-exact-native-provider-parsing).
Translate this through the shared native relational value owner above Source
values, never through Tax-specific SQL or an independent storage family. Preserve
the executing contract for required/null values, finite range, nonzero underflow,
overflow, signed zero, exact submitted/immediate/cold boundaries and canonical
index/query comparisons. A portable equivalent requires paired oracle evidence;
`Math.fround` alone does not establish PostgreSQL's canonical JSON decimal.
No adapter transaction or compatibility fallback is authorized by this record.

PostgreSQL's [Ryu configuration](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/common/ryu_common.h#L36)
and [single-precision formatter](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/common/f2s.c#L224)
deliberately exclude exact midpoint output strings. An arbitrary decimal that
rounds back to the same binary32 is therefore not necessarily its canonical
native output. Preserve exact decimal-to-binary32 rounding separately from
strict-interior shortest-decimal formatting. At power-of-two boundaries, both
adjacent decimal candidates matter because the interval is asymmetric.

Required cases include `1.262177448353619e-29 -> 1.2621775e-29` and
`230198584 -> 230198590`; a longer roundtripping representation or a shorter
midpoint string does not satisfy the existing canonical native read contract.
The shared portable owner must match the native oracle rather than adapt the
Tax assertion. With proved portable conversion, the old SQL conversion's
`extra_float_digits` session-setting dependency is retired for this new profile;
retained SQL callers keep their existing setting and conversion checks.

Prove neutral conversion and ordering boundaries against PGlite and ordinary-role
PostgreSQL, then the genuine Tax Rate create/update/inverse and cold item-tax
consumers. Keep `16777217 -> 16777216`,
`1.0000000596046448 -> 1.0000001`, `1e-45` and under/overflow refusals.
Existing exact decimal, integer and frozen native profiles retain their contracts.
This record grants no general native type or populated-data conversion support.

The [Q12 provider-parsing decision](../OPEN-QUESTIONS.md#q12---portable-real-rounding-or-exact-native-provider-parsing)
selects portable semantics. Exact submitted `91001.53515625` yields canonical `91001.53`
under portable nearest-even/PGlite but `91001.54` on the checked Windows
PostgreSQL 18.3/MSVC parser, with distinct binary32 bits. Keep this witness and
require portable Core storage/readback on both drivers. A passing PGlite oracle
does not establish native input-parser parity on every provider. Keep the full
direct-decimal corpus with that explicit characterization, and independently
verify strict-shortest output from exact binary32 inputs plus actual Core
write/reopen/readback. Unknown formatting/storage differences fail; no hidden
input exclusion, platform guess or database conversion is the accepted normalizer.

The [shared REAL normalizer](../../../../packages/persistence-postgres/src/values/relationalReal.ts)
owns exact decimal rounding and strict-shortest formatting. The
[row-value owner](../../../../packages/persistence-postgres/src/values/relationalRows.ts)
keeps canonical stored values separate from authentic immediate presentations;
[native policy](../../../../packages/persistence-postgres/src/core/nativePolicy.ts)
validates cold values through that same contract. Retained SQL callers keep their
existing conversion path until their named migration; this adds no runtime fallback.
