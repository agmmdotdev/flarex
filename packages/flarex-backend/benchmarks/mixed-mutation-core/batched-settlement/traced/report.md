# Private mixed mutation performance baseline

Revision: `1ec2e6e1d35ce8e276f317add859ffea645af002`; working diff SHA-256: `41cb85c795ed15c472ed1247ce4e062cfa2495b6639f5fd557bec0051eba3a65`; mode: **full**, observation: **traced**.
Plan: 3 warmups, 20 measured warm samples, 3 cold samples per workload.

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
    "role": "flarex_runtime_1790805178305_mpobiv3nmi",
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
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "47c51bd1bfabdb7fb77a1209afa1a5f27362399be591ac1b1c9f06676e685879",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "17e1da4a47791fcbafadfb3a5a559049a716cc2756bbe77a4dbaa69fedca7ab1",
    "packages/flarex-backend/test/support/mixedMutationCpuProfile.ts": "2c7815c287028037f77789dbf9917906433d1b5f851056d265559a5dd9eaa0c0",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "a2f4852f4c15c88b21da779441ab195183c9798d77c1b49f7b655f1f89d76e0b",
    "packages/medusa-adapter/src/product-attempt.ts": "34720033a89cde4508110fa763211d58d6a2d92c7f0afb0c654c4de27fddf9ae",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/executor/src/pointMutationJournal.ts": "7e60f50cb827caabb8a25a308ce8c33a7ecaf7c50602133d4523cd0d24155b3b",
    "packages/executor/src/storedAttemptAuthentication.ts": "41ac398ef5aa7fa9ff55cdfe189b5d279b53d34c485f304943a3ce7f435a4edf",
    "packages/executor/src/storedAttemptAuthentication/authenticationOperations.ts": "603ebcd333fbe63fba8814cb5c69a8d136daa2237cc53ef261f28a8ffb6361cb",
    "packages/executor/src/storedAttemptAuthentication/commitAuthorityModel.ts": "a02b39703ff6c1b182da3020176f8c16c850b1d2e56a6cd3a8252ab1d50f5ed3",
    "packages/executor/src/storedAttemptAuthentication/planningOperations.ts": "39ef67d14a8bda6de855eb79629c87e989969420233bf4695ae80a8c5267bf39",
    "packages/executor/src/storedAttemptAuthentication/pointCommitRuntimeModel.ts": "c370d2dc5e9dde1e27e51963e0ff928085733a5e70686267dd979ac4118bcd46",
    "packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts": "4ddb4be00354a503d2cb154e7d3857aa7dd649174f302860b6b6f5b846c7d62e",
    "packages/persistence-postgres/drizzle/0119_protected_metadata_epoch.sql": "6330d5e0e51c4e165f9e359c36acefbd29906a6047a88d606026880bfe9b9651",
    "packages/persistence-postgres/drizzle/0120_immutable_target_metadata_protection.sql": "6ece58db6038056748737bc67cd39605166c0d76473dfd9d936cceb67415a2d3",
    "packages/persistence-postgres/src/appRows.ts": "a13b09122311ae7d7d8e56ca124b35a9cdcc66db9e56b219a0ddd18c83899a61",
    "packages/persistence-postgres/src/appIndexEntries.ts": "67f7aba07b8c30f6a4eb8a061a3363d1ea136a2962974b597d364189a220bc31",
    "packages/persistence-postgres/src/appDeveloperIndexCommitV1.ts": "a1a75b7a0c1c3cdc5ee472080f3437638aceb34d3e82c56eee164aab776bc466",
    "packages/persistence-postgres/src/appUniqueKeys.ts": "9beb600cccfef27ec5f63ec08bf35dda1cf71a0859b5d0dc64e92aadbd462b1d",
    "packages/persistence-postgres/src/appSchemaCandidateValidation.ts": "80a1f837fa914bc4b423721030bddcc23009bb67a5206eee79885462ca593ae2",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "d2f059b8c8b94c68d65d3d0ec328af207592cfe2fcca21d45af6591c2ff5905a",
    "packages/persistence-postgres/src/applicationActiveHeadRead.ts": "6ae20222a735c1b9a70e3a7f108796a68b88b86706d0ceb93ab23b0bb4f3ed79",
    "packages/persistence-postgres/src/applicationActivation.ts": "b2fc333eae04535d03e995e005a1a21779edfbdda5939561c8f5b015a2ab5cc2",
    "packages/persistence-postgres/src/applicationBindingProjection.ts": "c77127551841e0e1ab2b3ffe3f6f279c0119b163d3a0da333a309c2c4e5abe95",
    "packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts": "81bab9718b47e76e424b49d8e95bff8361a8bc0e06d62181d5f6ccf304284454",
    "packages/persistence-postgres/src/applicationDocumentMaterialization/model.ts": "638aa6871e18895691433ad64cf981252ff0269bfd8c2b60aad35e6e393da81c",
    "packages/persistence-postgres/src/applicationReadiness.ts": "d21d7777eae2b9bab612a4f95b86752e2bbe821ca3b5621ae7bde189848edafd",
    "packages/persistence-postgres/src/applicationRelationReadinessFold.ts": "c9e3c34a1d7eb4de52d47c04480c0bd290530cbd4c1ea17bb83ccd61709ce06f",
    "packages/persistence-postgres/src/boundedRequestLifetime.ts": "eb640b68d55a2a825e62a7838c46f40ef2c391009cbf6ccc1ab4584956a805c9",
    "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts": "2ddf1f705d4c0d86d749b65ce876fee097a3480ee5ad06034e340e02dbdc9f7b",
    "packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts": "fd01dba6a6a2d162490a6d32a9950511dba2176ff6db66f26bb773ceb9f2e4c0",
    "packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts": "f22b77f82ab567fca2443ca404711c2bdaa92803692082283297c4155e022c48",
    "packages/persistence-postgres/src/commitPublication/publication.ts": "5fa1dfc72d1e0c421d405ea9a660b7b9f591a8cb986097b29ecb655ba7528ba4",
    "packages/persistence-postgres/src/commitPublication/strongReferenceAdmission.ts": "3ac46c31c321aa2732e447d89cebb4760ebd58270d862a674178435e8e45a7e7",
    "packages/persistence-postgres/src/commitPublication/strongReferenceValidation.ts": "86a497b4185a238c87eed8329be130b744baca5edb39afabc8b13beb5a192331",
    "packages/persistence-postgres/src/drizzleSchema.ts": "195bd525e02fdf9251b2516fa3e4da088a45e9c8b2b2cc23ec1ec899d9022b0a",
    "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts": "e8faaa766cfc7106a78b5dd52a73b583feff31876a64906bb57724f7a90582e2",
    "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts": "22e2028f9dc5ae75aa21cb7fe359619b921e05658f1d45c3b19187ae441de0bd",
    "packages/persistence-postgres/src/indexBuildStates.ts": "3c680b912497f3e2b69703644761fd534c2e838e46a8e8e180b4332b2fc48307",
    "packages/persistence-postgres/src/intrinsicCreationTimeIndexBuildV1.ts": "51595f0155ad38e1104847c9dd01c76e4a8b456247f5d408a88bea7602c73974",
    "packages/persistence-postgres/src/locatedReadCommittedEffect.ts": "1470f8835d1570502590b1759223bf9d067935993ad9f4aa619f87210214501c",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/commitEvidence.ts": "25cd43b35aee67c27047d814209248711f180db8a2b170fec02c45e157cd65fa",
    "packages/persistence-postgres/src/logicalDocuments/journalEvidence.ts": "8a6635bd587db8da028bb61f95902bdc7a7faa9db8ee2f455f40a09d6b0c05ba",
    "packages/persistence-postgres/src/logicalDocuments/indexReads.ts": "fd6dbee36ad878edf096fd9cd42c5df3b3d975b38c92ba22d613d3150686002b",
    "packages/persistence-postgres/src/logicalDocuments/materialization.ts": "348a508dac73b0c161fdcf18eab610ffaf0c34f57b89f5d6c61c575f8b57db48",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "773b0ba0a634e0b59ab57c76bf08644de17274e8c7262c0d44294539d15f19e2",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "a049be738f6ad182319782147833f4f8970b6b63c55b38ac851d4878fc124d76",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "48d1dc4822b253dd84f6834cb6b45ddb3a64aca9b6238d051333849a0e3d09f4",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "0474041407536e071d34c43feb6088e33edae3b8106df3081de812d69b36b558",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "8c0f885569d2e9b7399895fd131598d3064b31d892ddfad3adb57b3bb44d93b3",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "fca37d6e98289ca03131685342459dc11c80ec05fb0a6f40b0c1d5496ad153fd",
    "packages/persistence-postgres/src/logicalDocuments/searchEntries.ts": "18addfa9d8abcf5772f436a95e5053fae6ca009cd48001cdc4947d9203a0026b",
    "packages/persistence-postgres/src/logicalDocuments/searchReads.ts": "a1a46bac1f5e1d7bf1e6b9007bffb5edbebf46d76f493e4a2d4984f98063b437",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "c3715ebacf48b9178bab45cd224a388b9adbba57c345dd3745356878ba6725a8",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "fe528f91becf85aeb68adb3f5e0a97c06dc965e967d9d8cddebc7d15b6a56c5e",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "0c12c73b9bf05774cd7c56e755aa07f2452f926da37fc80399210fbf2ad45169",
    "packages/persistence-postgres/src/pointCommitTransaction.ts": "df2a6023419b2873d268e933ae2557fdecc56f642b52f98e2ed5e0173de6fead",
    "packages/persistence-postgres/src/postgres.ts": "ef60f726bdb0569d5773d6fc22dbe2bb344494939931b250322873ddcc2941f0",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts": "378fc8d2b0215ea6e7da26cc4247d4b9548d2841c7ec038cdb5d3737280bc156",
    "packages/persistence-postgres/src/preparedHostRuntime.ts": "3db4fedaee228a00d076af5126880afeae740d16566efa199f633f5497839ad2",
    "packages/persistence-postgres/src/retainedHistoryFloorObservation.ts": "09d426b05fcb79917a2499546298030d496283fb442defbf158c848cc8397401",
    "packages/persistence-postgres/src/scopeClock.ts": "1e3cdfdf07246a7703c3a4d6ebff781e24939c7979d3dcc64a58f4d626c9a09f",
    "packages/persistence-postgres/src/schema.ts": "f8edf52239fba608f7a09d9d772be0b5bb7b3d3daeb08a561ba17f159e0f410f",
    "packages/persistence-postgres/src/sessionJournalStore.ts": "6606905e11aee507bd459759500781fd940cb8aae68719c9f2cc93b79a78410e",
    "packages/persistence-postgres/src/storedAttemptEvidence.ts": "20726df3acab64dce29598b1170f1055b65f82bc27ac1b893907fd517efeda70",
    "packages/persistence-postgres/src/storedCommitAuthority/model.ts": "1387de56b5a74fc3343e7c5e041c74393eae1aa6f2eed9ad3f1a08af227fd81a",
    "packages/persistence-postgres/src/storedCommitAuthority/materialization.ts": "26db0f130f05af1551e8a6980a40cedbad894ab973f34bb66073a085505398ff",
    "packages/persistence-postgres/src/storedCommitAuthority/postgresLoader.ts": "f515fea09d38ab003d80ef009ce3f9eafe14bd8f9bd60c5b44a0bacd57b49a75",
    "packages/persistence-postgres/src/transactionSessionActivation.ts": "addffad7469d505e6d64bca49923c07341d17cdf7f52e2d02cda9203e32d6fa1",
    "packages/persistence-postgres/src/transactionSessionAttemptFacet.ts": "fe723a3f8787f29eaa582cdaaf5b1d48919dbe077c3528c0a13f9ee7f2e01ace",
    "packages/persistence-postgres/src/transactionSessionAttemptKernel.ts": "dde413833778386bc5f2dbd1d8c896f7955a5df9b76e441027a4b2f342ad51ad",
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
| product | warm | 20/20 | 592.3 | 575.1–636.5 | 615.6 | 592.8 | 575.6–637.0 | 616.2 | 77.5 | 0.6 | 562.0 | 562.0 | 226.8 | 226.8 |
| product | cold | 3/3 | 637.4 | 610.8–638.5 | unavailable | 637.9 | 611.3–639.0 | unavailable | 87.6 | 0.5 | 566.0 | 566.0 | 239.8 | 239.8 |
| productPayload | warm | 20/20 | 639.3 | 620.8–2181.0 | 1472.2 | 639.9 | 621.3–2181.6 | 1472.8 | 78.3 | 0.5 | 585.0 | 585.0 | 239.6 | 239.6 |
| productPayload | cold | 3/3 | 681.9 | 674.0–781.0 | unavailable | 682.4 | 674.5–781.6 | unavailable | 82.1 | 0.5 | 591.0 | 591.0 | 267.2 | 267.2 |
| mixedWorkflow | warm | 20/20 | 1069.2 | 1037.7–1223.8 | 1102.7 | 1070.4 | 1038.7–1224.9 | 1103.7 | 78.8 | 1.1 | 888.0 | 888.0 | 398.4 | 398.4 |
| mixedWorkflow | cold | 3/3 | 1149.6 | 1116.5–1274.3 | unavailable | 1150.4 | 1117.3–1275.0 | unavailable | 78.8 | 0.8 | 892.0 | 892.0 | 444.8 | 444.8 |
| standaloneWorkflow | warm | 20/20 | 291.6 | 282.4–359.6 | 326.3 | 292.0 | 282.7–359.9 | 326.7 | unavailable | 0.4 | 309.0 | 309.0 | 108.0 | 108.0 |
| standaloneWorkflow | cold | 3/3 | 300.3 | 296.8–301.4 | unavailable | 300.7 | 297.0–301.8 | unavailable | unavailable | 0.3 | 309.0 | 309.0 | 105.5 | 105.5 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 11758.9 | 1073.5 | 2370.7 | 50375.3 | unavailable | 65579.1 |
| product | product-cold-0-0 | 10832.2 | 1032.1 | 2267.0 | 0.0 | unavailable | 14131.5 |
| product | product-cold-1-0 | 10376.3 | 1016.5 | 2247.9 | 0.0 | unavailable | 13640.7 |
| product | product-cold-2-0 | 10490.6 | 1017.0 | 2272.2 | 0.0 | unavailable | 13779.9 |
| productPayload | productPayload-warm-0-0 | 10645.7 | 1314.8 | 2271.9 | 49811.5 | unavailable | 64044.0 |
| productPayload | productPayload-cold-0-0 | 16157.4 | 1382.9 | 2304.8 | 0.0 | unavailable | 19845.2 |
| productPayload | productPayload-cold-1-0 | 12659.3 | 1384.2 | 2281.9 | 0.0 | unavailable | 16325.5 |
| productPayload | productPayload-cold-2-0 | 10612.9 | 1361.3 | 2391.2 | 0.0 | unavailable | 14365.5 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 16181.3 | 4691.7 | 3016.1 | 0.0 | unavailable | 23889.2 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 14712.7 | 4647.6 | 3084.9 | 0.0 | unavailable | 22445.3 |
| mixedWorkflow | mixedWorkflow-cold-1-0 | 17929.6 | 4621.6 | 2907.4 | 0.0 | unavailable | 25458.6 |
| mixedWorkflow | mixedWorkflow-cold-2-0 | 14584.2 | 4590.2 | 2922.2 | 0.0 | unavailable | 22096.7 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 16355.4 | unavailable | unavailable | unavailable | 1685.6 | 18041.2 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 16410.4 | unavailable | unavailable | unavailable | 1719.8 | 18130.4 |
| standaloneWorkflow | standaloneWorkflow-cold-1-0 | 16448.2 | unavailable | unavailable | unavailable | 1739.8 | 18188.0 |
| standaloneWorkflow | standaloneWorkflow-cold-2-0 | 17007.0 | unavailable | unavailable | unavailable | 1659.9 | 18667.0 |

