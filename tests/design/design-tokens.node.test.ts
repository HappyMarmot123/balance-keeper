// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(process.cwd());
const stylesPath = resolve(projectRoot, 'src/app/styles/index.css');
const sourceRoot = resolve(projectRoot, 'src');

const semanticTokens = [
  'canvas',
  'surface',
  'surface-raised',
  'surface-inset',
  'text',
  'text-muted',
  'border',
  'border-strong',
  'accent',
  'on-accent',
  'focus',
  'danger',
  'danger-soft',
  'warning',
  'warning-soft',
  'success',
  'success-soft',
] as const;

const utilityAliases: Record<(typeof semanticTokens)[number], string> = {
  canvas: 'canvas',
  surface: 'surface',
  'surface-raised': 'surface-raised',
  'surface-inset': 'surface-inset',
  text: 'foreground',
  'text-muted': 'muted',
  border: 'boundary',
  'border-strong': 'boundary-strong',
  accent: 'accent',
  'on-accent': 'on-accent',
  focus: 'focus',
  danger: 'danger',
  'danger-soft': 'danger-soft',
  warning: 'warning',
  'warning-soft': 'warning-soft',
  success: 'success',
  'success-soft': 'success-soft',
};

const contrastPairs = [
  ['text', 'surface', 4.5],
  ['text-muted', 'surface', 4.5],
  ['text', 'surface-raised', 4.5],
  ['text-muted', 'surface-raised', 4.5],
  ['text-muted', 'surface-inset', 4.5],
  ['text', 'danger-soft', 4.5],
  ['text-muted', 'danger-soft', 4.5],
  ['text', 'warning-soft', 4.5],
  ['text-muted', 'warning-soft', 4.5],
  ['text', 'success-soft', 4.5],
  ['text-muted', 'success-soft', 4.5],
  ['border', 'surface', 3],
  ['border', 'canvas', 3],
  ['border-strong', 'surface', 3],
  ['border-strong', 'surface-raised', 3],
  ['border-strong', 'surface-inset', 3],
  ['focus', 'surface', 3],
  ['focus', 'surface-raised', 3],
  ['focus', 'danger-soft', 3],
  ['accent', 'surface', 4.5],
  ['on-accent', 'accent', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['success', 'success-soft', 4.5],
] as const;

const tailwindPaletteNames = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
  'black',
  'white',
].join('|');

const rawPaletteUtility = new RegExp(
  `^(?:bg|text|border|ring|ring-offset|outline|decoration|fill|stroke|from|via|to|shadow|divide|placeholder|caret|accent)-(?:${tailwindPaletteNames})(?:-\\d{2,3})?(?:/\\d+)?$`,
);
const rawArbitraryColor =
  /^(?:(?:bg|text|border|ring|ring-offset|outline|decoration|fill|stroke|from|via|to|shadow|divide|placeholder|caret|accent)-\[(?:#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()|\[(?:color|background-color|border-color|outline-color|fill|stroke):(?:#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\())/;
const rawAttributeColor = /^(?:#[\da-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i;
const colorAttributeNames = new Set(['color', 'fill', 'stroke', 'stopColor', 'floodColor', 'lightingColor']);

type Oklch = readonly [lightness: number, chroma: number, hue: number];

function removeCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractBlock(source: string, marker: string): string {
  const cleanSource = removeCssComments(source);
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selectorPattern = new RegExp(`${escapedMarker}\\s*\\{`, 'g');
  const blocks: string[] = [];
  let blockStart = selectorPattern.exec(cleanSource);

  while (blockStart !== null) {
    const openingBrace = blockStart.index + blockStart[0].lastIndexOf('{');
    let depth = 1;

    for (let index = openingBrace + 1; index < cleanSource.length; index += 1) {
      const character = cleanSource[index];

      if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
      }

      if (depth === 0) {
        blocks.push(cleanSource.slice(openingBrace + 1, index));
        selectorPattern.lastIndex = index + 1;
        break;
      }
    }

    blockStart = selectorPattern.exec(cleanSource);
  }

  return blocks.join('\n');
}

function parseCustomProperties(block: string): Map<string, string> {
  const declarations = new Map<string, string>();

  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const [, property, value] = match;

    if (property && value) {
      declarations.set(property, value.trim());
    }
  }

  return declarations;
}

function parseOklch(value: string): Oklch | undefined {
  const match = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(value);

  if (!match) {
    return undefined;
  }

  const [, rawLightness, rawChroma, rawHue] = match;

  if (!rawLightness || !rawChroma || !rawHue) {
    return undefined;
  }

  const parsedLightness = Number(rawLightness);

  return [rawLightness.includes('%') ? parsedLightness / 100 : parsedLightness, Number(rawChroma), Number(rawHue)];
}

function toLinearSrgb([lightness, chroma, hue]: Oklch): readonly [number, number, number] {
  const hueInRadians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(hueInRadians);
  const b = chroma * Math.sin(hueInRadians);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function relativeLuminance(color: Oklch): number {
  const [red, green, blue] = toLinearSrgb(color).map((channel) => Math.max(0, Math.min(1, channel)));

  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function contrastRatio(first: Oklch, second: Oklch): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return collectTsxFiles(absolutePath);
    }

    return extname(entry.name) === '.tsx' ? [absolutePath] : [];
  });
}

