import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import type { Plugin } from "vite";

const observer = fileURLToPath(new URL("./cycleAttribution.ts", import.meta.url)).replaceAll("\\", "/");
const hash = (source: string) => createHash("sha256").update(source).digest("hex");

/** Diagnostic-only successor to the retained generator probe. It changes no
 * business expression or iterator method; a source/hash manifest proves scope. */
export function transformCycleGenerators(source: string, path: string): string | undefined {
  const id = path.replaceAll("\\", "/");
  if (!id.includes("/packages/") || !id.endsWith(".ts") || !id.includes("/src/")) return;
  const fileName = id.slice(id.indexOf("/packages/") + 1);
  const file = ts.createSourceFile(id, source, ts.ScriptTarget.Latest, true);
  const edits: { offset: number; text: string }[] = [], sites: string[] = [];
  const owner = (node: ts.Node): string => {
    for (let at = node.parent; at !== undefined; at = at.parent) {
      if ((ts.isVariableDeclaration(at) || ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name)
        return at.name.getText(file);
    }
    return "anonymous";
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionExpression(node) && node.asteriskToken) {
      const site = `${fileName}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}:${owner(node)}`;
      sites.push(site);
      edits.push({ offset: node.getStart(file), text: `__flarexCycles.observeGenerator(${JSON.stringify(site)},` },
        { offset: node.end, text: ")" });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (sites.length === 0) return;
  let transformed = source;
  for (const edit of edits.sort((left, right) => right.offset - left.offset))
    transformed = transformed.slice(0, edit.offset) + edit.text + transformed.slice(edit.offset);
  return `import * as __flarexCycles from ${JSON.stringify(observer)};\n` +
    `__flarexCycles.registerCycleSource(${JSON.stringify({ file: fileName, originalHash: hash(source), transformedHash: hash(transformed), sites })});\n` + transformed;
}

export function cycleAttributionPlugin(): Plugin {
  return { name: "flarex-diagnostic-generator-cycles", enforce: "pre", transform: transformCycleGenerators };
}