## Retained state growth per successful warm request

| Workload | Rows Δ median | Index entries Δ median | Commits Δ median | Events Δ median | Live journal rows Δ median | Sealed attempt bytes median | Live journal bytes Δ median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 12180.0 | 0.0 |
| productPayload | 2.0 | 3.0 | 1.0 | 1.0 | 0.0 | 19401.0 | 0.0 |
| mixedWorkflow | 7.0 | 36.0 | 1.0 | 7.0 | 0.0 | 34109.0 | 0.0 |
| standaloneWorkflow | 5.0 | 33.0 | 1.0 | 6.0 | 0.0 | unavailable | unavailable |

## Original settlement demands and seal chunks

These observations come from the confirmed owner capture after the request timer. Projection chunks use the owner's 128-row bound. Unobserved publication demands are unavailable rather than inferred from net rows.

| Sample | Receipts / document occurrences | Point dependencies | Indexed syscalls | Range dependencies | Relation syscalls / dependencies | Admitted range / page / unique observations | Range / page entry occurrences | Admitted index / constraint definitions (distinct) | Receipt / point / range / relation chunks | Owner byte partitions | Unavailable demands |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| product-warm-0-0 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12086; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14465; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5207 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-1 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12086; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14465; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5207 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-2 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12104; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14474; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5216 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-3 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12106; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14475; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5217 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-4 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12106; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14475; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5217 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-5 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12106; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14475; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5217 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-6 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12106; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14475; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5217 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-7 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12106; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14475; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5217 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-8 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12106; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14475; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5217 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-9 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12106; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14475; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5217 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-10 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-11 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-12 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-13 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-14 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-15 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-16 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-17 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-18 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-19 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-20 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-21 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-warm-0-22 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12180; canonicalResult: 4052; rangeEvidence: 0; materialWriteEventEvidence: 2192; receiptEvidence: 14571; argsJson: 368; argsCanonical: 423; grantJson: 1921; grantCanonical: 1972; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5281 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-cold-0-0 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12086; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14465; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5207 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-cold-1-0 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12086; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14465; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5207 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| product-cold-2-0 | 5 / 1 | 11 | 0 | 0 | 0 / 0 | 10 / 0 / 4 | 10 / 0 | 219 / 72 (73 / 24) | 1 / 1 / 0 / 0 | canonicalJournal: 12086; canonicalResult: 4027; rangeEvidence: 0; materialWriteEventEvidence: 2183; receiptEvidence: 14465; argsJson: 363; argsCanonical: 418; grantJson: 1918; grantCanonical: 1969; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5207 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-0 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19296; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22857; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5719; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-1 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19296; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22857; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5719; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-2 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19314; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22866; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5728; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-3 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19316; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22867; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5729; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-4 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19316; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22867; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5729; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-5 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19316; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22867; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5729; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-6 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19316; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22867; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5729; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-7 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19316; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22867; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5729; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-8 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19316; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22867; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5729; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-9 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19316; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22867; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5729; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-10 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-11 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-12 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-13 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-14 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-15 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-16 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-17 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-18 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-19 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-20 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-21 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-warm-0-22 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19401; canonicalResult: 5282; rangeEvidence: 0; materialWriteEventEvidence: 4660; receiptEvidence: 22974; argsJson: 408; argsCanonical: 463; grantJson: 1942; grantCanonical: 1993; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5793; payload dependencies: 922 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-cold-0-0 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19296; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22857; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5719; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-cold-1-0 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19296; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22857; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5719; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| productPayload-cold-2-0 | 9 / 1 | 12 | 0 | 0 | 0 / 0 | 11 / 0 / 5 | 10 / 0 | 227 / 76 (75 / 25) | 1 / 1 / 0 / 0 | canonicalJournal: 19296; canonicalResult: 5253; rangeEvidence: 0; materialWriteEventEvidence: 4646; receiptEvidence: 22857; argsJson: 403; argsCanonical: 458; grantJson: 1940; grantCanonical: 1991; authorityJson: 1490; authorityCanonical: 1434; schemaManifestJson: 438; schemaManifestCanonical: 475; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2718; applicationGraph.manifestByteLengthText: 1573; applicationGraph.schemaByteLengthText: 264; applicationGraph.functionCatalogByteLengthText: 745; applicationGraph.functionEntryByteLengthText: 160; applicationGraph.schemaBindingByteLengthText: 495; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 5719; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-0 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34002; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33648; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8070; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-1 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34020; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33658; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8080; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-2 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34020; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33658; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8080; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-3 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34020; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33658; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8080; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-4 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34020; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33658; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8080; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-5 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34020; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33658; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8080; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-6 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34020; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33658; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8080; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-7 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34020; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33658; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8080; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-8 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34020; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33658; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8080; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-9 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34020; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33658; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8080; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-10 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34109; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33766; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8142; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-11 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34109; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33766; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8142; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-12 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34109; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33766; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8142; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-13 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34109; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33766; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8142; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-14 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34109; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33766; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8142; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-15 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34109; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33766; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8142; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-16 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34109; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33766; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8142; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-17 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34109; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33766; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8142; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-18 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34109; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33766; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8142; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-19 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34127; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33776; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8152; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-20 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34127; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33776; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8152; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-21 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34127; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33776; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8152; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-warm-0-22 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34127; canonicalResult: 4758; rangeEvidence: 0; materialWriteEventEvidence: 9427; receiptEvidence: 33776; argsJson: 426; argsCanonical: 481; grantJson: 1950; grantCanonical: 2001; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8152; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 916 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-cold-0-0 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34002; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33648; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8070; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-cold-1-0 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34002; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33648; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8070; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |
| mixedWorkflow-cold-2-0 | 9 / 1 | 15 | 0 | 0 | 0 / 0 | 26 / 0 / 15 | 10 / 0 | 269 / 87 (117 / 36) | 1 / 1 / 0 / 0 | canonicalJournal: 34002; canonicalResult: 4731; rangeEvidence: 0; materialWriteEventEvidence: 9409; receiptEvidence: 33648; argsJson: 420; argsCanonical: 475; grantJson: 1948; grantCanonical: 1999; authorityJson: 1506; authorityCanonical: 1450; schemaManifestJson: 1075; schemaManifestCanonical: 1055; applicationGraph.activationByteLengthText: 452; applicationGraph.readinessByteLengthText: 2934; applicationGraph.manifestByteLengthText: 2427; applicationGraph.schemaByteLengthText: 788; applicationGraph.functionCatalogByteLengthText: 922; applicationGraph.functionEntryByteLengthText: 176; applicationGraph.schemaBindingByteLengthText: 562; applicationGraph.relationSetReadinessByteLengthText: 0; medusa.product dependencies: 8070; medusa.pricing dependencies: 1352; medusa.link.productVariantPriceSet dependencies: 1986; payload dependencies: 910 | strongReferenceDemands, unobservedPublicationOwnerParameters, nonScalarParameterWireEncoding |

