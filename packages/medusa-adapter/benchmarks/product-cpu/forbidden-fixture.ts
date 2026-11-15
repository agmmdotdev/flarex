// Bundling substitutes only the unused physical database constructors.
// The real commerce/Core fixture receives an explicit in-memory persistence port.
export async function createCorePGliteFixture(): Promise<never> { throw new Error("PGlite is forbidden in this benchmark"); }
export async function createCorePostgresFixture(): Promise<never> { throw new Error("PostgreSQL is forbidden in this benchmark"); }
