#!/usr/bin/env node

/**
 * One-time local setup for the standalone Ulanzi Agent Usage plugin.
 *
 * This tool deliberately keeps secrets out of the plugin config and source
 * tree. Cursor's session cookie is copied from the clipboard into the
 * Windows user environment. Kiro's short-lived token remains in the AWS SSO
 * cache; only a static profile ARN is copied into config.json.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import readline from 'node:readline/promises';

const CURSOR_ENV = 'CURSOR_SESSION_TOKEN';
const KIRO_ARN_PREFIX = 'arn:aws:codewhisperer:';
const KIRO_AUTH_CONFIG_PATH = '%USERPROFILE%/.aws/sso/cache/kiro-auth-token.json';
const MAX_CLIPBOARD_BYTES = 256 * 1024;
const MAX_CURSOR_DB_BYTES = 64 * 1024 * 1024;
const CURSOR_LOCAL_KEYS = [
  'cursorAuth/accessToken',
  'cursorAuth/refreshToken',
  'cursorAuth/cachedEmail',
  'cursorAuth/authId',
  'cursorAuth/stripeMembershipAuthId',
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function expandPath(value) {
  if (typeof value !== 'string' || !value.trim()) return value;
  let result = value.trim();
  if (result === '~' || result.startsWith('~/') || result.startsWith(`~${path.sep}`)) {
    result = path.join(os.homedir(), result.slice(2));
  }
  result = result.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_, name) => (
    process.env[name] || `%${name}%`
  ));
  result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => (
    process.env[name] || `\${${name}}`
  ));
  return result;
}

export function defaultConfigPath() {
  if (process.env.ULANZI_AGENT_USAGE_CONFIG) {
    return expandPath(process.env.ULANZI_AGENT_USAGE_CONFIG);
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Ulanzi',
      'AgentUsage',
      'config.json',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Ulanzi', 'AgentUsage', 'config.json');
  }
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'ulanzi-agent-usage',
    'config.json',
  );
}

export function defaultCursorStateDbPath() {
  if (process.env.ULANZI_CURSOR_STATE_DB) {
    return expandPath(process.env.ULANZI_CURSOR_STATE_DB);
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Cursor', 'User', 'globalStorage', 'state.vscdb',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

function defaultKiroAuthFile() {
  return path.join(os.homedir(), '.aws', 'sso', 'cache', 'kiro-auth-token.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function readConfig(file) {
  if (!fs.existsSync(file)) return {};
  const value = readJson(file);
  if (!isObject(value)) throw new Error(`Invalid JSON config: ${file}`);
  return value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function parseCursorClipboardValue(raw) {
  const text = String(raw || '').trim();
  if (!text || Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_BYTES) return null;

  const namedCookie = text.match(/(?:^|[;\r\n])\s*WorkosCursorSessionToken\s*=\s*([^;\r\n]+)/i);
  const value = (namedCookie ? namedCookie[1] : text).trim();
  if (!value || value.length < 16 || /\s/.test(value)) return null;
  return value;
}

export function maskEmail(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) return email ? '已偵測帳號' : '未提供帳號名稱';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

function looksLikeSecret(value) {
  return typeof value === 'string' && value.trim().length >= 16 && !/\s/.test(value.trim());
}

export function parseCursorLocalRows(rows) {
  const values = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row?.key === 'string' && typeof row?.value === 'string') {
      values.set(row.key, row.value);
    }
  }
  const accessToken = values.get('cursorAuth/accessToken')?.trim() || '';
  if (!looksLikeSecret(accessToken)) return null;
  const authId = values.get('cursorAuth/authId')?.trim()
    || values.get('cursorAuth/stripeMembershipAuthId')?.trim()
    || null;
  return {
    accessToken,
    authId,
    sessionToken: authId ? `${authId}::${accessToken}` : accessToken,
    refreshToken: values.get('cursorAuth/refreshToken')?.trim() || null,
    email: values.get('cursorAuth/cachedEmail')?.trim() || null,
  };
}

const CURSOR_AUTH_QUERY = `SELECT key, value FROM ItemTable WHERE key IN (${CURSOR_LOCAL_KEYS.map((key) => `'${key}'`).join(', ')}) ORDER BY key;`;

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

async function queryCursorWithNodeSqlite(file) {
  let sqlite;
  try {
    sqlite = await import('node:sqlite');
  } catch {
    return null;
  }
  if (typeof sqlite.DatabaseSync !== 'function') return null;
  try {
    const database = new sqlite.DatabaseSync(file, { readOnly: true });
    const rows = database.prepare(CURSOR_AUTH_QUERY).all();
    database.close();
    return { rows, backend: 'node:sqlite' };
  } catch {
    return null;
  }
}

async function queryCursorWithSqlJs(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  if (!stat.isFile() || stat.size > MAX_CURSOR_DB_BYTES) return null;
  let sqlJs;
  try {
    sqlJs = (await import('sql.js')).default;
  } catch {
    return null;
  }
  if (typeof sqlJs !== 'function') return null;
  try {
    const require = createRequire(import.meta.url);
    const packageRoot = path.dirname(path.dirname(require.resolve('sql.js')));
    const SQL = await sqlJs({
      locateFile: (fileName) => path.join(packageRoot, 'dist', fileName),
    });
    const database = new SQL.Database(fs.readFileSync(file));
    const result = database.exec(CURSOR_AUTH_QUERY);
    const rows = result[0]
      ? result[0].values.map(([key, value]) => ({ key, value: String(value) }))
      : [];
    database.close();
    return { rows, backend: 'sql.js' };
  } catch {
    return null;
  }
}

function queryCursorWithCli(file) {
  const commands = unique([
    process.env.ULANZI_SQLITE_BIN,
    process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3',
    'sqlite3',
  ]);
  for (const command of commands) {
    const output = tryRun(command, ['-readonly', '-json', file, CURSOR_AUTH_QUERY]);
    if (output === null) continue;
    try {
      return { rows: output.trim() ? JSON.parse(output) : [], backend: 'sqlite3-cli' };
    } catch {
      // Continue to the next local reader without exposing database output.
    }
  }
  return null;
}

function queryCursorWithPython(file) {
  const script = [
    'import json, sqlite3, sys',
    'con = sqlite3.connect(sys.argv[1])',
    'try:',
    `    rows = con.execute(${JSON.stringify(CURSOR_AUTH_QUERY)}).fetchall()`,
    '    print(json.dumps([{"key": row[0], "value": row[1]} for row in rows]))',
    'finally:',
    '    con.close()',
  ].join('\n');
  for (const command of unique([process.platform === 'win32' ? 'python.exe' : 'python3', 'python3', 'python'])) {
    const output = tryRun(command, ['-c', script, file]);
    if (output === null) continue;
    try {
      return { rows: output.trim() ? JSON.parse(output) : [], backend: 'python-sqlite3' };
    } catch {
      // Continue without printing Python or database output.
    }
  }
  return null;
}

async function queryCursorDatabase(file) {
  return await queryCursorWithNodeSqlite(file)
    || await queryCursorWithSqlJs(file)
    || queryCursorWithCli(file)
    || queryCursorWithPython(file);
}

export async function discoverCursorLocalAccounts({ stateDb } = {}) {
  const file = expandPath(stateDb || defaultCursorStateDbPath());
  if (!file || !fs.existsSync(file)) {
    return { accounts: [], source: 'cursor-state-not-found', reader: null };
  }
  const result = await queryCursorDatabase(file);
  if (!result) {
    return { accounts: [], source: 'cursor-state-reader-unavailable', reader: null };
  }
  const account = parseCursorLocalRows(result.rows);
  return {
    accounts: account ? [{
      id: 'cursor-local-current',
      email: account.email,
      maskedEmail: maskEmail(account.email),
      ...account,
    }] : [],
    source: account ? 'cursor-local-state' : 'cursor-state-no-login',
    reader: result.backend,
  };
}

function readClipboard() {
  if (process.platform !== 'win32') {
    throw new Error('Clipboard import is currently supported on Windows only');
  }
  try {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'],
      { encoding: 'utf8', maxBuffer: MAX_CLIPBOARD_BYTES, windowsHide: true },
    );
  } catch {
    throw new Error('Unable to read the Windows clipboard');
  }
}

export function setWindowsUserEnvironmentVariable(name, value) {
  if (process.platform !== 'win32') {
    throw new Error('Persistent Cursor setup is currently supported on Windows only');
  }

  // Send the secret through stdin so it never appears in a process argument
  // or in a diagnostic message.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$value = [Console]::In.ReadToEnd().Trim()',
    "if ([string]::IsNullOrWhiteSpace($value)) { throw 'empty value' }",
    `[Environment]::SetEnvironmentVariable('${name}', $value, 'User')`,
  ].join('; ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      input: `${value}\n`,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4096,
    },
  );
  if (result.status !== 0) throw new Error('Unable to save the Cursor session token to user environment');
  process.env[name] = value;
}

async function askForConfirmation() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('Clipboard contains a candidate Cursor session value. Save it locally? [y/N] ');
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

function extractStrings(value, visit = new Set()) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || visit.has(value)) return [];
  visit.add(value);
  const values = [];
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    values.push(...extractStrings(child, visit));
  }
  return values;
}

export function extractProfileArns(value) {
  return unique(extractStrings(value).filter((item) => (
    item.startsWith(KIRO_ARN_PREFIX) && item.includes(':profile/')
  )));
}

function findStringByKey(value, wantedKeys, visit = new Set()) {
  if (!value || typeof value !== 'object' || visit.has(value)) return null;
  visit.add(value);
  const keys = new Set(wantedKeys.map((key) => key.toLowerCase()));
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key.toLowerCase()) && typeof child === 'string' && child.trim()) return child.trim();
    const nested = findStringByKey(child, wantedKeys, visit);
    if (nested) return nested;
  }
  return null;
}

function readSecureStorageKey(root) {
  const candidates = [
    path.join(root, 'secure-account-storage.key'),
    path.join(root, 'sources', 'user-antigravity_cockpit', 'secure-account-storage.key'),
  ];
  for (const file of candidates) {
    try {
      const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
      if (key.length === 32) return key;
    } catch {
      // Try the next candidate without revealing key or file contents.
    }
  }
  return null;
}

function decryptEnvelope(envelope, key) {
  if (!isObject(envelope) || !envelope.ciphertext) return envelope;
  if (envelope.algorithm !== 'AES-256-GCM' || envelope.version !== 1 || !key) return null;
  try {
    const nonce = Buffer.from(envelope.nonce, 'base64');
    const encrypted = Buffer.from(envelope.ciphertext, 'base64');
    if (nonce.length !== 12 || encrypted.length <= 16) return null;
    const tag = encrypted.subarray(-16);
    const ciphertext = encrypted.subarray(0, -16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
}

function kiroRecordFiles(root) {
  const directories = [root, path.join(root, 'kiro_accounts')];
  const files = [];
  for (const directory of directories) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !/^kiro_[^/\\]+\.json$/i.test(entry.name) || entry.name.endsWith('.bak')) continue;
      files.push(path.join(directory, entry.name));
    }
  }
  return unique(files);
}

function discoverKiroRecords(root) {
  const key = readSecureStorageKey(root);
  const records = [];
  for (const file of kiroRecordFiles(root)) {
    const envelope = readJson(file);
    if (!envelope) continue;
    const account = decryptEnvelope(envelope, key);
    if (!account) continue;
    for (const profileArn of extractProfileArns(account)) {
      records.push({
        profileArn,
        clientIdHash: findStringByKey(account, ['clientIdHash', 'client_id_hash']),
      });
    }
  }
  return records;
}

function latestLegacyBackupSource() {
  const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Cockpit Tools Backups');
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  const candidates = entries
    .filter((entry) => entry.isDirectory() && /^full-/i.test(entry.name))
    .map((entry) => {
      const backup = path.join(root, entry.name);
      try { return { backup, mtime: fs.statSync(backup).mtimeMs }; } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  for (const candidate of candidates) {
    const source = path.join(candidate.backup, 'sources', 'user-antigravity_cockpit');
    if (fs.existsSync(source)) return source;
  }
  return null;
}

function legacyRoots(explicitRoot) {
  const roots = [];
  if (explicitRoot) roots.push(expandPath(explicitRoot));
  const current = path.join(os.homedir(), '.antigravity_cockpit');
  if (fs.existsSync(current)) roots.push(current);
  const backup = latestLegacyBackupSource();
  if (backup) roots.push(backup);
  return unique(roots.filter((root) => fs.existsSync(root)));
}

function configuredKiroArns(config) {
  const kiro = config?.providers?.kiro;
  const fromProfiles = Array.isArray(kiro?.profiles)
    ? kiro.profiles.map((profile) => profile?.profileArn).filter((arn) => typeof arn === 'string')
    : [];
  const fromSingle = typeof kiro?.profileArn === 'string' ? [kiro.profileArn] : [];
  const fromEnv = process.env.KIRO_PROFILE_ARN ? [process.env.KIRO_PROFILE_ARN] : [];
  return unique([...fromProfiles, ...fromSingle, ...fromEnv].filter((arn) => (
    arn.startsWith(KIRO_ARN_PREFIX) && arn.includes(':profile/')
  )));
}

function defaultKiroProfileFiles() {
  const appData = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return unique([
    process.env.KIRO_PROFILE_FILE,
    path.join(appData, 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent', 'profile.json'),
    path.join(appData, 'Kiro', 'User', 'globalStorage', 'kiro.kiroAgent', 'profile.json'),
    path.join(configHome, 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent', 'profile.json'),
  ].map((file) => expandPath(file)).filter((file) => file && fs.existsSync(file)));
}

function arnRegion(profileArn) {
  const parts = String(profileArn || '').split(':');
  return parts[3] || null;
}

function stableProfileId(profileArn) {
  return `kiro-local-${crypto.createHash('sha256').update(profileArn).digest('hex').slice(0, 12)}`;
}

function discoverKiroLocalRecords(profileFiles = defaultKiroProfileFiles()) {
  const records = [];
  for (const file of profileFiles) {
    const profile = readJson(file);
    if (!profile) continue;
    for (const profileArn of extractProfileArns(profile)) {
      records.push({
        profileArn,
        region: arnRegion(profileArn),
        email: findStringByKey(profile, ['email', 'userEmail']),
        loginProvider: findStringByKey(profile, ['loginProvider', 'provider']),
        source: 'kiro-local-profile',
      });
    }
  }
  return records;
}

function readKiroAuth(authFile) {
  const file = expandPath(authFile || defaultKiroAuthFile());
  const auth = readJson(file);
  return {
    present: fs.existsSync(file),
    hasAccessToken: Boolean(auth?.accessToken),
    clientIdHash: findStringByKey(auth, ['clientIdHash', 'client_id_hash']),
  };
}

function configuredKiroAuthFile(config, explicit) {
  if (explicit) return expandPath(explicit);
  const kiro = config?.providers?.kiro;
  const firstProfile = Array.isArray(kiro?.profiles) ? kiro.profiles.find(Boolean) : null;
  return expandPath(firstProfile?.authFile || kiro?.authFile || defaultKiroAuthFile());
}

export function discoverKiroProfileCandidates(config, {
  backupRoot,
  authFile,
  legacyRootsOverride,
  profileFiles,
} = {}) {
  const configured = configuredKiroArns(config);
  const authPath = configuredKiroAuthFile(config, authFile);
  const auth = readKiroAuth(authPath);
  const records = [];
  if (configured.length) {
    for (const profileArn of configured) {
      records.push({ profileArn, region: arnRegion(profileArn), source: 'existing-config' });
    }
  } else {
    const localRecords = discoverKiroLocalRecords(profileFiles);
    records.push(...localRecords);
    if (!localRecords.length) {
      const roots = Array.isArray(legacyRootsOverride) ? legacyRootsOverride : legacyRoots(backupRoot);
      records.push(...roots.flatMap((root) => discoverKiroRecords(root).map((record) => ({
        ...record,
        region: arnRegion(record.profileArn),
        source: 'legacy-backup',
      }))));
    }
  }

  const uniqueRecords = new Map();
  for (const record of records) {
    if (!record?.profileArn || uniqueRecords.has(record.profileArn)) continue;
    const matched = Boolean(auth.clientIdHash && record.clientIdHash === auth.clientIdHash);
    uniqueRecords.set(record.profileArn, {
      id: stableProfileId(record.profileArn),
      profileArn: record.profileArn,
      region: record.region || arnRegion(record.profileArn),
      email: record.email || null,
      maskedEmail: maskEmail(record.email),
      loginProvider: record.loginProvider || null,
      source: record.source,
      matchedAuth: matched,
      authFile: KIRO_AUTH_CONFIG_PATH,
    });
  }
  return {
    candidates: [...uniqueRecords.values()],
    auth,
    authFile: authPath,
  };
}

export function discoverKiroProfileArns(config, { backupRoot, authFile, legacyRootsOverride, profileFiles } = {}) {
  const configured = configuredKiroArns(config);
  if (configured.length) return { arns: configured, source: 'existing-config' };

  const localRecords = Array.isArray(legacyRootsOverride) && !profileFiles
    ? []
    : discoverKiroLocalRecords(profileFiles);
  const localAuth = readKiroAuth(configuredKiroAuthFile(config, authFile));
  const localMatched = localAuth.clientIdHash
    ? localRecords.filter((record) => record.clientIdHash === localAuth.clientIdHash)
    : [];
  const localMatchedArns = unique(localMatched.map((record) => record.profileArn));
  if (localMatchedArns.length === 1) return { arns: localMatchedArns, source: 'local-profile-matched' };
  const localArns = unique(localRecords.map((record) => record.profileArn));
  if (localArns.length === 1) return { arns: localArns, source: 'local-profile' };

  const roots = Array.isArray(legacyRootsOverride) ? legacyRootsOverride : legacyRoots(backupRoot);
  const records = roots.flatMap((root) => discoverKiroRecords(root));
  const auth = readKiroAuth(configuredKiroAuthFile(config, authFile));
  const matched = auth.clientIdHash
    ? records.filter((record) => record.clientIdHash === auth.clientIdHash)
    : [];
  const matchedArns = unique(matched.map((record) => record.profileArn));
  if (matchedArns.length === 1) return { arns: matchedArns, source: 'legacy-backup-matched' };

  const allArns = unique(records.map((record) => record.profileArn));
  if (allArns.length === 1) return { arns: allArns, source: 'legacy-backup-single' };
  return { arns: [], source: allArns.length > 1 ? 'legacy-backup-ambiguous' : 'not-found', candidateCount: allArns.length };
}

function configProfiles(arns, authFile = KIRO_AUTH_CONFIG_PATH) {
  return arns.map((profileArn, index) => ({
    id: index === 0 ? 'default' : `kiro-${index + 1}`,
    label: arns.length === 1 ? 'Kiro' : `Kiro ${index + 1}`,
    profileArn,
    authFile,
  }));
}

export function writeConfigAtomically(file, value, dryRun) {
  if (dryRun) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const backup = `${file}.bak-${timestamp}`;
  if (fs.existsSync(file)) fs.copyFileSync(file, backup);
  const temp = `${file}.ulanzi-setup-${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
  return backup;
}

export function mergeKiroConfig(config, arns) {
  const next = cloneJson(config);
  if (!isObject(next.providers)) next.providers = {};
  const authFile = configuredKiroAuthFile(config);
  next.providers.kiro = {
    ...(isObject(next.providers.kiro) ? next.providers.kiro : {}),
    profiles: configProfiles(arns, authFile === defaultKiroAuthFile() ? KIRO_AUTH_CONFIG_PATH : authFile),
  };
  return next;
}

async function setupCursor({ useClipboard, useLocal, stateDb, dryRun, yes }) {
  if (process.env[CURSOR_ENV]?.trim()) {
    return { status: 'already-present' };
  }
  if (useLocal) {
    const discovery = await discoverCursorLocalAccounts({ stateDb });
    const account = discovery.accounts[0];
    if (!account) return { status: 'missing', reason: discovery.source };
    if (!dryRun) setWindowsUserEnvironmentVariable(CURSOR_ENV, account.sessionToken);
    return { status: dryRun ? 'would-write' : 'written', source: discovery.source, reader: discovery.reader };
  }
  if (!useClipboard) return { status: 'missing', reason: 'import-source-not-requested' };
  const token = parseCursorClipboardValue(readClipboard());
  if (!token) return { status: 'missing', reason: 'clipboard-has-no-cookie-value' };
  if (!yes && !(await askForConfirmation())) return { status: 'cancelled' };
  if (!dryRun) setWindowsUserEnvironmentVariable(CURSOR_ENV, token);
  return { status: dryRun ? 'would-write' : 'written' };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    console.log('Usage: node setup.mjs [--all] [--gui] [--cursor-local|--cursor-clipboard] [--dry-run] [--yes] [--backup-root <path>]');
    console.log('  --all               configure Cursor and Kiro (default)');
    console.log('  --gui               open the local click-to-import account wizard');
    console.log('  --cursor-local      import the current Cursor account from state.vscdb');
    console.log('  --cursor-clipboard  import WorkosCursorSessionToken from Windows clipboard');
    console.log('  --cursor-state-db PATH  use a specific Cursor state.vscdb');
    console.log('  --dry-run           inspect and report without changing environment or config');
    console.log('  --yes               skip the local Cursor save confirmation');
    return;
  }

  const dryRun = args.has('--dry-run');
  const useClipboard = args.has('--cursor-clipboard');
  const useLocal = args.has('--cursor-local');
  const configIndex = process.argv.indexOf('--config');
  const backupIndex = process.argv.indexOf('--backup-root');
  const stateDbIndex = process.argv.indexOf('--cursor-state-db');
  const configFile = configIndex >= 0 ? expandPath(process.argv[configIndex + 1]) : defaultConfigPath();
  const backupRoot = backupIndex >= 0 ? process.argv[backupIndex + 1] : undefined;
  const stateDb = stateDbIndex >= 0 ? expandPath(process.argv[stateDbIndex + 1]) : undefined;

  if (args.has('--gui')) {
    const { startWizard } = await import('./wizard.mjs');
    await startWizard({
      configFile,
      backupRoot,
      cursorStateDb: stateDb,
      dryRun,
      openBrowser: !args.has('--no-open'),
    });
    return;
  }

  const configureCursor = !args.has('--no-cursor');
  const configureKiro = !args.has('--no-kiro');

  console.log(`Config: ${configFile}`);
  if (dryRun) console.log('Mode: dry-run (no local changes)');
  if (useLocal) console.log('Cursor source: local Cursor state.vscdb');

  const config = readConfig(configFile);
  if (configureCursor) {
    const cursor = await setupCursor({
      useClipboard,
      useLocal,
      stateDb,
      dryRun,
      yes: args.has('--yes'),
    });
    console.log(`Cursor: ${cursor.status}${cursor.reason ? ` (${cursor.reason})` : ''}`);
  }

  if (configureKiro) {
    const auth = readKiroAuth(configuredKiroAuthFile(config));
    const discovery = discoverKiroProfileArns(config, { backupRoot });
    console.log(`Kiro auth cache: ${auth.present ? 'present' : 'missing'}; access token: ${auth.hasAccessToken ? 'present' : 'missing'}`);
    if (!discovery.arns.length) {
      const suffix = discovery.source === 'legacy-backup-ambiguous'
        ? ` (${discovery.candidateCount} candidate ARNs; no write to avoid account mismatch)`
        : ' (profile ARN not found)';
      console.log(`Kiro: not configured${suffix}`);
    } else if (discovery.source === 'existing-config') {
      console.log(`Kiro: already configured (${discovery.arns.length} profile${discovery.arns.length === 1 ? '' : 's'})`);
    } else {
      const next = mergeKiroConfig(config, discovery.arns);
      const backup = writeConfigAtomically(configFile, next, dryRun);
      console.log(`Kiro: ${dryRun ? 'would configure' : 'configured'} (${discovery.arns.length} profile${discovery.arns.length === 1 ? '' : 's'}, source ${discovery.source})`);
      if (backup) console.log(`Config backup: ${backup}`);
    }
  }

  console.log('Done. Fully restart Ulanzi Studio so it inherits the updated local environment/config.');
}

const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisFile = path.resolve(fileURLToPath(import.meta.url));
if (entryFile === thisFile) {
  main().catch((error) => {
    console.error(`Setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
