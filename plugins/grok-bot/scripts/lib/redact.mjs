const JWT = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER = /Bearer\s+\S+/gi;
const GATEWAY_URL = /https?:\/\/[^\s"'\\]+(?:cursorvm\.com|cursor\.sh)[^\s"'\\]*/gi;
const OPAQUE = /\b[A-Za-z0-9_-]{32,}\b/g;
const SECRET_KEYS = new Set([
  "token",
  "gatewaytoken",
  "gateway_token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "authorization",
  "encrypted",
  "encrypted_key",
  "networktoken",
  "network_token",
  "anyrunnetworktoken",
  "password",
  "secret",
  "vncproxy",
  "vnc_proxy",
]);

function scrubString(value) {
  return value
    .replace(JWT, "[redacted]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(GATEWAY_URL, "[redacted-url]");
}

export function redact(value, key = "") {
  if (value == null) return value;
  if (SECRET_KEYS.has(String(key).toLowerCase())) return "[redacted]";
  if (typeof value === "string") {
    const scrubbed = scrubString(value);
    if (key && /id$/i.test(key) && value.length < 64) return value;
    return scrubbed.replace(OPAQUE, (match) => (match.length >= 48 ? "[redacted]" : match));
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

export function redactText(text) {
  return scrubString(String(text ?? ""));
}

export function printJson(value) {
  process.stdout.write(JSON.stringify(redact(value), null, 2) + "\n");
}
