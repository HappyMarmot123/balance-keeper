import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const workspaceRoot = resolve(import.meta.dirname, '../..');
const branchWorkflowPath = resolve(workspaceRoot, '.github/workflows/ci.yml');
const reviewSchemaPath = resolve(workspaceRoot, '.github/codex/schemas/clean-code-review.schema.json');
const reviewPromptPath = resolve(workspaceRoot, '.github/codex/prompts/clean-code-review.md');
const pullRequestTemplatePath = resolve(workspaceRoot, '.github/pull_request_template.md');
const agentsPath = resolve(workspaceRoot, 'AGENTS.md');
const pullRequestWorkflowPath = resolve(workspaceRoot, '.github/workflows/frontend-pr-review.yml');
const githubExpression = (expression: string) => ['$', `{{ ${expression} }}`].join('');
const shellVariable = (variable: string) => ['$', `{${variable}}`].join('');

interface Workflow {
  concurrency?: {
    'cancel-in-progress'?: boolean;
    group?: string;
  };
  on?: {
    pull_request?: {
      branches?: string[];
      types?: string[];
    };
    push?: {
      branches?: string[];
    };
  };
  jobs?: Record<
    string,
    {
      env?: Record<string, string>;
      if?: string;
      name?: string;
      needs?: string | string[];
      outputs?: Record<string, string>;
      permissions?: Record<string, string>;
      'runs-on'?: string;
      steps?: Array<{
        env?: Record<string, string>;
        id?: string;
        name?: string;
        run?: string;
        shell?: string;
        uses?: string;
        with?: Record<string, unknown>;
        'continue-on-error'?: boolean;
      }>;
      'timeout-minutes'?: number;
    }
  >;
  permissions?: Record<string, string>;
}

interface GitHubComment {
  body: string;
  id: number;
  user: { login: string; type: string } | null;
}

interface FeedbackRun {
  created: Array<Record<string, unknown>>;
  deleted: Array<Record<string, unknown>>;
  listed: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
}

function readWorkflow(path: string): Workflow {
  const document = parseDocument(readFileSync(path, 'utf8'));
  const problems = [...document.errors, ...document.warnings];
  if (problems.length > 0) {
    throw new SyntaxError(problems.map((problem) => problem.message).join('\n'));
  }
  return document.toJS() as Workflow;
}

function readFeedbackScript(): string {
  const workflow = readWorkflow(pullRequestWorkflowPath);
  const script = workflow.jobs?.['post-feedback']?.steps?.[0]?.with?.script;
  if (typeof script !== 'string') {
    throw new TypeError('post-feedback github-script is missing');
  }
  return script;
}

async function runFeedback(options: {
  comments?: GitHubComment[];
  failOperation?: 'create' | 'delete' | 'list' | 'update';
  headSha?: string;
  jobResult?: string;
  reviewJson?: string;
}): Promise<FeedbackRun> {
  const created: Array<Record<string, unknown>> = [];
  const deleted: Array<Record<string, unknown>> = [];
  const listed: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const comments = options.comments ?? [];
  const listComments = async () => ({ data: comments });
  const github = {
    paginate: async (_method: unknown, parameters: Record<string, unknown>) => {
      if (options.failOperation === 'list') {
        throw new Error('list failed');
      }
      listed.push(parameters);
      return comments;
    },
    rest: {
      issues: {
        createComment: async (parameters: Record<string, unknown>) => {
          if (options.failOperation === 'create') {
            throw new Error('create failed');
          }
          created.push(parameters);
        },
        deleteComment: async (parameters: Record<string, unknown>) => {
          if (options.failOperation === 'delete') {
            throw new Error('delete failed');
          }
          deleted.push(parameters);
        },
        listComments,
        updateComment: async (parameters: Record<string, unknown>) => {
          if (options.failOperation === 'update') {
            throw new Error('update failed');
          }
          updated.push(parameters);
        },
      },
    },
  };
  const context = {
    issue: { number: 17 },
    repo: { owner: 'HappyMarmot123', repo: 'balance-keeper' },
  };
  const previousEnvironment = {
    CODEX_REVIEW_JOB_RESULT: process.env.CODEX_REVIEW_JOB_RESULT,
    CODEX_REVIEW_JSON: process.env.CODEX_REVIEW_JSON,
    REVIEWED_HEAD_SHA: process.env.REVIEWED_HEAD_SHA,
  };

  process.env.CODEX_REVIEW_JOB_RESULT = options.jobResult ?? 'success';
  process.env.CODEX_REVIEW_JSON = options.reviewJson ?? '';
  process.env.REVIEWED_HEAD_SHA = options.headSha ?? '1234567890abcdef1234567890abcdef12345678';

  try {
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
      ...parameters: string[]
    ) => (...arguments_: unknown[]) => Promise<unknown>;
    const execute = new AsyncFunction('github', 'context', 'core', readFeedbackScript());
    await execute(github, context, {});
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  return { created, deleted, listed, updated };
}

