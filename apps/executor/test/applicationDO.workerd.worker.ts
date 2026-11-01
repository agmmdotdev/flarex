import { runQuery } from "@flarex/application-invocation";
import { defineModule, query, sourceModule, v } from "@flarex/application-definition";
import { invokeApplicationMutation, type ApplicationMutationSystem } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { invokeApplicationQuery, type ApplicationQuerySystem } from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { makeCoreApplicationPrograms, readCoreApplicationProgram } from "@flarex/persistence-postgres/internal/core-application-program";
import { compileCoreApplicationSchema } from "@flarex/persistence-postgres/internal/core-application-schema";
import { parseCoreTableSummary, serializeCoreTableSummary } from "@flarex/persistence-postgres/internal/core";
import { Cause, Clock, Effect, Exit, Result, Schema, type Scope } from "effect";
import { CloudflareSocket } from "pg-cloudflare";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { makeApplicationMutationGrantIssuer } from "flarex-backend/internal/application-mutation-grant-issuer";
import { makeGrantRetentionPolicyV1Result } from "flarex-protocol/grant-retention-policy";
import { createQueryCursorBroker } from "flarex-protocol/query-cursor";
import { encodeEdgeActionHostPolicyV1 } from "flarex-protocol/internal/edge-action-host-policy-v1";
import { TransactionGrantDeploymentIdV1Schema, TransactionGrantKeyIdV1Schema } from "flarex-protocol/transaction-grant";
import { TransactionAuthorizationGrantIdV1Schema, TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";

import { createApplicationPostgresPool, makeApplicationDurableObject, resolveApplicationDurableObject,
  type ApplicationDurableObjectEnv, type ApplicationDurableObjectOptions } from "../src/applicationDO";
import { ApplicationSourceUploadDO, readFixtureText } from "./support/applicationDOSourceUpload";
import { applicationHostPolicy } from "./support/applicationDOHostPolicy";

export { ApplicationSourceUploadDO };

const Configuration = Schema.Struct({ persistenceNamespace: Schema.NonEmptyString, instanceName: Schema.NonEmptyString,
  waitForSchemaOnBoot: Schema.optionalKey(Schema.Boolean) });
const decodeConfiguration = Schema.decodeUnknownSync(Schema.fromJsonString(Configuration));
interface FixtureEnv extends ApplicationDurableObjectEnv {
  readonly APP_CONFIGURATION: string;
  readonly APPS: DurableObjectNamespace;
  readonly UPLOADS: DurableObjectNamespace;
}
const RequestBody = Schema.Struct({ operation: Schema.Literals(["typed", "query", "mutate", "lostAck", "republish", "hostHold", "schemaInspect", "stageSchema"]),
  args: Schema.Unknown, key: Schema.optionalKey(Schema.NonEmptyString) });
const decodeRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(RequestBody));
const SCOPE = "45000000-0000-4000-8000-000000000001";
const EPOCH = "45000000-0000-4000-8000-000000000002";
const CANONICAL = "application:core-host-fixture";
const typedReference = defineModule({ path: "users",
  source: sourceModule({ path: "functions/users.js", bytes: new TextEncoder().encode("export {};\n") }),
  functions: { typedQuery: query({ args: v.object({ id: v.string(), invalidReturn: v.optional(v.boolean()) }),
    returns: v.union(v.null(), v.string()) }) },
}).reference("typedQuery");

const sha256 = (bytes: Uint8Array) => Effect.promise(async () => new Uint8Array(
  await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes))));

