# Immutable evidence reuse comparison

This frozen comparison includes complete-row entry acknowledgement, compiled
capture result mapping, authenticated original predecessor lending and bounded
implicit-capture transport admission. It follows the preserved
[prepared capture comparison](../prepared-storage-capture/README.md).

`pnpm perf:core --all --full --sql` retains twenty quiet requests after three
warmups per scenario, with a separate diagnostic request. All five business
results pass; complete numerical acceptance still fails.

| Scenario | Median ms | P95 ms | SQL commands | Transactions |
| --- | ---: | ---: | ---: | ---: |
| Payload create | 84.07 | 86.70 | 130 | 9 |
| Standalone Medusa workflow | 339.04 | 355.19 | 295 | 13 |
| Mixed Application + Product | 205.60 | 222.74 | 92 | 2 |
| Mixed + Payload | 236.21 | 255.88 | 95 | 2 |
| Mixed + Medusa workflow + Payload | 417.84 | 556.44 | 130 | 2 |

Product misses 100/200 ms median/P95; Product/Payload misses 200 ms median and
meets 400 ms P95; workflow meets 500/1,000 ms. Every sample and maximum remains
in the raw reports. The preceding Product tail spike remains unexplained;
this run cannot establish its cause or disappearance. Both standalone medians
also increased, so the difference cannot be assigned solely to these core edits.

The separate Product diagnostic records 21 entry commands with 27.23 ms of
summed SQL await, two Application commands with 17.62 ms, fourteen native Product
commands with 65.87 ms and 55 publication commands with 29.14 ms. Instrumented
entry/publication intervals are 91.12/78.20 ms. Their non-SQL-await remainder
is not exclusive CPU attribution. Entry metadata returns 39,147 decoded JSON
bytes, and two final write-closure observations return 76,868 bytes. Complete
entry construction and metadata acceptance are the next owning-core redesign;
the numerical gates remain unchanged.

Run `9b67463c-17be-41c7-8670-a69d4e280908` records base
`5c9152621a6d4c177be8c314fa336d525e92c585`, dirty source and 282720.58 ms
CLI time. The [runtime checkpoint](./runtime-source-checkpoint.json) records 201
owned file hashes and two deletions. It excludes benchmark raw artifacts. The
authored promotion manifest cleanup completed during startup and does not change
executing framework output; its SHA was
`14d21c19b4ef4c4bece6a90131d34acc0b6d0b7adc5bd05f86f139dc91689d55`.
No heavy tests or reviews ran concurrently. PostgreSQL statement tracking was
disabled; durability settings remained enabled. Only command receipt paths are
normalized for portability.

The [executing inventory](./executing-evidence.json) verifies all 1,396 promoted
outputs and eleven pinned native entries against the original. The authored
native runner's documented source difference remains unchanged from the preceding
candidate. This is bounded fingerprint evidence, not a dynamic loaded-module
trace. Matched native/scaling gates and hosted behavior remain separate.
