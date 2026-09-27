# CONTRIBUTING

## How to Contribute

Discussion, testing, and coding.

## How to Test New Code Before Contributing

This is a TypeScript action. To test it in a GitHub Actions workflow, you need to build it into JavaScript. Also, because this action uses "[self-repository syntax](https://github.blog/changelog/2026-07-30-reference-same-repository-actions-with-self-repository-syntax/)", the root "action.yml" file needs some tweaks before you `uses:` the built action.

To avoid repeating the same tutorial over and over again in issues and pull request comments, here's an example workflow that makes it easy to test anyone's edited version of the action from any repository in GitHub ecosystem, without playing with forks:

```YAML
# .github/workflows/test.yml

name: Test
on:
  push:
  workflow_dispatch:
jobs:
  test:
    timeout-minutes: 10  # Increase this if the job needs more time.
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false  # Let every job finish.
      matrix:
        os:
          - ubuntu-22.04
          - ubuntu-24.04
          - windows-2022
          - windows-2025
          - macos-26
          - macos-26-intel
    env:
      # Paths that are not under $GITHUB_WORKSPACE will make the "actions/checkout" step fail.
      # Paths that do not start with "./", or contain "..", will make the "Install Qt ..." step fail while parsing the root "action.yml" file.
      IQTA_WORKING_DIR: './.iqta-action'
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          path: "${{ env.IQTA_WORKING_DIR }}"
          # Change these two values as needed.
          repository: 'jurplel/install-qt-action'
          ref: '5527a0292e62299031937ff8360329f5aa5cc6e6'

      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: "${{ env.IQTA_WORKING_DIR }}/action/"

      - name: Build action
        run: |
          set -ex

          cd action
          npm ci
          npm run build
        shell: bash
        working-directory: "${{ env.IQTA_WORKING_DIR }}"

      # See the root "action.yml" file.
      - name: Use local built internal action (hack)
        run: |
          sed -i.bak "s|uses: \$/action|uses: $IQTA_WORKING_DIR/action|" action.yml
          diff -u action.yml.bak action.yml || true
          git status --porcelain
        shell: bash
        working-directory: "${{ env.IQTA_WORKING_DIR }}"

      - name: Install Qt with built action
        uses: "./.iqta-action"  # env vars do not work here, so repeat the path.
        with:
          # Add the options you need.

```

If you have questions, feel free to file an issue.
