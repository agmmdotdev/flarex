# Private mixed mutation performance baseline

Revision: `37bb9fd238e50a5b5d44953015ec71b3f8bd0b59`; working diff SHA-256: `88428bcf746beecf4dfe80ac4c292d2cd7df03dc53dd9e1582167af32ae53f18`; mode: **smoke**, observation: **traced**.
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
    "role": "flarex_runtime_1790771337713_vektrnr41in",
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
    "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts": "9e700811b9c1765b11bfbf77776ddcbf38953b6f9a3358d7eb52ce5da26e1bf4",
    "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts": "54b38f561c0e2174cde66541a19ffd0c48ed675d57aea68d54053ee69b1b5173",
    "packages/persistence-postgres/src/indexBuildStates.ts": "3c680b912497f3e2b69703644761fd534c2e838e46a8e8e180b4332b2fc48307",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "9c0f377eb32aaf6ed5b2badcfd7215294801575ff90bcfdb91e2b0a4ef5007ef",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "a049be738f6ad182319782147833f4f8970b6b63c55b38ac851d4878fc124d76",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "18edd2d3ea945eac062fc4061477f024aa0325db937cff50fc3843c24dd525b8",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "4fe028417cac3de58d411a9034470417a7b0f60ded89266750f54c44a5009595",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "8c0f885569d2e9b7399895fd131598d3064b31d892ddfad3adb57b3bb44d93b3",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "3e3d3d29049349d88ed9c782856a33e8845acb8a23a8de2d713b915a9af516e3",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "ab9e2544222c091318fc2a87abf8628be71bc4b89473c5866d8e1bd2f65b80dc",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "fe528f91becf85aeb68adb3f5e0a97c06dc965e967d9d8cddebc7d15b6a56c5e",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "efe246f66af88eb7e7d81c15c75a0a26b7ab573ff1d806a34eeff8ce0dca980f",
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
| product | warm | 2/2 | 832.1 | 808.2–855.9 | unavailable | 833.0 | 809.1–856.9 | unavailable | 82.8 | 0.9 | 988.0 | 988.0 | 342.5 | 342.5 |
| product | cold | 1/1 | 881.8 | 881.8–881.8 | unavailable | 882.8 | 882.8–882.8 | unavailable | 87.7 | 1.0 | 992.0 | 992.0 | 364.9 | 364.9 |
| productPayload | warm | 2/2 | 986.2 | 973.5–998.8 | unavailable | 987.6 | 974.8–1000.4 | unavailable | 80.9 | 1.4 | 1252.0 | 1252.0 | 415.2 | 415.2 |
| productPayload | cold | 1/1 | 1026.2 | 1026.2–1026.2 | unavailable | 1027.4 | 1027.4–1027.4 | unavailable | 79.8 | 1.2 | 1262.0 | 1262.0 | 439.2 | 439.2 |
| mixedWorkflow | warm | 2/2 | 2079.8 | 1992.9–2166.8 | unavailable | 2082.8 | 1995.9–2169.8 | unavailable | 92.6 | 3.0 | 2501.0 | 2501.0 | 896.4 | 896.4 |
| mixedWorkflow | cold | 1/1 | 1950.0 | 1950.0–1950.0 | unavailable | 1951.8 | 1951.8–1951.8 | unavailable | 80.4 | 1.8 | 2505.0 | 2505.0 | 856.6 | 856.6 |
| standaloneWorkflow | warm | 2/2 | 297.3 | 293.4–301.2 | unavailable | 297.8 | 294.1–301.6 | unavailable | unavailable | 0.5 | 354.0 | 354.0 | 113.9 | 113.9 |
| standaloneWorkflow | cold | 1/1 | 292.4 | 292.4–292.4 | unavailable | 292.7 | 292.7–292.7 | unavailable | unavailable | 0.3 | 354.0 | 354.0 | 106.6 | 106.6 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 11135.9 | 1058.3 | 2340.5 | 4489.8 | unavailable | 19025.2 |
| product | product-cold-0-0 | 10031.7 | 1023.1 | 2289.9 | 0.0 | unavailable | 13344.8 |
| productPayload | productPayload-warm-0-0 | 9787.3 | 1355.0 | 2299.1 | 4450.7 | unavailable | 17892.2 |
| productPayload | productPayload-cold-0-0 | 9800.9 | 1302.8 | 2267.4 | 0.0 | unavailable | 13371.2 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 13847.7 | 4681.7 | 2931.2 | 0.0 | unavailable | 21460.7 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 13898.8 | 4582.7 | 2949.7 | 0.0 | unavailable | 21431.3 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 23312.3 | unavailable | unavailable | unavailable | 1669.9 | 24982.3 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 17731.7 | unavailable | unavailable | unavailable | 1671.7 | 19403.4 |

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
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 44 | 1487.1 | 12.5–42.5 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 665.4 | 17.0–27.0 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 626.8 | 17.1–28.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 32 | 598.1 | 16.9–21.3 |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 10 | 570.7 | 0.8–262.4 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 4 | 328.6 | 1.0–169.4 |
| mixedWorkflow | target | invocation / request admission | commit | 36 | 326.0 | 0.8–25.2 |
| productPayload | target | invocation / request admission | commit | 24 | 159.4 | 0.9–18.1 |
| productPayload | target | invocation / authoritative publication | commit | 4 | 156.3 | 0.9–78.0 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 10 | 155.4 | 2.5–58.5 |
| product | target | invocation / authoritative publication | commit | 4 | 151.1 | 0.9–76.3 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 8 | 138.4 | 11.8–25.2 |
| product | target | invocation / request admission | commit | 20 | 128.3 | 1.0–20.5 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 10 | 124.9 | 2.3–43.5 |
| product | target | invocation / journal seal and OCC verification | commit | 10 | 122.6 | 2.4–39.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | commit | 8 | 116.2 | 11.7–17.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 6 | 94.7 | 12.0–22.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 6 | 82.5 | 11.8–17.2 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 82.4 | 19.5–22.0 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 78.9 | 17.4–22.3 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 4 | 78.6 | 17.2–20.7 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | commit | 4 | 76.0 | 17.0–20.2 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | commit | 4 | 76.0 | 17.3–20.5 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 4 | 73.3 | 12.4–23.1 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | commit | 4 | 59.1 | 11.6–18.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 18.0 | 3.4–6.6 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 14.4 | 3.4–3.8 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 4 | 13.9 | 3.5–3.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.8 | 2.4–4.4 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 2 | 6.1 | 3.0–3.1 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 2 | 5.3 | 2.5–2.8 |
| product | control | invocation / request admission | commit | 2 | 1.5 | 0.7–0.9 |
| mixedWorkflow | control | invocation / request admission | commit | 2 | 1.5 | 0.7–0.8 |
| productPayload | control | invocation / request admission | commit | 2 | 1.5 | 0.7–0.8 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 2 | 1.4 | 0.7–0.8 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 2202 | 2202 | 0 | 754.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 876 | 876 | 0 | 354.4 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 880 | 880 | 0 | 334.8 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 880 | 880 | 0 | 320.9 |
| mixedWorkflow | unattributed | target | invocation / request admission | 532 | 532 | 0 | 180.2 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 440 | 440 | 0 | 152.8 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 404 | 404 | 0 | 149.8 |
| productPayload | unattributed | target | invocation / request admission | 322 | 322 | 0 | 94.2 |
| product | unattributed | target | invocation / request admission | 252 | 252 | 0 | 77.3 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 192 | 192 | 0 | 73.4 |
| product | unattributed | target | invocation / authoritative publication | 246 | 246 | 0 | 71.6 |
| productPayload | unattributed | target | invocation / authoritative publication | 258 | 258 | 0 | 71.2 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 170 | 170 | 0 | 69.1 |
| product | unattributed | target | invocation / journal seal and OCC verification | 170 | 170 | 0 | 66.8 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 226 | 226 | 0 | 66.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 188 | 188 | 0 | 65.0 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 170 | 170 | 0 | 63.4 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 144 | 144 | 0 | 51.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 140 | 140 | 0 | 46.4 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 102 | 102 | 0 | 40.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 102 | 102 | 0 | 40.3 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 96 | 96 | 0 | 40.2 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 102 | 102 | 0 | 40.2 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 102 | 102 | 0 | 39.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 102 | 102 | 0 | 37.4 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 94 | 94 | 0 | 33.4 |
| mixedWorkflow | unattributed | control | invocation / request admission | 78 | 78 | 0 | 20.4 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 62 | 62 | 0 | 17.2 |
| product | unattributed | control | invocation / request admission | 62 | 62 | 0 | 15.0 |
| productPayload | unattributed | control | invocation / request admission | 66 | 66 | 0 | 15.0 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 11.5 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.6 |
| product | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 9.0 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 34 | 34 | 0 | 8.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 8.6 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 42 | 42 | 0 | 8.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 42 | 42 | 0 | 8.3 |
| productPayload | unattributed | control | invocation / authoritative publication | 38 | 38 | 0 | 8.1 |
| product | unattributed | control | invocation / authoritative publication | 34 | 34 | 0 | 7.6 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 7.2 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 6.5 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 24 | 24 | 0 | 5.5 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 2.0 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.0 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 2.0 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.8 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 8 | 8 | 0 | 1.8 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.3 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 4 | 4 | 0 | 1.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.2 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 4 | 4 | 0 | 1.2 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 1.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 4 | 4 | 0 | 1.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 4 | 4 | 0 | 1.0 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 1.0 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 1.0 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / medusa.product:update | 4 | 4 | 0 | 0.9 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.8 |
| product | at .packages/persistence-postgres/src/appRows.ts:1457:22 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.7 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |
| product | at .packages/persistence-postgres/src/appRows.ts:1486:23 | target | invocation / authoritative publication | 2 | 2 | 0 | 0.4 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 82.7 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 27.4 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `4dd1e551a34910acd57f0ba24b78de0ed6345e33fad3d1e7b71b1667d5e741e1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 16.4 | select "fx_system_data_binding_activation" . "scope_id" , "fx_system_data_binding_activation" . "storage_generation" , " |
| product | `1640ee04592543d0907c11dd6744a188ebb68b0552ff212d925b146da49f7758` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 16.0 | select "fx_system_index_build_state" . "scope_id" , "fx_system_index_build_state" . "index_definition_id" , "fx_system_i |
| product | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 15.0 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 14.0 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 13.5 | commit |
| product | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 64 | 64 | 0 | 12.4 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| product | `1ef045bce5b164d59d31d390156f605cacd0d08f0364fe24a209b9ce11478846` | unattributed | target | invocation / request admission | 4 | 4 | 0 | 10.8 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 10.5 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `f866e89306489d86008bf5831891b716054c270deb4bbfd87354f4118e34193e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 10.4 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| product | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 10.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 85.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 27.3 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 8 | 8 | 0 | 20.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `4dd1e551a34910acd57f0ba24b78de0ed6345e33fad3d1e7b71b1667d5e741e1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 16.1 | select "fx_system_data_binding_activation" . "scope_id" , "fx_system_data_binding_activation" . "storage_generation" , " |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 6 | 6 | 0 | 14.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 64 | 64 | 0 | 14.1 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| productPayload | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 14.0 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 13.2 | commit |
| productPayload | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 11.3 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `1ef045bce5b164d59d31d390156f605cacd0d08f0364fe24a209b9ce11478846` | unattributed | target | invocation / request admission | 4 | 4 | 0 | 11.3 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 4 | 4 | 0 | 11.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 4 | 4 | 0 | 11.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 44 | 44 | 0 | 112.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 32 | 32 | 0 | 87.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `4dd1e551a34910acd57f0ba24b78de0ed6345e33fad3d1e7b71b1667d5e741e1` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 116 | 116 | 0 | 56.8 | select "fx_system_data_binding_activation" . "scope_id" , "fx_system_data_binding_activation" . "storage_generation" , " |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 40 | 40 | 0 | 50.9 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 232 | 232 | 0 | 49.0 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| mixedWorkflow | `7889cca49ee5655f0bb76f22d2189e438c22ba1315ca1ffce1405d985282b35a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 116 | 116 | 0 | 36.9 | select "fx_system_index_build_state" . "scope_id" , "fx_system_index_build_state" . "index_definition_id" , "fx_system_i |
| mixedWorkflow | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 38 | 38 | 0 | 31.6 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| mixedWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 116 | 116 | 0 | 29.0 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| mixedWorkflow | `fea27384148e86304070a70ff56d9b3091f37f3ba52bf39704f9cd37044018e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 76 | 76 | 0 | 27.4 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `a8fb2d003a60815cae572e10afd68ee4cf8916cffc57ea20c38e0d37490fa0a9` | unattributed | target | invocation / request admission | 10 | 10 | 0 | 26.8 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `463f2eaa3998eb4d7ab2c4a1dddbc2072208ce0396712aafbe127a1cd88dfd99` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 116 | 116 | 0 | 25.7 | select "scope_id" , "storage_generation" , "sha256" , case when octet_length ( "canonical_bytes" ) between ? and ? then  |
| mixedWorkflow | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 30 | 30 | 0 | 25.5 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| standaloneWorkflow | `f52cf0c6a37cd1fe29efef4922cb344045e4fd7c5f21e1981035dd8f9c5b4a01` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 24.7 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 21.5 | commit |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 36 | 36 | 0 | 15.1 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 8.6 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 48 | 48 | 0 | 8.4 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `8446028f3dfde1eb9615e9d4474129405f8df61675534cc4fa3ffffacf2494d8` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 40 | 40 | 0 | 7.6 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 10 | 10 | 0 | 5.6 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 5.2 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| standaloneWorkflow | `cc0f21be214e751eeb7da0d5a545fcb89eaa64ea8b202a74d1721fd4899c4696` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 6 | 6 | 0 | 4.5 | with "capture_clock" as ( select "last_commit_seq" , "epoch" from "fx_system_scope_clock" where "fx_system_scope_clock"  |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 3.9 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 18 | 18 | 0 | 3.9 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| standaloneWorkflow | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | ambiguous | target | invocation / standalone native workflow | 20 | 20 | 0 | 3.7 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 832.1 | 0.6 |
| product | invocation / Worker execution | 564.8 | 1.0 |
| product | invocation / Worker execution / Worker construction and ready | 82.8 | 82.8 |
| product | invocation / Worker execution / Worker dispatch | 467.3 | 24.3 |
| product | invocation / Worker execution / Worker dispatch / Application point | 5.5 | 5.5 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 45.9 | 45.9 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 45.8 | 45.8 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 340.4 | 340.4 |
| product | invocation / Worker execution / Worker disposal | 13.8 | 13.8 |
| product | invocation / authoritative publication | 91.3 | 91.3 |
| product | invocation / journal seal and OCC verification | 85.3 | 85.3 |
| product | invocation / request admission | 90.0 | 90.0 |
| productPayload | invocation | 986.2 | 0.7 |
| productPayload | invocation / Worker execution | 697.7 | 0.8 |
| productPayload | invocation / Worker execution / Worker construction and ready | 80.8 | 80.8 |
| productPayload | invocation / Worker execution / Worker dispatch | 603.0 | 29.3 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 5.1 | 5.1 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 43.9 | 43.9 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 44.0 | 44.0 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 325.1 | 325.1 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 49.5 | 49.5 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 32.8 | 32.8 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 34.3 | 34.3 |
| productPayload | invocation / Worker execution / Worker disposal | 13.0 | 13.0 |
| productPayload | invocation / authoritative publication | 94.8 | 94.8 |
| productPayload | invocation / journal seal and OCC verification | 88.0 | 88.0 |
| productPayload | invocation / request admission | 105.0 | 105.0 |
| mixedWorkflow | invocation | 2079.8 | 0.6 |
| mixedWorkflow | invocation / Worker execution | 1578.5 | 1.2 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 92.6 | 92.6 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 1472.2 | 31.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 6.0 | 6.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 47.6 | 47.6 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 361.3 | 361.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 842.3 | 842.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 57.6 | 57.6 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 37.8 | 37.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 41.8 | 41.8 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 12.6 | 12.6 |
| mixedWorkflow | invocation / authoritative publication | 192.0 | 192.0 |
| mixedWorkflow | invocation / journal seal and OCC verification | 113.8 | 113.8 |
| mixedWorkflow | invocation / request admission | 194.9 | 194.9 |
| standaloneWorkflow | invocation | 297.3 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 297.3 | 297.3 |

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
