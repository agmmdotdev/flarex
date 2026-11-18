# Finite Execution Metadata Scaling

Status: **structural matrix complete; latency acceptance incomplete.** The selected contract uses
the unchanged one-versus-one-hundred matrix for tables, indexes, relations and
definitions belonging to another source. Each trace run uses two alternating
hit/miss pairs without discarded warmups. Instrumented latency is diagnostic.

| Axis | Count | Warm hit metadata bytes | Warm miss metadata bytes | Preparation growth during either demand |
| --- | ---: | ---: | ---: | ---: |
| Tables | 1 | 7,806 | 7,815 | 0 |
| Tables | 100 | 7,818 | 7,817 | 0 |
| Indexes | 1 | 7,802 | 7,806 | 0 |
| Indexes | 100 | 7,813 | 7,817 | 0 |
| Relations | 1 | 7,820 | 7,815 | 0 |
| Relations | 100 | 7,820 | 7,826 | 0 |
| Other-source definitions | 1 | 7,832 | 7,826 | 0 |
| Other-source definitions | 100 | 7,828 | 7,827 | 0 |

All eight completed runs use four metadata submissions per warm demand. The table
axis increases complete entry preparation from 1,316,283 to 5,716,628 bytes;
the finite read does not hide that preparation cost. Setup, entry, final
retention and publication remain separately recorded in each report. Matched
native Product results and missing errors are checked by the executing fixture.

Before/after supplements verify all 1,396 promoted outputs and twelve native
entries against the original comparison inventory. The separately recorded
authored native runner change is the only native inventory difference.

`finite-scale-relations-1-failure.log` records refusal during genuine relational
foreign-key preparation, with `LogicalRelationalAdmissionError: invalidInput`.
No report or timing is accepted from that failed run. Its before/failed-after
supplements preserve the executing inventory. Corrected relation and other-source
runs use the separate `-02` labels; the original failure remains retained.

The failed synthetic foreign keys requested `onDelete: "restrict"`, which the
existing relational write owner rejects. Their fixture policy is corrected to
the supported `noAction` before retrying. This is a declared synthetic policy
change: relation counts, endpoints, columns, primary and reverse indexes, and
the pinned native Product definitions remain unchanged. It neither broadens
core support nor accepts measurements from the original failed run. Warm
preparation in the relation axis rises from about 1.54 MB to 2.44 MB; the
other-source axis rises from about 1.28 MB to 1.89 MB. Both retain zero growth
during demand. The first four reports precede this synthetic policy correction;
it affects only the relation branch, and all reports retain their source hashes.

The eight completed traces do not satisfy the fixed quiet 5/10 ms added-latency
limits, complete-request non-regression, or whole-goal milestones.
