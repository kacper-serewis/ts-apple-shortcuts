import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";
const source = (body: string, helpers = "") => `import { showResult, askNumber, input } from "@js-shortcuts/ios"; ${helpers}
export default async function main() { ${body} }`;

test("while reevaluates changing bounds and restores state before the continuation", () => {
  assert.deepEqual(evaluate(source(`let n=0;let end=5;let trace="";
    while(n<end) { trace+=\`\${n},\`;n++;end--; } await showResult(trace);await showResult(n);await showResult(end);`)), ["0,1,2,",3,2]);
});
test("while skips false bodies, preserves const snapshots and evaluates effectful conditions", () => {
  assert.deepEqual(evaluate(source(`let n=0;const snapshot=n;
    while(n<0) {await showResult("bad");} while((await askNumber("next"))>0) {n++;}
    await showResult(n);await showResult(snapshot);`),[2,1,0]), [2,0]);
});
test("while continue, switch breaks and nested loop jumps have separate targets", () => {
  assert.deepEqual(evaluate(source(`let n=0;let trace="";while(true) {
    n++;if(n===4) {break;} let j=0;while(j<3) {j++;if(j===2) {continue;}trace+=\`\${n}\${j},\`;}
    switch(n) {case 1:continue;case 2:trace+="two";break;default:trace+="three";}trace+=";";
  } await showResult(trace);await showResult(n);`)), ["11,13,21,23,two;31,33,three;",4]);
});
test("while inside counted and list loops preserves iteration values and outer jumps", () => {
  assert.deepEqual(evaluate(source(`let trace="";for(const a of [2,3]) {for(let b=0;b<2;b++) {
    let n=0;while(n<a) {n++;if(n===2) {break;}trace+=\`\${a}/\${b}/\${n};\`;}
  }}await showResult(trace);`)), ["2/0/1;2/1/1;3/0/1;3/1/1;"]);
});
test("while state round trips empty/singleton lists, objects, booleans and Unicode", () => {
  assert.deepEqual(evaluate(source(`let items:number[]=[];let obj={label:"😀",values:[1]};let active=true;
    while(active) {items=items.concat(obj.values);obj={label:obj.label+"!",values:[]};active=false;}
    await showResult(JSON.stringify(items));await showResult(JSON.stringify(obj));await showResult(JSON.stringify(active));`)), ["[1]",'{"label":"😀!","values":[]}',"false"]);
});
test("helpers can contain while and be called inside while without sharing locals", () => {
  assert.deepEqual(evaluate(source(`let n=0;let sum=0;while(n<3) {sum+=walk(n);n++;}await showResult(sum);`,
    `function walk(limit:number):number {let n=0;let result=0;while(n<limit) {n++;result+=n;}return result;}`)), [4]);
});
test("while captures callback writes and respects lexical shadowing", () => {
  assert.deepEqual(evaluate(source(`let n=0;let total=0;while(n<2) {[1].forEach(x=>{total+=x;});{let n=10;n++;total+=n;}n++;}await showResult(total);`)), [24]);
});
test("while native lowering has self calls, source maps and no bounded repeat", () => {
  const {workflow,sourceMap}=compile(source(`let n=0;while(n<3) {n++;}await showResult(n);`),{name:"While Probe"});
  const actions=workflow.WFWorkflowActions;
  assert.ok(actions.some(a=>a.WFWorkflowActionIdentifier.endsWith(".runworkflow")));
  assert.ok(!actions.some(a=>a.WFWorkflowActionIdentifier.endsWith(".repeat.count")));
  for(const a of actions.filter(a=>a.WFWorkflowActionIdentifier.endsWith(".runworkflow"))) {
    assert.deepEqual(a.WFWorkflowActionParameters.WFWorkflow,{workflowName:"While Probe"});
    assert.equal((a.WFWorkflowActionParameters.WFInput as { WFSerializationType: string }).WFSerializationType,"WFTextTokenAttachment");
  }
  for(const a of actions.filter(a=>a.WFWorkflowActionIdentifier.endsWith(".output"))) {
    assert.equal((a.WFWorkflowActionParameters.WFOutput as { WFSerializationType: string }).WFSerializationType,"WFTextTokenString");
  }
  assert.equal(sourceMap.length,actions.length);
  assert.equal(workflow.WFWorkflowHasShortcutInputVariables,true);
});
for(const body of [`while(true) {return;}`,`while(true) {const data=input<string>();break;}`]) {
  test(`diagnose unsupported while boundary: ${body}`,()=>assert.throws(()=>compile(source(body)),/while loop/));
}

test("while rejects opaque native state, including nested containers", () => {
  for (const type of ["NativeContent", "NativeContent[]", "{ file: NativeContent }"]) {
    assert.throws(() => compile(`import { input, type NativeContent } from "@js-shortcuts/ios";
      export default async function main() {const data=input<${type}>();while(true) {const alias=data;break;}}`), /state 'data' must be JSON-compatible/);
  }
});
test("while conditions short-circuit and helper conditions may own their own loops", () => {
  assert.deepEqual(evaluate(source(`let n=0;while(n<2 && test(n)) {n++;}await showResult(n);`,
    `function test(n:number):boolean {let i=0;while(i<n) {i++;}return i<3;}`)), [2]);
});
test("sequential while calls restore state independently and callbacks keep local returns", () => {
  assert.deepEqual(evaluate(source(`let n=0;let trace="";while(n<2) {[1,2].forEach(x=>{if(x===1) {return;}trace+=\`\${x}\`;});n++;}
    while(n>0) {trace+=\`\${n}\`;n--;}await showResult(trace);`)), ["2221"]);
});