const validPassReview = {
  findings: [],
  status: 'PASS',
  summary: '변경분에서 보고할 문제를 발견하지 못했습니다.',
  verificationLimits: [],
};

const validFinding = {
  impact: 'LEAK_IMPACT',
  line: 27,
  path: 'src/shared/lib/example.ts',
  reason: 'LEAK_REASON',
  recommendation: 'LEAK_RECOMMENDATION',
  severity: 'HIGH',
  title: 'LEAK_TITLE',
};

const botReviewComment = (id: number): GitHubComment => ({
  body: '<!-- balance-keeper:codex-review -->\n이전 결과',
  id,
  user: { login: 'github-actions[bot]', type: 'Bot' },
});

const apiFailureScenarios: Array<{
  comments: GitHubComment[];
  name: string;
  operation: NonNullable<Parameters<typeof runFeedback>[0]['failOperation']>;
}> = [
  { comments: [], name: 'list', operation: 'list' },
  { comments: [], name: 'create', operation: 'create' },
  { comments: [botReviewComment(41)], name: 'update', operation: 'update' },
  {
    comments: [botReviewComment(41), botReviewComment(42)],
    name: 'delete after update',
    operation: 'delete',
  },
];

const invalidReviewOutputs = [
  ['empty output', '', ''],
  ['malformed JSON', '{"LEAK_MALFORMED"', 'LEAK_MALFORMED'],
  ['unknown status', JSON.stringify({ ...validPassReview, status: 'LEAK_UNKNOWN_STATUS' }), 'LEAK_UNKNOWN_STATUS'],
  ['additional root field', JSON.stringify({ ...validPassReview, unexpected: 'LEAK_EXTRA_FIELD' }), 'LEAK_EXTRA_FIELD'],
  ['inconsistent PASS result', JSON.stringify({ ...validPassReview, findings: [validFinding] }), 'LEAK_TITLE'],
  [
    'unsafe finding path',
    JSON.stringify({
      findings: [{ ...validFinding, path: '../LEAK_SECRET.ts' }],
      status: 'CHANGES_REQUESTED',
      summary: 'LEAK_PATH_SUMMARY',
      verificationLimits: [],
    }),
    'LEAK_SECRET',
  ],
  [
    'duplicate findings',
    JSON.stringify({
      findings: [validFinding, validFinding],
      status: 'CHANGES_REQUESTED',
      summary: 'LEAK_DUPLICATE_SUMMARY',
      verificationLimits: [],
    }),
    'LEAK_DUPLICATE_SUMMARY',
  ],
  [
    'external URL',
    JSON.stringify({
      findings: [],
      status: 'BLOCKED',
      summary: 'LEAK_URL https://evil.example',
      verificationLimits: ['외부 자료를 확인할 수 없습니다.'],
    }),
    'https://evil.example',
  ],
  [
    'oversized output',
    JSON.stringify({ ...validPassReview, summary: `LEAK_OVERSIZED_${'가'.repeat(70_000)}` }),
    'LEAK_OVERSIZED',
  ],
] as const;

