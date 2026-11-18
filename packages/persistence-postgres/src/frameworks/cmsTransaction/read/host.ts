import { Cause, Clock, Effect, Schema } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import type { Json } from "flarex-protocol/json";
import {
  hasApplicationBindingComposition,
  prepareStandaloneApplicationBindingSelection,
} from "../../../application/activation/repositoryIdentity";
import {
  decodeCmsRequestBudget,
  defaultCmsRequestBudget,
  type CmsRequestBudget,
} from "../../../execution/preparation/frameworkExecutionPolicy";
import {
  prepareLogicalDocumentReadAdmission,
  requireLogicalDocumentReadAdmission,
} from "../../../storage/documents/logicalDocuments/documentAdmission";
import {
  chargeHostPreparation,
  retainPreparedHost,
} from "../../../execution/preparation/preparedHostRuntime";
import { capturePrivateJsonData } from "../../../values/privateJsonData";
import {
  hasRelationalSessionDatabase,
  runCoLocatedRelationalReadSession,
} from "../../../database/relationalTransaction/session";
import { prepareStandaloneReadTransaction } from "../../../storage/documents/standaloneReadTransaction";
import {
  captureExactTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
} from "../../../scope/scopeAuthorityResolution";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
} from "../../../database/locatedTransactionIdentity";
import { makeCmsCommandContext } from "../context";
import { makeSourceCmsReadDocuments } from "../documents";
import { getCmsCommand, type CmsCommand } from "../commands";
import { projectCmsRequestFailure } from "../failure";
import type { CmsReadHostTestHooks } from "../testSupport";
import type { CmsReadHostInput } from "./configuration";
import { makeCmsRequestLifetime } from "../lifetime";
import {
  cmsError,
  cmsLimits,
  type CmsRequestContext,
  type CmsPresentedTransactionId,
  type CmsTransactionError,
} from "../model";

export interface CmsReadHost {
  readonly requestBudget: CmsRequestBudget;
  readonly close: Effect.Effect<void>;
  readonly read: (command: CmsCommand, args: Json) => Effect.Effect<Json, CmsTransactionError>;
}

export const makeCmsReadHost = Effect.fn("CmsReadHost.make")(function* <Failure>(
  input: CmsReadHostInput<Failure>, hooks?: CmsReadHostTestHooks,
): Effect.fn.Return<CmsReadHost, CmsTransactionError> {
  const selectedBudget = input.requestBudget;
  const requestBudget = Object.freeze(yield* Effect.fromResult(decodeCmsRequestBudget(selectedBudget === undefined ? defaultCmsRequestBudget : selectedBudget))
    .pipe(Effect.mapError(cause => cmsError("unsupportedProfile", cause))));
  const retained = yield* retainPreparedHost(input.hostRuntime, composeCmsReadHost(input, requestBudget, hooks))
    .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCmsRequestFailure))));
  return Object.freeze({ requestBudget, close: retained.close,
    read: (command, args) => retained.use(host => host.read(command, args))
      .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCmsRequestFailure)))),
  } satisfies CmsReadHost);
});

const digest = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{64}$/.test(value) ? undefined : "Expected SHA-256"));
const decodeContentIdentity = Schema.decodeUnknownEffect(Schema.Struct({ configSha256: digest, provenanceSha256: digest }));

