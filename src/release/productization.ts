import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ProductizationReport {
  readonly packageName: string;
  readonly version: string;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly passed: boolean;
}

export function inspectProductization(root: string): ProductizationReport {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name?: string;
    version?: string;
    bin?: Record<string, string>;
    exports?: Record<string, unknown>;
  };
  const checks = {
    packageName: manifest.name === 'personal-agent',
    version: typeof manifest.version === 'string' && manifest.version === '0.4.0',
    binDeclared: manifest.bin?.['personal-agent'] === './dist/cli/main.js',
    rootImportDeclared: manifest.exports?.['.'] !== undefined,
    distEntryBuilt: existsSync(join(root, 'dist', 'index.js')),
    cliBuilt: existsSync(join(root, 'dist', 'cli', 'main.js')),
    deploymentDocsPresent: existsSync(join(root, 'docs', 'deployment.md')),
  };
  return {
    packageName: manifest.name ?? '<missing>',
    version: manifest.version ?? '<missing>',
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}
