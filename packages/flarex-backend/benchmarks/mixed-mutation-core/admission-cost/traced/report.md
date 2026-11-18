# Private mixed mutation performance baseline

Revision: `277ced644780a6980dd3f986c032e4985a9d163a`; working diff SHA-256: `316714f8647405cfb666ca54c02cbcc559b96dbdc72174725492273344f098e0`; mode: **full**.
Plan: 3 warmups, 20 measured warm samples, 3 cold samples per workload.

The request interval starts before fresh admission and ends after authoritative publication and retained-outcome resolution. The outer wall envelope includes trace finalization, which is reported separately. SQL awaited time includes driver and database wait; it is not server execution time. Nested phases and overlapping query waits are non-additive. The standalone graph has fewer root obligations, so its latency delta does not isolate framework overhead. No native ORM parity or hosted transport claim is made.

## Environment

```json
{
  "postgres": {
    "serverVersion": "18.3",
    "fsync": "on",
    "synchronousCommit": "on",
    "fullPageWrites": "on",
    "sharedBuffers": "128MB",
    "role": "flarex_workflow_test",
    "superuser": false
  },
  "node": "v24.16.0",
  "pgDriver": "8.22.0",
  "platform": "win32",
  "architecture": "x64",
  "cpu": "AMD Ryzen 7 5700G with Radeon Graphics         ",
  "logicalCpus": 16,
  "totalMemoryBytes": 16422113280,
  "targetPoolMax": 10,
  "transport": "pg TCP socket; private Worker bridge is in-process test harness",
  "sourceHashes": {
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "9eaca2b299945a434c7cc7db201989c5698804e4b7c00181d397d1cd5375e784",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "299b0b9a2b87610c1837bfea19b5c00c74b5fa1930659d3c852440fb4fd84887",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "2a580cb7015a0faf38b2669ad7cc031ad9656597eef7ca0dc1fb35166a40a642",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/persistence-postgres/src/appRows.ts": "ca7a2a67f70e587da10b5a796bfdde20f84bcb0cd7dc4e0bc22e27bcbac6ad0e",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "27cbb62d616c3c6a9413bab17903a3975da1edc7821f911a27048bd541676fd5",
    "packages/persistence-postgres/src/indexBuildStates.ts": "717297da4b03f890c18698bb488a4a21f5f90fb1ca286c46b16dbc214e68a299",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "8872e57cdfa37474c5a710e4eb58a1cc23f796ad73031ba3e40ad9530a051d52",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "c30e410ac6d28fdbc4c35e2387d0ff544c5edf5c7449f1ee788fcedb678e9934",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "d93c09c2faa661749de858679fdb1261441bcbcfcf4ec92f7b65ff68b60f9958",
    "packages/persistence-postgres/test/mixedMutationPerformanceTrace.ts": "a633ba98dfcc3c0b786a0b95e269510bc2ca2f54903c1e3812ba89445f522476"
  },
  "profileSelections": {
    "product": {
      "revisions": {
        "product": "3dff443d184f6a88bd7aac846aeb266b85d8bd63e78f1d94b1ae335ad2e7c99a"
      },
      "workerLifecycle": "fresh single-use Worker per request"
    },
    "productPayload": {
      "revisions": {
        "product": "3dff443d184f6a88bd7aac846aeb266b85d8bd63e78f1d94b1ae335ad2e7c99a",
        "payload": "eaf05dafbae93c965ecb31d1117f9f4711eaad1b36cc6552746a06c190ec1fd5"
      },
      "workerLifecycle": "fresh single-use Worker per request"
    },
    "mixedWorkflow": {
      "revisions": {
        "product": "3dff443d184f6a88bd7aac846aeb266b85d8bd63e78f1d94b1ae335ad2e7c99a",
        "payload": "eaf05dafbae93c965ecb31d1117f9f4711eaad1b36cc6552746a06c190ec1fd5",
        "workflow": "7d1042151826a402a133cfd4cd874caf936297c8c54a9647d4ea1e56e12b19a2"
      },
      "workerLifecycle": "fresh single-use Worker per request"
    },
    "standaloneWorkflow": {
      "revision": "1a96a482575bf54c470730539a926e067ecb1dd24ee853adf63ef33f85aa3241",
      "resourceCalls": 128
    }
  }
}
```

