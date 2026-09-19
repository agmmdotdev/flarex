import { createAppDeveloperIndexDefinitionPortV1, type AppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createIntrinsicCreationTimeIndexDefinitionPortV1, type IntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { ApplicationDocumentMaterializationOptions } from "../src/applicationDocumentMaterialization/model";

/** Composition attacks only; no alternate locator or maintenance implementation. */
export function orderedIndexCompositionRefusals(
  intrinsic: IntrinsicCreationTimeIndexDefinitionPortV1,
  developer: AppDeveloperIndexDefinitionPortV1,
  foreignControlDb: FlarexMetadataDatabase,
): readonly Pick<ApplicationDocumentMaterializationOptions, "intrinsicCreationTimeIndexes" | "developerIndexes">[] {
  return [
    {},
    { intrinsicCreationTimeIndexes: intrinsic },
    { developerIndexes: developer },
    { intrinsicCreationTimeIndexes: { ...intrinsic }, developerIndexes: developer },
    { intrinsicCreationTimeIndexes: intrinsic, developerIndexes: { ...developer } },
    { intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(foreignControlDb), developerIndexes: developer },
    { intrinsicCreationTimeIndexes: intrinsic, developerIndexes: createAppDeveloperIndexDefinitionPortV1(foreignControlDb) },
  ];
}
