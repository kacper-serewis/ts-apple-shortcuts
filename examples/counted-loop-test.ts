import { showResult } from "@js-shortcuts/ios";

function range(start:number,end:number,step:number):string {
  let result="";
  for(let i=start;i<end;i+=step) {result+=`${i},`;}
  return result;
}

function find(value:number):number {
  for(let i=0;i<4;i++) {if(i===0) {continue;} if(value===2) {break;} if(i===value) {return i*10;}}
  return -1;
}

export default async function main():Promise<void> {
  let down="";
  for(let i=5;i>=1;i-=2) {down+=`${i},`;}
  await showResult(`Ranges: ${range(0,7,2)}|${down}|${range(4,2,1)}`);
  let trace="", switches="";
  for(let i=0;i<7;i++) {if(i===1) {continue;} if(i===5) {break;} trace+=`${i},`;}
  for(let i=0;i<4;i++) {switch(i) {case 0:switches+="zero";break;case 1:continue;default:switches+=`${i}`;}switches+=";";}
  await showResult(`Control: ${trace}; ${switches}`);
  let nested="";
  for(let a=1;a<=3;a++) {
    for(let b=1;b<=3;b++) {if(b===2) {continue;} if(a===2) {break;} nested+=`${a}${b},`;}
    nested+=`end${a};`;
  }
  await showResult(`Nested: ${nested}`);
  let i=9;
  await showResult(`Helpers: ${[1,2,3].map(n=>find(n)).join(",")}; scope ${i}`);
}
