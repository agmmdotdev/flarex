/// <reference types="@cloudflare/workers-types" />

import { Result, Effect, Scope } from "effect";
import { Miniflare } from "miniflare";
import {
  makeApplicationAnalysisContext,
} from "@flarex/source-analyzer-v2/internal/application-analysis-composition";
import {
  applicationAnalysisHostEffectWithCapabilities,
} from "@flarex/source-analyzer-v2/internal/application-analysis-host";
import {
  produceStandardApplicationSource,
} from "@flarex/standard-application-definition/application-source";
import {
  prepareStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import {
  createApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationFixtureOptions,
  type ApplicationNativeMutationPersistence,
  type ApplicationNativeMutationSourceBundle,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  ApplicationMutationSystem,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  makeApplicationQuerySystemLayer,
} from
  "@flarex/standard-application-invocation/internal/application-query-system";
import {
  invokeStandardApplicationPointMutationV1,
  invokeStandardApplicationPointQueryV1,
} from "@flarex/standard-application-invocation/v1";
import {
  APPLICATION_RUNTIME_HOST_IDENTITY,
} from "flarex-backend/artifact-runtime";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import {
  ApplicationAnalysisSourceReadError,
  type ApplicationAnalysisSourceBundle,
} from "flarex-backend/internal/application-analysis-source-reader";
import { makeApplicationExecutionHost } from
  "flarex-backend/internal/application-execution-host";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";

import {
  makeApplicationNativeMutationTestLayer,
} from "./applicationNativeMutationHarness";
import {
  MiniflareApplicationWorkerLoader,
} from "./applicationNativeQueryHarness";

const COMPATIBILITY_DATE = "2026-06-14";

export interface ManagedSchemaCookingSchemaAProof {
  readonly analyzedWithTwoColdLoads: true;
  readonly activatedSchemaA: true;
  readonly mutationPublished: true;
  readonly exactReplay: true;
  readonly queryReadCommittedDocument: true;
  readonly runtimeWorkerLoads: 2;
  readonly commitCount: 1;
  readonly outcomeCount: 1;
  readonly feedCount: 1;
  readonly outboxCount: 1;
}

export type ManagedSchemaCookingFixtureFactory = (
  options: ApplicationNativeMutationFixtureOptions,
) => Promise<
  ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>
>;

export async function proveManagedSchemaCookingSchemaA(
  createFixture: ManagedSchemaCookingFixtureFactory = options =>
    createApplicationNativeMutationPGliteFixture(options),
): Promise<
  ManagedSchemaCookingSchemaAProof
> {
  const source = await cookingSchemaASourceBundle();
  const analysisLoader = new MiniflareAnalysisWorkerLoader();
  const runtimeLoader = new MiniflareApplicationWorkerLoader();
  try {
    const fixture = await createFixture({
      runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      analysis: {
        source,
        run: async input => {
          const context = makeApplicationAnalysisContext({
            authority: input.authority,
            repository: input.repository,
            host: {
              analyze: request => applicationAnalysisHostEffectWithCapabilities({
                source: {
                  read: rootSha256 => rootSha256 ===
                      input.sourceArtifactRootSha256
                    ? Effect.succeed(
                        source satisfies ApplicationAnalysisSourceBundle,
                      )
                    : Effect.fail(new ApplicationAnalysisSourceReadError({
                        operation: "read",
                        reason: "invalidRoot",
                      })),
                },
                loader: analysisLoader,
              }, request),
            },
          });
          const analyzed = await Effect.runPromise(context.analyze({
            requestKey: input.requestKey,
            sourceArtifactRootSha256: input.sourceArtifactRootSha256,
          }));
          if (analyzed.kind !== "analyzed") {
            throw new Error("Cooking schema A was rejected by Application Analysis.");
          }
          return Effect.runPromise(input.repository.inspect(
            input.authority,
            analyzed.receipt.candidateId,
          ));
        },
      },
    });
    const mutationLayer = await makeApplicationNativeMutationTestLayer(
      fixture,
      runtimeLoader,
    );
    const mutation = <A, E>(effect: Effect.Effect<
      A,
      E,
      ApplicationMutationSystem | Scope.Scope
    >) => Effect.runPromise(Effect.scoped(
      effect.pipe(Effect.provide(mutationLayer)),
    ));
    const requestKey = TransactionRequestKeyV1Schema.make(
      "managed-schema:cooking:schema-a:create",
    );
    const create = TransactionFunctionPathV1Schema.make("recipes:create");
    const published = await mutation(invokeStandardApplicationPointMutationV1(
      create,
      { name: "Tea leaf salad", description: "A bright, crunchy salad." },
      requestKey,
    ));
    if (published.disposition !== "published" ||
      typeof published.value !== "string") {
      throw new Error("Cooking schema-A mutation did not publish a document.");
    }
    const loadsAfterPublish = runtimeLoader.loads;
    const replayed = await mutation(invokeStandardApplicationPointMutationV1(
      create,
      { name: "Tea leaf salad", description: "A bright, crunchy salad." },
      requestKey,
    ));
    if (replayed.disposition !== "replayed" ||
      replayed.status !== published.status ||
      replayed.scopeUuid !== published.scopeUuid ||
      replayed.epochUuid !== published.epochUuid ||
      replayed.commitSeq !== published.commitSeq ||
      replayed.value !== published.value ||
      runtimeLoader.loads !== loadsAfterPublish) {
      throw new Error("Cooking schema-A replay did not return the exact outcome.");
    }

    const queryLayer = makeCookingQueryLayer(fixture, runtimeLoader);
    const queried = await Effect.runPromise(Effect.scoped(
      invokeStandardApplicationPointQueryV1(
        TransactionFunctionPathV1Schema.make("recipes:get"),
        { id: published.value },
      ).pipe(Effect.provide(queryLayer)),
    ));
    if (!isCookingRecipe(queried) ||
      queried.name !== "Tea leaf salad" ||
      queried.description !== "A bright, crunchy salad.") {
      throw new Error("Cooking schema-A query did not read the committed recipe.");
    }
    const counts = await durableCounts(fixture);
    if (analysisLoader.loads !== 2 || runtimeLoader.loads !== 2 ||
      counts.commits !== 1 || counts.outcomes !== 1 || counts.feed !== 1 ||
      counts.outbox !== 1) {
      throw new Error("Cooking schema-A proof observed unexpected durable counts.");
    }
    return Object.freeze({
      analyzedWithTwoColdLoads: true,
      activatedSchemaA: true,
      mutationPublished: true,
      exactReplay: true,
      queryReadCommittedDocument: true,
      runtimeWorkerLoads: 2,
      commitCount: 1,
      outcomeCount: 1,
      feedCount: 1,
      outboxCount: 1,
    });
  } finally {
    await Promise.all([
      analysisLoader.dispose(),
      runtimeLoader.dispose(),
    ]);
  }
}

function makeCookingQueryLayer(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
  loader: MiniflareApplicationWorkerLoader,
) {
  let executionSequence = 0;
  return makeApplicationQuerySystemLayer({
    activation: fixture.activation,
    snapshot: {
      deploymentId: fixture.deploymentId,
      controlDb: fixture.control.drizzle,
      authority: fixture.authorityPorts,
      schema: fixture.schema,
      developerIndexes: fixture.developerIndexes,
    },
    snapshotBudget: Object.freeze({
      maximumPointReads: 16,
      maximumIndexReads: 16,
      maximumDocuments: 64,
      maximumSemanticBytes: 1_048_576,
    }),
    source: Object.freeze({
      read: (rootSha256: string) => rootSha256 ===
          fixture.source.sourceArtifact.rootSha256
        ? Effect.succeed(fixture.source)
        : Effect.fail(new ApplicationAnalysisSourceReadError({
            operation: "read",
            reason: "invalidRoot",
          })),
    }),
    host: makeApplicationExecutionHost(loader),
    executionContextFactory: () => {
      executionSequence += 1;
      return Object.freeze({
        executionId: `managed-schema-cooking-query-${executionSequence}`,
        randomSeed: new Uint8Array(32).fill(executionSequence),
        executionTime: 1_800_000_000_000 + executionSequence,
      });
    },
  });
}

async function cookingSchemaASourceBundle(): Promise<
  ApplicationNativeMutationSourceBundle
> {
  const prepared = Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 2,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 128,
      maximumValidatorDepth: 16,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: {
        tables: [{
          logicalName: "recipes",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                name: {
                  fieldType: { type: "string" },
                  optional: false,
                },
                description: {
                  fieldType: { type: "string" },
                  optional: true,
                },
              },
            },
          },
        }],
        indexes: [],
      },
      modules: [{
        modulePath: "recipes",
        functions: [{
          exportName: "create",
          kind: "mutation",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: {
              name: {
                fieldType: { type: "string" },
                optional: false,
              },
              description: {
                fieldType: { type: "string" },
                optional: true,
              },
            },
          },
          returnsValidator: { type: "string" },
        }, {
          exportName: "get",
          kind: "query",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: {
              id: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
          returnsValidator: { type: "any" },
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
      maximumEntryBindings: 2,
      maximumSourceBytes: 8_192,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 65_536,
      maximumSemanticRecords: 64,
      maximumSemanticRecordBytes: 8_192,
      maximumSemanticStreamBytes: 65_536,
    },
    graphInput: {
      modules: [{
        path: "functions/recipes.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode([
          "export async function create(ctx, args) {",
          "  const value = args.description === undefined",
          "    ? { name: args.name }",
          "    : { name: args.name, description: args.description };",
          '  const id = await ctx.db.insert("recipes", value);',
          "  await ctx.db.replace(id, value);",
          "  return id;",
          "}",
          "export async function get(ctx, args) {",
          "  return ctx.db.get(args.id);",
          "}",
          "",
        ].join("\n")),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "recipes",
        artifactModulePath: "functions/recipes.js",
      }],
      executionPath: "functions/recipes.js",
      schemaPath: null,
      authPath: null,
    },
  }));
  const produced = Result.getOrThrow(produceStandardApplicationSource(prepared));
  const modules = Object.freeze(await Promise.all(produced.modules.map(
    async module => {
      const sourceSha256 = await sha256Hex(module.sourceBytes);
      return Object.freeze({
        path: module.path,
        roles: module.roles,
        sourceSha256,
        sourceByteLength: module.sourceBytes.byteLength,
        source: new TextDecoder().decode(module.sourceBytes),
      });
    },
  )));
  const rootSha256 = await sha256Hex(new TextEncoder().encode(
    modules.map(module => `${module.path}:${module.sourceSha256}`).join("\n"),
  ));
  return Object.freeze({
    sourceArtifact: Object.freeze({
      rootSha256,
      executionModulePath: produced.executionPath,
      schemaModulePath: produced.schemaPath,
      modules: Object.freeze(modules.map(module => Object.freeze({
        path: module.path,
        roles: module.roles,
        sourceSha256: module.sourceSha256,
        sourceByteLength: module.sourceByteLength,
      }))),
    }),
    modules,
  });
}

