# Private mixed mutation performance baseline

Revision: `6e5cab99de498a8e8b8873dfbf2da5a046723ce8`; working diff SHA-256: `c5cea19dc66f79f28e87ae68127da18a4b111e95cf7f2aeb9f0bdde6a2ec5b16`; mode: **smoke**, observation: **traced**.
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
    "role": "flarex_runtime_1790605042996_dvpqy7ncsh6",
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
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "5a473ad6f2835075a04b1c811ef0655036651e784bbcb301c67bf287f3ee6aaa",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "e0df5ba6534a52199b11290a77ef6db7bb1a5af3f15977ceaf7cfc70eb94e462",
    "packages/flarex-backend/test/support/mixedMutationCpuProfile.ts": "2c7815c287028037f77789dbf9917906433d1b5f851056d265559a5dd9eaa0c0",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "1ff079da5c937ba1988107fc4233abc03d9b43015069dc3f197d6e664fd610a3",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/executor/src/pointMutationJournal.ts": "e5da662862e0dbb0505e082c936e4a20516927424092d8bd35f99c5cb5623b46",
    "packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts": "516cffc5d0b39a142e3ace6a3182f0f2d768e66b84506176449f9325825e3522",
    "packages/persistence-postgres/drizzle/0119_protected_metadata_epoch.sql": "6330d5e0e51c4e165f9e359c36acefbd29906a6047a88d606026880bfe9b9651",
    "packages/persistence-postgres/src/appRows.ts": "ca7a2a67f70e587da10b5a796bfdde20f84bcb0cd7dc4e0bc22e27bcbac6ad0e",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "f675c6876afe541c8f1e93ee15214164961a9e60dfac3c405e9604d43e39211a",
    "packages/persistence-postgres/src/applicationActiveHeadRead.ts": "334292b9065fe1bc379c13683b7f0143c5f20aa361d91a456360fd00230c93f9",
    "packages/persistence-postgres/src/applicationActivation.ts": "97e98c832bd8691122199e089cea29ecfea473cdd41abaa6a403b9ff49dcd8c2",
    "packages/persistence-postgres/src/applicationBindingProjection.ts": "c77127551841e0e1ab2b3ffe3f6f279c0119b163d3a0da333a309c2c4e5abe95",
    "packages/persistence-postgres/src/applicationReadiness.ts": "2d764741da4b91341f1ef14f2ff62a2ccea14feb60121a8c355d031150739923",
    "packages/persistence-postgres/src/applicationRelationReadinessFold.ts": "c9e3c34a1d7eb4de52d47c04480c0bd290530cbd4c1ea17bb83ccd61709ce06f",
    "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts": "612c1b55c904dd994f3a6647cc289b89378af5d671c7ce025931b0b267cbf932",
    "packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts": "3212ab7655f5189195cd56c07f8724f227f4b2ed8ae84c76b3b57daa01638fa0",
    "packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts": "51c456fdbcc2e0c3b8c2acda877748924ed6c62c6bb8cccaae941370c163b568",
    "packages/persistence-postgres/src/drizzleSchema.ts": "195bd525e02fdf9251b2516fa3e4da088a45e9c8b2b2cc23ec1ec899d9022b0a",
    "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts": "51b267a355032d262744ed401b094d264cca20fdac05a8d8c95ebcd1a050cfac",
    "packages/persistence-postgres/src/indexBuildStates.ts": "3c680b912497f3e2b69703644761fd534c2e838e46a8e8e180b4332b2fc48307",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "caa8f45162d2503dabca70e9913d3c1084818b1129dc2be669b09427f32a7158",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "7930c096ab16cdfd3f145977d3ac13a6d63b00f51511635b8a2ac33b793927e9",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "1759afc50aa0f6a65a3bd033183df1b5487929afa9b0cfd5f96d7da56f3da4ff",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "85c59a7568dc238394804dbeffb0f512f64a6b037b790a0fe8569448c1da383e",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "d13940817929d8109399741c40506d247b3746ed583860d4a675c193facb48e6",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "ef2fb898a3cfeda8da8963111b03e99bbcc24a8f9cfba18ff9c228267dc03591",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "86541a5150bbaeb44b1794feef4ea9b2d65ccaaed162debc571af07e2b128f4a",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "c30e410ac6d28fdbc4c35e2387d0ff544c5edf5c7449f1ee788fcedb678e9934",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "04ded904cc88862bc655b4e8a606f292f483d7b0e066f4683943a15291b2e207",
    "packages/persistence-postgres/src/pointCommitTransaction.ts": "c57e9802c1f088d23076b9bcb4664514e41eca1d882b75acaf0d24851fa4aa3c",
    "packages/persistence-postgres/src/postgres.ts": "ef60f726bdb0569d5773d6fc22dbe2bb344494939931b250322873ddcc2941f0",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts": "d5b289e8d6231f6aa09aa7cdb226cc87421c55aef5c01a8545c769b30881d29d",
    "packages/persistence-postgres/src/schema.ts": "f8edf52239fba608f7a09d9d772be0b5bb7b3d3daeb08a561ba17f159e0f410f",
    "packages/persistence-postgres/src/sessionJournalStore.ts": "c8d14428fdd40d2425ed8f858caf3fbeaec1b7f04979a02bbcd037d7de3f6720",
    "packages/persistence-postgres/src/storedCommitAuthority/materialization.ts": "26db0f130f05af1551e8a6980a40cedbad894ab973f34bb66073a085505398ff",
    "packages/persistence-postgres/src/storedCommitAuthority/postgresLoader.ts": "d483bb8175e4aaf3bf80400f05a39670bf46a3f78f43748c57c3c2910688b15c",
    "packages/persistence-postgres/src/transactionSessionActivation.ts": "c62ba508dd4bcb9833a4dc23a0dd56282eceb34403dbab74146203151260532e",
    "packages/persistence-postgres/src/transactionSessionAttemptFacet.ts": "fe723a3f8787f29eaa582cdaaf5b1d48919dbe077c3528c0a13f9ee7f2e01ace",
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
| product | warm | 2/2 | 1638.2 | 1613.8–1662.5 | unavailable | 1640.4 | 1616.0–1664.9 | unavailable | 81.8 | 2.2 | 2256.0 | 2256.0 | 773.5 | 773.5 |
| product | cold | 1/1 | 1616.7 | 1616.7–1616.7 | unavailable | 1618.6 | 1618.6–1618.6 | unavailable | 80.3 | 2.0 | 2260.0 | 2260.0 | 771.5 | 771.5 |
| productPayload | warm | 2/2 | 2137.6 | 2136.7–2138.5 | unavailable | 2140.8 | 2140.1–2141.4 | unavailable | 87.7 | 3.2 | 3018.0 | 3018.0 | 1015.4 | 1015.4 |
| productPayload | cold | 1/1 | 2105.1 | 2105.1–2105.1 | unavailable | 2107.5 | 2107.5–2107.5 | unavailable | 79.5 | 2.4 | 3025.0 | 3025.0 | 1020.3 | 1020.3 |
| mixedWorkflow | warm | 2/2 | 4562.6 | 4561.1–4564.0 | unavailable | 4569.3 | 4568.2–4570.4 | unavailable | 87.4 | 6.8 | 5872.0 | 5872.0 | 2135.3 | 2135.3 |
| mixedWorkflow | cold | 1/1 | 4641.1 | 4641.1–4641.1 | unavailable | 4646.9 | 4646.9–4646.9 | unavailable | 93.6 | 5.8 | 5876.0 | 5876.0 | 2215.8 | 2215.8 |
| standaloneWorkflow | warm | 2/2 | 317.2 | 313.2–321.2 | unavailable | 317.6 | 313.6–321.6 | unavailable | unavailable | 0.4 | 452.0 | 452.0 | 124.3 | 124.3 |
| standaloneWorkflow | cold | 1/1 | 329.8 | 329.8–329.8 | unavailable | 330.2 | 330.2–330.2 | unavailable | unavailable | 0.5 | 452.0 | 452.0 | 127.5 | 127.5 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 10385.9 | 1049.4 | 2355.6 | 4520.6 | unavailable | 18312.1 |
| product | product-cold-0-0 | 10006.1 | 1029.8 | 2293.7 | 0.0 | unavailable | 13329.7 |
| productPayload | productPayload-warm-0-0 | 9748.9 | 1293.9 | 2303.3 | 4463.5 | unavailable | 17809.7 |
| productPayload | productPayload-cold-0-0 | 9830.0 | 1300.8 | 2309.1 | 0.0 | unavailable | 13440.0 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 13818.1 | 4562.4 | 2874.4 | 0.0 | unavailable | 21255.0 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 13650.1 | 4502.9 | 2863.1 | 0.0 | unavailable | 21016.1 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 15538.3 | unavailable | unavailable | unavailable | 1636.3 | 17174.8 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 15807.3 | unavailable | unavailable | unavailable | 1689.4 | 17496.8 |

