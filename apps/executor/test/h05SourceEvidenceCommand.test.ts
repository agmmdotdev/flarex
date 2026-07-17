import { describe, expect, it, vi } from "vitest";

const commandOutputMock = vi.hoisted(() => vi.fn());

vi.mock("../scripts/commandOutput", () => ({
  commandOutput: commandOutputMock,
}));

import {
  H05SourceEvidenceError,
  readH05SourceEvidence,
} from "../scripts/h05SourceEvidence";

describe("H05 source evidence commands", () => {
  it("maps child-process failures to the source-evidence error contract", () => {
    commandOutputMock.mockImplementation(() => {
      throw new Error("child-process failure sentinel");
    });

    try {
      readH05SourceEvidence();
      expect.unreachable("expected source evidence collection to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(H05SourceEvidenceError);
      if (!(error instanceof H05SourceEvidenceError)) throw error;
      expect(error.code).toBe("command-failed");
      expect(error.message).toBe("H05 source evidence command could not run.");
    }
  });
});
