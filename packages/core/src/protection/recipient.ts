/**
 * Recipient handling for protected acquisitions (RF1, RF2).
 *
 * WAFB accepts exactly one kind of recipient: an age X25519 public key
 * (`age1…`, Bech32, 32-byte key). Validation has two layers:
 *
 *   1. local checks that never echo the input (length, charset, known
 *      non-recipient shapes such as an age identity or an SSH key);
 *   2. acceptance by the age library itself (Typage), including a trial
 *      encryption, so the key is known to be usable for encryption.
 *
 * Format validation says the key *can* be used; it does not say whose key it
 * is. That second question is answered by comparing the key identifier
 * (see {@link computeKeyId}) over an independent, authenticated channel.
 *
 * Error messages are stable codes plus fixed text: the offending value is
 * never reproduced, logged or included in an error, because a pasted private
 * identity must not end up in logs or bug reports.
 */

import { Encrypter } from 'age-encryption';

export const RECIPIENT_TYPE = 'age-x25519' as const;
export const KEY_ID_DOMAIN = 'wafb-recipient-v1:' as const;

/** Length of a Bech32 age X25519 recipient: "age" + "1" + 52 data + 6 checksum. */
const X25519_RECIPIENT_LENGTH = 62;
const BECH32_DATA_CHARS = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
/** Upper bound on accepted input before any parsing, to avoid pathological pastes. */
const MAX_INPUT_LENGTH = 512;

export type RecipientErrorCode =
  | 'empty'
  | 'too-long'
  | 'private-key'
  | 'ssh-key'
  | 'unsupported-age-type'
  | 'mixed-case'
  | 'not-age-recipient'
  | 'malformed'
  | 'rejected-by-library';

const RECIPIENT_ERROR_TEXT: Record<RecipientErrorCode, string> = {
  empty: 'No recipient was provided.',
  'too-long': 'The text is too long to be an age public key.',
  'private-key':
    'This looks like an age PRIVATE key (identity). Do not share it. ' +
    'WAFB needs the analyst\'s PUBLIC key, which starts with "age1".',
  'ssh-key': 'SSH keys are not supported. An age X25519 public key starting with "age1" is required.',
  'unsupported-age-type':
    'This age recipient type is not supported by this WAFB profile. ' +
    'Only X25519 recipients ("age1…", 62 characters) are accepted.',
  'mixed-case': 'The key mixes upper- and lower-case letters, so it is not a valid age key. Copy it again.',
  'not-age-recipient': 'This is not an age public key. It should start with "age1".',
  malformed: 'The key is not a well-formed age X25519 public key (wrong length or characters). Copy it again.',
  'rejected-by-library': 'The age library could not use this key for encryption.',
};

export class RecipientError extends Error {
  readonly code: RecipientErrorCode;
  constructor(code: RecipientErrorCode) {
    super(RECIPIENT_ERROR_TEXT[code]);
    this.name = 'RecipientError';
    this.code = code;
    Object.setPrototypeOf(this, RecipientError.prototype);
  }
}

/** A recipient that passed validation. Immutable once created. */
export interface ValidatedRecipient {
  readonly type: typeof RECIPIENT_TYPE;
  /** Canonical textual form (lower-case Bech32). */
  readonly canonical: string;
  /** Full key identifier, 64 lower-case hex characters. */
  readonly keyId: string;
}

/**
 * Normalises surrounding whitespace and case. Bech32 allows all-lower or
 * all-upper strings; both forms of the same key map to one canonical value.
 * Returns `null` for mixed case (invalid Bech32).
 */
export function canonicaliseRecipient(input: string): string | null {
  const s = input.trim();
  const lower = s.toLowerCase();
  const upper = s.toUpperCase();
  if (s !== lower && s !== upper) return null;
  return lower;
}

/** Synchronous shape checks. Throws {@link RecipientError}; never echoes input. */
export function checkRecipientShape(input: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) throw new RecipientError('empty');

  // The private-key check runs first and on the whole input, so that a pasted
  // key file is recognised as such whatever its length.
  const trimmed = input.trim();
  if (trimmed.toUpperCase().includes('AGE-SECRET-KEY-')) {
    throw new RecipientError('private-key');
  }
  // Other age recipient types (post-quantum, tag) are long: name them
  // correctly instead of reporting a generic length problem.
  if (/^age1(pq1|tag1|tagpq1)/i.test(trimmed)) throw new RecipientError('unsupported-age-type');
  if (trimmed.length > MAX_INPUT_LENGTH) throw new RecipientError('too-long');
  if (/^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-|sk-ssh-|sk-ecdsa-)/.test(trimmed)) {
    throw new RecipientError('ssh-key');
  }
  if (/\s/.test(trimmed)) throw new RecipientError('malformed');

  const canonical = canonicaliseRecipient(trimmed);
  if (canonical === null) throw new RecipientError('mixed-case');
  if (!canonical.startsWith('age1')) throw new RecipientError('not-age-recipient');
  if (/^age1(pq1|tag1|tagpq1)/.test(canonical)) throw new RecipientError('unsupported-age-type');
  if (canonical.length !== X25519_RECIPIENT_LENGTH) {
    // Longer age1… strings are other (plugin / post-quantum) recipient types.
    throw new RecipientError(canonical.length > X25519_RECIPIENT_LENGTH ? 'unsupported-age-type' : 'malformed');
  }
  if (!BECH32_DATA_CHARS.test(canonical.slice(4))) throw new RecipientError('malformed');
  return canonical;
}

