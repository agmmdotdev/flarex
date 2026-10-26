import { createHash, randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import type { CollectionConfig } from "payload";
import type { RegisteredFunction } from "../../../packages/flarex/src/server.ts";
import { encodeCanonicalJson } from "../../../packages/flarex-protocol/src/json.ts";
import { Document, type Definition } from "./definition.ts";
import { CoreError } from "./errors.ts";
import type { Persistence } from "./persistence.ts";
import { createStorage } from "./storage.ts";
import { createApplicationStorage } from "./application-storage.ts";
import { createApplicationHost } from "./application.ts";
import { createProductBinding } from "./medusa-product.ts";
import { createPayloadBinding } from "./payload.ts";
import { createGroupRoot } from "./group-root.ts";
import { createGroupStorage } from "./group-storage.ts";
import { supervise } from "./callback.ts";
import { captureJsonInput, JsonValue } from "./value.ts";

const Input = Schema.Struct({ application: Schema.Struct({ name: Schema.String, args: Schema.Record(Schema.String, JsonValue) }),
  product: Schema.Struct({ id: Schema.String, data: Schema.Record(Schema.String, JsonValue) }),
  payload: Schema.Struct({ create: Schema.Record(Schema.String, JsonValue), update: Schema.Record(Schema.String, JsonValue), deleteId: Schema.String }) });
export const MixedResult = Schema.Struct({ application: JsonValue, product: JsonValue,
  payload: Schema.Struct({ created: Document, updated: Document, read: Document, deleted: Document }) });

/** Concrete locally completing graph: authored mutation, native Product
 * update/retrieve/list, Payload CRUD and preference cleanup. This outer host alone owns settlement.
 * It is not a universal transaction API or a durable workflow host. */
export const createMixedHost = Effect.fn("ExperimentMixed.host")(function* (persistence: Persistence, scope: string,
  definition: Definition, functions: Readonly<Record<string, RegisteredFunction>>, collection: CollectionConfig) {
  const owner = yield* Effect.scope; const storage = createStorage(persistence); const groups = createGroupStorage(persistence);
  const application = yield* createApplicationHost(definition, createApplicationStorage(persistence), scope, functions);
  const product = yield* createProductBinding(); const payload = yield* createPayloadBinding(collection, storage, scope);
  const definitions = Object.freeze([definition, product.prepared.definition, payload.definition, payload.preferenceDefinition]);
  let live = true; yield* Effect.addFinalizer(() => Effect.sync(() => { live = false; }));
  const decode = Effect.fn("ExperimentMixed.outcome")(function* (value: unknown,
    applicationResult: (value: unknown) => Effect.Effect<Schema.Json, CoreError>,
    productResult: (value: unknown) => Effect.Effect<Schema.Json, CoreError>, deleteId: string) {
    const envelope = yield* Schema.decodeUnknownEffect(MixedResult)(value, { onExcessProperty: "error" }).pipe(
      Effect.mapError(cause => new CoreError({ reason: "storage", cause })));
    const app = yield* applicationResult(envelope.application);
    const commerce = yield* productResult(envelope.product);
    const created = yield* payload.definition.decode(envelope.payload.created);
    const updated = yield* payload.definition.decode(envelope.payload.updated);
    const read = yield* payload.definition.decode(envelope.payload.read);
    const deleted = yield* payload.definition.decode(envelope.payload.deleted);
    if (created.id !== updated.id || updated.id !== read.id || created.createdAt !== updated.createdAt ||
      Object.keys(updated).some(key => updated[key] !== read[key]) || deleted.id !== deleteId || created.id === deleted.id)
      return yield* Effect.fail(new CoreError({ reason: "storage" }));
    return { application: app, product: commerce, payload: { created, updated, read, deleted } };
  }, effect => effect.pipe(Effect.mapError(cause => cause.reason === "storage" ? cause : new CoreError({ reason: "storage", cause }))));
  const execute = Effect.fn("ExperimentMixed.execute")(function* (request: string, value: unknown) {
    if (!live) return yield* Effect.fail(new CoreError({ reason: "closed" }));
    const captured = yield* Effect.fromResult(captureJsonInput(value));
    const data = structuredClone(yield* Schema.decodeUnknownEffect(Input)(captured, { onExcessProperty: "error" }).pipe(
      Effect.mapError(cause => new CoreError({ reason: "invalid", cause }))));
    if (Buffer.byteLength(JSON.stringify(data)) > 262144) return yield* Effect.fail(new CoreError({ reason: "limit" }));
    const app = yield* application.prepareMutation(data.application.name, data.application.args);
    const commerce = yield* product.prepareGraph(data.product.id, data.product.data);
    const cms = yield* payload.prepareCreate(data.payload.create);
    const deletion = yield* payload.prepareDelete(data.payload.deleteId);
    const digest = createHash("sha256").update(encodeCanonicalJson({ profile: "application-product-payload", application: app.digest,
      product: commerce.digest, payload: cms.digest, update: data.payload.update, deletion: deletion.digest }, () => { throw new Error("Invalid mixed identity JSON"); })).digest("hex");
    const command = yield* groups.openMixed(scope, request, digest, definitions, randomUUID());
    if (command.status === "committed") {
      const result = yield* decode(command.result, app.decode, commerce.decode, data.payload.deleteId);
      yield* cms.authorize(); yield* payload.authorizeUpdatedResult(result.payload.updated.id, data.payload.update);
      yield* deletion.authorize();
      return result;
    }
    let accepting = false;
    return yield* Effect.gen(function* () {
      const group = yield* createGroupRoot(persistence, command, definitions);
      return yield* Effect.gen(function* () {
        const appResult = yield* group.withApplication(definition, app.run);
        const productResult = yield* group.withFramework(product.prepared.definition, commerce.run);
        const payloadResult = yield* group.withFramework(payload.definition, root => Effect.gen(function* () {
          const created = yield* cms.run(root, command.id);
          const updated = yield* payload.borrowUpdate(root, command.id, created.id, data.payload.update);
          const read = yield* payload.borrowRead(root, command.id, created.id);
          const deleted = yield* group.withFramework(payload.preferenceDefinition, preferences => deletion.run(root, preferences, command.id));
          return { created, updated, read, deleted };
        }));
        const result = yield* decode({ application: appResult, product: productResult, payload: payloadResult }, app.decode, commerce.decode, data.payload.deleteId);
        const candidates = yield* group.freeze(); accepting = true;
        const committed = yield* groups.accept(command, candidates, result).pipe(Effect.catchTag("CoreError", error => {
          if (error.reason !== "storage" || error.phase !== undefined && error.phase !== "commit") { accepting = false; return Effect.fail(error); }
          return groups.resolve(scope, request, digest).pipe(Effect.catchTag("CoreError", recovery => Effect.fail(new CoreError({ reason: "uncertain", cause: { original: error, recovery } }))));
        }));
        return yield* decode(committed, app.decode, commerce.decode, data.payload.deleteId);
        }).pipe(Effect.onExit(() => group.close));
    }).pipe(Effect.onExit(() => accepting ? Effect.void : groups.abort(command)));
  });
  return { definitions, productDefinition: product.prepared, execute: (request: string, value: unknown) => supervise(owner, execute(request, value)) };
});
