import { Currency } from "@medusajs/currency/models"
import { createDurableObjectSqliteManager } from "@medusajs/drizzle-cloudflare"
import { compileDmlSchema, renderD1MigrationSql } from "@medusajs/drizzle"
import type { Context } from "@medusajs/types"
import {
  createCurrencyModuleRuntimeWithManager,
  type CurrencyModuleRuntime,
} from "./currency-module"

const currencySchemaSql = renderD1MigrationSql(compileDmlSchema([Currency]))

export class CurrencyProofDO {
  private readonly manager: ReturnType<typeof createDurableObjectSqliteManager>
  private runtime?: Promise<CurrencyModuleRuntime>

  constructor(ctx: DurableObjectState, _env: object) {
    this.manager = createDurableObjectSqliteManager(ctx.storage)
    ctx.storage.sql.exec(currencySchemaSql)
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.split("/").slice(3).join("/")

    if (path === "capabilities") {
      return Response.json({ transactionMode: this.manager.transactionMode })
    }

    if (path === "currencies" && request.method === "GET") {
      return Response.json(
        await (await this.getRuntime()).service.listCurrencies()
      )
    }

    if (path === "currencies" && request.method === "POST") {
      const input: unknown = await request.json()
      if (!isCurrencyInput(input)) {
        return Response.json({ error: "Invalid Currency input" }, { status: 400 })
      }
      const created = await (await this.getRuntime()).service.createCurrencies(input)
      return Response.json(created, { status: 201 })
    }

    if (path === "transaction-rollback-proof" && request.method === "POST") {
      const codePrefix = `rollback_${crypto.randomUUID()}`
      const codes = [`${codePrefix}_a`, `${codePrefix}_b`]
      let visibleInsideTransaction = false
      const service = (await this.getRuntime()).service
      try {
        await this.manager.transaction(async (transactionManager) => {
          const context: Context = { transactionManager }
          await service.createCurrencies(createRollbackInput(codes[0]), context)
          await transactionManager.transaction(async (nestedManager) => {
            await service.createCurrencies(
              createRollbackInput(codes[1], "Nested Rollback Proof"),
              { transactionManager: nestedManager }
            )
          })
          visibleInsideTransaction =
            (await service.listCurrencies({ code: codes }, {}, context)).length ===
            codes.length
          throw new Error("rollback proof")
        })
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "rollback proof") {
          throw error
        }
      }

      const persisted = await service.listCurrencies({ code: codes })
      await cleanupCurrencies(service, codes)
      return Response.json({
        transactionMode: this.manager.transactionMode,
        visibleInsideTransaction,
        rolledBack: persisted.length === 0,
      })
    }

    return new Response("Not found", { status: 404 })
  }

  private getRuntime(): Promise<CurrencyModuleRuntime> {
    this.runtime ??= createCurrencyModuleRuntimeWithManager(this.manager)

    return this.runtime
  }
}

function createRollbackInput(code: string, name = "Rollback Proof"): CurrencyInput {
  return {
    symbol: "R",
    symbol_native: "R",
    name,
    code,
  }
}

async function cleanupCurrencies(
  service: CurrencyModuleRuntime["service"],
  codes: string[]
): Promise<void> {
  for (const code of codes) {
    await service.deleteCurrencies(code)
  }
}

interface CurrencyInput {
  code: string
  symbol: string
  symbol_native: string
  name: string
}

function isCurrencyInput(value: unknown): value is CurrencyInput {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.symbol === "string" &&
    typeof value.symbol_native === "string" &&
    typeof value.name === "string"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
