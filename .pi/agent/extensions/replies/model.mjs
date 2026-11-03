export const LIMITS = Object.freeze({ entryIdCharsMax:128, metadataCharsMax:512, questionCharsMax:240, branchEntriesMax:20000, repliesMax:512, textCharsMax:65536, textCharsTotalMax:2097152, contentPartsMax:256, layoutNodesMax:4096, layoutDepthMax:12, renderRowsMax:100000 });

function textOf(content, sizeMax) {
 if (typeof content === 'string') return content.length <= sizeMax ? content : undefined;
 if (!Array.isArray(content) || content.length > LIMITS.contentPartsMax) return undefined;
 let text='';
 for(const part of content){
  if(part?.type!=='text'||typeof part.text!=='string')continue;
  const separator=text&&part.text?'\n\n':'';
  if(text.length+separator.length+part.text.length>sizeMax)return undefined;
  text+=separator+part.text;
 }
 return text;
}
export function collectReplies(branch, visibleIds) {
 if(!Array.isArray(branch)||!(visibleIds instanceof Set))throw new TypeError('Expected branch entries and visible IDs');
 const entries=branch.slice(-LIMITS.branchEntriesMax);
 const edits=new Map();
 for(const entry of entries)if(entry?.type==='context_edit'&&typeof entry.targetId==='string')edits.set(entry.targetId,entry.replacement);
 const candidates=[];let count=0;let question='';
 for(const entry of entries){
  if(entry?.type!=='message'||typeof entry.id!=='string'||entry.id.length>LIMITS.entryIdCharsMax||!/^[A-Za-z0-9_-]+$/.test(entry.id)||!entry.message)continue;
  const replacement=edits.get(entry.id);
  if(replacement===null){if(entry.message.role==='user')question='';continue;}
  let message=entry.message;
  if(replacement&&Object.hasOwn(replacement,'content')){
   const content=message.role==='assistant'&&typeof replacement.content==='string'?[{type:'text',text:replacement.content}]:replacement.content;
   message={...message,content};
  }
  if(message.role==='user'){
   const content=message.content;
   const first=typeof content==='string'?content:Array.isArray(content)?content.slice(0,LIMITS.contentPartsMax).find(part=>part?.type==='text'&&typeof part.text==='string')?.text:'';
   question=(first??'').slice(0,LIMITS.questionCharsMax).replace(/\s+/g,' ').trim();continue;
  }
  if(message.role!=='assistant'||message.stopReason!=='stop'||!Array.isArray(message.content)||message.content.length>LIMITS.contentPartsMax||message.content.some(part=>part?.type==='toolCall'))continue;
  candidates[count%LIMITS.repliesMax]={id:entry.id,message,question};count+=1;
 }
 const ordered=count>LIMITS.repliesMax?candidates.slice(count%LIMITS.repliesMax).concat(candidates.slice(0,count%LIMITS.repliesMax)):candidates;
 const replies=[];let textChars=0;let limited=branch.length>entries.length||count>LIMITS.repliesMax;
 for(let index=ordered.length-1;index>=0;index-=1){
  const candidate=ordered[index];const text=textOf(candidate.message.content,LIMITS.textCharsMax);
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