function collectStringBindings(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.Expression> {
  const bindings = new Map<string, ts.Expression>();

  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return bindings;
}

function collectStaticValues(
  node: ts.Node | undefined,
  bindings: ReadonlyMap<string, ts.Expression>,
  resolving: ReadonlySet<string> = new Set(),
): string[] {
  if (!node) {
    return [];
  }

  if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return [node.text];
  }

  if (ts.isIdentifier(node)) {
    const initializer = bindings.get(node.text);

    if (!initializer || resolving.has(node.text)) {
      return [];
    }

    return collectStaticValues(initializer, bindings, new Set([...resolving, node.text]));
  }

  const values: string[] = [];

  ts.forEachChild(node, (child) => {
    values.push(...collectStaticValues(child, bindings, resolving));
  });

  return values;
}

function collectStaticAttributeValues(
  initializer: ts.JsxAttributeValue | undefined,
  bindings: ReadonlyMap<string, ts.Expression>,
): string[] {
  if (!initializer) {
    return [];
  }

  if (ts.isStringLiteral(initializer)) {
    return [initializer.text];
  }

  return ts.isJsxExpression(initializer) ? collectStaticValues(initializer.expression, bindings) : [];
}

function getTailwindUtility(token: string): string {
  let bracketDepth = 0;
  let variantEnd = -1;

  for (let index = 0; index < token.length; index += 1) {
    const character = token[index];

    if (character === '[') {
      bracketDepth += 1;
    } else if (character === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (character === ':' && bracketDepth === 0) {
      variantEnd = index;
    }
  }

  return token.slice(variantEnd + 1).replace(/^!/, '');
}

type SourceInput = {
  filePath: string;
  source: string;
};

function findRawVisualValues(
  sourceInputs: readonly SourceInput[] = collectTsxFiles(sourceRoot).map((filePath) => ({
    filePath,
    source: readFileSync(filePath, 'utf8'),
  })),
): string[] {
  return sourceInputs.flatMap(({ filePath, source }) => {
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const bindings = collectStringBindings(sourceFile);
    const violations: string[] = [];

    function visit(node: ts.Node) {
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
        if (node.name.text === 'style') {
          violations.push(`${filePath}: inline style attribute`);
        }

        if (node.name.text === 'className' || node.name.text === 'class') {
          for (const classValue of collectStaticAttributeValues(node.initializer, bindings)) {
            for (const token of classValue.split(/\s+/).filter(Boolean)) {
              const utility = getTailwindUtility(token);

              if (rawPaletteUtility.test(utility) || rawArbitraryColor.test(utility)) {
                violations.push(`${filePath}: ${token}`);
              }
            }
          }
        }

        if (colorAttributeNames.has(node.name.text)) {
          for (const value of collectStaticAttributeValues(node.initializer, bindings)) {
            if (rawAttributeColor.test(value.trim())) {
              violations.push(`${filePath}: ${node.name.text}="${value}"`);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    return violations;
  });
}

describe('design token contract', () => {
  it('parses real blocks while ignoring comment decoys', () => {
    const fixture = `
      /* :root { --bk-color-canvas: oklch(0 0 0); } */
      :root { --bk-color-canvas: oklch(.95 .01 250); }
    `;
    const selectorCollisionFixture = `
      @custom-variant dark (&:where(.dark, .dark *));
      @theme inline { --color-canvas: var(--bk-color-canvas); }
      .dark { --bk-color-canvas: oklch(.14 .02 255); }
    `;
    const duplicateSelectorFixture = `
      :root { --bk-color-canvas: oklch(.95 .01 250); }
      .dark { --bk-color-canvas: oklch(.14 .02 255); }
      :root { --bk-color-canvas: #fff; }
      .dark { --bk-color-canvas: #000; }
    `;

    expect(parseCustomProperties(extractBlock(fixture, ':root'))).toEqual(
      new Map([['--bk-color-canvas', 'oklch(.95 .01 250)']]),
    );
    expect(parseCustomProperties(extractBlock(selectorCollisionFixture, '.dark'))).toEqual(
      new Map([['--bk-color-canvas', 'oklch(.14 .02 255)']]),
    );
    expect(parseCustomProperties(extractBlock(duplicateSelectorFixture, ':root')).get('--bk-color-canvas')).toBe(
      '#fff',
    );
    expect(parseCustomProperties(extractBlock(duplicateSelectorFixture, '.dark')).get('--bk-color-canvas')).toBe(
      '#000',
    );
    expect(contrastRatio([1, 0, 0], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrastRatio([0.5, 0, 0], [0.55, 0, 0])).toBeLessThan(4.5);
  });

  it('defines light and dark semantic tokens with Tailwind utility mappings and no raw component colors', () => {
    const styles = readFileSync(stylesPath, 'utf8');
    const lightTokens = parseCustomProperties(extractBlock(styles, ':root'));
    const darkTokens = parseCustomProperties(extractBlock(styles, '.dark'));
    const themeVariables = parseCustomProperties(extractBlock(styles, '@theme inline'));

    const violations = semanticTokens.flatMap((token) => {
      const runtimeVariable = `--bk-color-${token}`;
      const utilityVariable = `--color-${utilityAliases[token]}`;
      const expectedMapping = `var(${runtimeVariable})`;

      return [
        ...(parseOklch(lightTokens.get(runtimeVariable) ?? '')
          ? []
          : [`light ${runtimeVariable} is missing or invalid`]),
        ...(parseOklch(darkTokens.get(runtimeVariable) ?? '') ? [] : [`dark ${runtimeVariable} is missing or invalid`]),
        ...(themeVariables.get(utilityVariable) === expectedMapping
          ? []
          : [`${utilityVariable} must map to ${expectedMapping}`]),
      ];
    });

    expect([...violations, ...findRawVisualValues()].sort()).toEqual([]);
  });

  it('detects raw colors in arbitrary utilities, gradients, SVG attributes, and identifier indirection', () => {
    const source = `
      const indirectClass = 'text-red-500';
      const indirectStroke = 'rgb(255 255 255)';
      const safeClass = 'text-foreground';
      const safeStroke = 'currentColor';

      export function Fixture() {
        return (
          <>
            <div className="[color:#fff] from-red-500 to-blue-500" />
            <div class="bg-rose-500 [color:#abc]" />
            <div className="shadow-red-500 caret-[#fff] ring-offset-blue-500 placeholder-green-500" />
            <div className={indirectClass} />
            <div className={safeClass} />
            <svg fill="#fff">
              <path stroke={indirectStroke} />
              <path stroke={safeStroke} />
            </svg>
          </>
        );
      }
    `;

    expect(findRawVisualValues([{ filePath: 'fixture.tsx', source }]).sort()).toEqual(
      [
        'fixture.tsx: [color:#fff]',
        'fixture.tsx: [color:#abc]',
        'fixture.tsx: bg-rose-500',
        'fixture.tsx: caret-[#fff]',
        'fixture.tsx: fill="#fff"',
        'fixture.tsx: from-red-500',
        'fixture.tsx: placeholder-green-500',
        'fixture.tsx: ring-offset-blue-500',
        'fixture.tsx: shadow-red-500',
        'fixture.tsx: stroke="rgb(255 255 255)"',
        'fixture.tsx: text-red-500',
        'fixture.tsx: to-blue-500',
      ].sort(),
    );
  });

  it('does not force a viewport-wide document minimum', () => {
    const styles = removeCssComments(readFileSync(stylesPath, 'utf8'));

    expect(styles).not.toMatch(/html,\s*body\s*\{[^}]*min-width\s*:/s);
  });

  it.each([
    ['light', ':root'],
    ['dark', '.dark'],
  ])('meets the approved contrast floor in the %s palette', (_mode, selector) => {
    const styles = readFileSync(stylesPath, 'utf8');
    const tokens = parseCustomProperties(extractBlock(styles, selector));
    const failures = contrastPairs.flatMap(([foreground, background, minimum]) => {
      const foregroundColor = parseOklch(tokens.get(`--bk-color-${foreground}`) ?? '');
      const backgroundColor = parseOklch(tokens.get(`--bk-color-${background}`) ?? '');

      if (!foregroundColor || !backgroundColor) {
        return [`${foreground}/${background} cannot be measured`];
      }

      const ratio = contrastRatio(foregroundColor, backgroundColor);

      return ratio >= minimum ? [] : [`${foreground}/${background} is ${ratio.toFixed(2)}:1, expected ${minimum}:1`];
    });

    expect(failures).toEqual([]);
  });
});
