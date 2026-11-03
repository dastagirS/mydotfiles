import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS } from './model.mjs';
import { replies,themeModule } from './test-runtime.mjs';

function fixture(branch,renderWidget=false){
 const handlers=new Map(),commands=new Map(),notices=[];let inputSubscriptions=0;
 replies({on(name,handler){handlers.set(name,handler);},registerCommand(name,command){commands.set(name,command);}});
 const context={hasUI:true,mode:'tui',sessionManager:{getBranch:()=>branch,buildContextEntries:()=>branch,getLeafId:()=>branch.at(-1)?.id??null,getEntry:id=>branch.find(entry=>entry.id===id)},ui:{theme:themeModule.theme,notify(message){notices.push(message);},setWidget(_name,factory){if(renderWidget)factory({mode:'regular'});},onTerminalInput(){inputSubscriptions+=1;return ()=>{};}}};
 return {handlers,commands,notices,context,inputSubscriptions:()=>inputSubscriptions};
}

test('limited history stays quiet on start/resume without passive input subscriptions',()=>{
 const branch=Array.from({length:LIMITS.repliesMax+1},(_,index)=>({type:'message',id:String(index),message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'Final '+index}]}}));
 const f=fixture(branch);
 try{
  f.handlers.get('session_start')({reason:'startup'},f.context);
  f.handlers.get('session_start')({reason:'resume'},f.context);
  assert.deepEqual(f.notices,[],'Normal bounded-history clipping must not create startup warnings');
  assert.equal(f.inputSubscriptions(),0,'Command-only navigation must not install terminal input listeners');
  assert.ok(f.commands.has('replies'));
 }finally{f.handlers.get('session_shutdown')();}
});

test('unsupported layout is quiet until /replies is explicitly opened',async()=>{
 const f=fixture([],true);
 try{
  f.handlers.get('session_start')({},f.context);
  assert.deepEqual(f.notices,[],'Passive startup must not warn about an unused command');
  await f.commands.get('replies').handler('',f.context);
  assert.equal(f.notices.length,1);
  assert.match(f.notices[0],/fullscreen/);
 }finally{f.handlers.get('session_shutdown')();}
});
