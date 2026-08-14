import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverKiroProfileArns,
  discoverKiroProfileCandidates,
  extractProfileArns,
  maskEmail,
  parseCursorLocalRows,
  parseCursorClipboardValue,
} from '../tools/provider-setup/setup.mjs';

assert.equal(
  parseCursorClipboardValue('WorkosCursorSessionToken=opaque-token-value-123456; Path=/'),
  'opaque-token-value-123456',
);
assert.equal(parseCursorClipboardValue('not enough'), null);
const localCursor = parseCursorLocalRows([
  { key: 'cursorAuth/accessToken', value: 'cursor-access-token-fixture-1234' },
  { key: 'cursorAuth/refreshToken', value: 'cursor-refresh-token-fixture-1234' },
  { key: 'cursorAuth/cachedEmail', value: 'fixture@example.com' },
  { key: 'cursorAuth/stripeMembershipAuthId', value: 'cursor-auth-id-fixture-1234' },
]);
assert.equal(localCursor.email, 'fixture@example.com');
assert.equal(maskEmail(localCursor.email), 'f***@example.com');
assert.equal(localCursor.sessionToken, 'cursor-auth-id-fixture-1234::cursor-access-token-fixture-1234');
assert.deepEqual(
  extractProfileArns({ nested: { arn: 'arn:aws:codewhisperer:us-east-1:123:profile/demo' } }),
  ['arn:aws:codewhisperer:us-east-1:123:profile/demo'],
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ulanzi-provider-setup-'));
try {
  const key = crypto.randomBytes(32);
  fs.writeFileSync(path.join(root, 'secure-account-storage.key'), key.toString('base64'));

  const account = JSON.stringify({
    kiro_profile_raw: { arn: 'arn:aws:codewhisperer:us-east-1:123:profile/demo' },
    kiro_auth_token_raw: { clientIdHash: 'test-client-hash' },
  });
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(account, 'utf8'), cipher.final()]);
  const encrypted = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  fs.writeFileSync(path.join(root, 'kiro_demo.json'), JSON.stringify({
    version: 1,
    kind: 'kiro',
    algorithm: 'AES-256-GCM',
    nonce: nonce.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  }));

  const authFile = path.join(root, 'kiro-auth-token.json');
  fs.writeFileSync(authFile, JSON.stringify({ accessToken: 'test-only', clientIdHash: 'test-client-hash' }));
  const result = discoverKiroProfileArns({}, {
    authFile,
    legacyRootsOverride: [root],
  });
  assert.deepEqual(result.arns, ['arn:aws:codewhisperer:us-east-1:123:profile/demo']);
  assert.equal(result.source, 'legacy-backup-matched');

  const profileFile = path.join(root, 'profile.json');
  fs.writeFileSync(profileFile, JSON.stringify({
    arn: 'arn:aws:codewhisperer:eu-central-1:123:profile/local',
    email: 'local@example.com',
    loginProvider: 'BuilderId',
  }));
  const candidates = discoverKiroProfileCandidates({}, {
    authFile,
    profileFiles: [profileFile],
    legacyRootsOverride: [],
  });
  assert.equal(candidates.candidates.length, 1);
  assert.equal(candidates.candidates[0].region, 'eu-central-1');
  assert.equal(candidates.candidates[0].maskedEmail, 'l***@example.com');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('provider setup tests passed');
