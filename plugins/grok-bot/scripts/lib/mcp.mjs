import { createAgent, getTranscript, listAgents, sendPrompt, updateAgent } from "./gateway.mjs";
import { parseHash } from "./hash.mjs";
import { redact } from "./redact.mjs";
import { connectSession } from "./session.mjs";
import { chat } from "./stream.mjs";
import { GrokBotError } from "./errors.mjs";

const TOOLS = [
  {
    name: "grok_bot_doctor",
    description: "Check Grok Bot credentials and whether the cloud computer is reachable. Never prints tokens.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "grok_bot_list",
    description: "List Grok Bot teammates on the signed-in Cursor account.",
    inputSchema: { type: "object", properties: { full: { type: "boolean" } } },
  },
  {
    name: "grok_bot_create",
    description: "Create a new Grok Bot teammate. Only when the user asked to create one.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        force: { type: "boolean" },
      },
      required: ["name"],
    },
  },
  {
    name: "grok_bot_send",
    description: "Send a prompt to a named Grok Bot without waiting for the reply.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Bot name or id" },
        prompt: { type: "string" },
      },
      required: ["name", "prompt"],
    },
  },
  {
    name: "grok_bot_chat",
    description: "Send a prompt to a named Grok Bot and wait for new transcript entries. Use for #Name requests.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        prompt: { type: "string" },
        timeout: { type: "number" },
        hash: { type: "string", description: "Raw #Name prompt line" },
      },
      required: [],
    },
  },
  {
    name: "grok_bot_transcript",
    description: "Read recent messages from a Grok Bot.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, limit: { type: "number" } },
      required: ["name"],
    },
  },
  {
    name: "grok_bot_update",
    description: "Edit a Grok Bot name, title, or standing rules.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        rename: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["name"],
    },
  },
];

function mcpResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(redact(obj), null, 2) }] };
}

function mcpError(message) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

async function callTool(name, args = {}) {
  if (name === "grok_bot_doctor") {
    const session = await connectSession().catch((err) => ({ error: err.message }));
    if (session.error) return mcpResult({ ok: false, error: session.error });
    const bots = await listAgents(session);
    return mcpResult({ ok: true, source: session.source, bots: bots.length });
  }
  const session = await connectSession();
  switch (name) {
    case "grok_bot_list":
      return mcpResult(await listAgents(session));
    case "grok_bot_create":
      return mcpResult(await createAgent(session, args));
    case "grok_bot_send": {
      const sent = await sendPrompt(session, args.name, args.prompt);
      return mcpResult({ accepted: sent.result?.accepted !== false, agent: sent.target });
    }
    case "grok_bot_chat": {
      let bot = args.name;
      let prompt = args.prompt;
      if (args.hash) {
        const parsed = parseHash(args.hash);
        if (!parsed) throw new GrokBotError("hash line is not #Name prompt");
        bot = parsed.name;
        prompt = parsed.prompt;
      }
      if (!bot || !prompt) throw new GrokBotError("grok_bot_chat needs name and prompt");
      return mcpResult(await chat(session, bot, prompt, { timeout: args.timeout || 90 }));
    }
    case "grok_bot_transcript":
      return mcpResult(await getTranscript(session, args.name, args.limit || 20));
    case "grok_bot_update":
      return mcpResult(
        await updateAgent(session, args.name, {
          name: args.rename,
          title: args.title,
          description: args.description,
        }),
      );
    default:
      throw new GrokBotError("Unknown tool " + name);
  }
}

export function handleMcp(message) {
  if (!message || typeof message !== "object") return null;
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gbot-pipeline", version: "0.2.0" },
      },
    };
  }
  if (message.method === "notifications/initialized" || message.method === "initialized") return null;
  if (message.method === "ping") {
    return { jsonrpc: "2.0", id: message.id, result: {} };
  }
  if (message.method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } };
  }
  return undefined;
}

export async function handleMcpAsync(message) {
  const sync = handleMcp(message);
  if (sync !== undefined) return sync;
  if (message.method === "tools/call") {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      return { jsonrpc: "2.0", id: message.id, result };
    } catch (err) {
      return { jsonrpc: "2.0", id: message.id, result: mcpError(err.message) };
    }
  }
  return {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: "Method not found" },
  };
}

function writeMessage(obj) {
  if (!obj) return;
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export function extractMcpFrames(text) {
  const messages = [];
  let rest = text;
  while (rest.length) {
    const headerMatch = rest.match(/^Content-Length:\s*(\d+)\r\n\r\n/i);
    if (headerMatch) {
      const len = Number(headerMatch[1]);
      const start = headerMatch[0].length;
      if (rest.length < start + len) break;
      messages.push(rest.slice(start, start + len));
      rest = rest.slice(start + len);
      continue;
    }
    const nl = rest.indexOf("\n");
    if (nl < 0) break;
    const line = rest.slice(0, nl).replace(/\r$/, "").trim();
    rest = rest.slice(nl + 1);
    if (line) messages.push(line);
  }
  return { messages, rest };
}

export async function serveMcp() {
  let buf = "";
  const queue = [];
  let pumping = false;
  process.stdin.setEncoding("utf8");

  function pump() {
    const extracted = extractMcpFrames(buf);
    buf = extracted.rest;
    for (const json of extracted.messages) {
      queue.push(json);
      if (!pumping) drain();
    }
  }

  async function drain() {
    pumping = true;
    while (queue.length) {
      const raw = queue.shift();
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        continue;
      }
      const reply = await handleMcpAsync(msg);
      writeMessage(reply);
    }
    pumping = false;
  }

  process.stdin.on("data", (chunk) => {
    buf += chunk;
    pump();
  });
  process.stdin.resume();
  await new Promise((resolve) => {
    process.stdin.on("end", resolve);
    process.stdin.on("error", resolve);
  });
}
