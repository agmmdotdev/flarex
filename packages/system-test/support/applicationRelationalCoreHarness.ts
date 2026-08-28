/// <reference types="@cloudflare/workers-types" />

import {
  createApplicationRelationalCorePGliteSystemTestFixture,
  type ApplicationRelationalCoreSystemTestFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-relation-query-fixture";
import {
  createCommitFeedRepositoryV1,
} from "@flarex/persistence-postgres/internal/commit-feed";
import {
  ApplicationRelationQuerySystem,
  makeApplicationRelationQuerySystemLayer,
} from
  "@flarex/standard-application-invocation/internal/application-relation-query-system";
import {
  ApplicationMutationSystem,
  invokeApplicationMutation,
  makeApplicationMutationSystemLayer,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  prepareStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { Effect, Result, Scope } from "effect";
import {
  APPLICATION_RUNTIME_COMPATIBILITY_DATE,
  APPLICATION_RUNTIME_HOST_IDENTITY,
} from "flarex-backend/artifact-runtime";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  APPLICATION_WORKER_RESULT_FORMAT_V1,
  APPLICATION_WORKER_RESULT_VERSION_V1,
} from "flarex-protocol/internal/application-worker-v1";
import { decodeAppDocumentIdentityV1 } from
  "flarex-protocol/app-document-id";
import {
  CommitSeqSchema,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";

import {
  makeApplicationMutationTestLive,
} from "./applicationNativeMutationHarness";
import { createMigratedSplitPGlitePersistence } from
  "../test/support/databaseFixturesV1";
import {
  makeStandardApplicationCurrentAnalysisV1,
  MiniflareApplicationAnalysisWorkerLoader,
  produceStandardApplicationCurrentRelationSourceBundleV1,
} from "./standardApplicationCurrentAnalysisHarness";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

const MUTATION_PATH = TransactionFunctionPathV1Schema.make("relations:mutate");

export interface ApplicationRelationalCoreProof {
  readonly analysisWorkerLoads: number;
  readonly missingRelationPortWorkerLoads: number;
  readonly missingRelationPortFailedClosed: boolean;
  readonly mutationWorkerLoads: number;
  readonly commits: ReadonlyArray<Readonly<{
    readonly commitSeq: bigint;
    readonly relationAdjacencyChanges: ReadonlyArray<Readonly<{
      readonly ordinal: number;
      readonly edgeDefinitionId: number;
      readonly direction: "incoming" | "outgoing";
      readonly endpointRowId: string;
    }>>;
  }>>;
  readonly edgeDefinitionId: number;
  readonly postDocumentId: string;
  readonly targetDocumentIds: ReadonlyArray<string>;
  readonly incomingSourceDocumentIds: ReadonlyArray<string>;
  readonly finalIncomingSourceDocumentIds: ReadonlyArray<string>;
  readonly edgePositions: ReadonlyArray<number | null>;
  readonly sourceRelationHistory: ReadonlyArray<Readonly<{
    readonly commitSeq: bigint;
    readonly authors: ReadonlyArray<string>;
  }>>;
  readonly adjacencyVersions: ReadonlyArray<Readonly<{
    readonly direction: string;
    readonly lastChangedCommitSeq: bigint;
  }>>;
  readonly targetDeleteWasRestricted: boolean;
}

export function expectedApplicationRelationalCoreCommits(
  proof: Pick<
    ApplicationRelationalCoreProof,
    "edgeDefinitionId" | "postDocumentId" | "targetDocumentIds"
  >,
): ApplicationRelationalCoreProof["commits"] {
  const post = decodeAppDocumentIdentityV1(proof.postDocumentId).rowId;
  const [targetA, targetB, targetC] = proof.targetDocumentIds.map(
    documentId => decodeAppDocumentIdentityV1(documentId).rowId,
  );
  if (targetA === undefined || targetB === undefined || targetC === undefined) {
    throw new Error("Relational-core proof did not return three targets.");
  }
  const incoming = (...endpointRowIds: ReadonlyArray<string>) =>
    endpointRowIds.toSorted().map((endpointRowId, index) => Object.freeze({
      ordinal: index + 1,
      edgeDefinitionId: proof.edgeDefinitionId,
      direction: "incoming" as const,
      endpointRowId,
    }));
  const changes = (...endpointRowIds: ReadonlyArray<string>) => Object.freeze([
    Object.freeze({
      ordinal: 0,
      edgeDefinitionId: proof.edgeDefinitionId,
      direction: "outgoing" as const,
      endpointRowId: post,
    }),
    ...incoming(...endpointRowIds),
  ]);
  return Object.freeze([
    { commitSeq: 1n, relationAdjacencyChanges: Object.freeze([]) },
    { commitSeq: 2n, relationAdjacencyChanges: Object.freeze([]) },
    { commitSeq: 3n, relationAdjacencyChanges: Object.freeze([]) },
    { commitSeq: 4n, relationAdjacencyChanges: changes(targetA, targetB) },
    { commitSeq: 5n, relationAdjacencyChanges: changes(targetA, targetB) },
    { commitSeq: 6n, relationAdjacencyChanges: changes(targetA) },
    { commitSeq: 7n, relationAdjacencyChanges: changes(targetB, targetC) },
    { commitSeq: 8n, relationAdjacencyChanges: changes(targetC) },
    { commitSeq: 9n, relationAdjacencyChanges: Object.freeze([]) },
  ]);
}

export async function proveApplicationRelationalCore(
  createFixture?: (
    analysis: Parameters<
      typeof createApplicationRelationalCorePGliteSystemTestFixture
    >[1],
  ) => Promise<ApplicationRelationalCoreSystemTestFixture>,
): Promise<ApplicationRelationalCoreProof> {
  const definition = Result.getOrThrow(
    prepareStandardApplicationDefinitionV1(applicationDefinitionInput()),
  );
  const source = await produceStandardApplicationCurrentRelationSourceBundleV1(
    definition,
    [relationDeclaration()],
  );
  const analysisLoader = new MiniflareApplicationAnalysisWorkerLoader();
  try {
    const analysis = makeStandardApplicationCurrentAnalysisV1(
      source,
      analysisLoader,
      "application-relational-core",
    );
    const relationalAnalysis = Object.freeze({
      ...analysis,
      runtimePolicy: Object.freeze({
        runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
        compatibilityDate: APPLICATION_RUNTIME_COMPATIBILITY_DATE,
      }),
    });
    const fixture = createFixture === undefined
      ? await createApplicationRelationalCorePGliteSystemTestFixture(
          await createMigratedSplitPGlitePersistence(),
          relationalAnalysis,
        )
      : await createFixture(relationalAnalysis);
    const mutationFixture = Object.freeze({
      deploymentId: fixture.deploymentId,
      control: fixture.control,
      activation: fixture.activation,
      schema: fixture.legacySchema,
      relationSchema: fixture.relationSchema,
      authorityPorts: fixture.authorityPorts,
      currentEpochAuthority: fixture.currentEpochAuthority,
      sessionAuthority: fixture.sessionAuthority,
      candidateSchemaWriteGuard: fixture.candidateSchemaWriteGuard,
      intrinsicCreationTimeIndexes: fixture.intrinsicCreationTimeIndexes,
      developerIndexes: fixture.developerIndexes,
      indexedQueries: fixture.indexedQueries,
      source: fixture.source,
    });
    const missingRelationPortLoader = new RelationalCoreWorkerLoader();
    const missingRelationPortLive = await makeApplicationMutationTestLive(
      mutationFixture,
      missingRelationPortLoader,
    );
    const missingRelationPortLayer = makeApplicationMutationSystemLayer(
      missingRelationPortLive,
    );
    const missingRelationPortInvoke = <Value, Failure>(effect: Effect.Effect<
      Value,
      Failure,
      ApplicationMutationSystem | Scope.Scope
    >) => runSystemTestEffectV1(
      Effect.scoped(effect.pipe(Effect.provide(missingRelationPortLayer))),
    );
    const missingRelationPortFailedClosed = await invokeMissingRelationPort(
      missingRelationPortInvoke,
    );
    const failedCommitState = await fixture.target.query<{
      app_rows: bigint;
      commits: bigint;
    }>(
      `select
         (select count(*) from fx_app_row_rev) as app_rows,
         (select count(*) from fx_system_commit) as commits`,
    );
    if (
      BigInt(failedCommitState.rows[0]?.app_rows ?? -1) !== 0n ||
      BigInt(failedCommitState.rows[0]?.commits ?? -1) !== 0n
    ) {
      throw new Error("Missing relation maintenance published durable state.");
    }
    const mutationLoader = new RelationalCoreWorkerLoader();
    const mutationLive = await makeApplicationMutationTestLive({
      ...mutationFixture,
      applicationRelations: fixture.applicationRelations,
    }, mutationLoader, { uuidSequenceStart: 100 });
    const mutationLayer = makeApplicationMutationSystemLayer(mutationLive);
    const invoke = <Value, Failure>(effect: Effect.Effect<
      Value,
      Failure,
      ApplicationMutationSystem | Scope.Scope
    >) => runSystemTestEffectV1(
      Effect.scoped(effect.pipe(Effect.provide(mutationLayer))),
    );
    const targetA = await invokeMutation(invoke, "createUser", {
      name: "Ada",
    }, 1);
    const targetB = await invokeMutation(invoke, "createUser", {
      name: "Grace",
    }, 2);
    const targetC = await invokeMutation(invoke, "createUser", {
      name: "Lin",
    }, 3);
    const postDocumentId = await invokeMutation(invoke, "createPost", {
      authors: [targetA, targetB],
    }, 4);
    await invokeMutation(invoke, "replacePost", {
      documentId: postDocumentId,
      authors: [targetB, targetA],
    }, 5);
    await invokeMutation(invoke, "replacePost", {
      documentId: postDocumentId,
      authors: [targetB],
    }, 6);
    await invokeMutation(invoke, "replacePost", {
      documentId: postDocumentId,
      authors: [targetC],
    }, 7);

    const queryLayer = makeApplicationRelationQuerySystemLayer({
      activation: fixture.activation,
      snapshot: fixture.snapshot,
    });
    const incoming = await queryIncomingRelationSources(
      queryLayer,
      fixture,
      targetC,
    );
    const targetDeleteWasRestricted = await invokeRestrictedTargetDelete(
      invoke,
      targetC,
      8,
    );
    await invokeMutation(invoke, "replacePost", {
      documentId: postDocumentId,
      authors: [],
    }, 9);
    await invokeMutation(invoke, "deleteDocument", {
      documentId: targetC,
    }, 10);
    const finalIncoming = await queryIncomingRelationSources(
      queryLayer,
      fixture,
      targetC,
    );
    const feed = await Effect.runPromise(
      createCommitFeedRepositoryV1(fixture.target.drizzle).listAfter({
        scopeUuid: projectScopeIdUuidV1(fixture.authority.scopeId).scopeUuid,
        exclusiveCommitSeq: CommitSeqSchema.make(0n),
      }),
    );
    const edgeRows = await fixture.target.query<{ position: number | null }>(
      `select position
         from fx_app_edge_current
        order by position asc nulls last`,
    );
    const sourceRows = await fixture.target.query<{
      commit_seq: bigint;
      value_json: unknown;
    }>(
      `select commit_seq, value_json
         from fx_app_row_rev
        where value_json ? 'authors'
        order by commit_seq`,
    );
    const adjacencyRows = await fixture.target.query<{
      direction: string;
      last_changed_commit_seq: bigint;
    }>(
      `select direction, last_changed_commit_seq
         from fx_app_edge_adjacency_version
        order by direction, last_changed_commit_seq`,
    );
    return Object.freeze({
      analysisWorkerLoads: analysisLoader.loads,
      missingRelationPortWorkerLoads: missingRelationPortLoader.loads,
      missingRelationPortFailedClosed,
      mutationWorkerLoads: mutationLoader.loads,
      commits: Object.freeze(feed.commits.map(commit => Object.freeze({
        commitSeq: commit.commitSeq,
        relationAdjacencyChanges: Object.freeze(
          commit.relationAdjacencyChanges.map(change => Object.freeze({
            ordinal: change.ordinal,
            edgeDefinitionId: change.edgeDefinitionId,
            direction: change.direction,
            endpointRowId: change.endpointRowId,
          })),
        ),
      }))),
      edgeDefinitionId: fixture.edgeDefinitionId,
      postDocumentId,
      targetDocumentIds: Object.freeze([targetA, targetB, targetC]),
      incomingSourceDocumentIds: Object.freeze(
        incoming.sources.map(source => source.sourceDocumentId),
      ),
      finalIncomingSourceDocumentIds: Object.freeze(
        finalIncoming.sources.map(source => source.sourceDocumentId),
      ),
      edgePositions: Object.freeze(edgeRows.rows.map(row => row.position)),
      sourceRelationHistory: Object.freeze(sourceRows.rows.map(row => {
        const value = requireRecord(row.value_json);
        return Object.freeze({
          commitSeq: BigInt(row.commit_seq),
          authors: requireStringArray(Reflect.get(value, "authors")),
        });
      })),
      adjacencyVersions: Object.freeze(adjacencyRows.rows.map(row =>
        Object.freeze({
          direction: row.direction,
          lastChangedCommitSeq: BigInt(row.last_changed_commit_seq),
        })
      )),
      targetDeleteWasRestricted,
    });
  } finally {
    await analysisLoader.dispose();
  }
}

async function queryIncomingRelationSources(
  queryLayer: ReturnType<typeof makeApplicationRelationQuerySystemLayer>,
  fixture: ApplicationRelationalCoreSystemTestFixture,
  target: string,
) {
  return runSystemTestEffectV1(
    Effect.gen(function* () {
      const system = yield* ApplicationRelationQuerySystem;
      return yield* system.takeIncomingRelationSources({
        relation: fixture.relation,
        target,
        limit: 16,
      });
    }).pipe(Effect.provide(queryLayer)),
  );
}

async function invokeRestrictedTargetDelete(
  invoke: InvokeMutation,
  documentId: string,
  ordinal: number,
): Promise<boolean> {
  try {
    await invokeMutation(invoke, "deleteDocument", { documentId }, ordinal);
    return false;
  } catch (cause) {
    if (isNonArrayRecord(cause) &&
      Reflect.get(cause, "_tag") ===
        "ApplicationRelationTargetDeleteRestrictedError") return true;
    throw cause;
  }
}

async function invokeMissingRelationPort(invoke: InvokeMutation): Promise<boolean> {
  try {
    await invokeMutation(invoke, "createUser", { name: "Blocked" }, 0);
    return false;
  } catch (cause) {
    if (isNonArrayRecord(cause) && Reflect.get(cause, "_tag") ===
      "ApplicationRelationCommitUnavailableError" &&
      Reflect.get(cause, "reason") === "compositionMissing") return true;
    throw cause;
  }
}

type InvokeMutation = <Value, Failure>(effect: Effect.Effect<
  Value,
  Failure,
  ApplicationMutationSystem | Scope.Scope
>) => Promise<Value>;

async function invokeMutation(
  invoke: InvokeMutation,
  action: string,
  input: Readonly<Record<string, unknown>>,
  ordinal: number,
): Promise<string> {
  const outcome = await invoke(invokeApplicationMutation(
    MUTATION_PATH,
    { action, ...input },
    TransactionRequestKeyV1Schema.make(
      `application-relational-core:${ordinal}`,
    ),
  ));
  if (outcome.disposition !== "published" || typeof outcome.value !== "string") {
    throw new Error("Relational-core mutation did not publish a document id.");
  }
  return outcome.value;
}

class RelationalCoreWorkerLoader implements WorkerLoader {
  loads = 0;

  get(): WorkerStub {
    throw new Error("Relational-core proof forbids cached Worker loading.");
  }

  load(): WorkerStub {
    this.loads += 1;
    return new RelationalCoreWorkerStub();
  }
}

interface RelationalCoreJournalCapability {
  readonly insertPointDocument: (
    table: string,
    value: unknown,
  ) => Promise<unknown>;
  readonly replacePointDocument: (
    documentId: string,
    value: unknown,
  ) => Promise<void>;
  readonly deletePointDocument: (documentId: string) => Promise<void>;
}

class RelationalCoreWorkerStub implements WorkerStub {
  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(): Fetcher<T> {
    return {
      run: async (request: unknown, capability: unknown) => {
        const args = requireRecord(
          Reflect.get(requireRecord(request), "arguments"),
        );
        const action = Reflect.get(args, "action");
        const journal = requireJournal(capability);
        if (action === "createUser") {
          return rpcResult(await journal.insertPointDocument("users", {
            name: requireString(Reflect.get(args, "name")),
          }));
        }
        if (action === "createPost") {
          return rpcResult(await journal.insertPointDocument("posts", {
            authors: requireStringArray(Reflect.get(args, "authors")),
          }));
        }
        if (action === "replacePost") {
          const documentId = requireString(Reflect.get(args, "documentId"));
          await journal.replacePointDocument(documentId, {
            authors: requireStringArray(Reflect.get(args, "authors")),
          });
          return rpcResult(documentId);
        }
        if (action === "deleteDocument") {
          const documentId = requireString(Reflect.get(args, "documentId"));
          await journal.deletePointDocument(documentId);
          return rpcResult(documentId);
        }
        throw new Error("Relational-core Worker received an unknown action.");
      },
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Relational-core proof does not load Durable Objects.");
  }
}

function requireJournal(value: unknown): RelationalCoreJournalCapability {
  const record = requireRecord(value);
  const insert = Reflect.get(record, "insertPointDocument");
  const replace = Reflect.get(record, "replacePointDocument");
  const remove = Reflect.get(record, "deletePointDocument");
  if (typeof insert !== "function" || typeof replace !== "function" ||
    typeof remove !== "function") {
    throw new Error("Relational-core Worker received no journal capability.");
  }
  return Object.freeze({
    insertPointDocument: (table: string, document: unknown) => Reflect.apply(
      insert,
      value,
      [table, document],
    ) as Promise<unknown>,
    replacePointDocument: (documentId: string, document: unknown) => Reflect.apply(
      replace,
      value,
      [documentId, document],
    ) as Promise<void>,
    deletePointDocument: (documentId: string) => Reflect.apply(
      remove,
      value,
      [documentId],
    ) as Promise<void>,
  });
}

function requireRecord(value: unknown): Readonly<Record<PropertyKey, unknown>> {
  if (!isNonArrayRecord(value)) {
    throw new Error("Relational-core Worker received an invalid record.");
  }
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Relational-core Worker received an invalid string.");
  }
  return value;
}

function requireStringArray(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value) || !value.every(member => typeof member === "string")) {
    throw new Error("Relational-core Worker received an invalid string array.");
  }
  return Object.freeze([...value]);
}