describe('GitHub pull request review contract', () => {
  it('provides a dedicated frontend pull request review workflow', () => {
    expect(existsSync(pullRequestWorkflowPath)).toBe(true);
  });

  it('runs for ready-state changes targeting development', () => {
    const workflow = readWorkflow(pullRequestWorkflowPath);

    expect(workflow.on?.pull_request).toEqual({
      branches: ['development'],
      types: ['opened', 'synchronize', 'reopened', 'ready_for_review'],
    });
  });

  it('cancels superseded runs without path filters', () => {
    const source = readFileSync(pullRequestWorkflowPath, 'utf8');
    const workflow = readWorkflow(pullRequestWorkflowPath);

    expect(workflow.concurrency).toEqual({
      group: `${githubExpression('github.workflow')}-${githubExpression('github.ref')}`,
      'cancel-in-progress': true,
    });
    expect(source).not.toMatch(/^\s+paths(?:-ignore)?:/m);
  });

  it('runs the quality gate for every non-draft pull request with read-only contents', () => {
    const workflow = readWorkflow(pullRequestWorkflowPath);
    const qualityGate = workflow.jobs?.['quality-gate'];

    expect(workflow.permissions).toEqual({});
    expect(qualityGate).toMatchObject({
      if: githubExpression('github.event.pull_request.draft != true'),
      name: 'quality-gate',
      permissions: { contents: 'read' },
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 20,
    });
  });

  it('checks out the merge ref without persisted credentials on immutable actions', () => {
    const workflow = readWorkflow(pullRequestWorkflowPath);
    const steps = workflow.jobs?.['quality-gate']?.steps ?? [];

    expect(steps.slice(0, 2)).toEqual([
      {
        name: 'Checkout merge result',
        uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        with: { 'persist-credentials': false },
      },
      {
        name: 'Set up Node.js',
        uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        with: {
          cache: 'npm',
          'cache-dependency-path': 'package-lock.json',
          'node-version-file': '.nvmrc',
        },
      },
    ]);

    for (const step of steps.filter((candidate) => candidate.uses)) {
      expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
    }
  });

  it('installs from the lockfile and exposes each validation failure separately', () => {
    const workflow = readWorkflow(pullRequestWorkflowPath);
    const steps = workflow.jobs?.['quality-gate']?.steps ?? [];

    expect(steps[2]).toMatchObject({ name: 'Activate pinned npm', shell: 'bash' });
    expect(steps[2]?.run).toContain('corepack enable npm');
    expect(steps[2]?.run).toContain('corepack install --global npm@11.17.0');
    expect(steps[2]?.run).toContain('GITHUB_PATH');
    expect(steps[2]?.run).toContain("= '11.17.0'");
    expect(steps.slice(3)).toEqual([
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Check formatting and lint', run: 'npm run check' },
      { name: 'Run tests', run: 'npm test' },
      { name: 'Typecheck', run: 'npm run typecheck' },
      { name: 'Build client and server', run: 'npm run build' },
    ]);
    expect(JSON.stringify(workflow.jobs?.['quality-gate'])).not.toContain('secrets.');
  });

  it('gates the read-only Codex job on quality, trust, and explicit enablement', () => {
    const workflow = readWorkflow(pullRequestWorkflowPath);
    const review = workflow.jobs?.['codex-review'];

    expect(review).toMatchObject({
      name: 'codex-review',
      needs: 'quality-gate',
      outputs: {
        'final-message': githubExpression('steps.codex.outputs.final-message'),
        'reviewed-head-sha': githubExpression('github.event.pull_request.head.sha'),
      },
      permissions: { contents: 'read' },
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 30,
    });
    for (const guard of [
      "needs.quality-gate.result == 'success'",
      'github.event.pull_request.draft != true',
      'github.event.pull_request.head.repo.full_name == github.repository',
      "github.event.pull_request.user.type != 'Bot'",
      "github.event.sender.type != 'Bot'",
      "vars.CODEX_REVIEW_ENABLED == 'true'",
    ]) {
      expect(review?.if).toContain(guard);
    }
    expect(review?.env).toBeUndefined();
  });

  it('runs one pinned read-only Codex action as the final review step', () => {
    const source = readFileSync(pullRequestWorkflowPath, 'utf8');
    const workflow = readWorkflow(pullRequestWorkflowPath);
    const steps = workflow.jobs?.['codex-review']?.steps ?? [];

    expect(steps).toHaveLength(3);
    expect(steps[0]).toEqual({
      name: 'Checkout review target',
      uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      with: { 'fetch-depth': 0, 'persist-credentials': false },
    });
    expect(steps.at(-1)).toEqual({
      env: {
        BASE_SHA: githubExpression('github.event.pull_request.base.sha'),
        HEAD_SHA: githubExpression('github.event.pull_request.head.sha'),
        REVIEW_WORKSPACE: githubExpression('github.workspace'),
      },
      id: 'codex',
      name: 'Review changed code',
      uses: 'openai/codex-action@52fe01ec70a42f454c9d2ebd47598f9fd6893d56',
      with: {
        'codex-version': '0.145.0',
        effort: 'high',
        model: 'gpt-5.6-sol',
        'openai-api-key': githubExpression('secrets.OPENAI_API_KEY'),
        'output-schema-file': `${githubExpression('runner.temp')}/balance-keeper-review-policy/clean-code-review.schema.json`,
        'permission-profile': ':read-only',
        'prompt-file': `${githubExpression('runner.temp')}/balance-keeper-review-policy/clean-code-review.md`,
        'safety-strategy': 'drop-sudo',
        'codex-home': `${githubExpression('runner.temp')}/balance-keeper-codex-home`,
        'working-directory': `${githubExpression('runner.temp')}/balance-keeper-review-policy`,
      },
    });
    expect(source.match(/OPENAI_API_KEY/g)).toHaveLength(1);
    expect(source).not.toMatch(/^\s+sandbox:/m);
    expect(source).not.toContain('allow-users:');
    expect(source).not.toContain('allow-bots:');
  });

  it('loads trusted base policy and disables pull-request-owned instruction layers', () => {
    const workflow = readWorkflow(pullRequestWorkflowPath);
    const prepare = workflow.jobs?.['codex-review']?.steps?.[1];

    expect(prepare).toMatchObject({
      env: {
        BASE_SHA: githubExpression('github.event.pull_request.base.sha'),
        HEAD_SHA: githubExpression('github.event.pull_request.head.sha'),
        TRUSTED_CODEX_HOME: `${githubExpression('runner.temp')}/balance-keeper-codex-home`,
        TRUSTED_POLICY_DIR: `${githubExpression('runner.temp')}/balance-keeper-review-policy`,
      },
      name: 'Prepare trusted review policy',
      shell: 'bash',
    });

    const script = prepare?.run ?? '';
    expect(script).toContain(`git cat-file -e "${shellVariable('BASE_SHA')}^{commit}"`);
    expect(script).toContain(`git cat-file -e "${shellVariable('HEAD_SHA')}^{commit}"`);
    expect(script).toContain(`git show "${shellVariable('BASE_SHA')}:.github/codex/prompts/clean-code-review.md"`);
    expect(script).toContain(
      `git show "${shellVariable('BASE_SHA')}:.github/codex/schemas/clean-code-review.schema.json"`,
    );
    expect(script).toContain('project_doc_max_bytes = 0');
    expect(script).toContain('project_doc_fallback_filenames = []');
    expect(script).toContain('web_search = "disabled"');
    expect(script).toContain('hooks = false');
    expect(script).not.toContain('trust_level');
    expect(script).not.toContain('secrets.');
    expect(script).not.toContain('${{');
  });

  it('isolates write access in one no-checkout feedback step', () => {
    const workflow = readWorkflow(pullRequestWorkflowPath);
    const feedback = workflow.jobs?.['post-feedback'];

    expect(feedback).toMatchObject({
      name: 'post-feedback',
      needs: 'codex-review',
      permissions: { 'pull-requests': 'write' },
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 5,
    });
    expect(feedback?.if).toContain('always()');
    expect(feedback?.if).toContain('!cancelled()');
    expect(feedback?.if).toContain("needs.codex-review.result != 'skipped'");
    expect(feedback?.env).toBeUndefined();

    const steps = feedback?.steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      env: {
        CODEX_REVIEW_JSON: githubExpression('needs.codex-review.outputs.final-message'),
        CODEX_REVIEW_JOB_RESULT: githubExpression('needs.codex-review.result'),
        REVIEWED_HEAD_SHA: githubExpression('github.event.pull_request.head.sha'),
      },
      name: 'Publish review feedback',
      uses: 'actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3',
      with: { 'github-token': githubExpression('github.token') },
    });
    expect(steps[0]?.run).toBeUndefined();
    expect(steps[0]?.with?.script).toEqual(expect.any(String));
    expect(steps[0]?.with?.script).not.toContain('${{');
    expect(JSON.stringify(feedback)).not.toContain('OPENAI_API_KEY');
  });
});

