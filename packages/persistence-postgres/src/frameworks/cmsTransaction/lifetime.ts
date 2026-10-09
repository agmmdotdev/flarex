import { Effect } from "effect";
import { makeBoundedRequestLifetime, type BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { cmsError, cmsLimits, type CmsTransactionError, type CmsHostIdentity, type CmsRequestIdentity } from "./model";
import { defaultCmsRequestBudget, type CmsRequestBudget } from "../../execution/preparation/frameworkExecutionPolicy";

export type CmsRequestLifetime = BoundedRequestLifetime<CmsTransactionError>;
export const makeCmsRequestLifetime = Effect.fn("CmsRequest.makeLifetime")((
  owner: CmsHostIdentity, requestIdentity: CmsRequestIdentity, id: string, mode: "read" | "write",
  budget: CmsRequestBudget = defaultCmsRequestBudget,
) => makeBoundedRequestLifetime(cmsError, { ...budget, commandMs: cmsLimits.commandMs }, owner, requestIdentity, id, mode));
