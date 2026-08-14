/**
 * Local, user-owned configuration for provider adapters.
 *
 * The file lives outside the plugin checkout by default. It may contain
 * provider settings, but the plugin never writes credentials or prints the
 * parsed values to its log.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_NAME = 'Ulanzi/AgentUsage';

function platformConfigDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'ulanzi-agent-usage');
}

export function expandPath(value) {
  if (typeof value !== 'string' || !value.trim()) return value;
  let result = value.trim();
  if (result === '~' || result.startsWith(`~${path.sep}`) || result.startsWith('~/')) {
    result = path.join(os.homedir(), result.slice(2));
  }
  result = result.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_, name) => process.env[name] || `%${name}%`);
  result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] || `\${${name}}`);
  return result;
}

export function getConfigPath() {
  return expandPath(process.env.ULANZI_AGENT_USAGE_CONFIG) || path.join(platformConfigDir(), 'config.json');
}

export function readJsonFile(file) {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(expandPath(file), 'utf8'));
  } catch {
    return null;
  }
}

export function readLocalConfig() {
  return readJsonFile(getConfigPath()) || {};
}

export function providerConfig(provider, settings = {}) {
  const fileConfig = readLocalConfig();
  const configured = fileConfig?.providers?.[provider];
  const inline = settings?.providerConfig;
  if (configured && typeof configured === 'object' && inline && typeof inline === 'object') {
    return { ...configured, ...inline };
  }
  return inline && typeof inline === 'object' ? inline : configured || {};
}

export function pathFromConfig(value, fallback) {
  return expandPath(value || fallback);
}
