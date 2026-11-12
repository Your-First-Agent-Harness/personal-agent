import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Tool, ToolResult } from '../core/tool.ts';
import { createBuiltinTools } from '../tools/builtin.ts';
import { toolError } from '../tools/errors.ts';
import { resolveInWorkspace } from '../tools/workspace.ts';

function parseObjectJson(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== 'string') {
    throw new TypeError(`${label} 必须是 JSON 字符串`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TypeError(`${label} 不是合法 JSON`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} 必须是 JSON 对象`);
  }
  return value as Record<string, unknown>;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${key} 必须是整数`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new TypeError(`${key} 必须是字符串`);
  return value;
}

function tapCount(stdout: string, label: string, required = true): number {
  const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(stdout);
  if (match?.[1] !== undefined) return Number(match[1]);
  if (required) throw new TypeError(`TAP 输出缺少 # ${label} 汇总`);
  return 0;
}

const parseTapOutputTool: Tool = {
  name: 'parse_tap_output',
  description: '从 run_command 的 JSON 结果中提取 Node TAP 测试数量与退出码',
  parameters: {
    type: 'object',
    properties: {
      commandResultJson: { type: 'string', minLength: 2, description: 'run_command 返回的完整 JSON 字符串' },
    },
    required: ['commandResultJson'],
    additionalProperties: false,
  },
  execute(args) {
    return Promise.resolve().then(() => {
      const input = (args ?? {}) as Record<string, unknown>;
      const command = parseObjectJson(input['commandResultJson'], 'commandResultJson');
      const stdout = requiredString(command, 'stdout');
      const exitCode = command['exitCode'];
      if (typeof exitCode !== 'number' && exitCode !== null) {
        throw new TypeError('exitCode 必须是数字或 null');
      }
      return {
        content: JSON.stringify({
          tests: tapCount(stdout, 'tests'),
          pass: tapCount(stdout, 'pass'),
          fail: tapCount(stdout, 'fail'),
          skipped: tapCount(stdout, 'skipped', false),
          todo: tapCount(stdout, 'todo', false),
          exitCode,
        }),
      };
    });
  },
};

const evaluateTestGateTool: Tool = {
  name: 'evaluate_test_gate',
  description: '按测试通过数、失败数和命令退出码评估发布质量门禁',
  parameters: {
    type: 'object',
    properties: {
      configJson: { type: 'string', minLength: 2, description: '包含 title、minPass、maxFail 的 JSON 配置' },
      summaryJson: { type: 'string', minLength: 2, description: 'parse_tap_output 返回的完整 JSON 字符串' },
    },
    required: ['configJson', 'summaryJson'],
    additionalProperties: false,
  },
  execute(args) {
    return Promise.resolve().then(() => {
      const input = (args ?? {}) as Record<string, unknown>;
      const config = parseObjectJson(input['configJson'], 'configJson');
      const summary = parseObjectJson(input['summaryJson'], 'summaryJson');
      const title = requiredString(config, 'title');
      const minPass = requiredNumber(config, 'minPass');
      const maxFail = requiredNumber(config, 'maxFail');
      const tests = requiredNumber(summary, 'tests');
      const pass = requiredNumber(summary, 'pass');
      const fail = requiredNumber(summary, 'fail');
      const exitCode = summary['exitCode'];
      if (typeof exitCode !== 'number' && exitCode !== null) {
        throw new TypeError('exitCode 必须是数字或 null');
      }
      const reasons: string[] = [];
      if (pass < minPass) reasons.push(`通过测试数 ${pass} 低于下限 ${minPass}`);
      if (fail > maxFail) reasons.push(`失败测试数 ${fail} 超过上限 ${maxFail}`);
      if (exitCode !== 0) reasons.push(`测试命令退出码 ${String(exitCode)} 不是 0`);
      const passed = reasons.length === 0;
      if (passed) reasons.push('通过测试数、失败测试数与退出码均满足发布规则');
      return {
        content: JSON.stringify({ title, minPass, maxFail, tests, pass, fail, exitCode, passed, reasons }),
      };
    });
  },
};

const renderReleaseReportTool: Tool = {
  name: 'render_release_report',
  description: '把已通过的测试门禁结果渲染为确定性 Markdown 发布报告',
  parameters: {
    type: 'object',
    properties: {
      gateResultJson: { type: 'string', minLength: 2, description: 'evaluate_test_gate 返回的完整 JSON 字符串' },
    },
    required: ['gateResultJson'],
    additionalProperties: false,
  },
  execute(args) {
    return Promise.resolve().then(() => {
      const input = (args ?? {}) as Record<string, unknown>;
      const gate = parseObjectJson(input['gateResultJson'], 'gateResultJson');
      if (gate['passed'] !== true) {
        return toolError('INVALID_ARGUMENTS', '发布门禁未通过，不生成发布报告', false, '先修复测试并重新评估门禁');
      }
      const title = requiredString(gate, 'title');
      const tests = requiredNumber(gate, 'tests');
      const pass = requiredNumber(gate, 'pass');
      const fail = requiredNumber(gate, 'fail');
      const minPass = requiredNumber(gate, 'minPass');
      const maxFail = requiredNumber(gate, 'maxFail');
      const exitCode = requiredNumber(gate, 'exitCode');
      const report = [
        `# ${title}`,
        '',
        '- 门禁结果：**通过**',
        `- 测试总数：${tests}`,
        `- 通过：${pass}`,
        `- 失败：${fail}`,
        `- 退出码：${exitCode}`,
        `- 规则：至少通过 ${minPass} 项，最多失败 ${maxFail} 项`,
        '',
        '## 判定依据',
        '',
        '- 测试命令真实执行且退出码为 0',
        '- TAP 汇总满足发布门禁',
        '',
      ].join('\n');
      return { content: report };
    });
  },
};

const sha256TextTool: Tool = {
  name: 'sha256_text',
  description: '计算任意 UTF-8 文本的 SHA-256，供产物写入后核对完整性',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要计算摘要的完整文本' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  execute(args) {
    return Promise.resolve().then(() => {
      const text = (args as Record<string, unknown>)['text'] as string;
      const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
      return { content: JSON.stringify({ algorithm: 'sha256', sha256 }) };
    });
  },
};

