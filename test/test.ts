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
import { Repl } from "../src/Repl.ts";
import {
  composeCards,
  displayWidth,
  fitToWidth,
  relativeTime,
  renderCardBoxes,
  renderFeedLines,
  renderTimeline,
  stripHtml,
  truncateToWidth,
  wrapByWidth,
  wrapText,
} from "../src/Timeline.ts";
import { ScrollState } from "../src/Pager.ts";

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

// Build a Repl with captured output and an authorizer that fails if called,
// so command dispatch can be tested without any network.
function makeRepl(store: TokenStore) {
  const logs: string[] = [];
  const repl = new Repl({
    authorize: () => {
      throw new Error("authorize should not be called");
    },
    store,
    readLine: () => null,
    log: (message) => logs.push(message),
  });
  return { repl, logs };
}

Deno.test("Repl /help lists commands without authorizing", async () => {
  const { repl, logs } = makeRepl(new TokenStore("unused"));
  assertEquals(await repl.handle("/help"), false);
  assertStringIncludes(logs.join("\n"), "/post");
});

Deno.test("Repl /quit signals exit", async () => {
  const { repl, logs } = makeRepl(new TokenStore("unused"));
  assertEquals(await repl.handle("/quit"), true);
  assertStringIncludes(logs.join("\n"), "Bye");
});

Deno.test("Repl reports unknown commands", async () => {
  const { repl, logs } = makeRepl(new TokenStore("unused"));
  assertEquals(await repl.handle("/nope"), false);
  assertStringIncludes(logs.join("\n"), "Unknown command");
});

Deno.test("Repl /logout removes the saved token", async () => {
  const path = await Deno.makeTempFile();
  try {
    const store = new TokenStore(path);
    await store.save({ token: "t", tokenSecret: "s" });
    const { repl, logs } = makeRepl(store);
    assertEquals(await repl.handle("/logout"), false);
    assertEquals(await store.load(), undefined);
    assertStringIncludes(logs.join("\n"), "Logged out");
  } finally {
    try {
      await Deno.remove(path);
    } catch {
      // Already removed by /logout.
    }
  }
});

Deno.test("relativeTime formats common ranges", () => {
  const now = new Date("2026-05-29T12:00:00Z");
  assertEquals(relativeTime("2026-05-29T11:59:30Z", now), "30s ago");
  assertEquals(relativeTime("2026-05-29T11:30:00Z", now), "30m ago");
  assertEquals(relativeTime("2026-05-29T09:00:00Z", now), "3h ago");
  assertEquals(relativeTime("2026-05-27T12:00:00Z", now), "2d ago");
  assertEquals(relativeTime("not a date", now), "");
});

Deno.test("stripHtml removes tags and decodes entities", () => {
  assertEquals(stripHtml('<a href="x">hi</a> &amp; bye'), "hi & bye");
  assertEquals(stripHtml("line1<br>line2"), "line1 line2");
});

Deno.test("wrapText wraps on word boundaries and hard-breaks long words", () => {
  assertEquals(wrapText("a bb ccc", 4), ["a bb", "ccc"]);
  assertEquals(wrapText("abcdef", 3), ["abc", "def"]);
  assertEquals(wrapText("", 10), [""]);
});

Deno.test("renderTimeline draws a left-bar card", () => {
  const now = new Date("2026-05-29T12:00:00Z");
  const out = renderTimeline({
    plurks: [{
      owner_id: 1,
      qualifier: "says",
      content_raw: "Hello world",
      posted: "2026-05-29T11:00:00Z",
      response_count: 2,
    }],
    plurk_users: { "1": { nick_name: "alice" } },
  }, { color: false, width: 40, now });
  assertStringIncludes(out, "┃ alice says");
  assertStringIncludes(out, "1h ago");
  assertStringIncludes(out, "Hello world");
  assertStringIncludes(out, "2 replies");
});

Deno.test("renderTimeline handles an empty timeline", () => {
  assertEquals(renderTimeline({ plurks: [] }), "Timeline is empty.");
});

Deno.test("renderTimeline resolves names from a search-style users map", () => {
  // PlurkSearch/search returns a "users" map rather than "plurk_users".
  const out = renderTimeline({
    plurks: [{ owner_id: 7, qualifier: "says", content_raw: "hi" }],
    users: { "7": { nick_name: "bob" } },
  }, { color: false });
  assertStringIncludes(out, "bob says");
});

