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
