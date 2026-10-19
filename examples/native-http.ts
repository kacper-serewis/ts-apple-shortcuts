import { native, text, dictionary, showResult } from "@js-shortcuts/ios";

// Compile-only example. This POST is not sent during compilation.
interface CreatedPost { title: string }
export default async function main(): Promise<void> {
  const title = "Geschreven in TypeScript";
  const post = await native<CreatedPost>("is.workflow.actions.downloadurl", {
    WFURL: text("https://jsonplaceholder.typicode.com/posts"),
    WFHTTPMethod: "POST",
    WFHTTPBodyType: "JSON",
    WFHTTPHeaders: dictionary({ "Content-Type": "application/json" }),
    WFJSONValues: dictionary({ title, body: "Native Shortcuts", userId: 1 }),
  });
  await showResult(post.title);
}
