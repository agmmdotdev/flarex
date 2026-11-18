# Private mixed mutation performance baseline

Revision: `8125716500b618f10a3e4a21103a56e170a7ca51`; working diff SHA-256: `c255dd46d33990eebc06c05f76539e2531666d91506e9a2a650d9d4de9854d8c`; mode: **full**, observation: **traced**.
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
    "role": "flarex_runtime_1790844338414_hes3rd1urgg",
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
    "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts": "306984d0de73c8a689109c4a638bee9becbecfd80c2f24324ae33aaa5b4e1c9c",
    "packages/flarex-backend/test/support/mixedMutationProductFixture.ts": "b7a5ce2e3f7ecf4686134872efc483ff7ff4af4a11c5c9a19aeccf043f190cf4",
    "packages/flarex-backend/test/support/mixedMutationCpuProfile.ts": "2c7815c287028037f77789dbf9917906433d1b5f851056d265559a5dd9eaa0c0",
    "packages/flarex-backend/test/support/mixedMutationPerformanceReport.ts": "a2f4852f4c15c88b21da779441ab195183c9798d77c1b49f7b655f1f89d76e0b",
    "packages/medusa-adapter/src/product-attempt.ts": "34720033a89cde4508110fa763211d58d6a2d92c7f0afb0c654c4de27fddf9ae",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts": "e891829bfbd48aa9bc8c9f5765c3ce5a7d752877cfd10088d52c5fe3b0b21c35",
    "packages/executor/src/pointMutationJournal.ts": "17df43b3372241485feb6eee6abdaa4769f223db7c8b05426feefed59d3acd68",
    "packages/executor/src/storedAttemptAuthentication.ts": "cea2af58ed2673b9625b1ded8519e14c8ddbeca8f8e1dd250d8751dfd3eb2d74",
    "packages/executor/src/storedAttemptAuthentication/authenticationOperations.ts": "8244ad5330d61ff7c993e3b294069ef138def222c572405538b84a4e24bde633",
    "packages/executor/src/storedAttemptAuthentication/commitAuthorityModel.ts": "a02b39703ff6c1b182da3020176f8c16c850b1d2e56a6cd3a8252ab1d50f5ed3",
    "packages/executor/src/storedAttemptAuthentication/planningOperations.ts": "39ef67d14a8bda6de855eb79629c87e989969420233bf4695ae80a8c5267bf39",
    "packages/executor/src/storedAttemptAuthentication/pointCommitRuntimeModel.ts": "c370d2dc5e9dde1e27e51963e0ff928085733a5e70686267dd979ac4118bcd46",
    "packages/executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations.ts": "30794cd0c5aca5df7a0fd3ce0da8266e06a59c32e9ef8958a4298fa7c2f1375e",
    "packages/persistence-postgres/drizzle/0119_protected_metadata_epoch.sql": "6330d5e0e51c4e165f9e359c36acefbd29906a6047a88d606026880bfe9b9651",
    "packages/persistence-postgres/drizzle/0120_immutable_target_metadata_protection.sql": "6ece58db6038056748737bc67cd39605166c0d76473dfd9d936cceb67415a2d3",
    "packages/persistence-postgres/src/appRows.ts": "a13b09122311ae7d7d8e56ca124b35a9cdcc66db9e56b219a0ddd18c83899a61",
    "packages/persistence-postgres/src/appIndexEntries.ts": "67f7aba07b8c30f6a4eb8a061a3363d1ea136a2962974b597d364189a220bc31",
    "packages/persistence-postgres/src/appDeveloperIndexCommitV1.ts": "a1a75b7a0c1c3cdc5ee472080f3437638aceb34d3e82c56eee164aab776bc466",
    "packages/persistence-postgres/src/appUniqueKeys.ts": "9beb600cccfef27ec5f63ec08bf35dda1cf71a0859b5d0dc64e92aadbd462b1d",
    "packages/persistence-postgres/src/appSchemaCandidateValidation.ts": "80a1f837fa914bc4b423721030bddcc23009bb67a5206eee79885462ca593ae2",
    "packages/persistence-postgres/src/appUniqueConstraintSetBuildV1.ts": "d2f059b8c8b94c68d65d3d0ec328af207592cfe2fcca21d45af6591c2ff5905a",
    "packages/persistence-postgres/src/applicationActiveHeadRead.ts": "6ae20222a735c1b9a70e3a7f108796a68b88b86706d0ceb93ab23b0bb4f3ed79",
    "packages/persistence-postgres/src/applicationActivation.ts": "93d72b06df1e6011aa52fa1d4bc1094f56da98fdc7a3f998274972b8901c4b97",
    "packages/persistence-postgres/src/applicationBindingProjection.ts": "c77127551841e0e1ab2b3ffe3f6f279c0119b163d3a0da333a309c2c4e5abe95",
    "packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts": "81bab9718b47e76e424b49d8e95bff8361a8bc0e06d62181d5f6ccf304284454",
    "packages/persistence-postgres/src/applicationDocumentMaterialization/model.ts": "638aa6871e18895691433ad64cf981252ff0269bfd8c2b60aad35e6e393da81c",
    "packages/persistence-postgres/src/applicationReadiness.ts": "def1e35955257fdf8ea1f5c2f011621608865c2fe1550a112eb811e794b49646",
    "packages/persistence-postgres/src/applicationRelationReadinessFold.ts": "c9e3c34a1d7eb4de52d47c04480c0bd290530cbd4c1ea17bb83ccd61709ce06f",
    "packages/persistence-postgres/src/boundedRequestLifetime.ts": "eb640b68d55a2a825e62a7838c46f40ef2c391009cbf6ccc1ab4584956a805c9",
    "packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts": "b90961ab1411be55673115d3e9c678c8c8d7a3c32e5ac24b4c482be7a6714c23",
    "packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts": "8793eadbfc4b1cc65174dff73fbb3956fb8a1cee5ee8d70ffc1cddcdb250163b",
    "packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts": "f22b77f82ab567fca2443ca404711c2bdaa92803692082283297c4155e022c48",
    "packages/persistence-postgres/src/commitPublication/publication.ts": "5fa1dfc72d1e0c421d405ea9a660b7b9f591a8cb986097b29ecb655ba7528ba4",
    "packages/persistence-postgres/src/commitPublication/strongReferenceAdmission.ts": "3ac46c31c321aa2732e447d89cebb4760ebd58270d862a674178435e8e45a7e7",
    "packages/persistence-postgres/src/commitPublication/strongReferenceValidation.ts": "86a497b4185a238c87eed8329be130b744baca5edb39afabc8b13beb5a192331",
    "packages/persistence-postgres/src/drizzleSchema.ts": "195bd525e02fdf9251b2516fa3e4da088a45e9c8b2b2cc23ec1ec899d9022b0a",
    "packages/persistence-postgres/src/frameworkSchema/binding/logicalSchema.ts": "e8faaa766cfc7106a78b5dd52a73b583feff31876a64906bb57724f7a90582e2",
    "packages/persistence-postgres/src/frameworkSchema/binding/repository.ts": "22e2028f9dc5ae75aa21cb7fe359619b921e05658f1d45c3b19187ae441de0bd",
    "packages/persistence-postgres/src/indexBuildStates.ts": "0e63a783616ecb5f5d048d3d33b0e5fbc2fe068e42627e23f211c02e984eb9d0",
    "packages/persistence-postgres/src/intrinsicCreationTimeIndexBuildV1.ts": "51595f0155ad38e1104847c9dd01c76e4a8b456247f5d408a88bea7602c73974",
    "packages/persistence-postgres/src/locatedReadCommittedEffect.ts": "1470f8835d1570502590b1759223bf9d067935993ad9f4aa619f87210214501c",
    "packages/persistence-postgres/src/logicalDocuments/detachChanges.ts": "6c5cdd83a2c4fcfa5eb1252f50baa6d8ac0233f306ce89304dd0b018556a3f31",
    "packages/persistence-postgres/src/logicalDocuments/commitEvidence.ts": "25cd43b35aee67c27047d814209248711f180db8a2b170fec02c45e157cd65fa",
    "packages/persistence-postgres/src/logicalDocuments/journalEvidence.ts": "8a6635bd587db8da028bb61f95902bdc7a7faa9db8ee2f455f40a09d6b0c05ba",
    "packages/persistence-postgres/src/logicalDocuments/indexReads.ts": "fd6dbee36ad878edf096fd9cd42c5df3b3d975b38c92ba22d613d3150686002b",
    "packages/persistence-postgres/src/logicalDocuments/materialization.ts": "348a508dac73b0c161fdcf18eab610ffaf0c34f57b89f5d6c61c575f8b57db48",
    "packages/persistence-postgres/src/logicalDocuments/documentAdmission.ts": "b4cd849583591b9d5d92c4b46afdc237be4152d70316a99e92d122b7e1ca7ac1",
    "packages/persistence-postgres/src/logicalDocuments/model.ts": "81f96a9e40dbd5b52d36d422ec29e1f43a8c9785a1b39515fe6b2e0ce2bac9d1",
    "packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts": "6e28fab0436728864e115788e8671d9b74ee5817d146dbd05c69676cc3683625",
    "packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts": "06619934ee043446926819905fa71b93d948ee1ba89c85d2ceae2c5c65904f1c",
    "packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts": "8c0f885569d2e9b7399895fd131598d3064b31d892ddfad3adb57b3bb44d93b3",
    "packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts": "077a5436e327ccc410e307f56e808a2f3bae69ebcca3ff1182dc5f8c8fb762ef",
    "packages/persistence-postgres/src/logicalDocuments/searchEntries.ts": "18addfa9d8abcf5772f436a95e5053fae6ca009cd48001cdc4947d9203a0026b",
    "packages/persistence-postgres/src/logicalDocuments/searchReads.ts": "a1a46bac1f5e1d7bf1e6b9007bffb5edbebf46d76f493e4a2d4984f98063b437",
    "packages/persistence-postgres/src/logicalDocuments/workingSet.ts": "7ca6a353ce4ec1944b64527cd21f29f3e38483914ca507e7beb815abc2b22573",
    "packages/persistence-postgres/src/logicalSearchBuild.ts": "1b4fc59ebcf5365c6ce0d1c24d620ecd8c30bcad910c213ffe260ac838866e3c",
    "packages/persistence-postgres/src/logicalStorageReadiness.ts": "3ee07b0a71486be5ab6cbae03844aae2d99966d91971c3f33992228153d856b3",
    "packages/persistence-postgres/src/pointCommitTransaction.ts": "df2a6023419b2873d268e933ae2557fdecc56f642b52f98e2ed5e0173de6fead",
    "packages/persistence-postgres/src/postgres.ts": "ef60f726bdb0569d5773d6fc22dbe2bb344494939931b250322873ddcc2941f0",
    "packages/persistence-postgres/src/preparedMetadataEpoch.ts": "378fc8d2b0215ea6e7da26cc4247d4b9548d2841c7ec038cdb5d3737280bc156",
    "packages/persistence-postgres/src/preparedHostRuntime.ts": "0faf9ff27d80631d082d8c6bb88f26399d617b7c9adaffd7c45f319ef8d2872b",
    "packages/persistence-postgres/src/retainedHistoryFloorObservation.ts": "09d426b05fcb79917a2499546298030d496283fb442defbf158c848cc8397401",
    "packages/persistence-postgres/src/scopeClock.ts": "1e3cdfdf07246a7703c3a4d6ebff781e24939c7979d3dcc64a58f4d626c9a09f",
    "packages/persistence-postgres/src/schema.ts": "f8edf52239fba608f7a09d9d772be0b5bb7b3d3daeb08a561ba17f159e0f410f",
    "packages/persistence-postgres/src/sessionJournalStore.ts": "432736ce56d2dee6bb05a69e767696c95b9476bd13dfcdbad25dcade7d6b442c",
    "packages/persistence-postgres/src/storedAttemptEvidence.ts": "20726df3acab64dce29598b1170f1055b65f82bc27ac1b893907fd517efeda70",
    "packages/persistence-postgres/src/storedCommitAuthority/model.ts": "1387de56b5a74fc3343e7c5e041c74393eae1aa6f2eed9ad3f1a08af227fd81a",
    "packages/persistence-postgres/src/storedCommitAuthority/materialization.ts": "26db0f130f05af1551e8a6980a40cedbad894ab973f34bb66073a085505398ff",
    "packages/persistence-postgres/src/storedCommitAuthority/postgresLoader.ts": "529216915ce4145206763129a1a7fa7426c499cdee80ef2eb601398073fc947d",
    "packages/persistence-postgres/src/transactionSessionActivation.ts": "1a1f8edf3b3c2f7555ace16618aec4ba9a8cf40c9d36866a9bd0be935e3e6e29",
    "packages/persistence-postgres/src/transactionSessionAttemptFacet.ts": "fe723a3f8787f29eaa582cdaaf5b1d48919dbe077c3528c0a13f9ee7f2e01ace",
    "packages/persistence-postgres/src/transactionSessionAttemptKernel.ts": "dde413833778386bc5f2dbd1d8c896f7955a5df9b76e441027a4b2f342ad51ad",
    "packages/persistence-postgres/test/mixedMutationPerformanceTrace.ts": "a633ba98dfcc3c0b786a0b95e269510bc2ca2f54903c1e3812ba89445f522476",
    "packages/executor/src/pointMutationSessionActivation.ts": "15204a4adf943abb1654dbbcb896422c8d7f6d59181060f737ffdaa1973f9f0a",
    "packages/executor/src/pointMutationExecutionClaim.ts": "33b2a384f315cd408969f39f1a436672e5a6dff73669fdd343902ac1ddab82c3",
    "packages/executor/src/pointMutationExecutionClaimLiveness.ts": "42bff75837f518f14982a74fac5c278235de616af781cad044480195875b391c",
    "packages/executor/src/storedAttemptAuthentication/occRerunExecutionOperations.ts": "381c808ddb392f5222bb1480b507ed8ebb9c7c725744cf4e9406c99b5950fa58",
    "packages/executor/src/storedAttemptAuthentication/commitAuthorityVerification.ts": "96b7111a8551470c5d7ed14e7b805921728cebd63957859e18039ea8a4abc19f",
    "packages/executor/src/pointMutationSessionActivationState.ts": "07cc50bd7182313a26797106ea84642f31e002381093171eed3c83bb0e97cb7f",
    "packages/executor/src/pointMutationSessionAttemptState.ts": "a83b49a034ad30b0d0e77a151c92e15758875d07902cc76591d7d3c7ed68ab1b",
    "packages/executor/src/storedAttemptAuthentication/initialPointMutationExecutionOperations.ts": "de05df972aa95d92b65a12c2aade697d88a874065b16e9f4bd421fde91b1c08d",
    "packages/persistence-postgres/src/applicationMutationAdmission.ts": "27e812f8e004153112a6578a2314bb70c59d73c63d62dc0ca82ab8cdb045bc54",
    "packages/persistence-postgres/src/applicationTaskBindings.ts": "1643c08b31324b54a73bedff819e95c387ec6c1c9db0566cbbbf2476782888e4",
    "packages/persistence-postgres/src/applicationTaskBindingEvidence.ts": "008715f3764823378da737ebbac74352eec194e0d1c2f524ad06c0a66427c8c2",
    "packages/persistence-postgres/src/applicationSchemaAuthority.ts": "cea294cf5f0edb682bc397e3cf6970091afddd3bd2e3874ed4c024461a6baaf9",
    "packages/persistence-postgres/src/sessionJournalFiniteEntry.ts": "6064774af7be5799d1c200c6006266f3d8917536df373c4242fe2c9e80e7ea14",
    "packages/persistence-postgres/src/transactionExecutionClaimLiveness.ts": "3f30f1f6f9be0fe20f82f76fa7894c23a515950a314d1485381f469c98de757c",
    "packages/persistence-postgres/src/storedOccExecution.ts": "da01d6e6521c5e4f22cf3cf8b51de962e22ceb423d4e3bfeb0e76bfdba65675e",
    "packages/persistence-postgres/src/storedOccExecution/model.ts": "8b804e250022130c898dc9eded31b6892596071879e0791df1a5f9c1c26be318",
    "packages/persistence-postgres/src/storedOccExecution/postgresLoader.ts": "b7cb3de087158a66bf89d99a2fcf7c84b9959612a1142027022ba4ae148e11d6",
    "packages/persistence-postgres/src/atomicCommerce/participants.ts": "731a18556573f07cfb064cb00d0909b5d46be12087b000170a3d6604d2756a2e",
    "packages/persistence-postgres/src/atomicCommerce/configuration.ts": "3ad4fbdefd80cf972306974702aa5a692e012941b0ebfbc17826ae65e6d76b29",
    "packages/persistence-postgres/src/commerceTransaction/host.ts": "c5662613fcf5e4d871c7cb8401c9af450a07e8d73bb8610b1778202c19f4e0ad",
    "packages/persistence-postgres/src/commerceTransaction/logicalParticipant.ts": "52fde7fc7ec86d997e7227c6c12dae857e77fcc39544ddae19790f9005affbc0",
    "packages/persistence-postgres/src/cmsTransaction/host.ts": "0e0d5ef0289ab0b0c1448d354005a9abf2abc3a45bedbf9a838b1ff4c997c7aa",
    "packages/persistence-postgres/src/logicalDocuments/relationalQuery.ts": "03ad76f6132899e7eff5adb4dd84b1fa3e67d646fb364cc9cda9160a4b3054a4",
    "packages/persistence-postgres/src/logicalDocuments/relationalRows.ts": "78d674f07d7c569180204a956e479dd677fbbf8485682354e31dd385f5285415",
    "packages/persistence-postgres/src/logicalDocuments/relationalValues.ts": "691690c879f0706e1e9193f59f8694f14f736b15993bcaa83c9a43940c4b603a",
    "packages/persistence-postgres/src/logicalStrongReferenceProjection.ts": "ecfed6f068c90286d149c93c21b4341a83e2d81b5441f9df2dba701c992a1571",
    "packages/persistence-postgres/src/indexBuildReconciliation.ts": "cd2ac42516235541761395656dffffd1ea8df1b77e5b6f8f0d0f34cc30032d45",
    "packages/persistence-postgres/src/logicalSchemaAdmission.ts": "b8e51505036a17c35842d62ae01ab1d1d55a372ed236686b316ea2709576ef5e",
    "packages/persistence-postgres/src/logicalStorageDefinitions.ts": "c2a8b51cc472ab19845d270a90e4eb181ff5ef6fdfa164cf2e9335cef144f61c",
    "packages/persistence-postgres/src/logicalDocuments/referencePages.ts": "d3cc976291d56d68b8791ed30580ec1e4df05c13e96dabff95fe5caedc076f23",
    "packages/analysis/src/applicationPublicationFramesV1.ts": "40d1241833029a82d9271c7d86facf63af6c6c1080aa9957270b6814da6cd20a",
    "packages/medusa-adapter/src/product-launch-workflow.ts": "f0c7df917263942b9a9cfbaa5224a40b4d848300949fbe7f29daf2152b8dd97f",
    "packages/flarex-protocol/src/decoded-protocol-snapshot.ts": "732fc10f81c205e2b8efdbfd50a2ec576a98c1fd5bbccf48f5fd5dc6211379eb",
    "packages/flarex-protocol/package.json": "f2858b5eb22cf35b6805144bc0fa99fdbea1e8e67392e1abd656d9438e4e7f2d"
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
| product | warm | 20/20 | 640.7 | 616.4–741.6 | 739.9 | 641.2 | 617.1–742.1 | 740.5 | 88.9 | 0.5 | 519.0 | 519.0 | 248.4 | 248.4 |
| product | cold | 3/3 | 737.3 | 734.7–829.5 | unavailable | 737.9 | 735.2–830.1 | unavailable | 93.2 | 0.5 | 523.0 | 523.0 | 304.7 | 304.7 |
| productPayload | warm | 20/20 | 707.3 | 694.7–766.5 | 741.2 | 707.8 | 695.3–767.0 | 741.8 | 89.3 | 0.6 | 542.0 | 542.0 | 271.8 | 271.8 |
| productPayload | cold | 3/3 | 769.5 | 767.1–1295.4 | unavailable | 770.1 | 767.7–1296.0 | unavailable | 91.7 | 0.6 | 548.0 | 548.0 | 306.2 | 306.2 |
| mixedWorkflow | warm | 20/20 | 1178.2 | 1137.4–1732.8 | 1464.5 | 1179.5 | 1138.7–1734.2 | 1465.5 | 89.3 | 1.1 | 845.0 | 845.0 | 453.7 | 453.7 |
| mixedWorkflow | cold | 3/3 | 1464.8 | 1197.8–1650.2 | unavailable | 1465.6 | 1198.5–1651.0 | unavailable | 102.7 | 0.7 | 849.0 | 849.0 | 593.8 | 593.8 |
| standaloneWorkflow | warm | 20/20 | 321.4 | 302.8–958.8 | 447.1 | 321.9 | 303.3–959.3 | 447.5 | unavailable | 0.4 | 309.0 | 309.0 | 120.9 | 120.9 |
| standaloneWorkflow | cold | 3/3 | 325.0 | 323.8–351.5 | unavailable | 325.3 | 324.1–351.9 | unavailable | unavailable | 0.3 | 309.0 | 309.0 | 115.6 | 115.6 |

