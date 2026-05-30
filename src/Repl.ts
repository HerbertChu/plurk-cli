import { PlurkClient } from "./plurk/PlurkClient.ts";
import { PlurkOAuth } from "./plurk/PlurkOAuth.ts";
import { TokenStore } from "./plurk/TokenStore.ts";
import { renderTimeline, TimelineData, TimelineLayout } from "./Timeline.ts";

// Dependencies are injected so the REPL can be driven (and unit-tested)
// without touching the real terminal.
export interface ReplDeps {
  /** Resolve an authorized client (env vars, saved token, or interactive). */
  authorize: () => Promise<PlurkOAuth>;
  /** Where the access token is stored, for /logout and /login. */
  store: TokenStore;
  /** Read a line, or null on EOF (Ctrl-D). */
  readLine: (prompt: string) => string | null;
  /** Emit a line of output. */
  log: (message: string) => void;
  /** Render the timeline with ANSI colors (default false). */
  color?: boolean;
  /** Terminal width for timeline rendering (default 70). */
  width?: number;
  /** Optional scrollable viewer; when absent the timeline is just logged. */
  viewer?: (data: TimelineData, layout: TimelineLayout) => Promise<void>;
}

const HELP = [
  "Commands:",
  "  /post <text>       Post a plurk as \"says\" (alias: /p, or just type text)",
  "  /timeline [n] [m]  Show the latest plurks; m = cards|feed layout",
  "                     scroll with arrows/hjkl, v to switch layout, q to quit",
  "                     (aliases: /tl, /t)",
  "  /search <query>    Search plurks and browse the results (alias: /s)",
  "  /whoami            Show the authorized account (alias: /me)",
  "  /login             Authorize, or re-authorize, this app",
  "  /logout            Remove the saved access token",
  "  /help              Show this help (alias: /h, /?)",
  "  /quit              Exit (alias: /exit, /q)",
].join("\n");

export class Repl {
  private oauth?: PlurkOAuth;

  constructor(private readonly deps: ReplDeps) {}

  async start(): Promise<void> {
    this.deps.log("plurk-cli — type /help for commands, /quit to exit.");
    while (true) {
      const line = this.deps.readLine("plurk> ");
      if (line === null) {
        this.deps.log("");
        break;
      }
      const input = line.trim();
      if (!input) {
        continue;
      }
      if (await this.handle(input)) {
        break;
      }
    }
  }

  /** Handle a single line. Returns true when the REPL should exit. */
  async handle(input: string): Promise<boolean> {
    // A leading "/" marks a command; anything else is treated as /post.
    const isCommand = input.startsWith("/");
    const command = isCommand
      ? input.slice(1).split(/\s+/, 1)[0].toLowerCase()
      : "post";
    const argument = isCommand
      ? input.slice(1).replace(/^\S+\s*/, "")
      : input;

    switch (command) {
      case "help":
      case "h":
      case "?":
        this.deps.log(HELP);
        return false;
      case "quit":
      case "exit":
      case "q":
        this.deps.log("Bye!");
        return true;
      case "post":
      case "p":
        await this.post(argument);
        return false;
      case "timeline":
      case "tl":
      case "t":
        await this.timeline(argument);
        return false;
      case "search":
      case "s":
        await this.search(argument);
        return false;
      case "whoami":
      case "me":
        await this.whoami();
        return false;
      case "login":
        await this.login();
        return false;
      case "logout":
        await this.logout();
        return false;
      default:
        this.deps.log(`Unknown command: /${command}. Type /help.`);
        return false;
    }
  }

  private async ensureAuth(): Promise<PlurkOAuth> {
    if (!this.oauth) {
      this.oauth = await this.deps.authorize();
    }
    return this.oauth;
  }

  private async post(text: string): Promise<void> {
    const content = text.trim();
    if (!content) {
      this.deps.log("Usage: /post <text>");
      return;
    }
    const response = await new PlurkClient(await this.ensureAuth())
      .add2Timeline(content);
    const body = await response.text();
    if (!response.ok) {
      this.deps.log(`Failed to post (${response.status}): ${body}`);
      return;
    }
    this.deps.log(`Posted! plurk_id: ${Repl.field(body, "plurk_id")}`);
  }

  private async timeline(arg: string): Promise<void> {
    const params: Record<string, string> = {};
    let layout: TimelineLayout = "cards";
    for (const token of arg.trim().split(/\s+/).filter(Boolean)) {
      if (/^\d+$/.test(token)) {
        params.limit = String(Math.min(Number.parseInt(token, 10), 30));
      } else if (token === "feed" || token === "list") {
        layout = "feed";
      } else if (token === "cards" || token === "card") {
        layout = "cards";
      }
    }
    const data = await this.fetchTimeline("/APP/Timeline/getPlurks", params);
    if (data) {
      await this.display(data, layout);
    }
  }

  private async search(arg: string): Promise<void> {
    const query = arg.trim();
    if (!query) {
      this.deps.log("Usage: /search <query>");
      return;
    }
    const data = await this.fetchTimeline("/APP/PlurkSearch/search", { query });
    if (!data) {
      return;
    }
    if ((data.plurks ?? []).length === 0) {
      this.deps.log(`No plurks found for "${query}".`);
      return;
    }
    await this.display(data, "feed");
  }

  /** GET an endpoint that returns timeline-shaped JSON, or undefined on error. */
  private async fetchTimeline(
    path: string,
    params: Record<string, string>,
  ): Promise<TimelineData | undefined> {
    const oauth = await this.ensureAuth();
    const response = await oauth.request(path, params, "GET");
    const body = await response.text();
    if (!response.ok) {
      this.deps.log(`Failed (${response.status}): ${body}`);
      return undefined;
    }
    try {
      return JSON.parse(body) as TimelineData;
    } catch {
      this.deps.log(body);
      return undefined;
    }
  }

  private async display(data: TimelineData, layout: TimelineLayout): Promise<void> {
    if (this.deps.viewer) {
      await this.deps.viewer(data, layout);
    } else {
      // Non-interactive (piped/tests): plain-text vertical cards.
      this.deps.log(renderTimeline(data, {
        color: this.deps.color ?? false,
        width: this.deps.width ?? 70,
        now: new Date(),
      }));
    }
  }

  private async whoami(): Promise<void> {
    const oauth = await this.ensureAuth();
    const response = await oauth.request("/APP/Users/me", {}, "GET");
    const body = await response.text();
    if (!response.ok) {
      this.deps.log(`Failed (${response.status}): ${body}`);
      return;
    }
    const nick = Repl.field(body, "nick_name");
    const id = Repl.field(body, "id");
    this.deps.log(`Logged in as ${nick} (id ${id}).`);
  }

  private async login(): Promise<void> {
    this.oauth = undefined;
    await this.deps.store.clear();
    this.oauth = await this.deps.authorize();
    this.deps.log("Logged in.");
  }

  private async logout(): Promise<void> {
    this.oauth = undefined;
    const removed = await this.deps.store.clear();
    this.deps.log(
      removed
        ? `Logged out (removed ${this.deps.store.location}).`
        : "No saved token to remove.",
    );
  }

  /** Pull a field out of a JSON response body, with a readable fallback. */
  private static field(body: string, key: string): string {
    try {
      const value = JSON.parse(body)?.[key];
      return value === undefined || value === null ? "(unknown)" : String(value);
    } catch {
      return "(unknown)";
    }
  }
}
