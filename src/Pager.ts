// A small scrolling viewer for the timeline.
//
// The scroll math lives in ScrollState, which is pure and unit-tested. The
// terminal driver (viewTimeline) is a thin layer over an injectable PagerIO so
// the raw-mode/escape-sequence handling is isolated; that layer is exercised
// manually rather than in tests.

import {
  composeCards,
  renderCardBoxes,
  renderFeedLines,
  TimelineData,
  TimelineLayout,
} from "./Timeline.ts";

export class ScrollState {
  private top = 0;

  constructor(private readonly total: number, private viewport: number) {
    this.viewport = Math.max(1, viewport);
  }

  get offset(): number {
    return this.top;
  }

  get maxOffset(): number {
    return Math.max(0, this.total - this.viewport);
  }

  get atBottom(): boolean {
    return this.top >= this.maxOffset;
  }

  setViewport(viewport: number): void {
    this.viewport = Math.max(1, viewport);
    this.clamp();
  }

  by(delta: number): void {
    this.top += delta;
    this.clamp();
  }

  pageDown(): void {
    this.by(this.viewport - 1);
  }

  pageUp(): void {
    this.by(-(this.viewport - 1));
  }

  toTop(): void {
    this.top = 0;
  }

  toBottom(): void {
    this.top = this.maxOffset;
  }

  /** The visible slice of `lines` for the current offset. */
  visible(lines: string[]): string[] {
    return lines.slice(this.top, this.top + this.viewport);
  }

  private clamp(): void {
    this.top = Math.min(Math.max(0, this.top), this.maxOffset);
  }
}

export type PagerKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "pageup"
  | "pagedown"
  | "top"
  | "bottom"
  | "layout"
  | "quit"
  | "";

export interface PagerIO {
  size: () => { columns: number; rows: number };
  write: (text: string) => void;
  setRaw: (raw: boolean) => void;
  /** Resolve the next key, or null on EOF. */
  readKey: () => Promise<PagerKey | null>;
}

/** Map a raw key/escape sequence to a logical pager action. */
export function mapKey(sequence: string): PagerKey {
  switch (sequence) {
    case "q":
    case "\x03": // Ctrl-C
    case "\x1b": // Esc
      return "quit";
    case "j":
    case "\x1b[B":
    case "\x1bOB":
      return "down";
    case "k":
    case "\x1b[A":
    case "\x1bOA":
      return "up";
    case "l":
    case "\x1b[C":
    case "\x1bOC":
      return "right";
    case "h":
    case "\x1b[D":
    case "\x1bOD":
      return "left";
    case " ":
    case "f":
    case "\x1b[6~":
      return "pagedown";
    case "b":
    case "\x1b[5~":
      return "pageup";
    case "g":
    case "\x1b[H":
      return "top";
    case "G":
    case "\x1b[F":
      return "bottom";
    case "v":
    case "V":
    case "\t":
      return "layout";
    default:
      return "";
  }
}

function denoIO(): PagerIO {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    size: () => {
      try {
        const { columns, rows } = Deno.consoleSize();
        return { columns, rows };
      } catch {
        return { columns: 80, rows: 24 };
      }
    },
    write: (text) => {
      Deno.stdout.writeSync(encoder.encode(text));
    },
    setRaw: (raw) => {
      try {
        Deno.stdin.setRaw(raw);
      } catch {
        // Not a TTY; ignore.
      }
    },
    readKey: async () => {
      const buffer = new Uint8Array(8);
      const n = await Deno.stdin.read(buffer);
      if (n === null) {
        return null;
      }
      return mapKey(decoder.decode(buffer.subarray(0, n)));
    },
  };
}

const GAP = 2;
const FOOTER_ROWS = 1;

function visibleCount(columns: number, cardWidth: number): number {
  return Math.max(1, Math.floor((columns + GAP) / (cardWidth + GAP)));
}

interface View {
  rows: string[];
  units: number;
  viewport: number;
  hint: string;
}

/** Build the renderable rows + scroll metrics for the current layout/size. */
function buildView(
  data: TimelineData,
  layout: TimelineLayout,
  size: { columns: number; rows: number },
  color: boolean,
  offset: number,
): View {
  if (layout === "feed") {
    const lines = renderFeedLines(data, { width: size.columns, color, now: new Date() });
    const viewport = Math.max(1, size.rows - FOOTER_ROWS);
    const state = new ScrollState(lines.length, viewport);
    state.by(offset);
    return {
      rows: state.visible(lines),
      units: lines.length,
      viewport,
      hint: "↑↓/jk scroll · space/b page · v cards · q quit",
    };
  }
  const cardWidth = Math.max(24, Math.min(36, size.columns));
  const cardHeight = Math.max(6, Math.min(16, size.rows - FOOTER_ROWS - 1));
  const boxes = renderCardBoxes(data, { width: cardWidth, height: cardHeight, color, now: new Date() });
  const viewport = visibleCount(size.columns, cardWidth);
  const state = new ScrollState(boxes.length, viewport);
  state.by(offset);
  return {
    rows: composeCards(state.visible(boxes), GAP),
    units: boxes.length,
    viewport,
    hint: "←→/hl scroll · space/b page · v feed · q quit",
  };
}

/**
 * Display the timeline in a full-screen, keyboard-driven viewer. Cards lay the
 * plurks out left-to-right (like the Plurk web river); feed is a dense vertical
 * list. Press v (or Tab) to switch layouts; arrows/hjkl scroll, space/b page,
 * g/G jump to the ends, q/Esc quits.
 */
export async function viewTimeline(
  data: TimelineData,
  options: { color?: boolean; layout?: TimelineLayout } = {},
  io: PagerIO = denoIO(),
): Promise<void> {
  if ((data.plurks ?? []).length === 0) {
    io.write("Timeline is empty.\n");
    return;
  }
  const color = options.color ?? false;
  let layout: TimelineLayout = options.layout === "feed" ? "feed" : "cards";
  let offset = 0;

  io.setRaw(true);
  io.write("\x1b[?1049h\x1b[?25l"); // enter alt screen, hide cursor
  try {
    while (true) {
      const view = buildView(data, layout, io.size(), color, offset);
      // Re-clamp our offset to whatever the view considered valid.
      offset = Math.min(offset, Math.max(0, view.units - view.viewport));
      offset = Math.max(0, offset);
      const shown = Math.min(view.viewport, Math.max(0, view.units - offset));
      const range = `${view.units === 0 ? 0 : offset + 1}-${offset + shown}/${view.units}`;
      const footer = `\x1b[7m ${view.hint} · ${range} \x1b[0m`;
      io.write("\x1b[H\x1b[2J" + view.rows.join("\r\n") + "\r\n" + footer);

      const key = await io.readKey();
      if (key === null || key === "quit") {
        break;
      }
      const max = Math.max(0, view.units - view.viewport);
      switch (key) {
        case "layout":
          layout = layout === "cards" ? "feed" : "cards";
          offset = 0;
          break;
        case "right":
        case "down":
          offset = Math.min(max, offset + 1);
          break;
        case "left":
        case "up":
          offset = Math.max(0, offset - 1);
          break;
        case "pagedown":
          offset = Math.min(max, offset + (view.viewport - 1));
          break;
        case "pageup":
          offset = Math.max(0, offset - (view.viewport - 1));
          break;
        case "top":
          offset = 0;
          break;
        case "bottom":
          offset = max;
          break;
      }
    }
  } finally {
    io.write("\x1b[?25h\x1b[?1049l"); // show cursor, leave alt screen
    io.setRaw(false);
  }
}
