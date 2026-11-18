import { DurableObject } from "cloudflare:workers";
import { Cause, Effect, Exit, Schema } from "effect";
import { makePublicApplicationSourceProducer, publicApplicationSourcePackageMetadata,
  PublicApplicationSourcePolicySchema } from "../src/sourceArtifactV2/PublicApplicationSource";
import type { SourceArtifactV2TransactionStorage } from "../src/sourceArtifactV2/AttemptStore";
import type { SourceArtifactV2R2Bucket } from "../src/sourceArtifactV2/R2Store";
import { decodeCoreApplicationSourcePackageEffect } from "flarex-protocol/deployment";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";

interface Env { ARTIFACTS: R2Bucket; SOURCES: DurableObjectNamespace<PublicApplicationSourceDO> }
const Input = Schema.Struct({ policy: PublicApplicationSourcePolicySchema, sourcePackage: Schema.Unknown,
  loseWrite: Schema.optionalKey(Schema.Int), loseObject: Schema.optionalKey(Schema.String),
  replaceRoot: Schema.optionalKey(Schema.Struct({ from: Schema.String, to: Schema.String })) });
const decodeInput = Schema.decodeUnknownEffect(Input);

export class PublicApplicationSourceDO extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    let objectWrites = 0;
    const exit = await Effect.runPromiseExit(Effect.gen({ self: this }, function* () {
      const input = yield* decodeInput(yield* Effect.tryPromise({ try: (): Promise<unknown> => request.json(), catch: cause => cause }));
      const sourcePackage = yield* decodeCoreApplicationSourcePackageEffect(input.sourcePackage);
      if (input.replaceRoot !== undefined) this.ctx.storage.sql.exec(
        "UPDATE source_artifact_upload_attempts_v2 SET completed_root_digest=? WHERE completed_root_digest=?",
        input.replaceRoot.to, input.replaceRoot.from,
      );
      let writes = 0, objectLost = false, failedReconcile = false, loseObservation = false;
      const storage: SourceArtifactV2TransactionStorage = {
        transaction: async <T>(closure: () => Promise<T>) => {
          const value = await this.ctx.storage.transaction(closure);
          writes++;
          if (writes === input.loseWrite) {
            loseObservation = true;
            throw new Error("Test committed attempt acknowledgement lost");
          }
          return value;
        },
      };
      const sql = new Proxy(this.ctx.storage.sql, { get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (loseObservation && property === "exec" && typeof args[0] === "string" && args[0].trimStart().startsWith("SELECT")) {
            loseObservation = false;
            throw new Error("Test attempt reconciliation read unavailable");
          }
          return Reflect.apply(value, target, args);
        };
      } });
      const artifacts: SourceArtifactV2R2Bucket = {
        put: async (key, bytes, options) => {
          objectWrites++;
          const value = await this.env.ARTIFACTS.put(key, bytes, options);
          if (!objectLost && input.loseObject !== undefined && key.includes(`/${input.loseObject}/`)) {
            objectLost = true;
            throw new Error("Test R2 acknowledgement lost");
          }
          return value;
        },
        get: async key => {
          if (objectLost && !failedReconcile) {
            failedReconcile = true;
            throw new Error("Test R2 reconciliation read unavailable");
          }
          return this.env.ARTIFACTS.get(key);
        },
      };
      // Constructing anew on every request exercises persisted progress rather
      // than a producer's in-memory cursor.
      const result = yield* makePublicApplicationSourceProducer({ deploymentId: this.ctx.id.name ?? "source-proof",
        storage, sql, artifacts, policy: input.policy }).upload(sourcePackage);
      const metadata = publicApplicationSourcePackageMetadata(result.sourcePackage);
      const metadataRef = yield* Effect.tryPromise({ try: () => executionArtifactRefForSourcePackage(metadata), catch: cause => cause });
      return { ...result, metadata, metadataHash: metadataRef.sourcePackageHash,
        tables: this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%'").toArray() };
    }));
    if (Exit.isSuccess(exit)) return Response.json({ result: exit.value });
    return Response.json({ error: Cause.pretty(exit.cause),
      tables: this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%'").toArray(),
      objectWrites,
      reasons: exit.cause.reasons.map(reason =>
      Cause.isFailReason(reason) ? reason.error : "defect-or-interruption") }, { status: 409 });
  }
}

export default {
  fetch(request: Request, env: Env) {
    return env.SOURCES.getByName(new URL(request.url).pathname).fetch(request);
  },
} satisfies ExportedHandler<Env>;