/** Real proposed schema: preserve the authenticated base and declare the new indexed field. */
function schemaWithBackgroundIndex(schema: Result.Result.Success<ReturnType<typeof compileCoreApplicationSchema>>, bootReady = false) {
  return { ...schema, tables: schema.tables.map(table => {
    if (table.tableName !== "users") return table;
    const validator = table.documentType;
    if (validator?.type !== "object") throw new Error("The host fixture requires an object users validator.");
    return { ...table, documentType: { ...validator, value: { ...validator.value,
      background: { fieldType: { type: "string" }, optional: true },
      ...(bootReady ? { bootReady: { fieldType: { type: "boolean" }, optional: true } } : {}) } },
      stagedDbIndexes: [...table.stagedDbIndexes, { indexDescriptor: "by_background", fields: ["name", "background", "_creationTime"] }] };
  }) };
}
function options() {
  const resources = { pools: 0, connections: 0, ended: 0, checkouts: 0, released: 0, bodies: 0, hostHeld: 0 };
  const backends: Array<Readonly<{ pid: number; applicationName: string }>> = [];
  let loseOnBody = false;
  let loseCommitAcknowledgement = false;
  let publishHead: Effect.Effect<void, unknown> = Effect.die("Application owner is not ready.");
  let schemaHead: Effect.Effect<string, unknown> = Effect.die("Application owner is not ready.");
  let stageSchema: Effect.Effect<{ timestamp: string }, unknown> = Effect.die("Application owner is not ready.");
  const schemaGate: {
    holdAlarms: boolean; holdConnections: boolean; blockedConnections: number;
    alarms: number; completedAlarms: number; activeAlarms: number; closing: boolean;
    bootWaiting: boolean; alarmsDuringBoot: number; bootInitialState: string | null;
    bootValidationState: string | null; bootStatusReads: number;
    alarmReleases: Set<() => void>; connectionReleases: Set<() => void>;
  } = { holdAlarms: false, holdConnections: false, blockedConnections: 0, alarms: 0, completedAlarms: 0,
    activeAlarms: 0, closing: false, bootWaiting: false, alarmsDuringBoot: 0, bootInitialState: null,
    bootValidationState: null, bootStatusReads: 0, alarmReleases: new Set<() => void>(), connectionReleases: new Set<() => void>() };
  const releaseAlarms = () => { schemaGate.holdAlarms = false; for (const release of schemaGate.alarmReleases) release(); schemaGate.alarmReleases.clear(); };
  const releaseSchema = () => { releaseAlarms(); schemaGate.holdConnections = false;
    for (const release of schemaGate.connectionReleases) release(); schemaGate.connectionReleases.clear(); };
  const configuration = (env: FixtureEnv) => {
    const configured = decodeConfiguration(env.APP_CONFIGURATION);
    // Hold native delivery before boot starts, so the initial Pending witness
    // cannot race the real worker into Validated before it is observed.
    if (configured.waitForSchemaOnBoot === true) schemaGate.holdAlarms = true;
    return { ...configured, namespace: env.APPS, canonicalName: CANONICAL };
  };  return {
    configuration,
    workload: {
      schemaWorker: { documentBytes: 1_048_576, documentCount: 8, maxMetadataEntries: 4096,
        logPageSize: 16, maxLogPagesPerStep: 1, physicalChunkSize: 8, physicalConcurrency: 2 },
      schemaScheduler: { work: { pageSize: 1, maxPages: 1 }, wakeDelayMilliseconds: 25, continuationDelayMilliseconds: 25 },
      indexCache: { maxBytes: 2 * 1024 * 1024, verifyPercent: 0 }, operationCacheMaxBytes: 1024 * 1024,
      admission: { query: { maxActive: 2, maxQueued: 2, waitMilliseconds: 5_000 },
        mutation: { maxActive: 1, maxQueued: 2, waitMilliseconds: 5_000 }, maxPendingCallbacks: 128, maxOpenQueries: 128 },
      maxRequests: 8,
    },
    coreOptions: { now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
      randomBytes: (length: 16 | 32) => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))), maxConcurrentSaves: 1 },
    createPool(connectionString) {
      resources.pools++;
      const applicationName = `actual-app-do-${crypto.randomUUID()}`;
      const pool = createApplicationPostgresPool({ connectionString, max: 4, idleTimeoutMillis: 0, statement_timeout: 30_000,
        application_name: applicationName });
      const observed = new WeakSet<object>();
      return {
        on: pool.on.bind(pool), removeListener: pool.removeListener.bind(pool),
        connect: async () => {
          const client = await pool.connect();
          if (!observed.has(client)) {
            observed.add(client);
            resources.connections++;
            backends.push({ pid: Schema.decodeUnknownSync(Schema.Int.check(Schema.isGreaterThan(0)))(Reflect.get(client, "processID")),
              applicationName });
            client.on("end", () => { resources.ended++; });
            const connection: unknown = Reflect.get(client, "connection");
            const stream: unknown = isNonArrayRecord(connection) ? Reflect.get(connection, "stream") : undefined;
            if (!(stream instanceof CloudflareSocket)) throw new Error("Actual app owner did not use pg CloudflareSocket.");
          }
          resources.checkouts++;
          if (schemaGate.holdConnections) {
            schemaGate.blockedConnections++;
            await new Promise<void>(resolve => { schemaGate.connectionReleases.add(resolve); });
            schemaGate.blockedConnections--;
          }
          return { on: client.on.bind(client), removeListener: client.removeListener.bind(client),
            release: (failed?: boolean) => { resources.released++; client.release(failed); },
            query: async <Row extends Record<string, unknown> = Record<string, unknown>>(statement: string, parameters?: unknown[]) => {
              const result = await client.query<Row>(statement, parameters);
              if (statement === "COMMIT" && loseCommitAcknowledgement) {
                loseCommitAcknowledgement = false;
                throw new Error("actual-app-do-committed-acknowledgement-lost");
              }
              return result;
            },
          };
        },
        end: () => pool.end(),
      };
    },
    application: Effect.fn("ApplicationDOFixture.compose")(function* (env, infrastructure) {
      const deploymentId = TransactionGrantDeploymentIdV1Schema.make("deployment_application_core_mutation");
      const keyPair = yield* Effect.promise(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
      if (!("privateKey" in keyPair)) return yield* Effect.die("Fixture did not create a signing key pair.");
      const issuedAt = yield* Clock.currentTimeMillis;
      let grantSequence = 0;
      const grantIssuer = makeApplicationMutationGrantIssuer({ deploymentId,
        grantRetentionPolicy: Result.getOrThrow(makeGrantRetentionPolicyV1Result({ maximumGrantLifetimeMilliseconds: 120_000,
          maximumFutureIssuedAtSkewMilliseconds: 30_000, maximumLiveSnapshotRetentionMilliseconds: 600_000 })),
        signer: { kid: TransactionGrantKeyIdV1Schema.make("actual-app-do-key"), publicKey: keyPair.publicKey,
          issuedAtInclusiveEpochMilliseconds: issuedAt - 60_000,
          sign: bytes => Effect.promise(async () => new Uint8Array(await crypto.subtle.sign("Ed25519", keyPair.privateKey,
            copyBytesToArrayBuffer(bytes)))) },
        runtime: { currentTimeMillis: Clock.currentTimeMillis,
          nextGrantId: Effect.sync(() => TransactionAuthorizationGrantIdV1Schema.make(`actual-app-do-grant-${++grantSequence}`)) },
      });
      const policy = applicationHostPolicy();
      const policyBytes = Result.getOrThrow(encodeEdgeActionHostPolicyV1(policy, {
        maximumOrigins: 1_024, maximumOriginBytes: 8_192, maximumCanonicalBytes: 1_048_576,
      })).canonicalBytes;
      const hostPolicySha256 = yield* sha256(policyBytes);
      const first = yield* infrastructure.coreDatabase.selectProgram("users:typedQuery");
      // Genuine producer, current captured manifest; the host fixture does not
      // reconstruct Analysis/publication authority by copying the old algorithm.
      const manifest = (yield* readCoreApplicationProgram(first, sha256)).manifest;
      schemaHead = infrastructure.coreDatabase.publishedTimestamp.pipe(Effect.map(String));
      if (infrastructure.phase === "initial" && decodeConfiguration(env.APP_CONFIGURATION).waitForSchemaOnBoot === true) {
        yield* Effect.gen(function* () {
          schemaGate.bootWaiting = true;
          const schema = yield* Effect.fromResult(compileCoreApplicationSchema(manifest));
          const proposal = yield* infrastructure.coreDatabase.prepareSchema({ schema: schemaWithBackgroundIndex(schema, true) });
          const initial = yield* infrastructure.coreDatabase.schemaStatus(proposal);
          schemaGate.bootInitialState = initial.state;
          if (initial.state !== "pending")
            return yield* Effect.die(new Error("Actual boot fixture expected a new Pending schema, received " + initial.state));
          releaseAlarms();
          const deadline = Date.now() + 30_000;
          while (true) {
            const status = yield* infrastructure.coreDatabase.schemaStatus(proposal);
            schemaGate.bootStatusReads++;
            schemaGate.bootValidationState = status.state;
            if (status.state !== "pending" && status.state !== "validated")
              return yield* Effect.die(new Error("Actual boot schema entered unexpected state " + status.state));
            if (status.state === "validated" && status.indexesReady) break;
            if (schemaGate.bootStatusReads >= 6000 || Date.now() >= deadline)
              return yield* Effect.die(new Error("Actual boot schema did not validate within its bounded wait; state=" + status.state
                + ", reads=" + schemaGate.bootStatusReads + ", alarmsDuringBoot=" + schemaGate.alarmsDuringBoot));
            // Only the real independent alarm may advance the core here. This
            // interruptible trusted factory deliberately awaits its result.
            yield* Effect.sleep(5);
          }          yield* infrastructure.coreDatabase.activateSchema(proposal, { programs: [] });
        }).pipe(Effect.ensuring(Effect.sync(() => { schemaGate.bootWaiting = false; releaseAlarms(); })));
      }
      stageSchema = Effect.gen(function* () {
        const schema = yield* Effect.fromResult(compileCoreApplicationSchema(manifest));
        const declaration = schemaWithBackgroundIndex(schema);
        const proposal = yield* infrastructure.coreDatabase.prepareSchema({ schema: declaration });
        const validation = yield* infrastructure.coreDatabase.advanceSchema(proposal, { pageSize: 1, maxPages: 1 });
        if (validation.state !== "validated" || !validation.indexesReady)
          return yield* Effect.die(new Error("Host staged fixture did not validate in its single real step."));
        const activated = yield* infrastructure.coreDatabase.activateSchema(proposal, { programs: [] });
        // The subclass holds native alarm entry until activation has committed.
        // From here only the actual alarm can enter the gated native checkout.
        schemaGate.holdConnections = true;
        releaseAlarms();
        return { timestamp: activated.timestamp.toString() };
      });
      publishHead = makeCoreApplicationPrograms({ manifest, scopeUuid: SCOPE, epochUuid: EPOCH,
        compatibilityDate: "2026-06-14", generation: 2, sha256 }).pipe(
        Effect.flatMap(programs => infrastructure.coreDatabase.publishPrograms({ programs })), Effect.asVoid);
      let executionSequence = 0;
      return { deploymentId, grantIssuer, maximumAttempts: 3,
        applicationRunner: { source: infrastructure.source, hostPolicy: policy, hostPolicySha256, sha256,
          host: { ...infrastructure.host,
            runTransaction: input => infrastructure.host.runTransaction(input).pipe(Effect.tap(() => Effect.sync(() => {
              resources.bodies++;
              if (loseOnBody) { loseOnBody = false; loseCommitAcknowledgement = true; }
            }))),
          } },
        executionContextFactory: { make: () => Effect.sync(() => ({ executionId: `actual-app-${++executionSequence}`,
          logScopeId: `actual-app-log-${executionSequence}`, randomSeed: crypto.getRandomValues(new Uint8Array(32)) })) },
        queryCursor: { scopeUuid: SCOPE, broker: Result.getOrThrow(createQueryCursorBroker({ instanceName: SCOPE,
          deploymentSecret: Uint8Array.from({ length: 32 }, (_, index) => index + 1) })) },
      };
    }),
    dispatch: Effect.fn("ApplicationDOFixture.dispatch")(function* (request) {
      const input = yield* decodeRequest(yield* readFixtureText(request, 16_384));
      // Hold the trusted dispatch edge to witness the real HTTP request map cap,
      // independently of query/mutation permits and without copying their logic.
      if (input.operation === "hostHold") return yield* Effect.acquireUseRelease(
        Effect.sync(() => { resources.hostHeld++; }), () => Effect.never,
        () => Effect.sync(() => { resources.hostHeld--; }));
      const typedArguments = input.operation === "typed" ? yield* Schema.decodeUnknownEffect(Schema.Struct({
        id: Schema.String, invalidReturn: Schema.optionalKey(Schema.Boolean),
      }))(input.args) : undefined;
      const work: Effect.Effect<unknown, unknown, ApplicationMutationSystem | ApplicationQuerySystem | Scope.Scope> =
        input.operation === "typed" && typedArguments !== undefined ? runQuery(typedReference, typedArguments)
        : input.operation === "query" ? invokeApplicationQuery("users:standaloneQuery", input.args).pipe(Effect.scoped)
        : input.operation === "republish" ? publishHead
        : input.operation === "schemaInspect" ? schemaHead
        : input.operation === "stageSchema" ? stageSchema
        : Effect.gen(function* () {
          if (input.key === undefined) return yield* Effect.die("Fixture mutation key is missing.");
          loseOnBody = input.operation === "lostAck";
          const outcome = yield* invokeApplicationMutation(TransactionFunctionPathV1Schema.make("users:patchThroughInternal"), input.args,
            TransactionRequestKeyV1Schema.make(input.key));
          return { ...outcome, commitSeq: outcome.commitSeq.toString() };
        });
      const outcome = yield* Effect.exit(Effect.scoped(work));
      return Exit.isSuccess(outcome) ? Response.json({ ok: true, value: outcome.value, resources })
        : Response.json({ ok: false, cause: Cause.pretty(outcome.cause), resources,
          failures: outcome.cause.reasons.filter(Cause.isFailReason).map(reason => ({
            tag: isNonArrayRecord(reason.error) && typeof reason.error._tag === "string" ? reason.error._tag : null,
            reason: isNonArrayRecord(reason.error) && typeof reason.error.reason === "string" ? reason.error.reason : null,
          })),
        });
    }),
    failureResponse: cause => Response.json({ ok: false, cause: Cause.pretty(cause), resources,
      failures: cause.reasons.filter(Cause.isFailReason).map(reason => ({
        tag: isNonArrayRecord(reason.error) && typeof reason.error._tag === "string" ? reason.error._tag : null,
        reason: isNonArrayRecord(reason.error) && typeof reason.error.reason === "string" ? reason.error.reason : null,
      })),
    }),
    resources,
    backends, schemaGate, releaseSchema,
  } satisfies ApplicationDurableObjectOptions<FixtureEnv, unknown> & { resources: typeof resources; backends: typeof backends; schemaGate: typeof schemaGate; releaseSchema: typeof releaseSchema };
}

