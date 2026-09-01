import { updateUsersWorkflow } from "@medusajs/core-flows/user/workflows/update-users"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { HttpTypes, UpdateUserDTO } from "@medusajs/framework/types"

import { refetchUser } from "../helpers"

// update user
export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminUpdateUser,
    HttpTypes.AdminUserParams
  >,
  res: MedusaResponse<HttpTypes.AdminUserResponse>
) => {
  const input = {
    updates: [
      {
        id: req.params.id,
        ...req.validatedBody,
      } satisfies UpdateUserDTO,
    ],
  }

  await updateUsersWorkflow().run({
    container: req.scope,
    input,
  })

  const user = await refetchUser(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ user })
}
