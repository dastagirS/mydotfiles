import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectReplies } from './model.mjs';
import { ReplyNavigator,Container,Text,TuiAltScreen,stripTerminalSequences,AssistantMessageComponent,getMarkdownTheme,themeModule as theme,createChatViewport } from './test-runtime.mjs';
test('jump lands on the final body, not expanded thinking above it',()=>{
 const terminal={columns:90,rows:24,kittyProtocolActive:false,start(){},stop(){},write(){},drainInput:async()=>{},moveBy(){},hideCursor(){},showCursor(){},clearLine(){},clearFromCursor(){},clearScreen(){},setTitle(){},setProgress(){},setProgramStatus(){}};
 const message={role:'assistant',stopReason:'stop',timestamp:4,provider:'fixture',model:'fixture',content:[{type:'thinking',thinking:Array.from({length:80},(_,index)=>'Thinking line '+index).join('\n')},{type:'text',text:'ACTUAL FINAL BODY'}]};
 const document=new Container();document.addChild(new AssistantMessageComponent(message,false,getMarkdownTheme()));
 const viewport=createChatViewport({document,pendingMessages:new Container(),status:new Container(),editor:new Text('DRAFT',0,0),footer:new Text('FOOTER',0,0)});
 const tui=new TuiAltScreen(terminal);tui.setLayoutRoot(viewport.root);tui.start();const warnings=[];const navigator=new ReplyNavigator(theme.theme,text=>warnings.push(text));
 try{
  navigator.update(collectReplies([{type:'message',id:'answer',message}],new Set(['answer'])),theme.theme);assert.equal(navigator.attach(tui),true);tui.renderNow(true);
  assert.equal(navigator.jump('answer'),true);tui.renderNow(true);const screen=tui.getScreenLines().map(stripTerminalSequences).join('\n');
  assert.match(screen,/ACTUAL FINAL BODY/,'The selected answer body must be visible immediately');assert.deepEqual(warnings,[]);
 }finally{navigator.dispose();tui.stop();}
});
