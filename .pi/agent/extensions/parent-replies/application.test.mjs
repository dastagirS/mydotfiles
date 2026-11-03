import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const TIMEOUT_MS = 60000;
const OUTPUT_BYTES_MAX = 1048576;
test('actual offline Pi CLI autodiscovery, pointer/keyboard, compacted history, draft, reload and unchanged session log',{timeout:TIMEOUT_MS},()=>{
 const result=spawnSync('python3',[fileURLToPath(new URL('./application.test.py',import.meta.url))],{encoding:'utf8',timeout:TIMEOUT_MS,maxBuffer:OUTPUT_BYTES_MAX});
 assert.ifError(result.error);
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/actual session file unchanged/);
 console.log(result.stdout.trim());
});
