import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPi } from "../src/runner.ts";

test("runner selects final assistant and sums per-turn usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-runner-")); const script = join(dir, "fake.mjs");
  await writeFile(script, `for (let i=1;i<=2;i++) console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'turn '+i}],model:'fake',stopReason:'stop',usage:{input:i,output:2,cacheRead:3,cacheWrite:4,cost:{total:.1}}}}));`);
  const run = await runPi([], { cwd: dir, invocation: { command: process.execPath, args: [script] } });
  assert.equal(run.text, "turn 2"); assert.equal(run.turns.length, 2); assert.equal(run.usage.input, 3); assert.equal(run.usage.cacheRead, 6);
});

test("runner passes extension-controlled child environment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-env-")); const script = join(dir, "fake.mjs");
  await writeFile(script, `console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:process.env.PI_SCOUT_CHECKPOINT_PATH}],stopReason:'stop',usage:{}}}));`);
  const run = await runPi([], { cwd: dir, invocation: { command: process.execPath, args: [script] }, env: { PI_SCOUT_CHECKPOINT_PATH: "controlled" } });
  assert.equal(run.text, "controlled");
});

test("runner exposes child tool activity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-activity-")); const script = join(dir, "fake.mjs");
  await writeFile(script, `console.log(JSON.stringify({type:'tool_execution_start',toolCallId:'1',toolName:'read',args:{path:'a.ts'}})); console.log(JSON.stringify({type:'tool_execution_end',toolCallId:'1',toolName:'read',result:{content:[{type:'text',text:'source'}]},isError:false})); console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'done'}],stopReason:'stop',usage:{}}}));`);
  const seen: string[] = [];
  const run = await runPi([], { cwd: dir, invocation: { command: process.execPath, args: [script] }, onActivity: item => seen.push(`${item.kind}:${item.tool}`) });
  assert.deepEqual(seen, ["call:read", "result:read"]);
  assert.equal(run.activity[1]?.text, "source");
});

test("runner bounds activity history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-activity-cap-"));
  const script = join(dir, "fake.mjs");
  await writeFile(script, `for(let i=0;i<120;i++) console.log(JSON.stringify({type:'tool_execution_start',toolName:'read',args:{path:String(i)}})); console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'done'}],stopReason:'stop',usage:{}}}));`);
  const run = await runPi([], {
    cwd: dir,
    invocation: { command: process.execPath, args: [script] },
  });
  assert.equal(run.activity.length, 100);
});

test("runner aborts oversized protocol lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-overflow-"));
  const script = join(dir, "fake.mjs");
  await writeFile(script, `process.stdout.write('x'.repeat(1024*1024+1)); setTimeout(()=>{},10000);`);
  const run = await runPi([], {
    cwd: dir,
    invocation: { command: process.execPath, args: [script] },
    timeoutMs: 5000,
  });
  assert.equal(run.error, "Scout protocol output exceeded 1 MiB.");
});
