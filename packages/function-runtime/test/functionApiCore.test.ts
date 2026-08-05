import { describe, expect, it, vi } from "vitest";

import type { UserIdentity } from "flarex-protocol/auth";

import {
  createFunctionRuntimeAuthV1,
  createFunctionRuntimePointDatabaseWriterV1,
  createFunctionRuntimePointReaderV1,
  createMutationFunctionRuntimeBaseContextV1,
  createQueryFunctionRuntimeBaseContextV1,
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

  it("constructs exact frozen query and mutation base contexts", async () => {
    const auth = createFunctionRuntimeAuthV1(
      Object.freeze({ kind: "anonymous" }),
      identity => identity,
    );
    const queryDb = Object.freeze({ get: vi.fn() });
    const mutationDb = Object.freeze({
      get: vi.fn(),
      insert: vi.fn(),
    });

    const query = createQueryFunctionRuntimeBaseContextV1(auth, queryDb);
    const mutation = createMutationFunctionRuntimeBaseContextV1(auth, mutationDb);

    expect(query).toEqual({ auth, db: queryDb });
    expect(mutation).toEqual({ auth, db: mutationDb });
    expect(query.db).toBe(queryDb);
    expect(mutation.db).toBe(mutationDb);
    expect(Object.keys(query)).toEqual(["auth", "db"]);
    expect(Object.keys(mutation)).toEqual(["auth", "db"]);
    expect(Object.isFrozen(query)).toBe(true);
    expect(Object.isFrozen(mutation)).toBe(true);
    expect("runQuery" in query).toBe(false);
    expect("runMutation" in mutation).toBe(false);
    expect("scheduler" in mutation).toBe(false);
    expect("storage" in mutation).toBe(false);
  });
});
