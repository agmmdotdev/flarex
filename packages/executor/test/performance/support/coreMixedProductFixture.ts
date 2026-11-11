import { createHash } from "node:crypto";
import { Cause, Clock, Effect, Exit, Option, Result } from "effect";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { defineGlobalTable, defineSchema, mutation } from "flarex/server";
import { v } from "flarex/values";
import { analyzeLoadedApplicationSourcePackageEffect } from "@flarex/analysis";
import { makeApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { TransactionGrantDeploymentIdV1Schema, TransactionGrantKeyIdV1Schema, TransactionGrantTimestampV1Schema, canonicalizeTransactionGrantIdentityAccessPolicyV1Effect,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1 } from "flarex-protocol/transaction-grant";
import { TransactionAuthorizationGrantIdV1Schema, TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1, assembleApplicationMutationGrantJwsV1, createApplicationMutationGrantVerifierNamespaceV1,
  prepareApplicationMutationGrantV1, verifyApplicationMutationGrantV1, type VerifiedApplicationMutationGrantV1 } from "flarex-protocol/internal/application-mutation-grant-v1";
import { makeGrantRetentionPolicyV1Result } from "flarex-protocol/grant-retention-policy";
import { createQueryCursorBroker } from "flarex-protocol/query-cursor";
import type { AdmittedFrameworkOperationV1 } from "flarex-protocol/internal/admitted-framework-operation-v1";
import type { Json } from "flarex-protocol/json";
import { makeCoreApplicationPrograms } from "../../../../persistence-postgres/src/application/coreProgram";
import { makeCoreNativeApplicationMutationPort, type CoreNativeApplicationMutationConfiguration } from "../../../../persistence-postgres/src/application/coreNativeMutation";
import { CoreNativeBudgetError, CoreTransactionError, type CoreError, type CoreNativeRootRecoveryInput } from "../../../../persistence-postgres/src/core/api";
import { createCorePostgresFixture } from "../../../../persistence-postgres/test/core/fixture";
import type { PostgresFixtureEndpoints } from "../../../../persistence-postgres/test/support/postgresHelpers";
import { makeBoundedRequestLifetime, projectBoundedRequestLifetime } from "../../../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { commerceError, commerceLimits, CommerceTransactionError } from "../../../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { getCommerceCommand } from "../../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeBorrowedNativeCommerceInvocation } from "../../../../persistence-postgres/src/frameworks/commerceTransaction/nativeInvocation";
import { projectCoreCommerceFailure } from "../../../../persistence-postgres/src/frameworks/commerceTransaction/nativeFailure";
import { defaultCommerceResources } from "../../../../persistence-postgres/src/frameworks/commerceTransaction/resources";
import { defineAtomicCommerceParticipant } from "../../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceEvents, prepareAtomicCommerceEvents, makeAtomicEventCapture, consumeCommerceEvents,
  type AtomicCommerceCallObservation } from "../../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { CORE_NATIVE_EVENT_WRITE, coreNativeEventLimits } from "../../../../persistence-postgres/src/commit/events/coreDefinition";
import { stageCoreCommitEventFamily } from "../../../../persistence-postgres/src/commit/events/coreStore";
import type { CommitEventError } from "../../../../persistence-postgres/src/commit/events/model";
import { bindPrivateProductAttempt } from "../../../../medusa-adapter/src/modules/product/attempt";
import { createCoreProductFixture, coreProductFixtureTarget, type CoreProductFixture } from "../../../../medusa-adapter/test/support/core-product-fixture";
import { productAttemptSeed } from "../../../../medusa-adapter/test/support/product-attempt-seed";
import { makeCoreNativeApplicationInsertView } from "../../../../standard-application-invocation/src/CoreNativeApplicationView";
import { maxCorePerformanceSeriesSamples } from "./measurementPlan";
import { executeCoreMixedProduct } from "./coreMixedProductRuntime";

const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const coreCommerce = <A>(work: Effect.Effect<A, CoreError>) => work.pipe(Effect.catchCause(cause =>
  Effect.failCause(Cause.map(cause, projectCoreCommerceFailure))));
const eventCommerce = <A>(work: Effect.Effect<A, CommitEventError>) => work.pipe(Effect.catchCause(cause =>
  Effect.failCause(Cause.map(cause, failure => commerceError(failure.reason === "limitExceeded" ? "limitExceeded"
    : failure.reason === "storedCorruption" ? "storedCorruption" : failure.reason === "resourceFailure" ? "resourceFailure"
      : failure.reason === "statementFailure" ? "statementFailure" : "unadmittedEvent", failure)))));
