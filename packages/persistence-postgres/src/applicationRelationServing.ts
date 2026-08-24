import { Data, Effect } from "effect";

import type { CatalogEdgeDefinitionId } from "flarex-protocol/catalog";
import type { ScopeId } from "flarex-protocol/storage-authority";

import {
  type ApplicationActiveHeadStateError,
  readApplicationActiveHeadForShareInTransactionEffect,
} from "./applicationActiveHeadRead";
import type { AppRowTransaction } from "./appRows";

const applicationRelationServingInspectorBrand: unique symbol = Symbol(
  "Flarex/ApplicationRelationServingInspector",
);

/** Private nominal capability. RA01 owns the future relation-aware branch. */
export interface ApplicationRelationServingInspector {
  readonly [applicationRelationServingInspectorBrand]: true;
}

const applicationRelationServingInspectorStates = new WeakMap<object, true>();

export type ApplicationRelationServingInspection =
  | Readonly<{
      readonly status: "not_serving";
      readonly reason: "no_active_application";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
    }>
  | Readonly<{
      readonly status: "not_serving";
      readonly reason: "active_readiness_v1";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      readonly activeRevisionId: string;
    }>
  | Readonly<{
      readonly status: "serving";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      readonly activeRevisionId: string;
    }>;

export class ApplicationRelationServingInspectorUnavailableError
  extends Data.TaggedError(
    "ApplicationRelationServingInspectorUnavailableError",
  )<{
    readonly reason: "compositionMissing";
  }> {}

export type InspectApplicationRelationServingError =
  | ApplicationRelationServingInspectorUnavailableError
  | ApplicationActiveHeadStateError;

export function createApplicationRelationServingInspector():
  ApplicationRelationServingInspector {
  const inspector: ApplicationRelationServingInspector = Object.freeze({
    [applicationRelationServingInspectorBrand]: true as const,
  });
  applicationRelationServingInspectorStates.set(inspector, true);
  return inspector;
}

export function hasApplicationRelationServingInspectorAuthority(
  value: unknown,
): value is ApplicationRelationServingInspector {
  return typeof value === "object" && value !== null &&
    applicationRelationServingInspectorStates.has(value);
}

/**
 * Runs under E01-A's caller-owned transaction after its scope-clock UPDATE
 * lock. The current active selector can only name retained V1 readiness, so
 * no relation definition can honestly be classified as serving yet.
 */
export const inspectApplicationRelationServingDefinitionInTransactionEffect =
  Effect.fn("ApplicationRelationServing.inspectDefinitionInTransaction")(
    function* (
      inspector: ApplicationRelationServingInspector,
      tx: AppRowTransaction,
      input: Readonly<{
        readonly scopeId: ScopeId;
        readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      }>,
    ): Effect.fn.Return<
      ApplicationRelationServingInspection,
      InspectApplicationRelationServingError
    > {
      if (!applicationRelationServingInspectorStates.has(inspector)) {
        return yield* Effect.fail(
          new ApplicationRelationServingInspectorUnavailableError({
            reason: "compositionMissing",
          }),
        );
      }
      const activeHead = yield*
        readApplicationActiveHeadForShareInTransactionEffect(
          tx,
          input.scopeId,
        );
      return activeHead === null
        ? Object.freeze({
          status: "not_serving",
          reason: "no_active_application",
          edgeDefinitionId: input.edgeDefinitionId,
        })
        : Object.freeze({
          status: "not_serving",
          reason: "active_readiness_v1",
          edgeDefinitionId: input.edgeDefinitionId,
          activeRevisionId: activeHead.revisionId,
        });
    },
  );
