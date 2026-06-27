import { HttpError } from "../http";
import type { RegistrySqlError } from "./Store";

export type RegistryServiceFailure = RegistrySqlError;

export function registryFailureToHttpError(_error: RegistryServiceFailure): HttpError {
  return new HttpError(500, "Registry storage error.");
}