## Sample distributions

| Workload | Series | Successful / observed | Request median (ms) | Range (ms) | Descriptive p95 (ms) | Fresh Worker startup median (ms) | Trace finalization median (ms) | Dispatch median | Known statement median | Awaited DB median (ms) | DB wait interval union median (ms) |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | warm | 20/20 | 2337.0 | 2213.6–2480.1 | 2463.9 | 85.3 | 4.5 | 3842.0 | 3842.0 | 1013.7 | 1013.7 |
| product | cold | 3/3 | 2244.5 | 2201.5–2294.9 | unavailable | 89.4 | 4.1 | 3846.0 | 3846.0 | 964.9 | 964.9 |
| productPayload | warm | 20/20 | 3209.6 | 3152.0–3317.0 | 3308.7 | 84.9 | 6.7 | 5707.0 | 5707.0 | 1411.9 | 1411.9 |
| productPayload | cold | 3/3 | 3391.1 | 3206.2–3427.5 | unavailable | 88.0 | 6.6 | 5714.0 | 5714.0 | 1489.5 | 1489.5 |
| mixedWorkflow | warm | 20/20 | 6754.8 | 6530.8–9226.6 | 7061.3 | 92.0 | 12.6 | 10410.0 | 10410.0 | 2889.2 | 2889.2 |
| mixedWorkflow | cold | 3/3 | 7147.8 | 7072.1–7172.1 | unavailable | 89.4 | 12.5 | 10414.0 | 10414.0 | 3050.8 | 3050.8 |
| standaloneWorkflow | warm | 20/20 | 332.4 | 317.2–382.7 | 352.3 | unavailable | 0.5 | 480.0 | 480.0 | 133.5 | 133.5 |
| standaloneWorkflow | cold | 3/3 | 327.1 | 326.2–341.7 | unavailable | unavailable | 0.5 | 480.0 | 480.0 | 129.2 | 129.2 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 10940.5 | 1069.9 | 2398.7 | 52225.7 | unavailable | 66635.5 |
| product | product-cold-0-0 | 10657.3 | 1059.6 | 2471.0 | 0.0 | unavailable | 14188.0 |
| product | product-cold-1-0 | 10363.5 | 1012.2 | 2286.4 | 0.0 | unavailable | 13662.2 |
| product | product-cold-2-0 | 10274.7 | 1033.4 | 2426.2 | 0.0 | unavailable | 13734.5 |
| productPayload | productPayload-warm-0-0 | 10953.3 | 1322.6 | 2309.1 | 51306.4 | unavailable | 65891.6 |
| productPayload | productPayload-cold-0-0 | 10584.5 | 1320.8 | 2365.6 | 0.0 | unavailable | 14271.1 |
| productPayload | productPayload-cold-1-0 | 10685.8 | 1352.5 | 2386.0 | 0.0 | unavailable | 14424.4 |
| productPayload | productPayload-cold-2-0 | 10443.0 | 1380.0 | 2438.0 | 0.0 | unavailable | 14261.0 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 14519.4 | 5070.5 | 3197.0 | 0.0 | unavailable | 22787.0 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 14919.1 | 4891.9 | 3268.0 | 0.0 | unavailable | 23079.2 |
| mixedWorkflow | mixedWorkflow-cold-1-0 | 14632.3 | 4872.8 | 3141.1 | 0.0 | unavailable | 22646.3 |
| mixedWorkflow | mixedWorkflow-cold-2-0 | 14694.7 | 4855.0 | 3164.8 | 0.0 | unavailable | 22714.6 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 16667.6 | unavailable | unavailable | unavailable | 1849.7 | 18517.6 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 16245.7 | unavailable | unavailable | unavailable | 1785.6 | 18031.5 |
| standaloneWorkflow | standaloneWorkflow-cold-1-0 | 16069.2 | unavailable | unavailable | unavailable | 1689.1 | 17758.3 |
| standaloneWorkflow | standaloneWorkflow-cold-2-0 | 16035.6 | unavailable | unavailable | unavailable | 1763.5 | 17799.1 |

