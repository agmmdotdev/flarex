# Private mixed mutation performance baseline

Revision: `4afceadda203e32f20ff42ced933a46246efe9c8`; working diff SHA-256: `381be1f7c0f956bba4a8cdfbcd15debcd229299558064ef61042808c62d9c9fd`; mode: **smoke**, observation: **traced**.
Plan: 1 warmups, 2 measured warm samples, 1 cold samples per workload.

The request interval starts before fresh admission and ends after authoritative publication and retained-outcome resolution. The outer invocation wall envelope includes trace finalization, which is reported separately. SQL awaited time includes driver and database wait; it is not server execution time. Nested phases and overlapping query waits are non-additive. The standalone graph has fewer root obligations, so its latency delta does not isolate framework overhead. No native ORM parity or hosted transport claim is made.

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
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "7900b3eb41e587b37f3a95036003ff6eaef1b26291ee5504d8f8ad9385e5de85",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "299b0b9a2b87610c1837bfea19b5c00c74b5fa1930659d3c852440fb4fd84887",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "a76f10c870d360d4117d30afa509ee6bbb11a345dea640b3473b6879fcea060d",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/persistence-postgres/src/appRows.ts": "ca7a2a67f70e587da10b5a796bfdde20f84bcb0cd7dc4e0bc22e27bcbac6ad0e",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "27cbb62d616c3c6a9413bab17903a3975da1edc7821f911a27048bd541676fd5",
    "packages/persistence-postgres/src/applicationActivation.ts": "af29252779772604269b21a36ff19f200a46cc686918be7c29dd7d673bf7db8d",
    "packages/persistence-postgres/src/applicationReadiness.ts": "b74697ade7ef0112031b90d56b740cace179715480f0665b8873e39d8e3a36b5",
    "packages/persistence-postgres/src/applicationRelationReadinessFold.ts": "c9e3c34a1d7eb4de52d47c04480c0bd290530cbd4c1ea17bb83ccd61709ce06f",
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

| Workload | Series | Successful / observed | Request median (ms) | Range (ms) | Descriptive p95 (ms) | Outer invocation wall median (ms) | Outer range (ms) | Outer descriptive p95 (ms) | Fresh Worker startup median (ms) | Trace finalization median (ms) | Dispatch median | Known statement median | Awaited DB median (ms) | DB wait interval union median (ms) |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | warm | 2/2 | 2448.6 | 2356.4–2540.9 | unavailable | 2452.4 | 2359.9–2545.0 | unavailable | 89.7 | 3.8 | 3682.0 | 3682.0 | 1071.5 | 1071.5 |
| product | cold | 1/1 | 2515.7 | 2515.7–2515.7 | unavailable | 2518.8 | 2518.8–2518.8 | unavailable | 83.5 | 3.0 | 3686.0 | 3686.0 | 1193.9 | 1193.9 |
| productPayload | warm | 2/2 | 3456.1 | 3421.2–3491.0 | unavailable | 3462.4 | 3427.8–3497.0 | unavailable | 89.4 | 6.3 | 5463.0 | 5463.0 | 1510.1 | 1510.1 |
| productPayload | cold | 1/1 | 3367.9 | 3367.9–3367.9 | unavailable | 3374.3 | 3374.3–3374.3 | unavailable | 83.3 | 6.4 | 5470.0 | 5470.0 | 1487.2 | 1487.2 |
| mixedWorkflow | warm | 2/2 | 7201.2 | 7025.4–7377.1 | unavailable | 7212.5 | 7036.2–7388.7 | unavailable | 224.6 | 11.2 | 9958.0 | 9958.0 | 3095.1 | 3095.1 |
| mixedWorkflow | cold | 1/1 | 7089.5 | 7089.5–7089.5 | unavailable | 7101.3 | 7101.3–7101.3 | unavailable | 93.4 | 11.8 | 9962.0 | 9962.0 | 3060.7 | 3060.7 |
| standaloneWorkflow | warm | 2/2 | 333.9 | 331.3–336.5 | unavailable | 334.4 | 331.8–337.0 | unavailable | unavailable | 0.5 | 470.0 | 470.0 | 131.6 | 131.6 |
| standaloneWorkflow | cold | 1/1 | 378.0 | 378.0–378.0 | unavailable | 378.5 | 378.5–378.5 | unavailable | unavailable | 0.5 | 470.0 | 470.0 | 149.5 | 149.5 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 11733.3 | 1149.3 | 2784.4 | 4856.5 | unavailable | 20524.2 |
| product | product-cold-0-0 | 11630.9 | 1071.4 | 2466.2 | 0.0 | unavailable | 15168.7 |
| productPayload | productPayload-warm-0-0 | 10572.8 | 1380.1 | 2363.8 | 4806.2 | unavailable | 19123.0 |
| productPayload | productPayload-cold-0-0 | 10242.5 | 1349.8 | 2394.9 | 0.0 | unavailable | 13987.4 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 14666.0 | 5163.9 | 3170.8 | 0.0 | unavailable | 23000.9 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 17997.5 | 4839.1 | 3134.1 | 0.0 | unavailable | 25970.8 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 16306.6 | unavailable | unavailable | unavailable | 1727.7 | 18034.5 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 17433.3 | unavailable | unavailable | unavailable | 1723.7 | 19157.0 |

