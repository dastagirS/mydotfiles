import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectReplies, LIMITS } from './model.mjs';
import { ReplyNavigator,Container,Text,TuiAltScreen,StdinBuffer,stripTerminalSequences,AssistantMessageComponent,getMarkdownTheme,themeModule,createChatViewport } from './test-runtime.mjs';
const theme=themeModule.theme;
const final=(id,text)=>({type:'message',id,message:{role:'assistant',api:'openai-completions',provider:'fixture',model:'fixture',stopReason:'stop',timestamp:id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},content:[{type:'text',text}]}});
function fixture(){
 const terminal={columns:100,rows:26,kittyProtocolActive:false,stdinBuffer:new StdinBuffer(),start(input){this.stdinBuffer.on('data',input);this.input=data=>this.stdinBuffer.process(data);},stop(){this.stdinBuffer.destroy();},write(){},drainInput:async()=>{},moveBy(){},hideCursor(){},showCursor(){},clearLine(){},clearFromCursor(){},clearScreen(){},setTitle(){},setProgress(){},setProgramStatus(){}};
 const tui=new TuiAltScreen(terminal);const keys=[];const editor={focused:false,render:()=>['UNSENT DRAFT'],invalidate(){},handleInput(value){keys.push(value);}};
 const chat=new Container();const document=new Container();document.addChild(new Text('SESSION HEADER',0,0));document.addChild(chat);
 const footer=new Text('NATIVE FOOTER · AGENT RAIL UNCHANGED',0,0);
 const viewport=createChatViewport({document,pendingMessages:new Container(),status:new Container(),editor,footer});
 tui.addChild(document);tui.addChild(editor);tui.addChild(footer);tui.setLayoutRoot(viewport.root);tui.setFocus(editor);tui.start();
 const warnings=[];const navigator=new ReplyNavigator(theme,message=>warnings.push(message));
 return {terminal,tui,keys,editor,chat,document,root:viewport.root,view:viewport.transcript,navigator,warnings};
}
function add(fixture,entry){fixture.chat.addChild(new AssistantMessageComponent(entry.message,true,getMarkdownTheme()));}
function screen(fixture){return fixture.tui.getScreenLines().map(stripTerminalSequences).join('\n');}

test('real Pi fullscreen renderer: command-only navigation, native/saved jumps, keyboard and unchanged dock', {timeout:10000},()=>{
 const f=fixture();const old=final('old','Old saved answer\n'+Array.from({length:50},(_,index)=>'Archived detail '+index).join('\n'));const current=final('current','CURRENT NATIVE ANSWER\n'+Array.from({length:35},(_,index)=>'Current detail '+index).join('\n'));
 const branch=[old,current];const before=JSON.stringify(branch);
 add(f,current);f.navigator.update(collectReplies(branch,new Set(['current'])),theme);
 const listenersBefore=f.terminal.stdinBuffer.listenerCount('data');
 try {
  assert.equal(f.navigator.attach(f.tui),true);f.tui.renderNow(true);
  assert.equal(f.terminal.stdinBuffer.listenerCount('data'),listenersBefore,'No raw input observer is installed');
  assert.equal(f.tui.layoutRoot,f.root);assert.equal(f.root.entries[0].component,f.view);
  assert.ok(screen(f).includes('NATIVE FOOTER'));assert.ok(screen(f).includes('UNSENT DRAFT'));
  assert.equal(f.navigator.jump('old'),true);f.tui.renderNow(true);assert.match(screen(f),/Old saved answer/);
  assert.equal(f.navigator.jump('current'),true);f.tui.renderNow(true);assert.match(screen(f),/CURRENT NATIVE ANSWER/);
  f.terminal.input('x');f.tui.renderNow(true);assert.deepEqual(f.keys,['x']);assert.equal(f.tui.hasOverlay(),false);
  f.navigator.openMenu();f.tui.renderNow(true);assert.equal(f.tui.hasOverlay(),true);
  f.terminal.input('\x1b[F');f.terminal.input('\r');f.tui.renderNow(true);assert.match(screen(f),/Old saved answer/);assert.equal(f.tui.hasOverlay(),false);
  assert.equal(f.tui.getFocusedComponent(),f.editor);assert.equal(JSON.stringify(branch),before,'Navigation must not modify session entries/model data');
  f.navigator.dispose();assert.equal(f.terminal.stdinBuffer.listenerCount('data'),listenersBefore,'Disposal must not alter native input listeners');assert.equal(f.tui.layoutRoot,f.root);assert.equal(f.view.child,f.document);
  f.terminal.input('y');assert.deepEqual(f.keys,['x','y']);assert.deepEqual(f.warnings,[]);
 } finally {f.navigator.dispose();f.tui.stop();}
});

