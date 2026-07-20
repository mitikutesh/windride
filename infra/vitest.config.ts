import { defineConfig } from 'vitest/config';

// Infra tests are CDK assertion tests (Template.fromStack) — they synthesize CloudFormation in
// memory and assert on it. No AWS credentials, no network, no live calls (CLAUDE.md rule 3 applies
// to infra too). `cdk deploy` is a separate, manual, credentialed step.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,spec}.ts'],
  },
});
