import { Effect } from "effect";
import { cmsError } from "./model";
import type { Json } from "flarex-protocol/json";
import type { CmsDocuments } from "./documents";
import type { CmsRelations } from "./relations";
import type { PayloadPreferenceCleanup } from "../payloadPreferences/cleanup";
import type { CmsRequestContext, CmsPresentedTransactionId, CmsTransactionError } from "./model";

declare const commandBrand: unique symbol;
export interface CmsCommand { readonly [commandBrand]: true }
export interface CmsCommandContext {
  /** Available only on a genuine protected reverse-page borrow. */
  readonly privateReferencePage?: (input: Readonly<{ limit: number; cursor?: string }>) => Effect.Effect<
    Readonly<{ ids: readonly import("flarex-protocol/app-document-id").AppDocumentIdV1[]; lookahead: import("flarex-protocol/app-document-id").AppDocumentIdV1 | null; hasMore: boolean; cursor: string | null }>, CmsTransactionError>;
  readonly context: CmsRequestContext;
  readonly standaloneRead: boolean;
  readonly populationRead: boolean;
  readonly reserveOutput: (bytes: number) => Effect.Effect<void, CmsTransactionError>;
  readonly transactionId: string;
  readonly documents: CmsDocuments;
  readonly relations: CmsRelations;
  readonly preferences: PayloadPreferenceCleanup;
  readonly begin: (id?: CmsPresentedTransactionId) => Effect.Effect<string, CmsTransactionError>;
  readonly commit: (id: CmsPresentedTransactionId) => Effect.Effect<never, CmsTransactionError>;
  readonly rollback: (id: CmsPresentedTransactionId) => Effect.Effect<never, CmsTransactionError>;
  readonly nested: (command: CmsCommand, args: Json) => Effect.Effect<Json, CmsTransactionError>;
}
interface CommandDefinition {
  readonly name: string;
  readonly mode: "read" | "write";
  readonly run: (context: CmsCommandContext, args: Json) => Effect.Effect<Json, CmsTransactionError>;
}
const commands = new WeakMap<object, CommandDefinition>();
/** Source-private lookup for the trusted composite host; no root transaction is started. */
export const getCmsCommand = (command: CmsCommand): CommandDefinition | undefined => commands.get(command);
/** Trusted read composition shares this exact borrowed request and working set. */
export const runCmsReadCommand = Effect.fn("CmsCommand.runRead")(function* (command: CmsCommand, context: CmsCommandContext, args: Json) {
  const definition = commands.get(command);
  if (definition?.mode !== "read") return yield* Effect.fail(cmsError("invalidAuthority"));
  yield* context.reserveOutput(0);
  return yield* definition.run(context, args);
});
/** Trusted composition only: no runtime registration and no arbitrary framework hooks. */
export const defineCmsCommand = (definition: CommandDefinition): CmsCommand => {
  // SAFETY: this inert token is authenticated by the private definition registry.
  const token = Object.freeze({}) as CmsCommand;
  commands.set(token, Object.freeze({ ...definition }));
  return token;
};
