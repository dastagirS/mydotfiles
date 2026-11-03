import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectReplies, LIMITS } from './model.mjs';

const answer = (id, text, extra = {}) => ({type:'message',id,message:{role:'assistant',stopReason:'stop',timestamp:id,provider:'fixture',model:'local',content:[{type:'text',text}],...extra}});

test('indexes every parent final independently, not worker/custom/tool/progress/error/empty replies', () => {
 const branch=[{type:'message',id:'human',message:{role:'user',content:'Build dashboard'}},answer('first','Started'),{type:'custom_message',id:'worker',customType:'board-updates',content:'Worker result'},answer('progress','Checking',{stopReason:'toolUse'}),answer('error','Failed',{stopReason:'error'}),answer('aborted','Partial',{stopReason:'aborted'}),answer('empty','   '),answer('last','Verified result')];
 const result=collectReplies(branch,new Set(['last']));
 assert.deepEqual(result.replies.map(reply=>reply.id),['first','last']);
 assert.equal(result.replies[0].archived,true);assert.equal(result.replies[1].archived,false);
 assert.equal(result.replies[1].question,'Build dashboard');
 assert.equal(result.replies[0].message,branch[1].message);
 assert.equal(result.replies[1].message,branch.at(-1).message);
});
test('honors replacement/deletion edits without resurrecting removed or original secret text', () => {
 const branch=[answer('replace','Original private text'),answer('delete','Removed text'),{type:'context_edit',id:'edit-one',targetId:'replace',replacement:{content:'Replacement only'}},{type:'context_edit',id:'edit-two',targetId:'delete',replacement:null}];
 const result=collectReplies(branch,new Set());
 assert.equal(result.replies.length,1);assert.equal(result.replies[0].text,'Replacement only');
 assert.ok(!JSON.stringify(result).includes('Original private text'));assert.ok(!JSON.stringify(result).includes('Removed text'));
});
test('a deleted question does not borrow an earlier question for its answer preview', () => {
 const branch=[{type:'message',id:'first-user',message:{role:'user',content:'Earlier question'}},answer('first','First answer'),{type:'message',id:'deleted-user',message:{role:'user',content:'Deleted question'}},answer('second','Second answer'),{type:'context_edit',id:'edit',targetId:'deleted-user',replacement:null}];
 assert.equal(collectReplies(branch,new Set()).replies[1].question,'');
});
test('retains compacted saved finals, never relies on matching nearby human prompts', () => {
 const old=answer('old','Earlier final');const recent=answer('recent','Recent final');
 const result=collectReplies([old,{type:'compaction',id:'compact'},recent],new Set(['compact','recent']));
 assert.equal(result.replies[0].archived,true);assert.equal(result.replies[1].archived,false);
 assert.deepEqual(result.replies.map(reply=>({id:reply.id,text:reply.text})),[{id:'old',text:'Earlier final'},{id:'recent',text:'Recent final'}]);
 assert.equal(result.replies[1].message,recent.message);
});
test('keeps distinct final text blocks separated in saved display and preview', () => {
 const result=collectReplies([answer('parts','unused',{content:[{type:'text',text:'First block'},{type:'thinking',thinking:'Not displayed'},{type:'text',text:'Second block'}]})],new Set());
 assert.equal(result.replies[0].text,'First block\n\nSecond block');
});
test('rejects malformed identity fields and terminal-control IDs', () => {
 assert.equal(collectReplies([answer('bad','Answer',{timestamp:{nested:'invalid'}})],new Set()).replies.length,0);
 assert.equal(collectReplies([answer('\u001b]52;invalid','Answer')],new Set()).replies.length,0);
});
test('bounds history/text and rejects nonfinal tool-bearing assistant blocks', () => {
 const result=collectReplies(Array.from({length:LIMITS.repliesMax+3},(_,index)=>answer(String(index),'Result '+index)),new Set());
 assert.equal(result.replies.length,LIMITS.repliesMax);assert.equal(result.limited,true);assert.equal(result.replies[0].id,'3');
 assert.equal(collectReplies([answer('tool','Text',{content:[{type:'text',text:'Text'},{type:'toolCall',id:'call'}]})],new Set()).replies.length,0);
 const oversized=collectReplies([answer('large','x'.repeat(LIMITS.textCharsMax+1))],new Set());assert.equal(oversized.limited,true);assert.equal(oversized.replies.length,0);
 assert.equal(collectReplies([{type:'message',id:'bad',message:null}],new Set()).replies.length,0);
});
