// Renders a Plurk timeline (the /APP/Timeline/getPlurks response) as
// left-bar terminal "cards". Rendering is kept pure -- it takes already
// parsed data and returns a string -- so it can be unit-tested without any
// network access or a real terminal.
//
// The cards deliberately have no right-hand border: Plurk content is often
// full-width CJK text, whose display width a terminal cannot derive from the
// JS string length, so a right border would misalign. A left bar stays tidy
// regardless of the content.

export interface PlurkUser {
  id?: number;
  nick_name?: string;
  display_name?: string;
}

export interface Plurk {
  plurk_id?: number;
  owner_id?: number;
  user_id?: number;
  qualifier?: string;
  qualifier_translated?: string;
  content?: string;
  content_raw?: string;
  posted?: string;
  response_count?: number;
}

export interface TimelineData {
  plurks?: Plurk[];
  plurk_users?: Record<string, PlurkUser>;
}

export interface RenderOptions {
  /** Total card width in columns (default 70). */
  width?: number;
  /** Emit ANSI colors (default false). */
  color?: boolean;
  /** "Now" used for relative timestamps (default new Date()). */
  now?: Date;
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function paint(text: string, codes: string, on: boolean): string {
  return on ? `${codes}${text}${ANSI.reset}` : text;
}

/** Strip HTML tags and decode the handful of entities Plurk emits. */
export function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** A compact, English relative time such as "3m ago" or "2d ago". */
export function relativeTime(posted: string, now: Date = new Date()): string {
  const then = new Date(posted);
  if (Number.isNaN(then.getTime())) {
    return "";
  }
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  if (days < 30) {
    return `${Math.floor(days / 7)}w ago`;
  }
  if (days < 365) {
    return `${Math.floor(days / 30)}mo ago`;
  }
  return `${Math.floor(days / 365)}y ago`;
}

/** Greedy word wrap; long words are hard-broken at `width`. */
export function wrapText(text: string, width: number): string[] {
  const max = Math.max(1, width);
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    while (word.length > max) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (!line) {
      line = word;
    } else if (line.length + 1 + word.length <= max) {
      line += " " + word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

function renderCard(
  plurk: Plurk,
  users: Record<string, PlurkUser>,
  options: Required<RenderOptions>,
): string {
  const owner = users[String(plurk.owner_id ?? plurk.user_id ?? "")] ?? {};
  const name = owner.display_name || owner.nick_name || "someone";
  const qualifier = plurk.qualifier_translated || plurk.qualifier || "says";
  const time = plurk.posted ? relativeTime(plurk.posted, options.now) : "";

  const rawContent = plurk.content_raw && plurk.content_raw.trim().length > 0
    ? plurk.content_raw
    : (plurk.content ?? "");
  const text = stripHtml(rawContent);

  const bar = paint("┃", ANSI.cyan, options.color);
  const inner = Math.max(20, options.width - 2);

  const header = paint(`${name} ${qualifier}`, ANSI.bold, options.color) +
    paint(time ? ` · ${time}` : "", ANSI.gray, options.color);

  const lines = [`${bar} ${header}`];
  for (const wrapped of wrapText(text, inner)) {
    lines.push(`${bar} ${wrapped}`);
  }
  const responses = plurk.response_count ?? 0;
  if (responses > 0) {
    const replies = responses === 1 ? "1 reply" : `${responses} replies`;
    lines.push(`${bar} ${paint(`↳ ${replies}`, ANSI.dim, options.color)}`);
  }
  return lines.join("\n");
}

export function renderTimeline(
  data: TimelineData,
  options: RenderOptions = {},
): string {
  const resolved: Required<RenderOptions> = {
    width: options.width ?? 70,
    color: options.color ?? false,
    now: options.now ?? new Date(),
  };
  const plurks = data.plurks ?? [];
  if (plurks.length === 0) {
    return "Timeline is empty.";
  }
  const users = data.plurk_users ?? {};
  return plurks
    .map((plurk) => renderCard(plurk, users, resolved))
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Horizontal (left-to-right) layout: each plurk is a fixed-size box, and the
// boxes are placed side by side. This needs display-width-aware measurement so
// full-width CJK content does not push the right border out of alignment.
// ---------------------------------------------------------------------------

/** Display columns a single code point occupies (1, or 2 for wide/CJK). */
function charWidth(codePoint: number): number {
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK radicals .. punctuation
    (codePoint >= 0x3041 && codePoint <= 0x33ff) || // Kana .. CJK symbols
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK Ext A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK Unified
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // Yi
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compat
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK compat forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) || // emoji & symbols
    (codePoint >= 0x20000 && codePoint <= 0x3fffd) // CJK Ext B+
  ) {
    return 2;
  }
  return 1;
}

/** Total display width of a string. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += charWidth(ch.codePointAt(0)!);
  }
  return width;
}

/** Truncate to at most `width` display columns (never pads). */
export function truncateToWidth(text: string, width: number): string {
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0)!);
    if (used + w > width) {
      break;
    }
    out += ch;
    used += w;
  }
  return out;
}

