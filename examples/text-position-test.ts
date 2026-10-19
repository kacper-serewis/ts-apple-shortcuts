import { showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const lengths=["", "abc", "é", "😀", "👨‍👩‍👧‍👦", "🇳🇱", "👍🏽", "\r\n"].map(text=>text.length);
  await showResult(`Lengths: ${lengths.join(",")}`);
  await showResult(`Offsets: ${"aaaa".indexOf("aa")}/${"aaaa".indexOf("aa",1)}/${"abc".indexOf("z")}`);
  let positions="";
  for(const start of [-2.9,1,2,3,100]) {
    positions+=`${"😀a😀b".indexOf("😀",start)}:${"😀a😀b".indexOf("",start)};`;
  }
  await showResult(`Positions: ${positions}`);
  await showResult(`Literal: ${"x.*[]\\$y".indexOf(".*[]\\$")}; exact ${"é é".indexOf("é")}; combining ${"é".indexOf("́")}`);
  let input="😀a😀",needle="😀";
  const found=input.indexOf(needle,[1].reduce((acc,n)=>{input="changed";needle="z";return 1;},0));
  await showResult(`Snapshot: ${found}/${input}/${needle}; length ${"😀".length}`);
}
