import {
  handleMedusaCloudflareHttp,
  isMedusaCloudflareHttpPath,
  tryHandleMedusaCloudflareHttp,
} from "./cloudflare-http-runtime"

export async function handleStaticHttpProof(
  request: Request
): Promise<Response> {
  return await handleMedusaCloudflareHttp(request)
}

export async function tryHandleStaticHttpProof(
  request: Request
): Promise<Response | undefined> {
  return await tryHandleMedusaCloudflareHttp(request)
}

export function isStaticHttpProofPath(pathname: string): boolean {
  return isMedusaCloudflareHttpPath(pathname)
}
