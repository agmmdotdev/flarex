import { DurableObject } from "cloudflare:workers";
import { Cause, Effect, Exit, Schema } from "effect";
import { makeApplicationAnalysisR2SourceReader } from "flarex-backend/internal/application-analysis-source-reader";
import { makeSourceArtifactV2AttemptStore } from "flarex-backend/internal/source-artifact-upload-attempt-store";
import { makeSourceArtifactV2R2Store } from "flarex-backend/internal/source-artifact-r2-store";
import { makeLiveSourceArtifactV2Sha256 } from "flarex-backend/internal/source-artifact-sha256";
import { makeSourceArtifactV2UploadCore, type SourceArtifactV2UploadReceipt } from "flarex-backend/internal/source-artifact-upload";
import { initializeDeploymentStorage } from "flarex-backend/internal/deployment-storage";
import type { ApplicationDurableObjectEnv } from "../../src/applicationDO";
const UploadRequestSchema = Schema.Struct({
  modules: Schema.Array(Schema.Struct({ path: Schema.String, roles: Schema.Int, source: Schema.String }))
    .check(Schema.isMinLength(1), Schema.isMaxLength(8)),
});
const decodeUpload = Schema.decodeUnknownEffect(Schema.fromJsonString(UploadRequestSchema));
const uploadAdmission = { calls: 1, blockBytes: 131_072, modules: 1, sourceMaps: 0,
  canonicalBytes: 1_048_576, frameBytes: 1_048_576, hashBytes: 1_048_576, timeMilliseconds: 1_000 };
// The real upload owner reserves a whole admission per command. The finite
// fixture permits eight modules: begin + three commands per module + finalize.
const uploadCommands = 2 + 3 * 8;
const uploadBudget = { calls: uploadCommands * uploadAdmission.calls,
  blockBytes: uploadCommands * uploadAdmission.blockBytes, modules: uploadCommands * uploadAdmission.modules,
  sourceMaps: 0, canonicalBytes: uploadCommands * uploadAdmission.canonicalBytes,
  frameBytes: uploadCommands * uploadAdmission.frameBytes, hashBytes: uploadCommands * uploadAdmission.hashBytes,
  timeMilliseconds: uploadCommands * uploadAdmission.timeMilliseconds };

export class ApplicationSourceUploadDO extends DurableObject<ApplicationDurableObjectEnv> {
  constructor(ctx: DurableObjectState, env: ApplicationDurableObjectEnv) {
    super(ctx, env);
    initializeDeploymentStorage(ctx.storage.sql);
  }
  override async fetch(request: Request): Promise<Response> {
    const operation = Effect.gen({ self: this }, function* () {
      const text = yield* readFixtureText(request, 1_048_576);
      const input = yield* decodeUpload(text);
      const sha256 = makeLiveSourceArtifactV2Sha256();
      const core = makeSourceArtifactV2UploadCore({ deploymentId: "application-do-source-fixture",
        attempts: makeSourceArtifactV2AttemptStore(this.ctx.storage, this.ctx.storage.sql),
        objects: makeSourceArtifactV2R2Store(this.env.ARTIFACTS, sha256), sha256 });
      const uploadId = crypto.randomUUID();
      let receipt = yield* core.beginUpload({ uploadId, commandId: `${uploadId}:begin`,
        ceilings: uploadBudget, admission: uploadAdmission });
      const command = (current: SourceArtifactV2UploadReceipt, suffix: string) => ({
        uploadId, generation: current.generation, expectedFence: current.mutationFence,
        commandId: `${uploadId}:${suffix}`, admission: uploadAdmission,
      });
      for (const [index, module] of [...input.modules].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).entries()) {
        receipt = yield* core.beginModule({ ...command(receipt, `${index}:begin`),
          path: module.path, roles: module.roles, environment: "isolate" });
        receipt = yield* core.appendBlock({ ...command(receipt, `${index}:block`), kind: "source", blockIndex: 0,
          bytes: new TextEncoder().encode(module.source) });
        receipt = yield* core.closeModule(command(receipt, `${index}:close`));
      }
      receipt = yield* core.finalize(command(receipt, "finalize"));
      if (receipt.completedRootDigest === null) return yield* Effect.die(new Error("Finalized source has no root digest."));
      const source = yield* makeApplicationAnalysisR2SourceReader(this.env.ARTIFACTS).read(receipt.completedRootDigest);
      return Response.json({ source });
    });
    const outcome = await Effect.runPromiseExit(operation);
    if (Exit.isSuccess(outcome)) return outcome.value;
    return Response.json({ error: "source-upload-failed", cause: Cause.pretty(outcome.cause),
      failures: outcome.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error),
      defects: outcome.cause.reasons.filter(Cause.isDieReason).map(reason =>
        reason.defect instanceof Error ? { message: reason.defect.message, stack: reason.defect.stack } : String(reason.defect)),
    }, { status: 500 });
  }
}

export const readFixtureText = Effect.fn("ApplicationDOFixture.readBody")((request: Request, maximum: number) =>
  Effect.tryPromise({
    try: async () => {
      if (request.body === null) return "";
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > maximum) {
            await reader.cancel("fixture-request-too-large");
            throw new Error("fixture-request-too-large");
          }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder("utf-8", { fatal: true }).decode(body);
    },
    catch: cause => cause,
  }));