class MiniflareAnalysisWorkerLoader implements WorkerLoader {
  loads = 0;
  readonly #disposals: Array<Promise<void>> = [];
  readonly #runtimes = new Set<Miniflare>();

  get(): WorkerStub {
    throw new Error("Cooking analysis forbids cached Worker loading.");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loads += 1;
    return new MiniflareAnalysisWorkerStub(this, code);
  }

  attach(runtime: Miniflare): void {
    this.#runtimes.add(runtime);
  }

  release(runtime: Miniflare): void {
    if (!this.#runtimes.delete(runtime)) return;
    this.#disposals.push(runtime.dispose());
  }

  async dispose(): Promise<void> {
    const runtimes = [...this.#runtimes];
    this.#runtimes.clear();
    await Promise.all([
      ...this.#disposals.splice(0),
      ...runtimes.map(runtime => runtime.dispose()),
    ]);
  }
}

class MiniflareAnalysisWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: MiniflareAnalysisWorkerLoader,
    private readonly code: WorkerLoaderWorkerCode,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    const entrypoint = {
      analyze: () => this.analyze(name),
      fetch: async () => new Response(null, { status: 501 }),
      connect: () => {
        throw new Error("Cooking analysis forbids sockets.");
      },
    };
    // SAFETY: the test adapter implements the exact analyze RPC used by the
    // Application Analysis host plus Cloudflare's declared Fetcher surface.
    return entrypoint as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Cooking analysis forbids Durable Objects.");
  }

