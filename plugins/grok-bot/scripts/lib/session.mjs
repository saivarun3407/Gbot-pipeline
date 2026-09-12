import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GrokBotError } from "./errors.mjs";
import { assertGatewayUrl, grokBotDir } from "./paths.mjs";
import { loadPosixAppSession } from "./session_posix.mjs";
import { loadWindowsAppSession } from "./session_windows.mjs";

const BACKEND = (process.env.SAND_BACKEND_URL || process.env.CURSOR_API_BASE_URL || "https://api2.cursor.sh").replace(
  /\/$/,
  "",
);

function envAccessToken() {
  return (
    process.env.CURSOR_ACCESS_TOKEN ||
    process.env.GROK_BOT_ACCESS_TOKEN ||
    process.env.SAND_ACCESS_TOKEN ||
    ""
  ).trim();
}

function envGatewayOverride() {
  const token = (process.env.GROK_BOT_GATEWAY_TOKEN || process.env.SAND_HOST_GATEWAY_TOKEN || process.env.SAND_GATEWAY_TOKEN || "").trim();
  const url = (process.env.GROK_BOT_GATEWAY_URL || process.env.SAND_HOST_GATEWAY_URL || "").trim();
  const headersRaw = process.env.GROK_BOT_GATEWAY_HEADERS;
  let gatewayHeaders = {};
  if (headersRaw) {
    const parsed = JSON.parse(headersRaw);
    if (parsed && typeof parsed === "object") gatewayHeaders = parsed;
  }
  if (url && token) {
    return { gatewayUrl: assertGatewayUrl(url), gatewayToken: token, gatewayHeaders, source: "env-gateway" };
  }
  return null;
}

function normalizeHeaders(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") continue;
    out[String(k).toLowerCase()] = String(v);
  }
  return out;
}

function headersFromEnsure(body) {
  const mapped = normalizeHeaders(body.gatewayHeaders || body.gateway_headers);
  if (Object.keys(mapped).length) return mapped;
  const token = body.anyrunNetworkToken || body.anyrun_network_token || body.networkToken || body.network_token;
  return token ? { "x-anyrun-network-token": String(token) } : {};
}

async function postJson(url, headers, body, timeoutMs = 90000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text.slice(0, 240) };
      }
    }
    return { res, json };
  } finally {
    clearTimeout(t);
  }
}

function clientVersion(appVersion) {
  return process.env.SAND_CLIENT_VERSION || appVersion || "0.47.0";
}

export async function ensureSandbox(accessToken, appVersion = "") {
  const url = BACKEND + "/aiserver.v1.GrokBotService/EnsureSandBox";
  const { res, json } = await postJson(url, {
    "content-type": "application/json",
    "connect-protocol-version": "1",
    authorization: "Bearer " + accessToken,
    "x-cursor-client-type": "sand",
    "x-cursor-client-version": clientVersion(appVersion),
    "x-sand-box-namespace": process.env.SAND_BOX_NAMESPACE || "prod",
    "x-ghost-mode": "false",
  }, {});
  if (!res.ok) {
    const detail = json.message || json.error || json.raw || res.statusText;
    throw new GrokBotError("EnsureSandBox failed: HTTP " + res.status + " " + String(detail).slice(0, 200), "ENSURE_SANDBOX");
  }
  const gatewayUrl = json.gatewayUrl || json.gateway_url;
  const gatewayToken = json.gatewayToken || json.gateway_token;
  if (!gatewayUrl || !gatewayToken) {
    throw new GrokBotError(
      "EnsureSandBox returned no gateway. Cursor dashboard API keys do not work; use a Cursor access token. Has this account opened Grok Bot at least once?",
      "ENSURE_SANDBOX_EMPTY",
    );
  }
  return {
    gatewayUrl: assertGatewayUrl(String(gatewayUrl)),
    gatewayToken: String(gatewayToken),
    gatewayHeaders: headersFromEnsure(json),
    source: "ensure-sandbox",
    cluster: json.cluster || "",
    podId: json.podId || json.pod_id || "",
  };
}

export async function cursorRpc(accessToken, service, method, body = {}, appVersion = "") {
  const url = BACKEND + "/" + service + "/" + method;
  const { res, json } = await postJson(url, {
    "content-type": "application/json",
    "connect-protocol-version": "1",
    authorization: "Bearer " + accessToken,
    "x-cursor-client-type": "sand",
    "x-cursor-client-version": clientVersion(appVersion),
    "x-sand-box-namespace": process.env.SAND_BOX_NAMESPACE || "prod",
    "x-ghost-mode": "false",
  }, body);
  if (!res.ok) {
    const detail = json.message || json.error || json.raw || res.statusText;
    throw new GrokBotError(method + " failed: HTTP " + res.status + " " + String(detail).slice(0, 200), "CURSOR_RPC");
  }
  return json;
}

function loadAppSession() {
  if (process.platform === "win32") return loadWindowsAppSession();
  if (process.platform === "darwin" || process.platform === "linux") return loadPosixAppSession();
  throw new GrokBotError("Unsupported platform " + process.platform, "PLATFORM");
}

export function appPresent() {
  const dir = grokBotDir();
  return existsSync(dir);
}

export function desktopStatus() {
  const path = join(grokBotDir(), "desktop-status.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export async function connectSession() {
  const override = envGatewayOverride();
  if (override) {
    return {
      ...override,
      accessToken: envAccessToken() || null,
      appVersion: desktopStatus()?.appVersion || "",
    };
  }

  let app = null;
  let appError = null;
  if (appPresent()) {
    try {
      app = loadAppSession();
    } catch (err) {
      appError = err;
    }
  }

  if (app?.gateway) {
    try {
      return {
        gatewayUrl: assertGatewayUrl(app.gateway.gatewayUrl),
        gatewayToken: app.gateway.gatewayToken,
        gatewayHeaders: normalizeHeaders(app.gateway.gatewayHeaders),
        accessToken: app.accessToken || envAccessToken() || null,
        appVersion: app.appVersion || desktopStatus()?.appVersion || "",
        source: "app-gateway",
      };
    } catch (err) {
      appError = err;
    }
  }

  const token = app?.accessToken || envAccessToken();
  if (token) {
    const box = await ensureSandbox(token, app?.appVersion || desktopStatus()?.appVersion || "");
    return {
      ...box,
      accessToken: token,
      appVersion: app?.appVersion || desktopStatus()?.appVersion || "",
      source: app?.accessToken ? "app-token" : "env-token",
    };
  }

  if (appError) throw appError;
  throw new GrokBotError(
    "No Grok Bot credentials. Sign into the Grok Bot app on this machine, or set CURSOR_ACCESS_TOKEN for the Cursor account that owns the Bots. grok login is not enough.",
    "NO_CREDENTIALS",
  );
}
