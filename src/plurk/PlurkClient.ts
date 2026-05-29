import { PlurkOAuth } from "./PlurkOAuth.ts";

export class AddPuRequest {
  content!: string;
  qualifier!: string;
  limited_to: string[] = [];
  excluded!: string;
  no_comments: number = 0;
  lang: string = "en";
  replurkable: number = 1;
  porn: number = 0;
  publish_to_followers: number = 1;
  publish_to_ananymous: number = 1;
}

export class PlurkClient {
  constructor(private readonly oauth: PlurkOAuth) {}

  /** Post a plurk to the timeline via a signed Plurk API call. */
  public add2Timeline(content: string, qualifier = "says"): Promise<Response> {
    const pu = new AddPuRequest();
    pu.content = content;
    pu.qualifier = qualifier;
    return this.oauth.request("/APP/Timeline/plurkAdd", {
      content: pu.content,
      qualifier: pu.qualifier,
      lang: pu.lang,
      no_comments: String(pu.no_comments),
    });
  }
}
