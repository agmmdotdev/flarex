import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { CoreRecoveryJournal } from "../../src/core/recoveryJournal";
import type { CoreRequestIdentity } from "../../src/core/api";

const request = (key: string): CoreRequestIdentity => ({ key, requestHash: key, kind: "nativeRoot", root: { definitionHash: "a".repeat(64) } });
describe("bounded app recovery census", () => {
  it("reserves before a claim can submit and never evicts unresolved correlations", () => {
    const journal = new CoreRecoveryJournal(1);
    const first = Result.getOrThrow(journal.enroll(request("first")));
    expect(journal.enroll(request("second"))).toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
    expect(journal.seal()).toEqual([first.identity]);
  });
  it("retains sealed uncertainty even when a late old completion arrives", () => {
    const journal = new CoreRecoveryJournal(2), first = Result.getOrThrow(journal.enroll(request("first")));
    const report = journal.seal(); journal.complete(first);
    expect(journal.seal()).toBe(report);
    expect(report).toEqual([request("first")]);
    expect(journal.enroll(request("second"))).toMatchObject({ _tag: "Failure", failure: { reason: "unavailable" } });
  });
  it("releases proven terminal entries and refuses changed request correlation", () => {
    const journal = new CoreRecoveryJournal(2), first = Result.getOrThrow(journal.enroll(request("first")));
    expect(journal.enroll({ ...request("first"), requestHash: "changed" })).toMatchObject({ _tag: "Failure", failure: { reason: "requestMismatch" } });
    journal.complete(first);
    expect(journal.seal()).toEqual([]);
  });
});
