import type { PostgresMigrationObserverInput } from "../src/migrationCoordination/postgresTargetConnection";

interface QueryWork {
  statements: number;
  milliseconds: number;
}

/** Diagnostic observations only. The test owns operations and assertions.
 * CPU time is process-wide: compare profiles with one worker and serial tests.
 * SQL time includes transport and row delivery, and is not server CPU time. */
export function frameworkWorkMeasurement() {
  let statements = 0, transactionStatements = 0, maximumTransactionStatements = 0;
  let acquisitionMilliseconds = 0;
  const pending = new WeakMap<object, { start: number; query: string }>();
  const queries = new Map<string, QueryWork>();
  const measurements: {
    phase: string; statements: number; milliseconds: number; cpuMilliseconds: number;
    sqlMilliseconds: number; queries: { query: string; statements: number; milliseconds: number }[];
  }[] = [];
  const observe = (event: PostgresMigrationObserverInput) => {
    if (event.phase === "acquire") acquisitionMilliseconds += event.elapsedMilliseconds ?? 0;
    if (event.phase === "begin" && event.edge === "before") transactionStatements = 0;
    if (event.phase === "release" && event.edge === "before") {
      maximumTransactionStatements = Math.max(maximumTransactionStatements, transactionStatements);
    }
    if (event.phase !== "work") return;
    if (event.edge === "before") {
      statements += 1;
      transactionStatements += 1;
      // Group compiled SQL by operation and first table, never parameter values.
      const operation = event.text?.match(/^\s*(select|insert|update|delete)\b/i)?.[1];
      const table = event.text?.match(/\b(?:from|into|update)\s+"?([a-z_][a-z_0-9]*)/i)?.[1];
      pending.set(event.client, { start: performance.now(), query: operation === undefined || table === undefined
        ? "other" : `${operation.toLowerCase()} ${table}` });
    } else {
      const work = pending.get(event.client);
      if (work === undefined) return;
      pending.delete(event.client);
      const entry = queries.get(work.query) ?? { statements: 0, milliseconds: 0 };
      entry.statements += 1;
      entry.milliseconds += performance.now() - work.start;
      queries.set(work.query, entry);
    }
  };
  // Promise is the Vitest callback boundary, not a second Effect runtime.
  const measure = async <Value>(phase: string, work: () => Promise<Value>): Promise<Value> => {
    const before = statements, start = performance.now(), cpu = process.cpuUsage();
    const prior = new Map([...queries].map(([query, value]) => [query, { ...value }]));
    const result = await work();
    const used = process.cpuUsage(cpu);
    const current = [...queries].map(([query, value]) => ({ query,
      statements: value.statements - (prior.get(query)?.statements ?? 0),
      milliseconds: value.milliseconds - (prior.get(query)?.milliseconds ?? 0),
    })).filter(value => value.statements > 0).sort((a, b) => b.statements - a.statements);
    measurements.push({ phase, statements: statements - before,
      milliseconds: Math.round(performance.now() - start),
      cpuMilliseconds: Math.round((used.user + used.system) / 1_000),
      sqlMilliseconds: Math.round(current.reduce((sum, value) => sum + value.milliseconds, 0)),
      queries: current.map(value => ({ ...value, milliseconds: Math.round(value.milliseconds) })),
    });
    return result;
  };
  return { observe, measure, measurements,
    totals: () => ({ totalStatements: statements, maximumTransactionStatements,
      acquisitionMilliseconds: Math.round(acquisitionMilliseconds) }),
  };
}
