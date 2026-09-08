import { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CmsCommand, CmsCommandContext } from "./host";
import type { CmsRequestLifetime } from "./lifetime";
import type { CmsRequestContext, CmsTransactionError } from "./model";

/** Request-owned adapter view; only the physical owner holds seal/close authority. */
export function makeCmsCommandContext(
  lifetime: CmsRequestLifetime, transactionId: string, context: CmsRequestContext,
  ports: Pick<CmsCommandContext, "documents" | "relations" | "preferences">, standaloneRead: boolean,
  invoke: (context: CmsRequestContext, child: CmsCommand, args: Json) => Effect.Effect<Json, CmsTransactionError>,
): CmsCommandContext {
  return Object.freeze({ context, standaloneRead, transactionId, ...ports,
    reserveOutput: bytes => lifetime.operation(context, transactionId, "read", Effect.suspend(() => Effect.fromResult(lifetime.charge(bytes)))),
    begin: id => lifetime.begin(context, id), commit: id => lifetime.adapterCommit(context, id), rollback: id => lifetime.rollback(context, id),
    nested: (child, args) => lifetime.nested(context, transactionId, nested => invoke(nested, child, args)),
  } satisfies CmsCommandContext);
}
