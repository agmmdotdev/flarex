import {
  hasAppDeveloperIndexDefinitionAuthorityForControlDbV1,
} from "../../storage/indexes/appDeveloperIndexCommitV1";
import type { AppDeveloperIndexDefinitionPortV1 } from "../../storage/indexes/appDeveloperIndexCommitV1";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";

const appDeveloperIndexQueryPortBrand: unique symbol = Symbol(
  "FlarexDB/AppDeveloperIndexQueryPortV1",
);

export interface AppDeveloperIndexQueryPortV1 {
  readonly [appDeveloperIndexQueryPortBrand]: true;
}

interface AppDeveloperIndexQueryPortStateV1 {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: PointMutationSessionAuthorityResolutionPortsV1;
  readonly definitions: AppDeveloperIndexDefinitionPortV1;
}

const appDeveloperIndexQueryPortStatesV1 = new WeakMap<
  AppDeveloperIndexQueryPortV1,
  AppDeveloperIndexQueryPortStateV1
>();

export function createAppDeveloperIndexQueryPortV1(
  controlDb: FlarexMetadataDatabase,
  authority: PointMutationSessionAuthorityResolutionPortsV1,
  definitions: AppDeveloperIndexDefinitionPortV1,
): AppDeveloperIndexQueryPortV1 {
  const port = Object.freeze({
    [appDeveloperIndexQueryPortBrand]: true as const,
  });
  if (hasAppDeveloperIndexDefinitionAuthorityForControlDbV1(
    definitions,
    controlDb,
  )) {
    appDeveloperIndexQueryPortStatesV1.set(port, Object.freeze({
      controlDb,
      authority,
      definitions,
    }));
  }
  return port;
}

/** Borrow only a port issued by this process-local composition owner. */
export function inspectAppDeveloperIndexQueryPortV1(port: AppDeveloperIndexQueryPortV1): AppDeveloperIndexQueryPortStateV1 | undefined {
  return appDeveloperIndexQueryPortStatesV1.get(port);
}
