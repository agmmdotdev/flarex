# Private mixed mutation performance baseline

> **Dataset status:** Incomplete four-workload run: 76 successes, one observed deadline failure, and 27 unattempted slots. This report describes only observed samples; see `exclusions.json`.

Revision: `95578d5fcc1a64fd556342786b0261a249b05cda`; working diff SHA-256: `fb16ac892a2832ad9c85d6f18d222de8b6bf9e032f0251fedf57a81641bf283c`; mode: **full**.
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
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "ba2fde14092a836739ededc1339fd83dbf1bbb95613cc14cc8154b05288bcfcb",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "299b0b9a2b87610c1837bfea19b5c00c74b5fa1930659d3c852440fb4fd84887",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "2806d33005104d0a862a7dd73594e8d424029d193243a9f71196a558636b7929",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
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
    }
  }
}
```

## Sample distributions

| Workload | Series | Successful / observed | Request median (ms) | Range (ms) | Descriptive p95 (ms) | Fresh Worker startup median (ms) | Trace finalization median (ms) | Dispatch median | Known statement median | Awaited DB median (ms) | DB wait interval union median (ms) |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | warm | 20/20 | 10590.2 | 10143.8–12340.8 | 12187.5 | 89.0 | 14.9 | 14504.0 | 14504.0 | 7839.6 | 7839.6 |
| product | cold | 3/3 | 9148.8 | 8978.4–9254.6 | unavailable | 93.4 | 10.4 | 9420.0 | 9420.0 | 6982.0 | 6982.0 |
| productPayload | warm | 20/20 | 14873.2 | 14617.4–15621.9 | 15309.1 | 81.7 | 21.7 | 20710.0 | 20710.0 | 11132.7 | 11132.7 |
| productPayload | cold | 3/3 | 15306.3 | 13029.0–17299.4 | unavailable | 102.5 | 15.0 | 13667.0 | 13667.0 | 11699.0 | 11699.0 |
| mixedWorkflow | warm | 20/20 | 32294.0 | 31464.2–32742.4 | 32663.6 | 88.8 | 45.4 | 43108.0 | 43108.0 | 24327.0 | 24327.0 |
| mixedWorkflow | cold | 1/2 | 31786.5 | 31786.5–31786.5 | unavailable | 88.0 | 48.1 | 43112.0 | 43112.0 | 23990.3 | 23990.3 |
| standaloneWorkflow | warm | 0/0 | unavailable | unavailable–unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |
| standaloneWorkflow | cold | 0/0 | unavailable | unavailable–unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 10706.1 | 1139.1 | 2748.1 | 58061.2 | unavailable | 72655.2 |
| product | product-cold-0-0 | 10141.8 | 1108.2 | 2652.5 | 0.0 | unavailable | 13902.6 |
| product | product-cold-1-0 | 9790.5 | 1090.7 | 2614.5 | 0.0 | unavailable | 13495.8 |
| product | product-cold-2-0 | 9905.4 | 1184.1 | 2676.5 | 0.0 | unavailable | 13766.2 |
| productPayload | productPayload-warm-0-0 | 10250.6 | 1479.6 | 2788.0 | 59351.3 | unavailable | 73869.5 |
| productPayload | productPayload-cold-0-0 | 10836.0 | 1578.0 | 3252.9 | 0.0 | unavailable | 15667.1 |
| productPayload | productPayload-cold-1-0 | 10263.9 | 1415.8 | 2644.5 | 0.0 | unavailable | 14324.2 |
| productPayload | productPayload-cold-2-0 | 9601.6 | 1479.1 | 4100.0 | 0.0 | unavailable | 15180.7 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 19465.1 | 5063.2 | 3565.6 | 0.0 | unavailable | 28094.0 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 15042.2 | 5557.7 | 3708.1 | 0.0 | unavailable | 24308.1 |
| mixedWorkflow | mixedWorkflow-cold-1-0 | 15035.8 | 5134.5 | 3691.9 | 0.0 | unavailable | 23862.2 |

## Retained state growth per successful warm request

| Workload | Rows Δ median | Index entries Δ median | Commits Δ median | Events Δ median | Live journal rows Δ median | Sealed attempt bytes median | Live journal bytes Δ median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 13049.0 | 0.0 |
| productPayload | 2.0 | 3.0 | 1.0 | 1.0 | 0.0 | 20848.0 | 0.0 |
| mixedWorkflow | 7.0 | 36.0 | 1.0 | 7.0 | 0.0 | 38213.0 | 0.0 |
| standaloneWorkflow | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |

## Observed database transaction intervals in successful warm requests

These BEGIN-to-settlement intervals include application work and waits; they are not lock-hold measurements.

| Workload | Pool | Phase | Outcome | Intervals | Duration total (ms) | Range (ms) |
| --- | --- | --- | --- | ---: | ---: | --- |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 2240 | 296990.6 | 116.7–495.2 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 1300 | 164213.7 | 116.6–218.8 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 1360 | 146017.2 | 96.3–527.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 1360 | 139573.4 | 95.5–203.3 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 360 | 45687.7 | 116.2–291.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 360 | 37310.0 | 95.5–152.9 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 240 | 30053.5 | 117.4–146.3 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 220 | 28032.8 | 118.0–176.6 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 220 | 27954.6 | 117.8–182.7 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 240 | 26400.6 | 96.5–826.3 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 40 | 26014.1 | 1.0–1430.5 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 240 | 25910.8 | 96.0–364.4 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 240 | 24794.6 | 95.8–141.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 240 | 24578.9 | 96.3–114.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 220 | 22665.5 | 96.3–164.6 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 220 | 22324.1 | 96.2–118.3 |
| productPayload | target | invocation / authoritative publication | commit | 40 | 15374.7 | 0.9–872.5 |
| mixedWorkflow | target | invocation / request admission | commit | 360 | 13859.9 | 0.8–175.8 |
| product | target | invocation / authoritative publication | commit | 40 | 7479.7 | 0.9–407.5 |
| productPayload | target | invocation / request admission | commit | 240 | 5004.2 | 0.9–130.5 |
| product | target | invocation / request admission | commit | 200 | 2940.0 | 0.9–114.5 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 140 | 809.9 | 2.4–21.3 |
| product | target | invocation / journal seal and OCC verification | commit | 140 | 678.0 | 2.2–15.5 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 140 | 666.9 | 2.3–16.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 370.5 | 6.1–31.1 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 355.2 | 5.9–47.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 298.1 | 5.8–26.8 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 20 | 84.0 | 3.1–13.5 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 20 | 79.4 | 3.1–4.8 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 20 | 72.3 | 3.0–4.7 |
| product | control | invocation / request admission | commit | 20 | 18.6 | 0.7–1.8 |
| productPayload | control | invocation / request admission | commit | 20 | 17.4 | 0.6–1.6 |
| mixedWorkflow | control | invocation / request admission | commit | 20 | 15.6 | 0.7–1.1 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 401740 | 401740 | 0 | 227137.8 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 222120 | 222120 | 0 | 125639.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 199800 | 199800 | 0 | 111654.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 195720 | 195720 | 0 | 106656.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 61680 | 61680 | 0 | 35019.0 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 51960 | 51960 | 0 | 28525.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 41080 | 41080 | 0 | 23014.0 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 37720 | 37720 | 0 | 21434.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 37700 | 37700 | 0 | 21398.8 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 35320 | 35320 | 0 | 20445.2 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 35320 | 35320 | 0 | 19945.9 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 35380 | 35380 | 0 | 19056.0 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 34600 | 34600 | 0 | 18968.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 34600 | 34600 | 0 | 18803.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 31780 | 31780 | 0 | 17343.7 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 31760 | 31760 | 0 | 17073.9 |
| productPayload | unattributed | target | invocation / authoritative publication | 21400 | 21400 | 0 | 11434.2 |
| mixedWorkflow | unattributed | target | invocation / request admission | 20080 | 20080 | 0 | 10472.9 |
| product | unattributed | target | invocation / authoritative publication | 10540 | 10540 | 0 | 5417.0 |
| productPayload | unattributed | target | invocation / request admission | 8080 | 8080 | 0 | 3703.0 |
| product | unattributed | target | invocation / request admission | 5040 | 5040 | 0 | 2114.0 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 1500 | 1500 | 0 | 487.8 |
| product | unattributed | target | invocation / journal seal and OCC verification | 1500 | 1500 | 0 | 478.5 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 1500 | 1500 | 0 | 476.6 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 380 | 380 | 0 | 326.1 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 620 | 620 | 0 | 261.6 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 680 | 680 | 0 | 242.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 680 | 680 | 0 | 215.0 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 680 | 680 | 0 | 190.4 |
| mixedWorkflow | unattributed | control | invocation / request admission | 780 | 780 | 0 | 176.2 |
| productPayload | unattributed | control | invocation / request admission | 660 | 660 | 0 | 162.6 |
| product | unattributed | control | invocation / request admission | 620 | 620 | 0 | 151.7 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 380 | 380 | 0 | 111.3 |
| product | unattributed | control | invocation / journal seal and OCC verification | 380 | 380 | 0 | 110.5 |
| productPayload | unattributed | control | invocation / authoritative publication | 380 | 380 | 0 | 88.0 |
| product | unattributed | control | invocation / authoritative publication | 340 | 340 | 0 | 82.5 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 260 | 260 | 0 | 81.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 260 | 260 | 0 | 81.6 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 40 | 40 | 0 | 72.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 260 | 260 | 0 | 70.9 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 24.5 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 80 | 80 | 0 | 21.8 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 80 | 80 | 0 | 20.6 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 19.6 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 19.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 14.9 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1350:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 14.8 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 40 | 40 | 0 | 14.8 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 14.6 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 13.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 40 | 40 | 0 | 13.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 40 | 40 | 0 | 11.9 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 40 | 40 | 0 | 11.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 40 | 40 | 0 | 11.0 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 40 | 40 | 0 | 10.8 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 40 | 40 | 0 | 10.8 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 40 | 40 | 0 | 10.7 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 40 | 40 | 0 | 10.6 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1350:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 10.5 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 40 | 40 | 0 | 10.5 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 40 | 40 | 0 | 10.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 40 | 40 | 0 | 10.2 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1379:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 8.7 |
| product | at .packages/persistence-postgres/src/appRows.ts:1350:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 8.5 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1379:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 5.5 |
| product | at .packages/persistence-postgres/src/appRows.ts:1379:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 4.2 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 10880 | 10880 | 0 | 71455.6 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| product | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 136000 | 136000 | 0 | 24540.2 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| product | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 1920 | 1920 | 0 | 12513.4 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| product | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 1920 | 1920 | 0 | 12448.8 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| product | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 24000 | 24000 | 0 | 4299.0 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| product | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 24000 | 24000 | 0 | 4238.0 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 1360 | 1360 | 0 | 3217.8 | commit |
| product | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / authoritative publication | 480 | 480 | 0 | 3166.0 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 240 | 240 | 0 | 1541.4 | commit |
| product | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / authoritative publication | 6000 | 6000 | 0 | 1083.4 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| product | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / request admission | 160 | 160 | 0 | 1041.4 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| product | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 4080 | 4080 | 0 | 955.6 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| productPayload | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 10880 | 10880 | 0 | 70732.9 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| productPayload | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 131920 | 131920 | 0 | 23146.3 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| productPayload | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 2880 | 2880 | 0 | 18881.1 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| productPayload | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 1920 | 1920 | 0 | 12545.9 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| productPayload | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 1920 | 1920 | 0 | 12463.0 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| productPayload | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 1760 | 1760 | 0 | 11474.8 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| productPayload | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 1760 | 1760 | 0 | 11317.7 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| productPayload | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / authoritative publication | 1120 | 1120 | 0 | 7279.4 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| productPayload | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 34920 | 34920 | 0 | 6203.7 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| productPayload | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 23280 | 23280 | 0 | 4124.6 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| productPayload | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 23280 | 23280 | 0 | 4083.0 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| productPayload | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 21340 | 21340 | 0 | 3787.5 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| mixedWorkflow | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 23600 | 23600 | 0 | 152357.7 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| mixedWorkflow | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 13000 | 13000 | 0 | 84292.6 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| mixedWorkflow | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 287920 | 287920 | 0 | 51439.3 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| mixedWorkflow | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 158600 | 158600 | 0 | 28451.4 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| mixedWorkflow | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 3600 | 3600 | 0 | 23419.5 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| mixedWorkflow | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 2400 | 2400 | 0 | 15463.7 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| mixedWorkflow | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 2200 | 2200 | 0 | 14318.4 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| mixedWorkflow | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 2200 | 2200 | 0 | 14313.0 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| mixedWorkflow | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / authoritative publication | 1800 | 1800 | 0 | 11634.7 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| mixedWorkflow | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 43920 | 43920 | 0 | 7880.1 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| mixedWorkflow | `3f841da7125c119983579db9379fc56b84f58a04111fce7ed360df460b0e7a29` | unattributed | target | invocation / request admission | 1000 | 1000 | 0 | 6541.9 | select "source_sha256" , "lifecycle" , "covered_through_commit_seq" , exists ( select ? from pg_catalog . pg_class index |
| mixedWorkflow | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 29280 | 29280 | 0 | 5215.0 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 10590.2 | 0.6 |
| product | invocation / Worker execution | 9941.3 | 1.0 |
| product | invocation / Worker execution / Worker construction and ready | 88.9 | 88.9 |
| product | invocation / Worker execution / Worker dispatch | 9843.2 | 25.9 |
| product | invocation / Worker execution / Worker dispatch / Application point | 8.9 | 8.9 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 1284.0 | 1284.0 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 1256.5 | 1256.5 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 7215.9 | 7215.9 |
| product | invocation / Worker execution / Worker disposal | 13.7 | 13.7 |
| product | invocation / authoritative publication | 390.2 | 390.2 |
| product | invocation / journal seal and OCC verification | 66.6 | 66.6 |
| product | invocation / request admission | 167.2 | 167.2 |
| productPayload | invocation | 14873.2 | 0.6 |
| productPayload | invocation / Worker execution | 13728.8 | 1.0 |
| productPayload | invocation / Worker execution / Worker construction and ready | 81.7 | 81.7 |
| productPayload | invocation / Worker execution / Worker dispatch | 13626.9 | 30.8 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 8.5 | 8.5 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 1232.1 | 1232.1 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 1223.4 | 1223.4 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 6988.7 | 6988.7 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 1119.7 | 1119.7 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 924.0 | 924.0 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 1123.3 | 1123.3 |
| productPayload | invocation / Worker execution / Worker disposal | 14.0 | 14.0 |
| productPayload | invocation / authoritative publication | 779.1 | 779.1 |
| productPayload | invocation / journal seal and OCC verification | 72.5 | 72.5 |
| productPayload | invocation / request admission | 268.2 | 268.2 |
| mixedWorkflow | invocation | 32294.0 | 0.6 |
| mixedWorkflow | invocation / Worker execution | 30125.8 | 1.0 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 88.8 | 88.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 29957.2 | 33.6 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 9.3 | 9.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 1502.4 | 1502.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 8223.5 | 8223.5 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 14906.3 | 14906.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 1408.5 | 1408.5 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 1131.4 | 1131.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 1393.1 | 1393.1 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 14.0 | 14.0 |
| mixedWorkflow | invocation / authoritative publication | 1314.3 | 1314.3 |
| mixedWorkflow | invocation / journal seal and OCC verification | 99.4 | 99.4 |
| mixedWorkflow | invocation / request admission | 718.8 | 718.8 |

## Failures and uncertainty

Failures: 1. Successful warm percentiles exclude failures; the raw file retains every attempted sample.
- mixedWorkflow-cold-1-0 at invoke: Error; observed diagnostic tokens Native Worker failed, CommerceTransactionError, deadlineExceeded; observed query errors 0, open transactions 0

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
