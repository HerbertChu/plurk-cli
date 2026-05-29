// OAuth 1.0a client for the Plurk API (https://www.plurk.com/API).
//
// Plurk authenticates with the three-legged OAuth 1.0a flow and signs every
// request with HMAC-SHA1, so this module implements that from scratch on top
// of the Web Crypto API (no external dependency required).
//
// App credentials are read from the PLURK_APP_KEY / PLURK_APP_SECRET
// environment variables so they never have to be hard-coded or committed.
// Register an app at https://www.plurk.com/PlurkApp/ to obtain them, then run
// with `--allow-env --allow-net`.

const PLURK_BASE = "https://www.plurk.com";
const REQUEST_TOKEN_URL = `${PLURK_BASE}/OAuth/request_token`;
const AUTHORIZE_URL = `${PLURK_BASE}/OAuth/authorize`;
const ACCESS_TOKEN_URL = `${PLURK_BASE}/OAuth/access_token`;

export interface OAuthToken {
  token: string;
  tokenSecret: string;
}

/** Percent-encode a value per RFC 3986, as required by OAuth 1.0a. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Build the OAuth 1.0a signature base string:
 * `METHOD&encode(url)&encode(sorted "k=v" params)`.
 */
export function buildSignatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>,
): string {
  const normalized = Object.keys(params)
    .map((key) => [percentEncode(key), percentEncode(params[key])] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1
      : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(normalized),
  ].join("&");
}

/** Compute the base64-encoded HMAC-SHA1 of `message` keyed with `key`. */
export async function hmacSha1Base64(
  key: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(message),
  );
  let binary = "";
  for (const byte of new Uint8Array(signature)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export class PlurkOAuth {
  private readonly consumerKey: string;
  private readonly consumerSecret: string;
  private accessToken?: OAuthToken;

  constructor(
    consumerKey: string | undefined = Deno.env.get("PLURK_APP_KEY"),
    consumerSecret: string | undefined = Deno.env.get("PLURK_APP_SECRET"),
    accessToken?: OAuthToken,
  ) {
    if (!consumerKey || !consumerSecret) {
      throw new Error(
        "Missing Plurk app credentials. Set the PLURK_APP_KEY and " +
          "PLURK_APP_SECRET environment variables (register an app at " +
          "https://www.plurk.com/PlurkApp/).",
      );
    }
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.accessToken = accessToken;
  }

  /** Step 1: obtain an unauthorized request token. */
  public async getRequestToken(callback = "oob"): Promise<OAuthToken> {
    const header = await this.authorizationHeader(
      "POST",
      REQUEST_TOKEN_URL,
      {},
      { oauth_callback: callback },
    );
    const response = await fetch(REQUEST_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: header },
    });
    return PlurkOAuth.parseTokenResponse(
      await PlurkOAuth.readOk(response, "request token"),
    );
  }

  /** Step 2: the URL the user opens to authorize the request token. */
  public getAuthorizationUrl(requestToken: OAuthToken): string {
    return `${AUTHORIZE_URL}?oauth_token=${percentEncode(requestToken.token)}`;
  }

  /** Step 3: exchange the authorized request token for an access token. */
  public async getAccessToken(
    requestToken: OAuthToken,
    verifier: string,
  ): Promise<OAuthToken> {
    const header = await this.authorizationHeader(
      "POST",
      ACCESS_TOKEN_URL,
      {},
      { oauth_verifier: verifier },
      requestToken,
    );
    const response = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: header },
    });
    const token = PlurkOAuth.parseTokenResponse(
      await PlurkOAuth.readOk(response, "access token"),
    );
    this.accessToken = token;
    return token;
  }

  /** Call a signed Plurk API endpoint with the current access token. */
  public async request(
    path: string,
    params: Record<string, string> = {},
    method = "POST",
  ): Promise<Response> {
    if (!this.accessToken) {
      throw new Error(
        "Not authorized: obtain an access token before calling the API.",
      );
    }
    const url = path.startsWith("http") ? path : `${PLURK_BASE}${path}`;
    const header = await this.authorizationHeader(
      method,
      url,
      params,
      {},
      this.accessToken,
    );
    const body = new URLSearchParams(params).toString();
    if (method.toUpperCase() === "GET") {
      const query = body ? `?${body}` : "";
      return fetch(`${url}${query}`, {
        method: "GET",
        headers: { Authorization: header },
      });
    }
    return fetch(url, {
      method,
      headers: {
        Authorization: header,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  }

  /**
   * Build an `Authorization: OAuth ...` header. `requestParams` are the
   * endpoint's own parameters, which participate in the signature but are not
   * placed in the header; `oauthExtra` carries protocol params such as
   * oauth_callback / oauth_verifier.
   */
  private async authorizationHeader(
    method: string,
    url: string,
    requestParams: Record<string, string>,
    oauthExtra: Record<string, string> = {},
    token?: OAuthToken,
  ): Promise<string> {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: PlurkOAuth.nonce(),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_version: "1.0",
      ...oauthExtra,
    };
    if (token) {
      oauthParams.oauth_token = token.token;
    }

    const baseString = buildSignatureBaseString(method, url, {
      ...oauthParams,
      ...requestParams,
    });
    const signingKey = `${percentEncode(this.consumerSecret)}&${
      percentEncode(token?.tokenSecret ?? "")
    }`;
    oauthParams.oauth_signature = await hmacSha1Base64(signingKey, baseString);

    const header = Object.keys(oauthParams)
      .sort()
      .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
      .join(", ");
    return `OAuth ${header}`;
  }

  private static nonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  private static async readOk(
    response: Response,
    what: string,
  ): Promise<string> {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Plurk ${what} request failed (${response.status}): ${text}`,
      );
    }
    return text;
  }

  private static parseTokenResponse(body: string): OAuthToken {
    const params = new URLSearchParams(body);
    const token = params.get("oauth_token");
    const tokenSecret = params.get("oauth_token_secret");
    if (!token || !tokenSecret) {
      throw new Error(`Unexpected OAuth token response: ${body}`);
    }
    return { token, tokenSecret };
  }
}
