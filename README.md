# Plurk-cli

## Made up with Deno runtime

### Start

Run with no arguments to open the interactive slash-command prompt:

```
deno run --allow-net --allow-env --allow-read --allow-write src/Main.ts
```

```
plurk-cli — type /help for commands, /quit to exit.
plurk> /post Hello from plurk-cli
Posted! plurk_id: 1234567890
plurk> /timeline
... opens a scrollable timeline ...
plurk> /whoami
Logged in as alice (id 42).
plurk> /quit
Bye!
```

Available commands: `/post <text>` (or just type text), `/timeline [n]`,
`/whoami`, `/login`, `/logout`, `/help`, `/quit`.

`/timeline` renders the latest plurks as cards laid out left-to-right (like the
Plurk web river) and opens a full-screen viewer you scroll with the keyboard:

| Key | Action |
| --- | --- |
| `→` / `←` or `l` / `h` | move one card right / left |
| `space` / `b` | page forward / back |
| `g` / `G` | jump to newest / oldest |
| `q` / `Esc` | close the viewer |

When the output is piped instead of shown on a terminal, the timeline is
printed as plain vertical cards.

For scripting, pass the content as an argument or pipe it via stdin to post once
and exit:

```
deno run --allow-net --allow-env --allow-read --allow-write src/Main.ts "Hello from plurk-cli"
echo "Hello from plurk-cli" | deno run --allow-net --allow-env --allow-read --allow-write src/Main.ts
```

(`--allow-read` / `--allow-write` let the CLI cache your access token; see below.)

### Authentication (Plurk OAuth 1.0a)

The Plurk API uses three-legged OAuth 1.0a. Register an app at
<https://www.plurk.com/PlurkApp/> to obtain an app key/secret, then expose them
as environment variables (they are never read from source or committed):

```
export PLURK_APP_KEY=your_app_key
export PLURK_APP_SECRET=your_app_secret
```

The first run prints an authorization URL and asks you to paste back the
verifier code Plurk shows after you approve the app. The resulting access token
is then saved to `~/.plurk-cli.json` (override the path with `PLURK_TOKEN_FILE`),
so subsequent runs skip the interactive step automatically.

To use a token without the file — e.g. in CI — set these environment variables,
which take precedence over the saved file:

```
export PLURK_ACCESS_TOKEN=your_access_token
export PLURK_ACCESS_TOKEN_SECRET=your_access_token_secret
```

`src/plurk/PlurkOAuth.ts` implements the flow directly if you want to drive it
yourself:

```ts
import { PlurkOAuth } from "./src/plurk/PlurkOAuth.ts";

const oauth = new PlurkOAuth(); // reads PLURK_APP_KEY / PLURK_APP_SECRET

// 1. Get a request token and send the user to authorize it.
const requestToken = await oauth.getRequestToken();
console.log("Authorize here:", oauth.getAuthorizationUrl(requestToken));

// 2. Exchange the verifier shown after authorizing for an access token.
await oauth.getAccessToken(requestToken, verifierFromUser);

// 3. Call any signed Plurk API endpoint.
const res = await oauth.request("/APP/Timeline/plurkAdd", {
  content: "Hello from plurk-cli",
  qualifier: "says",
});
```

### Test

```
deno test --allow-read --allow-write --allow-env
```

### Install Denon

```
deno install -qAf --unstable https://deno.land/x/denon/denon.ts

```

### Start with Denon

```
denon start
```

## Dev. with VSCode

Adding `"deno.enable": true` to settings.json under .vscode is required
