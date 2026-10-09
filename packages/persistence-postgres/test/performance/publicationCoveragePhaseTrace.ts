import { Option, Tracer } from "effect";
import { expect } from "vitest";

/** Observe existing owner spans under the actual coverage callback. Unrelated
 * preparation reads are outside this phase and retain their original order. */
export function publicationCoveragePhaseTrace() {
  let candidateFailed = false;
  const coverage: Array<{ candidateFailed: boolean; name: string }> = [];
  const tracer = Tracer.make({ span(options) {
    let parent = Option.getOrUndefined(options.parent);
    let withinCoverage = options.name === "IndexBuildState.readCoverageContext";
    while (parent !== undefined && parent._tag === "Span") {
      if (parent.name === "IndexBuildState.readCoverageContext") withinCoverage = true;
      parent = Option.getOrUndefined(parent.parent);
    }
    if (withinCoverage) coverage.push({ candidateFailed, name: options.name });
    return new Tracer.NativeSpan(options);
  } });
  return {
    tracer,
    candidateFailed() { candidateFailed = true; expect(coverage).toEqual([]); },
    reset() { candidateFailed = false; coverage.length = 0; },
    assertProtectedSnapshot() {
      expect(candidateFailed).toBe(true);
      expect(coverage.filter(entry => entry.name === "IndexBuildState.readCoverageContext")).toHaveLength(1);
      expect(coverage.every(entry => entry.candidateFailed)).toBe(true);
      expect(coverage.filter(entry => entry.name === "ApplicationActiveHead.decodeMaterializationObservation")).toHaveLength(1);
      expect(coverage.some(entry => entry.name === "ApplicationActiveHead.readCoherentForShareInTransaction")).toBe(false);
      expect(coverage.some(entry => entry.name === "ApplicationActiveHead.readSchemaForHead")).toBe(false);
    },
    assertFullProof(schemaReads: 0 | 1) {
      expect(candidateFailed).toBe(true);
      expect(coverage.filter(entry => entry.name === "IndexBuildState.readCoverageContext")).toHaveLength(1);
      expect(coverage.every(entry => entry.candidateFailed)).toBe(true);
      expect(coverage.filter(entry => entry.name === "ApplicationActiveHead.readCoherentForShareInTransaction")).toHaveLength(1);
      expect(coverage.filter(entry => entry.name === "ApplicationActiveHead.readSchemaForHead")).toHaveLength(schemaReads);
      expect(coverage.some(entry => entry.name === "ApplicationActiveHead.decodeMaterializationObservation")).toBe(false);
    },
  };
}
