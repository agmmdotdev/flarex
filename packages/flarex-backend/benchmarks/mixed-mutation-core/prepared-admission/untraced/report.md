# Private mixed mutation performance baseline

Revision: `8e486128d70499f649ee424beed0b1eebba68bb2`; working diff SHA-256: `6ca9aa0ebf90f947784cf574efcf8680af34c2a0d155877da8a6ece5ad5db92b`; mode: **full**, observation: **untraced**.
Plan: 3 warmups, 20 measured warm samples, 3 cold samples per workload.

The outer invocation wall interval uses the same workload boundaries, from before fresh admission through authoritative publication and retained-outcome resolution. No SQL or phase observer is installed, so request trace spans, dispatches, awaits, transaction intervals and trace finalization are unavailable. The standalone graph has fewer root obligations; no native ORM parity or hosted transport claim is made.

## Environment

```json
{
  "postgres": {
    "serverVersion": "18.3",
    "fsync": "on",
    "synchronousCommit": "on",
    "fullPageWrites": "on",
    "sharedBuffers": "128MB",
    "role": "flarex_runtime_1790786786085_8jf889iusra",
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
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "59e136a8df57d55997960601149447bb06a4a924b0d15968c7ad95ba6846bc4b",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "5dd6a02b2ece07036eabf0921c04c868bfe9ed7f280a8b0d587f84d5d63ffbb5",
    "packages/flarex-backend/test/support/mixedMutationCpuProfile.ts": "2c7815c287028037f77789dbf9917906433d1b5f851056d265559a5dd9eaa0c0",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "1ff079da5c937ba1988107fc4233abc03d9b43015069dc3f197d6e664fd610a3",
    "packages/medusa-adapter/src/product-attempt.ts": "34720033a89cde4508110fa763211d58d6a2d92c7f0afb0c654c4de27fddf9ae",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/executor/src/pointMutationJournal.ts": "e5da662862e0dbb0505e082c936e4a20516927424092d8bd35f99c5cb5623b46",
    "packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts": "516cffc5d0b39a142e3ace6a3182f0f2d768e66b84506176449f9325825e3522",
    "packages/persistence-postgres/drizzle/0119_protected_metadata_epoch.sql": "6330d5e0e51c4e165f9e359c36acefbd29906a6047a88d606026880bfe9b9651",
    "packages/persistence-postgres/drizzle/0120_immutable_target_metadata_protection.sql": "6ece58db6038056748737bc67cd39605166c0d76473dfd9d936cceb67415a2d3",
    "packages/persistence-postgres/src/appRows.ts": "0150bb1dc614b0303cf52743306e3b7578203feb387aa41ed6501afaf17aec41",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "d2f059b8c8b94c68d65d3d0ec328af207592cfe2fcca21d45af6591c2ff5905a",
    "packages/persistence-postgres/src/applicationActiveHeadRead.ts": "6ae20222a735c1b9a70e3a7f108796a68b88b86706d0ceb93ab23b0bb4f3ed79",
    "packages/persistence-postgres/src/applicationActivation.ts": "b2fc333eae04535d03e995e005a1a21779edfbdda5939561c8f5b015a2ab5cc2",
    "packages/persistence-postgres/src/applicationBindingProjection.ts": "c77127551841e0e1ab2b3ffe3f6f279c0119b163d3a0da333a309c2c4e5abe95",
    "packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts": "ad072323693964f88fb6aee24a7b35abf039652992d70d00c81db4cd9e49f5d8",
    "packages/persistence-postgres/src/applicationReadiness.ts": "d21d7777eae2b9bab612a4f95b86752e2bbe821ca3b5621ae7bde189848edafd",
    "packages/persistence-postgres/src/applicationRelationReadinessFold.ts": "c9e3c34a1d7eb4de52d47c04480c0bd290530cbd4c1ea17bb83ccd61709ce06f",
    "packages/persistence-postgres/src/boundedRequestLifetime.ts": "eb640b68d55a2a825e62a7838c46f40ef2c391009cbf6ccc1ab4584956a805c9",
    "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts": "a230f80bf996f5f94db88ec1869698bc1c39f5f340e38368e5a9f3341d298d65",
    "packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts": "83602ba7abc1507298bfb714b132b0b1a4ce616f86cc41b17b6ceb0337f52579",
    "packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts": "f7b59769ec3c2025fcd5f17b728cdf885d30a764246bb264915e0175af763950",
    "packages/persistence-postgres/src/commitPublication/publication.ts": "5fa1dfc72d1e0c421d405ea9a660b7b9f591a8cb986097b29ecb655ba7528ba4",
    "packages/persistence-postgres/src/drizzleSchema.ts": "195bd525e02fdf9251b2516fa3e4da088a45e9c8b2b2cc23ec1ec899d9022b0a",
    "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts": "e8faaa766cfc7106a78b5dd52a73b583feff31876a64906bb57724f7a90582e2",
    "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts": "22e2028f9dc5ae75aa21cb7fe359619b921e05658f1d45c3b19187ae441de0bd",
    "packages/persistence-postgres/src/indexBuildStates.ts": "3c680b912497f3e2b69703644761fd534c2e838e46a8e8e180b4332b2fc48307",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "9c0f377eb32aaf6ed5b2badcfd7215294801575ff90bcfdb91e2b0a4ef5007ef",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "a049be738f6ad182319782147833f4f8970b6b63c55b38ac851d4878fc124d76",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "68a442e4ecbf56cc4e61a9bb6f4f817c5b994db4c337c4ea39fc974d1f488116",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "4fe028417cac3de58d411a9034470417a7b0f60ded89266750f54c44a5009595",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "8c0f885569d2e9b7399895fd131598d3064b31d892ddfad3adb57b3bb44d93b3",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "fca37d6e98289ca03131685342459dc11c80ec05fb0a6f40b0c1d5496ad153fd",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "ab9e2544222c091318fc2a87abf8628be71bc4b89473c5866d8e1bd2f65b80dc",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "fe528f91becf85aeb68adb3f5e0a97c06dc965e967d9d8cddebc7d15b6a56c5e",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "0c12c73b9bf05774cd7c56e755aa07f2452f926da37fc80399210fbf2ad45169",
    "packages/persistence-postgres/src/pointCommitTransaction.ts": "692dbcc61809e2ff14c210df11d42b45c5e60c9f20cc9017ccf6a02423fabf20",
    "packages/persistence-postgres/src/postgres.ts": "ef60f726bdb0569d5773d6fc22dbe2bb344494939931b250322873ddcc2941f0",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts": "378fc8d2b0215ea6e7da26cc4247d4b9548d2841c7ec038cdb5d3737280bc156",
    "packages/persistence-postgres/src/preparedHostRuntime.ts": "3db4fedaee228a00d076af5126880afeae740d16566efa199f633f5497839ad2",
    "packages/persistence-postgres/src/retainedHistoryFloorObservation.ts": "09d426b05fcb79917a2499546298030d496283fb442defbf158c848cc8397401",
    "packages/persistence-postgres/src/scopeClock.ts": "9953046ac9f6c958f9c2723e1ebb3ad91f4fb33377343142b58294a74de24082",
    "packages/persistence-postgres/src/schema.ts": "f8edf52239fba608f7a09d9d772be0b5bb7b3d3daeb08a561ba17f159e0f410f",
    "packages/persistence-postgres/src/sessionJournalStore.ts": "33246eaf44a449862bd92f2f1966a699ea46cbc5fe12b2dc6b0f857b39b3d1bb",
    "packages/persistence-postgres/src/storedCommitAuthority/materialization.ts": "26db0f130f05af1551e8a6980a40cedbad894ab973f34bb66073a085505398ff",
    "packages/persistence-postgres/src/storedCommitAuthority/postgresLoader.ts": "d483bb8175e4aaf3bf80400f05a39670bf46a3f78f43748c57c3c2910688b15c",
    "packages/persistence-postgres/src/transactionSessionActivation.ts": "51dba87c82a84d463b6502a3fadf5b1d5ca89dd43b1f8d43a6f2b026f7f7d066",
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
| product | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 783.7 | 747.5–1193.7 | 1011.6 | 82.1 | unavailable | unavailable | unavailable | unavailable | unavailable |
| product | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 837.4 | 827.3–1199.0 | unavailable | 88.8 | unavailable | unavailable | unavailable | unavailable | unavailable |
| productPayload | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 973.8 | 952.7–1014.0 | 1006.0 | 82.9 | unavailable | unavailable | unavailable | unavailable | unavailable |
| productPayload | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 1459.3 | 1035.3–1509.7 | unavailable | 132.7 | unavailable | unavailable | unavailable | unavailable | unavailable |
| mixedWorkflow | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 1676.6 | 1636.7–2800.9 | 1714.8 | 85.8 | unavailable | unavailable | unavailable | unavailable | unavailable |
| mixedWorkflow | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 1732.8 | 1716.7–1761.8 | unavailable | 88.4 | unavailable | unavailable | unavailable | unavailable | unavailable |
| standaloneWorkflow | warm | 20/20 | unavailable | unavailable–unavailable | unavailable | 309.4 | 289.4–406.9 | 395.3 | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |
| standaloneWorkflow | cold | 3/3 | unavailable | unavailable–unavailable | unavailable | 293.4 | 292.5–300.9 | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 12043.6 | 1077.3 | 2454.3 | 50450.9 | unavailable | 66026.7 |
| product | product-cold-0-0 | 10827.2 | 1049.4 | 2280.6 | 0.0 | unavailable | 14157.4 |
| product | product-cold-1-0 | 10718.3 | 1753.6 | 2362.1 | 0.0 | unavailable | 14834.0 |
| product | product-cold-2-0 | 21060.1 | 1044.6 | 2764.0 | 0.0 | unavailable | 24868.8 |
| productPayload | productPayload-warm-0-0 | 10631.1 | 1358.4 | 2289.9 | 51213.9 | unavailable | 65493.3 |
| productPayload | productPayload-cold-0-0 | 12169.1 | 1537.0 | 2436.5 | 0.0 | unavailable | 16142.7 |
| productPayload | productPayload-cold-1-0 | 12891.0 | 1371.1 | 2418.8 | 0.0 | unavailable | 16681.0 |
| productPayload | productPayload-cold-2-0 | 10404.3 | 1356.9 | 2378.9 | 0.0 | unavailable | 14140.1 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 14839.2 | 4785.6 | 3118.8 | 0.0 | unavailable | 22743.7 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 18934.3 | 4812.4 | 3041.9 | 0.0 | unavailable | 26788.7 |
| mixedWorkflow | mixedWorkflow-cold-1-0 | 14912.4 | 4811.4 | 3059.7 | 0.0 | unavailable | 22783.5 |
| mixedWorkflow | mixedWorkflow-cold-2-0 | 15781.3 | 4864.0 | 3065.3 | 0.0 | unavailable | 23710.6 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 17660.5 | unavailable | unavailable | unavailable | 1786.1 | 19446.8 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 16163.8 | unavailable | unavailable | unavailable | 1673.7 | 17837.6 |
| standaloneWorkflow | standaloneWorkflow-cold-1-0 | 16343.9 | unavailable | unavailable | unavailable | 1694.8 | 18038.7 |
| standaloneWorkflow | standaloneWorkflow-cold-2-0 | 16070.6 | unavailable | unavailable | unavailable | 1735.9 | 17806.6 |

## Retained state growth per successful warm request

| Workload | Rows Δ median | Index entries Δ median | Commits Δ median | Events Δ median | Live journal rows Δ median | Sealed attempt bytes median | Live journal bytes Δ median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 12180.0 | 0.0 |
| productPayload | 2.0 | 3.0 | 1.0 | 1.0 | 0.0 | 19401.0 | 0.0 |
| mixedWorkflow | 7.0 | 36.0 | 1.0 | 7.0 | 0.0 | 34109.0 | 0.0 |
| standaloneWorkflow | 5.0 | 33.0 | 1.0 | 6.0 | 0.0 | unavailable | unavailable |

## Observed database transaction intervals in successful warm requests

These BEGIN-to-settlement intervals include application work and waits; they are not lock-hold measurements.

| Workload | Pool | Phase | Outcome | Intervals | Duration total (ms) | Range (ms) |
| --- | --- | --- | --- | ---: | ---: | --- |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |

## Failures and uncertainty

Failures: 0. Successful warm percentiles exclude failures; the raw file retains every attempted sample.

Unavailable or unmeasured metrics:
- PostgreSQL server execution time (driver await includes transport and scheduling).
- Exact native workflow child inclusive/exclusive spans; native steps are not instrumented, so SQL owner mapping is used instead.
- Exact inner OCC/materialization phase duration where the existing owner has no test observation hook.
- Exact scope-clock lock acquisition wait and lock-hold interval; transaction duration is only a BEGIN-to-settlement envelope.
- Sealed attempt bytes for failed attempts and standalone workflow; settled journal rows are removed, so inventory separately records only remaining live journal bytes.
- SQL dispatches, awaited time, phase spans, transaction intervals and trace coverage in untraced mode.
- Hosted Cloudflare transport, native ORM parity, and production capacity.

Interpretation notes:
- Standalone workflow includes the same selected Product/Pricing/Link/Tag graph but has no Application, Payload, journal or OCC obligations.
- The first warmup is excluded from warm distributions.
- Per-request test grant issuer/signing and private bridge overhead are included in mixed request admission and Worker intervals.
- Warm mixed samples reuse prepared modules, scope, and pools; every request creates, readies, invokes once, and disposes a fresh Worker under the exact runtime one-invocation guard.
- Signed business arguments are parsed by the fixed benchmark Worker source inside the measured request; that private test-harness cost is included.
- Workflow tags are unique: each graph is seeded immediately before its invocation and its launched tag is renamed outside measurement before the next seed. Product/Payload graphs are preseeded.
- No SQL or phase observer is installed. Outer invocation wall time uses the same workload boundaries and business checks as the traced series.
- Sealed attempt bytes come from the canonical journal at successful seal through a delegating test store port; the capture adds no database query.
