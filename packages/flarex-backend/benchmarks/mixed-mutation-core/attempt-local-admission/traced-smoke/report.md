# Private mixed mutation performance baseline

Revision: `6ddbf43a5c2f7e299645d5d07beabb2fd36b65fa`; working diff SHA-256: `22eceab87a7031841a7cc855bfe85fead16b70397f4dc2621361810cca407f13`; mode: **smoke**, observation: **traced**.
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
    "role": "flarex_runtime_1790751410531_spsd9nl6w",
    "superuser": false
  },
  "node": "v24.16.0",
  "pgDriver": "8.22.0",
  "platform": "win32",
  "architecture": "x64",
  "cpu": "AMD Ryzen 7 5700G with Radeon Graphics         ",
  "logicalCpus": 16,
  "totalMemoryBytes": 16421470208,
  "targetPoolMax": 10,
  "transport": "pg TCP socket; private Worker bridge is in-process test harness",
  "sourceHashes": {
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "0252fde6e49ec51724640b09aa026c7f89a10408b76493e3fe047ae76b696469",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "5dd6a02b2ece07036eabf0921c04c868bfe9ed7f280a8b0d587f84d5d63ffbb5",
    "packages/flarex-backend/test/support/mixedMutationCpuProfile.ts": "2c7815c287028037f77789dbf9917906433d1b5f851056d265559a5dd9eaa0c0",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "1ff079da5c937ba1988107fc4233abc03d9b43015069dc3f197d6e664fd610a3",
    "packages/medusa-adapter/src/product-attempt.ts": "34720033a89cde4508110fa763211d58d6a2d92c7f0afb0c654c4de27fddf9ae",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/executor/src/pointMutationJournal.ts": "e5da662862e0dbb0505e082c936e4a20516927424092d8bd35f99c5cb5623b46",
    "packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts": "516cffc5d0b39a142e3ace6a3182f0f2d768e66b84506176449f9325825e3522",
    "packages/persistence-postgres/drizzle/0119_protected_metadata_epoch.sql": "6330d5e0e51c4e165f9e359c36acefbd29906a6047a88d606026880bfe9b9651",
    "packages/persistence-postgres/src/appRows.ts": "c8aef8e114ba4cc78034e34f6e740893dc0dc18d234ffc772e4daefa80836c98",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "f480ece70902cb333761ba0aae99c4ad1bf1e75893f64d1b2671d48c53ac4805",
    "packages/persistence-postgres/src/applicationActiveHeadRead.ts": "334292b9065fe1bc379c13683b7f0143c5f20aa361d91a456360fd00230c93f9",
    "packages/persistence-postgres/src/applicationActivation.ts": "97e98c832bd8691122199e089cea29ecfea473cdd41abaa6a403b9ff49dcd8c2",
    "packages/persistence-postgres/src/applicationBindingProjection.ts": "c77127551841e0e1ab2b3ffe3f6f279c0119b163d3a0da333a309c2c4e5abe95",
    "packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts": "ad072323693964f88fb6aee24a7b35abf039652992d70d00c81db4cd9e49f5d8",
    "packages/persistence-postgres/src/applicationReadiness.ts": "2d764741da4b91341f1ef14f2ff62a2ccea14feb60121a8c355d031150739923",
    "packages/persistence-postgres/src/applicationRelationReadinessFold.ts": "c9e3c34a1d7eb4de52d47c04480c0bd290530cbd4c1ea17bb83ccd61709ce06f",
    "packages/persistence-postgres/src/boundedRequestLifetime.ts": "eb640b68d55a2a825e62a7838c46f40ef2c391009cbf6ccc1ab4584956a805c9",
    "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts": "a230f80bf996f5f94db88ec1869698bc1c39f5f340e38368e5a9f3341d298d65",
    "packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts": "83602ba7abc1507298bfb714b132b0b1a4ce616f86cc41b17b6ceb0337f52579",
    "packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts": "f7b59769ec3c2025fcd5f17b728cdf885d30a764246bb264915e0175af763950",
    "packages/persistence-postgres/src/drizzleSchema.ts": "195bd525e02fdf9251b2516fa3e4da088a45e9c8b2b2cc23ec1ec899d9022b0a",
    "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts": "51b267a355032d262744ed401b094d264cca20fdac05a8d8c95ebcd1a050cfac",
    "packages/persistence-postgres/src/indexBuildStates.ts": "3c680b912497f3e2b69703644761fd534c2e838e46a8e8e180b4332b2fc48307",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "caa8f45162d2503dabca70e9913d3c1084818b1129dc2be669b09427f32a7158",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "a049be738f6ad182319782147833f4f8970b6b63c55b38ac851d4878fc124d76",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "1759afc50aa0f6a65a3bd033183df1b5487929afa9b0cfd5f96d7da56f3da4ff",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "85c59a7568dc238394804dbeffb0f512f64a6b037b790a0fe8569448c1da383e",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "8c0f885569d2e9b7399895fd131598d3064b31d892ddfad3adb57b3bb44d93b3",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "ef2fb898a3cfeda8da8963111b03e99bbcc24a8f9cfba18ff9c228267dc03591",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "b2d7a1d40c33fa583f927677b62b74d8a6a30bb6f31c31528504be0a631b8efd",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "c30e410ac6d28fdbc4c35e2387d0ff544c5edf5c7449f1ee788fcedb678e9934",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "04ded904cc88862bc655b4e8a606f292f483d7b0e066f4683943a15291b2e207",
    "packages/persistence-postgres/src/pointCommitTransaction.ts": "692dbcc61809e2ff14c210df11d42b45c5e60c9f20cc9017ccf6a02423fabf20",
    "packages/persistence-postgres/src/postgres.ts": "ef60f726bdb0569d5773d6fc22dbe2bb344494939931b250322873ddcc2941f0",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts": "d5b289e8d6231f6aa09aa7cdb226cc87421c55aef5c01a8545c769b30881d29d",
    "packages/persistence-postgres/src/schema.ts": "f8edf52239fba608f7a09d9d772be0b5bb7b3d3daeb08a561ba17f159e0f410f",
    "packages/persistence-postgres/src/sessionJournalStore.ts": "05132b52e602808cdfb031b80de75eb8bba547d4db0fb6593caa3def8ea0cd1e",
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
| product | warm | 2/2 | 878.7 | 856.0–901.4 | unavailable | 879.7 | 856.9–902.6 | unavailable | 88.2 | 1.0 | 1063.0 | 1063.0 | 363.5 | 363.5 |
| product | cold | 1/1 | 875.0 | 875.0–875.0 | unavailable | 876.1 | 876.1–876.1 | unavailable | 87.0 | 1.1 | 1067.0 | 1067.0 | 363.9 | 363.9 |
| productPayload | warm | 2/2 | 1058.0 | 1047.9–1068.1 | unavailable | 1059.5 | 1049.7–1069.4 | unavailable | 87.1 | 1.5 | 1378.0 | 1378.0 | 451.9 | 451.9 |
| productPayload | cold | 1/1 | 1286.9 | 1286.9–1286.9 | unavailable | 1288.0 | 1288.0–1288.0 | unavailable | 240.7 | 1.2 | 1383.0 | 1383.0 | 504.6 | 504.6 |
| mixedWorkflow | warm | 2/2 | 1904.6 | 1881.4–1927.9 | unavailable | 1906.5 | 1883.2–1929.9 | unavailable | 88.7 | 1.9 | 2173.0 | 2173.0 | 800.5 | 800.5 |
| mixedWorkflow | cold | 1/1 | 1964.5 | 1964.5–1964.5 | unavailable | 1966.5 | 1966.5–1966.5 | unavailable | 97.5 | 2.0 | 2177.0 | 2177.0 | 804.6 | 804.6 |
| standaloneWorkflow | warm | 2/2 | 301.6 | 294.4–308.8 | unavailable | 302.1 | 294.9–309.3 | unavailable | unavailable | 0.4 | 361.0 | 361.0 | 109.5 | 109.5 |
| standaloneWorkflow | cold | 1/1 | 298.9 | 298.9–298.9 | unavailable | 299.5 | 299.5–299.5 | unavailable | unavailable | 0.6 | 361.0 | 361.0 | 105.8 | 105.8 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 11625.7 | 1081.0 | 2390.3 | 4510.7 | unavailable | 19608.4 |
| product | product-cold-0-0 | 10781.8 | 1048.1 | 2415.5 | 0.0 | unavailable | 14245.4 |
| productPayload | productPayload-warm-0-0 | 11112.9 | 1345.9 | 2269.5 | 4515.4 | unavailable | 19243.8 |
| productPayload | productPayload-cold-0-0 | 14041.2 | 1436.9 | 2502.4 | 0.0 | unavailable | 17980.6 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 17661.1 | 4692.1 | 2983.6 | 0.0 | unavailable | 25337.1 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 14447.4 | 4617.7 | 2958.8 | 0.0 | unavailable | 22024.1 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 16245.1 | unavailable | unavailable | unavailable | 1719.3 | 17964.6 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 16571.3 | unavailable | unavailable | unavailable | 1675.8 | 18247.2 |

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
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 44 | 999.0 | 20.6–27.3 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 749.2 | 21.4–26.6 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 685.1 | 18.6–30.4 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 639.7 | 17.6–24.0 |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 10 | 577.4 | 0.8–272.8 |
| mixedWorkflow | target | invocation / request admission | commit | 36 | 325.5 | 0.8–23.9 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 4 | 312.8 | 1.0–160.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 8 | 171.9 | 20.7–24.5 |
| productPayload | target | invocation / request admission | commit | 24 | 161.4 | 0.9–18.1 |
| productPayload | target | invocation / authoritative publication | commit | 4 | 153.9 | 1.0–76.8 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 8 | 151.0 | 17.6–21.9 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 10 | 148.4 | 2.7–51.2 |
| product | target | invocation / authoritative publication | commit | 4 | 147.7 | 1.0–73.8 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 10 | 132.5 | 2.5–44.0 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 6 | 130.7 | 21.0–24.3 |
| product | target | invocation / request admission | commit | 20 | 129.9 | 1.0–19.5 |
| product | target | invocation / journal seal and OCC verification | commit | 10 | 128.6 | 2.7–43.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 6 | 112.2 | 18.0–21.1 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 93.4 | 22.0–24.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 4 | 87.3 | 20.7–24.9 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 4 | 81.5 | 19.1–21.7 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 80.9 | 19.0–21.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 79.6 | 18.5–20.6 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 4 | 77.0 | 18.1–20.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 4 | 73.4 | 17.6–19.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 18.4 | 4.1–5.6 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 18.3 | 4.3–4.9 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 16.4 | 4.0–4.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 2 | 7.6 | 3.4–4.3 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 2 | 7.1 | 3.3–3.8 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.3 | 3.1–3.1 |
| product | control | invocation / request admission | commit | 2 | 1.6 | 0.7–0.8 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 2 | 1.5 | 0.7–0.9 |
| mixedWorkflow | control | invocation / request admission | commit | 2 | 1.4 | 0.7–0.8 |
| productPayload | control | invocation / request admission | commit | 2 | 1.4 | 0.7–0.7 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 1296 | 1296 | 0 | 513.8 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 972 | 972 | 0 | 375.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 980 | 980 | 0 | 360.9 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 980 | 980 | 0 | 342.8 |
| mixedWorkflow | unattributed | target | invocation / request admission | 574 | 574 | 0 | 183.3 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 454 | 454 | 0 | 158.1 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 408 | 408 | 0 | 140.2 |
| productPayload | unattributed | target | invocation / request admission | 340 | 340 | 0 | 97.8 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 228 | 228 | 0 | 87.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 228 | 228 | 0 | 80.9 |
| product | unattributed | target | invocation / request admission | 262 | 262 | 0 | 79.5 |
| productPayload | unattributed | target | invocation / authoritative publication | 262 | 262 | 0 | 73.9 |
| product | unattributed | target | invocation / authoritative publication | 250 | 250 | 0 | 70.8 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 176 | 176 | 0 | 69.1 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 176 | 176 | 0 | 68.7 |
| product | unattributed | target | invocation / journal seal and OCC verification | 176 | 176 | 0 | 68.5 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 174 | 174 | 0 | 68.0 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 174 | 174 | 0 | 61.4 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 226 | 226 | 0 | 51.5 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 114 | 114 | 0 | 46.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 114 | 114 | 0 | 45.4 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 114 | 114 | 0 | 41.6 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 114 | 114 | 0 | 41.5 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 114 | 114 | 0 | 41.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 114 | 114 | 0 | 39.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 114 | 114 | 0 | 39.2 |
| mixedWorkflow | unattributed | control | invocation / request admission | 78 | 78 | 0 | 16.9 |
| product | unattributed | control | invocation / request admission | 62 | 62 | 0 | 14.9 |
| productPayload | unattributed | control | invocation / request admission | 66 | 66 | 0 | 13.8 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 62 | 62 | 0 | 12.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 12.5 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 46 | 46 | 0 | 11.2 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 46 | 46 | 0 | 11.0 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 46 | 46 | 0 | 10.0 |
| product | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.6 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 42 | 42 | 0 | 9.4 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.3 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 8.7 |
| productPayload | unattributed | control | invocation / authoritative publication | 38 | 38 | 0 | 8.0 |
| product | unattributed | control | invocation / authoritative publication | 34 | 34 | 0 | 7.5 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 7.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 26 | 26 | 0 | 6.0 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 3.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 2.5 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.8 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.4 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1419:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.2 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.0 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.0 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.0 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1448:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.9 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1419:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.8 |
| product | at .packages/persistence-postgres/src/appRows.ts:1419:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.7 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1448:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |
| product | at .packages/persistence-postgres/src/appRows.ts:1448:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 87.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 28.8 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 15.8 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 14.6 | commit |
| product | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 14.6 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| product | `e2d412f01de4be988057f5754fb5acbae7b62b0f08572103336e48b331a63611` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 13.0 | select exists ( select ? from "fx_system_tx_journal_receipt" where "scope_uuid" = $? and "session_id" = $? and "attempt_ |
| product | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 64 | 64 | 0 | 12.2 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| product | `f23e4a40858f630ac0a88d3447e83558dcdd166cf2adbb1d7e966b60dbcffd18` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 11.8 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `959bcc422a7e86e91547288ce37a0dc6c5d46f47e21e537ebde19f0458419633` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 11.6 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 11.6 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| product | `1ef045bce5b164d59d31d390156f605cacd0d08f0364fe24a209b9ce11478846` | unattributed | target | invocation / request admission | 4 | 4 | 0 | 11.2 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 11.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 83.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 29.9 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 20.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 15.6 | commit |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 6 | 6 | 0 | 15.5 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 15.0 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 13.5 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| productPayload | `e2d412f01de4be988057f5754fb5acbae7b62b0f08572103336e48b331a63611` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 12.0 | select exists ( select ? from "fx_system_tx_journal_receipt" where "scope_uuid" = $? and "session_id" = $? and "attempt_ |
| productPayload | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 11.1 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| productPayload | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 64 | 64 | 0 | 11.0 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| productPayload | `1ef045bce5b164d59d31d390156f605cacd0d08f0364fe24a209b9ce11478846` | unattributed | target | invocation / request admission | 4 | 4 | 0 | 10.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 10.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 115.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 84.2 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 64.1 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 46.6 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `57dba99ebb6cdf0a6b4efc3bdb5c981a8b1cd077b268feeecc23e19b0157f3e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 30.6 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / request admission | 10 | 10 | 0 | 26.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `c1e2c63afb4a03ab0e5ab36e33326aa76c22f87e974c974b65e1664f18a31287` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 21.7 | select "scope_uuid" , "session_id" , "storage_generation" , "storage_generation_fence" , "execution_authority_generation |
| mixedWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | unattributed | target | invocation / authoritative publication | 52 | 52 | 0 | 21.4 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 21.3 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `4ec3c032b8c2daed1aa86b3e2b64bf0b64d4fd86eb7a646e2016ad5a039ede66` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 19.6 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 19.5 | commit |
| mixedWorkflow | `57dba99ebb6cdf0a6b4efc3bdb5c981a8b1cd077b268feeecc23e19b0157f3e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 19.4 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 26.7 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 36 | 36 | 0 | 15.1 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 8.9 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 8.5 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 40 | 40 | 0 | 7.6 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 6.0 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 5.4 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| standaloneWorkflow | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 5.3 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| standaloneWorkflow | `cc0f21be214e751eeb7da0d5a545fcb89eaa64ea8b202a74d1721fd4899c4696` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 4.3 | with "capture_clock" as ( select "last_commit_seq" , "epoch" from "fx_system_scope_clock" where "fx_system_scope_clock"  |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 18 | 18 | 0 | 4.1 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 4.0 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `95f7bea972ff4c054c1da49dc8eaadeacc861aab2e0bfa408d81f5dc6e2b2d02` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 3.4 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 878.7 | 0.6 |
| product | invocation / Worker execution | 610.1 | 1.0 |
| product | invocation / Worker execution / Worker construction and ready | 88.1 | 88.1 |
| product | invocation / Worker execution / Worker dispatch | 507.8 | 28.3 |
| product | invocation / Worker execution / Worker dispatch / Application point | 7.6 | 7.6 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 47.0 | 47.0 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 46.7 | 46.7 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 370.5 | 370.5 |
| product | invocation / Worker execution / Worker disposal | 13.2 | 13.2 |
| product | invocation / authoritative publication | 89.6 | 89.6 |
| product | invocation / journal seal and OCC verification | 88.5 | 88.5 |
| product | invocation / request admission | 89.9 | 89.9 |
| productPayload | invocation | 1058.0 | 0.7 |
| productPayload | invocation / Worker execution | 766.4 | 0.8 |
| productPayload | invocation / Worker execution / Worker construction and ready | 87.1 | 87.1 |
| productPayload | invocation / Worker execution / Worker dispatch | 663.7 | 28.6 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 5.8 | 5.8 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 44.2 | 44.2 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 45.7 | 45.7 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 345.1 | 345.1 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 64.2 | 64.2 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 41.4 | 41.4 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 41.5 | 41.5 |
| productPayload | invocation / Worker execution / Worker disposal | 14.8 | 14.8 |
| productPayload | invocation / authoritative publication | 93.4 | 93.4 |
| productPayload | invocation / journal seal and OCC verification | 92.0 | 92.0 |
| productPayload | invocation / request admission | 105.5 | 105.5 |
| mixedWorkflow | invocation | 1904.6 | 0.7 |
| mixedWorkflow | invocation / Worker execution | 1423.0 | 1.1 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 88.7 | 88.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 1319.9 | 34.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 6.1 | 6.1 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 52.7 | 52.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 402.3 | 402.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 601.1 | 601.1 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 73.9 | 73.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 46.1 | 46.1 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 48.7 | 48.7 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 13.3 | 13.3 |
| mixedWorkflow | invocation / authoritative publication | 182.4 | 182.4 |
| mixedWorkflow | invocation / journal seal and OCC verification | 106.4 | 106.4 |
| mixedWorkflow | invocation / request admission | 192.3 | 192.3 |
| standaloneWorkflow | invocation | 301.6 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 301.6 | 301.6 |

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
