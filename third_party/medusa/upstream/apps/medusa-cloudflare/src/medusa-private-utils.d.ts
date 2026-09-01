declare module "@medusajs/utils/common/is-defined" {
  export function isDefined<T = undefined | unknown>(
    value: T
  ): value is Exclude<T, null | undefined>
}

declare module "@medusajs/utils/common/is-present" {
  export function isPresent(value: unknown): boolean
}

declare module "@medusajs/utils/common/partition-array" {
  export function partitionArray<T>(
    input: T[],
    predicate: (item: T) => boolean
  ): [T[], T[]]
}

declare module "@medusajs/utils/common/to-handle" {
  export function toHandle(value: string): string
}

declare module "@medusajs/utils/common/to-kebab-case" {
  export function kebabCase(value: string): string
}

declare module "@medusajs/utils/common/validate-handle" {
  export function isValidHandle(value: string): boolean
}

declare module "@medusajs/utils/event-bus/common-events" {
  export enum CommonEvents {
    CREATED = "created",
    UPDATED = "updated",
    DELETED = "deleted",
    RESTORED = "restored",
    ATTACHED = "attached",
    DETACHED = "detached",
  }
}

declare module "@medusajs/utils/event-bus/message-aggregator" {
  export class MessageAggregator {
    saveRawMessageData(messages: unknown[]): void
    getMessages(format?: unknown): unknown
  }
}

declare module "@medusajs/utils/modules-sdk/event-builder-factory" {
  import type { Context } from "@medusajs/types"

  export function moduleEventBuilderFactory(input: {
    action: string
    object: string
    eventName?: string
    source: string
  }): (args: {
    data: { id: string } | { id: string }[]
    sharedContext: Context
  }) => void
}

declare module "@medusajs/utils/product/enums" {
  export enum ProductStatus {
    DRAFT = "draft",
    PROPOSED = "proposed",
    PUBLISHED = "published",
    REJECTED = "rejected",
  }
}
