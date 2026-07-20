// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(process.cwd());
const sourceRoot = resolve(projectRoot, 'src');

const layerRank = {
  shared: 0,
  entities: 1,
  features: 2,
  widgets: 3,
  pages: 4,
  app: 5,
} as const;

type Layer = keyof typeof layerRank;

type ModuleLocation = {
  layer: Layer;
  slice?: string;
  segments: string[];
};

const normalizePath = (value: string) => value.replaceAll('\\', '/');

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return collectSourceFiles(absolutePath);
    }

    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [absolutePath] : [];
  });
}

function parseSourceFile(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
}

function extractModuleSpecifiers(source: string, fileName = 'architecture-source.ts'): string[] {
  const sourceFile = parseSourceFile(source, fileName);
  const specifiers = new Set<string>();

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;

      if (argument && ts.isStringLiteralLike(argument)) {
        specifiers.add(argument.text);
      }
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.add(node.argument.literal.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return [...specifiers];
}

function withoutExtension(modulePath: string): string {
  return modulePath.replace(/\.(?:[cm]?[jt]sx?|css)$/, '').replace(/\/index$/, '');
}

function locateModule(modulePath: string): ModuleLocation | undefined {
  const segments = withoutExtension(normalizePath(modulePath)).split('/');

  if (segments[0] !== 'src') {
    return undefined;
  }

  const layer = segments[1];

  if (!layer || !(layer in layerRank)) {
    return undefined;
  }

  const typedLayer = layer as Layer;
  const slice = typedLayer === 'app' ? undefined : segments[2];

  return {
    layer: typedLayer,
    slice,
    segments,
  };
}

function resolveRelativeModule(importer: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(normalizePath(importer)), normalizePath(specifier)));
}

function findImportViolation(importer: string, specifier: string): string | undefined {
  const importerLocation = locateModule(importer);

  if (!importerLocation) {
    return undefined;
  }

  const pageStateRuntimePrefixes = [
    'preact/hooks',
    '@preact/signals',
    '@preact/signals-core',
    '@tanstack/preact-query',
    '@tanstack/query-core',
  ];
  const importsPageStateRuntime = pageStateRuntimePrefixes.some(
    (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
  );

  if (importerLocation.layer === 'pages' && importsPageStateRuntime) {
    return `page imports state runtime "${specifier}"`;
  }

  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const targetPath = resolveRelativeModule(importer, specifier);

  if (
    targetPath === 'api' ||
    targetPath.startsWith('api/') ||
    targetPath === 'src/server' ||
    targetPath.startsWith('src/server/')
  ) {
    return `client imports server runtime "${targetPath}"`;
  }

  const targetLocation = locateModule(targetPath);

  if (!targetLocation) {
    return `client import leaves the FSD graph at "${targetPath}"`;
  }

  if (targetLocation.layer === importerLocation.layer) {
    if (targetLocation.layer === 'app' || targetLocation.slice === importerLocation.slice) {
      return undefined;
    }

    return `sibling ${targetLocation.layer} slice import targets "${targetLocation.slice}"`;
  }

  if (normalizePath(importer) === 'src/app/App.tsx' && targetLocation.layer !== 'pages') {
    return `App bypasses pages by importing ${targetLocation.layer}`;
  }

  if (importerLocation.layer === 'pages' && targetLocation.layer !== 'widgets') {
    return `page bypasses widgets by importing ${targetLocation.layer}`;
  }

  if (layerRank[targetLocation.layer] >= layerRank[importerLocation.layer]) {
    return `upward import from ${importerLocation.layer} to ${targetLocation.layer}`;
  }

  const publicApiDepth = targetLocation.segments.length - 2;

  if (publicApiDepth !== 1) {
    return `deep import bypasses the ${targetLocation.layer} public API at "${targetPath}"`;
  }

  return undefined;
}

function inspectSourceGraph(): string[] {
  return collectSourceFiles(sourceRoot).flatMap((absolutePath) => {
    const importer = normalizePath(posix.join('src', normalizePath(absolutePath).split('/src/')[1] ?? ''));
    const source = readFileSync(absolutePath, 'utf8');

    return extractModuleSpecifiers(source, importer).flatMap((specifier) => {
      const violation = findImportViolation(importer, specifier);
      return violation ? [`${importer}: ${violation}`] : [];
    });
  });
}

type JsxElementExpression = ts.JsxElement | ts.JsxSelfClosingElement;

function isJsxElementExpression(node: ts.Node): node is JsxElementExpression {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let unwrapped = expression;

  while (
    ts.isParenthesizedExpression(unwrapped) ||
    ts.isAsExpression(unwrapped) ||
    ts.isTypeAssertionExpression(unwrapped) ||
    ts.isSatisfiesExpression(unwrapped) ||
    ts.isNonNullExpression(unwrapped)
  ) {
    unwrapped = unwrapped.expression;
  }

  return unwrapped;
}

function findComponentBody(sourceFile: ts.SourceFile, componentName: string): ts.ConciseBody | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === componentName) {
      return statement.body;
    }

    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    const declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === componentName,
    );
    const initializer = declaration?.initializer;

    if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
      return initializer.body;
    }
  }

  return undefined;
}

