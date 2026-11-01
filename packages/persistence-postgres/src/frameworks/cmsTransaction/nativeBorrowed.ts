import { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CoreNativeOperations } from "../../core/api";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { getCmsCommand, type CmsCommand, type CmsCommandContext } from "./commands";
import { makeCmsCommandContext } from "./context";
import type { CmsRequestLifetime } from "./lifetime";
import { cmsError } from "./model";
import { makeNativeCmsDocuments, type NativeCmsWriteAuthorization } from "./nativeDocuments";
import { makeNativeCmsRelations } from "./nativeRelations";

/** Confined native child of an existing translated root. It owns no request
 * claim, snapshot, finalizer, retry, SQL transaction or publication lifetime. */
export function makeBorrowedNativeCmsInvocation(input: Readonly<{
  operations: CoreNativeOperations; lifetime: CmsRequestLifetime; transactionId: string;
  commands: readonly CmsCommand[]; authorize?: NativeCmsWriteAuthorization;
  privateReferencePage?: CmsCommandContext["privateReferencePage"];
}>) {
  const { lifetime, transactionId } = input;
  const allowed = new Set(input.commands);
  const documents = makeNativeCmsDocuments(input.operations, lifetime, input.authorize);
  const invoke = Effect.fn("NativeCmsBorrow.invoke")(function* (command: CmsCommand, args: Json) {
    const definition = getCmsCommand(command);
    if (!allowed.has(command) || definition === undefined) return yield* cmsError("invalidAuthority");
    const captured = yield* Effect.fromResult(capturePrivateJsonData(args, lifetime.remainingBytes(), cmsError));
    yield* lifetime.fromResult(lifetime.charge(captured.bytes));
    return yield* lifetime.nested(lifetime.context, transactionId, context => Effect.gen(function* () {
      const referencePage = input.privateReferencePage;
      const execution = makeCmsCommandContext(lifetime, transactionId, context, {
        documents, relations: makeNativeCmsRelations(input.operations, lifetime, new Map(), false),
        preferences: { deleteForPendingDocument: () => Effect.fail(cmsError("unsupportedProfile")) },
        ...(referencePage === undefined ? {} : { privateReferencePage: (page: Parameters<NonNullable<CmsCommandContext["privateReferencePage"]>>[0]) =>
          lifetime.operation(context, transactionId, "read", referencePage(page)) }),
      }, false, () => Effect.fail(cmsError("invalidAuthority")), false);
      const result = yield* definition.run(execution, captured.value);
      yield* lifetime.checkpoint(context);
      const output = yield* Effect.fromResult(capturePrivateJsonData(result, lifetime.remainingBytes(), cmsError));
      yield* lifetime.fromResult(lifetime.charge(output.bytes));
      return output.value;
    }), definition.mode);
  });
  return Object.freeze({ invoke });
}
