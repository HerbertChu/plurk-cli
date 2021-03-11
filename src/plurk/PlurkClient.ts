import { HttpClient } from "../libs/HttpClient.ts";

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
  public add2Timeline(content: string, qulifier = "says"): void {
    let pu: AddPuRequest = new AddPuRequest();
    pu.content = content;
    pu.qualifier = qulifier;
    console.log(JSON.stringify(pu));
    let httpClient = HttpClient.instance();
    httpClient.post("https://www.plurk.com/APP/Timeline/plurkAdd", pu);
  }
}
