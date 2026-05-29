# Plurk-cli

## Made up with Deno runtime

### Start

```
deno run --allow-net --allow-env src/Main.ts
```

### Authentication (Plurk OAuth 1.0a)

The Plurk API uses three-legged OAuth 1.0a. Register an app at
<https://www.plurk.com/PlurkApp/> to obtain an app key/secret, then expose them
as environment variables (they are never read from source or committed):

```
export PLURK_APP_KEY=your_app_key
export PLURK_APP_SECRET=your_app_secret
```

`src/plurk/PlurkOAuth.ts` implements the flow:

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
deno test
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
