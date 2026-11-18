# Selected Application evidence admission cost

The [traced smoke](./traced-smoke/manifest.json) retained 16/16 successful samples (one warmup, two warm and one cold per workload). The [full untraced series](./untraced/manifest.json) retained 104/104 (three warmups, 20 warm and three cold per workload). Both used the same four business graphs, fresh single-use Worker lifecycle where applicable, request boundaries, publication assertions and ordinary-role PostgreSQL environment. Each successful series contains its original report bytes, deterministic gzip of the raw record, sample CSV, exclusions and hashes. An [earlier setup attempt](./stopped-attempt.md) ended with `ENOSPC` before any sample and is separate from both successful series. The [prior admission-cost series](../admission-cost/README.md) remains untouched.

## Full request cost

Outer invocation wall times are milliseconds. The baseline and selected-evidence series were sequential untraced runs, so differences describe these runs rather than isolated causal speedups. Warm p95 is descriptive over 20 requests. Cold median uses three requests per workload.

| Workload | Baseline warm p50 | Selected warm p50 | Baseline warm p95 | Selected warm p95 | Baseline cold p50 | Selected cold p50 | Selected fresh Worker warm p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Product | 2,231.5 | 2,271.3 | 2,271.0 | 2,389.1 | 2,217.8 | 2,219.6 | 84.2 |
| Product + Payload | 3,094.7 | 3,303.2 | 3,171.4 | 3,455.7 | 3,090.4 | 3,324.3 | 83.1 |
| Mixed finite workflow | 6,761.4 | 6,698.6 | 7,356.4 | 7,002.4 | 6,947.2 | 6,841.6 | 84.9 |
| Standalone finite workflow | 344.6 | 338.2 | 388.4 | 370.9 | 345.1 | 340.3 | unavailable |

The selected-evidence package reduced measured SQL dispatches, but **did not deliver an overall endpoint gain** across the mixed workloads or meet the proposed warm 100 / 200 / 500 ms latency goals. Product and Product + Payload warm medians rose in this sequential comparison; the mixed workflow fell by 62.9 ms. Standalone fell by 6.4 ms and satisfies the preflight's less-than-10% warm p50 regression gate. Fresh Worker startup remains inside the same end-to-end interval; it was not subtracted to claim a lower endpoint cost.

## Traced structural check

The smoke has only two warm samples per workload and supports structural attribution, not a latency percentile. Its selected C/A/P bundle changed three statements to one after a distinct revision lock. Traced warm median dispatches and transaction intervals compare with the prior 104-sample [traced candidate](../admission-cost/traced/manifest.json):

| Workload | Prior dispatch / transaction | Selected dispatch / transaction | Dispatch reduction |
| --- | ---: | ---: | ---: |
| Product | 3,842 / 97 | 3,682 / 97 | 160 |
| Product + Payload | 5,707 / 136 | 5,463 / 136 | 244 |
| Mixed finite workflow | 10,410 / 235 | 9,958 / 235 | 452 |
| Standalone finite workflow | 480 / 6 | 470 / 6 | 10 |

The reductions match two removed selected-metadata statements per measured bundle (80 / 122 / 226 / 5). Independent head, activation, clock, history, publication and settlement proofs retain their owners. Revision-table touch counts change because the joined statement anchors to the locked revision; raw SQL templates and the owner tests distinguish this from a removed revision check. SQL dispatches, await times, transaction intervals and trace coverage are **unavailable** in the full untraced run, not zero.

## Correctness and limits

Both retained runs have zero failed samples or setup failures. The traced run reports zero unknown statements, query errors, unobserved or lost dispatches, and incomplete spans. The untraced run contains no trace objects. Retained inventory growth per warm request is unchanged: Product rows/indexes/commits/events/live journals `1/1/1/1/0`, Product + Payload `2/3/1/1/0`, mixed `7/36/1/7/0`, standalone `5/33/1/6/0`. Median sealed bytes are respectively `13,049 / 20,848 / 38,213 / unavailable`.

These runs use the private in-process Worker bridge and local PostgreSQL, not hosted Cloudflare transport. They do not establish native ORM parity or production capacity. The [low latency preflight](../../../../../roadmaps/mixed-mutation-core/06-low-latency-execution-preflight.md) and [selected-evidence preflight](../../../../../roadmaps/mixed-mutation-core/07-selected-evidence-admission-preflight.md) own the remaining decisions and integrity boundary.
