import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTemplate(name: string) {
  return readFileSync(path.join(process.cwd(), '.github', 'ISSUE_TEMPLATE', name), 'utf8');
}

describe('GitHub issue templates', () => {
  it('collects useful diagnostics in the bug report form', () => {
    const template = readTemplate('bug_report.yml');

    expect(template).toContain('Pi version');
    expect(template).toContain('pi-web-agent package version');
    expect(template).toContain('Operating system');
    expect(template).toContain('Exact prompt used');
    expect(template).toContain('/web-agent show');
    expect(template).toContain('/web-agent doctor');
    expect(template).toContain('Terminal logs printed when Pi was launched');
  });

  it('has a feature request form', () => {
    const template = readTemplate('feature_request.yml');

    expect(template).toContain('Feature request');
    expect(template).toContain('What are you trying to do?');
  });

  it('configures blank issues intentionally', () => {
    const config = readTemplate('config.yml');

    expect(config).toContain('blank_issues_enabled: false');
  });
});
