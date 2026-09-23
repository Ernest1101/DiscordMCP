// Safety Word Filter — блокирует утечки токенов/паролей через Discord MCP.
//
// - scrubOutbound(text): проверяет что уходит в Discord. Если найден секрет —
//   бросает SafetyError, MCP-клиент получит ошибку вместо отправки.
// - scrubInbound(text): проходит по всему что приходит из Discord обратно к ИИ.
//   Все секреты заменяются на [REDACTED:type], чтобы кто-то в канале не мог
//   "скормить" боту свой токен и попросить его переслать.
//
// Настройки через env:
//   SAFETY_MODE          strict | warn | off        (по умолчанию strict)
//   SAFETY_CUSTOM_WORDS  comma,separated,extras     (доп. слова-стоп-листа)
//   SAFETY_LOG_FILE      /path/to/safety.log        (JSONL-лог детекций)

import fs from "node:fs";

export type SafetyMode = "strict" | "warn" | "off";

export interface SafetyConfig {
  mode: SafetyMode;
  customWords: string[];
  logFile?: string;
}

interface Pattern {
  name: string;
  regex: RegExp;
}

// Порядок важен: более специфичные раньше более общих.
const PATTERNS: Pattern[] = [
  { name: "discord-mfa-token", regex: /mfa\.[A-Za-z0-9_-]{20,}/g },
  {
    name: "discord-bot-token",
    regex: /[MN][A-Za-z\d]{23,25}\.[A-Za-z\d]{6}\.[A-Za-z\d_-]{27,}/g,
  },
  {
    name: "discord-user-token",
    regex: /[A-Za-z0-9_-]{24,26}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g,
  },
  { name: "anthropic-key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai-key", regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "github-token", regex: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "aws-access-key", regex: /AKIA[A-Z0-9]{16}/g },
  {
    name: "aws-secret",
    regex: /aws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{40}/gi,
  },
  { name: "slack-token", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "google-api-key", regex: /AIza[A-Za-z0-9_-]{30,}/g },
  {
    name: "stripe-key",
    regex: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g,
  },
  {
    name: "private-key-block",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "jwt",
    regex: /eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  },
  {
    name: "password-assignment",
    regex: /(?:password|passwd|pwd|pass|secret|token|api[_-]?key)\s*[:=]\s*['"]?[^\s'"]{6,}/gi,
  },
];

export class SafetyError extends Error {
  constructor(public hits: string[]) {
    super(
      `Safety filter blocked this operation. Detected: ${hits.join(
        ", ",
      )}. Remove the secret and try again, or set SAFETY_MODE=off to disable.`,
    );
    this.name = "SafetyError";
  }
}

export function loadSafetyConfig(): SafetyConfig {
  const raw = (process.env.SAFETY_MODE || "strict").toLowerCase();
  const mode: SafetyMode =
    raw === "off" || raw === "warn" || raw === "strict" ? (raw as SafetyMode) : "strict";
  const customWords = (process.env.SAFETY_CUSTOM_WORDS || "")
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);
  return { mode, customWords, logFile: process.env.SAFETY_LOG_FILE };
}

function logDetection(cfg: SafetyConfig, kind: "block" | "redact" | "warn", hits: string[]) {
  console.error(`[safety] ${kind}: ${hits.join(", ")}`);
  if (!cfg.logFile) return;
  try {
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        kind,
        hits,
      }) + "\n";
    fs.appendFileSync(cfg.logFile, line);
  } catch (err) {
    console.error("[safety] failed to write log:", (err as Error).message);
  }
}

function scan(text: string, cfg: SafetyConfig): string[] {
  const hits = new Set<string>();

  for (const { name, regex } of PATTERNS) {
    // regex has /g flag — clone matches
    const found = text.match(regex);
    if (found && found.length > 0) hits.add(name);
  }

  // User's own Discord token — never leak, wherever it appears.
  const ownToken = process.env.DISCORD_TOKEN;
  if (ownToken && ownToken.length >= 20 && text.includes(ownToken)) {
    hits.add("your-discord-token");
  }

  for (const word of cfg.customWords) {
    if (!word) continue;
    if (text.includes(word)) hits.add("custom-word");
  }

  return [...hits];
}

export function scrubOutbound(text: string, cfg: SafetyConfig): string {
  if (cfg.mode === "off") return text;
  const hits = scan(text, cfg);
  if (hits.length === 0) return text;

  if (cfg.mode === "warn") {
    logDetection(cfg, "warn", hits);
    return text;
  }
  logDetection(cfg, "block", hits);
  throw new SafetyError(hits);
}

export function scrubInbound(text: string, cfg: SafetyConfig): string {
  if (cfg.mode === "off") return text;
  if (typeof text !== "string" || text.length === 0) return text;

  let out = text;
  const hitTypes = new Set<string>();

  for (const { name, regex } of PATTERNS) {
    out = out.replace(regex, () => {
      hitTypes.add(name);
      return `[REDACTED:${name}]`;
    });
  }

  const ownToken = process.env.DISCORD_TOKEN;
  if (ownToken && ownToken.length >= 20 && out.includes(ownToken)) {
    out = out.split(ownToken).join("[REDACTED:your-discord-token]");
    hitTypes.add("your-discord-token");
  }

  for (const word of cfg.customWords) {
    if (word && out.includes(word)) {
      out = out.split(word).join("[REDACTED:custom-word]");
      hitTypes.add("custom-word");
    }
  }

  if (hitTypes.size > 0) logDetection(cfg, "redact", [...hitTypes]);
  return out;
}