const hostOptions = options();
const Base = makeApplicationDurableObject(hostOptions);
export class ApplicationFixtureDO extends Base {
  readonly #boot = crypto.randomUUID();
  readonly #gate: { hold: boolean; all: boolean; entered: boolean; blocked: number; releases: Set<() => void> };
  constructor(ctx: DurableObjectState, env: FixtureEnv) {
    const gate = { hold: false, all: false, entered: false, blocked: 0, releases: new Set<() => void>() };
    const artifacts = env.ARTIFACTS;
    super(ctx, { ...env, ARTIFACTS: { ...artifacts, get: async key => {
      if (gate.hold || gate.all) {
        gate.hold = false;
        gate.entered = true;
        gate.blocked++;
        await new Promise<void>(resolve => { gate.releases.add(resolve); });
        gate.blocked--;
      }
      return artifacts.get(key);
    } } });
    this.#gate = gate;
  }
  #releaseSourceReads(): void {
    this.#gate.hold = false;
    this.#gate.all = false;
    this.#gate.entered = false;
    for (const release of this.#gate.releases) release();
    this.#gate.releases.clear();
  }
  override async alarm(): Promise<void> {
    const gate = hostOptions.schemaGate;
    gate.alarms++;
    gate.activeAlarms++;
    try {
      if (gate.holdAlarms) await new Promise<void>(resolve => { gate.alarmReleases.add(resolve); });
      // Count actual admission to the real step, after the native delivery gate.
      if (gate.bootWaiting) gate.alarmsDuringBoot++;
      await super.alarm();
    } finally { gate.activeAlarms--; gate.completedAlarms++; }
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      // Complete control POST input before returning across the service binding.
      if (["/schema-status", "/schema-release", "/status", "/release", "/close", "/close-cleanup"].includes(path)) {
        await request.arrayBuffer();
      }
      if (path === "/schema-status") return Response.json({ ...hostOptions.schemaGate,
      alarmReleases: undefined, connectionReleases: undefined, alarm: await this.ctx.storage.getAlarm(), boot: this.#boot,
      resources: hostOptions.resources });
      if (path === "/schema-release") { hostOptions.releaseSchema(); return Response.json({ released: true }); }
      if (path === "/stage-hold") hostOptions.schemaGate.holdAlarms = true;
      if (path === "/status") return Response.json({ boot: this.#boot, gateEntered: this.#gate.entered, blockedSourceReads: this.#gate.blocked,
      resources: hostOptions.resources, backends: hostOptions.backends });
      if (path === "/release") { this.#releaseSourceReads(); return Response.json({ released: true }); }
      if (path === "/close" || path === "/close-cleanup") { this.#releaseSourceReads(); hostOptions.schemaGate.closing = true;
      const closing = this.close();
      if (path === "/close-cleanup" || !hostOptions.schemaGate.holdConnections) hostOptions.releaseSchema();
      await closing; return Response.json({ closed: true, resources: hostOptions.resources }); }
      if (path === "/hold") this.#gate.hold = true;
      if (path === "/hold-all") this.#gate.all = true;
      const response = await super.fetch(request);
      response.headers.set("x-app-do-boot", this.#boot);
      return response;
    } catch (cause) {
      return Response.json({ error: Cause.pretty(Cause.fail(cause)), stack: cause instanceof Error ? cause.stack : null }, { status: 500 });
    }
  }
}

export default { async fetch(request: Request, env: FixtureEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/summary-codec") {
    const source = '{"tables":{"00000000000000000000000000000000":{"totalSize":"18446744073709551615","inferredTypeWithOptionalFields":{"numValues":18446744073709551615,"variant":{"kind":"Unknown"}}}},"ts":"1"}';
    const parsed = Result.getOrThrow(parseCoreTableSummary(new TextEncoder().encode(source)));
    const serialized = new TextDecoder().decode(serializeCoreTableSummary(parsed.timestamp, parsed.counts));
    const reparsed = Result.getOrThrow(parseCoreTableSummary(new TextEncoder().encode(serialized)));
    return Response.json({ timestamp: String(reparsed.timestamp), count: String(reparsed.counts.count(new Uint8Array(16))), serialized });
  }
  if (url.pathname === "/source") return env.UPLOADS.get(env.UPLOADS.idFromName("source-upload")).fetch(request);
  const path = url.pathname;
  url.pathname = path === "/wrong-name" || path === "/unique" ? "/invoke" : path;
  const stub = path === "/wrong-name" ? env.APPS.get(env.APPS.idFromName("wrong-application"))
    : path === "/unique" ? env.APPS.get(env.APPS.newUniqueId())
    : resolveApplicationDurableObject({ namespace: env.APPS, canonicalName: CANONICAL });
  return stub.fetch(new Request(url, request));
} } satisfies ExportedHandler<FixtureEnv>;
