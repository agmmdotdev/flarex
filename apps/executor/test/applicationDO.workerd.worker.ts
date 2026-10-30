import { runQuery } from "@flarex/application-invocation";
import { defineModule, query, sourceModule, v } from "@flarex/application-definition";
import { invokeApplicationMutation, type ApplicationMutationSystem } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { invokeApplicationQuery, type ApplicationQuerySystem } from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { makeCoreApplicationPrograms } from "@flarex/persistence-postgres/internal/core-application-program";
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

const Configuration = Schema.Struct({ persistenceNamespace: Schema.NonEmptyString, instanceName: Schema.NonEmptyString });
const decodeConfiguration = Schema.decodeUnknownSync(Schema.fromJsonString(Configuration));
interface FixtureEnv extends ApplicationDurableObjectEnv {
  readonly APP_CONFIGURATION: string;
  readonly APPS: DurableObjectNamespace;
  readonly UPLOADS: DurableObjectNamespace;
}
const RequestBody = Schema.Struct({ operation: Schema.Literals(["typed", "query", "mutate", "lostAck", "republish", "hostHold"]),
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

function options() {
  const resources = { pools: 0, connections: 0, ended: 0, checkouts: 0, released: 0, bodies: 0, hostHeld: 0 };
  const backends: Array<Readonly<{ pid: number; applicationName: string }>> = [];
  let loseOnBody = false;
  let loseCommitAcknowledgement = false;
  let publishHead: Effect.Effect<void, unknown> = Effect.die("Application owner is not ready.");
  const configuration = (env: FixtureEnv) => ({ ...decodeConfiguration(env.APP_CONFIGURATION),
    namespace: env.APPS, canonicalName: CANONICAL });
  return {
    configuration,
    workload: {
      indexCache: { maxBytes: 2 * 1024 * 1024, verifyPercent: 0 }, operationCacheMaxBytes: 1024 * 1024,
      admission: { query: { maxActive: 2, maxQueued: 2, waitMilliseconds: 5_000 },
        mutation: { maxActive: 1, maxQueued: 2, waitMilliseconds: 5_000 }, maxPendingCallbacks: 128, maxOpenQueries: 128 },
      maxRequests: 8,
    },
    coreOptions: { now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
      newInternalId: Effect.sync(() => crypto.getRandomValues(new Uint8Array(16))), maxConcurrentSaves: 1 },
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
    application: Effect.fn("ApplicationDOFixture.compose")(function* (_env, infrastructure) {
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
      const manifest = first.metadata.manifest;
      publishHead = makeCoreApplicationPrograms({ manifest, scopeUuid: SCOPE, epochUuid: EPOCH,
        compatibilityDate: "2026-06-14", generation: 2, sha256 }).pipe(
        Effect.flatMap(programs => infrastructure.coreDatabase.install({ tables: [], programs })));
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
    resources,
    backends,
  } satisfies ApplicationDurableObjectOptions<FixtureEnv, unknown> & { resources: typeof resources; backends: typeof backends };
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
  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/status") return Response.json({ boot: this.#boot, gateEntered: this.#gate.entered, blockedSourceReads: this.#gate.blocked,
      resources: hostOptions.resources, backends: hostOptions.backends });
    if (path === "/release") { this.#releaseSourceReads(); return Response.json({ released: true }); }
    if (path === "/close") { this.#releaseSourceReads(); await this.close(); return Response.json({ closed: true, resources: hostOptions.resources }); }
    if (path === "/hold") this.#gate.hold = true;
    if (path === "/hold-all") this.#gate.all = true;
    try {
      const response = await super.fetch(request);
      response.headers.set("x-app-do-boot", this.#boot);
      return response;
    } catch (cause) {
      return Response.json({ error: String(cause), stack: cause instanceof Error ? cause.stack : null }, { status: 500 });
    }
  }
}

export default { async fetch(request: Request, env: FixtureEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/source") return env.UPLOADS.get(env.UPLOADS.idFromName("source-upload")).fetch(request);
  const path = url.pathname;
  url.pathname = path === "/wrong-name" || path === "/unique" ? "/invoke" : path;
  const stub = path === "/wrong-name" ? env.APPS.get(env.APPS.idFromName("wrong-application"))
    : path === "/unique" ? env.APPS.get(env.APPS.newUniqueId())
    : resolveApplicationDurableObject({ namespace: env.APPS, canonicalName: CANONICAL });
  return stub.fetch(new Request(url, request));
} } satisfies ExportedHandler<FixtureEnv>;
