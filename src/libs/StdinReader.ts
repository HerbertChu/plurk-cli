export class StdinReader {
  public static async read(): Promise<string> {
    const data = await Deno.readAll(Deno.stdin);
    return Promise.resolve(new TextDecoder().decode(data));
  }
}
