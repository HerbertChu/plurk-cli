import { StdinReader } from "./libs/StdinReader.ts";
import { PlurkClient } from "./plurk/PlurkClient.ts";
import { PlurkOAuth } from "./plurk/PlurkOAuth.ts";

export class PlurkCli {
  /**
   * The plurk content, taken from the command-line arguments and falling back
   * to stdin (so `plurk "hi"` and `echo hi | plurk` both work). Reading from
   * args keeps stdin free for the interactive authorization prompt.
   */
  public static async readContent(): Promise<string> {
    const fromArgs = Deno.args.join(" ").trim();
    if (fromArgs) {
      return fromArgs;
    }
    const fromStdin = await StdinReader.read();
    return fromStdin.trim();
  }

  /**
   * Return an authorized PlurkOAuth. If PLURK_ACCESS_TOKEN /
   * PLURK_ACCESS_TOKEN_SECRET are set we reuse them; otherwise we run the
   * interactive three-legged flow and print the tokens so they can be saved.
   */
  public static async resolveOAuth(): Promise<PlurkOAuth> {
    const token = Deno.env.get("PLURK_ACCESS_TOKEN");
    const tokenSecret = Deno.env.get("PLURK_ACCESS_TOKEN_SECRET");
    const oauth = new PlurkOAuth(
      undefined,
      undefined,
      token && tokenSecret ? { token, tokenSecret } : undefined,
    );
    if (token && tokenSecret) {
      return oauth;
    }

    const requestToken = await oauth.getRequestToken();
    console.log("\nAuthorize plurk-cli in your browser:");
    console.log("  " + oauth.getAuthorizationUrl(requestToken));
    const verifier = prompt("\nPaste the verifier code shown after authorizing:");
    if (!verifier || !verifier.trim()) {
      throw new Error("No verifier provided; authorization aborted.");
    }
    const accessToken = await oauth.getAccessToken(requestToken, verifier.trim());
    console.log("\nAuthorized! Export these to skip this step next time:");
    console.log(`  export PLURK_ACCESS_TOKEN=${accessToken.token}`);
    console.log(`  export PLURK_ACCESS_TOKEN_SECRET=${accessToken.tokenSecret}\n`);
    return oauth;
  }

  public static async run(): Promise<void> {
    const content = await PlurkCli.readContent();
    if (!content) {
      console.error(
        "Nothing to post. Pass content as an argument or pipe it via stdin.",
      );
      Deno.exit(1);
    }

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