  private async analyze(name: string | undefined): Promise<unknown> {
    if (name === undefined) {
      throw new Error("Cooking analysis omitted its Worker entrypoint.");
    }
    const script = `export default {
  async fetch(_request, env) {
    const worker = env.LOADER.load(${JSON.stringify(this.code)});
    const stub = worker.getEntrypoint(${JSON.stringify(name)});
    const result = await stub.analyze();
    try { return Response.json(result); }
    finally { result?.[Symbol.dispose]?.(); }
  },
};`;
    const runtime = new Miniflare({
      compatibilityDate: COMPATIBILITY_DATE,
      modules: true,
      script,
      workerLoaders: { LOADER: {} },
    });
    this.owner.attach(runtime);
    try {
      const response = await runtime.dispatchFetch(
        "https://managed-schema-analysis.invalid/",
      );
      return await response.json();
    } finally {
      this.owner.release(runtime);
    }
  }
}

async function durableCounts(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
) {
  const result = await fixture.target.query<{
    commits: string;
    outcomes: string;
    feed: string;
    outbox: string;
  }>(`select
    (select count(*)::text from fx_system_commit) as commits,
    (select count(*)::text from fx_system_idempotency) as outcomes,
    (select count(*)::text from fx_system_commit_app_row_change) as feed,
    (select count(*)::text from fx_system_outbox) as outbox`);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Cooking durable counts are missing.");
  return Object.freeze({
    commits: Number(row.commits),
    outcomes: Number(row.outcomes),
    feed: Number(row.feed),
    outbox: Number(row.outbox),
  });
}

function isCookingRecipe(value: unknown): value is Readonly<{
  readonly name: string;
  readonly description?: string;
}> {
  if (value === null || typeof value !== "object") return false;
  const name = Reflect.get(value, "name");
  const description = Reflect.get(value, "description");
  return typeof name === "string" &&
    (description === undefined || typeof description === "string");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  ))]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}
