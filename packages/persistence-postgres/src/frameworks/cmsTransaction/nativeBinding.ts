import { Effect, Scope } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CoreDatabase, CoreNativeBinding } from "../../core/api";
import { decodeCmsRequestBudget, defaultCmsRequestBudget, type CmsRequestBudget } from "../../execution/preparation/frameworkExecutionPolicy";
import type { PreparedHostRuntime } from "../../execution/preparation/preparedHostRuntime";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import type { CmsCommand } from "./commands";
import type { CmsContentIdentity } from "./construction";
import type { CmsHost } from "./host";
import type { CmsReadHost } from "./read/host";
import { cmsError, cmsLimits, type CmsTransactionError } from "./model";
import { makeCmsNativeHost } from "./nativeHost";
import { projectCoreCmsFailure } from "./nativeFailure";
import { requirePayloadPreferenceNativeCleanup, type PayloadPreferenceNativeCleanup } from "../payloadPreferences/nativeCleanup";

export { makePayloadPreferenceNativeCleanup, type PayloadPreferenceNativeCleanup } from "../payloadPreferences/nativeCleanup";
export { makePayloadPreferenceNativeDefinition } from "../payloadPreferences/nativeSource";
export { prepareNativeReferenceSaveAccess } from "./nativeReferenceAccess";
export { prepareNativeReferencePagesAccess } from "./nativeReferencePages";

declare const bindingBrand: unique symbol;
/** Trusted construction supplies dependencies; framework callbacks receive none. */
export interface CmsNativeBinding { readonly [bindingBrand]: true }
export interface CmsNativeBindingInput {
  readonly database: CoreDatabase;
  readonly binding: CoreNativeBinding;
  readonly hostRuntime: PreparedHostRuntime;
  readonly identityAndAccessPolicy: Json;
  readonly requestBudget?: CmsRequestBudget;
  readonly preferences?: PayloadPreferenceNativeCleanup;
}
interface BindingState {
  readonly input: CmsNativeBindingInput & Readonly<{ requestBudget: CmsRequestBudget }>;
  readonly scope: Scope.Scope;
  readonly requireOpen: Effect.Effect<void, CmsTransactionError>;
}
const bindings = new WeakMap<object, BindingState>();

export const makeCmsNativeBinding = Effect.fn("CmsNativeBinding.make")(function* (input: CmsNativeBindingInput) {
  const { database, binding: nativeBinding, hostRuntime } = input;
  const preferences = input.preferences;
  const policy = yield* Effect.fromResult(capturePrivateJsonData(input.identityAndAccessPolicy, cmsLimits.documentBytes, cmsError));
  const budget = yield* Effect.fromResult(decodeCmsRequestBudget(input.requestBudget ?? defaultCmsRequestBudget)).pipe(
    Effect.mapError(cause => cmsError("unsupportedProfile", cause)));
  yield* database.readNativeBinding(nativeBinding).pipe(Effect.mapError(projectCoreCmsFailure));
  if (preferences !== undefined) yield* requirePayloadPreferenceNativeCleanup(preferences, database, nativeBinding);
  const scope = yield* Effect.scope;
  let open = true;
  yield* Scope.addFinalizer(scope, Effect.sync(() => { open = false; }));
  const requireOpen = Effect.suspend(() => open
    ? database.readNativeBinding(nativeBinding).pipe(Effect.mapError(projectCoreCmsFailure),
      Effect.andThen(() => preferences === undefined ? Effect.void
        : requirePayloadPreferenceNativeCleanup(preferences, database, nativeBinding).pipe(Effect.asVoid)))
    : Effect.fail(cmsError("closed")));
  // SAFETY: only this exact inert token is registered with its checked owner.
  const binding = Object.freeze({}) as CmsNativeBinding;
  bindings.set(binding, { scope, requireOpen,
    input: Object.freeze({ database, binding: nativeBinding, hostRuntime,
      identityAndAccessPolicy: policy.value, requestBudget: Object.freeze(budget),
      ...(preferences === undefined ? {} : { preferences }) }) });
  return binding;
});

const bind = Effect.fn("CmsNativeBinding.bind")(function* (
  binding: CmsNativeBinding, commands: readonly CmsCommand[], expected: CmsContentIdentity, readOnly: boolean,
) {
  const state = bindings.get(binding);
  if (state === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  yield* state.requireOpen;
  const host = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const acquired = yield* restore(makeCmsNativeHost({ ...state.input, commands, expectedContentIdentity: expected, readOnly }));
    yield* Scope.addFinalizer(state.scope, acquired.close);
    yield* state.requireOpen.pipe(Effect.onError(() => acquired.close));
    return acquired;
  }));
  return Object.freeze({ requestBudget: host.requestBudget, close: host.close, newRequestKey: host.newRequestKey,
    run: (key, command, args) => state.requireOpen.pipe(Effect.andThen(host.run(key, command, args))),
    read: (command, args) => state.requireOpen.pipe(Effect.andThen(host.read(command, args))),
  } satisfies CmsHost);
});

export const bindCmsNativeCommand = (binding: CmsNativeBinding, commands: readonly CmsCommand[], expected: CmsContentIdentity) =>
  bind(binding, commands, expected, false);
export const bindCmsNativeRead = Effect.fn("CmsNativeBinding.bindRead")(function* (
  binding: CmsNativeBinding, commands: readonly CmsCommand[], expected: CmsContentIdentity,
): Effect.fn.Return<CmsReadHost, CmsTransactionError> {
  const host = yield* bind(binding, commands, expected, true);
  return Object.freeze({ requestBudget: host.requestBudget, close: host.close, read: host.read });
});
