/**
 * Analyst invitation (RF9).
 *
 * An invite carries only public information: the analyst's age recipient, a
 * pseudonymous case reference, the collection profile and minimal operating
 * hints. It travels in the URL fragment (`#invite=…`) so it is not part of
 * the HTTP request line, but it is NOT secret: browser history, sync and
 * screenshots can expose it. The main risk is correlation with the case,
 * hence the case reference must not contain names, case details or device
 * serial numbers.
 *
 * The invite is not authenticated. Its recipient becomes trusted only after
 * the acquirer has compared the key identifier with the analyst over an
 * independent, already-authenticated channel (see recipient.ts).
 */

import { ACQUISITION_TYPES, type AcquisitionType } from '../forensics/acquisition';
import { validateRecipient, RecipientError, type ValidatedRecipient } from './recipient';

export const INVITE_VERSION = 1 as const;
export const INVITE_FRAGMENT_KEY = 'invite';
const MAX_ENCODED_LENGTH = 8192;
const CASE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const ALLOWED_KEYS = new Set(['v', 'kind', 'recipient', 'caseRef', 'profile', 'analystLabel', 'expiresAt']);

export interface InvitePayload {
  v: typeof INVITE_VERSION;
  kind: 'wafb-invite';
  /** age X25519 recipient (public key). */
  recipient: string;
  /** Pseudonymous case reference. */
  caseRef: string;
  /** Acquisition modules the analyst asks for. Never widened by the client. */
  profile: AcquisitionType[];
  /** Descriptive label only — not an identity certification. */
  analystLabel?: string;
  /** Application start rule, NOT a cryptographic expiry of the data. */
  expiresAt?: string;
}

export interface ParsedInvite {
  payload: InvitePayload;
  recipient: ValidatedRecipient;
}

export type InviteErrorCode =
  | 'missing'
  | 'too-large'
  | 'not-base64url'
  | 'not-json'
  | 'unknown-field'
  | 'unsupported-version'
  | 'bad-case-ref'
  | 'bad-profile'
  | 'bad-label'
  | 'bad-expiry'
  | 'expired'
  | 'bad-recipient';

export class InviteError extends Error {
  readonly code: InviteErrorCode;
  /** Set when code === 'bad-recipient'. */
  readonly recipientCode?: RecipientError['code'];
  constructor(code: InviteErrorCode, message: string, recipientCode?: RecipientError['code']) {
    super(message);
    this.name = 'InviteError';
    this.code = code;
    this.recipientCode = recipientCode;
    Object.setPrototypeOf(this, InviteError.prototype);
  }
}

// ── encoding ────────────────────────────────────────────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new InviteError('not-base64url', 'The invite is not correctly encoded.');
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : s.length % 4 === 0 ? '' : null;
  if (pad === null) throw new InviteError('not-base64url', 'The invite is not correctly encoded.');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── creation (analyst side) ─────────────────────────────────────────────────

/** Generates a random pseudonymous case reference, e.g. `C-7Q2XK9MD4H`. */
export function generateCaseRef(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // no 0/O, 1/I/L, U
  const rnd = crypto.getRandomValues(new Uint8Array(10));
  let s = 'C-';
  for (const b of rnd) s += alphabet[b % alphabet.length];
  return s;
}

export async function createInvite(input: {
  recipient: string;
  caseRef: string;
  profile: AcquisitionType[];
  analystLabel?: string;
  expiresAt?: string;
}): Promise<{ payload: InvitePayload; encoded: string; fragment: string; keyId: string }> {
  const recipient = await validateRecipient(input.recipient);
  const payload: InvitePayload = {
    v: INVITE_VERSION,
    kind: 'wafb-invite',
    recipient: recipient.canonical,
    caseRef: input.caseRef,
    profile: [...new Set(input.profile)],
    ...(input.analystLabel ? { analystLabel: input.analystLabel } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
  validatePayloadFields(payload, { now: null });
  const encoded = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return { payload, encoded, fragment: `#${INVITE_FRAGMENT_KEY}=${encoded}`, keyId: recipient.keyId };
}

export function inviteUrl(baseUrl: string, fragment: string): string {
  const u = new URL(baseUrl);
  u.hash = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  return u.toString();
}

// ── parsing (acquirer side) ─────────────────────────────────────────────────

/** Extracts the encoded invite from a location hash such as `#invite=…`. */
export function inviteFromHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of h.split('&')) {
    const [k, v] = part.split('=', 2);
    if (k === INVITE_FRAGMENT_KEY && v) return v;
  }
  return null;
}

export async function parseInvite(encoded: string | null, opts: { now?: Date } = {}): Promise<ParsedInvite> {
  if (!encoded) throw new InviteError('missing', 'No invite was found.');
  if (encoded.length > MAX_ENCODED_LENGTH) throw new InviteError('too-large', 'The invite is too large.');

  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b64urlDecode(encoded)));
  } catch (err) {
    if (err instanceof InviteError) throw err;
    throw new InviteError('not-json', 'The invite content is not readable.');
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new InviteError('not-json', 'The invite content is not readable.');
  }
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(k)) throw new InviteError('unknown-field', 'The invite contains unexpected fields.');
  }
  const p = obj as Record<string, unknown>;
  if (p.v !== INVITE_VERSION || p.kind !== 'wafb-invite') {
    throw new InviteError('unsupported-version', 'This invite version is not supported by this WAFB build.');
  }
  if (typeof p.recipient !== 'string') throw new InviteError('bad-recipient', 'The invite has no public key.', 'empty');

  const payload = p as unknown as InvitePayload;
  validatePayloadFields(payload, { now: opts.now ?? new Date() });

  let recipient: ValidatedRecipient;
  try {
    recipient = await validateRecipient(payload.recipient);
  } catch (err) {
    if (err instanceof RecipientError) {
      throw new InviteError('bad-recipient', err.message, err.code);
    }
    throw err;
  }
  return {
    payload: Object.freeze({ ...payload, recipient: recipient.canonical, profile: [...payload.profile] }),
    recipient,
  };
}

function validatePayloadFields(p: InvitePayload, { now }: { now: Date | null }): void {
  if (typeof p.caseRef !== 'string' || !CASE_REF_RE.test(p.caseRef)) {
    throw new InviteError(
      'bad-case-ref',
      'The case reference must be a pseudonym of 3–64 letters, digits, ".", "_" or "-".'
    );
  }
  if (!Array.isArray(p.profile) || p.profile.length === 0 || p.profile.length > 64) {
    throw new InviteError('bad-profile', 'The invite does not list a valid collection profile.');
  }
  const seen = new Set<string>();
  for (const t of p.profile) {
    if (typeof t !== 'string' || !(t in ACQUISITION_TYPES) || seen.has(t)) {
      throw new InviteError('bad-profile', 'The invite lists an unknown or repeated acquisition module.');
    }
    seen.add(t);
  }
  if (p.analystLabel !== undefined) {
    if (
      typeof p.analystLabel !== 'string' ||
      p.analystLabel.length === 0 ||
      p.analystLabel.length > 80 ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/.test(p.analystLabel)
    ) {
      throw new InviteError('bad-label', 'The analyst label is not valid.');
    }
  }
  if (p.expiresAt !== undefined) {
    const t = typeof p.expiresAt === 'string' ? Date.parse(p.expiresAt) : NaN;
    if (Number.isNaN(t)) throw new InviteError('bad-expiry', 'The invite expiry date is not valid.');
    if (now && t < now.getTime()) {
      throw new InviteError('expired', 'This invite has expired. Ask the analyst for a new one.');
    }
  }
}
