import { createHash } from "node:crypto";

import { Effect, Exit, Schema, Scope } from "effect";

import { defineSchema, defineTable, mutation } from "flarex/server";
import { v } from "flarex/values";
import { analyzeLoadedApplicationSourcePackageEffect } from "@flarex/analysis";
import { makeApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { prepareLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { TransactionGrantDeploymentIdV1Schema, canonicalizeTransactionGrantIdentityAccessPolicyV1Effect,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1 } from "flarex-protocol/transaction-grant";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema,
  type TransactionFunctionPathV1, type TransactionRequestKeyV1 } from "flarex-protocol/transaction-session";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { createQueryCursorBroker } from "flarex-protocol/query-cursor";
import { makeCoreApplicationPrograms } from "../../../persistence-postgres/src/application/coreProgram";
import { makeCoreNativeApplicationMutationPort, type CoreNativeApplicationMutationConfiguration } from "../../../persistence-postgres/src/application/coreNativeMutation";
import { makeCoreApplicationMutationPort } from "../../../persistence-postgres/src/application/coreMutation";
import { CorePersistenceError } from "../../../persistence-postgres/src/core/contracts";
import { makeCoreNativeDefinition } from "../../../persistence-postgres/src/core/nativePolicy";
import { CoreNativeBudgetError, type CoreDatabase, type CoreDatabaseOptions, type CoreError,
  type CoreProgramDefinition, type CoreNativeLimits, type CoreNativeRootRecoveryInput } from "../../../persistence-postgres/src/core/api";
import type { CoreNativeDefinition } from "../../../persistence-postgres/src/core/nativePolicy";
import type { CoreSchemaBundle } from "../../../persistence-postgres/src/core/schemaBundle";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import type { CoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import type { PrivateReadPrincipal } from "../../../persistence-postgres/src/execution/journal/privateReadAccess";
import { preparePrivateParticipantReadSelection, privateParticipantReadSelectionFrame } from "../../../persistence-postgres/src/execution/journal/privateReadAccess";
import { bindNativeParticipantReadSelection } from "../../../persistence-postgres/src/execution/preparation/nativeParticipantReadAccess";
import type { PrivateReferencePermissions } from "../../../persistence-postgres/src/execution/journal/privatePermissionEvidence";
import { readCoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { makeBoundedRequestLifetime, projectBoundedRequestLifetime } from "../../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { cmsError, cmsLimits, CmsTransactionError } from "../../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { commerceError, CommerceTransactionError } from "../../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { getCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceCommandContext } from "../../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { makeNativeCommerceParticipant } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeStore";
import { compilePayloadCollections, type CompiledPayloadCollections } from "../../../payload-adapter/src/collections";
import { compileProductCoreDefinition } from "../../../medusa-adapter/src/modules/product/schema";
import { createCoreProductFixture, coreProductFixtureTarget, type CoreProductFixture } from "../../../medusa-adapter/test/support/core-product-fixture";
import { makeApplicationMutationTestLive } from "../../../system-test/support/applicationNativeMutationHarness";
import { MiniflareApplicationWorkerLoader } from "../../../system-test/support/applicationNativeQueryHarness";
import { makeCoreApplicationMutationRunner, makeCoreNativeApplicationMutationRunner } from "../../../standard-application-invocation/src/CoreApplicationMutationRunner";
import { makeCoreNativeApplicationInsertView } from "../../../standard-application-invocation/src/CoreNativeApplicationView";
import type { ApplicationCoreMutationSystemLive } from "../../../standard-application-invocation/src/ApplicationMutationSystem";
import { makePrivatePayloadNativeSaveConsumer } from "../../src/privatePayloadSaveConsumer";
import { makePrivatePayloadNativeReverseReadConsumer } from "../../src/privatePayloadReverseReadConsumer";
import { makePrivatePayloadNativeReferenceReadConsumer } from "../../src/privatePayloadReferenceReadConsumer";
import type { Json } from "flarex-protocol/json";
import type { AdmittedFrameworkOperationV1 } from "flarex-protocol/internal/admitted-framework-operation-v1";

const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type ReferenceFailure = CmsTransactionError | CommerceTransactionError | CoreError;

/** Actual current Worker, Product service and Payload Local API, using only
 * their existing Core root/outcome and native authorization owners. */
export type NativeProtectedReadSelection = Readonly<{ kind: "reverse"; policyId: string; targetId: string; targetReadIds?: readonly string[]; includeSave?: true; savePolicyId?: string }>
  | Readonly<{ kind: "sourceRead"; ids: readonly string[]; targetReadIds?: readonly string[] }>;
export interface NativeProtectedWorkerFixtureOptions {
  readonly handlerSource?: string;
  readonly target?: Readonly<{ scopeUuid: string; epochUuid: string }>;
  readonly physical?: import("../../../persistence-postgres/test/core/fixture").CorePersistenceFixture;
  readonly identityAccessPolicy?: import("flarex-protocol/transaction-grant").CanonicalTransactionGrantIdentityAccessPolicyV1;
  readonly retryProvenNoncommit?: true;
  readonly payloadInstrumentation?: import("../../../payload-adapter/src/runtime/native").PayloadNativeInstrumentation;
  readonly onCapability?: (method: string, args: readonly unknown[]) => void | Promise<void>;
  readonly onCapabilityResult?: (method: string, args: readonly unknown[], result: unknown) => void | Promise<void>;
}
type FixtureGrantFailure = Effect.Error<ReturnType<ApplicationCoreMutationSystemLive["grantIssuer"]["issue"]>> | CommerceTransactionError;
type FixtureExecutionFailure = Effect.Error<ReturnType<ReturnType<typeof makeCoreNativeApplicationMutationRunner<ReferenceFailure>>>> | ReferenceFailure;
type OrdinaryExecutionFailure = Effect.Error<ReturnType<ReturnType<typeof makeCoreApplicationMutationRunner>>> | CommerceTransactionError;
type NativePort = ReturnType<typeof makeCoreNativeApplicationMutationPort<FixtureGrantFailure, FixtureExecutionFailure>>;
type OrdinaryPort = Pick<ReturnType<typeof makeCoreApplicationMutationPort<FixtureGrantFailure, OrdinaryExecutionFailure>>, "invoke">;
interface WorkerGeneration {
  readonly live: Effect.Effect<ApplicationCoreMutationSystemLive, CommerceTransactionError>;
  readonly issueGrant: CoreNativeApplicationMutationConfiguration<FixtureGrantFailure, FixtureExecutionFailure>["issueGrant"];
}
export interface NativeProtectedWorkerFixture {
  readonly product: CoreProductFixture<WorkerGeneration>;
  readonly physical: CorePersistenceFixture;
  readonly bundle: CoreSchemaBundle;
  readonly databaseOptions: CoreDatabaseOptions;
  readonly compiled: CompiledPayloadCollections;
  readonly payloadDefinition: CoreNativeDefinition;
  readonly program: CoreProgramDefinition;
  readonly programs: readonly CoreProgramDefinition[];
  readonly programsForGeneration: (generation: number) => ReturnType<typeof makeCoreApplicationPrograms>;
  readonly principal: PrivateReadPrincipal;
  readonly access: import("flarex-protocol/transaction-grant").CanonicalTransactionGrantIdentityAccessPolicyV1;
  readonly path: TransactionFunctionPathV1;
  readonly key: TransactionRequestKeyV1;
  readonly limits: CoreNativeLimits;
  readonly loader: MiniflareApplicationWorkerLoader;
  readonly withdrawalBundle: CoreSchemaBundle;
  readonly seedProduct: Readonly<{ id: string }>;
  readonly policy: PrivateReferencePermissions;
  readonly policyDocumentId: string;
  readonly saveRoot: CoreNativeRootRecoveryInput;
  readonly sourceRoot: (ids: readonly string[], selected?: Readonly<{ targetReadIds?: readonly string[] }>) => CoreNativeRootRecoveryInput;
  readonly reverseRoot: (policyId: string, targetId: string, selected?: Readonly<{ targetReadIds?: readonly string[]; includeSave?: true; savePolicyId?: string }>) => CoreNativeRootRecoveryInput;
  readonly port: (root?: CoreNativeRootRecoveryInput, selection?: NativeProtectedReadSelection) => NativePort;
  readonly ordinary: () => OrdinaryPort;
  readonly useGeneration: CoreProductFixture<WorkerGeneration>["useGeneration"];
  readonly recover: CoreProductFixture<WorkerGeneration>["recover"];
  readonly run: CoreProductFixture<WorkerGeneration>["run"];
  readonly inventory: () => Promise<CoreNativeFixtureInventory>;
  readonly opens: number;
  readonly lastSealedCalls: number;
  readonly lostAcknowledgementPending: boolean;
  readonly armLostAcknowledgement: () => void;
  readonly reopen: () => Promise<void>;
  readonly close: () => Promise<void>;
}
export async function createNativeProtectedWorkerFixture(driver: "pglite" | "postgres", options: NativeProtectedWorkerFixtureOptions = {}): Promise<NativeProtectedWorkerFixture> {
  const target = Object.freeze({ ...(options.target ?? coreProductFixtureTarget) });
  let armLostAcknowledgement = false, loseNextAcknowledgement = false;
  const schema = defineSchema({ users: defineTable({ name: v.string(), product: v.optional(v.string()) }),
    news: defineTable({ headline: v.string(), product: v.optional(v.string()) }), permissions: defineTable({ policy: v.any() }) });
  const handlerSource = options.handlerSource ?? `export async function save(ctx, args) {
    if (args.operation === "large-result") return "x".repeat(args.bytes);
    if (args.operation === "many-patches") {
      const id = await ctx.db.insert("users", { name: "Patch limit" });
      for (let index = 0; index < args.count; index++) {
        try { await ctx.db.patch(id, { name: "Same coalesced body" }); } catch (_) {}
      }
      return id;
    }
    if (args.operation === "caught-patch") {
      const id = await ctx.db.insert("users", { name: "Pending original" });
      try { await ctx.db.patch(args.id || id, args.invalid ? { name: 42 } : { name: "Forbidden committed patch" }); } catch (_) {}
      return id;
    }
    if (args.operation === "source-read") {
      const article = await ctx.privateMixed.call("payload", "payload-findByID", { collection: "articles", id: args.id });
      const id = await ctx.db.insert("users", { name: article.headline });
      return { article, id };
    }
    if (args.operation === "ordinary-reference") return args.table === "news"
      ? ctx.db.insert("news", { headline: "Ordinary reference", product: args.target })
      : ctx.db.insert("users", { name: "Ordinary reference", product: args.target });
    if (args.operation === "ordinary-clear") { await ctx.db.delete(args.id); return null; }
    if (args.operation === "retained-edit" || args.operation === "final-clear" || args.operation === "clear-reassign") {
      if (args.operation === "clear-reassign") await ctx.privateMixed.call("payload", "payload-update", {
        collection: "articles", id: args.id, data: { featuredProduct: null } });
      const article = await ctx.privateMixed.call("payload", "payload-update", { collection: "articles", id: args.id,
        data: args.operation === "retained-edit" ? { headline: "Retained after deletion" }
          : { featuredProduct: args.operation === "final-clear" ? null : args.target } });
      const id = await ctx.db.insert("users", { name: "Reference lifecycle" });
      return { article, id };
    }
    if (args.operation === "caught-native" || args.operation === "dropped-native") {
      const id = await ctx.db.insert("users", { name: "Must roll back" });
      try {
        const work = ctx.privateMixed.call(args.participant, args.method, args.input);
        if (args.operation === "caught-native") await work;
      } catch (_) {}
      return id;
    }
    if (args.operation === "pages") {
      const id = await ctx.db.insert("users", { name: "Before pages" });
      const first = await ctx.privateMixed.call("payload", "private-reference-page", { limit: 1 });
      const second = await ctx.privateMixed.call("payload", "private-reference-page", { limit: 1, cursor: first.cursor });
      await ctx.db.patch(id, { name: first.docs[0].headline + second.docs[0].headline });
      return { id, first, second, user: await ctx.db.get(id) };
    }
    const product = await ctx.privateMixed.call("medusa.product", "retrieve", { id: args.target });
    const article = await ctx.privateMixed.call("payload", "payload-create", {
      collection: "articles", data: { headline: product.title, featuredProduct: args.target } });
    const id = await ctx.db.insert("users", { name: product.title });
    return { article, id };
  }`;
  const modules = [
    { path: "_flarex/application.js", roles: 8, source: 'import { mutation } from "flarex/server"; import * as users from "../functions/users.js"; export default {users:{save:mutation({handler:users.save})}};' },
    { path: "_flarex/schema.js", roles: 2, source: 'import {defineSchema,defineTable} from "flarex/server";import {v} from "flarex/values";export default defineSchema({users:defineTable({name:v.string(),product:v.optional(v.string())}),news:defineTable({headline:v.string(),product:v.optional(v.string())}),permissions:defineTable({policy:v.any()})});' },
    { path: "functions/users.js", roles: 1, source: handlerSource },
  ].map(module => ({ ...module, sourceSha256: digest(module.source), sourceByteLength: new TextEncoder().encode(module.source).byteLength }));
  const identities = modules.map(({ source: _source, ...identity }) => identity);
  const source = { sourceArtifact: { rootSha256: digest(JSON.stringify(identities)), executionModulePath: "_flarex/application.js",
    schemaModulePath: "_flarex/schema.js", modules: identities }, modules };
  const handler: unknown = new Function(handlerSource.replace("export async function", "return async function"))();
  if (typeof handler !== "function") throw new Error("Missing authored source handler");
  const analysis = await Effect.runPromise(analyzeLoadedApplicationSourcePackageEffect({ schemaDefinition: schema,
    executionModules: { users: { save: mutation({ handler: (context: unknown, ...args: readonly unknown[]) => Reflect.apply(handler, undefined, [context, args[0]]) }) } }, sourceMaps: {} }));
  const manifest = (await Effect.runPromise(makeApplicationManifestV1(analysis, source.sourceArtifact))).manifest;
  const programs = await Effect.runPromise(makeCoreApplicationPrograms({ manifest, ...target,
    compatibilityDate: "2026-06-14", sha256: hash }));
  const program = programs.find(candidate => candidate.identity.functionPath === "users:save");
  if (program === undefined) throw new Error("Missing analyzed private native program");
  const application = await Effect.runPromise(prepareApplicationSchemaSource(schema));
  const compiled = await Effect.runPromise(compilePayloadCollections([{ slug: "articles", fields: [
    { name: "headline", type: "text", required: true }, { name: "featuredProduct", type: "text" },
  ] }]));
  const payloadDefinition = await Effect.runPromise(makeCoreNativeDefinition({ ...target, source: compiled.sourceContract }));
  const productDefinition = await Effect.runPromise(compileProductCoreDefinition(target));
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make("native-protected-worker");
  const scopeId = ScopeIdSchema.make(`scope_${target.scopeUuid}`);
  const access = options.identityAccessPolicy ?? await Effect.runPromise(canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({ policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      auth: { kind: "anonymous" }, capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1 }));
  const principal = { scopeId, principalDigest: access.sha256Hex };
  const candidate = await Effect.runPromise(prepareLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate",
    deploymentId, scopeId, applicationAnalysis: { candidateId: "native-protected", analysisId: "native-protected", manifestSha256: digest(JSON.stringify(manifest)),
      sourceArtifactRootSha256: source.sourceArtifact.rootSha256 }, sources: [application.source, payloadDefinition.source, productDefinition.source],
    extensions: [{ name: "article_product", sourceKey: "payload", source: { table: { namespace: "app", logicalName: "articles" }, field: "featuredProduct" },
      target: { table: { namespace: "medusa", logicalName: "commerce.product/product" }, field: "id" }, policy: "strongReference",
      liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } }, onTargetSoftDelete: "retain", onTargetDelete: "restrict" },
      ...(["users", "news"] as const).map(table => ({ name: table === "users" ? "user_product" : "news_product", sourceKey: "application",
        source: { table: { namespace: "app" as const, logicalName: table }, field: "product" },
        target: { table: { namespace: "medusa" as const, logicalName: "commerce.product/product" }, field: "id" }, policy: "strongReference" as const,
        liveness: { source: { kind: "current" as const }, target: { kind: "softDeleteNull" as const, field: "deleted_at" } }, onTargetDelete: "restrict" as const }))] }));
  const loader = new MiniflareApplicationWorkerLoader(options.onCapability, options.onCapabilityResult);
  let opens = 0;
  let lastSealedCalls = 0;
  const prepareGeneration = (database: CoreDatabase): Effect.Effect<WorkerGeneration, CoreError | CommerceTransactionError, Scope.Scope> => Effect.gen(function* () {
    const scope = yield* Effect.scope;
    // The owner cancels and joins invocations before closing this scope. Drain
    // the actual runtime disposals before it may publish a successor generation.
    yield* Effect.addFinalizer(() => Effect.promise(() => loader.dispose()));
    const runInOwnerScope = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(work));
    const live = yield* Effect.cached(Effect.gen(function* () {
      const broker = yield* Effect.fromResult(createQueryCursorBroker({ instanceName: target.scopeUuid,
        deploymentSecret: new Uint8Array(32).fill(7) })).pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
      return yield* Effect.tryPromise({ try: () => makeApplicationMutationTestLive({ database, runInOwnerScope, deploymentId, source,
        queryCursor: { scopeUuid: target.scopeUuid, broker } }, loader), catch: cause => commerceError("resourceFailure", cause) });
    }));
    // Lazy construction lets historical outcomes resolve before any current
    // grant, source selection, signing service or Worker resource is opened.
    const issueGrant: WorkerGeneration["issueGrant"] = input => Effect.flatMap(live, selected => selected.grantIssuer.issue(input));
    return { live, issueGrant };
  });
  const fixture = await createCoreProductFixture(driver, { target, ...(options.physical === undefined ? {} : { physical: options.physical }), sources: [{ kind: "application", definition: application },
    { kind: "native", definition: payloadDefinition }], candidate, programs,
    prepareGeneration,
    bindingSelectionTargets: [[{ sourceKey: payloadDefinition.identity.sourceKey, selected: false }]],
    wrapPersistence: persistence => ({ ...persistence, write: (lease, batch) => Effect.gen(function* () {
      yield* persistence.write(lease, batch);
      if (loseNextAcknowledgement) {
        loseNextAcknowledgement = false;
        return yield* new CorePersistenceError({ reason: "uncertainWrite" });
      }
    }) }) });
  try {
    const run = fixture.run;
    const created = await run(fixture.host.run(fixture.host.newRequestKey(), fixture.runtime.commands.internalProductCreate,
      { title: "Actual Product native Worker", handle: "native-protected-worker" }));
    const product = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(created);
    const policy = { format: "flarex.private-reference-permissions" as const, version: 1 as const, principal,
      collection: "articles", relation: "featuredProduct", source: { create: true, update: true, delete: true }, assign: [product.id], retain: [product.id] };
    const policyDocumentId = await run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
      const seed = yield* database.begin();
      const id = yield* seed.insert("permissions", { policy });
      yield* database.commit(yield* seed.finalize());
      return id;
    })));
    const withdrawn = fixture.bindingSelectionBundles[0];
    if (withdrawn === undefined) throw new Error("Missing preauthorized withdrawal target");
    const inventory = () => run(fixture.useGeneration(({ database }) => readCoreNativeFixtureInventory(database, fixture.physical.persistence)));
    const command = getCommerceCommand(fixture.runtime.commands.internalProductRetrieve);
    if (command === undefined) throw new Error("Missing genuine Product read command");
    const limits = { maxIdentities: 256, maxDocumentBytes: 65_536 };
    const root: CoreNativeRootRecoveryInput = { bundle: fixture.bundle, protectedMetadata: true,
      contract: { name: "private-product-payload-reference", principalDigest: principal.principalDigest,
        policy: { table: "permissions", documentId: policyDocumentId }, collection: "articles", relation: "featuredProduct" },
      participants: [{ definition: fixture.definition, commands: [{ name: command.name, mode: "read" }], limits },
        { definition: payloadDefinition, commands: [{ name: "payload-create", mode: "write" },
          { name: "payload-update", mode: "write" }, { name: "payload-delete", mode: "write" }], limits }],
      applicationRead: { table: "permissions", program: program.identity, ...limits },
      applicationInsert: { table: "users", maxDocumentBytes: 65_536 }, maxFinalUserDocuments: 8,
      ...(options.retryProvenNoncommit === undefined ? {} : { retryProvenNoncommit: options.retryProvenNoncommit }) };
    type Configuration = CoreNativeApplicationMutationConfiguration<FixtureGrantFailure, FixtureExecutionFailure>;
    const open = (owner: CoreDatabase, selectedRoot: CoreNativeRootRecoveryInput,
      live: Effect.Effect<ApplicationCoreMutationSystemLive, CommerceTransactionError>, selection?: NativeProtectedReadSelection): Configuration["open"] =>
      Effect.fn("NativeProtectedWorkerFixture.open")(function* () {
      opens++;
      const productBinding = selectedRoot.participants.some(participant => participant.definition === fixture.definition)
        ? yield* owner.bindNative({ definition: fixture.definition, commands: [{ name: command.name, mode: "read" }] }) : undefined;
      const payloadBinding = yield* owner.bindNative({ definition: payloadDefinition });
      const payloadSelection = selectedRoot.participants.find(participant => participant.definition === payloadDefinition);
      if (payloadSelection === undefined) return yield* cmsError("invalidAuthority");
      const participants = [{ binding: payloadBinding,
        commands: payloadSelection.commands.map(registration => registration.name), limits: payloadSelection.limits }];
      if (productBinding !== undefined) participants.unshift({ binding: productBinding, commands: [command.name], limits });
      const binding = yield* owner.bindNativeRoot({ ...selectedRoot, participants });
      const transactionId = crypto.randomUUID();
      const lifetime = yield* makeBoundedRequestLifetime<ReferenceFailure, object, object>(cmsError, cmsLimits, { hostId: Symbol("native.protected") },
        { requestId: Symbol("native.protected.request") }, transactionId, "write");
      yield* Effect.addFinalizer(() => lifetime.close);
      const cms = projectBoundedRequestLifetime(lifetime, failure => failure instanceof CmsTransactionError ? failure : cmsError("rollbackOnly", failure));
      const commerce = projectBoundedRequestLifetime(lifetime, failure => failure instanceof CommerceTransactionError ? failure : commerceError("rollbackOnly", failure));
      const core = projectBoundedRequestLifetime(lifetime, failure => failure instanceof CmsTransactionError || failure instanceof CommerceTransactionError
        ? new CoreNativeBudgetError({ reason: failure.reason === "closed" || failure.reason === "rollbackOnly" || failure.reason === "limitExceeded"
          ? failure.reason : "unexpectedFailure", cause: failure }) : failure);
      let executionCompleted = false;
      const execute: Effect.Success<ReturnType<Configuration["open"]>>["execute"] = Effect.fn("NativeProtectedWorkerFixture.execute")(input => Effect.gen(function* () {
        const completed = yield* lifetime.withinDeadline(Effect.exit(Effect.scoped(Effect.gen(function* () {
        let retrieve: ((args: Json) => Effect.Effect<Json, CommerceTransactionError>) | undefined;
        if (productBinding !== undefined) {
          const productMetadata = input.root.participants.find(participant => participant.binding === productBinding);
          if (productMetadata === undefined) return yield* commerceError("invalidAuthority");
          const working = yield* makeNativeCommerceParticipant(yield* input.operation.native(productBinding), productMetadata,
            commerce, commerce.context, transactionId, input.operation.unixTime);
          retrieve = args => commerce.nested(commerce.context, transactionId,
            context => command.run(makeCommerceCommandContext(commerce, working, transactionId, context,
              () => Effect.fail(commerceError("invalidAuthority")), () => Effect.fail(commerceError("unadmittedEvent"))), args));
        }
        const bindTargetRead = (ids: readonly string[]) => Effect.gen(function* () {
          if (retrieve === undefined || productBinding === undefined) return yield* commerceError("invalidAuthority");
          const productRead = retrieve;
          const targetSelection = yield* preparePrivateParticipantReadSelection({ principal,
            participant: fixture.definition.identity.sourceKey, sourceKey: fixture.definition.identity.sourceKey,
            nativeProfileRevision: fixture.definition.identity.definitionHash, method: "retrieve", ids })
            .pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
          return yield* bindNativeParticipantReadSelection(targetSelection, { root: input.root, binding: productBinding,
            commandName: command.name, principal, lifetime: commerce, invoke: (_method, args) => productRead(args) },
            cause => commerceError("invalidAuthority", cause));
        });
        let native: (request: AdmittedFrameworkOperationV1) => Effect.Effect<Json, ReferenceFailure | CoreError>;
        if (selection === undefined) {
          if (retrieve === undefined) return yield* commerceError("invalidAuthority");
          const productRead = retrieve;
          const save = yield* makePrivatePayloadNativeSaveConsumer(compiled, { operation: input.operation, root: input.root,
            binding: payloadBinding, lifetime: cms,
            transactionId, principal, policyDocumentId, collection: "articles", relation: "featuredProduct" }, options.payloadInstrumentation);
          native = request => request.participant === "payload" && request.operation === "payload-create" ? save.invoke("create", request.args)
            : request.participant === "payload" && request.operation === "payload-update" ? save.invoke("update", request.args)
            : request.participant === "payload" && request.operation === "payload-delete" ? save.invoke("delete", request.args)
            : request.participant === "medusa.product" && request.operation === "retrieve" ? productRead(request.args)
              : Effect.fail(cmsError("invalidAuthority"));
        } else if (selection.kind === "sourceRead") {
          const read = yield* makePrivatePayloadNativeReferenceReadConsumer(compiled, { operation: input.operation, root: input.root,
            binding: payloadBinding, lifetime: cms, transactionId, principal, collection: "articles", ids: selection.ids }, options.payloadInstrumentation);
          const targetRead = selection.targetReadIds === undefined ? undefined : yield* bindTargetRead(selection.targetReadIds);
          native = request => request.participant === "payload" && request.operation === "payload-findByID" ? read.read(request.args)
            : request.participant === "medusa.product" && request.operation === "retrieve" && targetRead !== undefined
              ? targetRead("retrieve", request.args).pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)))
            : Effect.fail(cmsError("invalidAuthority"));
        } else {
          const readTarget = yield* bindTargetRead(selection.targetReadIds ?? [selection.targetId]);
          const pages = yield* makePrivatePayloadNativeReverseReadConsumer(compiled, { operation: input.operation, root: input.root,
            binding: payloadBinding, lifetime: cms, transactionId, principal, policyDocumentId: selection.policyId,
            collection: "articles", relation: "featuredProduct", targetId: selection.targetId,
            readTarget: readTarget("retrieve", { id: selection.targetId }).pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause))) }, options.payloadInstrumentation);
          const save = selection.includeSave !== true ? undefined : yield* makePrivatePayloadNativeSaveConsumer(compiled, {
            operation: input.operation, root: input.root, binding: payloadBinding, lifetime: cms, transactionId, principal,
            policyDocumentId: selection.savePolicyId ?? policyDocumentId, collection: "articles", relation: "featuredProduct" }, options.payloadInstrumentation);
          native = request => request.participant !== "payload" ? Effect.fail(cmsError("invalidAuthority"))
            : request.operation === "private-reference-page" ? pages.page(request.args)
            : save !== undefined && request.operation === "payload-create" ? save.invoke("create", request.args)
            : save !== undefined && request.operation === "payload-update" ? save.invoke("update", request.args)
            : save !== undefined && request.operation === "payload-delete" ? save.invoke("delete", request.args)
            : Effect.fail(cmsError("invalidAuthority"));
        }
        const runner = makeCoreNativeApplicationMutationRunner<ReferenceFailure | CoreError>(yield* live);
        const value = yield* runner({ ...input, transaction: yield* makeCoreNativeApplicationInsertView(input.operation, input.root,
          (mode, work) => core.operation(core.context, transactionId, mode, work)),
          native });
        return value;
        }))));
        if (Exit.isFailure(completed)) return yield* Effect.failCause(completed.cause);
        executionCompleted = true;
        return completed.value;
      }));
      return { binding, admissionDeadlineUnixMilliseconds: lifetime.deadlineUnixMilliseconds, execute,
        seal: core.seal.pipe(Effect.tap(() => Effect.sync(() => {
          lastSealedCalls = lifetime.usedCalls();
          if (executionCompleted && armLostAcknowledgement) { armLostAcknowledgement = false; loseNextAcknowledgement = true; }
        }))), chargeRetained: bytes => core.fromResult(core.charge(bytes)) };
    });
    const port = (historicalRoot = root, selection?: NativeProtectedReadSelection): NativePort => ({
      invoke: (...args) => fixture.useGeneration(generation => generation.extension === undefined ? Effect.fail(commerceError("closed"))
        : makeCoreNativeApplicationMutationPort<FixtureGrantFailure, FixtureExecutionFailure>({ database: generation.database, deploymentId,
          program: program.identity, root: historicalRoot, identityAccessPolicySha256: access.sha256Hex,
          issueGrant: generation.extension.issueGrant, sha256: hash,
          open: open(generation.database, historicalRoot, generation.extension.live, selection) }).invoke(...args)),
    });
    const ordinary = (): OrdinaryPort => ({ invoke: (...args) => fixture.useGeneration(generation => {
      const selected = generation.extension;
      return selected === undefined ? Effect.fail(commerceError("closed"))
        : makeCoreApplicationMutationPort<FixtureGrantFailure, OrdinaryExecutionFailure>({
          database: generation.database, deploymentId, maximumAttempts: 1, issueGrant: selected.issueGrant, sha256: hash,
          execute: input => Effect.flatMap(selected.live, live => makeCoreApplicationMutationRunner(live)(input)),
        }).invoke(...args);
    }) });
    const key = TransactionRequestKeyV1Schema.make("native-protected-worker-save"), path = TransactionFunctionPathV1Schema.make("users:save");
    const targetReadContract = (ids: readonly string[]) => privateParticipantReadSelectionFrame({ principal,
      participant: fixture.definition.identity.sourceKey, sourceKey: fixture.definition.identity.sourceKey,
      nativeProfileRevision: fixture.definition.identity.definitionHash, method: "retrieve", ids });
    const sourceRoot = (ids: readonly string[], selected: Readonly<{ targetReadIds?: readonly string[] }> = {}): CoreNativeRootRecoveryInput => {
      const { applicationRead: _permissionRead, ...base } = root;
      return { ...base, applicationProgram: program.identity,
        contract: { name: "private-explicit-source-read", principalDigest: principal.principalDigest,
          source: { collection: "articles", ids: [...ids] },
          ...(selected.targetReadIds === undefined ? {} : { targetRead: targetReadContract(selected.targetReadIds) }) }, participants: [
          { definition: payloadDefinition, commands: [{ name: "payload-findByID", mode: "read" }], limits },
          ...(selected.targetReadIds === undefined ? [] : [{ definition: fixture.definition, commands: [{ name: command.name, mode: "read" as const }], limits }])] };
    };
    const reverseRoot = (policyId: string, targetId: string,
      selected: Readonly<{ targetReadIds?: readonly string[]; includeSave?: true; savePolicyId?: string }> = {}): CoreNativeRootRecoveryInput => ({
      ...root, contract: { ...root.contract, profile: "reverse", targetId, policy: { table: "permissions", documentId: policyId },
        targetRead: targetReadContract(selected.targetReadIds ?? [targetId]),
        ...(selected.includeSave === true ? { savePolicy: { table: "permissions", documentId: selected.savePolicyId ?? policyDocumentId } } : {}) },
      participants: [{ definition: fixture.definition, commands: [{ name: command.name, mode: "read" }], limits },
        { definition: payloadDefinition, commands: [{ name: "payload-findByID", mode: "read" },
          ...(selected.includeSave === true ? [{ name: "payload-create", mode: "write" as const },
            { name: "payload-update", mode: "write" as const }, { name: "payload-delete", mode: "write" as const }] : [])], limits }],
    });
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      const workers = await Promise.allSettled([loader.dispose()]);
      const resources = await Promise.allSettled([fixture.close()]);
      const failures = [...workers, ...resources].flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length !== 0) throw new AggregateError(failures, "Protected Worker fixture cleanup failed");
    })();
    return { product: fixture, physical: fixture.physical, bundle: fixture.bundle, databaseOptions: fixture.databaseOptions,
      compiled, payloadDefinition, program, programs,
      programsForGeneration: generation => makeCoreApplicationPrograms({ manifest, ...target, generation, compatibilityDate: "2026-06-14", sha256: hash }),
      principal, access, path, key, limits, loader, withdrawalBundle: withdrawn,
      seedProduct: product, policy, policyDocumentId, saveRoot: root, sourceRoot, reverseRoot, port, ordinary, run, inventory,
      useGeneration: fixture.useGeneration, recover: fixture.recover,
      get opens() { return opens; }, get lastSealedCalls() { return lastSealedCalls; },
      get lostAcknowledgementPending() { return loseNextAcknowledgement; },
      armLostAcknowledgement: () => { armLostAcknowledgement = true; },
      reopen: async () => {
        // Force a cold-generation witness through the real owner. Its post-use
        // check observes closure; reconstruction still fences/drains/reconciles
        // and rebuilds every profile, with no test-owned database replacement.
        await run(Effect.exit(fixture.useGeneration(({ database }) => database.close())));
        await run(fixture.recover);
      }, close };
  } catch (cause) {
    const workers = await Promise.allSettled([loader.dispose()]);
    const resources = await Promise.allSettled([fixture.close()]);
    const failures = [...workers, ...resources].flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length !== 0) throw Object.assign(new Error("Protected Worker fixture setup and cleanup failed", { cause }),
      { cleanupFailures: Object.freeze(failures) });
    throw cause;
  }
}
