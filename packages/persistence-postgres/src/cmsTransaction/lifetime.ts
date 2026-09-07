import { Effect } from "effect";
import { makeBoundedRequestLifetime, type BoundedRequestLifetime } from "../boundedRequestLifetime";
import { cmsError, cmsLimits, type CmsTransactionError, type CmsHostIdentity, type CmsRequestIdentity } from "./model";

export type CmsRequestLifetime = BoundedRequestLifetime<CmsTransactionError>;
export const makeCmsRequestLifetime = Effect.fn("CmsRequest.makeLifetime")((
  owner: CmsHostIdentity, requestIdentity: CmsRequestIdentity, id: string, mode: "read" | "write",
) => makeBoundedRequestLifetime(cmsError, cmsLimits, owner, requestIdentity, id, mode));
