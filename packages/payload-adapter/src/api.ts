import type { Effect } from "effect";
import type { CmsRequestBudget, CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import type { PayloadCreateArgs, PayloadUpdateArgs, PayloadDeleteArgs, PayloadFindArgs,
  PayloadFindByIdArgs, PayloadCountArgs } from "./inputs";
import type { PayloadDocument, PayloadPageResult, PayloadCountResult } from "./results";

/** Admitted private Local API operations bound to one native instance and source. */
export interface PayloadReadHost {
  readonly requestBudget: CmsRequestBudget;
  readonly close: Effect.Effect<void>;
  readonly find: (args: PayloadFindArgs) => Effect.Effect<PayloadPageResult, CmsTransactionError>;
  readonly findByID: (args: PayloadFindByIdArgs) => Effect.Effect<PayloadDocument, CmsTransactionError>;
  readonly count: (args: PayloadCountArgs) => Effect.Effect<PayloadCountResult, CmsTransactionError>;
}
export interface PayloadHost extends PayloadReadHost {
  readonly newRequestKey: () => string;
  readonly create: (requestKey: string, args: PayloadCreateArgs) => Effect.Effect<PayloadDocument, CmsTransactionError>;
  readonly update: (requestKey: string, args: PayloadUpdateArgs) => Effect.Effect<PayloadDocument, CmsTransactionError>;
  readonly delete: (requestKey: string, args: PayloadDeleteArgs) => Effect.Effect<PayloadDocument, CmsTransactionError>;
}
export type { PayloadCreateArgs, PayloadUpdateArgs, PayloadDeleteArgs, PayloadFindArgs,
  PayloadFindByIdArgs, PayloadCountArgs } from "./inputs";
export type { PayloadDocument, PayloadPageResult, PayloadCountResult } from "./results";
