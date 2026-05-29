// A small scrolling pager for viewing the timeline with the keyboard.
//
// The scroll math lives in ScrollState, which is pure and unit-tested. The
// terminal driver (runPager) is a thin layer over an injectable PagerIO so the
// raw-mode/escape-sequence handling is isolated; that layer is exercised
// manually rather than in tests.

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

const FOOTER_ROWS = 1;

function frame(lines: string[], state: ScrollState): string {
  const view = state.visible(lines);
  const footer = "\x1b[7m " +
    "↑↓/jk scroll · space/b page · g/G top/bottom · q quit" +
    (state.atBottom ? " · (end)" : "") +
    " \x1b[0m";
  // Home, clear screen, body (CR+LF for raw mode), then the status footer.
  return "\x1b[H\x1b[2J" + view.join("\r\n") + "\r\n" + footer;
}

/** Display `text` in a full-screen, keyboard-scrollable viewer. */
export async function runPager(
  text: string,
  io: PagerIO = denoIO(),
): Promise<void> {
  const lines = text.split("\n");
  const state = new ScrollState(lines.length, io.size().rows - FOOTER_ROWS);

  io.setRaw(true);
  io.write("\x1b[?1049h\x1b[?25l"); // enter alt screen, hide cursor
  try {
    while (true) {
      state.setViewport(io.size().rows - FOOTER_ROWS);
      io.write(frame(lines, state));
      const key = await io.readKey();
      if (key === null || key === "quit") {
        break;
      }
      switch (key) {
        case "down":
          state.by(1);
          break;
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