## Series construction outside each request

| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product | product-warm-0-0 | 20958.1 | 690.5 | 1792.2 | 34100.5 | unavailable | 57542.1 |
| product | product-cold-0-0 | 13822.6 | 568.8 | 1459.8 | 0.0 | unavailable | 15851.5 |
| product | product-cold-1-0 | 11461.5 | 615.2 | 1503.4 | 0.0 | unavailable | 13580.1 |
| product | product-cold-2-0 | 13655.5 | 549.5 | 1597.9 | 0.0 | unavailable | 15802.9 |
| productPayload | productPayload-warm-0-0 | 13886.1 | 569.1 | 1496.3 | 33206.1 | unavailable | 49157.8 |
| productPayload | productPayload-cold-0-0 | 11393.4 | 573.0 | 1470.1 | 0.0 | unavailable | 13436.6 |
| productPayload | productPayload-cold-1-0 | 11158.9 | 590.4 | 1466.5 | 0.0 | unavailable | 13215.9 |
| productPayload | productPayload-cold-2-0 | 22018.0 | 598.5 | 1646.7 | 0.0 | unavailable | 24263.2 |
| mixedWorkflow | mixedWorkflow-warm-0-0 | 19552.7 | 1537.9 | 1701.4 | 0.0 | unavailable | 22792.1 |
| mixedWorkflow | mixedWorkflow-cold-0-0 | 22928.2 | 1503.0 | 1671.8 | 0.0 | unavailable | 26103.1 |
| mixedWorkflow | mixedWorkflow-cold-1-0 | 15764.7 | 1521.5 | 2268.7 | 0.0 | unavailable | 19554.9 |
| mixedWorkflow | mixedWorkflow-cold-2-0 | 19550.3 | 1591.6 | 1859.5 | 0.0 | unavailable | 23001.4 |
| standaloneWorkflow | standaloneWorkflow-warm-0-0 | 18837.3 | unavailable | unavailable | unavailable | 379.5 | 19217.0 |
| standaloneWorkflow | standaloneWorkflow-cold-0-0 | 17097.5 | unavailable | unavailable | unavailable | 404.9 | 17502.4 |
| standaloneWorkflow | standaloneWorkflow-cold-1-0 | 16314.4 | unavailable | unavailable | unavailable | 378.5 | 16692.9 |
| standaloneWorkflow | standaloneWorkflow-cold-2-0 | 16260.0 | unavailable | unavailable | unavailable | 360.8 | 16620.8 |

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
| standaloneWorkflow | target | invocation / standalone native workflow | commit | 100 | 6956.1 | 1.5–885.3 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | commit | 260 | 6041.5 | 19.0–119.1 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 200 | 4076.6 | 16.6–61.8 |
| product | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 200 | 3989.2 | 16.4–29.8 |
| productPayload | target | invocation / Worker execution / Worker dispatch / medusa.product:update | commit | 200 | 3963.3 | 17.5–34.5 |
| mixedWorkflow | target | invocation / authoritative publication | commit | 20 | 3201.5 | 147.8–205.8 |
| productPayload | target | invocation / authoritative publication | commit | 20 | 1641.6 | 77.1–109.9 |
| mixedWorkflow | target | invocation / request admission | commit | 60 | 1601.6 | 3.8–164.0 |
| product | target | invocation / authoritative publication | commit | 20 | 1472.4 | 66.9–86.2 |
| productPayload | target | invocation / request admission | commit | 60 | 1374.1 | 3.8–57.8 |
| mixedWorkflow | target | invocation / journal seal and OCC verification | commit | 40 | 1363.8 | 4.6–88.6 |
| product | target | invocation / request admission | commit | 60 | 1351.0 | 3.8–60.6 |
| productPayload | target | invocation / journal seal and OCC verification | commit | 40 | 1197.6 | 4.5–66.7 |
| product | target | invocation / journal seal and OCC verification | commit | 40 | 1074.4 | 4.4–56.2 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 20 | 361.0 | 16.3–22.0 |
| productPayload | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | commit | 20 | 356.4 | 16.5–21.7 |
| product | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 203.4 | 3.9–12.7 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 187.2 | 4.1–6.3 |
| productPayload | target | invocation / Worker execution / Worker dispatch / Application point | commit | 40 | 185.7 | 4.1–7.0 |
| mixedWorkflow | target | invocation / Worker execution / Worker dispatch | commit | 20 | 80.3 | 3.2–13.0 |
| product | target | invocation / Worker execution / Worker dispatch | commit | 20 | 78.6 | 3.2–6.4 |
| productPayload | target | invocation / Worker execution / Worker dispatch | commit | 20 | 77.3 | 3.3–7.5 |
| product | control | invocation / request admission | commit | 20 | 37.3 | 1.5–4.8 |
| mixedWorkflow | control | invocation / request admission | commit | 20 | 35.3 | 1.4–4.0 |
| productPayload | control | invocation / request admission | commit | 20 | 31.9 | 1.5–1.9 |
| standaloneWorkflow | control | invocation / standalone native workflow | commit | 20 | 30.5 | 1.3–1.9 |

