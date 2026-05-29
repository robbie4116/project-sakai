import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('macOS release workflow builds unsigned Intel and Apple Silicon tester DMGs', () => {
  assert.match(workflow, /build-macos:/);
  assert.match(workflow, /macos-15-intel/);
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /x86_64-apple-darwin/);
  assert.match(workflow, /aarch64-apple-darwin/);
  assert.match(workflow, /artifact_name:\s*taniman-macos-arm64-unsigned/);
  assert.match(workflow, /artifact_name:\s*taniman-macos-x64-unsigned/);
  assert.match(workflow, /find target -type d -path '\*\/release\/bundle\/macos\/Taniman\.app'/);
  assert.match(workflow, /plutil -extract CFBundleExecutable raw/);
  assert.match(workflow, /lipo -archs/);
  assert.doesNotMatch(workflow, /APPLE_CERTIFICATE/);
  assert.doesNotMatch(workflow, /APPLE_ID/);
  assert.doesNotMatch(workflow, /codesign --verify/);
  assert.doesNotMatch(workflow, /spctl --assess/);
  assert.doesNotMatch(workflow, /name:\s*taniman-macos\s*$/m);
});

test('README tells macOS testers how to open unsigned builds', () => {
  assert.match(readme, /unsigned macOS builds/i);
  assert.match(readme, /taniman-macos-arm64-unsigned/);
  assert.match(readme, /taniman-macos-x64-unsigned/);
  assert.match(readme, /xattr -dr com\.apple\.quarantine/);
});
