export class GrokBotError extends Error {
  constructor(message, code = "GROK_BOT") {
    super(message);
    this.name = "GrokBotError";
    this.code = code;
  }
}

export function die(message, code = 1) {
  process.stderr.write(JSON.stringify({ error: message }) + "\n");
  process.exit(code);
}
