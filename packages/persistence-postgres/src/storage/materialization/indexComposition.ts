import { hasAppDeveloperIndexDefinitionAuthorityForControlDbV1 } from "../indexes/appDeveloperIndexCommitV1";
import { hasIntrinsicCreationTimeIndexDefinitionAuthorityForControlDbV1 } from "../indexes/intrinsicCreationTimeIndexBuildV1";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { ApplicationDocumentMaterializationOptions } from "./model";

/** Static dependency provenance; request and transaction authority stay fresh. */
export function hasApplicationDocumentOrderedIndexComposition(
  controlDb: FlarexMetadataDatabase | undefined,
  options: ApplicationDocumentMaterializationOptions,
): boolean {
  return controlDb !== undefined &&
    hasIntrinsicCreationTimeIndexDefinitionAuthorityForControlDbV1(options.intrinsicCreationTimeIndexes, controlDb) &&
    hasAppDeveloperIndexDefinitionAuthorityForControlDbV1(options.developerIndexes, controlDb);
}
