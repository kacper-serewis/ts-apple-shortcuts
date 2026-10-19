import { showResult } from "@js-shortcuts/ios";

function flags(input: string, needle: string, position: number): string {
  const contains=input.includes(needle,position)?"Y":"N";
  const starts=input.startsWith(needle,position)?"Y":"N";
  const ends=input.endsWith(needle,position)?"Y":"N";
  return `${contains}${starts}${ends}`;
}

export default async function main(): Promise<void> {
  for(const needle of ["😀", ""]) {
    let results="";
    for(const position of [-1.8,0,1,2,3,100]) { results+=`${flags("😀a😀",needle,position)};`; }
    await showResult(`${needle===""?"Empty":"Emoji"}: ${results}`);
  }
  let input="😀a😀",needle="😀";
  const captured=input.startsWith(needle,[1].reduce((acc,n)=>{input="changed";needle="z";return 3;},0));
  await showResult(`Snapshot: ${captured?"Y":"N"}/${input}/${needle}`);
}
