import { homedir } from "node:os";
import { join } from "node:path";

export function grokBotDir(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "Grok Bot");
  }
  if (platform === "linux") {
    return join(env.XDG_CONFIG_HOME || join(home, ".config"), "Grok Bot");
  }
  return join(home, "Library", "Application Support", "Grok Bot");
}

export function allowedGatewayHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host === "127.0.0.1" || host === "localhost") return true;
  return (
    host === "api2.cursor.sh" ||
    host.endsWith(".cursor.sh") ||
    host === "cursorvm.com" ||
    host.endsWith(".cursorvm.com")
  );
}

export function assertGatewayUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Gateway URL is not a valid URL.");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (local && url.protocol === "http:") return url.toString().replace(/\/$/, "");
  if (url.protocol !== "https:") throw new Error("Gateway URL must be https.");
  if (!allowedGatewayHost(url.hostname)) {
    throw new Error("Gateway host is not an allowed Cursor/Grok Bot host.");
  }
  return url.toString().replace(/\/$/, "");
}
