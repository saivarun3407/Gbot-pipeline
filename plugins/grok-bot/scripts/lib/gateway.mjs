import { randomUUID } from "node:crypto";
import { GrokBotError } from "./errors.mjs";
import { normalizeName } from "./hash.mjs";
import { cursorRpc } from "./session.mjs";

function pick(obj, ...keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

export async function gatewayCall(session, method, body = {}, { http = "POST" } = {}) {
  const url = session.gatewayUrl + (method.startsWith("/") ? method : "/api/" + method);
  const headers = {
    "content-type": "application/json",
    authorization: "Bearer " + session.gatewayToken,
    ...(session.gatewayHeaders || {}),
  };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 90000);
  try {
    const res = await fetch(url, {
      method: http,
      headers,
      body: http === "GET" ? undefined : JSON.stringify(body ?? {}),
      signal: ac.signal,
    });
    const data = await readJson(res);
    if (!res.ok) {
      const detail = data.message || data.error || data.raw || res.statusText;
      throw new GrokBotError(method + " failed: HTTP " + res.status + " " + String(detail).slice(0, 300), "GATEWAY");
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

export function asRecord(agent) {
  if (!agent) return null;
  const memberIds = agent.memberIds || agent.memberAgentIds || [];
  return {
    id: agent.id || agent.agentId,
    name: agent.name || "",
    title: agent.title || "",
    description: agent.description || "",
    isGroup: agent.isGroup === true || (agent.isGroup == null && Array.isArray(memberIds) && memberIds.length > 0),
    memberIds: Array.isArray(memberIds) ? memberIds : [],
    isActive: agent.isActive,
    isRunning: pick(agent, "isRunning", "isRunningTurn", "isComposingMessage") === true,
    hasUnread: agent.hasUnread,
    lastMessagePreview: agent.lastMessagePreview || "",
    origin: agent.origin || "",
  };
}

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.agents)) return data.agents;
  if (Array.isArray(data.rows)) return data.rows;
  if (data.agent) return [data.agent];
  return [];
}

export async function listAgents(session) {
  const data = await gatewayCall(session, "listAgents", {});
  return unwrapList(data).map(asRecord).filter((r) => r && r.id);
}

export async function resolveRef(session, ref) {
  const records = await listAgents(session);
  return resolveFromList(records, ref);
}

export function resolveFromList(records, ref) {
  const raw = String(ref || "").trim();
  const needle = raw.toLowerCase();
  const folded = normalizeName(raw);
  if (!needle) throw new GrokBotError("Pass a bot name or id.", "NO_REF");
  const byId = records.find((r) => String(r.id).toLowerCase() === needle);
  if (byId) return byId;
  const matches = records.filter(
    (r) =>
      r.name.toLowerCase() === needle ||
      r.title.toLowerCase() === needle ||
      normalizeName(r.name) === folded ||
      normalizeName(r.title) === folded,
  );
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    const available = records.map((r) => r.name).filter(Boolean).join(", ") || "(none)";
    throw new GrokBotError("No Grok Bot named " + JSON.stringify(ref) + ". Available: " + available, "NOT_FOUND");
  }
  throw new GrokBotError("Ambiguous name " + JSON.stringify(ref) + "; pass the id.", "AMBIGUOUS");
}

function unwrapOne(data) {
  return asRecord(data.agent || data);
}

export async function createAgent(session, input) {
  const data = await gatewayCall(session, "createAgent", {
    name: input.name,
    description: input.description || "",
    title: input.title || "",
    origin: "user",
    isKickstartRequested: input.kickstart !== false,
  });
  let rec = unwrapOne(data);
  if (rec?.id && (input.title || input.description)) {
    await gatewayCall(session, "updateAgent", {
      id: rec.id,
      profile: {
        name: input.name,
        title: input.title || "",
        description: input.description || "",
      },
    });
    rec = (await listAgents(session)).find((r) => r.id === rec.id) || rec;
  }
  return rec;
}

export async function updateAgent(session, ref, patch = {}) {
  const rec = await resolveRef(session, ref);
  const profile = {
    name: patch.name !== undefined ? String(patch.name).trim() : rec.name,
    title: patch.title !== undefined ? String(patch.title) : rec.title,
    description: patch.description !== undefined ? String(patch.description) : rec.description,
  };
  if (!profile.name) throw new GrokBotError("Name cannot be blank.", "BAD_NAME");
  await gatewayCall(session, "updateAgent", { id: rec.id, profile });
  return (await listAgents(session)).find((r) => r.id === rec.id) || { ...rec, ...profile };
}

export async function sendPrompt(session, ref, prompt, extra = {}) {
  const rec = await resolveRef(session, ref);
  const data = await gatewayCall(session, "sendPrompt", {
    agentId: rec.id,
    prompt,
    clientNonce: extra.clientNonce || randomUUID(),
  });
  return { target: rec, result: data };
}

function transcriptEntries(payload) {
  if (Array.isArray(payload)) return payload.filter((row) => row && typeof row === "object");
  if (payload && typeof payload === "object") {
    for (const key of ["entries", "items", "messages", "transcript"]) {
      if (Array.isArray(payload[key])) return payload[key].filter((row) => row && typeof row === "object");
    }
  }
  return [];
}

export function entryText(entry) {
  for (const key of ["text", "content", "preview", "message"]) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value;
    if (value && typeof value === "object") {
      const nested = value.text || value.content;
      if (typeof nested === "string" && nested.trim()) return nested;
    }
  }
  return "";
}

export function summarizeEntry(entry) {
  return {
    id: entry.id || entry.entryId,
    kind: entry.kind || entry.type,
    author: entry.authorId || entry.role || entry.author,
    text: entryText(entry),
  };
}

export async function getTranscript(session, ref, limit) {
  const rec = await resolveRef(session, ref);
  let payload;
  try {
    payload = await gatewayCall(session, "getAgentTranscriptTail", { id: rec.id, limit: limit || 50 });
  } catch {
    payload = await gatewayCall(session, "getAgentTranscript", { id: rec.id });
  }
  let entries = transcriptEntries(payload);
  if (limit) entries = entries.slice(-limit);
  return { target: rec, entries: entries.map(summarizeEntry) };
}

export function isRunning(rec) {
  return Boolean(rec?.isRunning);
}

export async function health(session) {
  try {
    return await gatewayCall(session, "/health", {}, { http: "GET" });
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function accessStatus(session) {
  if (!session.accessToken) return null;
  try {
    const access = await cursorRpc(
      session.accessToken,
      "aiserver.v1.DashboardService",
      "GetSandAccessStatus",
      {},
      session.appVersion,
    );
    const run = await cursorRpc(
      session.accessToken,
      "aiserver.v1.GrokBotService",
      "GetSandBoxRunState",
      {},
      session.appVersion,
    );
    return {
      access: access.state || access,
      box: run.state || run,
    };
  } catch (err) {
    return { error: err.message };
  }
}