describe('GitHub branch validation contract', () => {
  it('runs only for pushes to main and development', () => {
    const workflow = readWorkflow(branchWorkflowPath);

    expect(workflow.on).toEqual({
      push: { branches: ['main', 'development'] },
    });
  });

  it('uses a uniquely named read-only validation job', () => {
    const workflow = readWorkflow(branchWorkflowPath);

    expect(workflow.permissions).toEqual({});
    expect(workflow.jobs?.['branch-validation']).toMatchObject({
      name: 'branch-validation',
      permissions: { contents: 'read' },
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 20,
    });
    expect(workflow.jobs?.validate).toBeUndefined();
  });

  it('uses immutable setup actions and the repository validation command', () => {
    const workflow = readWorkflow(branchWorkflowPath);
    const steps = workflow.jobs?.['branch-validation']?.steps ?? [];

    expect(steps.slice(0, 2)).toEqual([
      {
        name: 'Checkout',
        uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        with: { 'persist-credentials': false },
      },
      {
        name: 'Set up Node.js',
        uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        with: {
          cache: 'npm',
          'cache-dependency-path': 'package-lock.json',
          'node-version-file': '.nvmrc',
        },
      },
    ]);
    expect(steps[2]).toMatchObject({ name: 'Activate pinned npm', shell: 'bash' });
    expect(steps[2]?.run).toContain('corepack enable npm');
    expect(steps[2]?.run).toContain('corepack install --global npm@11.17.0');
    expect(steps[2]?.run).toContain('GITHUB_PATH');
    expect(steps[2]?.run).toContain("= '11.17.0'");
    expect(steps.slice(3)).toEqual([
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Validate', run: 'npm run validate' },
    ]);
  });
});

