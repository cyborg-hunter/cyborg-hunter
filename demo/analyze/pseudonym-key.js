// demo/analyze/pseudonym-key.js
// The analyzer's pseudonym key: the secret the codes are made from
// (src/cli/pseudonymize-core.js). The page keeps it in its own localStorage,
// so a pseudonymized report gives each participant the same code from one
// visit to the next, and one loaded from the CLI's key file gives the CLI's
// codes. Only the secret is stored: the codes come from it alone, and the
// key file's rows would put participant IDs in the browser's storage.
// Nothing here touches the DOM: the worker uses the key-file checks, the
// page the rest, and node tests all of it.
import { KEY_FILE_NAME, KEY_FILE_BANNER, parseKeyFile } from '../../src/cli/pseudonymize-core.js';

export var KEY_STORAGE_KEY = 'ch-pseudonym-key';
var SECRET_RE = /^[0-9a-f]{64}$/;

// A file's first line, without the BOM and the CR a spreadsheet may have
// added when it saved the file back.
function firstLine(text) { return String(text).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]; }
function hasBanner(text) { return firstLine(text).indexOf(KEY_FILE_BANNER) === 0; }

/**
 * Whether a dropped file is a pseudonym key file, never participant data: by
 * the key file's name, or by its banner on the first line of `head` (the
 * file's first bytes, decoded), so a renamed copy is caught too.
 */
export function isKeyFile(name, head) { return name === KEY_FILE_NAME || hasBanner(head); }

/**
 * The secret of a key file's text. Throws, with the reason as its message,
 * for a file whose first line is not the banner or that holds no readable
 * secret (parseKeyFile): a file that is not a key must not be taken for one,
 * since its codes would match no report made before.
 */
export function keyFileSecret(text) {
  if (!hasBanner(text)) throw new Error('its first line is not the key file\'s banner ("' + KEY_FILE_BANNER + '")');
  return parseKeyFile(text).secret;
}

/**
 * The stored secret, or null when none is stored. Any page of this origin
 * can write the key, so a value that is not a secret reads as none. Throws
 * where storage is refused (`storage` null, or getItem throws), so that the
 * page can tell that from "nothing stored", as annotations.js does.
 */
export function readStoredSecret(storage) {
  var value = storage.getItem(KEY_STORAGE_KEY);
  return typeof value === 'string' && SECRET_RE.test(value) ? value : null;
}

/** Stores the secret; returns whether storage took it. */
export function storeSecret(storage, secret) {
  try {
    if (!storage) return false;
    storage.setItem(KEY_STORAGE_KEY, secret);
    return true;
  } catch (e) { return false; }
}

/** Removes the stored secret; returns whether storage took the removal. */
export function forgetStoredSecret(storage) {
  try {
    if (!storage) return false;
    storage.removeItem(KEY_STORAGE_KEY);
    return true;
  } catch (e) { return false; }
}

/**
 * What the page shows of the key: the first 8 hex digits of the SHA-256 of
 * the secret (as its hex text), which tells two keys apart without showing
 * the secret.
 */
export async function keyFingerprint(secret) {
  var digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
  return toHex(digest.subarray(0, 4));
}

/** A new secret, as the CLI makes one: 32 random bytes, hex. */
export function newSecret() { return toHex(crypto.getRandomValues(new Uint8Array(32))); }

function toHex(view) {
  var out = '';
  for (var i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}