function rpcResult(value: unknown): object {
  const result = {
    format: APPLICATION_WORKER_RESULT_FORMAT_V1,
    version: APPLICATION_WORKER_RESULT_VERSION_V1,
    value,
  };
  Object.defineProperty(result, Symbol.dispose, { value: () => undefined });
  return result;
}

function relationDeclaration() {
  return {
    format: "flarex.relation-declaration",
    version: 1,
    source: {
      table: "posts",
      path: [{ kind: "field", name: "authors" }],
      forwardName: "authors",
    },
    target: { table: "users" },
    value: {
      cardinality: "many",
      minItems: 0,
      maxItems: 16,
      ordered: true,
      duplicates: "forbid",
    },
    inverse: { cardinality: "many", name: "posts" },
    localized: false,
    onTargetDelete: "restrict",
  };
}

function applicationDefinitionInput() {
  const handler = new TextEncoder().encode(
    "export async function mutate() { return null; }\n",
  );
  return {
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 64,
      maximumValidatorDepth: 8,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: {
        tables: [{
          logicalName: "posts",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                authors: {
                  fieldType: {
                    type: "array",
                    value: { type: "id", tableName: "users" },
                  },
                  optional: false,
                },
              },
            },
          },
        }, {
          logicalName: "users",
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
              },
            },
          },
        }],
        indexes: [],
      },
      modules: [{
        modulePath: "relations",
        functions: [{
          exportName: "mutate",
          kind: "mutation",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: null,
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
      maximumEntryBindings: 1,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 32_768,
      maximumSemanticRecords: 64,
      maximumSemanticRecordBytes: 8_192,
      maximumSemanticStreamBytes: 32_768,
    },
    graphInput: {
      modules: [{
        path: "functions/relations.js",
        roles: ["function", "execution"],
        sourceBytes: handler,
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "relations",
        artifactModulePath: "functions/relations.js",
      }],
      executionPath: "functions/relations.js",
      schemaPath: null,
      authPath: null,
    },
  } as const;
}
