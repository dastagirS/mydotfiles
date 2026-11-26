import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectReplies } from './model.mjs';
import { ReplyNavigator,Container,Text,TuiAltScreen,TuiMainScreen,StdinBuffer,stripTerminalSequences,AssistantMessageComponent,getMarkdownTheme,themeModule,createChatViewport,createInteractiveTuiReference } from './test-runtime.mjs';
function setup(){
 const terminal={columns:100,rows:26,kittyProtocolActive:false,start(input){this.stdinBuffer=new StdinBuffer();this.stdinBuffer.on('data',input);this.input=data=>this.stdinBuffer.process(data);},stop(){this.stdinBuffer.destroy();},write(){},drainInput:async()=>{},moveBy(){},hideCursor(){},showCursor(){},clearLine(){},clearFromCursor(){},clearScreen(){},setTitle(){},setProgress(){},setProgramStatus(){}};
 const chat=new Container(),editor=new Text('DRAFT',0,0),document=new Container();document.addChild(chat);
 const viewport=createChatViewport({document,pendingMessages:new Container(),status:new Container(),editor,footer:new Text('FOOTER',0,0)});
 let current=new TuiAltScreen(terminal);current.setLayoutRoot(viewport.root);current.setFocus(editor);current.start();
 const reference=createInteractiveTuiReference(()=>current);
 const warnings=[];const navigator=new ReplyNavigator(themeModule.theme,message=>warnings.push(message));
 return {terminal,chat,document,viewport,navigator,warnings,reference,get current(){return current;},replace(next){current.stop();current.setLayoutRoot?.(undefined);current=next;current.setLayoutRoot?.(viewport.root);current.setFocus(editor);current.start();}};
}
const entry=(id,text)=>({type:'message',id,message:{role:'assistant',stopReason:'stop',timestamp:7,provider:'fixture',model:'fixture',content:[{type:'text',text}]}});
const screen=f=>f.current.getScreenLines().map(stripTerminalSequences).join('\n');

test('ambiguous identical message objects get an ID-labelled saved copy rather than the first matching native block',()=>{
 const f=setup();const first=entry('first','Identical answer');const second={...first,id:'second'};
 for(const value of [first,second])f.chat.addChild(new AssistantMessageComponent(value.message,true,getMarkdownTheme()));
 f.navigator.update(collectReplies([first,second],new Set(['first','second'])),themeModule.theme);
 try{assert.equal(f.navigator.attach(f.reference),true);f.current.renderNow(true);assert.equal(f.navigator.jump('second'),true);f.current.renderNow(true);assert.match(screen(f),/Saved parent final · second/);}finally{f.navigator.dispose();f.current.stop();}
});
test('switching native renderer modes restores the original viewport then remounts cleanly without changing the dock',()=>{
 const f=setup();const value=entry('saved','SAVED AFTER MODE SWITCH');f.navigator.update(collectReplies([value],new Set()),themeModule.theme);
 try{
  assert.equal(f.navigator.attach(f.reference),true);f.current.renderNow(true);
  f.replace(new TuiMainScreen(f.terminal));const regularListeners=f.terminal.stdinBuffer.listenerCount('data');f.navigator.syncLayout();assert.equal(f.viewport.transcript.child,f.document);
  assert.equal(f.terminal.stdinBuffer.listenerCount('data'),regularListeners,'Regular mode must not attach an input observer');
  f.replace(new TuiAltScreen(f.terminal));const fullscreenListeners=f.terminal.stdinBuffer.listenerCount('data');f.navigator.syncLayout();f.current.renderNow(true);
  assert.equal(f.terminal.stdinBuffer.listenerCount('data'),fullscreenListeners);
  f.navigator.syncLayout();assert.equal(f.terminal.stdinBuffer.listenerCount('data'),fullscreenListeners,'Layout sync must not attach input observers');
  assert.equal(f.navigator.isMounted(),true);assert.equal(f.navigator.jump('saved'),true);f.current.renderNow(true);assert.match(screen(f),/SAVED AFTER MODE SWITCH/);assert.match(screen(f),/FOOTER/);
 }finally{f.navigator.dispose();f.current.stop();}
});
test('new finals do not force the reading viewport to bottom; removed list selection does not navigate a stale ID',()=>{
 const f=setup();const old=entry('old','OLD REPLY\n'+Array.from({length:45},(_,index)=>'Line '+index).join('\n'));
 f.navigator.update(collectReplies([old],new Set()),themeModule.theme);
 try{
  assert.equal(f.navigator.attach(f.reference),true);f.current.renderNow(true);assert.equal(f.navigator.jump('old'),true);f.current.renderNow(true);const top=f.viewport.transcript.scrollTop;
  const latest=entry('latest','LATEST REPLY');f.chat.addChild(new AssistantMessageComponent(latest.message,true,getMarkdownTheme()));
  f.navigator.update(collectReplies([old,latest],new Set(['latest'])),themeModule.theme);f.current.renderNow(true);assert.equal(f.viewport.transcript.scrollTop,top);
  f.navigator.openMenu();f.current.renderNow(true);f.terminal.input('\x1b[F');
  f.navigator.update(collectReplies([latest],new Set(['latest'])),themeModule.theme);f.current.renderNow(true);f.terminal.input('\r');f.current.renderNow(true);
  assert.match(screen(f),/LATEST REPLY/);assert.ok(!f.warnings.some(message=>message.includes('no longer')),'Menu must refresh stale selection safely');
 }finally{f.navigator.dispose();f.current.stop();}
});
