# Separate row-check and relation-factory CPU trials

No client CPU reduction is established by either trial. The row-check shortcut
was removed after its regression; only the relation-helper definition hoist is
retained. Every original row-integrity comparison remains in production.

## Measured result

The complete small mixed workflow ran 30 alternating native/Flarex measured
pairs per variant, split between two independent processes with five warmups per
lane in each process. The block order was baseline, row checks, relation helpers,
both, both, relation helpers, row checks, baseline. All 120 pairs completed the
business workflow and verification; all source, durable-setting and cleanup
gates passed.

Added CPU means Flarex endpoint thread CPU minus its matched native endpoint
thread CPU. These are CPU counter measurements, not PostgreSQL wait durations
or profile sample spacing.

| Executed variant | Median added CPU | Mean added CPU | Mean change from baseline | Runtime disposition |
| --- | ---: | ---: | ---: | --- |
| Original implementations | 110 ms | 108.8 ms | Reference | Control |
| Row-check shortcut only | 125 ms | 130.4 ms | **+21.6 ms** | Removed |
| Relation helper definitions only | 109 ms | 111.9 ms | +3.1 ms | Retained as definition reuse; no CPU saving claimed |
| Both candidates | 125 ms | 122.9 ms | +14.1 ms | Removed with the row shortcut |

Positive changes mean more CPU. Exploratory 95% request-resampling intervals for
the mean changes are +5.0 to +39.2 ms for row checks, -12.7 to +19.3 ms for the
relation hoist, and -2.8 to +30.5 ms for both. These describe this campaign;
process/block dependence and coarse Windows counters prevent treating them as
a guarantee across campaigns.

The row candidate was slower in both aligned rounds: +27.5 and +15.7 ms mean
added CPU. The relation hoist's mean difference was +3.1 ms in each aligned
round. Its Flarex endpoint CPU itself was essentially unchanged: 139.5 ms mean
versus the control's 139.1 ms, and 141 ms median in both. The 1 ms difference in
paired medians is not a demonstrated saving.

The earlier 125 ms figure remains a historical smaller-cohort observation. The
fresh original-implementation control is 110 ms median / 108.8 ms mean. This
baseline difference cannot be credited to these candidates: the control used
neither candidate. The historical 172 ms pricing wait remains unresolved and
is not a client CPU measurement.

## Correctness and final code

The rejected candidate omitted a second comparison only inside a synchronous
row operation. Review exposed two accepting-frontier hazards: overridable
buffer `byteLength` getters and mutable decoder-carrier getters. Both were
reproduced or represented by genuine-owner regressions, and corrected before
the CPU campaign. The corrected candidate inspected descriptors without calling
carrier getters and excluded Proxy/foreign buffer reads before taking its
continuation. It preserved the original comparisons for callback-bearing paths.
That safe candidate nevertheless regressed in the complete workflow. No profile
was collected to attribute the regression to an individual guard operation.

Production `relationalRows.ts` was restored byte-for-byte to the saved original
implementation. The new 15 regression cases remain: each also passes on that
original implementation. They cover later-call byte/digest mutation, actual
detachment, bounds/authority failure priority, full foreign-row validation,
getter defects, own/inherited one-shot buffer getters, mutable stored-carrier
getters and zero later Proxy/getter calls after prior corruption.

The retained Medusa change hoists only the two named `Effect.fn` definitions.
Context, filters and fetched-row cache are still created inside each population
invocation. Sequential reads, relation grouping, soft-delete handling, empty
pages, error ordering, tracing and cancellation retain their original owners.

Both database lanes, affected typechecks, source/runtime guards, core/diff and
exact-index lint, and both read-only project reviews are required. Final
receipts and cleanup are recorded in `summary.json`.

An initial PostgreSQL fixture `CREATE TABLE` hit its unchanged 30-second
statement timeout before the changed code. Its SQL57014 log is retained; isolated
and later connected runs passed, which does not establish the intermittent
failure's cause. The TypeScript 7 compiler also exhausted memory in an unbounded
run; the same no-emit checks passed with one checker and single-threaded execution.
Neither failure was hidden by loosening runtime limits or assertions. No compiler
or test runs overlapped the CPU campaign.

## Provenance and limits

The campaign used the current checkout at HEAD
`79752777da524351a84aada17f101cd340c895cb`. Existing unrelated OCC, session and
fixture source edits were held fixed by the campaign's source checks. Unrelated
documentation edits also remain outside this commit.
No new worktree was created. This compares the two candidates against that
shared checkout's original implementations; it is not a clean-HEAD OCC comparison.

The SDK source inventory contained 6,962 files, with the same before/after
digest in all eight processes:
`a5957c92f21b380699f091676379d433fc3d4cb1956dbee070515276288cf352`.
Test-only source selection retained the normal module paths and singular
issuers/imports. Separate module-load hashes prove which original/candidate bytes
actually executed; the SDK disk inventory alone cannot prove a selected variant.
The two module-load assignments ran outside request windows. There were no CPU
profiles, phase observers, server samplers or SQL-duration logs in this campaign.

Original row SHA-256:
`47c9a04ace2724d39e3c9714cf8b1c7422307bec3ff665af4c06dd0689d47dfc`.
Rejected row SHA-256:
`75ccc379f6173b216129679375436d5c0b4efbe215e893c3923d2492b4c57ffc`.
Original relation SHA-256:
`5bf35f142597d0cc77bded7ba9e3588ac80a06ded314998ebd35d42d1a8c1efd`.
Retained relation SHA-256:
`7cc68e2f7e75682ca12a03237f9a1fef890fb4c466f0503ac1065f0ce532c0eb`.

Raw reports, run IDs, all 120 CPU pairs, per-block statistics, source/settings
proofs and variant hashes are retained in `summary.json` and local block
directories. Original/candidate snapshots and the replay harness remain local
diagnostic artifacts; replay now selects frozen snapshots so the rejected
candidate cannot silently become the restored production source. The retained
production source bytes match the two relation-only blocks.

PostgreSQL 18.3 used port56434 and the existing owned investigation data
directory. Runtime requests used ordinary roles; provisioning used the separate
fixture provisioner. `fsync`, `full_page_writes` and `synchronous_commit` remained
enabled. This is a local Node worker CPU comparison for one complete graph, not
Cloudflare deployment evidence, all-five-graph acceptance, or a solution to the
remaining native-relative CPU excess. The existing 16 ms CPU and 5/10 ms quiet
median/P95 gates remain open.
