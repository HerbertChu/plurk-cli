import { OAuthToken } from "./PlurkOAuth.ts";

// Persists the Plurk OAuth access token to a small JSON file so the
// interactive authorization only has to happen once. Defaults to
// ~/.plurk-cli.json; override with the PLURK_TOKEN_FILE environment variable.

const DEFAULT_FILENAME = ".plurk-cli.json";

export class TokenStore {
  constructor(private readonly path: string = TokenStore.defaultPath()) {}

  static defaultPath(): string {
    const override = Deno.env.get("PLURK_TOKEN_FILE");
    if (override) {
      return override;
    }
    const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
    return `${home}/${DEFAULT_FILENAME}`;
  }

  get location(): string {
    return this.path;
  }

  /** Load a saved token, or undefined if the file is absent or malformed. */
  async load(): Promise<OAuthToken | undefined> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return undefined;
      }
      throw error;
    }
    try {
      const data = JSON.parse(text);
      if (
        typeof data?.token === "string" &&
        typeof data?.tokenSecret === "string"
      ) {
        return { token: data.token, tokenSecret: data.tokenSecret };
      }
    } catch {
      // Fall through: a corrupt file is treated as "no token".
    }
    return undefined;
  }

  /** Save a token, restricting the file to the owner where supported. */
  async save(token: OAuthToken): Promise<void> {
    const text = JSON.stringify(
      { token: token.token, tokenSecret: token.tokenSecret },
      null,
      2,
    );
    await Deno.writeTextFile(this.path, text);
    try {
      await Deno.chmod(this.path, 0o600);
    } catch {
      // chmod is unsupported on some platforms (e.g. Windows); ignore.
    }
  }

  /** Delete the saved token. Returns whether a file was actually removed. */
  async clear(): Promise<boolean> {
    try {
      await Deno.remove(this.path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }
}