## Ranked SQL owners in successful warm samples

| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 5300 | 5300 | 0 | 3297.9 |
| standaloneWorkflow | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 3500 | 3500 | 0 | 2259.0 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 4180 | 4180 | 0 | 2234.3 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 4200 | 4200 | 0 | 2221.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 4200 | 4200 | 0 | 2192.0 |
| mixedWorkflow | unattributed | target | invocation / authoritative publication | 2280 | 2280 | 0 | 1400.8 |
| mixedWorkflow | unattributed | target | invocation / request admission | 1420 | 1420 | 0 | 1129.8 |
| productPayload | unattributed | target | invocation / request admission | 1420 | 1420 | 0 | 977.8 |
| product | unattributed | target | invocation / request admission | 1420 | 1420 | 0 | 963.0 |
| productPayload | unattributed | target | invocation / authoritative publication | 1760 | 1760 | 0 | 797.6 |
| mixedWorkflow | unattributed | target | invocation / journal seal and OCC verification | 1200 | 1200 | 0 | 786.1 |
| standaloneWorkflow | ambiguous | target | invocation / standalone native workflow | 2260 | 2260 | 0 | 733.1 |
| product | unattributed | target | invocation / authoritative publication | 1700 | 1700 | 0 | 731.4 |
| productPayload | unattributed | target | invocation / journal seal and OCC verification | 1200 | 1200 | 0 | 728.2 |
| product | unattributed | target | invocation / journal seal and OCC verification | 1200 | 1200 | 0 | 668.7 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 360 | 360 | 0 | 232.9 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 380 | 380 | 0 | 230.8 |
| mixedWorkflow | unattributed | control | invocation / request admission | 520 | 520 | 0 | 178.1 |
| product | unattributed | control | invocation / request admission | 520 | 520 | 0 | 159.7 |
| productPayload | unattributed | control | invocation / request admission | 520 | 520 | 0 | 158.1 |
| mixedWorkflow | unattributed | control | invocation / authoritative publication | 620 | 620 | 0 | 147.4 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 420 | 420 | 0 | 141.5 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 420 | 420 | 0 | 126.3 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch / Application point | 420 | 420 | 0 | 123.8 |
| standaloneWorkflow | unattributed | control | invocation / standalone native workflow | 420 | 420 | 0 | 115.9 |
| productPayload | unattributed | control | invocation / authoritative publication | 380 | 380 | 0 | 91.3 |
| productPayload | unattributed | target | invocation / Worker execution / Worker dispatch | 240 | 240 | 0 | 81.9 |
| product | unattributed | control | invocation / authoritative publication | 340 | 340 | 0 | 81.7 |
| product | unattributed | target | invocation / Worker execution / Worker dispatch | 240 | 240 | 0 | 81.1 |
| mixedWorkflow | unattributed | target | invocation / Worker execution / Worker dispatch | 240 | 240 | 0 | 80.6 |
| mixedWorkflow | unattributed | control | invocation / journal seal and OCC verification | 180 | 180 | 0 | 64.1 |
| productPayload | unattributed | control | invocation / journal seal and OCC verification | 180 | 180 | 0 | 59.1 |
| product | unattributed | control | invocation / journal seal and OCC verification | 180 | 180 | 0 | 53.1 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 22.1 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 21.5 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch / Application point | 80 | 80 | 0 | 21.3 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1568:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 15.4 |
| mixedWorkflow | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 13.3 |
| productPayload | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 13.0 |
| product | unattributed | control | invocation / Worker execution / Worker dispatch | 40 | 40 | 0 | 12.6 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1568:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 9.2 |
| product | at .packages/persistence-postgres/src/appRows.ts:1568:22 | target | invocation / authoritative publication | 20 | 20 | 0 | 8.4 |
| mixedWorkflow | at .packages/persistence-postgres/src/appRows.ts:1597:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 8.1 |
| productPayload | at .packages/persistence-postgres/src/appRows.ts:1597:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 4.7 |
| product | at .packages/persistence-postgres/src/appRows.ts:1597:23 | target | invocation / authoritative publication | 20 | 20 | 0 | 4.5 |