function findComponentReturns(sourceFile: ts.SourceFile, componentName: string): Array<ts.Expression | undefined> {
  const body = findComponentBody(sourceFile, componentName);

  if (!body) {
    return [];
  }

  if (!ts.isBlock(body)) {
    return [unwrapParentheses(body)];
  }

  const expressions: Array<ts.Expression | undefined> = [];

  function visit(node: ts.Node) {
    if (node !== body && ts.isFunctionLike(node)) {
      return;
    }

    if (ts.isReturnStatement(node)) {
      expressions.push(node.expression ? unwrapParentheses(node.expression) : undefined);
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(body);

  return expressions;
}

function hasSingleDirectReturn(sourceFile: ts.SourceFile, componentName: string): boolean {
  const body = findComponentBody(sourceFile, componentName);

  if (!body) {
    return false;
  }

  if (!ts.isBlock(body)) {
    return true;
  }

  const [statement] = body.statements;

  return body.statements.length === 1 && statement !== undefined && ts.isReturnStatement(statement);
}

function getJsxTagName(node: JsxElementExpression, sourceFile: ts.SourceFile): string {
  const tagName = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;

  return tagName.getText(sourceFile);
}

function getMeaningfulJsxChildren(element: ts.JsxElement): ts.JsxChild[] {
  return element.children.filter((child) => {
    if (ts.isJsxText(child)) {
      return child.text.trim().length > 0;
    }

    if (ts.isJsxExpression(child)) {
      return child.expression !== undefined;
    }

    return true;
  });
}

function inspectAppComposition(sourceFile: ts.SourceFile): string[] {
  const returns = findComponentReturns(sourceFile, 'App');
  const hasInvalidReturn =
    !hasSingleDirectReturn(sourceFile, 'App') ||
    returns.length === 0 ||
    returns.some((returned) => {
      if (!returned || !ts.isJsxElement(returned) || getJsxTagName(returned, sourceFile) !== 'AppProviders') {
        return true;
      }

      const children = getMeaningfulJsxChildren(returned);
      const [child] = children;

      return (
        children.length !== 1 ||
        child === undefined ||
        !isJsxElementExpression(child) ||
        getJsxTagName(child, sourceFile) !== 'DashboardPage'
      );
    });

  if (hasInvalidReturn) {
    return ['DashboardPage must be the sole direct JSX child of AppProviders'];
  }

  return [];
}

function inspectDashboardPageComposition(sourceFile: ts.SourceFile): string[] {
  const returns = findComponentReturns(sourceFile, 'DashboardPage');
  const hasInvalidReturn =
    !hasSingleDirectReturn(sourceFile, 'DashboardPage') ||
    returns.length === 0 ||
    returns.some(
      (returned) =>
        !returned ||
        !isJsxElementExpression(returned) ||
        getJsxTagName(returned, sourceFile) !== 'DashboardShell' ||
        (ts.isJsxElement(returned) && getMeaningfulJsxChildren(returned).length > 0),
    );

  if (hasInvalidReturn) {
    return ['DashboardPage must return DashboardShell directly'];
  }

  return [];
}

function inspectAppProvidersComposition(sourceFile: ts.SourceFile): string[] {
  const returns = findComponentReturns(sourceFile, 'AppProviders');

  if (
    !hasSingleDirectReturn(sourceFile, 'AppProviders') ||
    returns.length === 0 ||
    returns.some(
      (returned) =>
        !returned || !ts.isJsxElement(returned) || getJsxTagName(returned, sourceFile) !== 'QueryClientProvider',
    )
  ) {
    return ['AppProviders must return QueryClientProvider'];
  }

  const providerReturns = returns.filter(
    (returned): returned is ts.JsxElement => returned !== undefined && ts.isJsxElement(returned),
  );
  const hasQueryClient = providerReturns.every((returned) => {
    const clientAttribute = returned.openingElement.attributes.properties.find(
      (property): property is ts.JsxAttribute =>
        ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === 'client',
    );
    const clientExpression =
      clientAttribute?.initializer && ts.isJsxExpression(clientAttribute.initializer)
        ? clientAttribute.initializer.expression
        : undefined;

    return (
      clientExpression !== undefined && ts.isIdentifier(clientExpression) && clientExpression.text === 'queryClient'
    );
  });
  const hasChildrenExpression = providerReturns.every((returned) => {
    const children = getMeaningfulJsxChildren(returned);
    const [child] = children;

    return (
      children.length === 1 &&
      child !== undefined &&
      ts.isJsxExpression(child) &&
      child.expression !== undefined &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === 'children'
    );
  });

  return [
    ...(hasQueryClient ? [] : ['QueryClientProvider must receive client={queryClient}']),
    ...(hasChildrenExpression ? [] : ['QueryClientProvider must contain children as its sole direct child']),
  ];
}

type BindingRequirement = {
  kind: 'import' | 're-export';
  module: string;
  name: string;
};

function hasRequiredBinding(sourceFile: ts.SourceFile, requirement: BindingRequirement): boolean {
  if (requirement.kind === 'import') {
    return sourceFile.statements.some((statement) => {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteralLike(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== requirement.module
      ) {
        return false;
      }

      const namedBindings = statement.importClause?.namedBindings;

      return (
        namedBindings !== undefined &&
        ts.isNamedImports(namedBindings) &&
        namedBindings.elements.some(
          (element) =>
            element.name.text === requirement.name &&
            (element.propertyName?.text ?? element.name.text) === requirement.name,
        )
      );
    });
  }

  return sourceFile.statements.some((statement) => {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== requirement.module ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      return false;
    }

    return statement.exportClause.elements.some((element) => element.name.text === requirement.name);
  });
}

function inspectRequiredComposition(sourceOverrides: ReadonlyMap<string, string> = new Map()): string[] {
  type Requirement = {
    bindings?: BindingRequirement[];
    file: string;
    modules: string[];
    inspect?: (sourceFile: ts.SourceFile) => string[];
  };

  const requirements: Requirement[] = [
    {
      file: 'src/app/App.tsx',
      modules: ['../pages/dashboard', './providers/AppProviders'],
      bindings: [
        { kind: 'import', module: '../pages/dashboard', name: 'DashboardPage' },
        { kind: 'import', module: './providers/AppProviders', name: 'AppProviders' },
      ],
      inspect: inspectAppComposition,
    },
    {
      file: 'src/app/main.tsx',
      modules: ['./styles/index.css'],
    },
    {
      file: 'src/app/providers/AppProviders.tsx',
      modules: ['@tanstack/preact-query', '../../shared/api'],
      bindings: [
        { kind: 'import', module: '@tanstack/preact-query', name: 'QueryClientProvider' },
        { kind: 'import', module: '../../shared/api', name: 'queryClient' },
      ],
      inspect: inspectAppProvidersComposition,
    },
    {
      file: 'src/pages/dashboard/index.ts',
      modules: ['./ui/DashboardPage'],
      bindings: [{ kind: 're-export', module: './ui/DashboardPage', name: 'DashboardPage' }],
    },
    {
      file: 'src/pages/dashboard/ui/DashboardPage.tsx',
      modules: ['../../../widgets/dashboard-shell'],
      bindings: [{ kind: 'import', module: '../../../widgets/dashboard-shell', name: 'DashboardShell' }],
      inspect: inspectDashboardPageComposition,
    },
    {
      file: 'src/widgets/dashboard-shell/index.ts',
      modules: ['./ui/DashboardShell'],
      bindings: [{ kind: 're-export', module: './ui/DashboardShell', name: 'DashboardShell' }],
    },
    {
      file: 'src/shared/api/index.ts',
      modules: ['./queryClient'],
      bindings: [{ kind: 're-export', module: './queryClient', name: 'queryClient' }],
    },
  ];

  return requirements.flatMap(({ file, modules, bindings = [], inspect }) => {
    const absolutePath = resolve(projectRoot, file);

    if (!existsSync(absolutePath)) {
      return [`${file}: required composition file is missing`];
    }

    const source = sourceOverrides.get(file) ?? readFileSync(absolutePath, 'utf8');
    const sourceFile = parseSourceFile(source, file);
    const specifiers = extractModuleSpecifiers(source, file);
    const moduleViolations = modules.flatMap((module) =>
      specifiers.includes(module) ? [] : [`required module "${module}" is missing`],
    );
    const bindingViolations = bindings.flatMap((binding) => {
      if (hasRequiredBinding(sourceFile, binding)) {
        return [];
      }

      return [`required named ${binding.kind} "${binding.name}" from "${binding.module}" is missing`];
    });
    const compositionViolations = inspect?.(sourceFile) ?? [];

    return [...moduleViolations, ...bindingViolations, ...compositionViolations].map(
      (violation) => `${file}: ${violation}`,
    );
  });
}

describe('FSD boundary rules', () => {
  it('parses static, re-export, side-effect, and dynamic imports', () => {
    const source = `
      import { alpha } from './alpha';
      import './styles.css';
      export { beta } from '../beta';
      import {
        gamma,
        type Delta,
      } from '../gamma';
      const lazy = import('../../lazy');
    `;

    expect(extractModuleSpecifiers(source)).toEqual(['./alpha', './styles.css', '../beta', '../gamma', '../../lazy']);
  });

  it('parses imports after angle-bracket assertions in TypeScript files', () => {
    const source = `
      const value = <Value>candidate;
      import { DashboardPage } from '../../../pages/dashboard';
    `;

    expect(extractModuleSpecifiers(source, 'fixture.ts')).toEqual(['../../../pages/dashboard']);
  });

  it('detects upward dependencies expressed through inline import types', () => {
    const source = `
      type DashboardPageType = import('../../../pages/dashboard').DashboardPage;
    `;
    const specifiers = extractModuleSpecifiers(source, 'src/widgets/map/model/types.ts');

    expect(specifiers).toEqual(['../../../pages/dashboard']);
    expect(findImportViolation('src/widgets/map/model/types.ts', specifiers[0] ?? '')).toContain('upward import');
  });

  it('rejects composition names that only appear as siblings or comments', () => {
    const appSource = `
      import { DashboardPage } from '../pages/dashboard';
      import { AppProviders } from './providers/AppProviders';

      export function App() {
        return (
          <>
            <AppProviders />
            <DashboardPage />
          </>
        );
      }

      // <AppProviders><DashboardPage /></AppProviders>
    `;

    expect(inspectRequiredComposition(new Map([['src/app/App.tsx', appSource]]))).toContain(
      'src/app/App.tsx: DashboardPage must be the sole direct JSX child of AppProviders',
    );
  });

  it('rejects local lookalikes that only side-effect import the required modules', () => {
    const appSource = `
      import '../pages/dashboard';
      import './providers/AppProviders';

      function AppProviders({ children }: { children: unknown }) {
        return children;
      }

      function DashboardPage() {
        return null;
      }

      export function App() {
        return (
          <AppProviders>
            <DashboardPage />
          </AppProviders>
        );
      }
    `;

    expect(inspectRequiredComposition(new Map([['src/app/App.tsx', appSource]]))).toContain(
      'src/app/App.tsx: required named import "DashboardPage" from "../pages/dashboard" is missing',
    );
  });

  it('rejects an invalid JSX branch even when the final return is valid', () => {
    const pageSource = `
      import { DashboardShell } from '../../../widgets/dashboard-shell';

      declare const isDegraded: boolean;

      export function DashboardPage() {
        if (isDegraded) {
          return <aside />;
        }

        return <DashboardShell />;
      }
    `;

    expect(inspectRequiredComposition(new Map([['src/pages/dashboard/ui/DashboardPage.tsx', pageSource]]))).toContain(
      'src/pages/dashboard/ui/DashboardPage.tsx: DashboardPage must return DashboardShell directly',
    );
  });

  it('rejects a bare return branch even when the final return is valid', () => {
    const pageSource = `
      import { DashboardShell } from '../../../widgets/dashboard-shell';

      declare const isHidden: boolean;

      export function DashboardPage() {
        if (isHidden) {
          return;
        }

        return <DashboardShell />;
      }
    `;

    expect(inspectRequiredComposition(new Map([['src/pages/dashboard/ui/DashboardPage.tsx', pageSource]]))).toContain(
      'src/pages/dashboard/ui/DashboardPage.tsx: DashboardPage must return DashboardShell directly',
    );
  });

  it('rejects an implicit fallthrough after a conditional return', () => {
    const pageSource = `
      import { DashboardShell } from '../../../widgets/dashboard-shell';

      declare const isReady: boolean;

      export function DashboardPage() {
        if (isReady) {
          return <DashboardShell />;
        }
      }
    `;

    expect(inspectRequiredComposition(new Map([['src/pages/dashboard/ui/DashboardPage.tsx', pageSource]]))).toContain(
      'src/pages/dashboard/ui/DashboardPage.tsx: DashboardPage must return DashboardShell directly',
    );
  });

  it('rejects page-side work before the composition return', () => {
    const pageSource = `
      import { DashboardShell } from '../../../widgets/dashboard-shell';

      export function DashboardPage() {
        fetch('/api/weather');
        return <DashboardShell />;
      }
    `;

    expect(inspectRequiredComposition(new Map([['src/pages/dashboard/ui/DashboardPage.tsx', pageSource]]))).toContain(
      'src/pages/dashboard/ui/DashboardPage.tsx: DashboardPage must return DashboardShell directly',
    );
  });

  it('accepts a component declared as an arrow function', () => {
    const pageSource = `
      import { DashboardShell } from '../../../widgets/dashboard-shell';

      export const DashboardPage = () => <DashboardShell />;
    `;
    const violations = inspectRequiredComposition(new Map([['src/pages/dashboard/ui/DashboardPage.tsx', pageSource]]));

    expect(violations).not.toContain(
      'src/pages/dashboard/ui/DashboardPage.tsx: DashboardPage must return DashboardShell directly',
    );
  });

  it('accepts downward public imports across Windows and Posix paths', () => {
    expect(
      findImportViolation('src/pages/dashboard/ui/DashboardPage.tsx', '../../../widgets/dashboard-shell'),
    ).toBeUndefined();
    expect(
      findImportViolation('src\\pages\\dashboard\\ui\\DashboardPage.tsx', '..\\..\\..\\widgets\\dashboard-shell'),
    ).toBeUndefined();
  });

  it.each([
    ['src/widgets/map/ui/Map.tsx', '../../../pages/dashboard', 'upward import'],
    ['src/widgets/map/ui/Map.tsx', '../../../widgets/panel', 'sibling widgets slice'],
    ['src/pages/dashboard/ui/DashboardPage.tsx', '../../../widgets/map/ui/Map', 'deep import'],
    ['src/pages/dashboard/ui/DashboardPage.tsx', '../../../features/layer-toggle', 'page bypasses widgets'],
    ['src/app/App.tsx', '../widgets/dashboard-shell', 'App bypasses pages'],
    ['src/pages/dashboard/ui/DashboardPage.tsx', '@tanstack/preact-query', 'page imports state runtime'],
    ['src/pages/dashboard/ui/DashboardPage.tsx', '@tanstack/preact-query/build/modern', 'page imports state runtime'],
    ['src/pages/dashboard/ui/DashboardPage.tsx', '@tanstack/query-core', 'page imports state runtime'],
    ['src/pages/dashboard/ui/DashboardPage.tsx', '@preact/signals/core', 'page imports state runtime'],
    ['src/pages/dashboard/ui/DashboardPage.tsx', '@preact/signals-core', 'page imports state runtime'],
    ['src/pages/dashboard/ui/DashboardPage.tsx', 'preact/hooks', 'page imports state runtime'],
    ['src/pages/dashboard/ui/DashboardPage.tsx', '../../../../api/private', 'client imports server runtime'],
  ])('rejects %s importing %s', (importer, specifier, expectedReason) => {
    expect(findImportViolation(importer, specifier)).toContain(expectedReason);
  });

  it('keeps the repository source graph and composition chain within Full FSD boundaries', () => {
    expect([...inspectSourceGraph(), ...inspectRequiredComposition()].sort()).toEqual([]);
  });
});
