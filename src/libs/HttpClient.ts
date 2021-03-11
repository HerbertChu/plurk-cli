import ky from "https://deno.land/x/ky@v0.23.0/index.js";

export class HttpClient {
  public static instance(): any {
    return ky.create();
  }
}