## Ranked SQL fingerprints in successful warm samples

| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| product | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 566.1 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 360.8 | commit |
| product | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 100 | 100 | 0 | 268.5 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| product | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 175.8 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| product | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 107.5 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 60 | 60 | 0 | 106.0 | commit |
| product | `c4f8c65b9a024baeef487999a2cfefd3fda5e67578ea9269fe6f208b7baedfa9` | unattributed | target | invocation / authoritative publication | 20 | 20 | 0 | 101.8 | select * from ( select $? : : integer as "ordinal" , member . * from ( values ( ? ) ) as request ( present ) left join l |
| product | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 91.9 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| product | `f866e89306489d86008bf5831891b716054c270deb4bbfd87354f4118e34193e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 86.9 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| product | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / journal seal and OCC verification | 40 | 40 | 0 | 84.7 | commit |
| product | `30769bbd2072761e6a4751d262b3fad7947a08d4571f1586f9779799ab67283f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 76.5 | with latest as ( select distinct on ( revision . encoded_key , revision . row_id ) revision . table_id , revision . key_ |
| product | `03a7d63c7b07612a7e973b680663f82dd129bb169e49613d6292763933cc25ae` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 74.7 | select "table_id" , "logical_index_id" , "source_sha256" , "lifecycle" , "covered_through_commit_seq" from "fx_system_se |
| productPayload | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 591.5 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 322.2 | commit |
| productPayload | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 100 | 100 | 0 | 286.8 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| productPayload | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 179.4 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| productPayload | `c4f8c65b9a024baeef487999a2cfefd3fda5e67578ea9269fe6f208b7baedfa9` | unattributed | target | invocation / authoritative publication | 20 | 20 | 0 | 108.9 | select * from ( select $? : : integer as "ordinal" , member . * from ( values ( ? ) ) as request ( present ) left join l |
| productPayload | `501d7c0c14554a8a983f7802e4febb6c109206d2f9cf6eb98e12a19b15b7fdcf` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 108.7 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| productPayload | `eecb12d5779b90b0586aa70abb581ce1d7c990108824286e302fe6a6ae0340da` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 95.9 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 60 | 60 | 0 | 89.0 | commit |
| productPayload | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / journal seal and OCC verification | 40 | 40 | 0 | 84.8 | commit |
| productPayload | `f866e89306489d86008bf5831891b716054c270deb4bbfd87354f4118e34193e` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 81.3 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| productPayload | `30769bbd2072761e6a4751d262b3fad7947a08d4571f1586f9779799ab67283f` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 76.0 | with latest as ( select distinct on ( revision . encoded_key , revision . row_id ) revision . table_id , revision . key_ |
| productPayload | `fea27384148e86304070a70ff56d9b3091f37f3ba52bf39704f9cd37044018e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 68.7 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 730.4 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 589.0 | commit |
| mixedWorkflow | `5b0159d9ac46c9cfa8b8f26dc7f312fbcb1ae69c8fa18634ae122faa5c94e012` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 550.6 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 398.3 | commit |
| mixedWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 361.8 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| mixedWorkflow | `d0647e9453b7bfff0388f366a2901132f26e2f82a24757de5bb6ce1f90184a70` | unattributed | target | invocation / request admission | 100 | 100 | 0 | 304.2 | select epoch . database_name , epoch . namespace_oid : : text , epoch . incarnation : : text , epoch . generation : : te |
| mixedWorkflow | `cee4f47101805ddfb136e3188b3df8fffc406750d74e79e86009acf9769284b9` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 180.5 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |
| mixedWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | unattributed | target | invocation / request admission | 60 | 60 | 0 | 177.7 | commit |
| mixedWorkflow | `46a8191727cc5d3eb2a06740293165000188d5b73ed96e745e79dd5393112e7a` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 200 | 200 | 0 | 170.1 | select true , exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog |
| mixedWorkflow | `f23e4a40858f630ac0a88d3447e83558dcdd166cf2adbb1d7e966b60dbcffd18` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 153.0 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `fea27384148e86304070a70ff56d9b3091f37f3ba52bf39704f9cd37044018e7` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.product:update | 400 | 400 | 0 | 144.2 | with requested ( ordinal , table_id ) as ( values ( $? : : integer , $? : : integer ) , ( $? : : integer , $? : : intege |
| mixedWorkflow | `23ecae9c52871046872fa24bf0ff7b63adffcfd671f0b9e1db804135609f18ab` | unattributed | target | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 260 | 260 | 0 | 138.3 | select "scope_id" , "unique_constraint_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "s |
| standaloneWorkflow | `41a41574b3c5fa07b54489437a86b27de98a8c20aa81f5aca5d09f68258de88e` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 480 | 480 | 0 | 924.9 | select "fx_app_unique_key" . "scope_uuid" , "fx_app_unique_key" . "constraint_id" , "fx_app_unique_key" . "locale_key" , |
| standaloneWorkflow | `d5d4c37a51112b9b780714cac487ef18f57a64df4c2eb2db53d9e73eefd1b9d7` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 360 | 360 | 0 | 194.3 | with page as materialized ( select current_entry . scope_uuid , current_entry . index_definition_id , current_entry . en |
| standaloneWorkflow | `9505cacb7c710ed17125fcc6cb3669e8ddca6c8cd8af6a31f6b3cd64604c3098` | ambiguous | target | invocation / standalone native workflow | 100 | 100 | 0 | 188.3 | commit |
| standaloneWorkflow | `e1ec737c78a9b1b03a62d1ccd2821031bc836ec0c4a8a012108090b5f7723d71` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 60 | 60 | 0 | 92.0 | select exists ( select ? from pg_catalog . pg_index physical_index where physical_index . indexrelid = pg_catalog . to_r |
| standaloneWorkflow | `7d540322aeaa3da38f1f20bf18524c20bb6a9bdb627c493cef9ce9828024784d` | ambiguous | target | invocation / standalone native workflow | 100 | 100 | 0 | 63.5 | select "fx_system_application_candidate_v1" . "scope_id" , "fx_system_application_candidate_v1" . "candidate_id" , "fx_s |
| standaloneWorkflow | `c4320ce831a6f4991aa3750a5ce0e339bb0b0577c12bd0760c052a9ce9b9137e` | ambiguous | target | invocation / standalone native workflow | 200 | 200 | 0 | 59.8 | select "scope_id" , "revision_id" , "deployment_id" , "candidate_id" , "analysis_id" , "source_artifact_root_sha256" , " |
| standaloneWorkflow | `d3c76201bb4a138e5f74aa633b5db20ef3ba7efd9571c52ed250e6037ada0f3e` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 60 | 60 | 0 | 52.8 | with "capture_clock" as ( select "last_commit_seq" , "epoch" from "fx_system_scope_clock" where "fx_system_scope_clock"  |
| standaloneWorkflow | `fd177173e0d5d85a7b9c476ade433ca8f7fd506b8921fb0f28eeb2c8c83897cb` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 180 | 180 | 0 | 51.9 | select "scope_uuid" from "fx_system_scope_clock" where "fx_system_scope_clock" . "scope_id" = $? limit $? |
| standaloneWorkflow | `e7cc2b08e0c7fc6727e921fb03dd18e7aa9cb97e3d6cf9e13b6ad212ac8eeb45` | ambiguous | target | invocation / standalone native workflow | 200 | 200 | 0 | 46.0 | select "scope_id" , "scope_uuid" , "storage_generation" , "storage_generation_fence" , "last_commit_seq" , "oldest_avail |
| standaloneWorkflow | `2ba209045b4f742981492c369d96095aab2ad88a09de3066cec5369b40f89b2f` | ambiguous | target | invocation / standalone native workflow | 200 | 200 | 0 | 45.8 | select "scope_id" , "activation_sequence" , "revision_id" , "readiness_contract_version" , "readiness_sha256" , "relatio |
| standaloneWorkflow | `10f5420f43a2779ac8d3df351b269337d4e9954eacea417a3af8df776034e2d8` | ambiguous | target | invocation / standalone native workflow | 180 | 180 | 0 | 43.7 | select "scope_id" , "activation_sequence" , "previous_activation_sequence" , "revision_id" , "readiness_contract_version |
| standaloneWorkflow | `95f7bea972ff4c054c1da49dc8eaadeacc861aab2e0bfa408d81f5dc6e2b2d02` | at Proxy.trackedQuery (.packages/persistence-postgres/src/physicalSession/postgres.ts:1041:39) | target | invocation / standalone native workflow | 60 | 60 | 0 | 40.4 | select "scope_id" , "index_definition_id" , "storage_generation" , "storage_generation_fence" , "epoch" , "start_commit_ |

## Phase spans in successful warm samples

| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |
| --- | --- | ---: | ---: |
| product | invocation | 640.7 | 0.7 |
| product | invocation / Worker execution | 372.0 | 0.8 |
| product | invocation / Worker execution / Worker construction and ready | 88.9 | 88.9 |
| product | invocation / Worker execution / Worker dispatch | 268.4 | 24.3 |
| product | invocation / Worker execution / Worker dispatch / Application point | 6.4 | 6.4 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 5.6 | 5.6 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 6.0 | 6.0 |
| product | invocation / Worker execution / Worker dispatch / medusa.product:update | 216.8 | 216.8 |
| product | invocation / Worker execution / Worker disposal | 13.4 | 13.4 |
| product | invocation / authoritative publication | 88.9 | 88.9 |
| product | invocation / journal seal and OCC verification | 82.0 | 82.0 |
| product | invocation / request admission | 95.0 | 95.0 |
| productPayload | invocation | 707.3 | 0.7 |
| productPayload | invocation / Worker execution | 414.0 | 0.9 |
| productPayload | invocation / Worker execution / Worker construction and ready | 89.3 | 89.3 |
| productPayload | invocation / Worker execution / Worker dispatch | 308.1 | 29.2 |
| productPayload | invocation / Worker execution / Worker dispatch / Application point | 6.3 | 6.3 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:listByHandle | 5.7 | 5.7 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 5.9 | 5.9 |
| productPayload | invocation / Worker execution / Worker dispatch / medusa.product:update | 222.7 | 222.7 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 24.5 | 24.5 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 2.2 | 2.2 |
| productPayload | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 3.3 | 3.3 |
| productPayload | invocation / Worker execution / Worker disposal | 13.4 | 13.4 |
| productPayload | invocation / authoritative publication | 99.5 | 99.5 |
| productPayload | invocation / journal seal and OCC verification | 96.1 | 96.1 |
| productPayload | invocation / request admission | 98.7 | 98.7 |
| mixedWorkflow | invocation | 1178.2 | 0.7 |
| mixedWorkflow | invocation / Worker execution | 771.1 | 0.9 |
| mixedWorkflow | invocation / Worker execution / Worker construction and ready | 89.3 | 89.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch | 664.9 | 29.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / Application point | 6.6 | 6.6 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:retrieve | 6.2 | 6.2 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.product:update | 218.9 | 218.9 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / medusa.workflow:run | 366.8 | 366.8 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-create | 26.2 | 26.2 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-findByID | 2.3 | 2.3 |
| mixedWorkflow | invocation / Worker execution / Worker dispatch / payload.posts.0b4edceefb42629ee482a9c2b07fac8215b5259781761b11d0d2370e56ab1d3b:payload-update | 3.3 | 3.3 |
| mixedWorkflow | invocation / Worker execution / Worker disposal | 13.7 | 13.7 |
| mixedWorkflow | invocation / authoritative publication | 182.5 | 182.5 |
| mixedWorkflow | invocation / journal seal and OCC verification | 118.1 | 118.1 |
| mixedWorkflow | invocation / request admission | 101.4 | 101.4 |
| standaloneWorkflow | invocation | 321.4 | 0.0 |
| standaloneWorkflow | invocation / standalone native workflow | 321.4 | 321.4 |

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