test('real native compaction rebuild: old finals remain inline and exact, context edits refresh, foreign dialogs survive cleanup', {timeout:10000},()=>{
 const f=fixture();const old=final('old','ORIGINAL OLD FINAL\n'+Array.from({length:45},(_,index)=>'Old '+index).join('\n'));const recent=final('recent','KEPT RECENT FINAL\n'+Array.from({length:30},(_,index)=>'Kept '+index).join('\n'));
 add(f,old);add(f,recent);f.navigator.update(collectReplies([old,recent],new Set(['old','recent'])),theme);
 let dialog;
 try {
  assert.equal(f.navigator.attach(f.tui),true);f.tui.renderNow(true);assert.equal(f.navigator.jump('old'),true);f.tui.renderNow(true);
  f.chat.clear();add(f,recent);
  f.navigator.update(collectReplies([old,recent],new Set(['recent'])),theme);f.tui.renderNow(true);
  assert.match(screen(f),/ORIGINAL OLD FINAL/,'Compaction while reading a selected final must preserve that selected response in view');
  assert.equal(f.navigator.jump('old'),true);f.tui.renderNow(true);assert.match(screen(f),/Saved parent final/);
  const edited=[old,recent,{type:'context_edit',targetId:'old',replacement:{content:'REDACTED REPLACEMENT'}}];
  f.navigator.update(collectReplies(edited,new Set(['recent'])),theme);assert.equal(f.navigator.jump('old'),true);f.tui.renderNow(true);
  assert.match(screen(f),/REDACTED REPLACEMENT/);assert.ok(!screen(f).includes('ORIGINAL OLD FINAL'));
  const answers=[];dialog=f.tui.showOverlay({render:()=>['Foreign confirmation'],invalidate(){},handleInput(input){answers.push(input);}},{width:30});
  f.navigator.dispose();f.terminal.input('z');assert.deepEqual(answers,['z']);assert.equal(dialog.isFocused(),true);assert.equal(f.view.child,f.document);
 } finally {dialog?.hide();f.navigator.dispose();f.tui.stop();}
});

test('ambiguous or wrapped native rendering falls back to an explicit saved copy, never a text-prefix guess',()=>{
 const f=fixture();const entry=final('wrapped','EXACT SAVED COPY');f.chat.addChild(new Text('Unrelated visible content with similar words',0,0));
 f.navigator.update(collectReplies([entry],new Set(['wrapped'])),theme);
 try {assert.equal(f.navigator.attach(f.tui),true);f.tui.renderNow(true);assert.equal(f.navigator.jump('wrapped'),true);f.tui.renderNow(true);assert.match(screen(f),/EXACT SAVED COPY/);assert.equal(f.navigator.jump('absent'),false);}finally{f.navigator.dispose();f.tui.stop();}
});

test('command-only navigation adds no sidebar, gutter, passive hover or input observer',()=>{
 const f=fixture();const replies=Array.from({length:100},(_,index)=>final(`reply-${index}`,`Reply ${index}`));
 f.navigator.update(collectReplies(replies,new Set(replies.map(reply=>reply.id))),theme);
 try{
  f.tui.renderNow(true);const width=f.view.getContentWidth(f.terminal.columns);const listeners=f.terminal.stdinBuffer.listenerCount('data');
  assert.equal(f.navigator.attach(f.tui),true);f.tui.renderNow(true);
  assert.equal(f.tui.layoutRoot,f.root);assert.equal(f.root.entries[0].component,f.view);
  assert.equal(f.view.getContentWidth(f.terminal.columns),width,'No columns should be reserved for a sidebar');
  assert.ok(!screen(f).includes('≡'));assert.equal(f.tui.hasOverlay(),false);
  f.terminal.input('\x1b[<35;99;12M');f.tui.renderNow(true);
  assert.equal(f.tui.hasOverlay(),false,'Mouse movement must not open passive reply UI');
  assert.equal(f.terminal.stdinBuffer.listenerCount('data'),listeners);
  f.navigator.openMenu();f.tui.renderNow(true);assert.match(screen(f),/Parent replies · 100/);
  f.terminal.input('q');assert.equal(f.tui.hasOverlay(),false);assert.equal(f.tui.getFocusedComponent(),f.editor);
 }finally{f.navigator.dispose();f.tui.stop();}
});

test('history clipping is visible inside the reply browser without warning notifications',()=>{
 const f=fixture();const replies=Array.from({length:LIMITS.repliesMax+1},(_,index)=>final(`reply-${index}`,`Reply ${index}`));
 f.navigator.update(collectReplies(replies,new Set(replies.map(reply=>reply.id))),theme);
 try{
  assert.equal(f.navigator.attach(f.tui),true);f.tui.renderNow(true);assert.equal(f.tui.hasOverlay(),false);assert.deepEqual(f.warnings,[]);
  f.navigator.openMenu();f.tui.renderNow(true);assert.match(screen(f),/Parent replies · 512 · limited/);
  const top=f.view.scrollTop;const before=screen(f);
  for(let index=0;index<2;index+=1){f.terminal.input('\x1b[<65;60;5M');f.tui.renderNow(true);}
  assert.equal(f.view.scrollTop,top,'Wheel navigation in the list must not move the transcript');
  assert.notEqual(screen(f),before,'The reply list must scroll through older entries');
  assert.deepEqual(f.warnings,[]);
 }finally{f.navigator.dispose();f.tui.stop();}
});
