const HASH = /^#([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\s+([\s\S]+))?$/;
const HASH_QUOTED = /^#(?:"([^"]+)"|'([^']+)')(?:\s+([\s\S]+))?$/;

export function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseHash(line) {
  const text = String(line || "").trim();
  const quoted = text.match(HASH_QUOTED);
  if (quoted) return { name: quoted[1] || quoted[2], prompt: (quoted[3] || "").trim() };
  const match = text.match(HASH);
  if (!match) return null;
  return { name: match[1], prompt: (match[2] || "").trim() };
}

export function parseCallArgs(args) {
  if (!args.length) return null;
  if (args[0].startsWith("#")) {
    return parseHash(args.join(" "));
  }
  const name = args[0];
  const prompt = args.slice(1).join(" ").trim();
  if (!name) return null;
  return { name, prompt };
}
