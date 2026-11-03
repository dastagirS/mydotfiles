import { Container, Markdown, Text, matchesKey, truncateToWidth, stripTerminalSequences, type Component, type TUI, type OverlayHandle } from '@earendil-works/pi-tui';
import { getMarkdownTheme, VERSION, type Theme } from '@earendil-works/pi-coding-agent';
import { LIMITS } from './model.mjs';

type Reply = { id:string; text:string; question:string; archived:boolean; message:unknown };
type Snapshot = { replies:Reply[]; limited:boolean };
const SUPPORTED_PI_VERSIONS = new Set(['1.4.0','1.5.0']);
const MENU_ITEMS_MAX = 6;
const PREVIEW_CHARS_MAX = 640;
const REPLY_LABEL_CHARS = 8;

function safe(text:string):string { return stripTerminalSequences(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g,''); }
function summary(text:string):string { return safe(text.slice(0,PREVIEW_CHARS_MAX)).replace(/\s+/g,' ').replace(/^[#*>\s]+/,'').trim(); }

function nativeBodyRow(component:any,row:number,width:number):number|undefined {
 const parts=component.lastMessage.content;
 if(!Array.isArray(parts)||parts.length>LIMITS.contentPartsMax)return undefined;
 if(!parts.some((part:any)=>part?.type==='thinking'))return row;
 const body=parts.find((part:any)=>part?.type==='text'&&typeof part.text==='string'&&part.text.trim())?.text.trim();
 const children=component.contentContainer?.children;
 if(!body||!Array.isArray(children)||children.length>LIMITS.contentPartsMax||component.children?.length!==1||component.children[0]!==component.contentContainer)return undefined;
 let offset=0;let found:number|undefined;
 for(const child of children){
  if(typeof child?.render!=='function')return undefined;
  if(child.text===body){if(found!==undefined)return undefined;found=row+offset;}
  offset+=child.render(width).length;if(offset>LIMITS.renderRowsMax)return undefined;
 }
 return found;
}

export class ReplyNavigator {
 private tui:any;
 private theme:Theme;
 private originalRoot:any;
 private view:any;
 private originalDocument:any;
 private combined:Container|undefined;
 private snapshot:Snapshot={replies:[],limited:false};
 private selectedId:string|undefined;
 private promotedId:string|undefined;
 private savedRows=new Map<string,number>();
 private archiveLines:string[]|undefined;
 private archiveWidth=0;
 private savedCache=new Map<string,{text:string;question:string;component:Container}>();
 private archive:Component;
 private menu:OverlayHandle|undefined;
 private disposed=false;
 private warnings=new Set<string>();
 private menuId:string|undefined;

 constructor(theme:Theme, private warn:(message:string)=>void, private beforeJump:()=>boolean=()=>true) {
  this.theme=theme;
  this.archive={render:width=>this.renderArchive(width),invalidate:()=>{this.savedCache.clear();this.savedRows.clear();this.archiveLines=undefined;}};
 }
 attach(tui:TUI):boolean {
  if(this.disposed)return false;
  this.tui=tui;
  if(!SUPPORTED_PI_VERSIONS.has(VERSION)||tui.mode!=='fullscreen')return false;
  if(this.isMounted())return true;
  const root=this.tui.layoutRoot;
  const layout=root?.layoutType==='vstack'&&Array.isArray(root.entries)?{type:root.layoutType,entries:root.entries}:undefined;
  if(layout?.type!=='vstack'||layout.entries.length!==2)return false;
  const view:any=layout.entries[0]?.component;
  if(view?.primary!==true||typeof view.scrollTo!=='function'||typeof view.getContentWidth!=='function'||!view.child||!Array.isArray(view.children)||view.children.length!==1||view.children[0]!==view.child)return false;
  this.originalRoot=root;this.view=view;this.originalDocument=view.child;
  this.combined=new Container();this.combined.addChild(this.archive);this.combined.addChild(this.originalDocument);
  try {
   // Keep the native root, primary viewport and dock; only the UI history document is extended.
   view.child=this.combined;view.children[0]=this.combined;
   this.tui.requestRender();return true;
  } catch {
   view.child=this.originalDocument;view.children[0]=this.originalDocument;
   this.combined=undefined;return false;
  }
 }
 isMounted():boolean { return !this.disposed&&this.combined!==undefined&&this.tui?.mode==='fullscreen'&&this.tui.layoutRoot===this.originalRoot&&this.view?.child===this.combined; }
 syncLayout():void {
  if(this.disposed||!this.tui||this.isMounted())return;
  if(this.combined&&this.view?.child===this.combined){this.view.child=this.originalDocument;this.view.children[0]=this.originalDocument;}
  if(this.tui.mode==='fullscreen'&&(!this.originalRoot||this.tui.layoutRoot===this.originalRoot))this.attach(this.tui);
 }
 update(snapshot:Snapshot,theme:Theme):void {
  if(this.disposed)return;
  if(this.theme!==theme){this.theme=theme;this.savedCache.clear();}
  const oldReplies=this.snapshot.replies;
  const oldSaved=oldReplies.filter(reply=>reply.archived||reply.id===this.promotedId).map(reply=>reply.id).join('|');
  const newSaved=snapshot.replies.filter(reply=>reply.archived||reply.id===this.promotedId).map(reply=>reply.id).join('|');
  const selectionMoved=snapshot.replies.some(reply=>reply.id===this.selectedId&&reply.archived&&oldReplies.some(previous=>previous.id===reply.id&&!previous.archived));
  const previousHeight=this.savedHeight();const previousTop=this.view?.scrollTop??0;
  const following=this.view?.isFollowingEnd??true;
  this.snapshot=snapshot;this.archiveLines=undefined;
  if(!snapshot.replies.some(reply=>reply.id===this.selectedId))this.selectedId=snapshot.replies.at(-1)?.id;
  if(!snapshot.replies.some(reply=>reply.id===this.menuId))this.menuId=this.selectedId;
  if(!snapshot.replies.some(reply=>reply.id===this.promotedId))this.promotedId=undefined;
  const ids=new Set(snapshot.replies.map(reply=>reply.id));
  for(const id of this.savedCache.keys())if(!ids.has(id))this.savedCache.delete(id);
  if(this.isMounted()){
   if(oldSaved!==newSaved&&!following){
    const height=this.savedHeight();this.tui.renderNow();
    // Compaction changes row ownership; an old numeric offset must not land on another reply.
    const selectedRow=selectionMoved?this.savedRows.get(this.selectedId??''):undefined;
    if(selectedRow!==undefined)this.view.scrollTo(selectedRow,{disableFollow:true});
    else if(previousTop>=previousHeight)this.view.scrollTo(previousTop+height-previousHeight,{disableFollow:true});
   }
   this.tui.requestRender();
  }
 }
 private width():number { return this.view.getContentWidth(this.tui.terminal.columns); }
 private savedHeight():number { return this.tui&&this.view?this.renderArchive(this.width()).length:0; }
 private renderArchive(width:number):string[] {
  if(this.disposed||width<1){this.savedRows.clear();return [];}
  if(this.archiveLines&&this.archiveWidth===width)return this.archiveLines;
  this.savedRows.clear();const lines:string[]=[];
  try {
   for(const reply of this.snapshot.replies){
    if(!reply.archived&&reply.id!==this.promotedId)continue;
    let saved=this.savedCache.get(reply.id);
    if(!saved||saved.text!==reply.text||saved.question!==reply.question){
     const component=new Container();
     component.addChild(new Text(this.theme.fg('accent',`Saved parent final · ${reply.id.slice(0,REPLY_LABEL_CHARS)}`),1,1));
     if(reply.question)component.addChild(new Text(this.theme.fg('muted',summary(reply.question)),1,0));
     component.addChild(new Markdown(safe(reply.text),1,1,getMarkdownTheme()));
     saved={text:reply.text,question:reply.question,component};this.savedCache.set(reply.id,saved);
    }
    const rendered=saved.component.render(width);
    if(lines.length+rendered.length>LIMITS.renderRowsMax){lines.push(this.theme.fg('warning',truncateToWidth('Saved reply display limit reached; newer context remains below.',width)));break;}
    this.savedRows.set(reply.id,lines.length);lines.push(...rendered);
   }
  } catch {this.savedRows.clear();this.fail('Saved reply rendering unavailable.');this.archiveWidth=width;this.archiveLines=[truncateToWidth('Saved reply history unavailable.',width)];return this.archiveLines;}
  this.archiveWidth=width;this.archiveLines=lines;return lines;
 }
 private frame(body:string[],width:number):string[] {
  if(width<4)return body.map(line=>truncateToWidth(line,width));
  const inside=width-2;const border=(text:string)=>this.theme.fg('borderMuted',text);
  return [border('┌'+'─'.repeat(inside)+'┐'),...body.map(line=>border('│')+truncateToWidth(line,inside,'…',true)+border('│')),border('└'+'─'.repeat(inside)+'┘')];
 }
 openMenu():void {
  if(!this.isMounted()){this.notifyUnavailable();return;}
  if(this.menu||this.tui.hasOverlay())return;
  this.menuId=this.selectedId??this.snapshot.replies.at(-1)?.id;
  const close=()=>{this.menu?.hide();this.menu=undefined;};
  const move=(change:number)=>{
   const rows=[...this.snapshot.replies].reverse();const current=Math.max(0,rows.findIndex(reply=>reply.id===this.menuId));
   this.menuId=rows[Math.max(0,Math.min(rows.length-1,current+change))]?.id;this.tui.requestRender();
  };
  let renderedIds:string[]=[];
  const component:Component={invalidate(){},render:width=>{
   const rows=[...this.snapshot.replies].reverse();const count=Math.max(1,Math.min(MENU_ITEMS_MAX,Math.floor((this.tui.terminal.rows-7)/2)));
   const current=Math.max(0,rows.findIndex(reply=>reply.id===this.menuId));const start=Math.max(0,Math.min(current-Math.floor(count/2),rows.length-count));
   const selected=rows.slice(start,start+count);renderedIds=selected.map(reply=>reply.id);
   const body=[this.theme.fg('accent',` Replies · ${rows.length}${this.snapshot.limited?' · limited':''}`),''];
   for(const reply of selected){body.push(this.theme.fg(reply.id===this.menuId?'accent':'text',`${reply.id===this.menuId?'›':' '} ${summary(reply.text)}`),this.theme.fg('dim',`  ${reply.archived?'saved · ':''}${summary(reply.question)}`));}
   if(!selected.length)body.push(' No completed parent replies yet.');
   body.push('',this.theme.fg('muted',' ↑↓ browse · Enter jump · Esc close'));return this.frame(body,width);
  },handleInput:input=>{
   if(matchesKey(input,'escape')||input==='q'){close();return;}
   if(matchesKey(input,'up'))move(-1);else if(matchesKey(input,'down'))move(1);
   else if(matchesKey(input,'pageUp'))move(-MENU_ITEMS_MAX);else if(matchesKey(input,'pageDown'))move(MENU_ITEMS_MAX);
   else if(matchesKey(input,'home')){this.menuId=this.snapshot.replies.at(-1)?.id;this.tui.requestRender();}
   else if(matchesKey(input,'end')){this.menuId=this.snapshot.replies[0]?.id;this.tui.requestRender();}
   else if(matchesKey(input,'return')&&this.menuId){const id=this.menuId;close();this.jump(id);}
  },handleMouse:event=>{
   if(event.type==='wheel'){move(event.wheelDelta??0);return {handled:true};}
   if(event.type==='press')return {handled:true};
   if(event.type==='click'&&event.button==='left'){
    const index=Math.floor((event.y-3)/2);const id=event.y>=3?renderedIds[index]:undefined;
    if(id){close();this.jump(id);}return {handled:true};
   }
  }};
  this.menu=this.tui.showOverlay(component,{anchor:'top-right',row:1,width:Math.min(58,Math.max(20,this.tui.terminal.columns)),maxHeight:'90%',margin:0});
 }
 private locateNative(reply:Reply):number|undefined {
  const width=this.width();const pending=[{component:this.originalDocument,row:this.savedHeight(),depth:0}];
  let nodes=0;let renderedRows=0;const seen=new Set();
  if(this.snapshot.replies.filter(item=>!item.archived&&item.message===reply.message).length!==1)return undefined;
  let found:{component:any;row:number}|undefined;
  while(pending.length){
   const item=pending.pop()!;const component:any=item.component;
   if(++nodes>LIMITS.layoutNodesMax||item.depth>LIMITS.layoutDepthMax||seen.has(component))return undefined;
   seen.add(component);
   if(component?.lastMessage===reply.message&&component.isStreaming!==true){if(found)return undefined;found={component,row:item.row};}
   if(component?.constructor?.name!=='Container'||!Array.isArray(component.children))continue;
   if(component.children.length+pending.length>LIMITS.layoutNodesMax)return undefined;
   const rows=component.render(width);renderedRows+=rows.length;
   if(renderedRows>LIMITS.renderRowsMax)return undefined;
   const children=[];let offset=0;
   for(const child of component.children){
    if(typeof child?.render!=='function')return undefined;
    const height=child.render(width).length;renderedRows+=height;if(renderedRows>LIMITS.renderRowsMax)return undefined;
    children.push({component:child,row:item.row+offset,depth:item.depth+1});offset+=height;
   }
   if(offset!==rows.length)return undefined;
   for(let index=children.length-1;index>=0;index-=1)pending.push(children[index]);
  }
  return found?nativeBodyRow(found.component,found.row,width):undefined;
 }
 jump(id:string):boolean {
  if(this.disposed)return false;
  try {if(!this.beforeJump())return false;}catch{this.fail('Reply history could not be validated before navigation.');return false;}
  if(!this.isMounted()){this.notifyUnavailable();return false;}
  const reply=this.snapshot.replies.find(item=>item.id===id);if(!reply){this.fail('That parent reply is no longer on this branch.');return false;}
  try {
   this.tui.renderNow();let row=this.savedRows.get(id);
   if(row===undefined)row=this.locateNative(reply);
   if(row===undefined){
    // A renderer wrapper or edited message must never make a text guess jump to the wrong reply.
    this.promotedId=id;this.archiveLines=undefined;this.savedHeight();this.tui.renderNow();row=this.savedRows.get(id);
   }
   if(row===undefined){this.fail('This reply exceeds the safe display limit.');return false;}
   this.selectedId=id;
   this.view.scrollTo(row,{disableFollow:true});this.tui.requestRender();return true;
  } catch {this.fail('Reply navigation unavailable; conversation state was not changed.');return false;}
 }
 private fail(message:string):void {if(!this.warnings.has(message)){this.warnings.add(message);try{this.warn(message);}catch{console.error('[replies] UI notice unavailable.');}}}
 private notifyUnavailable():void {this.fail('Reply navigation requires a supported Pi fullscreen layout. No settings were changed.');}
 dispose():void {
  if(this.disposed)return;this.disposed=true;
  try{this.menu?.hide();}catch{this.fail('Reply overlay cleanup failed.');}finally{this.menu=undefined;}
  try{
   if(this.combined&&this.view?.child===this.combined){this.view.child=this.originalDocument;this.view.children[0]=this.originalDocument;}
   this.tui?.requestRender();
  }catch{this.fail('Reply layout cleanup failed; reload the parent session before further navigation.');}
  this.savedCache.clear();this.savedRows.clear();this.archiveLines=undefined;this.snapshot={replies:[],limited:false};
 }
}
