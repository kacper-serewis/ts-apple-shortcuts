import { getJson, showResult } from "@js-shortcuts/ios";

interface Todo { title: string }
interface User { address: { city: string } }

export default async function main(): Promise<void> {
  const base = "https://jsonplaceholder.typicode.com";
  const todo = await getJson<Todo>(`${base}/todos/1`);
  await showResult(`GET: ${todo.title}`);

  const todos = await getJson<readonly Todo[]>(`${base}/todos?_limit=2`);
  for (const item of todos) {
    if (item.title === "delectus aut autem") {
      await showResult(`IF: ${item.title}`);
    } else {
      await showResult(`ELSE: ${item.title}`);
    }
  }

  const user = await getJson<User>(`${base}/users/1`);
  await showResult(`GENEST: ${user.address.city}`);
}
