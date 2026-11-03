import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parent
SDK = Path(os.environ.get('PI_PACKAGE_ROOT', str(Path.home()/'.local/lib/node_modules/@earendil-works/pi-coding-agent')))
SOURCE = ROOT/'staged' if (ROOT/'staged').is_dir() else ROOT
VERSION = json.loads((SDK/'package.json').read_text())['version']
OUTPUT_BYTES_MAX = 4 * 1024 * 1024
WAIT_SECONDS_MAX = 12
TOTAL_SECONDS_MAX = 45
started=time.monotonic()
profile = Path(tempfile.mkdtemp(prefix='pi-replies-application-'))
(profile / 'agent').mkdir()
(profile / 'home').mkdir()
(profile / 'work').mkdir()
(profile / 'sessions').mkdir()
extension_directory=profile/'agent/extensions/replies'
extension_directory.mkdir(parents=True)
for name in ['index.ts','model.mjs','view.ts']:
    shutil.copyfile(SOURCE/name,extension_directory/name)
ready_file=profile/'readiness.txt'
(profile/'agent/extensions/zz-readiness.ts').write_text('''import {writeFileSync} from 'node:fs';
import {stripTerminalSequences} from '@earendil-works/pi-tui';
export default function(pi){pi.on('session_start',(event,context)=>{
 let pending=false;let previous='';
 context.ui.setWidget('fixture-readiness',(tui)=>({render(){
  if(!pending){pending=true;queueMicrotask(()=>{
   pending=false;
   const lines=tui.getScreenLines().map(stripTerminalSequences);
   const state=JSON.stringify({reason:event.reason,editorReady:typeof tui.getFocusedComponent()?.getText==='function',directViewport:tui.layoutRoot?.entries?.[0]?.component?.primary===true,sidebar:lines.some(line=>line.slice(-3).trim()==='≡'),overlay:tui.hasOverlay()});
   if(state!==previous){writeFileSync('''+json.dumps(str(ready_file))+''',state);previous=state;}
  });}return [];
 },invalidate(){}}),{placement:'belowEditor'});
});}
''')
(profile / 'agent/settings.json').write_text(json.dumps({'tuiMode':'fullscreen','collapseChangelog':True,'showStartupDetails':False,'packages':[]})+'\n')
environment = {'PATH':os.environ['PATH'],'HOME':str(profile/'home'),'XDG_CONFIG_HOME':str(profile/'home/.config'),'PI_CODING_AGENT_DIR':str(profile/'agent'),'PI_OFFLINE':'1','TERM':'xterm-256color','LANG':'C.UTF-8'}
creation = f"""
import {{SessionManager}} from {json.dumps((SDK/'dist/core/session-manager.js').as_uri())};
import {{LIMITS}} from {json.dumps((SOURCE/'model.mjs').as_uri())};
const manager=SessionManager.create({json.dumps(str(profile/'work'))},{json.dumps(str(profile/'sessions'))});
const answer=(text,timestamp)=>({{role:'assistant',api:'openai-completions',provider:'openai',model:'gpt-4o-mini',stopReason:'stop',timestamp,content:[{{type:'text',text}}],usage:{{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}}}});
manager.appendMessage(answer('x'.repeat(LIMITS.textCharsMax+1),0));
manager.appendMessage({{role:'user',content:'Earlier synthetic request',timestamp:1}});
manager.appendMessage(answer('NAV_ARCHIVED_FINAL\\n'+Array.from({{length:50}},(_,index)=>'Archived fixture line '+index).join('\\n'),2));
const kept=manager.appendMessage({{role:'user',content:'Recent synthetic request',timestamp:3}});
manager.appendMessage(answer('NAV_CURRENT_FINAL\\n'+Array.from({{length:45}},(_,index)=>'Current fixture line '+index).join('\\n'),4));
manager.appendCompaction('Synthetic earlier exchange summary',kept,12000);
console.log(manager.getSessionFile());
"""
created = subprocess.run(['node','--input-type=module','-e',creation],env=environment,capture_output=True,text=True,timeout=10)
if created.returncode:
    raise RuntimeError('Could not create isolated real session fixture')
