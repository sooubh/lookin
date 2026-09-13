import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

test('Phase A1: Manifest V3 Configuration Integrity', () => {
  const manifestRaw = fs.readFileSync(path.resolve('extension/dist/manifest.json'), 'utf-8');
  const manifest = JSON.parse(manifestRaw);

  assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
  assert.ok(manifest.permissions.includes('sidePanel'), 'Must declare sidePanel permission');
  assert.ok(manifest.permissions.includes('activeTab'), 'Must declare activeTab permission');
  assert.ok(manifest.side_panel.default_path, 'Must specify side panel path');
  assert.strictEqual(manifest.background.type, 'module', 'Service worker must be ES module');
});

test('Phase A1: Build Artifacts Verification', () => {
  assert.ok(fs.existsSync('extension/dist/background.js'), 'background.js must exist');
  assert.ok(fs.existsSync('extension/dist/content.js'), 'content.js must exist');
  assert.ok(fs.existsSync('extension/dist/sidepanel/index.html'), 'sidepanel HTML must exist');
  assert.ok(fs.existsSync('extension/dist/sidepanel/app.js'), 'sidepanel app.js must exist');
});

test('Phase A1: Security Invariants Enforced in Bundles', () => {
  const backgroundBundle = fs.readFileSync('extension/dist/background.js', 'utf-8');
  const contentBundle = fs.readFileSync('extension/dist/content.js', 'utf-8');
  const sidepanelBundle = fs.readFileSync('extension/dist/sidepanel/app.js', 'utf-8');

  // Ensure no eval is used
  assert.ok(!backgroundBundle.includes('eval('), 'No eval allowed in background');
  assert.ok(!contentBundle.includes('eval('), 'No eval allowed in content');
  assert.ok(!sidepanelBundle.includes('eval('), 'No eval allowed in sidepanel');

  // Ensure no raw AI provider endpoints are hardcoded in the extension
  assert.ok(!backgroundBundle.includes('api.openai.com'), 'No direct OpenAI API in extension');
  assert.ok(!backgroundBundle.includes('api.anthropic.com'), 'No direct Anthropic API in extension');
  assert.ok(!sidepanelBundle.includes('api.openai.com'), 'No direct OpenAI API in sidepanel');
});