type ExecutionFailure = Effect.Error<ReturnType<typeof executeCoreMixedProduct>> | CommerceTransactionError | CoreError;
const makeIssuer = Effect.fn("CoreMixedProduct.makeIssuer")(function* (deploymentId: ReturnType<typeof TransactionGrantDeploymentIdV1Schema.make>) {
  const keys = yield* Effect.tryPromise(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
  if (!("privateKey" in keys)) return yield* Effect.die(new Error("Missing mixed Product signing key"));
  const kid = TransactionGrantKeyIdV1Schema.make("core-mixed-product-key");
  const retention = yield* Effect.fromResult(makeGrantRetentionPolicyV1Result({ maximumGrantLifetimeMilliseconds: 60_000,
    maximumFutureIssuedAtSkewMilliseconds: 0, maximumLiveSnapshotRetentionMilliseconds: 600_000 }));
  let ordinal = 0;
  return Effect.fn("CoreMixedProduct.issue")(function* (input: Parameters<CoreNativeApplicationMutationConfiguration<never, never>["issueGrant"]>[0]) {
    const now = yield* Clock.currentTimeMillis;
    const segments = yield* prepareApplicationMutationGrantV1({ ...input, kid,
      grantId: TransactionAuthorizationGrantIdV1Schema.make(`core-mixed-product-grant-${++ordinal}`),
      issuedAt: TransactionGrantTimestampV1Schema.make(new Date(now).toISOString()),
      expiresAt: TransactionGrantTimestampV1Schema.make(new Date(now + 60_000).toISOString()) });
    const signature = yield* Effect.tryPromise(async () => new Uint8Array(await crypto.subtle.sign("Ed25519", keys.privateKey,
      copyBytesToArrayBuffer(segments.signingInput))));
    const verified: VerifiedApplicationMutationGrantV1 = yield* verifyApplicationMutationGrantV1(assembleApplicationMutationGrantJwsV1(segments, signature),
      createApplicationMutationGrantVerifierNamespaceV1({ deploymentId, grantRetentionPolicy: retention,
        trustedNowEpochMilliseconds: Effect.succeed(now), keys: [{ kid, publicKey: keys.publicKey,
          purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1, state: "active", issuedAtInclusiveEpochMilliseconds: 0 }] }));
    return verified;
  });
});
type GrantFailure = Effect.Error<ReturnType<Effect.Success<ReturnType<typeof makeIssuer>>>>;

/** Authored Application code executes in the real portable kernel. The fixture
 * supplies only the existing confined Application/native capability surfaces. */
const handlerSource = `export async function run(ctx, args) {
  const id = await ctx.db.insert("users", { name: "before" });
  const updated = await ctx.privateMixed.call("medusa.product", "update", args.updateInput);
  const pending = await ctx.privateMixed.call("medusa.product", "retrieve", args.retrieveInput);
  const listed = await ctx.privateMixed.call("medusa.product", "listByHandle", args.listInput);
  if (args.mode === "caught-native") {
    try { await ctx.privateMixed.call("medusa.product", "unsupported", {}); } catch (_) {}
  }
  await ctx.db.patch(id, { name: args.mode === "late-failure" ? 42 : pending.title });
  if (args.mode === "dropped-native") void ctx.privateMixed.call("medusa.product", "unsupported", {}).catch(() => {});
  return { id, updated, pending, listed };
}`;

export type CoreMixedProductMode = "ordinary" | "late-failure" | "caught-native" | "dropped-native";
export interface CoreMixedProductFixture {
  readonly product: CoreProductFixture;
  readonly nativeInvocations: ReadonlyMap<string, number>;
  readonly prepare: (index: number) => Promise<ReturnType<typeof productAttemptSeed>>;
  readonly invoke: (index: number, mode?: CoreMixedProductMode) => Promise<Readonly<{
    seed: ReturnType<typeof productAttemptSeed>;
    outcome: Effect.Success<ReturnType<ReturnType<typeof makeCoreNativeApplicationMutationPort<GrantFailure, ExecutionFailure>>["invoke"]>>;
  }>>;
  readonly readApplication: (id: string) => Promise<unknown>;
  readonly readProduct: (id: string) => Promise<Json>;
  readonly eventFamilies: () => Promise<readonly string[]>;
  readonly reopen: () => Promise<void>;
  readonly close: () => Promise<void>;
}

/** One current Core app owner, native Product graph and request/outcome owner.
 * Legacy receipt/SQL-phase instrumentation is deliberately not synthesized. */
export async function createCoreMixedProductFixture(input: Readonly<{
  driver: "pglite" | "postgres"; suffix: string; sampleCount: number; postgresEndpoints?: PostgresFixtureEndpoints;
}>): Promise<CoreMixedProductFixture> {
  if (!Number.isSafeInteger(input.sampleCount) || input.sampleCount < 1 || input.sampleCount > maxCorePerformanceSeriesSamples)
    throw new Error("Invalid Core mixed Product sample count");
  const target = coreProductFixtureTarget;
  const schema = defineSchema({ users: defineGlobalTable({ name: v.string() }) });
  const modules = [
    { path: "_flarex/application.js", roles: 8, source: 'import {mutation} from "flarex/server";import {run} from "../functions/users.js";export default {users:{run:mutation({handler:run})}};' },
    { path: "_flarex/schema.js", roles: 2, source: 'import {defineSchema,defineGlobalTable} from "flarex/server";import {v} from "flarex/values";export default defineSchema({users:defineGlobalTable({name:v.string()})});' },
    { path: "functions/users.js", roles: 1, source: handlerSource },
  ].map(module => ({ ...module, sourceSha256: digest(module.source), sourceByteLength: new TextEncoder().encode(module.source).byteLength }));
  const identities = modules.map(({ source: _source, ...identity }) => identity);
  const source = { sourceArtifact: { rootSha256: digest(JSON.stringify(identities)), executionModulePath: "_flarex/application.js",
    schemaModulePath: "_flarex/schema.js", modules: identities }, modules };
  const handler: unknown = new Function(handlerSource.replace("export async function", "return async function"))();
  if (typeof handler !== "function") throw new Error("Missing authored mixed Product handler");
  const analysis = await Effect.runPromise(analyzeLoadedApplicationSourcePackageEffect({ schemaDefinition: schema,
    executionModules: { users: { run: mutation({ handler: (context: unknown, ...args: readonly unknown[]) => Reflect.apply(handler, undefined, [context, args[0]]) }) } }, sourceMaps: {} }));
  const manifest = (await Effect.runPromise(makeApplicationManifestV1(analysis, source.sourceArtifact))).manifest;
  const programs = await Effect.runPromise(makeCoreApplicationPrograms({ manifest, ...target, compatibilityDate: "2026-06-14", sha256: hash }));
  const program = programs.find(candidate => candidate.identity.functionPath === "users:run");
  if (program === undefined) throw new Error("Missing analyzed mixed Product program");
  const application = await Effect.runPromise(prepareApplicationSchemaSource(schema));
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make("core-mixed-product");
  const access = await Effect.runPromise(canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({ policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    auth: { kind: "anonymous" }, capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1 }));
  const issueGrant = await Effect.runPromise(makeIssuer(deploymentId));
  const queryCursor = Result.getOrThrow(createQueryCursorBroker({ instanceName: target.scopeUuid, deploymentSecret: new Uint8Array(32).fill(7) }));
  const physical = input.postgresEndpoints === undefined ? undefined : await createCorePostgresFixture(input.postgresEndpoints);
  const product = await createCoreProductFixture(input.driver, { sources: [{ kind: "application", definition: application }], programs,
    ...(physical === undefined ? {} : { physical }) });
  try {
    const selected = bindPrivateProductAttempt(product.runtime);
    const commands = [product.runtime.commands.update, product.runtime.commands.retrieve, product.runtime.commands.list];
    const nativeRegistrations = commands.map(command => {
      const registration = getCommerceCommand(command);
      if (registration === undefined) throw new Error("Missing Product registration");
      return { name: registration.name, mode: registration.mode };
    });
    const participant = defineAtomicCommerceParticipant("product");
    const eventPolicy = await product.run(prepareAtomicCommerceEvents(Result.getOrThrow(captureAtomicCommerceEvents(product.eventPolicy))));
    const limits = { maxIdentities: 256, maxDocumentBytes: 65_536 };
    const root: CoreNativeRootRecoveryInput = { bundle: product.bundle, applicationProgram: program.identity,
      contract: { name: "core-mixed-product", native: "scalar-update-retrieve-list", policy: access.sha256Hex },
      participants: [{ definition: product.definition, commands: nativeRegistrations, limits },
        { definition: product.eventDefinition, commands: [{ name: CORE_NATIVE_EVENT_WRITE, mode: "write" }], limits: coreNativeEventLimits }],
      applicationInsert: { table: "users", maxDocumentBytes: 65_536 }, maxFinalUserDocuments: 8 };
    type Configuration = CoreNativeApplicationMutationConfiguration<GrantFailure, ExecutionFailure>;
    const nativeInvocations = new Map<string, number>();
    const port = () => ({ invoke: (args: unknown, key: string) => product.useGeneration(generation => {
      const database = generation.database;
      const open: Configuration["open"] = Effect.fn("CoreMixedProduct.open")(function* () {
        const productBinding = yield* database.bindNative({ definition: product.definition, commands: nativeRegistrations });
        const eventBinding = yield* database.bindNative({ definition: product.eventDefinition, commands: [{ name: CORE_NATIVE_EVENT_WRITE, mode: "write" }] });
        const binding = yield* database.bindNativeRoot({ ...root, participants: [
          { binding: productBinding, commands: nativeRegistrations.map(command => command.name), limits },
          { binding: eventBinding, commands: [CORE_NATIVE_EVENT_WRITE], limits: coreNativeEventLimits },
        ] });
        const transactionId = crypto.randomUUID();
        const lifetime = yield* makeBoundedRequestLifetime<CommerceTransactionError | CoreError, object, object>(
          (reason, cause) => commerceError(reason, cause), { calls: commerceLimits.calls, commandBytes: defaultCommerceResources.commandBytes, commandMs: commerceLimits.commandMs },
          { hostId: Symbol("core.mixed.product") }, { requestId: Symbol("core.mixed.product.request") }, transactionId, "write");
        yield* Effect.addFinalizer(() => lifetime.close);
        const commerce = projectBoundedRequestLifetime(lifetime, failure => failure instanceof CommerceTransactionError ? failure : projectCoreCommerceFailure(failure));
        const core = projectBoundedRequestLifetime(lifetime, failure => failure instanceof CommerceTransactionError
          ? new CoreNativeBudgetError({ reason: failure.reason === "closed" || failure.reason === "rollbackOnly" || failure.reason === "limitExceeded"
            ? failure.reason : "unexpectedFailure", cause: failure }) : failure);
        let finishEvents: Effect.Effect<void, CommerceTransactionError> | undefined;
        const execute: Effect.Success<ReturnType<Configuration["open"]>>["execute"] = Effect.fn("CoreMixedProduct.execute")(function* (input) {
          const metadata = yield* coreCommerce(database.readNativeBinding(productBinding));
          const operations = yield* coreCommerce(input.operation.native(productBinding));
          const eventOperations = yield* coreCommerce(input.operation.native(eventBinding));
          const familyId = crypto.randomUUID();
          const readBinding = coreCommerce(database.readNativeBinding(productBinding));
          const events = makeAtomicEventCapture(readBinding.pipe(Effect.asVoid), commerce, `mixed/${familyId}`, eventPolicy, defaultCommerceResources.eventMessages);
          const observations: AtomicCommerceCallObservation[] = [];
          const borrowed = yield* makeBorrowedNativeCommerceInvocation({ operations, metadata, commands, lifetime: commerce, transactionId,
            unixTime: input.operation.unixTime, resources: defaultCommerceResources, mode: "write", readBinding,
            captureEvent: (_context, event) => events.captureSelected(product.eventSelection, event).pipe(Effect.asVoid) });
          const native = Effect.fn("CoreMixedProduct.native")(function* (request: AdmittedFrameworkOperationV1) {
            const select = request.participant !== "medusa.product" ? undefined : request.operation === "update" ? selected.update
              : request.operation === "retrieve" ? selected.retrieve : request.operation === "listByHandle" ? selected.listByHandle : undefined;
            const prepared = select === undefined ? Result.fail(commerceError("unsupportedProfile")) : select(request.args);
            const mode = Result.match(prepared, { onSuccess: call => getCommerceCommand(call.command)?.mode ?? "write", onFailure: () => "write" as const });
            // Even decoder/selection failures enter the lifetime. Successful
            // reads receive the authentic command's confined child mode.
            return yield* commerce.nested(commerce.context, transactionId, manager => Effect.gen(function* () {
              const call = yield* Effect.fromResult(prepared);
              nativeInvocations.set(request.operation, (nativeInvocations.get(request.operation) ?? 0) + 1);
              const result = yield* borrowed.invoke(manager, call.command, call.args);
              observations.push({ participant, command: call.command, input: call.args, result });
              return result;
            }), mode);
          });
          const value = yield* executeCoreMixedProduct({ ...input, handler, queryCursor, transaction: yield* makeCoreNativeApplicationInsertView(input.operation, input.root,
            (mode, work) => core.operation(core.context, transactionId, mode, work)), native });
          yield* coreCommerce(operations.prepareDeleteClosure());
          if ((yield* borrowed.working.referenceReplacementChanges()).length !== 0) return yield* commerceError("unadmittedEvent");
          finishEvents = Effect.gen(function* () {
            const closure = yield* events.close(observations);
            const consumed = yield* consumeCommerceEvents(closure, commerce);
            yield* eventCommerce(stageCoreCommitEventFamily(eventOperations, product.eventDefinition, familyId, consumed, input.operation.unixTime));
          });
          return value;
        });
        return { binding, execute, admissionDeadlineUnixMilliseconds: lifetime.deadlineUnixMilliseconds,
          seal: core.seal.pipe(Effect.andThen(() => finishEvents ?? Effect.void)),
          chargeRetained: bytes => core.fromResult(core.charge(bytes)), remainingBytes: core.remainingBytes };
      });
      return makeCoreNativeApplicationMutationPort<GrantFailure, ExecutionFailure>({ database, deploymentId, program: program.identity, root,
        identityAccessPolicySha256: access.sha256Hex, issueGrant, sha256: hash, open })
        .invoke(TransactionFunctionPathV1Schema.make("users:run"), args, TransactionRequestKeyV1Schema.make(key), access);
    }) });
    const seeds = new Map<number, ReturnType<typeof productAttemptSeed>>();
    const prepare = async (index: number) => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= input.sampleCount) throw new Error("Invalid Core mixed Product index");
      const existing = seeds.get(index);
      if (existing !== undefined) return existing;
      const seed = productAttemptSeed(`${input.suffix}-${index}`);
      await product.run(product.host.run(product.host.newRequestKey(), product.runtime.commands.createTags, seed.tagInput));
      await product.run(product.host.run(product.host.newRequestKey(), product.runtime.commands.createCategories, seed.categoryInput));
      const [initial] = seed.createInput.products;
      if (initial === undefined) throw new Error("Missing Product seed");
      await product.run(product.host.run(product.host.newRequestKey(), product.runtime.commands.create, initial));
      seeds.set(index, seed);
      return seed;
    };
    const invoke = async (index: number, mode: CoreMixedProductMode = "ordinary") => {
      const seed = seeds.get(index);
      if (seed === undefined) throw new Error("Prepare Core mixed Product graph before invocation");
      return { seed, outcome: await product.run(port().invoke({ updateInput: seed.updateInput, retrieveInput: seed.retrieveInput,
        listInput: seed.listInput, mode }, `core-mixed/${input.suffix}/${index}/${mode}`)) };
    };
    const eventFamilies = async () => {
      const ids: string[] = [];
      let after: string | undefined;
      for (;;) {
        const next = await product.run(product.events.nextFamily(after));
        if (Option.isNone(next)) return ids;
        ids.push(next.value); after = next.value;
      }
    };
    return { product, nativeInvocations, prepare, invoke,
      readApplication: id => product.run(product.useGeneration(({ database }) => Effect.gen(function* () {
        const transaction = yield* database.begin();
        return yield* transaction.get(id).pipe(Effect.map(Option.getOrNull), Effect.ensuring(transaction.abort()));
      }))),
      readProduct: id => product.run(product.host.read(product.runtime.commands.retrieve, { id })), eventFamilies,
      reopen: async () => {
        // The real owner's post-use check observes intentional closure. Only
        // that exact refusal is expected before its ordinary reconstruction.
        const closed = await product.run(Effect.exit(product.useGeneration(({ database }) => database.close())));
        if (Exit.isFailure(closed) && !closed.cause.reasons.every(reason => Cause.isFailReason(reason)
          && reason.error instanceof CoreTransactionError && reason.error.reason === "closed"))
          await product.run(Effect.failCause(closed.cause));
        await product.run(product.recover);
      }, close: product.close };
  } catch (cause) {
    try { await product.close(); } catch (cleanup) { throw new AggregateError([cause, cleanup], "Core mixed Product fixture construction and cleanup failed"); }
    throw cause;
  }
}
