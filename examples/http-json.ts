import { getJson, showResult } from "@js-shortcuts/ios";

interface Todo {
  title: string;
}

export default async function main(): Promise<void> {
  const todo = await getJson<Todo>(
    "https://jsonplaceholder.typicode.com/todos/1"
  );
  await showResult(todo.title);
}
