export const ScopeIsolationKinds = {
  sharedDatabase: "shared_database",
  schemaPerScope: "schema_per_scope",
  databasePerScope: "database_per_scope",
} as const satisfies Readonly<Record<string, string>>;

export type ScopeIsolationKind =
  (typeof ScopeIsolationKinds)[keyof typeof ScopeIsolationKinds];

interface ScopePhysicalLocatorBase {
  readonly databaseKey: string;
  readonly schemaName: string;
}

export type ScopePhysicalLocator = {
  [Kind in ScopeIsolationKind]: ScopePhysicalLocatorBase & {
    readonly kind: Kind;
  };
}[ScopeIsolationKind];

export type ScopePlacement = {
  [Kind in ScopeIsolationKind]: {
    readonly isolationKind: Kind;
    readonly physicalLocator: Extract<
      ScopePhysicalLocator,
      { readonly kind: Kind }
    >;
  };
}[ScopeIsolationKind];
