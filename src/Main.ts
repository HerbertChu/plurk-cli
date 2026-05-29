import { StdinReader } from "./libs/StdinReader.ts";
import { runPager } from "./Pager.ts";
import { Repl } from "./Repl.ts";
import { PlurkClient } from "./plurk/PlurkClient.ts";
import { PlurkOAuth } from "./plurk/PlurkOAuth.ts";
import { TokenStore } from "./plurk/TokenStore.ts";

export class PlurkCli {
  /**
   * Return an authorized PlurkOAuth. Tokens are resolved in priority order:
   *   1. PLURK_ACCESS_TOKEN / PLURK_ACCESS_TOKEN_SECRET environment variables
   *   2. a previously saved token file (see TokenStore)
   *   3. the interactive three-legged flow, whose result is then saved
   */
  public static async resolveOAuth(): Promise<PlurkOAuth> {
    const envToken = Deno.env.get("PLURK_ACCESS_TOKEN");
    const envSecret = Deno.env.get("PLURK_ACCESS_TOKEN_SECRET");
    if (envToken && envSecret) {
      return new PlurkOAuth(undefined, undefined, {
        token: envToken,
        tokenSecret: envSecret,
      });
    }

    const store = new TokenStore();
    const saved = await store.load();
    if (saved) {
      return new PlurkOAuth(undefined, undefined, saved);
    }

    const oauth = new PlurkOAuth();
    const requestToken = await oauth.getRequestToken();
    console.log("\nAuthorize plurk-cli in your browser:");
    console.log("  " + oauth.getAuthorizationUrl(requestToken));
    const verifier = prompt("\nPaste the verifier code shown after authorizing:");
    if (!verifier || !verifier.trim()) {
      throw new Error("No verifier provided; authorization aborted.");
    }
    const accessToken = await oauth.getAccessToken(requestToken, verifier.trim());
    await store.save(accessToken);
    console.log(`\nAuthorized! Access token saved to ${store.location}`);
    return oauth;
  }

  /**
   * Entry point. With content on the command line (or piped via stdin) it posts
   * once and exits; on an interactive terminal it starts the slash-command REPL.
   */
  public static async run(): Promise<void> {
    const fromArgs = Deno.args.join(" ").trim();
    if (fromArgs) {
      await PlurkCli.postOnce(fromArgs);
      return;
    }

    if (!Deno.stdin.isTerminal()) {
      const piped = (await StdinReader.read()).trim();
      if (piped) {
        await PlurkCli.postOnce(piped);
      }
      return;
    }

    const tty = Deno.stdout.isTerminal();
    await new Repl({
      authorize: () => PlurkCli.resolveOAuth(),
      store: new TokenStore(),
      readLine: (label) => prompt(label),
      log: (message) => console.log(message),
      color: tty,
      width: Math.min(Math.max(PlurkCli.terminalColumns(), 40), 100),
      pager: tty ? (text) => runPager(text) : undefined,
    }).start();
  }

  private static terminalColumns(): number {
    try {
      return Deno.consoleSize().columns;
    } catch {
      return 70;
    }
  }

  private static async postOnce(content: string): Promise<void> {
    const oauth = await PlurkCli.resolveOAuth();
    const response = await new PlurkClient(oauth).add2Timeline(content);
    const body = await response.text();
    if (!response.ok) {
      console.error(`Failed to post (${response.status}): ${body}`);
      Deno.exit(1);
    }

    let plurkId: unknown = "(unknown)";
    try {
      plurkId = JSON.parse(body).plurk_id ?? plurkId;
    } catch {
      // Non-JSON success response; fall through with the default id.
    }
    console.log(`Posted! plurk_id: ${plurkId}`);
  }
}

if (import.meta.main) {
  PlurkCli.run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  });
}
