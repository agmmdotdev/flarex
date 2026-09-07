import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { Currency } from "@medusajs/currency/models";
import { CurrencyModuleService } from "@medusajs/currency/services";
import initialData from "@medusajs/currency/initial-data";
import { asValue } from "@medusajs/deps/awilix";
import { MikroORM } from "@medusajs/deps/mikro-orm/postgresql";
import { createMedusaContainer } from "@medusajs/utils/common/medusa-container";
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service";
import { mikroOrmBaseRepositoryFactory } from "@medusajs/utils/dal/mikro-orm/mikro-orm-repository";
import { toMikroORMEntity } from "@medusajs/utils/dml/helpers/create-mikro-orm-entity";
import { pgliteModulePersistenceAdapter, pgliteModuleTestPersistenceAdapter } from "@medusajs/test-utils/pglite-module-test-persistence-adapter";
import type { DAL, ModulePersistenceAdapter } from "@medusajs/framework/types";

export type ComparisonDriver = "pglite" | "postgres";

// Foreign comparison resources have one Effect Scope per suite. They confer
// no Flarex transaction, installation, or publication authority.
export const currencyFixture = Effect.fn("MedusaComparison.currencyFixture")(
  function* (driver: ComparisonDriver) {
    const schema = `currency_${randomUUID().replaceAll("-", "")}`;
    const repository: ComparisonRepository = driver === "pglite"
      ? yield* pgliteRepository(schema)
      : yield* postgresRepository(schema);
    const internal = new (MedusaInternalService(Currency))<object, typeof Currency>({
      currencyRepository: repository.base,
      ...(repository.adapter ? { modulePersistenceAdapter: repository.adapter } : {}),
    });
    const service = new CurrencyModuleService({
      baseRepository: repository.base,
      currencyService: internal,
    }, { scope: "internal" });
    const container = createMedusaContainer();
    const warnings: string[] = [];
    container.register({
      currencyModuleService: asValue(service),
      logger: asValue({ debug() {}, warn(message: string) { warnings.push(message); } }),
    });
    yield* Effect.promise(() => initialData({ container }));
    if (warnings.length !== 0) throw new Error(warnings.join("\n"));
    return { service, internal, container };
  },
);

type ComparisonRepository = Readonly<{
  base: DAL.RepositoryService;
  adapter?: ModulePersistenceAdapter;
}>;

const pgliteRepository = Effect.fn("MedusaComparison.pgliteRepository")(
  function* (schema: string) {
    const adapter = pgliteModuleTestPersistenceAdapter;
    const config = adapter.createDatabaseConfig({ dbName: schema, schema, debug: false });
    const connection = yield* Effect.acquireRelease(
      Effect.sync(() => adapter.createConnection(config)),
      (value) => Effect.promise(() => adapter.cleanupConnection(value)),
    );
    const prepared = adapter.prepareDatabase({ connection, moduleModels: [Currency], dbConfig: config });
    yield* Effect.promise(() => prepared.database.setupDatabase());
    const Repository = pgliteModulePersistenceAdapter.createRepository(Currency);
    const base = new Repository({ manager: connection });
    if (typeof base === "function") throw new Error("Repository factory returned a constructor");
    return {
      base,
      adapter: pgliteModulePersistenceAdapter,
    } satisfies ComparisonRepository;
  },
);

const postgresRepository = Effect.fn("MedusaComparison.postgresRepository")(
  function* (schema: string) {
    const clientUrl = process.env.FLAREX_POSTGRES_DATABASE_URL;
    if (!clientUrl) throw new Error("PostgreSQL comparison requires FLAREX_POSTGRES_DATABASE_URL");
    const entity = toMikroORMEntity(Currency);
    const orm = yield* Effect.acquireRelease(
      Effect.promise(() => MikroORM.init({ clientUrl, entities: [entity], schema,
        driverOptions: { connection: { options: `-c search_path=${schema}` } } })),
      (value) => Effect.promise(() => value.close(true)),
    );
    // The schema is an internally generated identifier. Register cleanup before
    // DDL so partial comparison setup is also removed, including the namespace.
    yield* Effect.addFinalizer(() => Effect.promise(() =>
      orm.em.getConnection().execute(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)));
    yield* Effect.promise(() => orm.schema.createSchema());
    const Repository = mikroOrmBaseRepositoryFactory(entity);
    return { base: new Repository({ manager: orm.em.fork() }) } satisfies ComparisonRepository;
  },
);
