// A small scrolling viewer for the timeline.
//
// The scroll math lives in ScrollState, which is pure and unit-tested. The
// terminal driver (viewTimeline) is a thin layer over an injectable PagerIO so
// the raw-mode/escape-sequence handling is isolated; that layer is exercised
// manually rather than in tests.

import { composeCards, renderCardBoxes, TimelineData } from "./Timeline.ts";

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

function frame(
  boxes: string[][],
  state: ScrollState,
  total: number,
): string {
  const view = state.visible(boxes);
  const body = composeCards(view, GAP);
  const range = view.length > 0
    ? `${state.offset + 1}-${state.offset + view.length}/${total}`
    : `0/${total}`;
  const footer = "\x1b[7m " +
    "←→/hl scroll · space/b page · g/G ends · q quit · " + range +
    " \x1b[0m";
  // Home, clear screen, composed cards (CR+LF for raw mode), then the footer.
  return "\x1b[H\x1b[2J" + body.join("\r\n") + "\r\n" + footer;
}

/**
 * Display the timeline as a horizontal, left-to-right river of cards and let
 * the user scroll through it with the keyboard (←/→ or h/l, one card at a
 * time; space/b to page; g/G for the ends; q/Esc to quit).
 */
export async function viewTimeline(
  data: TimelineData,
  options: { color?: boolean } = {},
  io: PagerIO = denoIO(),
): Promise<void> {
  const plurks = data.plurks ?? [];
  if (plurks.length === 0) {
    io.write("Timeline is empty.\n");
    return;
  }

  const size = io.size();
  const cardWidth = Math.max(24, Math.min(36, size.columns));
  const cardHeight = Math.max(6, Math.min(16, size.rows - FOOTER_ROWS - 1));
  const boxes = renderCardBoxes(data, {
    width: cardWidth,
    height: cardHeight,
    color: options.color ?? false,
    now: new Date(),
  });
  const state = new ScrollState(boxes.length, visibleCount(size.columns, cardWidth));

  io.setRaw(true);
  io.write("\x1b[?1049h\x1b[?25l"); // enter alt screen, hide cursor
  try {
    while (true) {
      const current = io.size();
      state.setViewport(visibleCount(current.columns, cardWidth));
      io.write(frame(boxes, state, boxes.length));
      const key = await io.readKey();
      if (key === null || key === "quit") {
        break;
      }
      switch (key) {
        case "right":
        case "down":
          state.by(1);
          break;
        case "left":
        case "up":
          state.by(-1);
          break;
        case "pagedown":
          state.pageDown();
          break;
        case "pageup":
          state.pageUp();
          break;
        case "top":
          state.toTop();
          break;
        case "bottom":
          state.toBottom();
          break;
      }
    }
  } finally {
    io.write("\x1b[?25h\x1b[?1049l"); // show cursor, leave alt screen
    io.setRaw(false);
  }
}
