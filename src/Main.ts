import { StdinReader } from "./libs/StdinReader.ts";
import { PlurkClient } from "./plurk/PlurkClient.ts";
export class PlurkCli {
  public static async input(): Promise<string> {
    const stdin: string = await StdinReader.read();
    return Promise.resolve(stdin);
  }
  public static async send(content: string): Promise<string> {
    console.log(content);
    let plurkClient = new PlurkClient();
    plurkClient.add2Timeline(content);
    return Promise.resolve(content);
  }
}

PlurkCli
  .input()
  .then((content) => PlurkCli.send(content));
