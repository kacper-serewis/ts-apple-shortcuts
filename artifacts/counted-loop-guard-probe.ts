import { showResult } from "@js-shortcuts/ios";

async function run(step:number):Promise<void> {
  for(let i=0;i<3;i+=step) {await showResult("ERROR: invalid loop body ran");}
}

export default async function main():Promise<void> {
  await run(0);
  await showResult("ERROR: invalid range did not stop");
}
