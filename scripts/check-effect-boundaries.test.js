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

  describe.each(["runPromiseExit", "runPromiseExitWith", "runPromiseWith"])("%s boundaries", method => {
    const call = method === "runPromiseExit"
      ? "Effect.runPromiseExit(effect)" : `Effect.${method}(context)(effect)`;
    const site = `${sourcePath} :: runBoundary`;

    it("accepts only the exact audited variant and count", () => {
      const source = `import { Effect } from "effect";
        function runBoundary() { return ${call}; }`;
      const report = analyzeExitSource(source, method, new Map([[site, 1]]));
      expect(report.errors).toEqual([]);
      const otherMethod = method === "runPromiseExit" ? "runPromiseExitWith" : "runPromiseExit";
      expect(analyzeExitSource(source, otherMethod, new Map([[site, 1]])).errors.join("\n"))
        .toContain(`Unexpected production Effect.${method} boundary`);
    });

    it("rejects an unaudited boundary", () => {
      const report = analyzeSource(`import { Effect } from "effect";
        function runBoundary() { return ${call}; }`);
      expect(report.errors).toEqual([`Unexpected production Effect.${method} boundary at ${site} (1).`]);
    });

    it("does not let literal element access bypass site counting", () => {
      const report = analyzeSource(`import { Effect } from "effect";
        function runBoundary() { return Effect["${method}"](effect); }`);
      expect(report.errors).toEqual([`Unexpected production Effect.${method} boundary at ${site} (1).`]);
    });

    it("rejects duplicate and missing audited calls", () => {
      const report = analyzeExitSource(`import { Effect } from "effect";
        function runBoundary() { ${call}; return ${call}; }`, method, new Map([[site, 1]]));
      expect(report.errors).toEqual([
        `Production Effect.${method} boundary count changed at ${site}: expected 1, found 2.`,
      ]);
      expect(analyzeExitSource("", method, new Map([[site, 1]])).errors).toEqual([
        `Allowed production Effect.${method} boundary is missing at ${site}: expected 1.`,
      ]);
    });

    it("counts and refuses direct import aliases even at audited sites", () => {
      const report = analyzeExitSource(`import { ${method} as execute } from "effect/Effect";
        function runBoundary() { return execute(effect); }`, method, new Map([[site, 1]]));
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]).toContain("must not import Effect runtime APIs directly");
      expect(report.forbiddenRuntimeImportMatches[0]).toContain(`imports ${method} as execute`);
    });

    it("counts and refuses namespace, property and destructuring aliases", () => {
      const report = analyzeExitSource(`import { Effect as Fx } from "effect";
        const Local = Fx;
        const execute = Local.${method};
        const again = execute;
        const { ${method}: destructured } = Local;
        function runBoundary() { execute(effect); again(effect); return destructured(effect); }`,
      method, new Map([[site, 3]]));
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]).toContain("must not alias Effect runtime APIs");
      expect(report.forbiddenAliasMatches).toHaveLength(4);
      expect(report.forbiddenAliasMatches[2]).toContain("aliases execute as again");
    });

    it("checks generated calls and aliases with exact generated owners", () => {
      const generatedSite = `${sourcePath} :: workerSource <generated:runBoundary>`;
      const report = analyzeExitSource(`function workerSource() {
        return \`import { ${method} as execute } from "effect/Effect";
          function runBoundary() { return execute(effect); }\`;
      }`, method, new Map([[generatedSite, 1]]));
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]).toContain("must not import Effect runtime APIs directly");
      expect(report.forbiddenRuntimeImportMatches[0]).toContain("workerSource<generated>");
      const unexpected = analyzeSource(`function workerSource() {
        return \`import { Effect } from "effect";
          function runBoundary() { return ${call}; }\`;
      }`);
      expect(unexpected.errors).toEqual([
        `Unexpected production Effect.${method} boundary at ${generatedSite} (1).`,
      ]);
    });
  });

  it.each(["runPromiseExitWith", "runPromiseWith"])("rejects aliasing a contextual runner returned by %s", method => {
    const report = analyzeExitSource(`import { Effect } from "effect";
      function runBoundary() {
        const run = Effect.${method}(context);
        return run(effect);
      }`, method, new Map([[`${sourcePath} :: runBoundary`, 1]]));
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain("must not alias Effect runtime APIs");
    expect(report.forbiddenAliasMatches[0]).toContain(`aliases Effect.${method}(context) as run`);
  });

  it.each([
    ["activation", "runLocatedTransaction", `const runLocatedTransaction = Effect.fn("ApplicationActivation.runTransaction")(
      function* (target, body) {
        const promise = target.run(async tx => {
          const result = await Effect.runPromiseExit(body(tx));
          return result;
        });
        return yield* Effect.tryPromise(() => promise);
      });`],
    ["readiness", "runLocatedTransaction", `const runLocatedTransaction = Effect.fn(
      "ApplicationReadiness.runLocatedTransaction",
    )(function* (target, body) {
      const promise = target.run(async tx => await Effect.runPromiseExit(body(tx)));
      return yield* Effect.tryPromise(() => promise);
    });`],
    ["logical backfill", "backfillLogicalReadProjections", `export const backfillLogicalReadProjections =
      Effect.fn("LogicalStorageDefinitions.backfillReadProjections")(function* (database) {
        for (;;) {
          const page = yield* Effect.suspend(() => {
            const body = tx => Effect.succeed(tx);
            return Effect.uninterruptible(Effect.tryPromise({
              try: () => database.transaction(async tx => {
                const exit = await Effect.runPromiseExit(body(tx));
                return exit;
              }), catch: cause => cause,
            }));
          });
          if (page.length === 0) return;
        }
      });`],
    ["installation verification", "verifyAndPublish", `const verifyAndPublish =
      Effect.fn("InstallationMaintenance.verifyAndPublish")(function* (owner, policies) {
        for (const policy of policies) {
          const verified = yield* Effect.uninterruptible(Effect.tryPromise({
            try: () => policy.database.transaction(async tx => {
              return Effect.runPromiseExit(Effect.gen(function* () {
                return yield* attest(tx);
              }));
            }), catch: cause => cause,
          }));
        }
      });`],
  ])("attributes actual %s Effect.fn construction to its exact owner", (_label, owner, source) => {
    const site = `${sourcePath} :: ${owner}`;
    const report = analyzeExitSource(`import { Effect } from "effect"; ${source}`,
      "runPromiseExit", new Map([[site, 1]]));
    expect(report.errors).toEqual([]);
    expect(Array.from(report.runPromiseExitSiteCounts)).toEqual([[site, 1]]);
    expect(analyzeExitSource(`import { Effect } from "effect"; ${source}`,
      "runPromiseExit", new Map([[site, 2]])).errors).toEqual([
      `Production Effect.runPromiseExit boundary count changed at ${site}: expected 2, found 1.`,
    ]);
  });

  it("uses imported Effect aliases for fn ownership without naming ordinary transaction callbacks", () => {
    const report = analyzeExitSource(`import { Effect as Fx } from "effect";
      const owner = Fx.fn("owner")(function* () {
        const started = database.transaction(async tx => await Fx.runPromiseExit(body(tx)));
        return yield* Fx.tryPromise(() => started);
      });`, "runPromiseExit", new Map([[`${sourcePath} :: owner`, 1]]));
    expect(report.errors).toEqual([]);
    expect(report.runPromiseExitSiteCounts.has(`${sourcePath} :: started`)).toBe(false);
  });

  it("does not attribute unrelated call wrappers as Effect.fn operations", () => {
    const report = analyzeSource(`import { Effect } from "effect";
      const unrelated = Other.fn("unrelated")(async () => Effect.runPromiseExit(effect));`);
    expect(report.errors).toEqual([
      `Unexpected production Effect.runPromiseExit boundary at ${sourcePath} :: <module> (1).`,
    ]);
  });

  it.each(["variable", "property"])("enforces three distinct factory-held Effect.fn %s owners", form => {
    const names = ["claimForCommit", "claimReadyBatch", "settleClaim"];
    const operations = names.map(name => {
      const callback = `Effect.fn("CommitWakeOutbox.${name}")(function* (input) {
        const result = yield* executeTransaction("${name}", () => database.transaction(async tx => {
          await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
          try { return await work(tx, input); }
          finally { closeInstallationAdmission(tx); }
        }));
        return result;
      })`;
      return form === "variable" ? `const ${name} = ${callback};` : `${name}: ${callback}`;
    });
    const source = `import { Effect } from "effect";
      function createRepository() {
        ${form === "variable" ? operations.join("\n") : ""}
        return Object.freeze({ ${form === "variable" ? names.join(", ") : operations.join(",\n")} });
      }`;
    const allowed = new Map(names.map(name => [`${sourcePath} :: ${name}`, 1]));
    const report = analyzeSource(source, allowed);
    expect(report.errors).toEqual([]);
    expect(Array.from(report.runPromiseSiteCounts)).toEqual(Array.from(allowed));
    expect(analyzeSource(source, new Map([[`${sourcePath} :: createRepository`, 3]])).errors).toEqual([
      ...names.map(name => `Unexpected production Effect.runPromise boundary at ${sourcePath} :: ${name} (1).`),
      `Allowed production Effect.runPromise boundary is missing at ${sourcePath} :: createRepository: expected 3.`,
    ]);
    const duplicate = source.replace("await Effect.runPromise(lockInstallationForCurrentTransaction(tx));",
      "await Effect.runPromise(lockInstallationForCurrentTransaction(tx)); await Effect.runPromise(extra(tx));");
    expect(analyzeSource(duplicate, allowed).errors).toEqual([
      `Production Effect.runPromise boundary count changed at ${sourcePath} :: claimForCommit: expected 1, found 2.`,
    ]);
  });
});

/**
 * @param {string} text
 * @param {Map<string, number>} [allowedSites]
 */
function analyzeSource(text, allowedSites = new Map()) {
  return analyzeEffectRuntimeBoundaries([{ relativePath: sourcePath, text }], allowedSites, new Map(), new Map(), new Map());
}

/**
 * @param {string} text
 * @param {string} method
 * @param {Map<string, number>} allowedSites
 */
function analyzeExitSource(text, method, allowedSites) {
  return analyzeEffectRuntimeBoundaries([{ relativePath: sourcePath, text }], new Map(),
    method === "runPromiseExit" ? allowedSites : new Map(),
    method === "runPromiseExitWith" ? allowedSites : new Map(),
    method === "runPromiseWith" ? allowedSites : new Map());
}
