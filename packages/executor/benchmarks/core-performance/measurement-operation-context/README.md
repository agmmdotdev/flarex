# Operation-context measurement evidence

These are the unchanged reports from the 2026-10-06 operation-context continuation
of the SDK's existing small `mixed-product` graph. Each gzip restores the original
JSON bytes. The source directory was
`work/validation/measurement-operation-context-20261006/final/`. The preceding
[SDK reports](../measurement-sdk/README.md) remain immutable.

| Run | Lane | Artifacts | Recorded result |
| --- | --- | --- | --- |
| `fdce3a50-00f7-4b41-9154-7a76b81f00ac` | Ordinary-role PostgreSQL 18.3, database diagnostic | [JSON gzip](fdce3a50-00f7-4b41-9154-7a76b81f00ac.json.gz), [original report](fdce3a50-00f7-4b41-9154-7a76b81f00ac.md) | Complete execution and collection; acceptance `notEvaluated`. One warmup, one separate quiet calibration, one diagnostic. |
| `ea061f08-79ed-4d54-a9b3-1642d00e3f4c` | PGlite, timeline diagnostic | [JSON gzip](ea061f08-79ed-4d54-a9b3-1642d00e3f4c.json.gz), [original report](ea061f08-79ed-4d54-a9b3-1642d00e3f4c.md) | Complete execution and collection; acceptance `notEvaluated`. One separate quiet calibration and one diagnostic. |
| `503f3ecc-d5a7-4b0f-9d3e-46e148f26990` | Ordinary-role PostgreSQL, fresh native/Flarex quiet pair | [JSON gzip](503f3ecc-d5a7-4b0f-9d3e-46e148f26990.json.gz), [original report](503f3ecc-d5a7-4b0f-9d3e-46e148f26990.md) | Both complete calls and committed business results verified; acceptance `failed`. One pair without warmups. |

PostgreSQL retains 1,074 Effect spans, 40 SQL driver exchanges, 16 checkouts and
two transaction intervals. All 40 exchanges have an exact retained operation
parent; none is uncorrelated or linked only to the request root. PGlite retains
1,158 Effect spans. Both expose the actual Medusa relational operations and the
finite publication transaction body that were absent from the preceding report.
Each diagnostic reconciles its root with zero recorded accounting error, dropped
events, lost contexts or collector failures. Each run records stable sources
within that run and completed cleanup.

The SQL links establish initiating operations, including six exchanges whose
enclosing semantic owner remains unknown. Source frames and source-owner
candidates stay separate provenance. An exact link to a named operation does
not imply that every operation has a mapped owner or an explained cost.

| Enclosing owner | PostgreSQL driver exchanges |
| --- | ---: |
| Point-commit publication | 21 |
| Logical read capture | 10 |
| Application journal | 2 |
| Logical working set | 1 |
| Unmapped entry/located-read/authority operations | 6 |

The report retains each direct initiating operation before grouping by name and
nearest known owner. Its publication groups include index transitions, current
pages, materialization, binding projection, metadata and outcome statements.
Identical SQL under different operation IDs is not assigned through a source
stack or time overlap. Transaction lifetime remains separate; its BEGIN exchange
records its initiating operation.

The strict deepest-operation ledger remains conservative. The additional
operation-context ledger establishes enclosing owner responsibility by actual
ancestry. It retains unknown leaf identities and concurrent work. Different
known owners or known-plus-unresolved leaves remain ambiguous; concurrent leaves
with the same known owner can establish that owner's responsibility without
establishing exclusive execution. The supervisor's coordination lifetime stays
visible separately, and actual child work still competes in the context ledger.

| Diagnostic | Root ms | Strict attributed / ambiguous / unknown ms | Context attributed / ambiguous / unknown / observer ms |
| --- | ---: | --- | --- |
| PostgreSQL | 351.602 | 4.170 / 76.498 / 270.934 | 317.272 / 32.974 / 1.342 / 0.014 |
| PGlite | 479.293 | 4.588 / 109.005 / 365.700 | 416.868 / 60.999 / 1.416 / 0.011 |

PostgreSQL's enclosing context includes 102.505 ms in logical read capture and
95.174 ms in publication. These are diagnostic elapsed responsibility regions,
including waits and instrumentation, not CPU or quiet execution cost. The
unknown foreground leaf union remains 317.514 ms. Driver-await union is
127.379 ms, coordination lifetime union 314.322 ms, and concurrent foreground
leaf union 54.078 ms. These unions and ledgers overlap and must never be added.
No value proves the deeper cause of time inside an unmapped operation.

PGlite's timeline lane collects no database events; its zero database fields mean
unavailable observations. Neither diagnostic collects CPU, GC, server execution,
lock waits or transport. Platform clock precision is unknown. Observed collector
intervals cover only captured instrumentation work. Quiet and diagnostic requests
are separate; observer cost is never subtracted to invent quiet latency.

The single cold pair records native 35.603 ms, Flarex 448.667 ms and paired excess
413.063 ms. It proves fresh construction and comparison, not a distribution or
latency acceptance. Its sampling and added-latency gates fail. The reference
independently commits framework calls and uses an Application SQL surrogate; it
does not reproduce atomic mixed publication, OCC, revision history or durable
outcomes. Diagnostic and quiet artifacts have different source digests, stable
within each run. These observations establish measurement plumbing, not a
baseline/candidate latency improvement, production readiness or hosted scale.

## Integrity

Gzip restoration and Markdown copies were checked byte for byte. SHA-256 hashes
identify the restored original JSON, not the gzip envelope; sizes are bytes.

| Run | Original JSON | Gzip | Markdown | Original/restored JSON SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `fdce3a50-00f7-4b41-9154-7a76b81f00ac` | 15,140,629 | 715,561 | 9,076 | `d0d4d1fd2093b066d928144f327d8f162025fe30194930f90159d63126a38a2b` |
| `ea061f08-79ed-4d54-a9b3-1642d00e3f4c` | 12,360,603 | 490,538 | 7,282 | `66939ad1025ba3818f11a2cc3ce3c8d8226d8c12cfccb7cbddd3faf9e285623f` |
| `503f3ecc-d5a7-4b0f-9d3e-46e148f26990` | 6,009 | 1,257 | 2,228 | `660290998dc6f25c961b08a55f8ea3eb52a342dba47c1ddc36e8f5ea7f1b371a` |