Deno.test("ScrollState clamps the offset within range", () => {
  const state = new ScrollState(100, 10);
  assertEquals(state.offset, 0);
  state.by(-5);
  assertEquals(state.offset, 0);
  state.by(5);
  assertEquals(state.offset, 5);
  state.toBottom();
  assertEquals(state.offset, 90);
  state.by(50);
  assertEquals(state.offset, 90);
  state.toTop();
  assertEquals(state.offset, 0);
});

Deno.test("ScrollState paging steps by viewport minus one", () => {
  const state = new ScrollState(50, 10);
  state.pageDown();
  assertEquals(state.offset, 9);
  state.pageDown();
  assertEquals(state.offset, 18);
  state.pageUp();
  assertEquals(state.offset, 9);
});

Deno.test("ScrollState.visible returns the current window", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `L${i}`);
  const state = new ScrollState(20, 5);
  state.by(3);
  assertEquals(state.visible(lines), ["L3", "L4", "L5", "L6", "L7"]);
});

Deno.test("ScrollState pins to top when content fits the viewport", () => {
  const state = new ScrollState(3, 10);
  assertEquals(state.maxOffset, 0);
  state.toBottom();
  assertEquals(state.offset, 0);
});

Deno.test("displayWidth counts CJK as two columns", () => {
  assertEquals(displayWidth("ab"), 2);
  assertEquals(displayWidth("中文"), 4);
  assertEquals(displayWidth("a中b"), 4);
});

Deno.test("truncateToWidth respects wide-character boundaries", () => {
  assertEquals(truncateToWidth("中文字", 3), "中"); // 文 would overflow to 4
  assertEquals(truncateToWidth("abcd", 3), "abc");
});

Deno.test("fitToWidth pads or truncates to an exact display width", () => {
  assertEquals(displayWidth(fitToWidth("中", 5)), 5);
  assertEquals(fitToWidth("ab", 4), "ab  ");
  assertEquals(displayWidth(fitToWidth("中文字", 4)), 4);
});

Deno.test("wrapByWidth hard-breaks CJK runs by display width", () => {
  assertEquals(wrapByWidth("中文字測試", 4), ["中文", "字測", "試"]);
  assertEquals(wrapByWidth("hello world", 5), ["hello", "world"]);
});

Deno.test("renderCardBoxes returns fixed-height boxes", () => {
  const boxes = renderCardBoxes({
    plurks: [{ owner_id: 1, qualifier: "says", content_raw: "hi" }],
    plurk_users: { "1": { nick_name: "alice" } },
  }, { width: 20, height: 8, color: false });
  assertEquals(boxes.length, 1);
  assertEquals(boxes[0].length, 8);
  assertStringIncludes(boxes[0].join("\n"), "alice says");
  assertStringIncludes(boxes[0][0], "┌");
});

Deno.test("composeCards lays boxes side by side", () => {
  assertEquals(
    composeCards([["A1", "A2"], ["B1", "B2"]], 1),
    ["A1 B1", "A2 B2"],
  );
  assertEquals(composeCards([]), []);
});

Deno.test("renderFeedLines renders two lines per plurk", () => {
  const now = new Date("2026-05-29T12:00:00Z");
  const lines = renderFeedLines({
    plurks: [{
      owner_id: 1,
      qualifier: "says",
      content_raw: "hello",
      posted: "2026-05-29T11:00:00Z",
      response_count: 2,
    }],
    plurk_users: { "1": { nick_name: "alice" } },
  }, { width: 40, color: false, now });
  assertEquals(lines.length, 2);
  assertStringIncludes(lines[0], "● alice says");
  assertStringIncludes(lines[0], "1h");
  assertStringIncludes(lines[0], "↳2");
  assertEquals(lines[1], "  hello");
});

Deno.test("renderFeedLines truncates long content to the width", () => {
  const lines = renderFeedLines({
    plurks: [{ owner_id: 1, content_raw: "x".repeat(100) }],
    plurk_users: { "1": { nick_name: "a" } },
  }, { width: 20, color: false, now: new Date() });
  assertEquals(displayWidth(lines[1]), 20);
  assertEquals(lines[1].endsWith("…"), true);
});
