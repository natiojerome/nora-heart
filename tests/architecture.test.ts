import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const sourceRoot = path.resolve("src");

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sources(file)
        : Promise.resolve(file.endsWith(".ts") ? [file] : []);
    }),
  );
  return nested.flat();
}

test("source imports respect core, contracts, public module entries and composition boundaries", async () => {
  const violations: string[] = [];
  for (const file of await sources(sourceRoot)) {
    const relative = path.relative(sourceRoot, file).split(path.sep);
    const ast = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports: string[] = [];
    function visit(node: ts.Node): void {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        imports.push(node.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) imports.push(arg.text);
        else
          violations.push(
            `${relative.join("/")}: dynamic module discovery is not permitted`,
          );
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const specifier of imports) {
      const origin = relative.join("/");
      if (!specifier.startsWith(".")) {
        if (
          relative[0] === "contracts" ||
          (relative[0] === "core" && !specifier.startsWith("node:"))
        ) {
          violations.push(`${origin}: external dependency ${specifier}`);
        }
        continue;
      }
      const target = path
        .relative(sourceRoot, path.resolve(path.dirname(file), specifier))
        .split(path.sep);
      if (relative[0] === "contracts" && target[0] !== "contracts")
        violations.push(`${origin}: contract depends on ${specifier}`);
      if (relative[0] === "core" && !["core", "contracts"].includes(target[0]))
        violations.push(`${origin}: core depends on ${specifier}`);
      if (relative[0] === "modules") {
        const sameModule =
          relative.slice(0, 3).join("/") === target.slice(0, 3).join("/");
        if (!sameModule && target[0] !== "contracts")
          violations.push(`${origin}: implementation depends on ${specifier}`);
      }
      if (
        relative[0] === "app" &&
        target[0] === "modules" &&
        target.at(-1) !== "index.ts"
      )
        violations.push(`${origin}: non-public module import ${specifier}`);
      if (
        relative[0] === "interfaces" &&
        !["app", "contracts", "interfaces"].includes(target[0])
      )
        violations.push(`${origin}: interface bypasses app with ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("modules expose public entries and runtime imports stay acyclic", async () => {
  const files = await sources(sourceRoot),
    graph = new Map<string, string[]>();
  const modules = new Set<string>();
  for (const file of files) {
    const relative = path.relative(sourceRoot, file).split(path.sep);
    if (relative[0] === "modules")
      modules.add(path.join(sourceRoot, ...relative.slice(0, 3)));
    const ast = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const dependencies: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const clause = node.importClause;
        const onlyTypes =
          clause?.isTypeOnly ||
          (clause &&
            !clause.name &&
            clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.every((item) => item.isTypeOnly));
        if (!onlyTypes && node.moduleSpecifier.text.startsWith("."))
          dependencies.push(
            path.resolve(path.dirname(file), node.moduleSpecifier.text),
          );
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        !node.isTypeOnly
      ) {
        const onlyTypes =
          node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.every((item) => item.isTypeOnly);
        if (!onlyTypes && node.moduleSpecifier.text.startsWith("."))
          dependencies.push(
            path.resolve(path.dirname(file), node.moduleSpecifier.text),
          );
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const target = node.arguments[0];
        if (target && ts.isStringLiteral(target) && target.text.startsWith("."))
          dependencies.push(path.resolve(path.dirname(file), target.text));
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    graph.set(file, dependencies);
  }
  for (const module of modules)
    assert(
      graph.has(path.join(module, "index.ts")),
      `Missing public entry: ${path.relative(sourceRoot, module)}`,
    );
  const visited = new Set<string>(),
    active = new Set<string>();
  function visit(file: string, chain: string[]) {
    assert(
      !active.has(file),
      `Runtime import cycle: ${[...chain, file].map((item) => path.relative(sourceRoot, item)).join(" → ")}`,
    );
    if (visited.has(file)) return;
    active.add(file);
    for (const target of graph.get(file) ?? [])
      if (graph.has(target)) visit(target, [...chain, file]);
    active.delete(file);
    visited.add(file);
  }
  for (const file of files) visit(file, []);
});
