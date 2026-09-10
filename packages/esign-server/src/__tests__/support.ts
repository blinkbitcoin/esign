// Test support: the loggers tests inject (tests are silent - jest.setup.ts
// fails a test that reaches the console), a throwaway RSA key, a config
// with it, and fetch fakes.

import {
  createPublicKey,
  createVerify,
  generateKeyPairSync,
} from 'node:crypto';
import type { Logger } from '../log';
import type { DocuSignConfig } from '../providers/docusign/config';
import { DOCUSIGN_DEMO_URLS } from '../providers/docusign/config';
import type { FetchLike } from '../types';

// A logger that drops everything: for tests that do not care what is logged
export const silentLogger: Logger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

// A logger that records everything: for tests that assert on the log lines
export const spyLogger = () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

export const { privateKey: testPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

export const testConfig = (
  overrides: Partial<DocuSignConfig> = {},
): DocuSignConfig => ({
  ...DOCUSIGN_DEMO_URLS,
  accountId: 'acct-1',
  integrationKey: 'ik-1',
  privateKey: testPrivateKey,
  userId: 'user-1',
  templateId: 'tpl-1',
  webFormId: 'form-1',
  returnUrl: 'https://api.example.com/signing/return',
  ...overrides,
});

// Verify an RS256 JWT against the test key; returns the decoded payload
export const verifyJwt = (jwt: string): Record<string, unknown> => {
  const [header, payload, signature] = jwt.split('.');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  const publicKey = createPublicKey(testPrivateKey);
  if (!verifier.verify(publicKey, Buffer.from(signature, 'base64url'))) {
    throw new Error('bad signature');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
};

type Reply =
  | { ok: true; json: unknown }
  | { ok: false; status: number; text: string };

export const ok = (json: unknown): Reply => ({ ok: true, json });
export const fail = (status: number, text = ''): Reply => ({
  ok: false,
  status,
  text,
});
export const token = (access_token = 'tok', expires_in = 3600): Reply =>
  ok({ access_token, expires_in });

// A fetch that answers from a queue of replies and records every call
export const fakeFetch = (replies: Reply[]) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (!reply) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    if (reply.ok) {
      return { ok: true, json: async () => reply.json } as unknown as Response;
    }
    return {
      ok: false,
      status: reply.status,
      text: async () => reply.text,
    } as unknown as Response;
  };
  return {
    fetchImpl,
    calls,
    body: (i: number) => JSON.parse(String(calls[i].init?.body)),
  };
};