## Observed publication query partitions

Traced samples only: parameter counts and scalar bytes come from existing owner query observers. Quiet untraced samples install no SQL observer. Complex PostgreSQL wire encodings and owners without observers remain unavailable. No parameter values are retained.

| Sample | Owner query | Dispatches | Parameters | Scalar UTF-8 / byte parameters | Parameters with unknown encoding |
| --- | --- | ---: | ---: | ---: | ---: |
| product-warm-0-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-0 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-warm-0-0 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-0 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-0 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-0 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-1 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-1 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-1 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-warm-0-1 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-1 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-1 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-1 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-1 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-1 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-1 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-1 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-2 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-2 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-2 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-warm-0-2 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-2 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-2 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-2 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-2 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-2 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-2 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-2 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-3 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-3 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-3 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-warm-0-3 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-3 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-3 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-3 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-3 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-3 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-3 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-3 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-4 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-4 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-4 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-warm-0-4 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-4 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-4 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-4 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-4 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-4 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-4 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-4 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-5 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-5 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-5 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-warm-0-5 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-5 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-5 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-5 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-5 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-5 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-5 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-5 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-6 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-6 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-6 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-warm-0-6 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-6 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-6 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-6 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-6 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-6 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-6 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-6 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-7 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-7 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-7 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-warm-0-7 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-7 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-7 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-7 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-7 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-7 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-7 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-7 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-8 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-8 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-8 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-warm-0-8 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-8 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-8 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-8 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-8 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-8 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-8 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-8 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-9 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-9 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-9 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-warm-0-9 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-9 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-9 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-9 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-9 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-9 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-9 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-9 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-10 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-10 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-10 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-10 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-10 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-10 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-10 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-10 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-10 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-10 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-10 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-11 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-11 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-11 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-11 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-11 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-11 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-11 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-11 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-11 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-11 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-11 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-12 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-12 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-12 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-12 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-12 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-12 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-12 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-12 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-12 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-12 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-12 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-13 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-13 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-13 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-13 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-13 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-13 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-13 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-13 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-13 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-13 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-13 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-14 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-14 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-14 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-14 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-14 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-14 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-14 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-14 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-14 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-14 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-14 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-15 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-15 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-15 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-15 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-15 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-15 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-15 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-15 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-15 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-15 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-15 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-16 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-16 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-16 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-16 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-16 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-16 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-16 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-16 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-16 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-16 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-16 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-17 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-17 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-17 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-17 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-17 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-17 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-17 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-17 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-17 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-17 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-17 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-18 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-18 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-18 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-18 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-18 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-18 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-18 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-18 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-18 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-18 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-18 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-19 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-19 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-19 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-19 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-19 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-19 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-19 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-19 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-19 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-19 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-19 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-20 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-20 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-20 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-20 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-20 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-20 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-20 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-20 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-20 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-20 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-20 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-21 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-21 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-21 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-21 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-21 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-21 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-21 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-21 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-21 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-21 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-21 | readBindingHead | 1 | 3 | 54 | 0 |
| product-warm-0-22 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-warm-0-22 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-warm-0-22 | recheckOutcome | 1 | 6 | 149 | 0 |
| product-warm-0-22 | lockSession | 1 | 3 | 73 | 0 |
| product-warm-0-22 | lockLease | 1 | 3 | 73 | 0 |
| product-warm-0-22 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-warm-0-22 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-warm-0-22 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-warm-0-22 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-warm-0-22 | writeCommitChange | 1 | 12 | 184 | 0 |
| product-warm-0-22 | readBindingHead | 1 | 3 | 54 | 0 |
| product-cold-0-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-cold-0-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-cold-0-0 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-cold-0-0 | lockSession | 1 | 3 | 73 | 0 |
| product-cold-0-0 | lockLease | 1 | 3 | 73 | 0 |
| product-cold-0-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-cold-0-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-cold-0-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-cold-0-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-cold-0-0 | writeCommitChange | 1 | 12 | 182 | 0 |
| product-cold-0-0 | readBindingHead | 1 | 3 | 54 | 0 |
| product-cold-1-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-cold-1-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-cold-1-0 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-cold-1-0 | lockSession | 1 | 3 | 73 | 0 |
| product-cold-1-0 | lockLease | 1 | 3 | 73 | 0 |
| product-cold-1-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-cold-1-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-cold-1-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-cold-1-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-cold-1-0 | writeCommitChange | 1 | 12 | 182 | 0 |
| product-cold-1-0 | readBindingHead | 1 | 3 | 54 | 0 |
| product-cold-2-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| product-cold-2-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| product-cold-2-0 | recheckOutcome | 1 | 6 | 148 | 0 |
| product-cold-2-0 | lockSession | 1 | 3 | 73 | 0 |
| product-cold-2-0 | lockLease | 1 | 3 | 73 | 0 |
| product-cold-2-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| product-cold-2-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| product-cold-2-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| product-cold-2-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| product-cold-2-0 | writeCommitChange | 1 | 12 | 182 | 0 |
| product-cold-2-0 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-0 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-warm-0-0 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-0 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-0 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-0 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-1 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-1 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-1 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-warm-0-1 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-1 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-1 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-1 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-1 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-1 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-1 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-1 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-2 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-2 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-2 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-warm-0-2 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-2 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-2 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-2 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-2 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-2 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-2 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-2 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-3 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-3 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-3 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-warm-0-3 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-3 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-3 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-3 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-3 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-3 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-3 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-3 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-4 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-4 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-4 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-warm-0-4 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-4 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-4 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-4 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-4 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-4 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-4 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-4 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-5 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-5 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-5 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-warm-0-5 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-5 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-5 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-5 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-5 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-5 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-5 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-5 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-6 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-6 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-6 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-warm-0-6 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-6 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-6 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-6 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-6 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-6 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-6 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-6 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-7 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-7 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-7 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-warm-0-7 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-7 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-7 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-7 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-7 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-7 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-7 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-7 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-8 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-8 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-8 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-warm-0-8 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-8 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-8 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-8 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-8 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-8 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-8 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-8 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-9 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-9 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-9 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-warm-0-9 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-9 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-9 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-9 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-9 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-9 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-9 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-9 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-10 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-10 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-10 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-10 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-10 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-10 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-10 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-10 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-10 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-10 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-10 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-11 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-11 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-11 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-11 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-11 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-11 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-11 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-11 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-11 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-11 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-11 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-12 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-12 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-12 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-12 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-12 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-12 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-12 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-12 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-12 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-12 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-12 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-13 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-13 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-13 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-13 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-13 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-13 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-13 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-13 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-13 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-13 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-13 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-14 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-14 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-14 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-14 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-14 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-14 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-14 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-14 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-14 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-14 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-14 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-15 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-15 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-15 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-15 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-15 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-15 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-15 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-15 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-15 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-15 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-15 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-16 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-16 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-16 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-16 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-16 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-16 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-16 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-16 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-16 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-16 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-16 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-17 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-17 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-17 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-17 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-17 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-17 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-17 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-17 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-17 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-17 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-17 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-18 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-18 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-18 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-18 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-18 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-18 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-18 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-18 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-18 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-18 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-18 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-19 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-19 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-19 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-19 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-19 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-19 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-19 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-19 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-19 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-19 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-19 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-20 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-20 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-20 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-20 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-20 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-20 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-20 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-20 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-20 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-20 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-20 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-21 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-21 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-21 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-21 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-21 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-21 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-21 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-21 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-21 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-21 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-21 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-warm-0-22 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-warm-0-22 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-warm-0-22 | recheckOutcome | 1 | 6 | 157 | 0 |
| productPayload-warm-0-22 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-warm-0-22 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-warm-0-22 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-warm-0-22 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-warm-0-22 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-warm-0-22 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-warm-0-22 | writeCommitChange | 1 | 18 | 276 | 0 |
| productPayload-warm-0-22 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-cold-0-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-cold-0-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-cold-0-0 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-cold-0-0 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-cold-0-0 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-cold-0-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-cold-0-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-cold-0-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-cold-0-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-cold-0-0 | writeCommitChange | 1 | 18 | 273 | 0 |
| productPayload-cold-0-0 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-cold-1-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-cold-1-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-cold-1-0 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-cold-1-0 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-cold-1-0 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-cold-1-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-cold-1-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-cold-1-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-cold-1-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-cold-1-0 | writeCommitChange | 1 | 18 | 273 | 0 |
| productPayload-cold-1-0 | readBindingHead | 1 | 3 | 54 | 0 |
| productPayload-cold-2-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| productPayload-cold-2-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| productPayload-cold-2-0 | recheckOutcome | 1 | 6 | 156 | 0 |
| productPayload-cold-2-0 | lockSession | 1 | 3 | 73 | 0 |
| productPayload-cold-2-0 | lockLease | 1 | 3 | 73 | 0 |
| productPayload-cold-2-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| productPayload-cold-2-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| productPayload-cold-2-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| productPayload-cold-2-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| productPayload-cold-2-0 | writeCommitChange | 1 | 18 | 273 | 0 |
| productPayload-cold-2-0 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-0 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-warm-0-0 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-0 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-0 | writeCommitChange | 1 | 54 | 824 | 0 |
| mixedWorkflow-warm-0-0 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-1 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-1 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-1 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-warm-0-1 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-1 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-1 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-1 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-1 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-1 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-1 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-1 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-2 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-2 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-2 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-warm-0-2 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-2 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-2 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-2 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-2 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-2 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-2 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-2 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-3 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-3 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-3 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-warm-0-3 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-3 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-3 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-3 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-3 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-3 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-3 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-3 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-4 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-4 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-4 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-warm-0-4 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-4 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-4 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-4 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-4 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-4 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-4 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-4 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-5 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-5 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-5 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-warm-0-5 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-5 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-5 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-5 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-5 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-5 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-5 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-5 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-6 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-6 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-6 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-warm-0-6 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-6 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-6 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-6 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-6 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-6 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-6 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-6 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-7 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-7 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-7 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-warm-0-7 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-7 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-7 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-7 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-7 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-7 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-7 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-7 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-8 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-8 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-8 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-warm-0-8 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-8 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-8 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-8 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-8 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-8 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-8 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-8 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-9 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-9 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-9 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-warm-0-9 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-9 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-9 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-9 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-9 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-9 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-9 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-9 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-10 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-10 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-10 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-10 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-10 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-10 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-10 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-10 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-10 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-10 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-10 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-11 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-11 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-11 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-11 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-11 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-11 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-11 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-11 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-11 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-11 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-11 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-12 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-12 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-12 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-12 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-12 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-12 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-12 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-12 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-12 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-12 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-12 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-13 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-13 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-13 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-13 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-13 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-13 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-13 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-13 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-13 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-13 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-13 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-14 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-14 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-14 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-14 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-14 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-14 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-14 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-14 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-14 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-14 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-14 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-15 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-15 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-15 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-15 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-15 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-15 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-15 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-15 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-15 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-15 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-15 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-16 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-16 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-16 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-16 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-16 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-16 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-16 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-16 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-16 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-16 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-16 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-17 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-17 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-17 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-17 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-17 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-17 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-17 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-17 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-17 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-17 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-17 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-18 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-18 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-18 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-18 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-18 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-18 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-18 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-18 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-18 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-18 | writeCommitChange | 1 | 54 | 833 | 0 |
| mixedWorkflow-warm-0-18 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-19 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-19 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-19 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-19 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-19 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-19 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-19 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-19 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-19 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-19 | writeCommitChange | 1 | 54 | 842 | 0 |
| mixedWorkflow-warm-0-19 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-20 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-20 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-20 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-20 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-20 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-20 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-20 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-20 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-20 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-20 | writeCommitChange | 1 | 54 | 842 | 0 |
| mixedWorkflow-warm-0-20 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-21 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-21 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-21 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-21 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-21 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-21 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-21 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-21 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-21 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-21 | writeCommitChange | 1 | 54 | 842 | 0 |
| mixedWorkflow-warm-0-21 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-warm-0-22 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-22 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-warm-0-22 | recheckOutcome | 1 | 6 | 164 | 0 |
| mixedWorkflow-warm-0-22 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-22 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-warm-0-22 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-warm-0-22 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-warm-0-22 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-22 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-warm-0-22 | writeCommitChange | 1 | 54 | 842 | 0 |
| mixedWorkflow-warm-0-22 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-cold-0-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-cold-0-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-cold-0-0 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-cold-0-0 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-cold-0-0 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-cold-0-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-cold-0-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-cold-0-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-cold-0-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-cold-0-0 | writeCommitChange | 1 | 54 | 824 | 0 |
| mixedWorkflow-cold-0-0 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-cold-1-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-cold-1-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-cold-1-0 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-cold-1-0 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-cold-1-0 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-cold-1-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-cold-1-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-cold-1-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-cold-1-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-cold-1-0 | writeCommitChange | 1 | 54 | 824 | 0 |
| mixedWorkflow-cold-1-0 | readBindingHead | 1 | 3 | 54 | 0 |
| mixedWorkflow-cold-2-0 | lockScopeClock | 2 | 4 | 86 | 0 |
| mixedWorkflow-cold-2-0 | validateActiveApplicationSchema | 1 | 3 | 44 | 0 |
| mixedWorkflow-cold-2-0 | recheckOutcome | 1 | 6 | 163 | 0 |
| mixedWorkflow-cold-2-0 | lockSession | 1 | 3 | 73 | 0 |
| mixedWorkflow-cold-2-0 | lockLease | 1 | 3 | 73 | 0 |
| mixedWorkflow-cold-2-0 | lockJournalRoot | 1 | 4 | 74 | 0 |
| mixedWorkflow-cold-2-0 | readDatabaseTime | 2 | 4 | 86 | 0 |
| mixedWorkflow-cold-2-0 | loadRowHeads | 1 | 0 | 0 | 0 |
| mixedWorkflow-cold-2-0 | loadPriorDocuments | 1 | 0 | 0 | 0 |
| mixedWorkflow-cold-2-0 | writeCommitChange | 1 | 54 | 824 | 0 |
| mixedWorkflow-cold-2-0 | readBindingHead | 1 | 3 | 54 | 0 |

