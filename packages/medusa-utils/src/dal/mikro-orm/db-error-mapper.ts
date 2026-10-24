import {
  ForeignKeyConstraintViolationException,
  InvalidFieldNameException,
  NotFoundError,
  NotNullConstraintViolationException,
  UniqueConstraintViolationException,
} from "@medusajs/deps/mikro-orm/core"
import { MedusaError, upperCaseFirst } from "../../common"
import {
  formatForeignKeyConstraintMessage,
  formatUniqueConstraintMessage,
  parseDatabaseConstraintInfo,
} from "../database-constraint"

export const dbErrorMapper = (err: Error) => {
  if (err instanceof NotFoundError) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, err.message)
  }

  if (
    err instanceof UniqueConstraintViolationException ||
    (err as any).code === "23505"
  ) {
    const info = getConstraintInfo(err)
    if (!info) {
      throw err
    }

    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      formatUniqueConstraintMessage(info)
    )
  }

  if (
    err instanceof NotNullConstraintViolationException ||
    (err as any).code === "23502"
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Cannot set field '${(err as any).column}' of ${upperCaseFirst(
        (err as any).table.split("_").join(" ")
      )} to null`
    )
  }

  if (
    err instanceof InvalidFieldNameException ||
    (err as any).code === "42703"
  ) {
    const userFriendlyMessage = err.message.match(/(column.*)/)?.[0]
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      userFriendlyMessage ?? err.message
    )
  }

  if (
    err instanceof ForeignKeyConstraintViolationException ||
    (err as any).code === "23503"
  ) {
    const info = getConstraintInfo(err)
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      formatForeignKeyConstraintMessage(info)
    )
  }

  throw err
}

const getConstraintInfo = (err: any) => {
  return parseDatabaseConstraintInfo(err)
}
