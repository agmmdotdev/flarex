import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AppDocumentIdV1Schema } from "flarex-protocol/app-document-id";
import { APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1 } from "flarex-protocol/internal/application-revision-syscall-validation-v1";
import { ApplicationRevisionSyscallDocumentValidationV1Error } from "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import { runMixedMutationInProcess } from "./support/mixedMutationInProcessRuntime";

const id = "1:11111111-1111-4111-8111-111111111111";
const otherId = "1:22222222-2222-4222-8222-222222222222";
const foreignId = "2:11111111-1111-4111-8111-111111111111";
const now = Date.UTC(2026, 6, 24);
const document = { _id: id, _creationTime: now, title: "captured" };
const inserted = { kind: "inserted", documentId: id, document };
const pointMessage = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("point"),
  operation: Schema.Struct({ syscallSequence: Schema.String, kind: Schema.String, fields: Schema.optional(Schema.Unknown),
    patch: Schema.optional(Schema.Unknown) }) }));

function run(body: string, bridge: (message: unknown) => Promise<unknown>) {
  return runMixedMutationInProcess({
    source: `export default { users: { create: { isMutation: true, isPublic: true,
      _handler: async ctx => { ${body} } } } };`,
    request: JSON.stringify({ format: "flarex.point-mutation-exact-runtime", version: 1,
      artifact: { runtime: "dynamic-worker", artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourcePackageHash: "a".repeat(64), executionModule: "app.js" },
      function: { path: "users:create", executionModule: "app.js", kind: "mutation", visibility: "public",
        argsValidator: { type: "any" }, returnsValidator: null },
      auth: { kind: "anonymous" }, arguments: {}, argumentArraySemanticBytes: 4,
      tables: [{ tableId: 1, logicalName: "users" }], context: { executionId: "run-1", logScopeId: "log-1",
        randomSeed: Array(32).fill(5), executionTime: now, initialCreationTimeCursor: now },
    }),
    executionModule: "app.js", executionTime: now, bridge,
  });
}

function validationRejection() {
  return new ApplicationRevisionSyscallDocumentValidationV1Error({ operation: "insert", tableName: "users",
    documentId: AppDocumentIdV1Schema.make(id), issue: { reason: "unexpectedSystemField", field: "test" },
    message: APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1 });
}

describe("direct mixed test transport boundary", () => {
  it("captures detached point fields and admitted arguments synchronously", async () => {
    const observed: unknown[] = [];
    await run(`const fields = { title: "captured", nested: { value: 1 } };
      const point = ctx.db.insert("users", fields); fields.title = "changed"; fields.nested.value = 2; await point;
      const args = { nested: { value: 1 } }; const admitted = ctx.privateMixed.call("example", "run", args);
      args.nested.value = 2; await admitted; return "ok";`, async message => {
      observed.push(message);
      return observed.length === 1 ? inserted : "admitted";
    });
    expect(observed).toMatchObject([
      { operation: { fields: { title: "captured", nested: { value: 1 } }, syscallSequence: "1" } },
      { sequence: "2", frame: { args: { nested: { value: 1 } } } },
    ]);
  });

  it("captures patch deletions and replacement fields before dispatch", async () => {
    const observed: unknown[] = [];
    await run(`const patch = { title: undefined, nested: { value: 1 } };
      const patching = ctx.db.patch(${JSON.stringify(id)}, patch); patch.title = "changed"; patch.nested.value = 2; await patching;
      const fields = { title: "captured" }; const replacing = ctx.db.replace(${JSON.stringify(id)}, fields);
      fields.title = "changed"; await replacing; return "ok";`, async message => {
      const point = pointMessage(message); observed.push(point);
      return { kind: "unit", operation: point.operation.kind };
    });
    expect(observed).toMatchObject([
      { operation: { patch: { title: undefined, nested: { value: 1 } } } },
      { operation: { fields: { title: "captured" } } },
    ]);
  });

  const invalidAcks = [
    { operation: 'ctx.db.insert("users", {})', ack: { kind: "inserted", documentId: id } },
    { operation: 'ctx.db.insert("users", {})', ack: { ...inserted, documentId: foreignId, document: { ...document, _id: foreignId } } },
    { operation: 'ctx.db.insert("users", {})', ack: { ...inserted, document: { ...document, _id: otherId } } },
    { operation: 'ctx.db.insert("users", {})', ack: { ...inserted, document: { ...document, _creationTime: 0 } } },
    { operation: 'ctx.db.insert("users", {})', ack: { ...inserted, extra: true } },
    { operation: `ctx.db.get(${JSON.stringify(id)})`, ack: { kind: "present", document: { ...document, _id: otherId } } },
    { operation: `ctx.db.get(${JSON.stringify(id)})`, ack: { kind: "missing", document } },
    { operation: `ctx.db.patch(${JSON.stringify(id)}, {})`, ack: { kind: "unit", operation: "delete" } },
    { operation: `ctx.db.delete(${JSON.stringify(id)})`, ack: { kind: "unit", operation: "delete", extra: true } },
  ];
  it.each(invalidAcks)("retains caught malformed acknowledgement $operation through drain", async ({ operation, ack }) => {
    let dispatches = 0;
    await expect(run(`try { await ${operation}; } catch {} return "caught";`, async () => {
      dispatches++; return ack;
    })).rejects.toMatchObject({ name: "PointMutationRuntimeJournalBoundaryV1Error" });
    expect(dispatches).toBe(1);
  });

  it("lets a caught genuine document rejection retry sequence one", async () => {
    const sequences: string[] = [];
    const rejection = validationRejection();
    await run('try { await ctx.db.insert("users", { bad: true }); } catch {} return await ctx.db.insert("users", {});', async message => {
      sequences.push(pointMessage(message).operation.syscallSequence);
      if (sequences.length === 1) throw rejection;
      return inserted;
    });
    expect(sequences).toEqual(["1", "1"]);
  });

  it("retains a name/message lookalike rejection as a terminal failure", async () => {
    const lookalike = new Error(APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1);
    lookalike.name = validationRejection().name;
    let dispatches = 0;
    await expect(run('try { await ctx.db.insert("users", {}); } catch {} try { await ctx.db.insert("users", {}); } catch {} return "caught";', async () => {
      dispatches++; throw lookalike;
    })).rejects.toMatchObject({ cause: lookalike });
    expect(dispatches).toBe(1);
  });

  it("keeps ordinary pre-admission field validation catchable", async () => {
    const sequences: string[] = [];
    await run('try { await ctx.db.insert("users", { _creationTime: 0 }); } catch {} return await ctx.db.insert("users", {});', async message => {
      sequences.push(pointMessage(message).operation.syscallSequence); return inserted;
    });
    expect(sequences).toEqual(["1"]);
  });

  it("retains admitted capture and participant document errors as terminal", async () => {
    let dispatches = 0;
    await expect(run('try { await ctx.privateMixed.call("example", "run", { value: () => 1 }); } catch {} return "caught";', async () => {
      dispatches++; return null;
    })).rejects.toMatchObject({ name: "PointMutationRuntimeJournalBoundaryV1Error" });
    expect(dispatches).toBe(0);
    const rejection = validationRejection();
    await expect(run('try { await ctx.privateMixed.call("example", "run", {}); } catch {} return "caught";', async () => {
      throw rejection;
    })).rejects.toMatchObject({ cause: rejection });
  });
});
