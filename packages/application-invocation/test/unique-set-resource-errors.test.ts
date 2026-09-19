import { expect, it } from "vitest";
import { AppUniqueConstraintSetClosureResourceError } from "@flarex/persistence-postgres/internal/app-unique-constraint-set-closure-v1";
import { projectQueryInvocationError } from "../src/QueryInvocationError.js";
import { projectActionInvocationError } from "../src/ActionInvocationError.js";
import { projectTaskAdmissionError } from "../src/TaskAdmissionError.js";

it("preserves unique set hashing unavailability across invocation boundaries", () => {
  const cause = new Error("digest provider unavailable");
  const source = new AppUniqueConstraintSetClosureResourceError({ reason: "digestUnavailable", cause });
  for (const projected of [projectQueryInvocationError(source), projectActionInvocationError(source), projectTaskAdmissionError(source)]) {
    expect(projected.reason).toBe("unavailable");
    expect(projected.cause).toBe(source);
  }
  expect(source.cause).toBe(cause);
});