## Retained state growth per successful warm request

| Workload | Rows Δ median | Index entries Δ median | Commits Δ median | Events Δ median | Live journal rows Δ median | Sealed attempt bytes median | Live journal bytes Δ median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 13049.0 | 0.0 |
| productPayload | 2.0 | 3.0 | 1.0 | 1.0 | 0.0 | 20848.0 | 0.0 |
| mixedWorkflow | 7.0 | 36.0 | 1.0 | 7.0 | 0.0 | 38213.0 | 0.0 |
| standaloneWorkflow | 5.0 | 33.0 | 1.0 | 6.0 | 0.0 | unavailable | unavailable |

## Observed database transaction intervals in successful warm requests

These BEGIN-to-settlement intervals include application work and waits; they are not lock-hold measurements.

| Workload | Pool | Phase | Outcome | Intervals | Duration total (ms) | Range (ms) |
| --- | --- | --- | --- | ---: | ---: | --- |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 2080 | 59669.4 | 23.5–359.3 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 1040 | 27936.7 | 23.8–109.9 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 1040 | 25707.2 | 21.2–43.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 1040 | 24388.4 | 20.9–34.5 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 320 | 8736.7 | 24.2–40.6 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 40 | 8009.8 | 1.0–464.5 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 220 | 7568.9 | 23.9–1553.4 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 320 | 7332.4 | 20.9–27.9 |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 100 | 6437.7 | 0.8–349.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 220 | 5975.0 | 24.1–93.3 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 200 | 5516.9 | 23.9–52.3 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 220 | 5500.5 | 21.2–52.9 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 220 | 5473.5 | 21.3–36.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 220 | 5162.0 | 21.0–93.7 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 220 | 5047.2 | 21.0–27.7 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 220 | 5038.0 | 20.9–28.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 200 | 4636.2 | 21.1–30.2 |
| productPayload | target | invocation / authoritative publication | commit | 40 | 4251.2 | 0.9–234.1 |
| mixedWorkflow | target | invocation / request admission | commit | 360 | 3755.3 | 0.8–115.5 |
| product | target | invocation / authoritative publication | commit | 40 | 2521.7 | 1.0–140.6 |
| productPayload | target | invocation / request admission | commit | 240 | 1784.5 | 0.9–40.8 |
| product | target | invocation / request admission | commit | 200 | 1231.4 | 0.9–27.7 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 140 | 681.5 | 2.4–14.6 |
| product | target | invocation / journal seal and OCC verification | commit | 140 | 680.8 | 2.2–15.2 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 140 | 652.3 | 2.3–13.9 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 295.5 | 5.9–15.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 287.2 | 6.1–10.7 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 266.5 | 5.9–8.1 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 20 | 83.6 | 3.2–5.3 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 20 | 73.3 | 3.1–4.4 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 20 | 69.5 | 3.1–3.9 |
| product | control | invocation / request admission | commit | 20 | 18.0 | 0.6–3.2 |
| productPayload | control | invocation / request admission | commit | 20 | 16.0 | 0.6–2.0 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 20 | 14.6 | 0.7–0.9 |
| mixedWorkflow | control | invocation / request admission | commit | 20 | 14.5 | 0.7–0.9 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 95140 | 95140 | 0 | 27227.6 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 45840 | 45840 | 0 | 12566.8 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 45960 | 45960 | 0 | 12052.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 45960 | 45960 | 0 | 11391.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 9760 | 9760 | 0 | 4294.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 14240 | 14240 | 0 | 3935.2 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 12520 | 12520 | 0 | 3682.9 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 14240 | 14240 | 0 | 3452.6 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 9740 | 9740 | 0 | 2739.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 9740 | 9740 | 0 | 2593.5 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 9740 | 9740 | 0 | 2579.3 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 8920 | 8920 | 0 | 2518.4 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 9760 | 9760 | 0 | 2475.4 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 9740 | 9740 | 0 | 2376.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 9740 | 9740 | 0 | 2366.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 8920 | 8920 | 0 | 2189.9 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6420 | 6420 | 0 | 2018.4 |
| productPayload | unattributed | target | invocation / authoritative publication | 7400 | 7400 | 0 | 1999.2 |
| mixedWorkflow | unattributed | target | invocation / request admission | 7380 | 7380 | 0 | 1985.7 |
| product | unattributed | target | invocation / authoritative publication | 4360 | 4360 | 0 | 1229.8 |
| productPayload | unattributed | target | invocation / request admission | 4080 | 4080 | 0 | 961.8 |
| product | unattributed | target | invocation / request admission | 2980 | 2980 | 0 | 682.9 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 2760 | 2760 | 0 | 594.6 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 1500 | 1500 | 0 | 484.1 |
| product | unattributed | target | invocation / journal seal and OCC verification | 1500 | 1500 | 0 | 483.4 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 1500 | 1500 | 0 | 467.6 |
| mixedWorkflow | unattributed | control | invocation / request admission | 780 | 780 | 0 | 182.6 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 680 | 680 | 0 | 181.2 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 680 | 680 | 0 | 173.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 680 | 680 | 0 | 164.0 |
| productPayload | unattributed | control | invocation / request admission | 660 | 660 | 0 | 147.5 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 620 | 620 | 0 | 144.0 |
| product | unattributed | control | invocation / request admission | 620 | 620 | 0 | 142.3 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 380 | 380 | 0 | 106.4 |
| product | unattributed | control | invocation / journal seal and OCC verification | 380 | 380 | 0 | 103.2 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 380 | 380 | 0 | 97.6 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 420 | 420 | 0 | 91.2 |
| productPayload | unattributed | control | invocation / authoritative publication | 380 | 380 | 0 | 83.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 260 | 260 | 0 | 78.6 |
| product | unattributed | control | invocation / authoritative publication | 340 | 340 | 0 | 78.1 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 260 | 260 | 0 | 70.7 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 260 | 260 | 0 | 67.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 80 | 80 | 0 | 20.9 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 19.5 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 80 | 80 | 0 | 19.4 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 19.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 17.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 16.5 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 14.2 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 13.5 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 40 | 40 | 0 | 13.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 40 | 40 | 0 | 13.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 13.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 40 | 40 | 0 | 11.9 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 40 | 40 | 0 | 10.8 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 40 | 40 | 0 | 10.5 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 40 | 40 | 0 | 10.5 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 40 | 40 | 0 | 10.4 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 40 | 40 | 0 | 10.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 40 | 40 | 0 | 10.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 40 | 40 | 0 | 9.9 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 40 | 40 | 0 | 9.7 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 40 | 40 | 0 | 9.6 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 40 | 40 | 0 | 9.6 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 9.5 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 8.1 |
| product | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 8.0 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 4.8 |
| product | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 4.1 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 895.5 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `f23e4a40858f630ac0a88d3447e83558dcdd166cf2adbb1d7e966b60dbcffd18` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2080 | 2080 | 0 | 744.3 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 3120 | 3120 | 0 | 733.9 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| product | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 3120 | 3120 | 0 | 659.3 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| product | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2080 | 2080 | 0 | 606.3 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| product | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 545.8 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 445.7 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| product | `8f8deefac9b885262555f822734015b70f5c706b1b209810a792d700f9c6cab2` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2080 | 2080 | 0 | 440.9 | select "scope_id" , "revision_id" , "deployment_id" , "application_schema_sha256" , "schema_version_id" , "schema_versio |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 436.7 | commit |
| product | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 412.3 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| product | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2080 | 2080 | 0 | 403.0 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| product | `959bcc422a7e86e91547288ce37a0dc6c5d46f47e21e537ebde19f0458419633` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 390.5 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 802.3 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `37ec6699690bff38b8b9608ac340be2a6598bf79c403f771dc997c352de69188` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2080 | 2080 | 0 | 726.0 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 3120 | 3120 | 0 | 688.9 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| productPayload | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 3120 | 3120 | 0 | 624.3 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| productPayload | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2080 | 2080 | 0 | 578.3 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| productPayload | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 537.7 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `8f8deefac9b885262555f822734015b70f5c706b1b209810a792d700f9c6cab2` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2080 | 2080 | 0 | 434.1 | select "scope_id" , "revision_id" , "deployment_id" , "application_schema_sha256" , "schema_version_id" , "schema_versio |
| productPayload | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 426.5 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| productPayload | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2080 | 2080 | 0 | 388.5 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| productPayload | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 384.9 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 348.0 | commit |
| productPayload | `959bcc422a7e86e91547288ce37a0dc6c5d46f47e21e537ebde19f0458419633` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 342.0 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 2200 | 2200 | 0 | 2842.2 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 2080 | 2080 | 0 | 1641.9 | commit |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 220 | 220 | 0 | 1640.6 | commit |
| mixedWorkflow | `b11de4b495c2cb7d6b2c57f9216ebd0fbf1e4649a64fcc86522b2d707f04276c` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4400 | 4400 | 0 | 1541.1 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 6600 | 6600 | 0 | 1495.5 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| mixedWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 6600 | 6600 | 0 | 1461.1 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| mixedWorkflow | `57dba99ebb6cdf0a6b4efc3bdb5c981a8b1cd077b268feeecc23e19b0157f3e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 2200 | 2200 | 0 | 1402.0 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1040 | 1040 | 0 | 1330.1 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4400 | 4400 | 0 | 1302.3 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| mixedWorkflow | `4ec3c032b8c2daed1aa86b3e2b64bf0b64d4fd86eb7a646e2016ad5a039ede66` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 2200 | 2200 | 0 | 981.9 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| mixedWorkflow | `8f8deefac9b885262555f822734015b70f5c706b1b209810a792d700f9c6cab2` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4400 | 4400 | 0 | 902.7 | select "scope_id" , "revision_id" , "deployment_id" , "application_schema_sha256" , "schema_version_id" , "schema_versio |
| mixedWorkflow | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4400 | 4400 | 0 | 884.1 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 480 | 480 | 0 | 261.7 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `75536164c67dda9cd26c18f1c366f100cb8ee42931e66ff77c5bd73b8db259cc` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 740 | 740 | 0 | 193.0 | update "fx_system_index_build_state" set "covered_through_commit_seq" = $? , "updated_at" = clock_timestamp ( ) where (  |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 360 | 360 | 0 | 176.1 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 1000 | 1000 | 0 | 157.8 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 320 | 320 | 0 | 95.0 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 60 | 60 | 0 | 86.2 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 480 | 480 | 0 | 86.1 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 400 | 400 | 0 | 78.5 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 300 | 300 | 0 | 69.4 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| standaloneWorkflow | `8ea8d5b22b1f7e46a005e45d34baf72202467700759672f98df650a96caa836e` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 260 | 260 | 0 | 68.7 | update "fx_system_unique_constraint_build" set "covered_through_commit_seq" = $? , "updated_at" = clock_timestamp ( ) wh |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 200 | 200 | 0 | 54.5 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| standaloneWorkflow | `cc0f21be214e751eeb7da0d5a545fcb89eaa64ea8b202a74d1721fd4899c4696` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 60 | 60 | 0 | 46.6 | with "capture_clock" as ( select "last_commit_seq" , "epoch" from "fx_system_scope_clock" where "fx_system_scope_clock"  |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 2337.0 | 0.6 |
| product | invocation / Worker execution | 2035.7 | 0.9 |
| product | invocation / Worker execution / Worker construction and ready | 85.2 | 85.2 |
| product | invocation / Worker execution / Worker dispatch | 1936.2 | 25.3 |
| product | invocation / Worker execution / Worker dispatch / Application point | 8.8 | 8.8 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 282.1 | 282.1 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 281.6 | 281.6 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 1323.2 | 1323.2 |
| product | invocation / Worker execution / Worker disposal | 13.6 | 13.6 |
| product | invocation / authoritative publication | 142.0 | 142.0 |
| product | invocation / journal seal and OCC verification | 68.3 | 68.3 |
| product | invocation / request admission | 84.5 | 84.5 |
| productPayload | invocation | 3209.6 | 0.6 |
| productPayload | invocation / Worker execution | 2800.6 | 0.9 |
| productPayload | invocation / Worker execution / Worker construction and ready | 84.9 | 84.9 |
| productPayload | invocation / Worker execution / Worker dispatch | 2699.1 | 29.8 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 8.0 | 8.0 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 261.4 | 261.4 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 261.1 | 261.1 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 1243.6 | 1243.6 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 263.4 | 263.4 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 186.5 | 186.5 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 236.6 | 236.6 |
| productPayload | invocation / Worker execution / Worker disposal | 13.2 | 13.2 |
| productPayload | invocation / authoritative publication | 227.7 | 227.7 |
| productPayload | invocation / journal seal and OCC verification | 70.1 | 70.1 |
| productPayload | invocation / request admission | 110.7 | 110.7 |
| mixedWorkflow | invocation | 6754.8 | 0.6 |
| mixedWorkflow | invocation / Worker execution | 6041.1 | 1.1 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 91.9 | 91.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 5875.5 | 33.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 8.8 | 8.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 299.7 | 299.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 1419.4 | 1419.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 3050.1 | 3050.1 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 301.7 | 301.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 216.9 | 216.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 271.1 | 271.1 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 13.5 | 13.5 |
| mixedWorkflow | invocation / authoritative publication | 416.6 | 416.6 |
| mixedWorkflow | invocation / journal seal and OCC verification | 86.6 | 86.6 |
| mixedWorkflow | invocation / request admission | 211.7 | 211.7 |
| standaloneWorkflow | invocation | 332.4 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 332.4 | 332.4 |

## Failures and uncertainty

Failures: 0. Successful warm percentiles exclude failures; the raw file retains every attempted sample.

Unavailable or unmeasured metrics:
- PostgreSQL server execution time (driver await includes transport and scheduling).
- Exact native workflow child inclusive/exclusive spans; native steps are not instrumented, so SQL owner mapping is used instead.
- Exact inner OCC/materialization phase duration where the existing owner has no test observation hook.
- Exact scope-clock lock acquisition wait and lock-hold interval; transaction duration is only a BEGIN-to-settlement envelope.
- Sealed attempt bytes for failed attempts and standalone workflow; settled journal rows are removed, so inventory separately records only remaining live journal bytes.
- Client SQL that loses trace context during an active invocation is detected and invalidates that sample, but SQL through uninstrumented pools or outside the invocation cannot be counted; named phase checks do not prove universal SQL coverage.
- Hosted Cloudflare transport, native ORM parity, and production capacity.

Interpretation notes:
- Standalone workflow includes the same selected Product/Pricing/Link/Tag graph but has no Application, Payload, journal or OCC obligations.
- The first warmup is reconnaissance for owner attribution and is excluded from warm distributions.
- Per-request test grant issuer/signing and private bridge overhead are included in mixed request admission and Worker intervals.
- Warm mixed samples reuse prepared modules, scope, and pools; every request creates, readies, invokes once, and disposes a fresh Worker under the exact runtime one-invocation guard.
- Signed business arguments are parsed by the fixed benchmark Worker source inside the measured request; that private test-harness cost is included.
- Workflow tags are unique: each graph is seeded immediately before its invocation and its launched tag is renamed outside measurement before the next seed. Product/Payload graphs are preseeded.
- The trace's DB wait union is a union of observed awaited intervals, not a server critical-path or network round-trip count.
- Request duration is the inner trace span; outer wall also includes trace aggregation. Their difference is reported separately.
- Sealed attempt bytes come from the canonical journal at successful seal through a delegating test store port; the capture adds no database query.
