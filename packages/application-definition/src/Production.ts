import {
  produceStandardApplicationSource,
  type StandardApplicationSource,
  type StandardApplicationSourceError,
} from "@flarex/standard-application-definition/application-source";
import {
  producePreparedInternalStandardApplicationSourceWithRelations,
} from "@flarex/standard-application-definition/internal/relation-definition";
import { type Result } from "effect";

import {
  inspectPreparedApplication,
  inspectPreparedApplicationRelations,
  type PreparedApplication,
} from "./Preparation.js";

export type ApplicationSource = StandardApplicationSource;
export type ApplicationSourceError = StandardApplicationSourceError;

/**
 * Produces the inert source input consumed by Application Analysis while
 * keeping canonical preparation details behind the clean definition facade.
 */
export function produceApplicationSource(
  prepared: PreparedApplication,
): Result.Result<ApplicationSource, ApplicationSourceError> {
  const relations = inspectPreparedApplicationRelations(prepared);
  return relations.declarations.length === 0
    ? produceStandardApplicationSource(inspectPreparedApplication(prepared))
    : producePreparedInternalStandardApplicationSourceWithRelations(
        inspectPreparedApplication(prepared),
        relations,
      );
}
