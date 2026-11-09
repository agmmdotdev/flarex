import fs from "node:fs/promises"
import { compileFunction } from "node:vm"
import { z } from "@medusajs/framework/zod"

const identifier = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/).refine((value) => {
  try {
    // Compile without executing; strict async bindings also reject ESM's await.
    compileFunction(`"use strict"; return async function () { const ${value} = 0; }`)
    return true
  } catch (error) {
    if (error instanceof SyntaxError) return false
    throw error
  }
}, "Expected a non-keyword JavaScript identifier")
// The pinned renderer interpolates these values into double-quoted literals.
const literal = z.string().min(1).regex(/^[^"\\\r\n\u2028\u2029]+$/)
const route = z.object({
  relativePath: literal,
  binding: identifier.optional(),
  importPath: literal.optional(),
  route: literal.optional(),
  routeRoot: literal.optional(),
}).strict()
const middleware = z.object({
  relativePath: literal,
  binding: identifier.optional(),
  importPath: literal.optional(),
  exportName: identifier.optional(),
}).strict()
const manifestSpec = z.object({
  exportName: identifier,
  generatedBy: z.string().min(1).regex(/^[^\r\n\u2028\u2029]+$/),
  manifestDirectory: literal,
  outputPath: literal,
  routeRoot: literal,
  routes: z.array(route),
  middlewares: z.array(middleware),
}).strict()

export async function readManifestSpec(filePath) {
  return manifestSpec.parse(JSON.parse(await fs.readFile(filePath, "utf8")))
}

/** Check derived bindings too: valid input paths can derive invalid identifiers. */
export function validateManifestBindings(input, exportName) {
  const bindings = z.array(identifier).parse([
    exportName,
    ...input.routes.map((route) => route.binding),
    ...input.middlewares.map((middleware) => middleware.binding),
  ])
  if (new Set(bindings).size !== bindings.length) {
    throw new Error("Static HTTP manifest identifiers must be unique")
  }
}