/**
 * Computes the WAFB key identifier for a canonical recipient R:
 *
 *   K = hex( SHA-256( UTF-8( "wafb-recipient-v1:" ‖ R ) ) )
 *
 * The domain prefix separates this digest from every other hash in the
 * workflow; the version makes the convention explicit. This is an
 * application-level identifier, not part of the age format.
 */
export async function computeKeyId(canonicalRecipient: string): Promise<string> {
  const data = new TextEncoder().encode(KEY_ID_DOMAIN + canonicalRecipient);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

/**
 * Full validation (RF1): shape checks, acceptance by the age library and a
 * trial encryption of an empty message.
 */
export async function validateRecipient(input: string): Promise<ValidatedRecipient> {
  const canonical = checkRecipientShape(input);
  try {
    const enc = new Encrypter();
    enc.addRecipient(canonical);
    await enc.encrypt(new Uint8Array(0));
  } catch {
    // The library error text is discarded on purpose: it may quote the input.
    throw new RecipientError('rejected-by-library');
  }
  const keyId = await computeKeyId(canonical);
  return Object.freeze({ type: RECIPIENT_TYPE, canonical, keyId });
}

/**
 * Presents a key identifier for human comparison: groups of 4 hex characters,
 * all 64 characters shown. A short prefix is deliberately not offered as a
 * verification method, because an attacker choosing keys can search for a
 * matching prefix.
 */
export function formatKeyId(keyId: string, groupSize = 4): string {
  const groups: string[] = [];
  for (let i = 0; i < keyId.length; i += groupSize) groups.push(keyId.slice(i, i + groupSize));
  return groups.join(' ');
}

/**
 * Compares a key identifier typed or pasted by the acquirer with the
 * computed one. Spaces, dashes and case are ignored; *every* character must
 * match. Returns false for a partial (prefix) entry.
 */
export function keyIdMatches(computed: string, entered: string): boolean {
  const norm = entered.toLowerCase().replace(/[\s:-]/g, '');
  if (!/^[0-9a-f]{64}$/.test(norm)) return false;
  // Constant-time-style comparison; the values are public, but this avoids
  // any temptation to short-circuit on a prefix.
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= norm.charCodeAt(i) ^ computed.charCodeAt(i);
  return diff === 0 && computed.length === 64;
}

function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

// ============================================================================
// Recipient verification state (RF2)
// ============================================================================

export type RecipientVerificationState =
  | { status: 'absent' }
  | { status: 'invalid'; code: RecipientErrorCode }
  | { status: 'unverified'; recipient: ValidatedRecipient }
  | {
      status: 'confirmed';
      recipient: ValidatedRecipient;
      /** Declared by the operator; not a cryptographic authentication. */
      confirmation: RecipientConfirmation;
    };

export type VerificationMethod =
  | 'full-key-id-entered'
  | 'full-key-id-compared-by-voice'
  | 'full-key-id-compared-in-person'
  | 'other-authenticated-channel';

export interface RecipientConfirmation {
  method: VerificationMethod;
  /** ISO-8601, client clock. */
  confirmedAt: string;
  /** Free text the operator may add (e.g. which channel). Never required. */
  note?: string;
}

export async function recipientStateFromInput(input: string | null | undefined): Promise<RecipientVerificationState> {
  if (input === null || input === undefined || input.trim() === '') return { status: 'absent' };
  try {
    return { status: 'unverified', recipient: await validateRecipient(input) };
  } catch (err) {
    if (err instanceof RecipientError) return { status: 'invalid', code: err.code };
    throw err;
  }
}

/**
 * Moves an `unverified` recipient to `confirmed`. For the
 * `full-key-id-entered` method the entered identifier must match in full;
 * a mismatch throws and the state cannot be forced.
 */
export function confirmRecipient(
  state: RecipientVerificationState,
  confirmation: Omit<RecipientConfirmation, 'confirmedAt'> & { enteredKeyId?: string; confirmedAt?: string }
): RecipientVerificationState {
  if (state.status !== 'unverified') {
    throw new Error(`Cannot confirm a recipient in state "${state.status}"`);
  }
  if (confirmation.method === 'full-key-id-entered') {
    if (!confirmation.enteredKeyId || !keyIdMatches(state.recipient.keyId, confirmation.enteredKeyId)) {
      throw new KeyIdMismatchError();
    }
  }
  return {
    status: 'confirmed',
    recipient: state.recipient,
    confirmation: Object.freeze({
      method: confirmation.method,
      confirmedAt: confirmation.confirmedAt ?? new Date().toISOString(),
      ...(confirmation.note ? { note: confirmation.note } : {}),
    }),
  };
}

export class KeyIdMismatchError extends Error {
  constructor() {
    super(
      'The key fingerprint does not match the one communicated by the analyst. ' +
        'Do not start the acquisition: contact the analyst through the channel you already trust.'
    );
    this.name = 'KeyIdMismatchError';
    Object.setPrototypeOf(this, KeyIdMismatchError.prototype);
  }
}
