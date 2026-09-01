// Conventional Commits (https://www.conventionalcommits.org) - enforced on
// every commit by the lefthook commit-msg hook and, in CI, on the PR's commits
// and title (.github/workflows/commitlint.yml). Squash merges take the PR
// title, so that is the line that reaches main. See CONTRIBUTING.md.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Scopes are optional; when used, keep to the workspace / area names so
    // history and changelogs stay greppable.
    'scope-enum': [
      2,
      'always',
      [
        'core', // packages/esign-core
        'rn', // packages/esign-react-native
        'react', // packages/esign-react
        'api', // apps/api
        'demo', // examples/*
        'e2e',
        'ci',
        'deps',
        'deps-dev',
        'docs',
        'release',
      ],
    ],
    // Dependabot group titles and imperative subjects run long; keep the
    // conventional default but allow a little slack over 72.
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 100],
  },
};