describe('GitHub workflow security contract', () => {
  it('uses only immutable trusted actions and hosted least-privilege jobs', () => {
    const workflowDirectory = resolve(workspaceRoot, '.github/workflows');
    const workflowPaths = readdirSync(workflowDirectory)
      .filter((fileName) => /\.ya?ml$/u.test(fileName))
      .map((fileName) => resolve(workflowDirectory, fileName));
    const trustedActions = new Set([
      'actions/checkout',
      'actions/github-script',
      'actions/setup-node',
      'openai/codex-action',
    ]);

    for (const workflowPath of workflowPaths) {
      const source = readFileSync(workflowPath, 'utf8');
      const workflow = readWorkflow(workflowPath);
      const triggers = workflow.on as Record<string, unknown> | undefined;

      expect(triggers).not.toHaveProperty('pull_request_target');
      expect(triggers).not.toHaveProperty('repository_dispatch');
      expect(triggers).not.toHaveProperty('workflow_run');
      expect(source).not.toContain('write-all');
      expect(source).not.toMatch(/^\s+(?:actions|contents): write$/mu);
      expect(source).not.toContain('self-hosted');

      for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
        expect(job['runs-on'], jobId).toBe('ubuntu-latest');
        expect(job['timeout-minutes'], jobId).toBeGreaterThan(0);
        for (const step of job.steps ?? []) {
          expect(step['continue-on-error'], `${jobId}:${step.name}`).toBeUndefined();
          if (step.uses) {
            const match = /^(?<action>[\w-]+\/[\w-]+)@(?<sha>[0-9a-f]{40})$/u.exec(step.uses);
            expect(match, step.uses).not.toBeNull();
            expect(trustedActions.has(match?.groups?.action ?? ''), step.uses).toBe(true);
          }
          if (step.uses?.startsWith('actions/checkout@')) {
            expect(step.with?.['persist-credentials'], `${jobId}:checkout`).toBe(false);
          }
        }
      }
    }
  });

  it('does not execute pull request prose or model output as code', () => {
    const source = readFileSync(pullRequestWorkflowPath, 'utf8');
    const script = readFeedbackScript();

    expect(source).not.toMatch(
      /\$\{\{\s*github\.event\.pull_request\.(?:body|title)|\$\{\{\s*github\.event\.comment\.body/u,
    );
    expect(script).not.toContain('${{');
    expect(script).not.toMatch(/\beval\s*\(|\bnew\s+Function\b|\brequire\s*\(|\b(?:exec|spawn)\s*\(/u);
    expect(script).not.toContain('process.env.OPENAI_API_KEY');
  });
});

describe('Codex review output contract', () => {
  it('defines a bounded strict schema for every published field', () => {
    expect(existsSync(reviewSchemaPath)).toBe(true);

    const schema = JSON.parse(readFileSync(reviewSchemaPath, 'utf8')) as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
      required?: string[];
      type?: string;
    };

    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ['status', 'summary', 'findings', 'verificationLimits'],
      type: 'object',
    });
    expect(schema.properties).toMatchObject({
      status: { enum: ['PASS', 'CHANGES_REQUESTED', 'BLOCKED'], type: 'string' },
      summary: { maxLength: 600, minLength: 1, type: 'string' },
      findings: { maxItems: 12, type: 'array' },
      verificationLimits: { maxItems: 8, type: 'array' },
    });

    const findings = schema.properties?.findings as {
      items?: { additionalProperties?: boolean; required?: string[] };
      uniqueItems?: boolean;
    };
    const verificationLimits = schema.properties?.verificationLimits as {
      uniqueItems?: boolean;
    };
    expect(findings.uniqueItems).toBeUndefined();
    expect(verificationLimits.uniqueItems).toBeUndefined();
    expect(findings.items).toMatchObject({
      additionalProperties: false,
      required: ['severity', 'path', 'line', 'title', 'reason', 'impact', 'recommendation'],
    });
  });

  it('uses a static Korean diff-only prompt that treats pull request content as data', () => {
    expect(existsSync(reviewPromptPath)).toBe(true);

    const prompt = readFileSync(reviewPromptPath, 'utf8');
    expect(prompt).toContain('$BASE_SHA...$HEAD_SHA');
    expect(prompt).toContain('$REVIEW_WORKSPACE');
    expect(prompt).toContain('git -C "$REVIEW_WORKSPACE" diff "$BASE_SHA...$HEAD_SHA" --');
    expect(prompt).toContain('checkout으로 작업 디렉터리를 변경하지 않는다');
    expect(prompt).toContain('PASS | CHANGES_REQUESTED | BLOCKED');
    expect(prompt).toContain('JSON 이외의 텍스트를 출력하지 않는다');
    expect(prompt).toContain('PR 제목·본문·댓글·커밋 메시지');
    expect(prompt).toContain('신뢰하지 않는 데이터');
    expect(prompt).toContain('가독성·예측 가능성·응집도·결합도');
    expect(prompt).toContain('코드를 수정하거나 프로젝트 명령을 실행하지 않는다');
    expect(prompt).toContain('설명 필드는 한국어');
    expect(prompt).toContain('최소 수정 방향');
    expect(prompt).not.toContain('${{');
  });
});

describe('Pull request documentation contract', () => {
  it('captures purpose, evidence, regression risk, and disclosure safety', () => {
    expect(existsSync(pullRequestTemplatePath)).toBe(true);

    const template = readFileSync(pullRequestTemplatePath, 'utf8');
    for (const heading of [
      '## 변경 목적',
      '## 주요 변경',
      '## 검증 결과',
      '## 회귀 위험',
      '## 미검증 항목',
      '## 시각 자료',
    ]) {
      expect(template).toContain(heading);
    }
    expect(template).toContain('Task ID');
    expect(template).toContain('정상 흐름');
    expect(template).toContain('실패 흐름');
    expect(template).toContain('경계값');
    expect(template).toContain('secret·개인정보·실제 환경값');
  });

  it('keeps durable human and automated review rules in repository instructions', () => {
    const instructions = readFileSync(agentsPath, 'utf8');

    expect(instructions).toContain('## Pull request and code review');
    expect(instructions).toContain('`feature/*`');
    expect(instructions).toContain('`development`');
    expect(instructions).toContain('변경분만 검토');
    expect(instructions).toContain('재현 가능한 문제');
    expect(instructions).toContain('취향과 단순 포맷');
    expect(instructions).toContain('Codex 리뷰는 참고 의견');
    expect(instructions).toContain('사람의 최종 승인');
  });
});

describe('Codex feedback behavior', () => {
  it('creates one owned comment for a valid PASS result', async () => {
    const result = await runFeedback({ reviewJson: JSON.stringify(validPassReview) });

    expect(result.listed).toEqual([
      { owner: 'HappyMarmot123', per_page: 100, repo: 'balance-keeper', issue_number: 17 },
    ]);
    expect(result.created).toHaveLength(1);
    expect(result.updated).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);

    const body = result.created[0]?.body;
    expect(body).toEqual(expect.any(String));
    expect(body).toContain('<!-- balance-keeper:codex-review -->');
    expect(body).toContain('**상태:** PASS');
    expect(body).toContain('1234567890abcdef1234567890abcdef12345678');
  });

  it('updates the existing owned marker comment', async () => {
    const result = await runFeedback({
      comments: [
        {
          body: '<!-- balance-keeper:codex-review -->\n이전 결과',
          id: 41,
          user: { login: 'github-actions[bot]', type: 'Bot' },
        },
      ],
      reviewJson: JSON.stringify(validPassReview),
    });

    expect(result.created).toHaveLength(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({
      comment_id: 41,
      owner: 'HappyMarmot123',
      repo: 'balance-keeper',
    });
    expect(result.deleted).toHaveLength(0);
  });

  it('does not update an identical canonical comment', async () => {
    const initial = await runFeedback({ reviewJson: JSON.stringify(validPassReview) });
    const currentBody = String(initial.created[0]?.body);
    const result = await runFeedback({
      comments: [
        {
          body: currentBody,
          id: 41,
          user: { login: 'github-actions[bot]', type: 'Bot' },
        },
      ],
      reviewJson: JSON.stringify(validPassReview),
    });

    expect(result.created).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });

  it('deduplicates owned comments without touching a spoofed human marker', async () => {
    const result = await runFeedback({
      comments: [
        {
          body: '<!-- balance-keeper:codex-review -->\n사용자 댓글',
          id: 1,
          user: { login: 'contributor', type: 'User' },
        },
        {
          body: '<!-- balance-keeper:codex-review -->\n두 번째 자동 댓글',
          id: 42,
          user: { login: 'github-actions[bot]', type: 'Bot' },
        },
        {
          body: '<!-- balance-keeper:codex-review -->\n첫 번째 자동 댓글',
          id: 41,
          user: { login: 'github-actions[bot]', type: 'Bot' },
        },
      ],
      reviewJson: JSON.stringify(validPassReview),
    });

    expect(result.created).toHaveLength(0);
    expect(result.updated[0]).toMatchObject({ comment_id: 41 });
    expect(result.deleted).toEqual([{ comment_id: 42, owner: 'HappyMarmot123', repo: 'balance-keeper' }]);
  });

  it('finds an owned marker after more than one API page', async () => {
    const comments = Array.from({ length: 101 }, (_, index) => ({
      body: `일반 댓글 ${index}`,
      id: index + 1,
      user: { login: `user-${index}`, type: 'User' },
    }));
    comments.push({
      body: '<!-- balance-keeper:codex-review -->\n이전 결과',
      id: 200,
      user: { login: 'github-actions[bot]', type: 'Bot' },
    });

    const result = await runFeedback({
      comments,
      reviewJson: JSON.stringify(validPassReview),
    });

    expect(result.created).toHaveLength(0);
    expect(result.updated[0]).toMatchObject({ comment_id: 200 });
  });

  it('ignores a bot marker that is not on the first line', async () => {
    const result = await runFeedback({
      comments: [
        {
          body: '접두사\n<!-- balance-keeper:codex-review -->',
          id: 41,
          user: { login: 'github-actions[bot]', type: 'Bot' },
        },
      ],
      reviewJson: JSON.stringify(validPassReview),
    });

    expect(result.created).toHaveLength(1);
    expect(result.updated).toHaveLength(0);
  });

  it('renders every actionable field for CHANGES_REQUESTED', async () => {
    const result = await runFeedback({
      reviewJson: JSON.stringify({
        findings: [
          {
            impact: '사용자가 잘못된 상태를 보게 됩니다.',
            line: 27,
            path: 'src/shared/lib/example.ts',
            reason: '실패 응답을 성공 값으로 변환합니다.',
            recommendation: '실패 분기를 원본 오류로 반환하세요.',
            severity: 'HIGH',
            title: '실패 상태가 숨겨집니다',
          },
        ],
        status: 'CHANGES_REQUESTED',
        summary: '수정이 필요한 문제 1건입니다.',
        verificationLimits: [],
      }),
    });

    const body = String(result.created[0]?.body);
    expect(body).toContain('**상태:** CHANGES_REQUESTED');
    expect(body).toContain('### 발견된 문제');
    expect(body).toContain('[HIGH] 실패 상태가 숨겨집니다');
    expect(body).toContain('src/shared/lib/example.ts:27');
    expect(body).toContain('**이유:** 실패 응답을 성공 값으로 변환합니다.');
    expect(body).toContain('**영향:** 사용자가 잘못된 상태를 보게 됩니다.');
    expect(body).toContain('**수정 방향:** 실패 분기를 원본 오류로 반환하세요.');
  });

  it('renders verification limits for a valid BLOCKED result', async () => {
    const result = await runFeedback({
      reviewJson: JSON.stringify({
        findings: [],
        status: 'BLOCKED',
        summary: '변경 기준 커밋을 확인할 수 없습니다.',
        verificationLimits: ['base SHA가 checkout history에 없습니다.'],
      }),
    });

    const body = String(result.created[0]?.body);
    expect(body).toContain('**상태:** BLOCKED');
    expect(body).toContain('### 검증 제한');
    expect(body).toContain('- base SHA가 checkout history에 없습니다.');
  });

  it('publishes a fixed BLOCKED result when the Codex job fails', async () => {
    const result = await runFeedback({
      jobResult: 'failure',
      reviewJson: JSON.stringify({ ...validPassReview, summary: 'LEAK_FAILED_JOB' }),
    });

    const body = String(result.created[0]?.body);
    expect(body).toContain('**상태:** BLOCKED');
    expect(body).toContain('자동 리뷰 결과를 안전하게 처리하지 못했습니다.');
    expect(body).not.toContain('LEAK_FAILED_JOB');
  });

  it.each(invalidReviewOutputs)('publishes a bounded BLOCKED result for %s', async (_name, reviewJson, leakMarker) => {
    const result = await runFeedback({ reviewJson });
    const body = String(result.created[0]?.body);

    expect(body).toContain('**상태:** BLOCKED');
    expect(body).toContain('자동 리뷰 결과를 안전하게 처리하지 못했습니다.');
    if (leakMarker) {
      expect(body).not.toContain(leakMarker);
    }
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(60_000);
  });

  it('neutralizes markup, marker injection, and mentions in valid model fields', async () => {
    const result = await runFeedback({
      reviewJson: JSON.stringify({
        findings: [],
        status: 'BLOCKED',
        summary: '<script>LEAK_SCRIPT</script> @reviewers',
        verificationLimits: ['<!-- balance-keeper:codex-review --> [LEAK_LINK](target)'],
      }),
    });

    const body = String(result.created[0]?.body);
    expect(body.match(/<!-- balance-keeper:codex-review -->/gu)).toHaveLength(1);
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('@reviewers');
    expect(body).not.toContain('[LEAK_LINK](target)');
    expect(body).toContain('&lt;script&gt;LEAK\\_SCRIPT&lt;/script&gt;');
    expect(body).toContain('@\u200breviewers');
  });

  it.each(apiFailureScenarios)('propagates GitHub API failures from $name', async ({ comments, operation }) => {
    await expect(
      runFeedback({
        comments,
        failOperation: operation,
        reviewJson: JSON.stringify(validPassReview),
      }),
    ).rejects.toThrow(`${operation} failed`);
  });
});
