import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decryptV10Cbc, prefixOf } from "./oscrypt.mjs";
import { GrokBotError } from "./errors.mjs";
import { grokBotDir } from "./paths.mjs";

function keychainPassword(platform) {
  try {
    if (platform === "linux") {
      return execFileSync(
        "secret-tool",
        ["lookup", "xdg:schema", "chrome_libsecret_os_crypt_password_v2", "application", "Grok Bot"],
        { encoding: "utf8" },
      ).trimEnd();
    }
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", "Grok Bot Safe Storage"],
      { encoding: "utf8" },
    ).trimEnd();
  } catch {
    throw new GrokBotError(
      platform === "linux"
        ? "Could not read Grok Bot secret from libsecret (secret-tool)."
        : "Could not read Grok Bot Safe Storage from Keychain.",
      "KEYCHAIN",
    );
  }
}

function encryptedFromDescriptor(wrapped) {
  if (wrapped.version === 2) {
    const entries = Object.values(wrapped.entries ?? {});
    if (entries.length !== 1) {
      throw new GrokBotError("gateway-descriptor v2 needs exactly one entry.", "DESCRIPTOR_ENTRIES");
    }
    return entries[0]?.encrypted;
  }
  return wrapped.encrypted;
}

function decryptBlob(b64, password, platform) {
  const blob = Buffer.from(b64, "base64");
  const prefix = prefixOf(blob);
  if (prefix === "v20") {
    throw new GrokBotError("App-Bound encryption (v20) is not supported. Set CURSOR_ACCESS_TOKEN.", "V20");
  }
  const needsPassword = !(platform === "linux" && prefix === "v10");
  return decryptV10Cbc(blob, needsPassword ? password : "peanuts", platform);
}

function macosAccessToken(dir, password) {
  const secretsPath = join(dir, "sand-secrets.json");
  if (!existsSync(secretsPath)) return null;
  const secrets = JSON.parse(readFileSync(secretsPath, "utf8"));
  const stored = secrets["cursor-access-token"];
  if (typeof stored !== "string") return null;
  if (!stored.startsWith("scoped:v1:")) return null;
  const rest = stored.slice("scoped:v1:".length);
  const raw = Buffer.from(rest.slice(rest.indexOf(":") + 1), "base64");
  return decryptV10Cbc(raw, password, "darwin").toString("utf8");
}

export function loadPosixAppSession({ platform = process.platform, env = process.env, home } = {}) {
  const dir = grokBotDir(platform, env, home);
  const descriptorPath = join(dir, "gateway-descriptor.json");
  if (!existsSync(descriptorPath) && !existsSync(join(dir, "sand-secrets.json"))) {
    throw new GrokBotError("Grok Bot is not signed in on this machine. Set CURSOR_ACCESS_TOKEN or sign in.", "NO_APP_DIR");
  }
  let password = "";
  const descriptorExists = existsSync(descriptorPath);
  let peekPrefix = "";
  if (descriptorExists) {
    const wrapped = JSON.parse(readFileSync(descriptorPath, "utf8"));
    const encrypted = encryptedFromDescriptor(wrapped);
    peekPrefix = prefixOf(Buffer.from(encrypted, "base64"));
  }
  const linuxBasic = platform === "linux" && peekPrefix === "v10";
  if (!linuxBasic) password = keychainPassword(platform);

  let gateway = null;
  if (descriptorExists) {
    const wrapped = JSON.parse(readFileSync(descriptorPath, "utf8"));
    const encrypted = encryptedFromDescriptor(wrapped);
    const clear = JSON.parse(decryptBlob(encrypted, password, platform).toString("utf8"));
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
  if (platform === "darwin") {
    try {
      accessToken = macosAccessToken(dir, password);
    } catch {
      accessToken = null;
    }
  }

  return { gateway, accessToken, appVersion: "", dir };
}
