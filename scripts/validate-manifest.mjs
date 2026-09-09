import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const errors = [];

const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const segments = (value) => typeof value === 'string' ? value.split('.').length : 0;
const requirePath = (relativePath, label) => {
  if (!relativePath || !exists(relativePath)) {
    errors.push(`${label} does not exist: ${relativePath || '(empty)'}`);
  }
};

if (manifest.UUID !== 'com.ulanzi.ulanzistudio.agentusage') {
  errors.push(`unexpected main UUID: ${manifest.UUID}`);
}
if (segments(manifest.UUID) !== 4) {
  errors.push(`main UUID must have exactly 4 segments: ${manifest.UUID}`);
}
if (manifest.Type !== 'JavaScript') errors.push('Type must be JavaScript');
if (manifest.CodePath !== 'plugin/app.js') errors.push('CodePath must be plugin/app.js');
if (manifest.PrivateAPI !== false) errors.push('PrivateAPI must be false');

requirePath(manifest.Icon, 'plugin Icon');
requirePath(manifest.CategoryIcon, 'category Icon');
requirePath(manifest.CodePath, 'CodePath');

if (!Array.isArray(manifest.Actions) || manifest.Actions.length !== 19) {
  errors.push(`expected 19 actions, found ${manifest.Actions?.length ?? 0}`);
}

const actionIds = new Set();
for (const [index, action] of (manifest.Actions || []).entries()) {
  if (!action.UUID?.startsWith(`${manifest.UUID}.`) || segments(action.UUID) < 5) {
    errors.push(`action ${index + 1} has an invalid UUID: ${action.UUID}`);
  }
  if (actionIds.has(action.UUID)) errors.push(`duplicate action UUID: ${action.UUID}`);
  actionIds.add(action.UUID);

  requirePath(action.Icon, `action ${action.UUID} Icon`);
  requirePath(action.PropertyInspectorPath, `action ${action.UUID} property inspector`);
  if (!Array.isArray(action.Controllers) || !action.Controllers.includes('Keypad')) {
    errors.push(`action ${action.UUID} must support Keypad`);
  }
  if (!Array.isArray(action.Devices)) errors.push(`action ${action.UUID} must declare Devices`);
  if (!Array.isArray(action.States) || action.States.length === 0) {
    errors.push(`action ${action.UUID} must declare at least one state`);
  }
  for (const state of action.States || []) {
    if (!state.Name || !state.Image) errors.push(`action ${action.UUID} has an invalid state`);
    requirePath(state.Image, `action ${action.UUID} state image`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Manifest OK: ${manifest.UUID}; ${manifest.Actions.length} actions; all paths and state definitions are valid.`);
