import assert from "node:assert/strict";
import { Cause } from "effect";
import { it } from "vitest";
import { CoreError, NativeFailure } from "../src/errors.ts";
import { failureEvidence } from "./measurement-errors.mjs";
import { writeSourceArtifact } from "./measurement-artifact.mjs";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("retains initiating native and Effect causes plus aggregate cleanup errors", () => {
  const core = new CoreError({ reason: "denied" });
  const native = new NativeFailure({ cause: new Error("native-business", { cause: Cause.fail(core) }) });
  const evidence = failureEvidence(new AggregateError([native, new Error("cleanup")], "body and cleanup"));
  assert.equal(evidence.errors[0]._tag, "NativeFailure");
  assert.equal(evidence.errors[0].cause.message, "native-business");
  assert.equal(evidence.errors[0].cause.cause.reasons[0].error.reason, "denied");
  assert.equal(evidence.errors[1].message, "cleanup");
});

it("bounds cyclic failure data without invoking diagnostic getters", () => {
  let getters = 0; const cause = { message: "original", get foreign() { getters++; throw new Error("must not run"); } };
  cause.cause = cause;
  assert.deepEqual(failureEvidence(cause), { message: "original", foreign: "[accessor omitted]", cause: "[circular]" });
  assert.equal(getters, 0);
});

it("omits indexed array getters, holes and overridden methods without executing them", () => {
  let called = 0; const errors = [new Error("first"), , new Error("third")];
  Object.defineProperty(errors, "0", { get: () => { called++; throw new Error("indexed getter"); }, enumerable: true });
  errors.map = errors.slice = () => { called++; throw new Error("overridden array method"); };
  const evidence = failureEvidence(new AggregateError([], "original", { cause: errors }));
  assert.equal(evidence.message, "original");
  assert.equal(evidence.cause[0], "[accessor omitted]"); assert.equal(evidence.cause[1], "[hole]");
  assert.equal(evidence.cause[2].message, "third"); assert.equal(called, 0);
});

it("rejects reuse of an interrupted inventory artifact and preserves its bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flarex-measurement-artifact-"));
  const source = { sha256: "fixture", files: 1, inventory: [{ path: "test.js", sha256: "bytes" }] };
  const path = join(directory, "connected-source-fixture.json");
  try {
    const first = await writeSourceArtifact(directory, source); assert.equal(first.artifact, "connected-source-fixture.json");
    assert.deepEqual(await writeSourceArtifact(directory, source), first);
    await writeFile(path, "{partial");
    await assert.rejects(writeSourceArtifact(directory, source), /incomplete or conflicting/);
    assert.equal(await readFile(path, "utf8"), "{partial");
  } finally { await rm(path, { force: true }); await rmdir(directory); }
});
