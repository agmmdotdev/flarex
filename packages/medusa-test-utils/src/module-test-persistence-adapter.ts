export interface ModuleTestDatabaseConfig {
  clientUrl: string
  schema: string
  debug: boolean
}
export interface CreateModuleTestDatabaseConfigOptions {
  dbName: string
  schema: string
  debug: boolean
}
export interface ModuleTestDatabase {
  setupDatabase(): Promise<void>
  clearDatabase(): Promise<void>
}
export interface ModuleTestConnection {
  context?: {
    destroy(): Promise<void>
  }
  destroy(): Promise<void>
}
export interface PrepareModuleTestDatabaseOptions {
  connection: ModuleTestConnection
  moduleModels?: object[]
  resolve?: string
  cwd?: string
  dbConfig: ModuleTestDatabaseConfig
}
export interface PreparedModuleTestDatabase {
  database: ModuleTestDatabase
  models: object[]
}
export interface ModuleTestPersistenceAdapter {
  readonly name: string
  createDatabaseConfig(
    options: CreateModuleTestDatabaseConfigOptions
  ): ModuleTestDatabaseConfig
  createConnection(dbConfig: ModuleTestDatabaseConfig): ModuleTestConnection
  prepareDatabase(
    options: PrepareModuleTestDatabaseOptions
  ): PreparedModuleTestDatabase
  getInjectedDependencies(
    connection: ModuleTestConnection
  ): Record<string, unknown>
  getModuleOptions(
    dbConfig: ModuleTestDatabaseConfig,
    moduleOptions: Record<string, unknown>,
    connection: ModuleTestConnection
  ): Record<string | symbol, unknown>
  cleanupConnection(connection: ModuleTestConnection): Promise<void>
}