## Retained state growth per successful warm request

| Workload | Rows Δ median | Index entries Δ median | Commits Δ median | Events Δ median | Live journal rows Δ median | Sealed attempt bytes median | Live journal bytes Δ median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 12951.5 | 0.0 |
| productPayload | 2.0 | 3.0 | 1.0 | 1.0 | 0.0 | 20733.5 | 0.0 |
| mixedWorkflow | 7.0 | 36.0 | 1.0 | 7.0 | 0.0 | 38076.0 | 0.0 |
| standaloneWorkflow | 5.0 | 33.0 | 1.0 | 6.0 | 0.0 | unavailable | unavailable |

## Observed database transaction intervals in successful warm requests

These BEGIN-to-settlement intervals include application work and waits; they are not lock-hold measurements.

| Workload | Pool | Phase | Outcome | Intervals | Duration total (ms) | Range (ms) |
| --- | --- | --- | --- | ---: | ---: | --- |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 208 | 6221.2 | 24.8–90.1 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 104 | 2972.0 | 24.7–67.3 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 104 | 2764.7 | 22.1–40.7 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 104 | 2609.6 | 22.3–32.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 32 | 885.2 | 25.2–30.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 32 | 826.4 | 21.9–37.2 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 4 | 795.2 | 1.0–396.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 22 | 666.2 | 25.5–78.0 |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 10 | 643.7 | 0.8–304.6 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 22 | 612.1 | 25.6–31.1 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 22 | 563.0 | 23.8–29.0 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 20 | 558.9 | 25.6–32.8 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 22 | 546.6 | 21.9–28.6 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 22 | 537.3 | 22.4–26.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 22 | 534.9 | 21.9–27.7 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 22 | 525.2 | 21.7–28.9 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 20 | 518.4 | 22.1–40.2 |
| productPayload | target | invocation / authoritative publication | commit | 4 | 443.7 | 1.0–223.7 |
| mixedWorkflow | target | invocation / request admission | commit | 36 | 410.4 | 0.9–29.3 |
| product | target | invocation / authoritative publication | commit | 4 | 251.3 | 1.1–126.0 |
| productPayload | target | invocation / request admission | commit | 24 | 183.7 | 0.9–25.8 |
| product | target | invocation / request admission | commit | 20 | 132.7 | 1.0–26.2 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 14 | 73.1 | 2.8–15.0 |
| product | target | invocation / journal seal and OCC verification | commit | 14 | 71.7 | 2.7–13.8 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 14 | 70.1 | 2.5–12.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 28.7 | 6.4–7.7 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 27.9 | 6.5–8.2 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 27.1 | 6.2–7.4 |
| mixedWorkflow | control | invocation / request admission | commit | 2 | 8.7 | 0.8–8.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.9 | 3.2–3.7 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.9 | 3.3–3.6 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.9 | 3.2–3.7 |
| product | control | invocation / request admission | commit | 2 | 1.6 | 0.8–0.8 |
| productPayload | control | invocation / request admission | commit | 2 | 1.6 | 0.8–0.8 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 2 | 1.4 | 0.7–0.7 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 9074 | 9074 | 0 | 2840.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 4376 | 4376 | 0 | 1367.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 4388 | 4388 | 0 | 1309.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 4388 | 4388 | 0 | 1216.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 1360 | 1360 | 0 | 398.9 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 1360 | 1360 | 0 | 384.0 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 1216 | 1216 | 0 | 363.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 932 | 932 | 0 | 330.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 930 | 930 | 0 | 274.6 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 930 | 930 | 0 | 265.6 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 930 | 930 | 0 | 260.3 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 852 | 852 | 0 | 252.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 930 | 930 | 0 | 252.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 930 | 930 | 0 | 252.1 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 932 | 932 | 0 | 247.1 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 852 | 852 | 0 | 241.7 |
| mixedWorkflow | unattributed | target | invocation / request admission | 710 | 710 | 0 | 225.1 |
| productPayload | unattributed | target | invocation / authoritative publication | 712 | 712 | 0 | 204.1 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 642 | 642 | 0 | 195.4 |
| product | unattributed | target | invocation / authoritative publication | 424 | 424 | 0 | 117.7 |
| productPayload | unattributed | target | invocation / request admission | 392 | 392 | 0 | 98.4 |
| product | unattributed | target | invocation / request admission | 286 | 286 | 0 | 74.0 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 256 | 256 | 0 | 59.0 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 150 | 150 | 0 | 50.6 |
| product | unattributed | target | invocation / journal seal and OCC verification | 150 | 150 | 0 | 50.6 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 150 | 150 | 0 | 49.8 |
| mixedWorkflow | unattributed | control | invocation / request admission | 78 | 78 | 0 | 25.0 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 68 | 68 | 0 | 17.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 68 | 68 | 0 | 16.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 68 | 68 | 0 | 16.5 |
| productPayload | unattributed | control | invocation / request admission | 66 | 66 | 0 | 15.3 |
| product | unattributed | control | invocation / request admission | 62 | 62 | 0 | 14.2 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 62 | 62 | 0 | 13.8 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 38 | 38 | 0 | 13.0 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 38 | 38 | 0 | 11.2 |
| product | unattributed | control | invocation / journal seal and OCC verification | 38 | 38 | 0 | 10.9 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 42 | 42 | 0 | 8.8 |
| productPayload | unattributed | control | invocation / authoritative publication | 38 | 38 | 0 | 8.6 |
| product | unattributed | control | invocation / authoritative publication | 34 | 34 | 0 | 8.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 6.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 6.9 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 6.8 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.9 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.8 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.8 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.4 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.4 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.4 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.2 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.1 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.0 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.0 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 0.9 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.9 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 0.9 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 0.9 |
| product | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.8 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.6 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.5 |
| product | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 89.8 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 312 | 312 | 0 | 80.6 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| product | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 312 | 312 | 0 | 80.1 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| product | `f23e4a40858f630ac0a88d3447e83558dcdd166cf2adbb1d7e966b60dbcffd18` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 208 | 208 | 0 | 78.1 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 70.4 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| product | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 208 | 208 | 0 | 67.2 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| product | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 55.0 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 49.0 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| product | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 208 | 208 | 0 | 47.9 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| product | `8f8deefac9b885262555f822734015b70f5c706b1b209810a792d700f9c6cab2` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 208 | 208 | 0 | 47.5 | select "scope_id" , "revision_id" , "deployment_id" , "application_schema_sha256" , "schema_version_id" , "schema_versio |
| product | `959bcc422a7e86e91547288ce37a0dc6c5d46f47e21e537ebde19f0458419633` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 43.7 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 40.5 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 84.9 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 312 | 312 | 0 | 75.2 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| productPayload | `37ec6699690bff38b8b9608ac340be2a6598bf79c403f771dc997c352de69188` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 208 | 208 | 0 | 75.0 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 71.5 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| productPayload | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 312 | 312 | 0 | 70.1 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| productPayload | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 208 | 208 | 0 | 60.4 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| productPayload | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 50.9 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 45.8 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| productPayload | `8f8deefac9b885262555f822734015b70f5c706b1b209810a792d700f9c6cab2` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 208 | 208 | 0 | 43.7 | select "scope_id" , "revision_id" , "deployment_id" , "application_schema_sha256" , "schema_version_id" , "schema_versio |
| productPayload | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 42.8 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| productPayload | `959bcc422a7e86e91547288ce37a0dc6c5d46f47e21e537ebde19f0458419633` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 40.6 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 208 | 208 | 0 | 40.4 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 220 | 220 | 0 | 290.3 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 208 | 208 | 0 | 174.1 | commit |
| mixedWorkflow | `b11de4b495c2cb7d6b2c57f9216ebd0fbf1e4649a64fcc86522b2d707f04276c` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 440 | 440 | 0 | 163.3 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 660 | 660 | 0 | 158.7 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| mixedWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 660 | 660 | 0 | 152.3 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| mixedWorkflow | `57dba99ebb6cdf0a6b4efc3bdb5c981a8b1cd077b268feeecc23e19b0157f3e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 220 | 220 | 0 | 145.7 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 220 | 220 | 0 | 139.3 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 137.0 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 440 | 440 | 0 | 134.9 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 104 | 104 | 0 | 101.8 | commit |
| mixedWorkflow | `4ec3c032b8c2daed1aa86b3e2b64bf0b64d4fd86eb7a646e2016ad5a039ede66` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 220 | 220 | 0 | 99.6 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| mixedWorkflow | `8f8deefac9b885262555f822734015b70f5c706b1b209810a792d700f9c6cab2` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 440 | 440 | 0 | 96.1 | select "scope_id" , "revision_id" , "deployment_id" , "application_schema_sha256" , "schema_version_id" , "schema_versio |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 23.9 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `75536164c67dda9cd26c18f1c366f100cb8ee42931e66ff77c5bd73b8db259cc` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 74 | 74 | 0 | 19.6 | update "fx_system_index_build_state" set "covered_through_commit_seq" = $? , "updated_at" = clock_timestamp ( ) where (  |
| standaloneWorkflow | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 100 | 100 | 0 | 15.7 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 36 | 36 | 0 | 14.1 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 10.0 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 9.0 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 32 | 32 | 0 | 8.2 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 40 | 40 | 0 | 8.0 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `8ea8d5b22b1f7e46a005e45d34baf72202467700759672f98df650a96caa836e` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 26 | 26 | 0 | 6.8 | update "fx_system_unique_constraint_build" set "covered_through_commit_seq" = $? , "updated_at" = clock_timestamp ( ) wh |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 30 | 30 | 0 | 6.7 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 6.2 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 5.5 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 2448.6 | 0.6 |
| product | invocation / Worker execution | 2143.8 | 0.9 |
| product | invocation / Worker execution / Worker construction and ready | 89.7 | 89.7 |
| product | invocation / Worker execution / Worker dispatch | 2040.0 | 26.4 |
| product | invocation / Worker execution / Worker dispatch / Application point | 8.5 | 8.5 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 291.8 | 291.8 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 284.4 | 284.4 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 1420.5 | 1420.5 |
| product | invocation / Worker execution / Worker disposal | 13.2 | 13.2 |
| product | invocation / authoritative publication | 141.9 | 141.9 |
| product | invocation / journal seal and OCC verification | 71.4 | 71.4 |
| product | invocation / request admission | 90.9 | 90.9 |
| productPayload | invocation | 3456.1 | 0.8 |
| productPayload | invocation / Worker execution | 3017.2 | 1.0 |
| productPayload | invocation / Worker execution / Worker construction and ready | 89.4 | 89.4 |
| productPayload | invocation / Worker execution / Worker dispatch | 2910.3 | 31.1 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 8.8 | 8.8 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 277.4 | 277.4 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 278.6 | 278.6 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 1342.2 | 1342.2 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 273.1 | 273.1 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 205.7 | 205.7 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 266.1 | 266.1 |
| productPayload | invocation / Worker execution / Worker disposal | 16.5 | 16.5 |
| productPayload | invocation / authoritative publication | 240.0 | 240.0 |
| productPayload | invocation / journal seal and OCC verification | 80.4 | 80.4 |
| productPayload | invocation / request admission | 117.6 | 117.6 |
| mixedWorkflow | invocation | 7201.2 | 0.7 |
| mixedWorkflow | invocation / Worker execution | 6441.8 | 1.1 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 224.5 | 224.5 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 6201.9 | 32.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 9.0 | 9.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 316.1 | 316.1 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 1522.7 | 1522.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 3230.4 | 3230.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 343.2 | 343.2 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 227.2 | 227.2 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 285.5 | 285.5 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 14.2 | 14.2 |
| mixedWorkflow | invocation / authoritative publication | 424.7 | 424.7 |
| mixedWorkflow | invocation / journal seal and OCC verification | 93.4 | 93.4 |
| mixedWorkflow | invocation / request admission | 240.6 | 240.6 |
| standaloneWorkflow | invocation | 333.9 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 333.9 | 333.9 |

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
