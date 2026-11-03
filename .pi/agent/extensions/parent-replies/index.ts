import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { collectReplies, LIMITS } from './model.mjs';
import { ReplyNavigator } from './view';

const WIDGET_KEY='parent-replies';
const UPDATE_DELAY_MS=50;

export default function parentReplies(pi:ExtensionAPI):void {
 let navigator:ReplyNavigator|undefined;
 let context:ExtensionContext|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;
 let leaf:string|null|undefined;
 let active=false;
 const warnings=new Set<string>();
 const warn=(message:string)=>{if(!warnings.has(message)){warnings.add(message);try{context?.ui.notify(message,'warning');}catch{console.error('[parent-replies] UI notice unavailable.');}}};
 const dispose=()=>{
  active=false;if(timer)clearTimeout(timer);timer=undefined;
  navigator?.dispose();navigator=undefined;context=undefined;leaf=undefined;warnings.clear();
 };
 const refresh=(current:ExtensionContext)=>{
  if(!active||!current.hasUI||current.mode!=='tui')return false;
  context=current;
  try {
   const branch=current.sessionManager.getBranch();
   const visible=new Set(current.sessionManager.buildContextEntries().slice(-LIMITS.branchEntriesMax).map(entry=>entry.id));
   const snapshot=collectReplies(branch,visible);
   if(!navigator){
    navigator=new ReplyNavigator(current.ui.theme,warn,()=>context?refresh(context):false);navigator.update(snapshot,current.ui.theme);
    current.ui.setWidget(WIDGET_KEY,(tui)=>{
     const mounted=navigator;
     if(!mounted)return {render:()=>[],invalidate(){}};
     mounted.attach(tui);
     let mode=tui.mode;
     return {render:()=>{
      if(mode!==tui.mode){mode=tui.mode;schedule(current);}
      const nextLeaf=current.sessionManager.getLeafId();
      if(nextLeaf!==leaf){leaf=nextLeaf;const entry=nextLeaf?current.sessionManager.getEntry(nextLeaf):undefined;if(entry?.type==='context_edit')schedule(current);}
      return [];
     },invalidate(){},dispose:()=>mounted.dispose()};
    },{placement:'aboveEditor'});
   } else {navigator.syncLayout();navigator.update(snapshot,current.ui.theme);}
   leaf=current.sessionManager.getLeafId();
   return true;
  } catch {warn('Parent reply history disabled after a refresh failure; reload after correcting the session/layout. Conversation state was not changed.');navigator?.dispose();return false;}
 };
 const schedule=(current:ExtensionContext)=>{
  if(!active)return;
  context=current;
  if(timer)return;
  timer=setTimeout(()=>{timer=undefined;if(active&&context)refresh(context);},UPDATE_DELAY_MS);
  timer.unref();
 };
 pi.registerCommand('replies',{description:'Browse parent final responses without changing model context',handler:async (_arguments,current)=>{refresh(current);if(current.hasUI&&current.mode==='tui')navigator?.openMenu();else current.ui.notify('Parent replies are available in Pi fullscreen interactive mode.','warning');}});
 pi.on('session_start',(_event,current)=>{dispose();active=current.hasUI&&current.mode==='tui';if(active)refresh(current);});
 pi.on('session_shutdown',dispose);
 pi.on('turn_end',(event,current)=>{if(event.message.role==='assistant'&&event.message.stopReason==='stop')schedule(current);});
 pi.on('agent_end',(_event,current)=>schedule(current));
 pi.on('session_compact',(_event,current)=>schedule(current));
 pi.on('session_tree',(_event,current)=>schedule(current));
}
