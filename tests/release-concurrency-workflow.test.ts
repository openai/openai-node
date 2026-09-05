import { readFileSync } from 'node:fs';
import path from 'node:path';

const workflow = readFileSync(path.join(process.cwd(), '.github/workflows/create-releases.yml'), 'utf-8');

describe('release-please scheduling', () => {
  test('queues main release updates without cancelling an active update', () => {
    const releaseJob = workflow.split('\n  release:\n')[1]?.split('\n  publication-check:\n')[0] ?? '';

    expect(releaseJob).toContain("github.event_name == 'push'");
    expect(releaseJob).toContain("github.ref == 'refs/heads/main'");
    expect(releaseJob).toContain(
      [
        '    concurrency:',
        `      group: release-please-\${{ github.ref }}`,
        '      queue: max',
        '      cancel-in-progress: false',
      ].join('\n'),
    );
  });

  test('keeps PR validation and npm publication scheduling independent', () => {
    const workflowSettings = workflow.split('\njobs:\n')[0] ?? '';
    const validationJob =
      workflow.split('\n  validate-release-version:\n')[1]?.split('\n  release:\n')[0] ?? '';
    const publishJob = workflow.split('\n  publish:\n')[1] ?? '';

    expect(workflowSettings).not.toMatch(/^concurrency:/mu);
    expect(validationJob).toContain("github.event_name == 'pull_request'");
    expect(validationJob).not.toMatch(/^ {4}concurrency:/mu);
    expect(publishJob).toContain(`group: publish-npm-\${{ needs.publication-check.outputs.release_sha }}`);
    expect(publishJob).not.toContain('group: release-please-');
  });
});
