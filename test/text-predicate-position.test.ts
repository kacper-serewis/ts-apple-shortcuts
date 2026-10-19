import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult } from "@js-shortcuts/ios"; ${helpers}
export default async function main() { ${body} }`;
const methods = ["includes", "startsWith", "endsWith"] as const;
const pairs = [["", ""], ["", "a"], ["abc", ""], ["abcabc", "bc"], ["aaaa", "aa"], ["Aba", "a"],
  ["x.*[]\\$y.*[]\\$", ".*[]\\$"], ["x\ny\n", "\n"], ["😀a😀", "😀"], ["😀a😀", ""],
  ["éé", "́"], ["é é", "é"], ["👨‍👩‍👧‍👦!", "!"], ["abc", "abcd"], ["abc", "missing"], ["JS:JS:", "JS:"]];
const positions = [-100,-1.8,-0.8,0,0.8,1,1.9,2,2.9,3,4,5,6,11,100];

test("positional text predicates agree with JS across runtime UTF-16 positions", () => {
  for (const [input,needle] of pairs) {
    assert.deepEqual(evaluate(source(`let input=${JSON.stringify(input)}, needle=${JSON.stringify(needle)};
      for (const position of ${JSON.stringify(positions)}) {
        ${methods.map(method=>`await showResult(input.${method}(needle,position)?"Y":"N");`).join("\n")}
      }`)), positions.flatMap(position=>methods.map(method=>input[method](needle,position)?"Y":"N")), JSON.stringify([input,needle]));
  }
});

test("literal positions retain truncation and clamping semantics", () => {
  const inputs = [["abcabc","bc"], ["😀a😀","😀"], ["😀",""], ["",""], ["abc","abcd"]];
  const starts = [-1.8,0,0.8,1,2.9,100];
  for(const [input,needle] of inputs) {
    const calls=starts.flatMap(position=>methods.map(method=>`await showResult(${JSON.stringify(input)}.${method}(${JSON.stringify(needle)},${position})?"Y":"N");`));
    assert.deepEqual(evaluate(source(calls.join("\n"))), starts.flatMap(position=>methods.map(method=>input[method](needle,position)?"Y":"N")));
  }
});

test("positional predicates evaluate receiver, search and position exactly once in order", () => {
  for(const method of methods) for(const needle of ["", "missing"]) {
    assert.deepEqual(evaluate(source(`await showResult((await text("input")).${method}(await text(${JSON.stringify(needle)}),await position())?"Y":"N");`,
      'async function text(value:string):Promise<string>{await showResult(value);return value;} async function position():Promise<number>{await showResult("position");return 2;}')),
    ["input",needle,"position",needle===""?"Y":"N"]);
  }
});

test("later position effects cannot change captured receiver and needle", () => {
  for(const method of methods) {
    assert.deepEqual(evaluate(source(`let input="😀a😀",needle="😀";
      const result=input.${method}(needle,[1].reduce((acc,n)=>{input="changed";needle="z";return 3;},0));
      await showResult(result?"Y":"N");await showResult(input);await showResult(needle);`)),
    [method==="endsWith"?"N":"Y","changed","z"]);
  }
});

test("predicate helpers reset state and compose with short-circuit conditions", () => {
  assert.deepEqual(evaluate(source(`await showResult([0,1,2,3,100].map(position=>check(position)).join(","));
    if("😀a😀".includes("😀",1) && !"😀a😀".startsWith("😀",1) && "😀a😀".endsWith("😀",2)) {await showResult("yes");}`,
    'function check(position:number):string{return "😀a😀".startsWith("😀",position)?"Y":"N";}')), ["Y,N,N,Y,N","yes"]);
});

test("positional string includes remains separate from negative array offsets", () => {
  assert.deepEqual(evaluate(source('await showResult("abc".includes("a",-1)?"Y":"N"); await showResult(["a","b","c"].includes("a",-1)?"Y":"N");')),["Y","N"]);
});

test("native positional predicate example matches intended results", () => {
  assert.deepEqual(evaluate(readFileSync(new URL("../../examples/text-predicate-position-test.ts",import.meta.url),"utf8")), [
    "Emoji: YYN;YYN;YNN;YNY;YYN;NNY;",
    "Empty: YYY;YYY;YYY;YYY;YYY;YYY;",
    "Snapshot: Y/changed/z",
  ]);
});

for(const method of methods) {
  for(const [args,error] of [
    ['"a","1"',/number/], ['"a",true',/number/], ['"a",0,1',/optional numeric position/],
    ['1,0',/arguments must be text/], ['/a/,0',/Unsupported/],
  ] as const) test(`reject unsupported ${method} positional arguments: ${args}`,()=>assert.throws(()=>compile(source(`"abc".${method}(${args});`)),error));
}