const verifyFileSha256Tool: Tool = {
  name: 'verify_file_sha256',
  description: '读取工作区内文件并核对实际 SHA-256 是否与预期摘要一致',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1, description: '相对工作区的待校验文件路径' },
      expectedSha256: { type: 'string', minLength: 64, description: '预期的十六进制 SHA-256 摘要' },
    },
    required: ['path', 'expectedSha256'],
    additionalProperties: false,
  },
  execute(args, context): Promise<ToolResult> {
    return Promise.resolve().then(() => {
      const input = (args ?? {}) as Record<string, unknown>;
      const path = requiredString(input, 'path');
      const expectedSha256 = requiredString(input, 'expectedSha256').toLowerCase();
      const content = readFileSync(resolveInWorkspace(context, path));
      const actualSha256 = createHash('sha256').update(content).digest('hex');
      if (actualSha256 !== expectedSha256) {
        return toolError(
          'INVALID_ARGUMENTS',
          `SHA-256 不匹配：预期 ${expectedSha256}，实际 ${actualSha256}`,
          false,
          '请确认写入内容与计算摘要时的文本完全一致',
        );
      }
      return {
        content: JSON.stringify({ path, algorithm: 'sha256', expectedSha256, actualSha256, matched: true }),
      };
    });
  },
};

export function createD032Tools(): Tool[] {
  return [
    ...createBuiltinTools(),
    parseTapOutputTool,
    evaluateTestGateTool,
    renderReleaseReportTool,
    sha256TextTool,
    verifyFileSha256Tool,
  ];
}
