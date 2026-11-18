# Private mixed mutation performance baseline

Revision: `37bb9fd238e50a5b5d44953015ec71b3f8bd0b59`; working diff SHA-256: `0bd8e70de541a829301aae6c11c723941703f10a333520714001f00436daeed4`; mode: **smoke**, observation: **traced**.
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
    "role": "flarex_runtime_1790775305856_32ylcxgp8em",
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
    "packages/persistence-postgres/src/appRows.ts": "0150bb1dc614b0303cf52743306e3b7578203feb387aa41ed6501afaf17aec41",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "d2f059b8c8b94c68d65d3d0ec328af207592cfe2fcca21d45af6591c2ff5905a",
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
    "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts": "e8faaa766cfc7106a78b5dd52a73b583feff31876a64906bb57724f7a90582e2",
    "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts": "54b38f561c0e2174cde66541a19ffd0c48ed675d57aea68d54053ee69b1b5173",
    "packages/persistence-postgres/src/indexBuildStates.ts": "3c680b912497f3e2b69703644761fd534c2e838e46a8e8e180b4332b2fc48307",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "9c0f377eb32aaf6ed5b2badcfd7215294801575ff90bcfdb91e2b0a4ef5007ef",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "a049be738f6ad182319782147833f4f8970b6b63c55b38ac851d4878fc124d76",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "68a442e4ecbf56cc4e61a9bb6f4f817c5b994db4c337c4ea39fc974d1f488116",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "4fe028417cac3de58d411a9034470417a7b0f60ded89266750f54c44a5009595",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "8c0f885569d2e9b7399895fd131598d3064b31d892ddfad3adb57b3bb44d93b3",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "da871af08d7c0d4f853774a30e3b7f3e4ce91d3d9e2378b4455e376ec71cf7ac",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "ab9e2544222c091318fc2a87abf8628be71bc4b89473c5866d8e1bd2f65b80dc",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "fe528f91becf85aeb68adb3f5e0a97c06dc965e967d9d8cddebc7d15b6a56c5e",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "0c12c73b9bf05774cd7c56e755aa07f2452f926da37fc80399210fbf2ad45169",
    "packages/persistence-postgres/src/pointCommitTransaction.ts": "692dbcc61809e2ff14c210df11d42b45c5e60c9f20cc9017ccf6a02423fabf20",
    "packages/persistence-postgres/src/postgres.ts": "ef60f726bdb0569d5773d6fc22dbe2bb344494939931b250322873ddcc2941f0",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts": "d5b289e8d6231f6aa09aa7cdb226cc87421c55aef5c01a8545c769b30881d29d",
    "packages/persistence-postgres/src/schema.ts": "f8edf52239fba608f7a09d9d772be0b5bb7b3d3daeb08a561ba17f159e0f410f",
    "packages/persistence-postgres/src/sessionJournalStore.ts": "33246eaf44a449862bd92f2f1966a699ea46cbc5fe12b2dc6b0f857b39b3d1bb",
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
| product | warm | 2/2 | 883.7 | 862.0–905.4 | unavailable | 884.8 | 863.0–906.7 | unavailable | 82.8 | 1.1 | 988.0 | 988.0 | 360.5 | 360.5 |
| product | cold | 1/1 | 1217.2 | 1217.2–1217.2 | unavailable | 1218.3 | 1218.3–1218.3 | unavailable | 90.9 | 1.1 | 992.0 | 992.0 | 621.5 | 621.5 |
| productPayload | warm | 2/2 | 1121.3 | 1120.4–1122.1 | unavailable | 1122.8 | 1121.7–1123.8 | unavailable | 84.6 | 1.5 | 1252.0 | 1252.0 | 474.9 | 474.9 |
| productPayload | cold | 1/1 | 1161.5 | 1161.5–1161.5 | unavailable | 1162.8 | 1162.8–1162.8 | unavailable | 93.5 | 1.3 | 1262.0 | 1262.0 | 487.6 | 487.6 |
| mixedWorkflow | warm | 2/2 | 1963.7 | 1905.2–2022.1 | unavailable | 1966.2 | 1907.5–2024.9 | unavailable | 85.5 | 2.5 | 1979.0 | 1979.0 | 828.3 | 828.3 |
| mixedWorkflow | cold | 1/1 | 1833.4 | 1833.4–1833.4 | unavailable | 1835.0 | 1835.0–1835.0 | unavailable | 83.5 | 1.6 | 1983.0 | 1983.0 | 787.1 | 787.1 |
| standaloneWorkflow | warm | 2/2 | 332.2 | 321.0–343.4 | unavailable | 332.6 | 321.4–343.9 | unavailable | unavailable | 0.5 | 354.0 | 354.0 | 119.1 | 119.1 |
| standaloneWorkflow | cold | 1/1 | 392.1 | 392.1–392.1 | unavailable | 392.6 | 392.6–392.6 | unavailable | unavailable | 0.4 | 354.0 | 354.0 | 145.4 | 145.4 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 11628.8 | 1092.7 | 2464.6 | 4664.9 | unavailable | 19851.7 |
| product | product-cold-0-0 | 12348.2 | 1533.3 | 3562.3 | 0.0 | unavailable | 17443.8 |
| productPayload | productPayload-warm-0-0 | 13429.5 | 1508.1 | 2628.6 | 5132.9 | unavailable | 22699.3 |
| productPayload | productPayload-cold-0-0 | 11103.2 | 1448.3 | 2476.8 | 0.0 | unavailable | 15028.4 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 15183.7 | 4928.1 | 3008.1 | 0.0 | unavailable | 23119.9 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 16166.4 | 4955.0 | 3226.5 | 0.0 | unavailable | 24347.9 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 17175.3 | unavailable | unavailable | unavailable | 1756.8 | 18932.3 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 16892.3 | unavailable | unavailable | unavailable | 1821.5 | 18713.8 |

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
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 44 | 1056.7 | 14.9–30.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 711.6 | 18.5–30.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 688.4 | 18.7–24.6 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 684.5 | 18.5–28.7 |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 10 | 637.4 | 0.9–305.9 |
| mixedWorkflow | target | invocation / request admission | commit | 36 | 347.5 | 0.9–24.1 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 4 | 331.4 | 1.2–166.0 |
| productPayload | target | invocation / authoritative publication | commit | 4 | 186.3 | 1.2–92.1 |
| productPayload | target | invocation / request admission | commit | 24 | 173.2 | 1.0–19.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 8 | 172.9 | 13.9–33.0 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 10 | 158.7 | 2.7–57.1 |
| product | target | invocation / authoritative publication | commit | 4 | 155.1 | 1.0–79.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 8 | 139.8 | 14.0–21.5 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 10 | 137.8 | 2.4–48.3 |
| product | target | invocation / request admission | commit | 20 | 133.1 | 1.1–20.7 |
| product | target | invocation / journal seal and OCC verification | commit | 10 | 128.9 | 2.9–41.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 6 | 116.8 | 15.4–25.2 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 6 | 98.7 | 13.7–20.8 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 4 | 94.7 | 19.3–27.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 94.2 | 22.1–26.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 92.3 | 19.4–25.5 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 86.2 | 18.0–23.9 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 4 | 82.6 | 18.4–22.0 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 4 | 80.3 | 18.6–22.4 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 4 | 68.8 | 14.7–19.9 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 16.1 | 3.5–5.0 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 15.4 | 3.5–4.4 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 15.0 | 3.5–4.2 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 2 | 5.9 | 2.4–3.5 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 2 | 5.7 | 2.7–3.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 2 | 5.6 | 2.8–2.9 |
| productPayload | control | invocation / request admission | commit | 2 | 1.8 | 0.8–1.0 |
| product | control | invocation / request admission | commit | 2 | 1.7 | 0.8–0.9 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 2 | 1.7 | 0.8–0.9 |
| mixedWorkflow | control | invocation / request admission | commit | 2 | 1.6 | 0.8–0.8 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 1158 | 1158 | 0 | 544.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 876 | 876 | 0 | 377.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 880 | 880 | 0 | 366.8 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 880 | 880 | 0 | 357.0 |
| mixedWorkflow | unattributed | target | invocation / request admission | 532 | 532 | 0 | 190.8 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 440 | 440 | 0 | 173.7 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 404 | 404 | 0 | 144.7 |
| productPayload | unattributed | target | invocation / request admission | 322 | 322 | 0 | 102.2 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 192 | 192 | 0 | 91.9 |
| productPayload | unattributed | target | invocation / authoritative publication | 258 | 258 | 0 | 83.7 |
| product | unattributed | target | invocation / request admission | 252 | 252 | 0 | 81.4 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 188 | 188 | 0 | 79.0 |
| product | unattributed | target | invocation / authoritative publication | 246 | 246 | 0 | 72.2 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 170 | 170 | 0 | 71.0 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 170 | 170 | 0 | 70.2 |
| product | unattributed | target | invocation / journal seal and OCC verification | 170 | 170 | 0 | 68.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 144 | 144 | 0 | 63.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 140 | 140 | 0 | 55.1 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 226 | 226 | 0 | 54.5 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 96 | 96 | 0 | 48.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 102 | 102 | 0 | 48.3 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 102 | 102 | 0 | 47.2 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 102 | 102 | 0 | 44.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 102 | 102 | 0 | 41.4 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 102 | 102 | 0 | 40.0 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 94 | 94 | 0 | 38.3 |
| mixedWorkflow | unattributed | control | invocation / request admission | 78 | 78 | 0 | 21.2 |
| productPayload | unattributed | control | invocation / request admission | 66 | 66 | 0 | 15.9 |
| product | unattributed | control | invocation / request admission | 62 | 62 | 0 | 15.5 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 62 | 62 | 0 | 14.2 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 11.3 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 10.5 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 42 | 42 | 0 | 9.9 |
| product | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.7 |
| productPayload | unattributed | control | invocation / authoritative publication | 38 | 38 | 0 | 9.7 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 9.4 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 9.1 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 8.9 |
| product | unattributed | control | invocation / authoritative publication | 34 | 34 | 0 | 8.6 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 6.3 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 5.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 5.7 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.6 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.5 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.0 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.4 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.2 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4 | 4 | 0 | 1.2 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.1 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.0 |
| product | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.8 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.7 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.5 |
| product | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 87.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 29.2 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `4dd1e551a34910acd57f0ba24b78de0ed6345e33fad3d1e7b71b1667d5e741e1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 19.5 | select "fx_system_data_binding_activation" . "scope_id" , "fx_system_data_binding_activation" . "storage_generation" , " |
| product | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 15.0 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 14.8 | commit |
| product | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 64 | 64 | 0 | 13.1 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| product | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 11.4 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `f866e89306489d86008bf5831891b716054c270deb4bbfd87354f4118e34193e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 11.4 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| product | `5c5edd803b965b6966aef960b6c6c56b1f6d0b03e228930808844ff8bfff77da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 11.3 | select "scope_uuid" , "session_id" , "attempt_fence" , "snapshot_epoch_uuid" , "snapshot_commit_seq" , "lease_expires_at |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 10.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 10.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `1ef045bce5b164d59d31d390156f605cacd0d08f0364fe24a209b9ce11478846` | unattributed | target | invocation / request admission | 4 | 4 | 0 | 10.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 93.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 28.4 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 24.3 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `4dd1e551a34910acd57f0ba24b78de0ed6345e33fad3d1e7b71b1667d5e741e1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 18.2 | select "fx_system_data_binding_activation" . "scope_id" , "fx_system_data_binding_activation" . "storage_generation" , " |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 6 | 6 | 0 | 17.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 64 | 64 | 0 | 16.7 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 16.4 | commit |
| productPayload | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 14.7 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 13.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 13.2 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 12.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 11.8 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 128.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 92.0 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 40 | 40 | 0 | 58.5 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / request admission | 10 | 10 | 0 | 27.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 27.3 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| mixedWorkflow | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 88 | 88 | 0 | 27.2 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| mixedWorkflow | `4dd1e551a34910acd57f0ba24b78de0ed6345e33fad3d1e7b71b1667d5e741e1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 25.7 | select "fx_system_data_binding_activation" . "scope_id" , "fx_system_data_binding_activation" . "storage_generation" , " |
| mixedWorkflow | `cee4f47101805ddfb136e3188b3df8fffc406750d74e79e86009acf9769284b9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 36 | 36 | 0 | 24.8 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 23.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `fea27384148e86304070a70ff56d9b3091f37f3ba52bf39704f9cd37044018e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 60 | 60 | 0 | 20.6 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 20.2 | commit |
| mixedWorkflow | `23ecae9c52871046872fa24bf0ff7b63adffcfd671f0b9e1db804135609f18ab` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 36 | 36 | 0 | 19.9 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 26.6 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 36 | 36 | 0 | 15.6 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 11.3 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 8.5 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 40 | 40 | 0 | 8.3 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 6.2 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 6.0 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| standaloneWorkflow | `cc0f21be214e751eeb7da0d5a545fcb89eaa64ea8b202a74d1721fd4899c4696` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 4.6 | with "capture_clock" as ( select "last_commit_seq" , "epoch" from "fx_system_scope_clock" where "fx_system_scope_clock"  |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 18 | 18 | 0 | 4.6 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 4.6 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `2de54acea7490285a5554ed836048f4ef22eb0862fb3149d0a7f7eda3f3c3297` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 4 | 4 | 0 | 4.1 | with requested ( ordinal , scope_uuid , index_definition_id , encoded_key , row_id ) as ( values ( $? : : integer , $? : |
| standaloneWorkflow | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 4.1 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 883.7 | 0.7 |
| product | invocation / Worker execution | 603.7 | 1.1 |
| product | invocation / Worker execution / Worker construction and ready | 82.8 | 82.8 |
| product | invocation / Worker execution / Worker dispatch | 506.3 | 25.1 |
| product | invocation / Worker execution / Worker dispatch / Application point | 5.7 | 5.7 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 47.2 | 47.2 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 51.2 | 51.2 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 371.5 | 371.5 |
| product | invocation / Worker execution / Worker disposal | 13.6 | 13.6 |
| product | invocation / authoritative publication | 96.6 | 96.6 |
| product | invocation / journal seal and OCC verification | 89.5 | 89.5 |
| product | invocation / request admission | 93.1 | 93.1 |
| productPayload | invocation | 1121.3 | 0.7 |
| productPayload | invocation / Worker execution | 796.1 | 1.0 |
| productPayload | invocation / Worker execution / Worker construction and ready | 84.6 | 84.6 |
| productPayload | invocation / Worker execution / Worker dispatch | 697.1 | 30.4 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 5.5 | 5.5 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 48.6 | 48.6 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 53.1 | 53.1 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 374.2 | 374.2 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 59.2 | 59.2 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 39.5 | 39.5 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 41.7 | 41.7 |
| productPayload | invocation / Worker execution / Worker disposal | 13.5 | 13.5 |
| productPayload | invocation / authoritative publication | 113.3 | 113.3 |
| productPayload | invocation / journal seal and OCC verification | 97.4 | 97.4 |
| productPayload | invocation / request admission | 113.6 | 113.6 |
| mixedWorkflow | invocation | 1963.7 | 0.7 |
| mixedWorkflow | invocation / Worker execution | 1442.9 | 1.2 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 85.5 | 85.5 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 1342.4 | 33.6 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 6.0 | 6.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 53.8 | 53.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 389.0 | 389.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 636.7 | 636.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 68.9 | 68.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 44.3 | 44.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 53.3 | 53.3 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 13.8 | 13.8 |
| mixedWorkflow | invocation / authoritative publication | 194.6 | 194.6 |
| mixedWorkflow | invocation / journal seal and OCC verification | 117.0 | 117.0 |
| mixedWorkflow | invocation / request admission | 208.5 | 208.5 |
| standaloneWorkflow | invocation | 332.2 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 332.2 | 332.2 |

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