session = Path(created.stdout.strip())
if not session.is_file() or profile not in session.parents:
    raise RuntimeError('Unexpected isolated session path')
master, slave = pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,100,0,0))
process = subprocess.Popen(['node',str(SDK/'dist/bundle/cli.js'),'--offline','--no-mcp','--no-skills','--no-prompt-templates','--no-themes','--session',str(session),'--provider','openai','--model','gpt-4o-mini'],cwd=profile/'work',env=environment,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
os.close(slave)
output = bytearray()


def read_state():
    try:
        return json.loads(ready_file.read_text())
    except (FileNotFoundError,json.JSONDecodeError):
        return {}


def wait_for(text, start=0):
    deadline = min(time.monotonic()+WAIT_SECONDS_MAX,started+TOTAL_SECONDS_MAX)
    for _ in range(256):
        if text.startswith('@'):
            state=read_state()
            ready=state.get('editorReady') and state.get('directViewport')
            if text=='@ready' and ready or text=='@reload-ready' and ready and state.get('reason')=='reload' or text=='@menu-open' and state.get('overlay') is True or text=='@menu-closed' and state.get('overlay') is False:
                return
        elif text.encode() in output[start:]:
            return
        remaining = deadline-time.monotonic()
        if remaining<=0 or process.poll() is not None:
            break
        readable,_,_=select.select([master],[],[],min(0.1,remaining))
        if readable:
            try:
                block=os.read(master,65536)
            except OSError:
                break
            if not block:
                break
            output.extend(block)
            if len(output)>OUTPUT_BYTES_MAX:
                raise RuntimeError('Isolated Pi exceeded terminal output budget')
    raise AssertionError('Actual Pi path did not render: '+text)


try:
    wait_for('@ready')
    assert read_state().get('sidebar') is False, 'No passive sidebar should be present'
    assert b'Replies need' not in output, 'Supported SDK must not produce a startup compatibility warning'
    assert b'Some replies exceed safe history/text limits' not in output, 'History limits must not produce startup warnings'
    before=session.read_bytes()
    point=len(output)
    os.write(master,b'/replies\r')
    wait_for('Replies',point)
    wait_for('· limited',point)
    wait_for('@menu-open')
    os.write(master,b'\x1b[F\r')
    wait_for('@menu-closed')
    wait_for('NAV_ARCHIVED_FINAL',point)
    os.write(master,b'UNSENT LIVE DRAFT')
    wait_for('UNSENT LIVE DRAFT',point)
    assert session.read_bytes()==before, 'UI navigation must not append/change the actual session log'
    point=len(output)
    os.write(master,b'\x15/reload\r')
    wait_for('Reloading keybindings',point)
    wait_for('@reload-ready',point)
    assert read_state().get('sidebar') is False, 'Reload must not restore the removed sidebar'
    point=len(output)
    os.write(master,b'/replies\r')
    wait_for('Replies',point)
    wait_for('· limited',point)
    wait_for('@menu-open')
    point=len(output)
    os.write(master,b'\x1b[<0;50;5M\x1b[<0;50;5m')
    wait_for('@menu-closed')
    wait_for('NAV_CURRENT_FINAL',point)
    assert b'Some replies exceed safe history/text limits' not in output, 'Reload must remain quiet for normal clipping'
    assert session.read_bytes()==before, 'Command inspection must not change the session log'
    (profile/'application.log').write_text(f'PASS actual bundled Pi {VERSION} CLI in isolated offline PTY: no sidebar or resume-time limit warning; /replies reports clipping; keyboard jump reads compacted final; list pointer jump works; editor accepts draft; native /reload keeps command functional; actual session file unchanged.\nNo model prompts submitted or credentials inherited.\n')
    print((profile/'application.log').read_text())
    print('Evidence:',profile)
finally:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill();process.wait(timeout=5)
    os.close(master)
    (profile/'application-terminal.log').write_bytes(output)
