import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decryptV10Gcm, isV20, prefixOf } from "./oscrypt.mjs";
import { GrokBotError } from "./errors.mjs";
import { grokBotDir } from "./paths.mjs";

const DPAPI_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "win_dpapi.ps1");

function dpapiUnprotect(blob) {
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-File", DPAPI_SCRIPT],
    { input: blob.toString("base64"), encoding: "utf8" },
  ).trim();
  if (!out) throw new GrokBotError("DPAPI returned empty output.", "DPAPI");
  return Buffer.from(out, "base64");
}

export function loadOsCryptKey(dir) {
  const localStatePath = join(dir, "Local State");
  if (!existsSync(localStatePath)) {
    throw new GrokBotError("Grok Bot Local State is missing on this Windows user.", "NO_LOCAL_STATE");
  }
  const localState = JSON.parse(readFileSync(localStatePath, "utf8"));
  const wrapped = localState?.os_crypt?.encrypted_key;
  if (typeof wrapped !== "string") {
    throw new GrokBotError("Grok Bot Local State has no os_crypt.encrypted_key.", "NO_OSCRYPT_KEY");
  }
  const raw = Buffer.from(wrapped, "base64");
  if (raw.subarray(0, 5).toString("latin1") !== "DPAPI") {
    throw new GrokBotError("Grok Bot OSCrypt key is not DPAPI-wrapped.", "OSCRYPT_FORMAT");
  }
  const key = dpapiUnprotect(raw.subarray(5));
  if (key.length !== 32) {
    throw new GrokBotError("Unexpected OSCrypt key length.", "OSCRYPT_KEY_LEN");
  }
  return key;
}

function decryptJsonBlob(b64, key) {
  const blob = Buffer.from(b64, "base64");
  if (isV20(blob)) {
    throw new GrokBotError(
      "Grok Bot session uses App-Bound encryption (v20). Set CURSOR_ACCESS_TOKEN instead.",
      "V20",
    );
  }
  if (prefixOf(blob) !== "v10") {
    throw new GrokBotError("Unsupported Windows OSCrypt prefix.", "OSCRYPT_PREFIX");
  }
  return JSON.parse(decryptV10Gcm(blob, key).toString("utf8"));
}

function decryptStringBlob(b64, key) {
  const blob = Buffer.from(b64, "base64");
  if (isV20(blob)) {
    throw new GrokBotError(
      "Grok Bot token uses App-Bound encryption (v20). Set CURSOR_ACCESS_TOKEN instead.",
      "V20",
    );
  }
  return decryptV10Gcm(blob, key).toString("utf8");
}

function encryptedFromDescriptor(wrapped) {
  if (wrapped.version != null && wrapped.version !== 1 && wrapped.version !== 2) {
    throw new GrokBotError("Unsupported gateway-descriptor version " + wrapped.version, "DESCRIPTOR_VERSION");
  }
  if (wrapped.version === 2) {
    const entries = Object.values(wrapped.entries ?? {});
    if (entries.length === 0) {
      throw new GrokBotError("gateway-descriptor has no saved gateway entries.", "EMPTY_ENTRIES");
    }
    if (entries.length > 1) {
      throw new GrokBotError("gateway-descriptor has multiple entries.", "AMBIGUOUS_ENTRIES");
    }
    return entries[0]?.encrypted;
  }
  return wrapped.encrypted;
}

export function loadWindowsAppSession({ env = process.env, home } = {}) {
  const dir = grokBotDir("win32", env, home);
  if (!existsSync(dir)) {
    throw new GrokBotError("Grok Bot app data is missing. Install Grok Bot or set CURSOR_ACCESS_TOKEN.", "NO_APP_DIR");
  }
  const key = loadOsCryptKey(dir);
  let gateway = null;
  const descriptorPath = join(dir, "gateway-descriptor.json");
  if (existsSync(descriptorPath)) {
    const wrapped = JSON.parse(readFileSync(descriptorPath, "utf8"));
    const encrypted = encryptedFromDescriptor(wrapped);
    if (typeof encrypted !== "string") {
      throw new GrokBotError("gateway-descriptor is missing an encrypted payload.", "MISSING_ENCRYPTED");
    }
    const clear = decryptJsonBlob(encrypted, key);
    if (!clear.baseUrl || !clear.token) {
      throw new GrokBotError("Decrypted gateway descriptor is incomplete.", "INCOMPLETE_DESCRIPTOR");
    }
    gateway = {
      gatewayUrl: String(clear.baseUrl).replace(/\/$/, ""),
      gatewayToken: String(clear.token),
      gatewayHeaders: clear.headers && typeof clear.headers === "object" ? clear.headers : {},
    };
  }

  let accessToken = null;
  const secretsPath = join(dir, "sand-secrets.json");
  if (existsSync(secretsPath)) {
    const secrets = JSON.parse(readFileSync(secretsPath, "utf8"));
    const rawAccounts = secrets["cursor-accounts"];
    if (typeof rawAccounts === "string") {
      const accounts = JSON.parse(rawAccounts);
      const active = accounts.active;
      const rec = (accounts.accounts && (accounts.accounts[active] || Object.values(accounts.accounts)[0])) || null;
      const enc = rec?.["cursor-access-token"];
      if (typeof enc === "string") accessToken = decryptStringBlob(enc, key);
    }
  }

  let appVersion = "";
  const statusPath = join(dir, "desktop-status.json");
  if (existsSync(statusPath)) {
    try {
      appVersion = JSON.parse(readFileSync(statusPath, "utf8")).appVersion || "";
    } catch {
      appVersion = "";
    }
  }

  return { gateway, accessToken, appVersion, dir };
}
