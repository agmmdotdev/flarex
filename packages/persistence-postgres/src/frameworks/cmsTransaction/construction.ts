import { Effect, Result, Scope } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES } from "flarex-protocol/internal/logical-schema-candidate";
import {
  claimApplicationServing, claimApplicationReadServing,
  type ApplicationServing, type ApplicationReadServing,
} from "../../application/applicationServing";
import type { PreparedHostRuntime } from "../../execution/preparation/preparedHostRuntime";
import { decodeCmsRequestBudget, type CmsRequestBudget } from "../../execution/preparation/frameworkExecutionPolicy";
import type { FrameworkSchemaTarget } from "../../installation/frameworkSchema/target";
import type { LogicalSourceReadPin } from "../../storage/catalog/logicalStorageDefinitions";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import type { CmsCommand } from "./commands";
import { makeCmsHost, type CmsHost, type CmsHostInput, type SourceCmsHostInput } from "./host";
import { makeCmsReadHost, type CmsReadHost } from "./read/host";
import type { CmsReadHostInput } from "./read/configuration";
import { cmsError, cmsLimits, type CmsTransactionError } from "./model";

declare const commandBindingBrand: unique symbol;
declare const readBindingBrand: unique symbol;
/** Issued by CMS from an authentic Application serving instance. */
export interface CmsCommandBinding { readonly [commandBindingBrand]: true }
/** Carries only independently admitted read authority. */
export interface CmsReadBinding { readonly [readBindingBrand]: true }

export type CmsContentIdentity = Readonly<{ configSha256: string; provenanceSha256: string }>;
export type CmsCommandProfile =
  | Readonly<{ kind: "source"; schemaVersionId: CatalogSchemaVersionId; source: unknown }>
  | Readonly<{ kind: "fullProof"; payloadPreferenceTarget?: FrameworkSchemaTarget }>;

interface CmsBindingSelection {
  readonly hostRuntime: PreparedHostRuntime;
  readonly identityAndAccessPolicy: Json;
  readonly requestBudget?: CmsRequestBudget;
}
export interface CmsCommandBindingInput<Failure> extends CmsBindingSelection {
  readonly serving: ApplicationServing<Failure>;
  readonly profile: CmsCommandProfile;
}
export interface CmsReadBindingInput extends CmsBindingSelection {
  readonly serving: ApplicationReadServing;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly source: LogicalSourceReadPin;
}

type CommandConfiguration = Omit<CmsHostInput<unknown>, "commands" | "expectedContentIdentity"> |
  Omit<SourceCmsHostInput<unknown>, "commands" | "expectedContentIdentity">;
type ReadConfiguration = Omit<CmsReadHostInput<unknown>, "commands" | "expectedContentIdentity">;
interface BindingLifetime {
  readonly scope: Scope.Scope;
  readonly servingScope: Scope.Scope;
  readonly invalidate: Effect.Effect<void>;
  readonly requireOpen: Effect.Effect<void, CmsTransactionError>;
}
const commandBindings = new WeakMap<CmsCommandBinding, BindingLifetime & Readonly<{ configuration: CommandConfiguration }>>();
const readBindings = new WeakMap<CmsReadBinding, BindingLifetime & Readonly<{ configuration: ReadConfiguration }>>();
const projectServingFailure = (failure: Readonly<{ reason: "closed" | "invalidComposition" }>) =>
  cmsError(failure.reason === "closed" ? "closed" : "invalidAuthority", failure);

const captureSelection = Effect.fn("CmsBinding.captureSelection")(function* (input: CmsBindingSelection) {
  const policy = yield* Effect.fromResult(capturePrivateJsonData(input.identityAndAccessPolicy, cmsLimits.documentBytes, cmsError));
  const requestBudget = input.requestBudget === undefined ? undefined :
    Object.freeze(yield* Effect.fromResult(decodeCmsRequestBudget(input.requestBudget))
      .pipe(Effect.mapError(cause => cmsError("unsupportedProfile", cause))));
  return Object.freeze({ hostRuntime: input.hostRuntime, identityAndAccessPolicy: policy.value,
    ...(requestBudget === undefined ? {} : { requestBudget }) });
});

/** Application constructs the shared graph; CMS selects its actual command
 * profile without accepting repositories or materialization ports from callers. */
