import { describe, expect, it, vi } from "vitest";

import type { UserIdentity } from "flarex-protocol/auth";

import {
  createFunctionRuntimeApplicationErrorRegistryV1,
  createFunctionRuntimeAuthV1,
  createFunctionRuntimePointDatabaseWriterV1,
  createFunctionRuntimePointReaderV1,
  createMutationFunctionRuntimeContextV1,
  createQueryFunctionRuntimeContextV1,
} from "../src/functionApiCore";

const IDENTITY = Object.freeze({
  tokenIdentifier: "issuer|subject",
  subject: "subject",
  issuer: "issuer",
  name: "Flarex User",
}) satisfies UserIdentity;

describe("@flarex/function-runtime/function-api-core", () => {
  it("returns null for anonymous auth without invoking the clone port", async () => {
    const cloneIdentity = vi.fn<(identity: UserIdentity) => UserIdentity>();
    const auth = createFunctionRuntimeAuthV1(
      Object.freeze({ kind: "anonymous" }),
      cloneIdentity,
    );

    await expect(auth.getUserIdentity()).resolves.toBeNull();
    expect(cloneIdentity).not.toHaveBeenCalled();
    expect(Object.isFrozen(auth)).toBe(true);
    expect(Object.keys(auth)).toEqual(["getUserIdentity"]);
  });

  it("constructs an exact frozen point reader without changing port timing", async () => {
    const document = Object.freeze({ _id: "orders:1", status: "open" });
    const promisedDocument = Promise.resolve(document);
    const readPointDocument = vi.fn((documentId: string) => {
      expect(documentId).toBe("orders:1");
      return promisedDocument;
    });
    const reader = createFunctionRuntimePointReaderV1(readPointDocument);

    const result = reader.get("orders:1");

    expect(result).toBe(promisedDocument);
    await expect(result).resolves.toBe(document);
    expect(readPointDocument).toHaveBeenCalledOnce();
    expect(Object.keys(reader)).toEqual(["get"]);
    expect(Object.isFrozen(reader)).toBe(true);
    expect("insert" in reader).toBe(false);
    expect("query" in reader).toBe(false);
    expect("normalizeId" in reader).toBe(false);
    expect("system" in reader).toBe(false);
  });

  it("preserves a point-read port's synchronous failure", () => {
    const failure = new Error("reader closed");
    const reader = createFunctionRuntimePointReaderV1((_documentId: string) => {
      throw failure;
    });

    expect(() => reader.get("orders:1")).toThrow(failure);
  });

  it("constructs an exact frozen point database writer with direct delegates", async () => {
    const reader = createFunctionRuntimePointReaderV1(async () => null);
    const insertPromise = Promise.resolve("orders:1");
    const patchPromise = Promise.resolve();
    const replacePromise = Promise.resolve();
    const deletePromise = Promise.resolve();
    const insert = vi.fn(() => insertPromise);
    const patch = vi.fn(() => patchPromise);
    const replace = vi.fn(() => replacePromise);
    const deletePointDocument = vi.fn(() => deletePromise);
    const writer = {
      insertPointDocument: insert,
      patchPointDocument: patch,
      replacePointDocument: replace,
      deletePointDocument,
    };
    const database = createFunctionRuntimePointDatabaseWriterV1(
      reader,
      writer,
    );
    writer.insertPointDocument = vi.fn(() => Promise.resolve("orders:other"));
    writer.patchPointDocument = vi.fn(() => Promise.resolve());
    writer.replacePointDocument = vi.fn(() => Promise.resolve());
    writer.deletePointDocument = vi.fn(() => Promise.resolve());
    const insertValue = Object.freeze({ status: "open" });
    const patchValue = Object.freeze({ status: "patched" });
    const replacementValue = Object.freeze({ status: "replaced" });

    expect(database.get).toBe(reader.get);
    expect(database.insert("orders", insertValue)).toBe(insertPromise);
    expect(database.patch("orders:1", patchValue)).toBe(patchPromise);
    expect(database.replace("orders:1", replacementValue)).toBe(replacePromise);
    expect(database.delete("orders:1")).toBe(deletePromise);
    await Promise.all([insertPromise, patchPromise, replacePromise, deletePromise]);
    expect(insert).toHaveBeenCalledWith("orders", insertValue);
    expect(patch).toHaveBeenCalledWith("orders:1", patchValue);
    expect(replace).toHaveBeenCalledWith("orders:1", replacementValue);
    expect(deletePointDocument).toHaveBeenCalledWith("orders:1");
    expect(Object.keys(database)).toEqual([
      "get",
      "insert",
      "patch",
      "replace",
      "delete",
    ]);
    expect(Object.isFrozen(database)).toBe(true);
  });

  it("preserves synchronous failure timing for every point writer delegate", () => {
    const failure = new Error("journal closed");
    const reader = createFunctionRuntimePointReaderV1(async () => null);
    const insert = () => Promise.resolve("orders:1");
    const unit = () => Promise.resolve();
    const throwing = (): never => { throw failure; };
    const invocations = [
      () => createFunctionRuntimePointDatabaseWriterV1(
        reader,
        Object.freeze({
          insertPointDocument: throwing,
          patchPointDocument: unit,
          replacePointDocument: unit,
          deletePointDocument: unit,
        }),
      ).insert("orders", {}),
      () => createFunctionRuntimePointDatabaseWriterV1(
        reader,
        Object.freeze({
          insertPointDocument: insert,
          patchPointDocument: throwing,
          replacePointDocument: unit,
          deletePointDocument: unit,
        }),
      ).patch("orders:1", {}),
      () => createFunctionRuntimePointDatabaseWriterV1(
        reader,
        Object.freeze({
          insertPointDocument: insert,
          patchPointDocument: unit,
          replacePointDocument: throwing,
          deletePointDocument: unit,
        }),
      ).replace("orders:1", {}),
      () => createFunctionRuntimePointDatabaseWriterV1(
        reader,
        Object.freeze({
          insertPointDocument: insert,
          patchPointDocument: unit,
          replacePointDocument: unit,
          deletePointDocument: throwing,
        }),
      ).delete("orders:1"),
    ];

    for (const invoke of invocations) expect(invoke).toThrow(failure);
  });

  it("returns a fresh owned identity from the trusted clone port on every call", async () => {
    const cloneIdentity = vi.fn((identity: UserIdentity): UserIdentity => ({
      ...identity,
    }));
    const auth = createFunctionRuntimeAuthV1(
      Object.freeze({ kind: "user", user: IDENTITY }),
      cloneIdentity,
    );

    const first = await auth.getUserIdentity();
    const second = await auth.getUserIdentity();

    expect(first).toEqual(IDENTITY);
    expect(second).toEqual(IDENTITY);
    expect(first).not.toBe(IDENTITY);
    expect(second).not.toBe(IDENTITY);
    expect(second).not.toBe(first);
    expect(cloneIdentity).toHaveBeenNthCalledWith(1, IDENTITY);
    expect(cloneIdentity).toHaveBeenNthCalledWith(2, IDENTITY);
  });

  it("constructs fresh exact frozen query and mutation contexts", async () => {
    const auth = createFunctionRuntimeAuthV1(
      Object.freeze({ kind: "anonymous" }),
      identity => identity,
    );
    const queryDb = Object.freeze({ get: vi.fn() });
    const mutationDb = Object.freeze({
      get: vi.fn(),
      insert: vi.fn(),
    });
    const runQuery = vi.fn(() => Promise.resolve("query"));
    const runMutation = vi.fn(() => Promise.resolve("mutation"));

    const query = createQueryFunctionRuntimeContextV1(
      auth,
      queryDb,
      runQuery,
    );
    const secondQuery = createQueryFunctionRuntimeContextV1(
      auth,
      queryDb,
      runQuery,
    );
    const mutation = createMutationFunctionRuntimeContextV1(
      auth,
      mutationDb,
      runQuery,
      runMutation,
    );

    expect(query).toEqual({ auth, db: queryDb, runQuery });
    expect(mutation).toEqual({ auth, db: mutationDb, runQuery, runMutation });
    expect(secondQuery).not.toBe(query);
    expect(secondQuery).toEqual(query);
    expect(query.auth).toBe(auth);
    expect(query.db).toBe(queryDb);
    expect(query.runQuery).toBe(runQuery);
    expect(mutation.auth).toBe(auth);
    expect(mutation.db).toBe(mutationDb);
    expect(mutation.runQuery).toBe(runQuery);
    expect(mutation.runMutation).toBe(runMutation);
    expect(Object.keys(query)).toEqual(["auth", "db", "runQuery"]);
    expect(Object.keys(mutation)).toEqual([
      "auth",
      "db",
      "runQuery",
      "runMutation",
    ]);
    expect(Object.isFrozen(query)).toBe(true);
    expect(Object.isFrozen(secondQuery)).toBe(true);
    expect(Object.isFrozen(mutation)).toBe(true);
    expect("runMutation" in query).toBe(false);
    expect("runMutation" in mutation).toBe(true);
    expect("scheduler" in mutation).toBe(false);
    expect("storage" in mutation).toBe(false);
  });

  it("constructs one unforgeable declared-application-error registry", () => {
    const data = Object.freeze({ reason: "declared" });
    const captureData = vi.fn((_value: unknown) => data);
    const registry = createFunctionRuntimeApplicationErrorRegistryV1(
      captureData,
      (detail?: string): never => { throw new Error(detail ?? "invalid"); },
    );

    const withoutData = registry.create("NO_DATA", "without data");
    const withData = registry.create("WITH_DATA", "with data", { source: 1 });

    expect(Object.keys(registry)).toEqual([
      "FlarexError",
      "create",
      "inspect",
      "code",
      "message",
      "data",
    ]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(withoutData).toBeInstanceOf(Error);
    expect(withoutData.name).toBe("CoreApplicationErrorV1");
    expect(withoutData.message).toBe("without data");
    expect(Object.getOwnPropertyDescriptor(withoutData, "name")).toEqual({
      value: "CoreApplicationErrorV1",
      writable: false,
      enumerable: false,
      configurable: false,
    });
    expect(Object.isFrozen(withoutData)).toBe(false);
    expect(Object.hasOwn(withoutData, "code")).toBe(false);
    expect(Object.hasOwn(withoutData, "data")).toBe(false);
    expect(registry.inspect(withoutData)).toBe(true);
    expect(registry.code(withoutData)).toBe("NO_DATA");
    expect(registry.message(withoutData)).toBe("without data");
    expect(registry.data(withoutData)).toBeUndefined();
    expect(registry.inspect(withData)).toBe(true);
    expect(registry.code(withData)).toBe("WITH_DATA");
    expect(registry.message(withData)).toBe("with data");
    expect(registry.data(withData)).toBe(data);
    expect(captureData).toHaveBeenCalledOnce();
    expect(captureData).toHaveBeenCalledWith({ source: 1 });
  });

  it("constructs Convex-shaped public errors with registry-local provenance", () => {
    const capturedData = Object.freeze({ reason: "declared" });
    const first = createFunctionRuntimeApplicationErrorRegistryV1(
      _value => capturedData,
      (detail?: string): never => { throw new Error(detail ?? "invalid"); },
    );
    const second = createFunctionRuntimeApplicationErrorRegistryV1(
      _value => null,
      (detail?: string): never => { throw new Error(detail ?? "invalid"); },
    );

    const withoutData = new first.FlarexError("NO_DATA", "without data");
    const withData = new first.FlarexError(
      "WITH_DATA",
      "with data",
      { source: 1 },
    );

    expect(withoutData).toBeInstanceOf(Error);
    expect(withoutData).toBeInstanceOf(first.FlarexError);
    expect(withoutData).not.toBeInstanceOf(second.FlarexError);
    expect(withoutData.name).toBe("FlarexError");
    expect(withoutData.code).toBe("NO_DATA");
    expect(Object.hasOwn(withoutData, "data")).toBe(false);
    expect(withData.data).toBe(capturedData);
    expect(first.inspect(withData)).toBe(true);
    expect(second.inspect(withData)).toBe(false);
    expect(first.code(withData)).toBe("WITH_DATA");
    expect(first.message(withData)).toBe("with data");
    expect(first.data(withData)).toBe(capturedData);
  });

  it("preserves declared-error validation order, byte bounds, and data failures", () => {
    const dataFailure = new Error("data rejected");
    const captureData = vi.fn((_value: unknown): never => { throw dataFailure; });
    const invalid = vi.fn((detail?: string): never => {
      throw new Error(detail ?? "invalid declared error");
    });
    const registry = createFunctionRuntimeApplicationErrorRegistryV1(
      captureData,
      invalid,
    );
    const codeDiagnostic =
      "Core application error code must be a nonempty string no greater than 1024 UTF-8 bytes.";
    const messageDiagnostic =
      "Core application error message must be a nonempty string no greater than 1024 UTF-8 bytes.";

    expect(() => registry.create("", "", { ignored: true }))
      .toThrow(codeDiagnostic);
    expect(() => registry.create("VALID", "", { ignored: true }))
      .toThrow(messageDiagnostic);
    expect(captureData).not.toHaveBeenCalled();
    expect(invalid).toHaveBeenNthCalledWith(1, codeDiagnostic);
    expect(invalid).toHaveBeenNthCalledWith(2, messageDiagnostic);

    const maximumUtf8Text = "é".repeat(512);
    expect(() => registry.create(maximumUtf8Text, maximumUtf8Text))
      .not.toThrow();
    expect(() => registry.create("é".repeat(513), "message"))
      .toThrow(codeDiagnostic);
    expect(() => registry.create("VALID", "é".repeat(513)))
      .toThrow(messageDiagnostic);
    expect(() => registry.create("VALID", "message", { rejected: true }))
      .toThrow(dataFailure);
    expect(captureData).toHaveBeenCalledOnce();
  });

  it("isolates declared errors by registry and rejects structural spoofs", () => {
    const invalid = (detail?: string): never => {
      throw new Error(detail ?? "invalid declared error");
    };
    const first = createFunctionRuntimeApplicationErrorRegistryV1(
      _value => null,
      invalid,
    );
    const second = createFunctionRuntimeApplicationErrorRegistryV1(
      _value => null,
      invalid,
    );
    const declared = first.create("DECLARED", "declared");
    const spoof = new Error("declared");
    Object.defineProperty(spoof, "name", { value: "CoreApplicationErrorV1" });

    expect(first.inspect(declared)).toBe(true);
    expect(second.inspect(declared)).toBe(false);
    expect(first.inspect(spoof)).toBe(false);
    expect(first.inspect(null)).toBe(false);
    expect(first.inspect(() => undefined)).toBe(false);
    expect(() => second.code(declared)).toThrow("invalid declared error");
    expect(() => first.message(spoof)).toThrow("invalid declared error");
    expect(() => first.data(null)).toThrow("invalid declared error");
  });
});
