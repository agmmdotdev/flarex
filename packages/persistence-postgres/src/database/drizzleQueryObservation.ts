type DrizzleQueryObservation<Name extends string> = Readonly<{
  readonly name: Name;
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}>;

type DrizzleQueryObserver<Name extends string> = (
  observation: DrizzleQueryObservation<Name>,
) => void;

type CompilableDrizzleQuery = Readonly<{
  toSQL: () => Readonly<{
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
  }>;
}>;

type CompiledDrizzleRawQuery = Readonly<{
  getQuery: () => Readonly<{
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
  }>;
}>;

/** Captures a detached test observation of one compiled Drizzle query. */
export function observeDrizzleQuery<Name extends string>(
  name: Name,
  query: CompilableDrizzleQuery,
  observer: DrizzleQueryObserver<Name> | undefined,
): void {
  if (observer === undefined) return;
  const compiled = query.toSQL();
  observer(Object.freeze({
    name,
    sql: compiled.sql,
    params: Object.freeze(structuredClone(compiled.params)),
  }));
}

/** Captures a detached test observation of one compiled Drizzle raw query. */
export function observeDrizzleRawQuery<Name extends string>(
  name: Name,
  query: CompiledDrizzleRawQuery,
  observer: DrizzleQueryObserver<Name> | undefined,
): void {
  if (observer === undefined) return;
  const compiled = query.getQuery();
  observer(Object.freeze({
    name,
    sql: compiled.sql,
    params: Object.freeze(structuredClone(compiled.params)),
  }));
}