/** Managed document reads keep the same Payload command and document owners. */
const composeCmsReadHost = Effect.fn("CmsReadHost.compose")(function* <Failure>(
  input: CmsReadHostInput<Failure>, requestBudget: CmsRequestBudget, hooks?: CmsReadHostTestHooks,
): Effect.fn.Return<Pick<CmsReadHost, "read">, CmsTransactionError> {
  const { database, session, deploymentId, scopeId, application, installation, authority: authorityInput } = input;
  if (!hasRelationalSessionDatabase(session, database) || !hasApplicationBindingComposition(application, authorityInput))
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const authority = captureExactTrustedScopeAuthorityResolutionPorts(authorityInput);
  const allowed = new Set(input.commands);
  const names = new Set<string>();
  if (allowed.size === 0 || allowed.size > cmsLimits.calls) return yield* Effect.fail(cmsError("invalidAuthority"));
  for (const token of allowed) {
    const command = getCmsCommand(token);
    if (command === undefined || command.mode !== "read" || !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(command.name) || names.has(command.name))
      return yield* Effect.fail(cmsError("invalidAuthority"));
    names.add(command.name);
  }
  const selection = input.logicalStorage;
  const source = Object.freeze({ sourceKey: selection.source.sourceKey,
    sourceSha256: selection.source.sourceSha256, writeProfile: selection.source.writeProfile });
  const schemaVersionId = selection.schemaVersionId;
  const capturedExpected = input.expectedContentIdentity === undefined ? undefined : { ...input.expectedContentIdentity };
  const capturedPolicy = capturePrivateJsonData(input.identityAndAccessPolicy, cmsLimits.documentBytes, cmsError);
  const afterAdmission = hooks?.afterAdmission;
  const documentReads = hooks?.documentReads === undefined ? undefined : Object.freeze({ ...hooks.documentReads });
  const expected = capturedExpected === undefined ? undefined :
    yield* decodeContentIdentity(capturedExpected).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
  const policy = yield* Effect.fromResult(capturedPolicy);
  yield* chargeHostPreparation({ deploymentId, scopeId, commands: [...names], policy: policy.value,
    requestBudget, source, expected: expected ?? null }).pipe(Effect.mapError(projectCmsRequestFailure));
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId, scopeId }, authority)
    .pipe(Effect.mapError(projectCmsRequestFailure));
  if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database)) return yield* Effect.fail(cmsError("invalidAuthority"));
  const transaction = yield* prepareStandaloneReadTransaction({ database, installation, deploymentId, scopeId,
    physicalLocator: located.authority.physicalLocator }).pipe(Effect.mapError(projectCmsRequestFailure));
  const ports = Object.freeze({ controlDb: database,
    controlInstallation: transaction.references.controlInstallation });
  const prepared = yield* prepareLogicalDocumentReadAdmission(ports,
    { deploymentId, scopeId: located.authority.scopeId, schemaVersionId }, source).pipe(Effect.mapError(projectCmsRequestFailure));
  const binding = yield* prepareStandaloneApplicationBindingSelection(application).pipe(Effect.mapError(projectCmsRequestFailure));
  const owner = Object.freeze({ hostId: Symbol("cms.readHost") });
  const read = Effect.fn("CmsReadHost.read")(function* (token: CmsCommand, args: Json) {
    if (!allowed.has(token)) return yield* Effect.fail(cmsError("invalidAuthority"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(args, requestBudget.commandBytes, cmsError));
    return yield* runCoLocatedRelationalReadSession(session, installation, transaction.enter, (tx, current) =>
      transaction.withSnapshot(tx, current, () => Effect.scoped(Effect.gen(function* () {
      return yield* prepared.withReadAdmission(binding, tx, current.authority, current.clock, admission => Effect.gen(function* () {
        const state = yield* requireLogicalDocumentReadAdmission(admission, tx).pipe(Effect.mapError(projectCmsRequestFailure));
        if (expected !== undefined && (state.contentIdentity.configSha256 !== expected.configSha256 ||
          state.contentIdentity.provenanceSha256 !== expected.provenanceSha256)) return yield* Effect.fail(cmsError("invalidAuthority"));
        if (afterAdmission !== undefined) yield* afterAdmission(tx);
        const id = crypto.randomUUID();
        const lifetime = yield* makeCmsRequestLifetime(owner, Object.freeze({ requestId: Symbol("cms.readRequest") }), id, "read", requestBudget);
        return yield* Effect.gen(function* () {
          yield* lifetime.fromResult(lifetime.charge(captured.bytes));
          const documents = yield* makeSourceCmsReadDocuments(admission, tx, lifetime,
            AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis), documentReads);
          const commandPorts = Object.freeze({ documents,
            relations: { incoming: (context: CmsRequestContext, transactionId: CmsPresentedTransactionId) =>
              lifetime.operation(context, transactionId, "read", Effect.fail(cmsError("unsupportedProfile"))) },
            preferences: { deleteForPendingDocument: (context: CmsRequestContext, transactionId: CmsPresentedTransactionId) =>
              lifetime.operation(context, transactionId, "write", Effect.fail(cmsError("unsupportedProfile"))) },
          });
          const invoke = Effect.fn("CmsReadHost.invoke")(function* (
            context: CmsRequestContext, command: CmsCommand, inputArgs: Json,
          ): Effect.fn.Return<Json, CmsTransactionError> {
            const definition = getCmsCommand(command);
            if (definition === undefined || definition.mode !== "read" || !allowed.has(command))
              return yield* Effect.fail(cmsError("invalidAuthority"));
            const child = yield* Effect.fromResult(capturePrivateJsonData(inputArgs, lifetime.remainingBytes(), cmsError));
            yield* lifetime.fromResult(lifetime.charge(child.bytes));
            const output = yield* definition.run(makeCmsCommandContext(lifetime, id, context, commandPorts,
              context === lifetime.context, invoke), child.value);
            const result = yield* Effect.fromResult(capturePrivateJsonData(output, lifetime.remainingBytes(), cmsError));
            yield* lifetime.fromResult(lifetime.charge(result.bytes));
            return result.value;
          });
          const result = yield* canonicalizeSuccessfulResultV1Effect(yield* invoke(lifetime.context, token, captured.value))
            .pipe(Effect.mapError(projectCmsRequestFailure));
          yield* lifetime.fromResult(lifetime.charge(result.canonicalBytes.byteLength));
          return result.valueJson;
        }).pipe(lifetime.withinDeadline, Effect.tap(() => lifetime.seal), Effect.ensuring(lifetime.close));
      }));
    }))));
  });
  return Object.freeze({ read: (command, args) => read(command, args).pipe(Effect.mapError(projectCmsRequestFailure)),
  });
});
