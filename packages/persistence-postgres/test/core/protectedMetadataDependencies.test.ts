import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeIndexKey } from "flarex-protocol/index-key";
import type { CoreTableDefinition } from "../../src/core/api";
import { addTableSemanticDependency, metadataConflictKeys } from "../../src/core/dependencies";
import { initialRegistry, TABLES, INDEXES, SCHEMAS, PROGRAMS, tableDocument } from "../../src/core/registry";
import { checkCoreApplicationProgramAuthority, coreApplicationProgramMetadataReads } from "../../src/core/nativePolicy";
import { CoreNativeTablePolicySchema } from "../../src/core/nativePolicyTypes";
import { captureCoreSchema } from "../../src/core/schemaTypes";
import { serializeCoreSchema } from "../../src/core/schemaJson";
import { CoreReadSetBuilder, CoreWriteLog } from "../../src/core/writeLog";
import type { CoreDocumentChange } from "../../src/core/transaction";

const id = (value: number) => new Uint8Array(16).fill(value);
const table = (name: string, number: number, value: number): CoreTableDefinition => ({ name, number, tabletId: id(value),
  namespace: null, state: "active", indexes: [{ name: "by_id", ref: { id: id(value + 10) }, fields: [] }] });
const catalogs = [table(TABLES, 513, 1), table(INDEXES, 514, 2), table(SCHEMAS, 532, 3)];
const source = table("articles", 1024, 4), unrelated = table("audit", 1025, 5);
const registry = Result.getOrThrow(initialRegistry([...catalogs, source, unrelated]));
const catalog = registry.table(TABLES)?.definition, schemas = registry.table(SCHEMAS)?.definition;
if (catalog === undefined || schemas === undefined) throw new Error("Missing real metadata catalog definitions");
const read = new CoreReadSetBuilder();
Result.getOrThrow(addTableSemanticDependency(read, registry, source));
const sourceReads = read.snapshot();
const schemaId = (value: number) => Result.getOrThrow(encodeDocumentId(532, id(value)));
const policy = Schema.decodeUnknownSync(CoreNativeTablePolicySchema)({ state: "active", schemaId: schemaId(7), applicationRead: false,
  identity: { scopeUuid: "1726a4fd-1e3f-4166-a276-72742040bd95", epochUuid: "21172004-bd8d-40f5-b735-825ec68c06bd",
    sourceKey: "payload", sourceSha256: "a".repeat(64), configSha256: "b".repeat(64), provenanceSha256: "c".repeat(64), definitionHash: "d".repeat(64) },
  uniqueConstraints: [] });
const change = (before: typeof policy, after: typeof policy): CoreDocumentChange => ({ table: catalog,
  id: source.tabletId, original: undefined, originalDocument: tableDocument({ ...source, nativePolicy: before }),
  finalDocument: tableDocument({ ...source, nativePolicy: after }) });