/** Truncate or pad with spaces to exactly `width` display columns. */
export function fitToWidth(text: string, width: number): string {
  const clipped = truncateToWidth(text, width);
  const pad = width - displayWidth(clipped);
  return pad > 0 ? clipped + " ".repeat(pad) : clipped;
}

/** Word wrap by display width; words wider than `width` are hard-broken. */
export function wrapByWidth(text: string, width: number): string[] {
  const max = Math.max(1, width);
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    while (displayWidth(word) > max) {
      if (line) {
        lines.push(line);
        line = "";
      }
      const head = truncateToWidth(word, max);
      lines.push(head);
      word = word.slice(head.length);
    }
    if (!line) {
      line = word;
    } else if (displayWidth(line) + 1 + displayWidth(word) <= max) {
      line += " " + word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

export interface CardBoxOptions {
  /** Total box width including borders. */
  width: number;
  /** Total box height including borders. */
  height: number;
  color?: boolean;
  now?: Date;
}

function renderCardBox(
  plurk: Plurk,
  users: Record<string, PlurkUser>,
  width: number,
  height: number,
  color: boolean,
  now: Date,
): string[] {
  const innerWidth = Math.max(4, width - 4);
  const contentRows = Math.max(1, height - 2);

  const owner = users[String(plurk.owner_id ?? plurk.user_id ?? "")] ?? {};
  const name = owner.display_name || owner.nick_name || "someone";
  const qualifier = plurk.qualifier_translated || plurk.qualifier || "says";
  const time = plurk.posted ? relativeTime(plurk.posted, now) : "";
  const rawContent = plurk.content_raw && plurk.content_raw.trim().length > 0
    ? plurk.content_raw
    : (plurk.content ?? "");
  const text = stripHtml(rawContent);
  const responses = plurk.response_count ?? 0;
  const footer = responses > 0
    ? `↳ ${responses === 1 ? "1 reply" : `${responses} replies`}`
    : "";

  const rows: { text: string; style: string }[] = [];
  rows.push({ text: `${name} ${qualifier}`, style: ANSI.bold });
  if (time) {
    rows.push({ text: time, style: ANSI.gray });
  }

  const bodyBudget = Math.max(0, contentRows - rows.length - (footer ? 1 : 0));
  let body = wrapByWidth(text, innerWidth);
  if (body.length > bodyBudget) {
    body = body.slice(0, bodyBudget);
    if (bodyBudget > 0) {
      body[bodyBudget - 1] =
        truncateToWidth(body[bodyBudget - 1], Math.max(0, innerWidth - 1)) + "…";
    }
  }
  for (const bodyLine of body) {
    rows.push({ text: bodyLine, style: "" });
  }
  while (rows.length < contentRows - (footer ? 1 : 0)) {
    rows.push({ text: "", style: "" });
  }
  if (footer) {
    rows.push({ text: footer, style: ANSI.dim });
  }
  rows.length = Math.min(rows.length, contentRows);
  while (rows.length < contentRows) {
    rows.push({ text: "", style: "" });
  }

  const edge = (s: string) => paint(s, ANSI.cyan, color);
  const lines = [edge("┌" + "─".repeat(width - 2) + "┐")];
  for (const row of rows) {
    const cell = fitToWidth(row.text, innerWidth);
    const painted = row.style ? paint(cell, row.style, color) : cell;
    lines.push(`${edge("│")} ${painted} ${edge("│")}`);
  }
  lines.push(edge("└" + "─".repeat(width - 2) + "┘"));
  return lines;
}

/** Render each plurk as a fixed-size box (height lines tall). */
export function renderCardBoxes(
  data: TimelineData,
  options: CardBoxOptions,
): string[][] {
  const users = data.plurk_users ?? {};
  const now = options.now ?? new Date();
  const color = options.color ?? false;
  return (data.plurks ?? []).map((plurk) =>
    renderCardBox(plurk, users, options.width, options.height, color, now)
  );
}

/** Lay boxes (all the same height) side by side into composite rows. */
export function composeCards(boxes: string[][], gap = 2): string[] {
  if (boxes.length === 0) {
    return [];
  }
  const height = boxes[0].length;
  const separator = " ".repeat(gap);
  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    rows.push(boxes.map((box) => box[r] ?? "").join(separator));
  }
  return rows;
}
