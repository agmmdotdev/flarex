import { Effect, Option, Schema } from "effect";
import { expect } from "vitest";
import { eq } from "drizzle-orm";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { Json } from "flarex-protocol/json";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { inspectPrivateReferenceSaveAccess } from "../../../persistence-postgres/src/execution/journal/privateSaveAccess";
import { makePayloadReferenceSave } from "../../../payload-adapter/src/runtime/referenceSave";
import type { PayloadNativeInstrumentation } from "../../../payload-adapter/src/runtime/native";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";
import { bindPrivatePayloadSave, preparePrivateSavePolicy, type PrivateSavePolicyInput } from "./privatePayloadSaveCommands";

const sequence = (value: bigint) => CommitSyscallSequenceV1Schema.make(value);
const decodeDocument = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String,
  featuredProduct: Schema.NullOr(Schema.String) }));
const decodeProduct = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
/** Only arrange facts, execute genuine backend/native owners and observe state.
 * No fixture permission evaluator, reference classifier or publisher exists. */
export async function privatePayloadReferenceSaveScenario(fixture: PrivatePayloadSaveFixture) {
  const { store } = fixture.fixture;
  const db = fixture.fixture.application.persistence.drizzle;
  const scopeId = fixture.fixture.application.authority.scopeId;
  const counts = () => publishedScopeCounts(db, scopeId);
  const allSource = { create: true, update: true, delete: true };
  const product = async (title: string, handle: string) => decodeProduct(await Effect.runPromise(fixture.productHost.run(
    fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductCreate, { title, handle })));
  const first = await product("First selected Product", "private-save-first");
  const second = await product("Second selected Product", "private-save-second");
  let policyId: AppDocumentIdV1 | undefined;
  const policy = async (input: PrivateSavePolicyInput) => {
    const prepared = await preparePrivateSavePolicy(fixture, input, policyId);
    policyId = prepared.documentId;
    expect(await prepared.root.publish()).toMatchObject({ kind: "published" });
  };
  const begin = async (instrumentation?: PayloadNativeInstrumentation) => {
    if (policyId === undefined) throw new Error("Missing trusted permission selector");
    const root = await fixture.open();
    const saving = await bindPrivatePayloadSave(fixture, root, policyId, instrumentation === undefined ? {} : { instrumentation });
    const publish = (value: unknown = null) => root.publish(value, [root.payloadProfile(saving.selected.profileRevision)]);
    return { root, ...saving, publish };
  };
  type Saving = Awaited<ReturnType<typeof begin>>;
  type InvocationResult = Effect.Success<ReturnType<Saving["invoke"]>>;
  const documentOf = (result: InvocationResult) => {
    if (result.kind !== "completed") throw new Error("Expected executed native save");
    return decodeDocument(result.result);
  };
  const save = async (method: "create" | "update" | "delete", args: Json, instrumentation?: PayloadNativeInstrumentation) => {
    const saving = await begin(instrumentation);
    try {
      const result = await Effect.runPromise(saving.invoke(method, args));
      const document = documentOf(result);
      expect(await saving.publish(document)).toMatchObject({ kind: "published" });
      return document;
    } finally { await saving.close(); }
  };
  const denied = async (method: "create" | "update" | "delete", args: Json, instrumentation?: PayloadNativeInstrumentation) => {
    const before = await counts();
    const saving = await begin(instrumentation);
    try {
      expect(await Effect.runPromise(saving.invoke(method, args).pipe(Effect.result))).toMatchObject({ _tag: "Failure" });
      // The application may catch the rejection; the root still cannot publish.
      await expect(saving.publish()).rejects.toBeDefined();
      expect(await counts()).toEqual(before);
    } finally { await saving.close(); }
  };

  await policy({ source: allSource, assign: [], retain: [] });
  const unlinked = await save("create", { collection: "posts", data: { title: "No reference" } });
  expect(unlinked.featuredProduct).toBeNull();
  const explicitNull = await save("create", { collection: "posts", data: { title: "Explicit null", featuredProduct: null } });
  expect(explicitNull.featuredProduct).toBeNull();
  await denied("create", { collection: "posts", data: { title: "Picker selection is insufficient", featuredProduct: first.id } });

  let sourceExecutions = 0, normalized = 0;
  await policy({ source: { ...allSource, create: false }, assign: [first.id], retain: [first.id] });
  await denied("create", { collection: "posts", data: { title: "Target grant alone", featuredProduct: first.id } },
    { hooks: { beforeChange: [({ data }) => { normalized++; return data; }] }, onExecute: () => { sourceExecutions++; } });
  expect(sourceExecutions).toBe(1);
  expect(normalized).toBe(0);

  await policy({ source: allSource, assign: [first.id], retain: [] });
  let changes = 0;
  const replay = await begin({ hooks: { beforeChange: [({ data }) => { changes++; return data; }] } });
  let linked: ReturnType<typeof decodeDocument>;
  try {
    const args = { collection: "posts", data: { title: "Assigned", featuredProduct: first.id } };
    linked = documentOf(await Effect.runPromise(replay.invoke("create", args, 2n)));
    expect(await Effect.runPromise(replay.invoke("create", args, 2n))).toMatchObject({ kind: "completed", delivery: "replayed" });
    expect(changes).toBe(1);
    expect(await replay.publish(linked)).toMatchObject({ kind: "published" });
  } finally { await replay.close(); }
  expect(inspectPrivateReferenceSaveAccess(replay.access, replay.root.attempt)).toBeUndefined();

  await policy({ source: allSource, assign: [], retain: [first.id] });
  expect(await save("update", { collection: "posts", id: linked.id, data: { title: "Retain without Product visibility" } }))
    .toMatchObject({ featuredProduct: first.id });
  expect(await save("update", { collection: "posts", id: linked.id, data: { featuredProduct: first.id } }))
    .toMatchObject({ featuredProduct: first.id });
  const beforeClear = await counts();
  const clearing = await begin();
  try {
    expect(documentOf(await Effect.runPromise(clearing.invoke("update", { collection: "posts", id: linked.id, data: { featuredProduct: null } }))))
      .toMatchObject({ featuredProduct: null });
    expect(await Effect.runPromise(clearing.invoke("update", { collection: "posts", id: linked.id, data: { featuredProduct: first.id } }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure" });
    await expect(clearing.publish()).rejects.toBeDefined();
    expect(await counts()).toEqual(beforeClear);
  } finally { await clearing.close(); }
  await policy({ source: allSource, assign: [], retain: [] });
  await denied("update", { collection: "posts", id: linked.id, data: { title: "Retention revoked" } });
  expect(await save("update", { collection: "posts", id: linked.id, data: { featuredProduct: null } })).toMatchObject({ featuredProduct: null });

  await policy({ source: allSource, assign: [first.id], retain: [] });
  const hooked = await save("create", { collection: "posts", data: { title: "Normalized alias", featuredProduct: "picker-alias" } },
    { hooks: { beforeChange: [({ data }) => ({ ...data, featuredProduct: first.id })] } });
  expect(hooked.featuredProduct).toBe(first.id);
  await denied("create", { collection: "posts", data: { title: "Hook changes permitted input", featuredProduct: first.id } },
    { hooks: { beforeChange: [({ data }) => ({ ...data, featuredProduct: second.id })] } });
  // A nested write cannot acquire a different native operation through the
  // outer create admission, even when the policy permits that operation.
  await denied("create", { collection: "posts", data: { title: "Nested write", featuredProduct: first.id } },
    { hooks: { beforeChange: [async ({ data, req }) => {
      await req.payload.update({ collection: "posts", id: linked.id, data: { title: "Nested update" }, req, overrideAccess: false });
      return data;
    }] } });
  const repeated = await begin();
  try {
    const created = documentOf(await Effect.runPromise(repeated.invoke("create", { collection: "posts", data: { title: "New assignment", featuredProduct: first.id } })));
    expect(documentOf(await Effect.runPromise(repeated.invoke("update", { collection: "posts", id: created.id, data: { title: "Same pending assignment" } }))))
      .toMatchObject({ featuredProduct: first.id });
    expect(await repeated.publish(created)).toMatchObject({ kind: "published" });
  } finally { await repeated.close(); }

  await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductSoftDelete, first.id));
  await policy({ source: allSource, assign: [first.id], retain: [first.id] });
  expect(await save("update", { collection: "posts", id: hooked.id, data: { title: "Keep soft-deleted target" } })).toMatchObject({ featuredProduct: first.id });
  const inactive = await begin();
  try {
    const result = documentOf(await Effect.runPromise(inactive.invoke("create", { collection: "posts", data: { title: "Inactive assignment", featuredProduct: first.id } })));
    const before = await counts();
    await expect(inactive.publish(result)).rejects.toBeDefined();
    expect(await counts()).toEqual(before);
  } finally { await inactive.close(); }
  await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(), fixture.productRuntime.commands.internalProductRestore, first.id));

  for (const extra of [{ overrideAccess: true }, { context: { flarexPrivateReferenceSave: {} } }, { user: { role: "admin" } }]) {
    await denied("create", { collection: "posts", data: { title: "Forged native authority", featuredProduct: first.id }, ...extra });
  }
  const foreign = await begin();
  const other = await fixture.open();
  try {
    await expect(Effect.runPromise(store.preparePrivateReferenceSaveEffect(other.attempt, foreign.facts,
      { participant: "payload", collection: "posts", relation: "featuredProduct", nativeProfileRevision: "1".repeat(64) })))
      .rejects.toMatchObject({ reason: "invalidAuthority" });
    await expect(other.publish()).rejects.toBeDefined();
    await expect(Effect.runPromise(Effect.scoped(makePayloadReferenceSave(fixture.compiled, foreign.root.attempt, { ...foreign.access }))))
      .rejects.toMatchObject({ reason: "invalidAuthority" });
  } finally { await foreign.close(); await Effect.runPromise(store.discardFiniteRootEffect(foreign.root.attempt)); }
  for (const selection of [
    { participant: "payload", collection: "posts", relation: "featuredProduct", nativeProfileRevision: "2".repeat(64) },
    { participant: "payload", collection: "posts", relation: "anotherRelation", nativeProfileRevision: "1".repeat(64) },
    { participant: "medusa.product", collection: "posts", relation: "featuredProduct", nativeProfileRevision: "2".repeat(64) },
  ]) {
    const invalid = await begin();
    try {
      await expect(Effect.runPromise(store.preparePrivateReferenceSaveEffect(invalid.root.attempt, invalid.facts, selection)))
        .rejects.toMatchObject({ reason: "invalidAuthority" });
      await expect(invalid.publish()).rejects.toBeDefined();
      expect(inspectPrivateReferenceSaveAccess(invalid.access, invalid.root.attempt)).toBeUndefined();
    } finally { await invalid.close(); }
  }

  await policy({ source: allSource, assign: [first.id], retain: [] });
  const stale = await begin();
  try {
    const created = documentOf(await Effect.runPromise(stale.invoke("create", { collection: "posts", data: { title: "Revoked before publication", featuredProduct: first.id } })));
    await policy({ source: { ...allSource, create: false }, assign: [], retain: [] });
    const before = await counts();
    await expect(stale.publish(created)).rejects.toMatchObject({ _tag: "PointCommitConflictV1Error" });
    expect(await counts()).toEqual(before);
  } finally { await stale.close(); }
  await denied("create", { collection: "posts", data: { title: "Fresh save observes revocation" } });

  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  await db.insert(fixture.preferences.table).values({ scope: scopeUuid, generation: "flarexdb_v1", id: "private-save-preference",
    key: `collection-posts-${hooked.id}`, userCollection: "users", userId: "editor", value: { retained: true },
    createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" });
  await policy({ source: { ...allSource, delete: false }, assign: [], retain: [] });
  await denied("delete", { collection: "posts", id: hooked.id });
  expect(await db.select().from(fixture.preferences.table).where(eq(fixture.preferences.table.id, "private-save-preference"))).toHaveLength(1);
  await policy({ source: allSource, assign: [], retain: [] });
  await save("delete", { collection: "posts", id: hooked.id });
  expect(await db.select().from(fixture.preferences.table).where(eq(fixture.preferences.table.id, "private-save-preference"))).toHaveLength(0);

  if (policyId === undefined) throw new Error("Missing permission record");
  const deleting = await fixture.fixture.open();
  const writer = await Effect.runPromise(store.preparePrivateApplicationCommandEffect(deleting.attempt, "audit"));
  await Effect.runPromise(writer.run({ kind: "delete", syscallSequence: sequence(1n), documentId: policyId }, deleting.validator));
  expect(await deleting.publish()).toMatchObject({ kind: "published" });
  const missing = await fixture.open();
  const facts = await Effect.runPromise(store.readPrivateReferencePermissionsEffect(missing.attempt,
    { tableName: "audit", documentId: policyId, syscallSequence: sequence(1n), principal: missing.principal }, missing.validator));
  expect(Option.isNone(facts)).toBe(true);
  await expect(Effect.runPromise(store.preparePrivateReferenceSaveEffect(missing.attempt, facts,
    { participant: "payload", collection: "posts", relation: "featuredProduct", nativeProfileRevision: "1".repeat(64) })))
    .rejects.toMatchObject({ reason: "denied" });
  await expect(missing.publish()).rejects.toBeDefined();
}
