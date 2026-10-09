import type { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CmsDocuments } from "./documents";
import type { CmsRelations } from "./relations";
import type { PayloadPreferenceCleanup } from "../payloadPreferences/cleanup";
import type { CmsRequestContext, CmsPresentedTransactionId, CmsTransactionError } from "./model";

declare const commandBrand: unique symbol;
export interface CmsCommand { readonly [commandBrand]: true }
export interface CmsCommandContext {
  readonly context: CmsRequestContext;
  readonly standaloneRead: boolean;
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
/** Trusted composition only: no runtime registration and no arbitrary framework hooks. */
export const defineCmsCommand = (definition: CommandDefinition): CmsCommand => {
  // SAFETY: this inert token is authenticated by the private definition registry.
  const token = Object.freeze({}) as CmsCommand;
  commands.set(token, Object.freeze({ ...definition }));
  return token;
};
