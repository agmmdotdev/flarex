import {
  produceStandardApplicationSource,
  type StandardApplicationSource,
  type StandardApplicationSourceError,
} from "@flarex/standard-application-definition/application-source";
import { type Result } from "effect";

import {
  inspectPreparedApplication,
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
  return produceStandardApplicationSource(
    inspectPreparedApplication(prepared),
  );
}
