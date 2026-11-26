export const LIMITS = Object.freeze({ entryIdCharsMax:128, metadataCharsMax:512, questionCharsMax:240, branchEntriesMax:20000, textCharsMax:65536, textCharsTotalMax:2097152, contentPartsMax:256, layoutNodesMax:4096, layoutDepthMax:12, renderRowsMax:100000 });

type ContentPart = { type?: string; text?: string; thinking?: string; [key:string]:unknown };
type Message = { role?: string; content?: unknown; stopReason?: string; timestamp?: unknown; provider?: unknown; model?: unknown; api?: unknown; [key:string]:unknown };
type Entry = { type?: string; id?: string; message?: Message|null; targetId?: string; replacement?: unknown; [key:string]:unknown };
type Replacement = { content?: unknown };
export type Reply = { id:string; role:'user'|'assistant'; text:string; question:string; archived:boolean; message:Message };
export type Snapshot = { replies:Reply[]; limited:boolean };

function textOf(content:unknown,sizeMax:number):string|undefined {
 if (typeof content === 'string') return content.length <= sizeMax ? content : undefined;
 if (!Array.isArray(content) || content.length > LIMITS.contentPartsMax) return undefined;
 let text='';
 for(const value of content){
  const part=value as ContentPart;
  if(part?.type!=='text'||typeof part.text!=='string')continue;
  const separator=text&&part.text?'\n\n':'';
  if(text.length+separator.length+part.text.length>sizeMax)return undefined;
  text+=separator+part.text;
 }
 return text;
}

export function collectReplies(branch:readonly Entry[],visibleIds:ReadonlySet<string>):Snapshot {
 if(!Array.isArray(branch)||!(visibleIds instanceof Set))throw new TypeError('Expected branch entries and visible IDs');
 const entries=branch.slice(-LIMITS.branchEntriesMax);
 const edits=new Map<string,unknown>();
 for(const entry of entries)if(entry?.type==='context_edit'&&typeof entry.targetId==='string')edits.set(entry.targetId,entry.replacement);
 const candidates:Array<{id:string;role:'user'|'assistant';message:Message;question:string;text?:string}>=[];
 let question='';let limited=false;
 for(const entry of entries){
  if(entry?.type!=='message'||typeof entry.id!=='string'||entry.id.length>LIMITS.entryIdCharsMax||!/^[A-Za-z0-9_-]+$/.test(entry.id)||!entry.message)continue;
  const replacement=edits.get(entry.id);
  if(replacement===null){if(entry.message.role==='user')question='';continue;}
  let message=entry.message;
  if(replacement&&typeof replacement==='object'&&Object.hasOwn(replacement,'content')){
   const content=message.role==='assistant'&&typeof (replacement as Replacement).content==='string'?[{type:'text',text:(replacement as Replacement).content}]:(replacement as Replacement).content;
   message={...message,content};
  }
  if(message.role==='user'){
   const prompt=textOf(message.content,LIMITS.textCharsMax);
   if(prompt===undefined){limited=true;continue;}
   if(!prompt.trim())continue;
   question=prompt.slice(0,LIMITS.questionCharsMax).replace(/\s+/g,' ').trim();
   candidates.push({id:entry.id,role:'user',message,question:'',text:prompt});continue;
  }
  if(message.role!=='assistant'||message.stopReason!=='stop'||!Array.isArray(message.content)||message.content.length>LIMITS.contentPartsMax||message.content.some(part=>(part as ContentPart)?.type==='toolCall'))continue;
  candidates.push({id:entry.id,role:'assistant',message,question});
 }
 const ordered=candidates;
 const replies:Reply[]=[];let textChars=0;limited=limited||branch.length>entries.length;
 for(let index=ordered.length-1;index>=0;index-=1){
  const candidate=ordered[index];const text=candidate.text??textOf(candidate.message.content,LIMITS.textCharsMax);
  if(text===undefined){limited=true;continue;}
  if(!text.trim())continue;
  if(textChars+text.length>LIMITS.textCharsTotalMax){limited=true;continue;}
  const timestamp=candidate.message.timestamp??null;
  const tags=[candidate.message.provider??null,candidate.message.model??null,candidate.message.api??null];
  if(timestamp!==null&&!(typeof timestamp==='number'&&Number.isFinite(timestamp))&&!(typeof timestamp==='string'&&timestamp.length<=LIMITS.metadataCharsMax)||tags.some(value=>value!==null&&(typeof value!=='string'||value.length>LIMITS.metadataCharsMax))){limited=true;continue;}
  textChars+=text.length;
  replies.push({...candidate,text,archived:!visibleIds.has(candidate.id)});
 }
 replies.reverse();return {replies,limited};
}