## Observed database transaction intervals in successful warm requests

These BEGIN-to-settlement intervals include application work and waits; they are not lock-hold measurements.

| Workload | Pool | Phase | Outcome | Intervals | Duration total (ms) | Range (ms) |
| --- | --- | --- | --- | ---: | ---: | --- |
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 100 | 5711.5 | 1.5–291.9 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 260 | 5053.0 | 16.8–29.2 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 200 | 3539.4 | 15.4–34.3 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 200 | 3493.5 | 14.8–29.5 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 200 | 3480.9 | 15.7–24.3 |
| productPayload | target | invocation / request admission | commit | 160 | 2770.0 | 1.1–289.8 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 20 | 2727.9 | 129.5–148.0 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 40 | 2218.9 | 3.9–762.1 |
| productPayload | target | invocation / authoritative publication | commit | 20 | 1719.5 | 67.6–281.7 |
| mixedWorkflow | target | invocation / request admission | commit | 160 | 1395.7 | 1.5–32.8 |
| product | target | invocation / request admission | commit | 160 | 1372.1 | 1.1–40.6 |
| product | target | invocation / authoritative publication | commit | 20 | 1343.0 | 63.4–75.1 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 40 | 1193.5 | 4.2–65.1 |
| product | target | invocation / journal seal and OCC verification | commit | 40 | 986.0 | 3.6–54.1 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 20 | 315.2 | 14.8–17.2 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 20 | 304.1 | 14.2–17.1 |
| productPayload | control | invocation / request admission | commit | 20 | 202.7 | 0.8–124.6 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 168.3 | 3.6–8.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 166.2 | 3.9–5.9 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 153.8 | 3.3–6.1 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 20 | 64.9 | 3.0–3.8 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 20 | 62.2 | 2.5–4.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 20 | 61.5 | 2.6–3.8 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 20 | 46.5 | 1.3–18.2 |
| mixedWorkflow | control | invocation / request admission | commit | 20 | 28.6 | 1.3–1.8 |
| product | control | invocation / request admission | commit | 20 | 24.8 | 0.9–1.5 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 5300 | 5300 | 0 | 2619.5 |
| productPayload | unattributed | target | invocation / request admission | 2180 | 2180 | 0 | 2299.8 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 4200 | 4200 | 0 | 1896.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 4200 | 4200 | 0 | 1851.8 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 4180 | 4180 | 0 | 1845.2 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 1200 | 1200 | 0 | 1805.1 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 3500 | 3500 | 0 | 1479.8 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 2280 | 2280 | 0 | 1161.4 |
| productPayload | unattributed | target | invocation / authoritative publication | 1760 | 1760 | 0 | 965.7 |
| product | unattributed | target | invocation / request admission | 2180 | 2180 | 0 | 909.2 |
| mixedWorkflow | unattributed | target | invocation / request admission | 2180 | 2180 | 0 | 890.8 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 1200 | 1200 | 0 | 686.1 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 2260 | 2260 | 0 | 682.0 |
| product | unattributed | target | invocation / authoritative publication | 1700 | 1700 | 0 | 648.5 |
| product | unattributed | target | invocation / journal seal and OCC verification | 1200 | 1200 | 0 | 601.1 |
| productPayload | unattributed | control | invocation / request admission | 580 | 580 | 0 | 324.6 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 380 | 380 | 0 | 201.7 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 360 | 360 | 0 | 196.8 |
| mixedWorkflow | unattributed | control | invocation / request admission | 580 | 580 | 0 | 152.5 |
| product | unattributed | control | invocation / request admission | 580 | 580 | 0 | 141.0 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 620 | 620 | 0 | 133.7 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 420 | 420 | 0 | 118.9 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 420 | 420 | 0 | 118.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 420 | 420 | 0 | 111.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 420 | 420 | 0 | 101.7 |
| product | unattributed | control | invocation / authoritative publication | 340 | 340 | 0 | 87.2 |
| productPayload | unattributed | control | invocation / authoritative publication | 380 | 380 | 0 | 81.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 240 | 240 | 0 | 66.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 240 | 240 | 0 | 65.0 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 240 | 240 | 0 | 64.3 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 220 | 220 | 0 | 63.8 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 220 | 220 | 0 | 62.5 |
| product | unattributed | control | invocation / journal seal and OCC verification | 220 | 220 | 0 | 62.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 19.8 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 19.3 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 19.1 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 14.7 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1568:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 13.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 12.9 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 12.5 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1597:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 9.1 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1568:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 8.8 |
| product | at .packages/persistence-postgres/src/appRows.ts:1568:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 7.6 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1597:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 4.9 |
| product | at .packages/persistence-postgres/src/appRows.ts:1597:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 4.1 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 509.0 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 100 | 100 | 0 | 253.5 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 188.7 | commit |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 169.1 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 160 | 160 | 0 | 152.0 | commit |
| product | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 98.5 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `c4f8c65b9a024baeef487999a2cfefd3fda5e67578ea9269fe6f208b7baedfa9` | unattributed | target | invocation / authoritative publication | 20 | 20 | 0 | 91.2 | select * from ( select $? : : integer as "ordinal" , member . * from ( values ( ? ) ) as request ( present ) left join l |
| product | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 87.8 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `f866e89306489d86008bf5831891b716054c270deb4bbfd87354f4118e34193e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 70.3 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| product | `30769bbd2072761e6a4751d262b3fad7947a08d4571f1586f9779799ab67283f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 69.1 | with latest as ( select distinct on ( revision . encoded_key , revision . row_id ) revision . table_id , revision . key_ |
| product | `1640ee04592543d0907c11dd6744a188ebb68b0552ff212d925b146da49f7758` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 62.4 | select "fx_system_index_build_state" . "scope_id" , "fx_system_index_build_state" . "index_definition_id" , "fx_system_i |
| product | `03a7d63c7b07612a7e973b680663f82dd129bb169e49613d6292763933cc25ae` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 61.3 | select "table_id" , "logical_index_id" , "source_sha256" , "lifecycle" , "covered_through_commit_seq" from "fx_system_se |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 160 | 160 | 0 | 1521.5 | commit |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / journal seal and OCC verification | 40 | 40 | 0 | 1200.7 | commit |
| productPayload | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 519.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / authoritative publication | 20 | 20 | 0 | 293.9 | commit |
| productPayload | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 100 | 100 | 0 | 258.8 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | control | invocation / request admission | 20 | 20 | 0 | 192.4 | commit |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 180.9 | commit |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 166.7 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `c4f8c65b9a024baeef487999a2cfefd3fda5e67578ea9269fe6f208b7baedfa9` | unattributed | target | invocation / authoritative publication | 20 | 20 | 0 | 93.8 | select * from ( select $? : : integer as "ordinal" , member . * from ( values ( ? ) ) as request ( present ) left join l |
| productPayload | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 92.8 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 77.0 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `30769bbd2072761e6a4751d262b3fad7947a08d4571f1586f9779799ab67283f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 72.9 | with latest as ( select distinct on ( revision . encoded_key , revision . row_id ) revision . table_id , revision . key_ |
| mixedWorkflow | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 636.2 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 492.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 325.1 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 278.2 | commit |
| mixedWorkflow | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 100 | 100 | 0 | 232.9 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 221.0 | commit |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 160 | 160 | 0 | 161.3 | commit |
| mixedWorkflow | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 152.2 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| mixedWorkflow | `cee4f47101805ddfb136e3188b3df8fffc406750d74e79e86009acf9769284b9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 152.1 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `fea27384148e86304070a70ff56d9b3091f37f3ba52bf39704f9cd37044018e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 400 | 400 | 0 | 149.2 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `23ecae9c52871046872fa24bf0ff7b63adffcfd671f0b9e1db804135609f18ab` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 139.3 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| mixedWorkflow | `f23e4a40858f630ac0a88d3447e83558dcdd166cf2adbb1d7e966b60dbcffd18` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 109.8 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| standaloneWorkflow | `41a41574b3c5fa07b54489437a86b27de98a8c20aa81f5aca5d09f68258de88e` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 480 | 480 | 0 | 308.5 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | ambiguous | target | invocation / standalone native workflow | 100 | 100 | 0 | 226.2 | commit |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 360 | 360 | 0 | 177.3 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 60 | 60 | 0 | 86.5 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 100 | 100 | 0 | 56.9 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 200 | 200 | 0 | 52.1 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| standaloneWorkflow | `d3c76201bb4a138e5f74aa633b5db20ef3ba7efd9571c52ed250e6037ada0f3e` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 60 | 60 | 0 | 44.6 | with "capture_clock" as ( select "last_commit_seq" , "epoch" from "fx_system_scope_clock" where "fx_system_scope_clock"  |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 200 | 200 | 0 | 40.2 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 180 | 180 | 0 | 40.2 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 180 | 180 | 0 | 39.8 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| standaloneWorkflow | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | ambiguous | target | invocation / standalone native workflow | 200 | 200 | 0 | 36.7 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| standaloneWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | control | invocation / standalone native workflow | 20 | 20 | 0 | 36.4 | commit |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 592.3 | 0.6 |
| product | invocation / Worker execution | 337.4 | 0.8 |
| product | invocation / Worker execution / Worker construction and ready | 77.5 | 77.5 |
| product | invocation / Worker execution / Worker dispatch | 246.5 | 22.4 |
| product | invocation / Worker execution / Worker dispatch / Application point | 5.7 | 5.7 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 6.3 | 6.3 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 6.3 | 6.3 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 199.3 | 199.3 |
| product | invocation / Worker execution / Worker disposal | 12.6 | 12.6 |
| product | invocation / authoritative publication | 82.9 | 82.9 |
| product | invocation / journal seal and OCC verification | 78.2 | 78.2 |
| product | invocation / request admission | 90.2 | 90.2 |
| productPayload | invocation | 639.3 | 0.6 |
| productPayload | invocation / Worker execution | 372.3 | 0.8 |
| productPayload | invocation / Worker execution / Worker construction and ready | 78.3 | 78.3 |
| productPayload | invocation / Worker execution / Worker dispatch | 275.9 | 26.3 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 5.5 | 5.5 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 5.9 | 5.9 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 6.6 | 6.6 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 195.5 | 195.5 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 21.3 | 21.3 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 2.0 | 2.0 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 3.0 | 3.0 |
| productPayload | invocation / Worker execution / Worker disposal | 12.5 | 12.5 |
| productPayload | invocation / authoritative publication | 89.4 | 89.4 |
| productPayload | invocation / journal seal and OCC verification | 88.0 | 88.0 |
| productPayload | invocation / request admission | 90.2 | 90.2 |
| mixedWorkflow | invocation | 1069.2 | 0.6 |
| mixedWorkflow | invocation / Worker execution | 698.5 | 0.9 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 78.8 | 78.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 607.9 | 27.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 5.8 | 5.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 6.5 | 6.5 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 196.1 | 196.1 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 339.9 | 339.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 21.7 | 21.7 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 2.0 | 2.0 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 2.9 | 2.9 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 12.9 | 12.9 |
| mixedWorkflow | invocation / authoritative publication | 159.9 | 159.9 |
| mixedWorkflow | invocation / journal seal and OCC verification | 108.7 | 108.7 |
| mixedWorkflow | invocation / request admission | 93.1 | 93.1 |
| standaloneWorkflow | invocation | 291.6 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 291.6 | 291.6 |

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
