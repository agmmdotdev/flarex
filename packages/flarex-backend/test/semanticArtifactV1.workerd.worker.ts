import { DurableObject } from "cloudflare:workers";
import {
  encodeDeclarativeV2SemanticArtifactFrameV1,
} from "flarex-protocol/internal/declarative-v2-semantic-artifact-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Exit, Result } from "effect";
import { initializeDeploymentStorage } from "../src/deployment/StorageSchema";
import {
  makeSemanticArtifactV1AttemptStore,
  type SemanticArtifactV1Attempt,
} from "../src/semanticArtifactV1/AttemptStore";
import { makeSemanticArtifactV1R2Store } from "../src/semanticArtifactV1/R2Store";
import { makeLiveSemanticArtifactV1Sha256 } from "../src/semanticArtifactV1/Sha256";
import {
  makeSemanticArtifactV1SourceCorrelationReader,
} from "../src/semanticArtifactV1/SourceCorrelationReader";

interface Env {
  readonly SEMANTIC: DurableObjectNamespace;
  readonly ARTIFACTS: R2Bucket;
}

export class SemanticArtifactTestDO extends DurableObject<Env> {
  private readonly sha256 = makeLiveSemanticArtifactV1Sha256();
  private readonly store = makeSemanticArtifactV1AttemptStore(
    this.ctx.storage,
    this.ctx.storage.sql,
  );
  private readonly r2 = makeSemanticArtifactV1R2Store(this.env.ARTIFACTS, this.sha256);
  private readonly sourceReader = makeSemanticArtifactV1SourceCorrelationReader(
    this.ctx.storage.sql,
  );

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeDeploymentStorage(this.ctx.storage.sql);
  }

  async fetch(request: Request): Promise<Response> {
    const body = await request.json() as { readonly operation?: unknown };
    if (body.operation === "roundtrip") {
      return Response.json(await Effect.runPromise(this.roundtrip()));
    }
    if (body.operation === "corrupt") {
      this.ctx.storage.sql.exec(`
        UPDATE semantic_artifact_upload_attempts_v1
        SET project_id = 'other'
        WHERE semantic_upload_id = 'semantic-upload'
      `);
      const exit = await Effect.runPromiseExit(this.store.read("semantic-upload", {
        maximumCalls: 2,
        maximumStoredBytes: 100_000,
      }));
      return Response.json({ failed: Exit.isFailure(exit) });
    }
    if (body.operation === "budget") {
      const storedBytes = this.ctx.storage.sql.exec<{
        readonly stored_byte_length: number;
      }>(`
        SELECT
          length(CAST(semantic_upload_id AS BLOB)) +
          length(CAST(state AS BLOB)) +
          length(CAST(attempt_frame_hex AS BLOB)) +
          length(CAST(attempt_sha256 AS BLOB)) +
          length(CAST(project_id AS BLOB)) +
          length(CAST(deployment_id AS BLOB)) +
          length(CAST(deployment_created_at AS BLOB)) +
          length(CAST(source_upload_id AS BLOB)) +
          length(CAST(source_root_sha256 AS BLOB)) +
          length(CAST(source_selector_sha256 AS BLOB)) +
          length(CAST(tree_frontier_json AS BLOB)) +
          length(CAST(ceilings_json AS BLOB)) +
          length(CAST(usage_json AS BLOB)) +
          COALESCE(length(CAST(pending_command_json AS BLOB)), 0) +
          length(CAST(last_command_id AS BLOB)) +
          length(CAST(last_command_digest AS BLOB)) +
          length(CAST(last_receipt_json AS BLOB)) +
          COALESCE(length(CAST(last_block_digest AS BLOB)), 0) +
          COALESCE(length(CAST(completed_root_digest AS BLOB)), 0) +
          COALESCE(length(CAST(completed_selector_digest AS BLOB)), 0)
            AS stored_byte_length
        FROM semantic_artifact_upload_attempts_v1
        WHERE semantic_upload_id = 'semantic-upload'
      `).toArray()[0]!.stored_byte_length;
      const exact = await Effect.runPromiseExit(this.store.read("semantic-upload", {
        maximumCalls: 2,
        maximumStoredBytes: storedBytes,
      }));
      const oneLess = await Effect.runPromiseExit(this.store.read("semantic-upload", {
        maximumCalls: 2,
        maximumStoredBytes: storedBytes - 1,
      }));
      const current = await Effect.runPromise(this.store.read("semantic-upload", {
        maximumCalls: 2,
        maximumStoredBytes: storedBytes,
      }));
      if (current === null) throw new Error("Semantic attempt missing.");
      const exactWrite = await Effect.runPromiseExit(this.store.write({
        semanticUploadId: current.semanticUploadId,
        commandId: "turn1",
        commandDigest: current.lastCommandDigest,
        expectedFence: current.mutationFence,
        readBudget: {
          maximumCalls: 7,
          maximumStoredBytes: storedBytes,
        },
        next: Object.freeze({ ...current, lastCommandId: "turn1" }),
      }));
      const oneLessWrite = await Effect.runPromiseExit(this.store.write({
        semanticUploadId: current.semanticUploadId,
        commandId: "turn2",
        commandDigest: current.lastCommandDigest,
        expectedFence: current.mutationFence,
        readBudget: {
          maximumCalls: 7,
          maximumStoredBytes: storedBytes - 1,
        },
        next: Object.freeze({ ...current, lastCommandId: "turn2" }),
      }));
      return Response.json({
        storedBytes,
        exact: Exit.isSuccess(exact),
        oneLess: Exit.isFailure(oneLess),
        exactWrite: Exit.isSuccess(exactWrite),
        oneLessWrite: Exit.isFailure(oneLessWrite),
      });
    }
    if (body.operation === "source") {
      seedFinalizedSource(this.ctx.storage.sql);
      const storedBytes = "source-upload".length + "finalized".length + 64 + 64;
      const exact = await Effect.runPromiseExit(this.sourceReader.read("source-upload", {
        maximumCalls: 2,
        maximumStoredBytes: storedBytes,
      }));
      const oneLess = await Effect.runPromiseExit(this.sourceReader.read("source-upload", {
        maximumCalls: 2,
        maximumStoredBytes: storedBytes - 1,
      }));
      return Response.json({
        exact: Exit.isSuccess(exact),
        oneLess: Exit.isFailure(oneLess),
      });
    }
    if (body.operation === "schema") {
      const table = this.ctx.storage.sql.exec<{ readonly name: string }>(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'semantic_artifact_upload_attempts_v1'
      `).toArray();
      const foreignKeys = this.ctx.storage.sql.exec<{
        readonly table: string;
        readonly on_delete: string;
      }>("PRAGMA foreign_key_list(semantic_artifact_upload_attempts_v1)").toArray();
      return Response.json({ table, foreignKeys });
    }
    if (body.operation === "upgrade") {
      this.ctx.storage.sql.exec("DROP TABLE semantic_artifact_upload_attempts_v1");
      this.ctx.storage.sql.exec(
        "DELETE FROM meta WHERE key = 'semantic_artifact_upload_v1_schema_version'",
      );
      initializeDeploymentStorage(this.ctx.storage.sql);
      const version = this.ctx.storage.sql.exec<{ readonly value: string }>(`
        SELECT value FROM meta
        WHERE key = 'semantic_artifact_upload_v1_schema_version'
      `).toArray()[0]?.value;
      return Response.json({ version });
    }
    return new Response("not found", { status: 404 });
  }

  private roundtrip() {
    const sql = this.ctx.storage.sql;
    const sha256 = this.sha256;
    const store = this.store;
    const r2 = this.r2;
    return Effect.gen(function* () {
      seedFinalizedSource(sql);
      const frame = success(encodeDeclarativeV2SemanticArtifactFrameV1({
        kind: "semantic_attempt",
        projectId: "project",
        deploymentId: "deployment",
        deploymentCreatedAt: "2026-07-24T00:00:00.000Z",
        semanticUploadId: "semantic-upload",
        sourceArtifactCodecVersion: 1,
        sourceUploadId: "source-upload",
        sourceGeneration: 1n,
        sourceMutationFence: 2n,
        sourceRootSha256: new Uint8Array(32).fill(1),
        sourceSelectorSha256: new Uint8Array(32).fill(2),
        semanticArtifactCodecVersion: 1,
        semanticGeneration: 1n,
        semanticMutationFence: 0n,
        semanticModelIdentity: "model-v1",
        semanticCodecIdentity: "codec-v1",
        semanticPolicyIdentity: "policy-v1",
        semanticIngressProtocolIdentity: "ingress-v1",
        semanticIngressConfigurationIdentity: "config-v1",
        ceilingsSha256: new Uint8Array(32).fill(3),
      }, { maximumFrameBytes: 10_000, maximumCanonicalBytes: 10_000 }));
      const attemptDigest = yield* sha256(frame.canonicalBytes, {
        maximumInputBytes: 10_000,
      });
      const attempt: SemanticArtifactV1Attempt = Object.freeze({
        semanticUploadId: "semantic-upload",
        generation: 1,
        mutationFence: 0,
        state: "open",
        attemptFrameBytes: frame.canonicalBytes,
        attemptCanonicalByteLength: frame.usage.canonicalBytes,
        attemptSha256: encodeBytesToLowercaseHex(attemptDigest),
        projectId: "project",
        deploymentId: "deployment",
        deploymentCreatedAt: "2026-07-24T00:00:00.000Z",
        sourceUploadId: "source-upload",
        sourceGeneration: 1,
        sourceMutationFence: 2,
        sourceRootSha256: "01".repeat(32),
        sourceSelectorSha256: "02".repeat(32),
        nextBlockOrdinal: 0,
        streamByteLength: 0,
        lineFeedCount: 0,
        lastBlockDigest: null,
        lastBlockFrameByteLength: null,
        frontier: Object.freeze([]),
        ceilings: budget(),
        usage: budget(0),
        pendingCommand: null,
        lastCommandId: "begin",
        lastCommandDigest: encodeBytesToLowercaseHex(attemptDigest),
        lastReceipt: Object.freeze({ operation: "begin" }),
        completedRootDigest: null,
        completedSelectorDigest: null,
      });
      const stored = yield* store.write({
        semanticUploadId: attempt.semanticUploadId,
        commandId: "begin",
        commandDigest: attempt.attemptSha256,
        expectedFence: null,
        readBudget: {
          maximumCalls: 6,
          maximumStoredBytes: 100_000,
        },
        next: attempt,
      });
      const blockBytes = new TextEncoder().encode("semantic bytes\n");
      const blockDigest = yield* sha256(blockBytes, { maximumInputBytes: 10_000 });
      const object = yield* r2.putImmutable("block", blockDigest, blockBytes, {
        maximumCalls: 10,
        maximumBodyBytes: 10_000,
        maximumHashBytes: 10_000,
      });
      const reread = yield* r2.readImmutable("block", blockDigest, {
        maximumCalls: 10,
        maximumBodyBytes: 10_000,
        maximumHashBytes: 10_000,
      });
      return {
        semanticUploadId: stored.semanticUploadId,
        objectKey: object.key,
        body: new TextDecoder().decode(reread.bytes),
      };
    });
  }
}

function seedFinalizedSource(sql: DurableObjectStorage["sql"]): void {
  sql.exec(`
    INSERT OR IGNORE INTO source_artifact_upload_attempts_v2 (
      upload_id, generation, mutation_fence, state, next_module_ordinal,
      last_module_path, current_module_json, module_frontier_json, counters_json,
      ceilings_json, usage_json, pending_command_json, last_command_id,
      last_command_digest, last_receipt_json, completed_root_digest,
      completed_selector_digest
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  "source-upload", 1, 2, "finalized", 0, null, null, "[]",
  JSON.stringify({
    moduleCount: 0,
    functionModuleCount: 0,
    sourceByteLength: 0,
    sourceMapByteLength: 0,
    executionPath: null,
    schemaPath: null,
    authPath: null,
  }),
  JSON.stringify({
    calls: 10,
    blockBytes: 10,
    modules: 10,
    sourceMaps: 10,
    canonicalBytes: 10,
    frameBytes: 10,
    hashBytes: 10,
    timeMilliseconds: 10,
  }),
  JSON.stringify({
    calls: 1,
    blockBytes: 0,
    modules: 0,
    sourceMaps: 0,
    canonicalBytes: 0,
    frameBytes: 0,
    hashBytes: 0,
    timeMilliseconds: 0,
  }),
  null, "finalize", "04".repeat(32), "{}", "01".repeat(32), "02".repeat(32));
}

function budget(value = 10_000) {
  return {
    calls: value,
    blockBytes: value,
    canonicalBytes: value,
    frameBytes: value,
    hashBytes: value,
    timeMilliseconds: value,
  };
}

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const stub = env.SEMANTIC.get(env.SEMANTIC.idFromName("semantic-test"));
    return await stub.fetch(request);
  },
};
