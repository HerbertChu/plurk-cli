import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.73.0/testing/asserts.ts";
import { AddPuRequest } from "../src/plurk/PlurkClient.ts";
import {
  buildSignatureBaseString,
  hmacSha1Base64,
  percentEncode,
} from "../src/plurk/PlurkOAuth.ts";
import { TokenStore } from "../src/plurk/TokenStore.ts";

Deno.test("AddPuRequest has sane default values", () => {
  const pu = new AddPuRequest();
  assertEquals(pu.limited_to, []);
  assertEquals(pu.no_comments, 0);
  assertEquals(pu.lang, "en");
  assertEquals(pu.replurkable, 1);
  assertEquals(pu.porn, 0);
  assertEquals(pu.publish_to_followers, 1);
  assertEquals(pu.publish_to_ananymous, 1);
});

Deno.test("AddPuRequest holds the content and qualifier it is given", () => {
  const pu = new AddPuRequest();
  pu.content = "Hello Plurk";
  pu.qualifier = "says";
  assertEquals(pu.content, "Hello Plurk");
  assertEquals(pu.qualifier, "says");
});

Deno.test("AddPuRequest serializes to the timeline payload shape", () => {
  const pu = new AddPuRequest();
  pu.content = "Hello Plurk";
  pu.qualifier = "says";
  const payload = JSON.parse(JSON.stringify(pu));
  assertEquals(payload.content, "Hello Plurk");
  assertEquals(payload.qualifier, "says");
  assertEquals(payload.lang, "en");
  assertEquals(payload.no_comments, 0);
});

Deno.test("percentEncode follows RFC 3986 (encodes reserved, keeps unreserved)", () => {
  assertEquals(percentEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assertEquals(percentEncode("a!b*c'd(e)"), "a%21b%2Ac%27d%28e%29");
  assertEquals(percentEncode("AZaz09-_.~"), "AZaz09-_.~");
});

Deno.test("buildSignatureBaseString produces the OAuth base string", () => {
  const base = buildSignatureBaseString(
    "post",
    "https://www.plurk.com/OAuth/request_token",
    { oauth_nonce: "abc", oauth_consumer_key: "key" },
  );
  assertEquals(
    base,
    "POST&https%3A%2F%2Fwww.plurk.com%2FOAuth%2Frequest_token&" +
      "oauth_consumer_key%3Dkey%26oauth_nonce%3Dabc",
  );
});

Deno.test("hmacSha1Base64 matches the canonical HMAC-SHA1 test vector", async () => {
  // Wikipedia HMAC example: HMAC-SHA1("key", "The quick brown fox...").
  const digest = await hmacSha1Base64(
    "key",
    "The quick brown fox jumps over the lazy dog",
  );
  assertEquals(digest, "3nybhbi3iqa8ino29wqQcBydtNk=");
});

Deno.test("hmacSha1Base64 returns a 20-byte (SHA-1) digest as base64", async () => {
  const digest = await hmacSha1Base64("secret&", "POST&url&params");
  // 20 bytes -> 28 base64 chars, padded with a single '='.
  assertEquals(digest.length, 28);
  assertStringIncludes(digest.slice(-1), "=");
});

// The TokenStore tests touch the filesystem, so they need
// `--allow-read --allow-write` (plus `--allow-env` for the rest of the suite).
Deno.test("TokenStore round-trips an OAuth token", async () => {
  const path = await Deno.makeTempFile();
  try {
    const store = new TokenStore(path);
    await store.save({ token: "tok", tokenSecret: "sec" });
    assertEquals(await store.load(), { token: "tok", tokenSecret: "sec" });
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("TokenStore.load returns undefined when the file is missing", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new TokenStore(`${dir}/absent.json`);
    assertEquals(await store.load(), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