export const makeCmsCommandBinding = Effect.fn("CmsBinding.makeCommand")(function* <Failure>(
  input: CmsCommandBindingInput<Failure>,
): Effect.fn.Return<CmsCommandBinding, CmsTransactionError, Scope.Scope> {
  const serving = input.serving;
  const claimed = yield* Effect.fromResult(claimApplicationServing(serving).pipe(Result.mapError(projectServingFailure)));
  const selection = yield* captureSelection(input);
  const scope = yield* Effect.scope;
  let open = true;
  const invalidate = Effect.sync(() => { open = false; });
  yield* Scope.addFinalizer(scope, invalidate);
  if (claimed.scope !== scope) yield* Scope.addFinalizer(claimed.scope, invalidate);
  const requireOpen = Effect.fn("CmsBinding.requireCommandOpen")(function* () {
    if (!open) return yield* Effect.fail(cmsError("closed"));
    yield* Effect.fromResult(claimApplicationServing(serving).pipe(Result.mapError(projectServingFailure)));
  });
  const common = Object.freeze({ ...selection, database: claimed.database, controlDatabase: claimed.controlDatabase,
    session: claimed.session, deploymentId: claimed.deploymentId, scopeId: claimed.scopeId,
    authority: claimed.authority, application: claimed.application, materialization: claimed.materialization });
  const profile = input.profile;
  if (profile.kind !== "source" && profile.kind !== "fullProof")
    return yield* Effect.fail(cmsError("unsupportedProfile"));
  const configuration: CommandConfiguration = profile.kind === "source"
    ? Object.freeze({ ...common, logicalStorage: Object.freeze({ ports: claimed.logicalStoragePorts,
      unique: claimed.uniqueConstraintEligibility, schemaVersionId: profile.schemaVersionId,
      source: (yield* Effect.fromResult(capturePrivateJsonData(profile.source, MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES, cmsError))).value }) })
    : Object.freeze({ ...common, pointCommitAuthority: claimed.pointCommitAuthority,
      ...(claimed.relationReads === undefined ? {} : { relationReads: claimed.relationReads }),
      ...(profile.payloadPreferenceTarget === undefined ? {} : { payloadPreferenceTarget: profile.payloadPreferenceTarget }) });
  yield* requireOpen();
  // SAFETY: the original inert identity alone is registered in this owner's WeakMap.
  const binding = Object.freeze({}) as CmsCommandBinding;
  commandBindings.set(binding, Object.freeze({ scope, servingScope: claimed.scope, invalidate,
    requireOpen: requireOpen(), configuration }));
  return binding;
});

/** Read serving has no publication graph; its installation capability remains
 * the authenticated session-owned installation selected by Application. */
export const makeCmsReadBinding = Effect.fn("CmsBinding.makeRead")(function* (
  input: CmsReadBindingInput,
): Effect.fn.Return<CmsReadBinding, CmsTransactionError, Scope.Scope> {
  const serving = input.serving;
  const claimed = yield* Effect.fromResult(claimApplicationReadServing(serving).pipe(Result.mapError(projectServingFailure)));
  const selection = yield* captureSelection(input);
  const scope = yield* Effect.scope;
  let open = true;
  const invalidate = Effect.sync(() => { open = false; });
  yield* Scope.addFinalizer(scope, invalidate);
  if (claimed.scope !== scope) yield* Scope.addFinalizer(claimed.scope, invalidate);
  const requireOpen = Effect.fn("CmsBinding.requireReadOpen")(function* () {
    if (!open) return yield* Effect.fail(cmsError("closed"));
    yield* Effect.fromResult(claimApplicationReadServing(serving).pipe(Result.mapError(projectServingFailure)));
  });
  const configuration = Object.freeze({ ...selection, database: claimed.database, session: claimed.session,
    deploymentId: claimed.deploymentId, scopeId: claimed.scopeId, authority: claimed.authority,
    application: claimed.application, installation: claimed.installation,
    logicalStorage: Object.freeze({ schemaVersionId: input.schemaVersionId,
      source: Object.freeze({ sourceKey: input.source.sourceKey, sourceSha256: input.source.sourceSha256,
        writeProfile: input.source.writeProfile }) }) });
  yield* requireOpen();
  // SAFETY: only this issuing WeakMap authenticates the original token.
  const binding = Object.freeze({}) as CmsReadBinding;
  readBindings.set(binding, Object.freeze({ scope, servingScope: claimed.scope, invalidate,
    requireOpen: requireOpen(), configuration }));
  return binding;
});

/** Native registration supplies exact tokens and identity, never authority. */
export const bindCmsCommand = Effect.fn("CmsBinding.bindCommand")(function* (
  binding: CmsCommandBinding, commands: readonly CmsCommand[], expectedContentIdentity: CmsContentIdentity,
): Effect.fn.Return<CmsHost, CmsTransactionError> {
  const state = commandBindings.get(binding);
  if (state === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  yield* state.requireOpen;
  const host = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const acquired = yield* restore(makeCmsHost({ ...state.configuration, commands, expectedContentIdentity }));
    const close = state.invalidate.pipe(Effect.andThen(acquired.close));
    yield* Scope.addFinalizer(state.scope, close);
    if (state.servingScope !== state.scope) yield* Scope.addFinalizer(state.servingScope, close);
    yield* state.requireOpen.pipe(Effect.onError(() => acquired.close));
    return acquired;
  }));
  return Object.freeze({ requestBudget: host.requestBudget, close: host.close, newRequestKey: host.newRequestKey,
    run: (key, command, args) => state.requireOpen.pipe(Effect.andThen(host.run(key, command, args))),
    read: (command, args) => state.requireOpen.pipe(Effect.andThen(host.read(command, args))),
  } satisfies CmsHost);
});

export const bindCmsRead = Effect.fn("CmsBinding.bindRead")(function* (
  binding: CmsReadBinding, commands: readonly CmsCommand[], expectedContentIdentity: CmsContentIdentity,
): Effect.fn.Return<CmsReadHost, CmsTransactionError> {
  const state = readBindings.get(binding);
  if (state === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  yield* state.requireOpen;
  const host = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const acquired = yield* restore(makeCmsReadHost({ ...state.configuration, commands, expectedContentIdentity }));
    const close = state.invalidate.pipe(Effect.andThen(acquired.close));
    yield* Scope.addFinalizer(state.scope, close);
    if (state.servingScope !== state.scope) yield* Scope.addFinalizer(state.servingScope, close);
    yield* state.requireOpen.pipe(Effect.onError(() => acquired.close));
    return acquired;
  }));
  return Object.freeze({ requestBudget: host.requestBudget, close: host.close,
    read: (command, args) => state.requireOpen.pipe(Effect.andThen(host.read(command, args))),
  } satisfies CmsReadHost);
});