## Retained state growth per successful warm request

| Workload | Rows Δ median | Index entries Δ median | Commits Δ median | Events Δ median | Live journal rows Δ median | Sealed attempt bytes median | Live journal bytes Δ median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 12095.0 | 0.0 |
| productPayload | 2.0 | 3.0 | 1.0 | 1.0 | 0.0 | 19305.0 | 0.0 |
| mixedWorkflow | 7.0 | 36.0 | 1.0 | 7.0 | 0.0 | 34020.0 | 0.0 |
| standaloneWorkflow | 5.0 | 33.0 | 1.0 | 6.0 | 0.0 | unavailable | unavailable |

## Observed database transaction intervals in successful warm requests

These BEGIN-to-settlement intervals include application work and waits; they are not lock-hold measurements.

| Workload | Pool | Phase | Outcome | Intervals | Duration total (ms) | Range (ms) |
| --- | --- | --- | --- | ---: | ---: | --- |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 188 | 3920.4 | 19.2–26.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 98 | 2091.8 | 19.1–27.2 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 98 | 1864.1 | 17.0–24.4 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 98 | 1860.5 | 17.1–23.2 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 4 | 716.9 | 1.0–363.6 |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 10 | 611.3 | 0.9–290.1 |
| productPayload | target | invocation / authoritative publication | commit | 4 | 367.8 | 1.0–184.0 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 16 | 351.3 | 19.2–37.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 16 | 337.0 | 19.8–23.1 |
| mixedWorkflow | target | invocation / request admission | commit | 36 | 303.8 | 0.8–20.2 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 16 | 293.4 | 17.1–20.8 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 16 | 288.1 | 17.2–18.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 12 | 252.4 | 19.6–24.3 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 12 | 238.7 | 17.4–24.0 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 12 | 231.5 | 17.7–21.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 12 | 227.5 | 17.3–20.9 |
| product | target | invocation / authoritative publication | commit | 4 | 223.8 | 1.0–112.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 12 | 223.6 | 17.4–20.6 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 10 | 202.5 | 19.3–23.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 10 | 175.6 | 17.3–18.2 |
| productPayload | target | invocation / request admission | commit | 24 | 159.2 | 0.9–18.2 |
| product | target | invocation / request admission | commit | 20 | 127.5 | 0.9–18.6 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 10 | 108.9 | 2.4–33.8 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 10 | 100.0 | 2.6–30.0 |
| product | target | invocation / journal seal and OCC verification | commit | 10 | 89.2 | 2.6–23.9 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 18.2 | 4.2–5.0 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 17.6 | 4.1–5.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 16.8 | 4.0–4.4 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 2 | 9.6 | 3.4–6.3 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 2 | 7.4 | 3.4–4.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.9 | 3.4–3.5 |
| productPayload | control | invocation / request admission | commit | 2 | 1.5 | 0.7–0.7 |
| product | control | invocation / request admission | commit | 2 | 1.4 | 0.7–0.7 |
| mixedWorkflow | control | invocation / request admission | commit | 2 | 1.4 | 0.7–0.7 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 2 | 1.3 | 0.6–0.7 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 5328 | 5328 | 0 | 2016.7 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2820 | 2820 | 0 | 1065.1 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2828 | 2828 | 0 | 1003.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 2828 | 2828 | 0 | 1000.1 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 1068 | 1068 | 0 | 308.3 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 636 | 636 | 0 | 191.8 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 452 | 452 | 0 | 176.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 454 | 454 | 0 | 174.9 |
| mixedWorkflow | unattributed | target | invocation / request admission | 574 | 574 | 0 | 171.2 |
| productPayload | unattributed | target | invocation / authoritative publication | 612 | 612 | 0 | 163.1 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 452 | 452 | 0 | 161.7 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 454 | 454 | 0 | 156.7 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 338 | 338 | 0 | 128.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 338 | 338 | 0 | 126.5 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 338 | 338 | 0 | 124.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 338 | 338 | 0 | 123.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 338 | 338 | 0 | 121.5 |
| product | unattributed | target | invocation / authoritative publication | 378 | 378 | 0 | 105.2 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 282 | 282 | 0 | 102.3 |
| productPayload | unattributed | target | invocation / request admission | 340 | 340 | 0 | 96.7 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 282 | 282 | 0 | 95.5 |
| product | unattributed | target | invocation / request admission | 262 | 262 | 0 | 80.0 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 138 | 138 | 0 | 50.9 |
| product | unattributed | target | invocation / journal seal and OCC verification | 138 | 138 | 0 | 48.5 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 226 | 226 | 0 | 48.2 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 138 | 138 | 0 | 48.2 |
| mixedWorkflow | unattributed | control | invocation / request admission | 78 | 78 | 0 | 16.6 |
| productPayload | unattributed | control | invocation / request admission | 66 | 66 | 0 | 14.0 |
| product | unattributed | control | invocation / request admission | 62 | 62 | 0 | 13.4 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 62 | 62 | 0 | 12.8 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 11.5 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 46 | 46 | 0 | 11.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 46 | 46 | 0 | 10.5 |
| productPayload | unattributed | control | invocation / authoritative publication | 38 | 38 | 0 | 10.4 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 10.1 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 46 | 46 | 0 | 10.0 |
| product | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.4 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.1 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.0 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 42 | 42 | 0 | 8.5 |
| product | unattributed | control | invocation / authoritative publication | 34 | 34 | 0 | 7.3 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 7.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 6.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.0 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.0 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.9 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 1.9 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.7 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.4 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.0 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.0 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4 | 4 | 0 | 0.9 |
| product | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.7 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1425:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.7 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.6 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.5 |
| product | at .packages/persistence-postgres/src/appRows.ts:1454:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 248.5 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 84.3 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 46.6 | commit |
| product | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 44.5 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 41.3 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| product | `e2d412f01de4be988057f5754fb5acbae7b62b0f08572103336e48b331a63611` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 38.9 | select exists ( select ? from "fx_system_tx_journal_receipt" where "scope_uuid" = $? and "session_id" = $? and "attempt_ |
| product | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 196 | 196 | 0 | 35.2 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| product | `f23e4a40858f630ac0a88d3447e83558dcdd166cf2adbb1d7e966b60dbcffd18` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 34.8 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 32.3 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 12 | 12 | 0 | 31.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 12 | 12 | 0 | 30.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `959bcc422a7e86e91547288ce37a0dc6c5d46f47e21e537ebde19f0458419633` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 29.7 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 253.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 83.0 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 47.5 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 196 | 196 | 0 | 42.8 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 41.7 | commit |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 16 | 16 | 0 | 40.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 40.2 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 16 | 16 | 0 | 40.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `e2d412f01de4be988057f5754fb5acbae7b62b0f08572103336e48b331a63611` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 38.7 | select exists ( select ? from "fx_system_tx_journal_receipt" where "scope_uuid" = $? and "session_id" = $? and "attempt_ |
| productPayload | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 36.4 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| productPayload | `37ec6699690bff38b8b9608ac340be2a6598bf79c403f771dc997c352de69188` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 33.7 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 12 | 12 | 0 | 31.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 461.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 258.7 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 243.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 98 | 98 | 0 | 135.7 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `57dba99ebb6cdf0a6b4efc3bdb5c981a8b1cd077b268feeecc23e19b0157f3e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 111.6 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 81.3 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| mixedWorkflow | `4ec3c032b8c2daed1aa86b3e2b64bf0b64d4fd86eb7a646e2016ad5a039ede66` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 78.1 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| mixedWorkflow | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 376 | 376 | 0 | 74.4 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 74.2 | commit |
| mixedWorkflow | `e2d412f01de4be988057f5754fb5acbae7b62b0f08572103336e48b331a63611` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 71.2 | select exists ( select ? from "fx_system_tx_journal_receipt" where "scope_uuid" = $? and "session_id" = $? and "attempt_ |
| mixedWorkflow | `906ab1323cf26f76b75f4cf2498ebaed9e69c359cbdc65221ecc95f18f9f5146` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 71.1 | select "table_id" , "logical_index_id" , "source_sha256" , "lifecycle" , "covered_through_commit_seq" from "fx_system_se |
| mixedWorkflow | `b11de4b495c2cb7d6b2c57f9216ebd0fbf1e4649a64fcc86522b2d707f04276c` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 188 | 188 | 0 | 68.3 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 24.9 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `75536164c67dda9cd26c18f1c366f100cb8ee42931e66ff77c5bd73b8db259cc` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 74 | 74 | 0 | 19.0 | update "fx_system_index_build_state" set "covered_through_commit_seq" = $? , "updated_at" = clock_timestamp ( ) where (  |
| standaloneWorkflow | `0b20168e778a0e45103012aebe4305f22dd3d4601ad3e25a0c194a4d1b3147f4` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 100 | 100 | 0 | 15.8 | select "commit_seq" from "fx_app_row_current" where ( "fx_app_row_current" . "scope_uuid" = $? and "fx_app_row_current"  |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 36 | 36 | 0 | 14.9 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 8.5 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 8.4 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 40 | 40 | 0 | 7.8 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `8ea8d5b22b1f7e46a005e45d34baf72202467700759672f98df650a96caa836e` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 26 | 26 | 0 | 7.0 | update "fx_system_unique_constraint_build" set "covered_through_commit_seq" = $? , "updated_at" = clock_timestamp ( ) wh |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 5.9 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 5.3 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| standaloneWorkflow | `cc0f21be214e751eeb7da0d5a545fcb89eaa64ea8b202a74d1721fd4899c4696` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 4.5 | with "capture_clock" as ( select "last_commit_seq" , "epoch" from "fx_system_scope_clock" where "fx_system_scope_clock"  |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 18 | 18 | 0 | 4.0 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 1638.2 | 0.6 |
| product | invocation / Worker execution | 1355.2 | 0.9 |
| product | invocation / Worker execution / Worker construction and ready | 81.8 | 81.8 |
| product | invocation / Worker execution / Worker dispatch | 1259.0 | 27.1 |
| product | invocation / Worker execution / Worker dispatch / Application point | 6.2 | 6.2 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 123.0 | 123.0 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 127.2 | 127.2 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 968.9 | 968.9 |
| product | invocation / Worker execution / Worker disposal | 13.6 | 13.6 |
| product | invocation / authoritative publication | 126.8 | 126.8 |
| product | invocation / journal seal and OCC verification | 68.2 | 68.2 |
| product | invocation / request admission | 87.4 | 87.4 |
| productPayload | invocation | 2137.6 | 0.7 |
| productPayload | invocation / Worker execution | 1753.7 | 1.1 |
| productPayload | invocation / Worker execution / Worker construction and ready | 87.6 | 87.6 |
| productPayload | invocation / Worker execution / Worker dispatch | 1651.2 | 31.1 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 5.9 | 5.9 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 118.4 | 118.4 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 120.6 | 120.6 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 966.5 | 966.5 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 154.4 | 154.4 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 77.4 | 77.4 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 93.5 | 93.5 |
| productPayload | invocation / Worker execution / Worker disposal | 13.8 | 13.8 |
| productPayload | invocation / authoritative publication | 203.5 | 203.5 |
| productPayload | invocation / journal seal and OCC verification | 76.3 | 76.3 |
| productPayload | invocation / request admission | 103.3 | 103.3 |
| mixedWorkflow | invocation | 4562.6 | 0.6 |
| mixedWorkflow | invocation / Worker execution | 3910.2 | 1.2 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 87.4 | 87.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 3808.1 | 32.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 6.0 | 6.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 132.9 | 132.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 1086.4 | 1086.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 2074.4 | 2074.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 186.7 | 186.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 88.4 | 88.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 106.6 | 106.6 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 13.5 | 13.5 |
| mixedWorkflow | invocation / authoritative publication | 382.9 | 382.9 |
| mixedWorkflow | invocation / journal seal and OCC verification | 87.3 | 87.3 |
| mixedWorkflow | invocation / request admission | 181.5 | 181.5 |
| standaloneWorkflow | invocation | 317.2 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 317.2 | 317.2 |

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
