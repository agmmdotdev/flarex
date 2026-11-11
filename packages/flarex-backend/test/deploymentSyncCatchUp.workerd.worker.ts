import { DeploymentSyncDO as RuntimeDeploymentSyncDO } from "../src/deploymentSyncDO";
import { runDeploymentSyncCatchUpProbe } from "../src/deploymentSync/CatchUpProbe";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";

export class DeploymentSyncDO extends RuntimeDeploymentSyncDO {
  async probeInterruptedBodyCause(request: unknown) {
    const owner = this;
    const executor = this.env.FLAREX_EXECUTOR;
    const probeToken = this.env.FLAREX_QUERY_SYNC_PROBE_TOKEN;
    const executorToken = this.env.FLAREX_EXECUTOR_TOKEN;
    if (executor === undefined || probeToken === undefined || executorToken === undefined)
      throw new Error("The test requires its executor binding and private tokens");
    return await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const reading = yield* Deferred.make<void>();
      const cancelFailure = new Error("test source body cancellation failed");
      const body = new ReadableStream<Uint8Array>({
        pull() { Deferred.doneUnsafe(reading, Effect.void); },
        cancel() { return Promise.reject(cancelFailure); },
      }, { highWaterMark: 0 });
      const work = yield* Effect.forkChild(runDeploymentSyncCatchUpProbe({ request,
        objectId: owner.ctx.id, storage: owner.ctx.storage,
        env: { FLAREX_QUERY_SYNC_PROBE_TOKEN: probeToken,
          FLAREX_EXECUTOR_TOKEN: executorToken,
          FLAREX_EXECUTOR: { fetch: () => Promise.resolve(new Response(body)), connect: executor.connect.bind(executor) } },
      }));
      yield* Deferred.await(reading);
      yield* Fiber.interrupt(work);
      const result = yield* Fiber.await(work);
      if (Exit.isSuccess(result)) return { failed: false, value: result.value };
      return { failed: true, interrupted: Cause.hasInterrupts(result.cause),
        cleanupFailure: result.cause.reasons.some(reason => Cause.isFailReason(reason)
          && reason.error._tag === "CheckpointError" && reason.error.reason === "sourceUnavailable"
          && reason.error.cause === cancelFailure) };
    })));
  }
  corruptCheckpoint(kind: "position" | "empty" | "catalog"): void {
    if (kind === "position") this.ctx.storage.sql.exec("UPDATE flarex_query_checkpoint SET position = '01'");
    else if (kind === "empty") this.ctx.storage.sql.exec("DELETE FROM flarex_query_checkpoint");
    else this.ctx.storage.sql.exec("CREATE TABLE foreign_checkpoint_state (id INTEGER)");
  }
}
interface TestEnv { readonly DEPLOYMENT_SYNCS: DurableObjectNamespace<DeploymentSyncDO> }
export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    const input: unknown = await request.json();
    if (!isRecord(input) || typeof input.objectName !== "string") return new Response(null, { status: 400 });
    const stub = env.DEPLOYMENT_SYNCS.getByName(input.objectName);
    if (input.operation === "probeInterruptedBodyCause")
      return Response.json(await stub.probeInterruptedBodyCause(input.request));
    if (input.corrupt === "position" || input.corrupt === "empty" || input.corrupt === "catalog") {
      await stub.corruptCheckpoint(input.corrupt);
      return Response.json({ ok: true });
    }
    return Response.json(await stub.runCatchUpProbe(input.request));
  },
};
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
