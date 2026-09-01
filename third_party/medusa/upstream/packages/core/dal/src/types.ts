import type { PortableEntity } from "@medusajs/dml"

export type Primitive = string | number | boolean | Date | null

export type FilterOperator = {
  $eq?: Primitive
  $ne?: Primitive
  $gt?: Primitive
  $gte?: Primitive
  $lt?: Primitive
  $lte?: Primitive
  $in?: Primitive[]
  $nin?: Primitive[]
}

export type FilterQuery<T extends object = Record<string, unknown>> = {
  [K in keyof T]?: T[K] | T[K][] | FilterOperator
} & {
  $and?: FilterQuery<T>[]
  $or?: FilterQuery<T>[]
}

export interface FindOptions<T extends object = Record<string, unknown>> {
  where?: FilterQuery<T>
  select?: (keyof T & string)[]
  orderBy?: Partial<Record<keyof T & string, "ASC" | "DESC">>
  take?: number
  skip?: number
  withDeleted?: boolean
}

export interface DatabaseSession {
  readonly dialect: "sqlite" | "postgres" | "memory"
  transaction<T>(operation: (session: DatabaseSession) => Promise<T>): Promise<T>
}

export interface RepositoryContext {
  session?: DatabaseSession
  mutationSink?: MutationSink
}

export interface Mutation {
  action: "created" | "updated" | "deleted" | "restored"
  entity: string
  data: Record<string, unknown>
}

export interface MutationSink {
  emit(mutation: Mutation): void | Promise<void>
}

export interface RepositoryService<T extends object = Record<string, unknown>> {
  readonly entity: PortableEntity
  readonly session: DatabaseSession

  find(options?: FindOptions<T>, context?: RepositoryContext): Promise<T[]>
  findAndCount(
    options?: FindOptions<T>,
    context?: RepositoryContext
  ): Promise<[T[], number]>
  create(data: Partial<T>[], context?: RepositoryContext): Promise<T[]>
  update(
    data: Array<{ entity: T; update: Partial<T> }>,
    context?: RepositoryContext
  ): Promise<T[]>
  delete(where: FilterQuery<T>, context?: RepositoryContext): Promise<T[]>
  softDelete(where: FilterQuery<T>, context?: RepositoryContext): Promise<T[]>
  restore(where: FilterQuery<T>, context?: RepositoryContext): Promise<T[]>
  upsert(data: Partial<T>[], context?: RepositoryContext): Promise<T[]>
  serialize<TOutput>(data: TOutput): Promise<TOutput>
}

export interface InternalService<T extends object> {
  retrieve(
    primaryKey: Primitive | Record<string, Primitive>,
    options?: FindOptions<T>,
    context?: RepositoryContext
  ): Promise<T>
  list(
    filters?: FilterQuery<T>,
    options?: Omit<FindOptions<T>, "where">,
    context?: RepositoryContext
  ): Promise<T[]>
  listAndCount(
    filters?: FilterQuery<T>,
    options?: Omit<FindOptions<T>, "where">,
    context?: RepositoryContext
  ): Promise<[T[], number]>
  create(data: Partial<T> | Partial<T>[], context?: RepositoryContext): Promise<T | T[]>
  update(
    data: Partial<T> | Partial<T>[],
    context?: RepositoryContext
  ): Promise<T | T[]>
  delete(
    primaryKey: Primitive | Primitive[] | Record<string, Primitive>,
    context?: RepositoryContext
  ): Promise<void>
  softDelete(
    primaryKey: Primitive | Primitive[] | Record<string, Primitive>,
    context?: RepositoryContext
  ): Promise<void>
  restore(
    primaryKey: Primitive | Primitive[] | Record<string, Primitive>,
    context?: RepositoryContext
  ): Promise<void>
  upsert(data: Partial<T> | Partial<T>[], context?: RepositoryContext): Promise<T | T[]>
}
