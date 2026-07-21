// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(process.cwd());
const initializerPath = resolve(projectRoot, 'src/app/theme/initializeTheme.ts');
const mainPath = resolve(projectRoot, 'src/app/main.tsx');

function parseMain(): ts.SourceFile {
  return ts.createSourceFile(mainPath, readFileSync(mainPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function hasNamedImport(sourceFile: ts.SourceFile, moduleName: string, importName: string): boolean {
  return sourceFile.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName
    ) {
      return false;
    }

    const bindings = statement.importClause?.namedBindings;

    return (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === importName)
    );
  });
}

function findCalls(sourceFile: ts.SourceFile, functionName: string): ts.CallExpression[] {
  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      return [];
    }

    const call = statement.expression;

    return ts.isIdentifier(call.expression) && call.expression.text === functionName ? [call] : [];
  });
}

function collectWindowProperties(sourceFile: ts.SourceFile): Set<string> {
  const properties = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'window') {
      properties.add(node.name.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return properties;
}

function getObjectPropertyNames(expression: ts.Expression | undefined): string[] {
  if (!expression || !ts.isObjectLiteralExpression(expression)) {
    return [];
  }

  return expression.properties.flatMap((property) => {
    if (!('name' in property) || !property.name) {
      return [];
    }

    return [property.name.getText()];
  });
}

describe('application theme bootstrap contract', () => {
  it('ignores lookalike initializer calls inside unexecuted functions', () => {
    const fixture = ts.createSourceFile(
      'fixture.tsx',
      `
        function unused() {
          initializeTheme({ root: document.documentElement });
        }

        render(<App />, root);
      `,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    expect(findCalls(fixture, 'initializeTheme')).toEqual([]);
    expect(findCalls(fixture, 'render')).toHaveLength(1);
  });

  it('initializes the root theme before Preact renders', () => {
    expect(existsSync(initializerPath), 'theme initializer is missing').toBe(true);

    if (!existsSync(initializerPath)) {
      return;
    }

    const sourceFile = parseMain();
    const initializeCalls = findCalls(sourceFile, 'initializeTheme');
    const renderCalls = findCalls(sourceFile, 'render');
    const initializeCall = initializeCalls[0];
    const renderCall = renderCalls[0];

    expect(hasNamedImport(sourceFile, './theme/initializeTheme', 'initializeTheme')).toBe(true);
    expect(initializeCalls).toHaveLength(1);
    expect(renderCalls).toHaveLength(1);
    expect(initializeCall, 'initializeTheme call is missing').toBeTruthy();
    expect(renderCall, 'render call is missing').toBeTruthy();
    expect(initializeCall?.getStart(), 'theme must initialize before render').toBeLessThan(
      renderCall?.getStart() ?? -1,
    );
  });

  it('connects browser storage and system preference adapters', () => {
    const sourceFile = parseMain();
    const windowProperties = collectWindowProperties(sourceFile);
    const [initializeCall] = findCalls(sourceFile, 'initializeTheme');
    const environmentProperties = getObjectPropertyNames(initializeCall?.arguments[0]);

    expect(windowProperties).toEqual(new Set(['localStorage', 'matchMedia']));
    expect(environmentProperties.sort()).toEqual(['matchMedia', 'root', 'storage']);
  });
});
