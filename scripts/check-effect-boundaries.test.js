// @ts-check
import { describe, expect, it } from "vitest";
import { analyzeEffectRuntimeBoundaries } from "./check-effect-boundaries.mjs";

const sourcePath = "packages/example/src/runtime.ts";

describe("Effect runtime boundary checker", () => {
  it("accepts audited runPromise production boundaries", () => {
    const report = analyzeSource(
      `
        import { Effect } from "effect";

        export function runBoundary() {
          return Effect.runPromise(Effect.succeed(1));
        }
      `,
      new Map([[`${sourcePath} :: runBoundary`, 1]]),
    );

    expect(report.errors).toEqual([]);
  });

  it("rejects generated production runSync boundaries", () => {
    const suffix = "}";
    const report = analyzeSource(`
      export function analysisWorkerSource() {
        return \`const generatedPrefix = "\${1}";
          import { Effect } from "effect";

          export function analyze() {
            return Effect.runSync(Effect.succeed(1));
          }
        \${suffix}\`;
      }
    `);

    expect(report.errors.join("\n")).toContain("Production source must not use Effect.runSync.");
    expect(report.runSyncMatches).toEqual([
      `${sourcePath}:analysisWorkerSource<generated>:5`,
    ]);
  });

  it("rejects local Effect namespace aliases", () => {
    const report = analyzeSource(`
      import { Effect } from "effect";

      const Fx = Effect;

      export function runBoundary() {
        return Fx.runPromise(Effect.succeed(1));
      }
    `);

    expect(report.errors.join("\n")).toContain("must not alias Effect runtime APIs");
    expect(report.forbiddenAliasMatches).toEqual([
      `${sourcePath}:4 aliases Effect as Fx`,
    ]);
  });

  it("rejects local Effect runtime destructuring", () => {
    const report = analyzeSource(`
      import { Effect } from "effect";

      const { runPromise } = Effect;

      export function runBoundary() {
        return runPromise(Effect.succeed(1));
      }
    `);

    expect(report.errors.join("\n")).toContain("must not alias Effect runtime APIs");
    expect(report.forbiddenAliasMatches).toEqual([
      `${sourcePath}:4 destructures Effect as runPromise`,
    ]);
  });

  it("rejects local Effect runtime property aliases", () => {
    const report = analyzeSource(`
      import { Effect } from "effect";

      const run = Effect.runPromise;
      const runNow = Effect.runSync;

      export function runBoundary() {
        run(Effect.succeed(1));
        return runNow(Effect.succeed(2));
      }
    `);

    expect(report.errors.join("\n")).toContain("must not alias Effect runtime APIs");
    expect(report.forbiddenAliasMatches).toEqual([
      `${sourcePath}:4 aliases Effect.runPromise as run`,
      `${sourcePath}:5 aliases Effect.runSync as runNow`,
    ]);
  });

  it("rejects direct runtime imports outside audited boundaries", () => {
    const report = analyzeSource(`
      import { Effect, runPromise, runSync } from "effect";

      export function runBoundary() {
        runPromise(Effect.succeed(1));
        return runSync(Effect.succeed(2));
      }
    `);

    expect(report.errors.join("\n")).toContain(
      `Unexpected production Effect.runPromise boundary at ${sourcePath} :: runBoundary (1).`,
    );
    expect(report.errors.join("\n")).toContain("Production source must not use Effect.runSync.");
    expect(report.errors.join("\n")).toContain("must not import Effect runtime APIs directly");
    expect(report.runSyncMatches).toEqual([`${sourcePath}:6`]);
  });

  it("rejects direct runtime import aliases inside audited boundaries", () => {
    const report = analyzeSource(
      `
        import { Effect, runPromise as execute } from "effect";

        export function runBoundary() {
          return execute(Effect.succeed(1));
        }
      `,
      new Map([[`${sourcePath} :: runBoundary`, 1]]),
    );

    expect(report.errors.join("\n")).toContain("must not import Effect runtime APIs directly");
    expect(report.forbiddenRuntimeImportMatches).toEqual([
      `${sourcePath}:2 imports runPromise as execute`,
    ]);
  });
});

/**
 * @param {string} text
 * @param {Map<string, number>} [allowedSites]
 */
function analyzeSource(text, allowedSites = new Map()) {
  return analyzeEffectRuntimeBoundaries([{ relativePath: sourcePath, text }], allowedSites);
}
