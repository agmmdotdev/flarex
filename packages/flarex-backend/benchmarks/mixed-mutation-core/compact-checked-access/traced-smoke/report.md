# Private mixed mutation performance baseline

Revision: `b787c05b64bee52795c0689590fcf85e46e33a53`; working diff SHA-256: `9e9e742846029978c9b70fa4ff9936c9482a790e261f83332ff18b3d2d43fd0a`; mode: **smoke**, observation: **traced**.
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
    "role": "flarex_runtime_1790762154599_ycr70gengva",
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
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "0d56ad08566a22234917a1b51480c5da7ad458eeffab0fe27e7485a90e47cf75",
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
    "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts": "54b38f561c0e2174cde66541a19ffd0c48ed675d57aea68d54053ee69b1b5173",
    "packages/persistence-postgres/src/indexBuildStates.ts": "3c680b912497f3e2b69703644761fd534c2e838e46a8e8e180b4332b2fc48307",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "caa8f45162d2503dabca70e9913d3c1084818b1129dc2be669b09427f32a7158",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "a049be738f6ad182319782147833f4f8970b6b63c55b38ac851d4878fc124d76",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "1759afc50aa0f6a65a3bd033183df1b5487929afa9b0cfd5f96d7da56f3da4ff",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "85c59a7568dc238394804dbeffb0f512f64a6b037b790a0fe8569448c1da383e",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "8c0f885569d2e9b7399895fd131598d3064b31d892ddfad3adb57b3bb44d93b3",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "42eb166d505d62259415462e23d0d988fe5b049d531089298c0533d70a21653e",
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
    "packages/persistence-postgres/src/transactionSessionActivation.ts": "466ef0cfa6976955d03bb40a4caa719648c4719d594a725964266207288bbf2e",
    "packages/persistence-postgres/src/transactionSessionAttemptFacet.ts": "fe723a3f8787f29eaa582cdaaf5b1d48919dbe077c3528c0a13f9ee7f2e01ace",
    "packages/persistence-postgres/src/transactionSessionAttemptKernel.ts": "6e6aeb27355e9e94b4c1e52180dc837e3680a52c2288e0884bf3255763542d76",
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
| product | warm | 2/2 | 856.3 | 830.3–882.3 | unavailable | 857.3 | 831.2–883.4 | unavailable | 89.5 | 1.0 | 990.0 | 990.0 | 343.5 | 343.5 |
| product | cold | 1/1 | 831.0 | 831.0–831.0 | unavailable | 832.0 | 832.0–832.0 | unavailable | 86.8 | 1.0 | 994.0 | 994.0 | 344.6 | 344.6 |
| productPayload | warm | 2/2 | 1042.6 | 1037.3–1047.9 | unavailable | 1044.0 | 1038.5–1049.5 | unavailable | 88.3 | 1.5 | 1274.0 | 1274.0 | 437.8 | 437.8 |
| productPayload | cold | 1/1 | 1059.2 | 1059.2–1059.2 | unavailable | 1060.3 | 1060.3–1060.3 | unavailable | 89.3 | 1.1 | 1279.0 | 1279.0 | 451.2 | 451.2 |
| mixedWorkflow | warm | 2/2 | 1920.1 | 1908.3–1931.8 | unavailable | 1922.5 | 1910.8–1934.3 | unavailable | 96.7 | 2.5 | 1997.0 | 1997.0 | 802.5 | 802.5 |
| mixedWorkflow | cold | 1/1 | 1948.2 | 1948.2–1948.2 | unavailable | 1949.8 | 1949.8–1949.8 | unavailable | 86.9 | 1.6 | 2001.0 | 2001.0 | 822.3 | 822.3 |
| standaloneWorkflow | warm | 2/2 | 301.9 | 301.6–302.3 | unavailable | 302.3 | 302.0–302.7 | unavailable | unavailable | 0.4 | 354.0 | 354.0 | 110.1 | 110.1 |
| standaloneWorkflow | cold | 1/1 | 290.0 | 290.0–290.0 | unavailable | 290.3 | 290.3–290.3 | unavailable | unavailable | 0.3 | 354.0 | 354.0 | 102.2 | 102.2 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 13463.2 | 1058.9 | 2364.5 | 4636.1 | unavailable | 21523.5 |
| product | product-cold-0-0 | 10670.1 | 1034.6 | 2304.4 | 0.0 | unavailable | 14009.3 |
| productPayload | productPayload-warm-0-0 | 10336.4 | 1345.5 | 2281.0 | 4574.0 | unavailable | 18537.0 |
| productPayload | productPayload-cold-0-0 | 10159.4 | 1327.8 | 2254.0 | 0.0 | unavailable | 13741.3 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 14879.5 | 4622.4 | 2884.3 | 0.0 | unavailable | 22386.3 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 14231.7 | 4607.8 | 2873.6 | 0.0 | unavailable | 21713.3 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 20924.5 | unavailable | unavailable | unavailable | 1661.0 | 22585.7 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 17350.0 | unavailable | unavailable | unavailable | 1630.1 | 18980.1 |

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
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 44 | 981.4 | 19.7–28.5 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 766.3 | 20.9–31.3 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 641.8 | 17.9–25.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 626.1 | 16.7–23.9 |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 10 | 579.3 | 0.8–270.7 |
| mixedWorkflow | target | invocation / request admission | commit | 36 | 311.7 | 0.8–23.7 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 4 | 305.9 | 1.0–152.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 8 | 184.1 | 20.9–27.1 |
| productPayload | target | invocation / request admission | commit | 24 | 162.0 | 0.9–19.0 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 10 | 158.4 | 2.5–57.3 |
| productPayload | target | invocation / authoritative publication | commit | 4 | 154.4 | 0.9–76.9 |
| product | target | invocation / authoritative publication | commit | 4 | 148.7 | 0.9–77.2 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 6 | 143.7 | 22.0–26.7 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 8 | 141.4 | 16.6–20.6 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 10 | 129.7 | 2.4–46.7 |
| product | target | invocation / journal seal and OCC verification | commit | 10 | 125.8 | 2.6–41.4 |
| product | target | invocation / request admission | commit | 20 | 122.8 | 1.0–18.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 6 | 106.5 | 17.1–18.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 4 | 90.6 | 21.0–25.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 88.4 | 20.3–24.7 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 82.3 | 18.1–23.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 4 | 78.7 | 17.8–22.4 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 4 | 77.6 | 17.6–22.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 73.4 | 17.2–19.6 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 4 | 69.8 | 17.0–18.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 15.8 | 3.8–4.1 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 14.2 | 3.4–3.7 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 13.7 | 3.3–3.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 2 | 5.6 | 2.7–2.9 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 2 | 5.6 | 2.5–3.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 2 | 5.2 | 2.4–2.8 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 2 | 1.5 | 0.7–0.8 |
| product | control | invocation / request admission | commit | 2 | 1.5 | 0.7–0.8 |
| productPayload | control | invocation / request admission | commit | 2 | 1.4 | 0.7–0.7 |
| mixedWorkflow | control | invocation / request admission | commit | 2 | 1.4 | 0.7–0.7 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 1164 | 1164 | 0 | 504.2 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 876 | 876 | 0 | 386.6 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 884 | 884 | 0 | 336.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 884 | 884 | 0 | 329.8 |
| mixedWorkflow | unattributed | target | invocation / request admission | 532 | 532 | 0 | 174.6 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 440 | 440 | 0 | 155.2 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 404 | 404 | 0 | 135.3 |
| productPayload | unattributed | target | invocation / request admission | 322 | 322 | 0 | 97.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 204 | 204 | 0 | 92.9 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 204 | 204 | 0 | 77.0 |
| product | unattributed | target | invocation / request admission | 252 | 252 | 0 | 75.6 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 170 | 170 | 0 | 75.4 |
| productPayload | unattributed | target | invocation / authoritative publication | 258 | 258 | 0 | 75.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 156 | 156 | 0 | 71.9 |
| product | unattributed | target | invocation / authoritative publication | 246 | 246 | 0 | 70.5 |
| product | unattributed | target | invocation / journal seal and OCC verification | 170 | 170 | 0 | 68.2 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 170 | 170 | 0 | 65.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 156 | 156 | 0 | 57.0 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 226 | 226 | 0 | 55.8 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 102 | 102 | 0 | 47.8 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 102 | 102 | 0 | 43.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 102 | 102 | 0 | 41.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 102 | 102 | 0 | 41.1 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 102 | 102 | 0 | 38.9 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 102 | 102 | 0 | 37.4 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 102 | 102 | 0 | 36.8 |
| mixedWorkflow | unattributed | control | invocation / request admission | 78 | 78 | 0 | 21.5 |
| productPayload | unattributed | control | invocation / request admission | 66 | 66 | 0 | 14.6 |
| product | unattributed | control | invocation / request admission | 62 | 62 | 0 | 14.2 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 62 | 62 | 0 | 12.8 |
| product | unattributed | control | invocation / authoritative publication | 34 | 34 | 0 | 10.9 |
| product | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.7 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 9.7 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.4 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.2 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 42 | 42 | 0 | 9.1 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 8.5 |
| productPayload | unattributed | control | invocation / authoritative publication | 38 | 38 | 0 | 8.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 8.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 5.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 5.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 5.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.5 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.8 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.4 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4 | 4 | 0 | 1.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.1 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1419:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.0 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1419:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.8 |
| product | at .packages/persistence-postgres/src/appRows.ts:1419:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.7 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1448:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.6 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1448:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |
| product | at .packages/persistence-postgres/src/appRows.ts:1448:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 88.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 27.8 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `4dd1e551a34910acd57f0ba24b78de0ed6345e33fad3d1e7b71b1667d5e741e1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 16.5 | select "fx_system_data_binding_activation" . "scope_id" , "fx_system_data_binding_activation" . "storage_generation" , " |
| product | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 64 | 64 | 0 | 15.5 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| product | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 15.5 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 14.1 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 13.7 | commit |
| product | `f23e4a40858f630ac0a88d3447e83558dcdd166cf2adbb1d7e966b60dbcffd18` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 11.6 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `1ef045bce5b164d59d31d390156f605cacd0d08f0364fe24a209b9ce11478846` | unattributed | target | invocation / request admission | 4 | 4 | 0 | 11.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 10.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 10.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `959bcc422a7e86e91547288ce37a0dc6c5d46f47e21e537ebde19f0458419633` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 10.5 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 86.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 27.5 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 20.8 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `e06d6a7b793e6b1af2bbf22286276bc1f2d4f78bf36dd560a94e3bbe8ad97cd3` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 17.8 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `4dd1e551a34910acd57f0ba24b78de0ed6345e33fad3d1e7b71b1667d5e741e1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 16.1 | select "fx_system_data_binding_activation" . "scope_id" , "fx_system_data_binding_activation" . "storage_generation" , " |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 6 | 6 | 0 | 15.8 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 14.0 | commit |
| productPayload | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 64 | 64 | 0 | 12.0 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 11.8 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `37ec6699690bff38b8b9608ac340be2a6598bf79c403f771dc997c352de69188` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 11.4 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `89b738e919617bf087a1472ebbbf34dd5407a1a4bfb042e631089d7722621ea1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 10.9 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / request admission | 4 | 4 | 0 | 10.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 116.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 89.2 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 63.1 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 46.5 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 35.1 | commit |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / request admission | 10 | 10 | 0 | 26.2 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `57dba99ebb6cdf0a6b4efc3bdb5c981a8b1cd077b268feeecc23e19b0157f3e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 25.0 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `4dd1e551a34910acd57f0ba24b78de0ed6345e33fad3d1e7b71b1667d5e741e1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 23.2 | select "fx_system_data_binding_activation" . "scope_id" , "fx_system_data_binding_activation" . "storage_generation" , " |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 22.0 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 88 | 88 | 0 | 20.5 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| mixedWorkflow | `4ec3c032b8c2daed1aa86b3e2b64bf0b64d4fd86eb7a646e2016ad5a039ede66` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 19.6 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| mixedWorkflow | `57dba99ebb6cdf0a6b4efc3bdb5c981a8b1cd077b268feeecc23e19b0157f3e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 19.0 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 23.2 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 36 | 36 | 0 | 13.5 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 9.1 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 9.0 | commit |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 8.6 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 40 | 40 | 0 | 7.4 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 6.0 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 5.4 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| standaloneWorkflow | `cc0f21be214e751eeb7da0d5a545fcb89eaa64ea8b202a74d1721fd4899c4696` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 4.7 | with "capture_clock" as ( select "last_commit_seq" , "epoch" from "fx_system_scope_clock" where "fx_system_scope_clock"  |
| standaloneWorkflow | `b11de4b495c2cb7d6b2c57f9216ebd0fbf1e4649a64fcc86522b2d707f04276c` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 4.5 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 4.1 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 18 | 18 | 0 | 4.0 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 856.3 | 0.6 |
| product | invocation / Worker execution | 588.2 | 1.0 |
| product | invocation / Worker execution / Worker construction and ready | 89.4 | 89.4 |
| product | invocation / Worker execution / Worker dispatch | 477.0 | 24.3 |
| product | invocation / Worker execution / Worker dispatch / Application point | 5.5 | 5.5 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 45.2 | 45.2 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 47.7 | 47.7 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 349.0 | 349.0 |
| product | invocation / Worker execution / Worker disposal | 20.7 | 20.7 |
| product | invocation / authoritative publication | 92.3 | 92.3 |
| product | invocation / journal seal and OCC verification | 88.9 | 88.9 |
| product | invocation / request admission | 86.2 | 86.2 |
| productPayload | invocation | 1042.6 | 0.7 |
| productPayload | invocation / Worker execution | 751.3 | 0.8 |
| productPayload | invocation / Worker execution / Worker construction and ready | 88.2 | 88.2 |
| productPayload | invocation / Worker execution / Worker dispatch | 648.2 | 28.7 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 5.1 | 5.1 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 45.4 | 45.4 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 42.6 | 42.6 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 339.7 | 339.7 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 63.3 | 63.3 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 38.6 | 38.6 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 39.9 | 39.9 |
| productPayload | invocation / Worker execution / Worker disposal | 14.0 | 14.0 |
| productPayload | invocation / authoritative publication | 94.6 | 94.6 |
| productPayload | invocation / journal seal and OCC verification | 90.0 | 90.0 |
| productPayload | invocation / request admission | 106.1 | 106.1 |
| mixedWorkflow | invocation | 1920.1 | 0.7 |
| mixedWorkflow | invocation / Worker execution | 1441.2 | 1.0 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 96.7 | 96.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 1329.0 | 31.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 6.0 | 6.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 50.7 | 50.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 411.3 | 411.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 591.5 | 591.5 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 81.4 | 81.4 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 49.8 | 49.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 50.5 | 50.5 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 14.5 | 14.5 |
| mixedWorkflow | invocation / authoritative publication | 178.9 | 178.9 |
| mixedWorkflow | invocation / journal seal and OCC verification | 111.4 | 111.4 |
| mixedWorkflow | invocation / request admission | 187.9 | 187.9 |
| standaloneWorkflow | invocation | 301.9 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 301.9 | 301.9 |

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