describe("protected consumed metadata conflict keys", () => {
  it("consumes only the declared actor revision/head and retains head ABA", () => {
    const programs = table(PROGRAMS, 9999, 6), selected = { functionPath: "users:save", programHash: "selected", schemaHash: "schema" };
    const actor = Result.getOrThrow(initialRegistry([...catalogs, source, unrelated, programs]))
      .withProgram({ id: id(20), ts: 0n, definition: { identity: selected, metadata: {} } })
      .withHead({ id: id(21), ts: 0n, identity: selected });
    const consumed = Result.getOrThrow(coreApplicationProgramMetadataReads(actor, selected));
    const byId = programs.indexes[0];
    if (byId === undefined) throw new Error("Missing actual programs by_id index");
    const key = (value: number) => Result.getOrThrow(encodeIndexKey([], Result.getOrThrow(encodeDocumentId(programs.number, id(value)))));
    const log = new CoreWriteLog(0n);
    log.append(1n, [{ indexId: byId.ref.id, keys: [key(22)] }]);
    expect(Result.getOrThrow(log.snapshot().conflict(consumed, 0n))).toBeUndefined();
    const changed = actor.withHead({ id: id(21), ts: 2n, identity: { ...selected, programHash: "other" } });
    expect(checkCoreApplicationProgramAuthority(changed, selected)).toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    log.append(2n, [{ indexId: byId.ref.id, keys: [key(21)] }]);
    log.append(3n, [{ indexId: byId.ref.id, keys: [key(21)] }]);
    expect(checkCoreApplicationProgramAuthority(changed.withHead({ id: id(21), ts: 3n, identity: selected }), selected)).toMatchObject({ _tag: "Success" });
    expect(Result.getOrThrow(log.snapshot().conflict(consumed, 0n))).toMatchObject({ timestamp: 3n });
  });

  it("permits schema-document rebinding with identical consumed policy semantics", () => {
    const log = new CoreWriteLog(0n);
    log.append(1n, Result.getOrThrow(metadataConflictKeys(registry, [change(policy, { ...policy, schemaId: schemaId(8) })])));
    expect(Result.getOrThrow(log.snapshot().conflict(sourceReads, 0n))).toBeUndefined();
  });

  it("treats the omitted live binding default and explicit selection as the same dependency meaning", () => {
    const log = new CoreWriteLog(0n);
    log.append(1n, Result.getOrThrow(metadataConflictKeys(registry, [change(policy, { ...policy, bindingSelected: true })])));
    expect(Result.getOrThrow(log.snapshot().conflict(sourceReads, 0n))).toBeUndefined();
    log.append(2n, Result.getOrThrow(metadataConflictKeys(registry, [change({ ...policy, bindingSelected: true }, { ...policy, bindingSelected: false })])));
    log.append(3n, Result.getOrThrow(metadataConflictKeys(registry, [change({ ...policy, bindingSelected: false }, policy)])));
    expect(Result.getOrThrow(log.snapshot().conflict(sourceReads, 0n))).toMatchObject({ timestamp: 3n });
  });

  it("retains policy-away and policy-back writes as ABA conflicts", () => {
    const log = new CoreWriteLog(0n), changed = { ...policy, applicationRead: true };
    log.append(1n, Result.getOrThrow(metadataConflictKeys(registry, [change(policy, changed)])));
    log.append(2n, Result.getOrThrow(metadataConflictKeys(registry, [change(changed, policy)])));
    expect(Result.getOrThrow(log.snapshot().conflict(sourceReads, 0n))).toMatchObject({ timestamp: 2n });
  });

  it("permits an unrelated schema table change and rejects a consumed validator change", () => {
    const schema = (articleField: string, auditField: string) => Result.getOrThrow(serializeCoreSchema(Result.getOrThrow(captureCoreSchema({
      schemaValidation: true, tables: [{ tableName: "articles", documentType: { type: "object", value: {
        [articleField]: { fieldType: { type: "string" }, optional: false } } }, indexes: [] },
      { tableName: "audit", documentType: { type: "object", value: { [auditField]: { fieldType: { type: "string" }, optional: false } } }, indexes: [] }],
    }))));
    const activation = (before: string, after: string): CoreDocumentChange => ({ table: schemas, id: id(8), original: undefined,
      originalDocument: { state: { state: "active" }, schema: before }, finalDocument: { state: { state: "active" }, schema: after } });
    const log = new CoreWriteLog(0n), initial = schema("headline", "message"), auditChanged = schema("headline", "detail");
    log.append(1n, Result.getOrThrow(metadataConflictKeys(registry, [activation(initial, auditChanged)])));
    expect(Result.getOrThrow(log.snapshot().conflict(sourceReads, 0n))).toBeUndefined();
    log.append(2n, Result.getOrThrow(metadataConflictKeys(registry, [activation(auditChanged, schema("title", "detail"))])));
    expect(Result.getOrThrow(log.snapshot().conflict(sourceReads, 0n))).toMatchObject({ timestamp: 2n });
  });
});
