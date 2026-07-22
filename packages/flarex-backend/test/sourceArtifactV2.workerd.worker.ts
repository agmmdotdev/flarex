import { DurableObject } from "cloudflare:workers";
import { Effect, Exit } from "effect";
import {
  makeSourceArtifactV2AttemptReader,
  makeSourceArtifactV2AttemptStore,
} from "../src/sourceArtifactV2/AttemptStore";
import {
  isSourceArtifactV2FinalizedAttemptReadRequestV1,
  makeSourceArtifactV2FinalizedAttemptReadRouteV1,
} from "../src/sourceArtifactV2/FinalizedAttemptReadBoundary";
import { makeSourceArtifactV2R2Store } from "../src/sourceArtifactV2/R2Store";
import { makeLiveSourceArtifactV2Sha256 } from "../src/sourceArtifactV2/Sha256";
import { makeSourceArtifactV2UploadCore } from "../src/sourceArtifactV2/UploadCore";
import { initializeDeploymentStorage } from "../src/deployment/StorageSchema";

interface TestEnv {
  readonly UPLOADS: DurableObjectNamespace;
  readonly ARTIFACTS: R2Bucket;
}

export class SourceArtifactUploadTestDO extends DurableObject<TestEnv> {
  private readonly sha = makeLiveSourceArtifactV2Sha256();
  private readonly attempts = makeSourceArtifactV2AttemptStore(
    this.ctx.storage,
    this.ctx.storage.sql,
  );
  private readonly core = makeSourceArtifactV2UploadCore({
    deploymentId: "deployment-source-v2",
    attempts: this.attempts,
    objects: makeSourceArtifactV2R2Store(this.env.ARTIFACTS, this.sha),
    sha256: this.sha,
  });
  private readonly finalizedAttemptRead = makeSourceArtifactV2FinalizedAttemptReadRouteV1({
    durableObjectName: this.ctx.id.name,
    reader: makeSourceArtifactV2AttemptReader(this.ctx.storage.sql),
    sha256: this.sha,
  });

  constructor(ctx: DurableObjectState, env: TestEnv) {
    super(ctx, env);
    initializeDeploymentStorage(this.ctx.storage.sql);
  }

  async fetch(request: Request): Promise<Response> {
    if (isSourceArtifactV2FinalizedAttemptReadRequestV1(request)) {
      return await Effect.runPromise(this.finalizedAttemptRead.route(request));
    }
    const body: unknown = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "invalid body" }, { status: 400 });
    }
    const requestedOperation = Reflect.get(body, "operation");
    const input = Reflect.get(body, "input");
    if (requestedOperation === "corruptModuleFrontier") {
      const uploadId = field(input, "uploadId");
      if (typeof uploadId !== "string") {
        return Response.json({ error: "invalid upload id" }, { status: 400 });
      }
      this.ctx.storage.sql.exec(`
        UPDATE source_artifact_upload_attempts_v2
        SET module_frontier_json = '[]'
        WHERE upload_id = ?
      `, uploadId);
      return Response.json({ success: { corrupted: true } });
    }
    const lossyCore = requestedOperation === "beginUploadCommittedResponseLoss"
      ? makeSourceArtifactV2UploadCore({
        deploymentId: "deployment-source-v2",
        attempts: makeSourceArtifactV2AttemptStore({
          transaction: async <T>(closure: () => Promise<T>): Promise<T> => {
            await this.ctx.storage.transaction(closure);
            throw new DOMException("injected committed response loss", "NetworkError");
          },
        }, this.ctx.storage.sql),
        objects: makeSourceArtifactV2R2Store(this.env.ARTIFACTS, this.sha),
        sha256: this.sha,
      })
      : null;
    const freshCore = requestedOperation === "freshFinalize"
      ? makeSourceArtifactV2UploadCore({
        deploymentId: "deployment-source-v2",
        attempts: makeSourceArtifactV2AttemptStore(this.ctx.storage, this.ctx.storage.sql),
        objects: makeSourceArtifactV2R2Store(this.env.ARTIFACTS, this.sha),
        sha256: this.sha,
      })
      : null;
    const core = lossyCore ?? freshCore ?? this.core;
    const operation = requestedOperation === "beginUploadCommittedResponseLoss"
      ? "beginUpload"
      : requestedOperation === "freshFinalize"
      ? "finalize"
      : requestedOperation;
    const effect = operation === "beginUpload" ? core.beginUpload(beginInput(input))
      : operation === "beginModule" ? core.beginModule(moduleInput(input))
      : operation === "appendBlock" ? core.appendBlock(blockInput(input))
      : operation === "closeModule" ? core.closeModule(commandInput(input))
      : operation === "finalize" ? core.finalize(commandInput(input))
      : operation === "reopen" ? core.reopen(commandInput(input))
      : operation === "abandon" ? core.abandon(commandInput(input))
      : undefined;
    if (effect === undefined) return Response.json({ error: "invalid operation" }, { status: 400 });
    const exit = await Effect.runPromiseExit(effect);
    return Exit.isSuccess(exit)
      ? Response.json({ success: exit.value })
      : Response.json({ failure: String(exit.cause) }, { status: 409 });
  }
}

function field(value: unknown, name: string): unknown {
  return value === null || typeof value !== "object" || Array.isArray(value)
    ? undefined
    : Reflect.get(value, name);
}

function beginInput(value: unknown) {
  return {
    uploadId: field(value, "uploadId"),
    commandId: field(value, "commandId"),
    ceilings: field(value, "ceilings"),
    admission: field(value, "admission"),
  };
}

function commandInput(value: unknown) {
  return {
    uploadId: field(value, "uploadId"),
    generation: field(value, "generation"),
    expectedFence: field(value, "expectedFence"),
    commandId: field(value, "commandId"),
    admission: field(value, "admission"),
  };
}

function moduleInput(value: unknown) {
  return {
    ...commandInput(value),
    path: field(value, "path"),
    roles: field(value, "roles"),
    environment: field(value, "environment"),
  };
}

function blockInput(value: unknown) {
  const bytes = field(value, "bytes");
  return {
    ...commandInput(value),
    kind: field(value, "kind"),
    blockIndex: field(value, "blockIndex"),
    bytes: Array.isArray(bytes) ? Uint8Array.from(bytes) : bytes,
  };
}

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    const stub = env.UPLOADS.get(env.UPLOADS.idFromName("deployment:deployment-source-v2"));
    return await stub.fetch(request);
  },
};
