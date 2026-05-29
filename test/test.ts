import {
  assertEquals,
} from "https://deno.land/std@0.73.0/testing/asserts.ts";
import { AddPuRequest } from "../src/plurk/PlurkClient.ts";

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
