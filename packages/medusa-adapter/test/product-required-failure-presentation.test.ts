import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { Cause, Context, Effect, Exit, Result } from "effect";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { inspectLogicalRelationalFailure } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { coreNativeRelationalRows } from "@flarex/persistence-postgres/internal/core";
import { projectCoreCommerceFailure } from "../../persistence-postgres/src/frameworks/commerceTransaction/nativeFailure";
import { retainRelationalFailure } from "../../persistence-postgres/src/values/relationalFailure";
import { compileProductCoreDefinition, captureProductSchema } from "../src/modules/product/schema";
import { compileCurrencyCoreDefinition } from "../src/modules/currency/schema";
import { productRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { prepareProductRequiredFailurePresentation } from "../src/modules/product/required-failure-presentation";
import { captureCommerceInput } from "../src/value/input";

let product: Effect.Success<ReturnType<typeof compileProductCoreDefinition>>;
let foreign: Effect.Success<ReturnType<typeof compileCurrencyCoreDefinition>>;
let metadata: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
let present: Result.Result.Success<ReturnType<typeof prepareProductRequiredFailurePresentation>>;
const Annotation = Context.Service<string>("ProductRequiredFailureTest");
const stamp = "2026-11-10T00:00:00.000Z";
beforeAll(async () => {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  product = await Effect.runPromise(compileProductCoreDefinition(target));
  foreign = await Effect.runPromise(compileCurrencyCoreDefinition(target));
  metadata = await Effect.runPromise(captureProductSchema("product-required-failure-test")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  present = Result.getOrThrow(prepareProductRequiredFailurePresentation({ metadata, definition: product }));
});
function issued(nullHandle = false) {
  const table = product.tables.find(table => table.localName === "product");
  if (table === undefined) throw new Error("Missing native Product table");
  const policy = coreNativeRelationalRows(product, table.name);
  if (policy === undefined) throw new Error("Missing native Product row policy");
  const candidate = Result.getOrThrow(captureCommerceInput({ id: "product-required", title: "Missing", ...(nullHandle ? { handle: null } : {}) }));
  if (!isJsonObject(candidate)) throw new Error("Invalid fixed Product candidate");
  const result = policy.rows.normalize(candidate, null, stamp);
  if (Result.isSuccess(result)) throw new Error("Required handle was accepted");
  return projectCoreCommerceFailure(result.failure);
}
async function projected(cause: Cause.Cause<CommerceTransactionError>) {
  const exit = await Effect.runPromiseExit(present(Effect.failCause(cause)));
  if (Exit.isSuccess(exit)) throw new Error("Required failure was recovered");
  return exit.cause;
}

describe("settled Product required-field presentation", () => {
  it.each([false, true])("presents only genuine issued missing/null nonnullable evidence, null=%s", async nullHandle => {
    const failure = issued(nullHandle), original = Cause.annotate(Cause.fail(failure), Context.make(Annotation, "original"));
    const result = await projected(original), reason = result.reasons[0];
    if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Expected typed native presentation");
    expect(reason.error.reason).toBe("adapterFailure");
    const native = reason.error.cause;
    if (!(native instanceof MedusaError)) throw new Error("Missing genuine native error");
    expect(native.type).toBe(MedusaError.Types.INVALID_DATA);
    expect(native.message).toBe("Cannot set field 'handle' of Product to null");
    expect(native.cause).toBe(original);
    expect(reason.annotations.get(Annotation.key)).toBe("original");
    expect(failure.reason).toBe("invalidInput");
    expect(inspectLogicalRelationalFailure(failure)).toBeDefined();
  });

  it("reuses one native presentation for duplicate original references and keeps rollback markers", async () => {
    const failure = issued(), marker = commerceError("rollbackOnly");
    const original = Cause.combine(Cause.combine(
      Cause.annotate(Cause.fail(failure), Context.make(Annotation, "first")),
      Cause.annotate(Cause.fail(failure), Context.make(Annotation, "second"))), Cause.fail(marker));
    const result = await projected(original);
    const failures = result.reasons.filter(Cause.isFailReason);
    expect(failures.map(reason => reason.error.reason)).toEqual(["adapterFailure", "adapterFailure", "rollbackOnly"]);
    expect(failures[0]?.error).toBe(failures[1]?.error);
    expect(failures[0]?.error.cause).toBe(failures[1]?.error.cause);
    expect(failures[2]?.error).toBe(marker);
    expect(failures.map(reason => reason.annotations.get(Annotation.key))).toEqual(["first", "second", undefined]);
  });

  it("refuses structural forged evidence and authentic evidence from a foreign table", async () => {
    const original = issued(), evidence = inspectLogicalRelationalFailure(original);
    const forged = commerceError("invalidInput", { diagnostic: evidence });
    expect(await projected(Cause.fail(forged))).toEqual(Cause.fail(forged));
    const table = foreign.tables[0], policy = table === undefined ? undefined : coreNativeRelationalRows(foreign, table.name);
    if (policy === undefined) throw new Error("Missing native Currency policy");
    const refused = policy.rows.normalize({ code: "usd" }, null, stamp);
    if (Result.isSuccess(refused)) throw new Error("Missing Currency columns were accepted");
    const failure = projectCoreCommerceFailure(refused.failure);
    expect(inspectLogicalRelationalFailure(failure)).toBeDefined();
    const cause = Cause.fail(failure);
    expect(await projected(cause)).toBe(cause);
    expect(Result.isFailure(prepareProductRequiredFailurePresentation({ metadata, definition: foreign }))).toBe(true);
  });

  it("requires nonnullable known columns and matching captured candidates even for registered diagnostics", async () => {
    const evidence = inspectLogicalRelationalFailure(issued());
    if (evidence === undefined || evidence.candidate === undefined) throw new Error("Missing issued required diagnostic");
    for (const diagnostic of [
      { ...evidence, kind: "null" as const, column: "subtitle" },
      { ...evidence, kind: "missing" as const, column: "title" },
      { ...evidence, kind: "null" as const, column: "handle" },
      { ...evidence, kind: "missing" as const, column: "undeclared" },
      { table: evidence.table, origin: "row" as const, kind: "missing" as const, column: "handle" },
    ]) {
      const failure = commerceError("invalidInput");
      // Deliberately inconsistent issuer diagnostics exercise the presenter's
      // independent compiled-metadata checks using the existing registry.
      retainRelationalFailure(failure, diagnostic);
      const cause = Cause.fail(failure);
      expect(await projected(cause)).toBe(cause);
    }
  });

  it("preserves mixed failures, defects and interruption without a native projection", async () => {
    const failure = issued();
    for (const extra of [Cause.fail(commerceError("resourceFailure")), Cause.fail(issued()), Cause.die(new Error("defect")), Cause.interrupt(123)]) {
      const cause = Cause.combine(Cause.fail(failure), Cause.annotate(extra, Context.make(Annotation, "other")));
      expect(await projected(cause)).toBe(cause);
    }
  });

  it("retains successful results and marker-only failures", async () => {
    expect(await Effect.runPromise(present(Effect.succeed({ retained: true })))).toEqual({ retained: true });
    const cause = Cause.fail(commerceError("rollbackOnly"));
    expect(await projected(cause)).toBe(cause);
  });
});
