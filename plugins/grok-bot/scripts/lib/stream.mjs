import { getTranscript, isRunning, listAgents, sendPrompt } from "./gateway.mjs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function chat(session, ref, prompt, { timeout = 90, poll = 2, onEvent } = {}) {
  const emit = typeof onEvent === "function" ? onEvent : () => {};
  const before = await getTranscript(session, ref, 80);
  const beforeIds = new Set(before.entries.map((e) => e.id).filter(Boolean));
  const sent = await sendPrompt(session, ref, prompt);
  emit({ event: "accepted", bot: sent.target.name, id: sent.target.id, accepted: sent.result?.accepted !== false });
  if (sent.result?.accepted === false) {
    throw new Error("sendPrompt was not accepted.");
  }
  const deadline = Date.now() + timeout * 1000;
  let latest = sent.target;
  const seen = new Set(beforeIds);
  while (Date.now() < deadline) {
    await sleep(Math.max(0.4, poll) * 1000);
    const rows = await listAgents(session);
    latest = rows.find((r) => r.id === sent.target.id) || latest;
    const tail = await getTranscript(session, sent.target.id, 80);
    for (const entry of tail.entries) {
      if (entry.id && seen.has(entry.id)) continue;
      if (entry.id) seen.add(entry.id);
      if (!beforeIds.has(entry.id)) emit({ event: "entry", bot: latest.name, ...entry });
    }
    if (!isRunning(latest)) break;
  }
  const after = await getTranscript(session, sent.target.id, 80);
  const newEntries = after.entries.filter((e) => e.id && !beforeIds.has(e.id));
  const stillRunning = isRunning(latest);
  emit({ event: "done", bot: latest.name, stillRunning, newEntries: newEntries.length });
  return {
    agent: latest,
    stillRunning,
    newEntries,
  };
}
