import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const sourceRoot = path.resolve("src");

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : Promise.resolve(file.endsWith(".ts") ? [file] : []);
  }));
  return nested.flat();
}

test("source imports respect core, contracts, public module entries and composition boundaries", async () => {
  const violations: string[] = [];
  for (const file of await sources(sourceRoot)) {
    const relative = path.relative(sourceRoot, file).split(path.sep);
    const ast = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) imports.push(arg.text);
        else violations.push(`${relative.join("/")}: dynamic module discovery is not permitted`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const specifier of imports) {
      const origin = relative.join("/");
      if (!specifier.startsWith(".")) {
        if (relative[0] === "contracts" || (relative[0] === "core" && !specifier.startsWith("node:"))) {
          violations.push(`${origin}: external dependency ${specifier}`);
        }
        continue;
      }
      const target = path.relative(sourceRoot, path.resolve(path.dirname(file), specifier)).split(path.sep);
      if (relative[0] === "contracts" && target[0] !== "contracts") violations.push(`${origin}: contract depends on ${specifier}`);
      if (relative[0] === "core" && !["core", "contracts"].includes(target[0])) violations.push(`${origin}: core depends on ${specifier}`);
      if (relative[0] === "modules") {
        const sameModule = relative.slice(0, 3).join("/") === target.slice(0, 3).join("/");
        if (!sameModule && target[0] !== "contracts") violations.push(`${origin}: implementation depends on ${specifier}`);
      }
      if (relative[0] === "app" && target[0] === "modules" && target.at(-1) !== "index.ts") violations.push(`${origin}: non-public module import ${specifier}`);
      if (relative[0] === "interfaces" && !["app", "contracts", "interfaces"].includes(target[0])) violations.push(`${origin}: interface bypasses app with ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});
