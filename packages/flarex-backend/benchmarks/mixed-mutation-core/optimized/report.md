# Private mixed mutation performance baseline

> **Dataset status:** Optimized full series: all 104 planned samples succeeded. This run is separate from the retained incomplete baseline and diagnostic smoke.

Revision: `95578d5fcc1a64fd556342786b0261a249b05cda`; working diff SHA-256: `943de0b2eddba4b2fd55e7ba2f17c498d419d511036696c04ceccefbd983c11c`; mode: **full**.
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
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "8289176a22f45bbcbacc05fb0ceb9a2763940de5684267bca3441be445c2da4d",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "d283018fe41fe056a2f34a0372f56bc6049168ac5c00ef63fa0a75cb815a0437",
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
| product | warm | 20/20 | 3020.2 | 2965.1–3519.2 | 3298.2 | 84.6 | 5.1 | 4358.0 | 4358.0 | 1623.4 | 1623.4 |
| product | cold | 3/3 | 3062.9 | 3004.5–3133.2 | unavailable | 82.0 | 3.7 | 4362.0 | 4362.0 | 1630.9 | 1630.9 |
| productPayload | warm | 20/20 | 4420.2 | 4283.4–9218.5 | 7883.7 | 86.3 | 7.4 | 6352.0 | 6352.0 | 2402.9 | 2402.9 |
| productPayload | cold | 3/3 | 4368.2 | 4361.3–4399.1 | unavailable | 82.9 | 6.0 | 6359.0 | 6359.0 | 2376.7 | 2376.7 |
| mixedWorkflow | warm | 20/20 | 10108.2 | 9959.2–13676.1 | 10750.3 | 89.9 | 12.7 | 11442.0 | 11442.0 | 5981.5 | 5981.5 |
| mixedWorkflow | cold | 3/3 | 10100.3 | 10060.6–10308.8 | unavailable | 81.1 | 12.1 | 11446.0 | 11446.0 | 5989.6 | 5989.6 |
| standaloneWorkflow | warm | 20/20 | 362.1 | 348.5–1001.1 | 992.1 | unavailable | 0.5 | 480.0 | 480.0 | 171.4 | 171.4 |
| standaloneWorkflow | cold | 3/3 | 359.9 | 350.9–393.3 | unavailable | unavailable | 0.5 | 480.0 | 480.0 | 159.4 | 159.4 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 10908.9 | 1060.4 | 2430.7 | 50660.7 | unavailable | 65061.5 |
| product | product-cold-0-0 | 9551.9 | 1004.3 | 2329.2 | 0.0 | unavailable | 12885.6 |
| product | product-cold-1-0 | 9198.8 | 1048.1 | 2344.1 | 0.0 | unavailable | 12591.1 |
| product | product-cold-2-0 | 9179.3 | 1010.6 | 2278.5 | 0.0 | unavailable | 12468.4 |
| productPayload | productPayload-warm-0-0 | 9133.6 | 1294.9 | 2353.8 | 50180.3 | unavailable | 62962.7 |
| productPayload | productPayload-cold-0-0 | 12407.8 | 1312.6 | 2328.7 | 0.0 | unavailable | 16049.3 |
| productPayload | productPayload-cold-1-0 | 9471.8 | 1330.4 | 2348.1 | 0.0 | unavailable | 13150.4 |
| productPayload | productPayload-cold-2-0 | 9381.5 | 1318.4 | 2302.6 | 0.0 | unavailable | 13002.5 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 13289.5 | 4652.1 | 3068.9 | 0.0 | unavailable | 21010.6 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 13463.5 | 4592.0 | 3057.7 | 0.0 | unavailable | 21113.3 |
| mixedWorkflow | mixedWorkflow-cold-1-0 | 13127.5 | 4547.5 | 3005.4 | 0.0 | unavailable | 20680.4 |
| mixedWorkflow | mixedWorkflow-cold-2-0 | 13490.3 | 4551.5 | 3021.4 | 0.0 | unavailable | 21063.2 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 14961.5 | unavailable | unavailable | unavailable | 1861.2 | 16823.0 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 15147.0 | unavailable | unavailable | unavailable | 1734.0 | 16881.1 |
| standaloneWorkflow | standaloneWorkflow-cold-1-0 | 15048.5 | unavailable | unavailable | unavailable | 1664.8 | 16713.4 |
| standaloneWorkflow | standaloneWorkflow-cold-2-0 | 15082.8 | unavailable | unavailable | unavailable | 1860.1 | 16942.9 |

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
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 2300 | 92276.9 | 35.5–260.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 1220 | 46537.2 | 35.2–51.2 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 1220 | 45596.7 | 26.7–1242.5 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 1220 | 36370.4 | 26.7–50.0 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 360 | 13670.4 | 35.4–47.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 360 | 10624.1 | 26.8–76.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 220 | 10027.5 | 26.7–848.9 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 40 | 9948.3 | 1.0–547.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 240 | 9140.3 | 35.4–53.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 220 | 8357.9 | 35.7–48.5 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 220 | 8333.8 | 35.5–49.0 |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 100 | 8268.0 | 0.8–441.2 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 260 | 7810.8 | 26.7–159.1 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 260 | 7763.5 | 27.0–102.8 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 240 | 7144.1 | 27.0–36.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 240 | 7048.2 | 26.7–61.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 220 | 7034.0 | 26.9–476.9 |
| productPayload | target | invocation / authoritative publication | commit | 40 | 5415.3 | 0.9–547.7 |
| mixedWorkflow | target | invocation / request admission | commit | 360 | 5214.6 | 0.8–174.1 |
| productPayload | target | invocation / request admission | commit | 240 | 3808.3 | 0.9–225.0 |
| product | target | invocation / authoritative publication | commit | 40 | 2787.4 | 0.9–149.7 |
| product | target | invocation / request admission | commit | 200 | 1314.1 | 0.9–32.2 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 140 | 694.5 | 2.3–30.4 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 140 | 661.3 | 2.4–14.2 |
| product | target | invocation / journal seal and OCC verification | commit | 140 | 649.0 | 2.3–13.4 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 406.6 | 5.8–149.7 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 20 | 305.5 | 0.6–113.8 |
| productPayload | control | invocation / request admission | commit | 20 | 304.1 | 0.7–272.5 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 288.0 | 6.0–19.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 277.2 | 6.0–12.2 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 20 | 198.8 | 3.1–123.3 |
| mixedWorkflow | control | invocation / request admission | commit | 20 | 169.8 | 0.7–156.1 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 20 | 105.2 | 3.0–23.5 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 20 | 94.9 | 3.1–16.6 |
| product | control | invocation / request admission | commit | 20 | 14.6 | 0.7–1.5 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 104600 | 104600 | 0 | 57226.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 53700 | 53700 | 0 | 30455.7 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 53580 | 53580 | 0 | 28736.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 53700 | 53700 | 0 | 20870.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 15960 | 15960 | 0 | 8481.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 9780 | 9780 | 0 | 7332.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 15960 | 15960 | 0 | 6189.5 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 12520 | 12520 | 0 | 5784.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 10600 | 10600 | 0 | 5641.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 9780 | 9780 | 0 | 5178.0 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 9760 | 9760 | 0 | 5174.0 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 11460 | 11460 | 0 | 4645.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 11460 | 11460 | 0 | 4555.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 9760 | 9760 | 0 | 4352.5 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 10600 | 10600 | 0 | 4133.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 10600 | 10600 | 0 | 4116.1 |
| mixedWorkflow | unattributed | target | invocation / request admission | 7380 | 7380 | 0 | 3438.5 |
| productPayload | unattributed | target | invocation / authoritative publication | 7400 | 7400 | 0 | 3153.2 |
| productPayload | unattributed | target | invocation / request admission | 4080 | 4080 | 0 | 2997.4 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6420 | 6420 | 0 | 2690.2 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 2760 | 2760 | 0 | 1869.8 |
| product | unattributed | target | invocation / authoritative publication | 4360 | 4360 | 0 | 1541.5 |
| product | unattributed | target | invocation / request admission | 2980 | 2980 | 0 | 788.9 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 1500 | 1500 | 0 | 509.8 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 1500 | 1500 | 0 | 474.6 |
| product | unattributed | target | invocation / journal seal and OCC verification | 1500 | 1500 | 0 | 460.9 |
| productPayload | unattributed | control | invocation / request admission | 660 | 660 | 0 | 437.9 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 420 | 420 | 0 | 384.4 |
| mixedWorkflow | unattributed | control | invocation / request admission | 780 | 780 | 0 | 334.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 680 | 680 | 0 | 306.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 260 | 260 | 0 | 198.0 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 680 | 680 | 0 | 182.3 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 680 | 680 | 0 | 169.1 |
| product | unattributed | control | invocation / request admission | 620 | 620 | 0 | 133.5 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 620 | 620 | 0 | 127.5 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 260 | 260 | 0 | 103.7 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 380 | 380 | 0 | 103.7 |
| product | unattributed | control | invocation / journal seal and OCC verification | 380 | 380 | 0 | 102.1 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 380 | 380 | 0 | 100.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 260 | 260 | 0 | 93.0 |
| productPayload | unattributed | control | invocation / authoritative publication | 380 | 380 | 0 | 81.1 |
| product | unattributed | control | invocation / authoritative publication | 340 | 340 | 0 | 73.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 80 | 80 | 0 | 19.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 80 | 80 | 0 | 19.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 18.7 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 17.9 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 17.9 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 15.4 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 14.7 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 14.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 12.8 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 40 | 40 | 0 | 12.2 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 40 | 40 | 0 | 12.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 40 | 40 | 0 | 11.6 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 40 | 40 | 0 | 11.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 40 | 40 | 0 | 10.2 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 40 | 40 | 0 | 10.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 40 | 40 | 0 | 9.8 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 40 | 40 | 0 | 9.8 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 40 | 40 | 0 | 9.6 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 40 | 40 | 0 | 9.5 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 40 | 40 | 0 | 9.5 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 40 | 40 | 0 | 9.4 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 40 | 40 | 0 | 9.4 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 8.7 |
| product | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 8.4 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 7.9 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 4.8 |
| product | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 4.1 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `25483141d165001e6167b05f8a24d249d362b8ff199c81fc3d008f316d1ae63b` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1220 | 1220 | 0 | 8169.7 | select true , exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on |
| product | `25483141d165001e6167b05f8a24d249d362b8ff199c81fc3d008f316d1ae63b` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 260 | 260 | 0 | 1726.7 | select true , exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on |
| product | `25483141d165001e6167b05f8a24d249d362b8ff199c81fc3d008f316d1ae63b` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 240 | 240 | 0 | 1598.1 | select true , exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on |
| product | `f23e4a40858f630ac0a88d3447e83558dcdd166cf2adbb1d7e966b60dbcffd18` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2440 | 2440 | 0 | 836.0 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 3660 | 3660 | 0 | 803.2 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| product | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 3660 | 3660 | 0 | 743.4 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| product | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2440 | 2440 | 0 | 681.4 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| product | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1220 | 1220 | 0 | 629.4 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `959bcc422a7e86e91547288ce37a0dc6c5d46f47e21e537ebde19f0458419633` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1220 | 1220 | 0 | 628.6 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1220 | 1220 | 0 | 516.3 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| product | `8f8deefac9b885262555f822734015b70f5c706b1b209810a792d700f9c6cab2` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2440 | 2440 | 0 | 483.8 | select "scope_id" , "revision_id" , "deployment_id" , "application_schema_sha256" , "schema_version_id" , "schema_versio |
| product | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2440 | 2440 | 0 | 458.5 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1220 | 1220 | 0 | 10270.3 | commit |
| productPayload | `25483141d165001e6167b05f8a24d249d362b8ff199c81fc3d008f316d1ae63b` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1220 | 1220 | 0 | 8118.7 | select true , exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 220 | 220 | 0 | 3701.6 | commit |
| productPayload | `25483141d165001e6167b05f8a24d249d362b8ff199c81fc3d008f316d1ae63b` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 360 | 360 | 0 | 2391.4 | select true , exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 240 | 240 | 0 | 1853.6 | commit |
| productPayload | `25483141d165001e6167b05f8a24d249d362b8ff199c81fc3d008f316d1ae63b` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 260 | 260 | 0 | 1707.4 | select true , exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on |
| productPayload | `25483141d165001e6167b05f8a24d249d362b8ff199c81fc3d008f316d1ae63b` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 240 | 240 | 0 | 1587.3 | select true , exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on |
| productPayload | `25483141d165001e6167b05f8a24d249d362b8ff199c81fc3d008f316d1ae63b` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 220 | 220 | 0 | 1448.8 | select true , exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on |
| productPayload | `25483141d165001e6167b05f8a24d249d362b8ff199c81fc3d008f316d1ae63b` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 220 | 220 | 0 | 1447.8 | select true , exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on |
| productPayload | `25483141d165001e6167b05f8a24d249d362b8ff199c81fc3d008f316d1ae63b` | unattributed | target | invocation / authoritative publication | 140 | 140 | 0 | 928.9 | select true , exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on |
| productPayload | `37ec6699690bff38b8b9608ac340be2a6598bf79c403f771dc997c352de69188` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2440 | 2440 | 0 | 817.7 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 3660 | 3660 | 0 | 802.7 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| mixedWorkflow | `da1809f3fbe008d9b247e0848d45d40859a6519cf9addfe41924e2dda7b0e9bd` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 2420 | 2420 | 0 | 30671.1 | select exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on index_ |
| mixedWorkflow | `da1809f3fbe008d9b247e0848d45d40859a6519cf9addfe41924e2dda7b0e9bd` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1220 | 1220 | 0 | 15510.4 | select exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on index_ |
| mixedWorkflow | `da1809f3fbe008d9b247e0848d45d40859a6519cf9addfe41924e2dda7b0e9bd` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 360 | 360 | 0 | 4560.6 | select exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on index_ |
| mixedWorkflow | `da1809f3fbe008d9b247e0848d45d40859a6519cf9addfe41924e2dda7b0e9bd` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 240 | 240 | 0 | 3041.7 | select exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on index_ |
| mixedWorkflow | `da1809f3fbe008d9b247e0848d45d40859a6519cf9addfe41924e2dda7b0e9bd` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 220 | 220 | 0 | 2786.3 | select exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on index_ |
| mixedWorkflow | `da1809f3fbe008d9b247e0848d45d40859a6519cf9addfe41924e2dda7b0e9bd` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 220 | 220 | 0 | 2778.1 | select exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on index_ |
| mixedWorkflow | `da1809f3fbe008d9b247e0848d45d40859a6519cf9addfe41924e2dda7b0e9bd` | unattributed | target | invocation / authoritative publication | 180 | 180 | 0 | 2297.6 | select exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on index_ |
| mixedWorkflow | `b11de4b495c2cb7d6b2c57f9216ebd0fbf1e4649a64fcc86522b2d707f04276c` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4840 | 4840 | 0 | 1620.8 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 7260 | 7260 | 0 | 1620.1 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| mixedWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 7260 | 7260 | 0 | 1587.0 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 2300 | 2300 | 0 | 1561.3 | commit |
| mixedWorkflow | `57dba99ebb6cdf0a6b4efc3bdb5c981a8b1cd077b268feeecc23e19b0157f3e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 2420 | 2420 | 0 | 1523.6 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | ambiguous | target | invocation / standalone native workflow | 100 | 100 | 0 | 1300.3 | commit |
| standaloneWorkflow | `da1809f3fbe008d9b247e0848d45d40859a6519cf9addfe41924e2dda7b0e9bd` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 60 | 60 | 0 | 762.7 | select exists ( select ? from pg_catalog . pg_class index_class join pg_catalog . pg_namespace index_namespace on index_ |
| standaloneWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | control | invocation / standalone native workflow | 20 | 20 | 0 | 295.3 | commit |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 480 | 480 | 0 | 266.1 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `75536164c67dda9cd26c18f1c366f100cb8ee42931e66ff77c5bd73b8db259cc` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 740 | 740 | 0 | 195.1 | update "fx_system_index_build_state" set "covered_through_commit_seq" = $? , "updated_at" = clock_timestamp ( ) where (  |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 360 | 360 | 0 | 175.6 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 1000 | 1000 | 0 | 162.4 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 320 | 320 | 0 | 97.4 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 480 | 480 | 0 | 84.2 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 400 | 400 | 0 | 76.8 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `8ea8d5b22b1f7e46a005e45d34baf72202467700759672f98df650a96caa836e` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 260 | 260 | 0 | 68.6 | update "fx_system_unique_constraint_build" set "covered_through_commit_seq" = $? , "updated_at" = clock_timestamp ( ) wh |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 300 | 300 | 0 | 67.4 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 3020.2 | 0.6 |
| product | invocation / Worker execution | 2717.1 | 0.9 |
| product | invocation / Worker execution / Worker construction and ready | 84.6 | 84.6 |
| product | invocation / Worker execution / Worker dispatch | 2617.8 | 25.0 |
| product | invocation / Worker execution / Worker dispatch / Application point | 8.2 | 8.2 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 385.6 | 385.6 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 361.3 | 361.3 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 1824.7 | 1824.7 |
| product | invocation / Worker execution / Worker disposal | 12.8 | 12.8 |
| product | invocation / authoritative publication | 153.2 | 153.2 |
| product | invocation / journal seal and OCC verification | 65.2 | 65.2 |
| product | invocation / request admission | 87.6 | 87.6 |
| productPayload | invocation | 4420.2 | 0.6 |
| productPayload | invocation / Worker execution | 3933.2 | 0.9 |
| productPayload | invocation / Worker execution / Worker construction and ready | 86.3 | 86.3 |
| productPayload | invocation / Worker execution / Worker dispatch | 3836.2 | 29.5 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 8.1 | 8.1 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 384.6 | 384.6 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 357.2 | 357.2 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 1830.9 | 1830.9 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 326.7 | 326.7 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 263.2 | 263.2 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 326.6 | 326.6 |
| productPayload | invocation / Worker execution / Worker disposal | 13.6 | 13.6 |
| productPayload | invocation / authoritative publication | 271.1 | 271.1 |
| productPayload | invocation / journal seal and OCC verification | 71.3 | 71.3 |
| productPayload | invocation / request admission | 126.8 | 126.8 |
| mixedWorkflow | invocation | 10108.2 | 0.6 |
| mixedWorkflow | invocation / Worker execution | 9241.6 | 1.0 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 89.9 | 89.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 9138.0 | 33.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 8.3 | 8.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 463.2 | 463.2 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 2346.8 | 2346.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4670.0 | 4670.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 424.5 | 424.5 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 344.2 | 344.2 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 419.8 | 419.8 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 13.3 | 13.3 |
| mixedWorkflow | invocation / authoritative publication | 516.4 | 516.4 |
| mixedWorkflow | invocation / journal seal and OCC verification | 85.7 | 85.7 |
| mixedWorkflow | invocation / request admission | 264.8 | 264.8 |
| standaloneWorkflow | invocation | 362.1 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 362.1 | 362.1 |

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
