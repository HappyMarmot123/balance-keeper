export type DevelopmentProcessSpec = Readonly<{
  args: readonly string[];
  command: string;
  name: string;
}>;

export function createDevelopmentProcessSpecs(workspaceRoot?: string): readonly DevelopmentProcessSpec[];
export function createLocalBundleWaiter(bundlePath?: string): Promise<() => Promise<void>>;
export function runDevelopmentStack(options?: Readonly<Record<string, unknown>>): Promise<number>;
export function waitForLocalApi(fetchImplementation?: typeof fetch): Promise<void>;
