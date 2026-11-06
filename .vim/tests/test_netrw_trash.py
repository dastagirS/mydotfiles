import os
import shutil
import pty
import select
import fcntl
import struct
import termios
from pathlib import Path
import subprocess
import tempfile
import unittest
from urllib.parse import unquote

PLUGIN = Path.home()/'.vim/plugin/netrw-trash.vim'


class NetrwTrashTests(unittest.TestCase):
    def run_editor(self, editor, scenario='file', failure=False, cancel=False, visual=False, marked=False, tree=False, startup=False, repeat=False, remote=False, parent=False, wide=False, modified=False, delete_key="D", nested=False, tree_root=False):
        with tempfile.TemporaryDirectory(prefix='editor-trash-check-') as temporary:
            root=Path(temporary);home=root/'home';home.mkdir()
            directory=root/'work';directory.mkdir()
            name='sample.txt' if scenario!='special' else "-odd 'quote';$(touch UNEXPECTED).txt"
            container=directory/'branch' if nested else directory
            if nested:container.mkdir()
            target=container/name
            if scenario=='directory':target.mkdir();(target/'nested.txt').write_text('recoverable contents')
            elif scenario in ['symlink','symlink_directory']:
                if scenario=='symlink_directory':
                    (directory/'original.txt').mkdir();(directory/'original.txt/nested.txt').write_text('symlink target survives')
                else:(directory/'original.txt').write_text('symlink target survives')
                target.symlink_to(directory/'original.txt')
            else:target.write_text('recoverable contents')
            second=directory/'second.txt'
            if marked or visual or repeat:second.write_text('second recoverable contents')
            environment={**os.environ,'HOME':str(home),'XDG_DATA_HOME':str(root/'data'),
                         'XDG_CONFIG_HOME':str(root/'config'),'XDG_STATE_HOME':str(root/'state'),
                         'XDG_CACHE_HOME':str(root/'cache'),'CASE_DIRECTORY':str(directory),
                         'CASE_NAME':name,'CASE_RESULT':str(root/'result'),'LANG':'C.UTF-8'}
            if failure:
                commands=root/'bin';commands.mkdir()
                if failure=='missing':
                    (commands/'timeout').symlink_to(shutil.which('timeout'))
                    environment['PATH']=str(commands)
                else:
                    (commands/'gio').write_text('#!/bin/sh\nexec sleep 30\n' if failure=='timeout' else '#!/bin/sh\nexit 1\n')
                    (commands/'gio').chmod(0o700)
                    environment['PATH']=str(commands)+':'+os.environ['PATH']
            answer='n' if cancel else 'y'
            script=['set nocompatible','set nomore','packadd netrw','let g:netrw_banner=0','let g:netrw_dirhistmax=0']
            if startup:
                plugins=home/'.vim/plugin';plugins.mkdir(parents=True);(plugins/PLUGIN.name).symlink_to(PLUGIN)
                if editor=='nvim':script.insert(2,"lua dofile('/home/ichigo/.config/nvim/lua/vim-options.lua')")
            if not startup and PLUGIN.exists():script+=['execute "source " . fnameescape('+repr(str(PLUGIN))+')']
            if tree:script+=['let g:netrw_liststyle=3']
            if wide:script+=['let g:netrw_liststyle=2']
            if modified:script+=['set hidden','let modified_buffer=bufadd($CASE_DIRECTORY . "/" . $CASE_NAME)','call bufload(modified_buffer)','call setbufline(modified_buffer,1,"unsaved edits")']
            script+=['execute "Explore " . fnameescape($CASE_DIRECTORY)',
                     'if &filetype !=# "netrw" | cquit 3 | endif']
            if nested:script+=['call search("branch/","w")','call feedkeys("\\<CR>","xt")']
            script+=["let matched=search('\\V' . escape($CASE_NAME,'\\'),'w')",
                     'if !matched | cquit 4 | endif']
            if marked:
                script+=['call feedkeys("mf", "xt")','call search("second.txt", "w")','call feedkeys("mf", "xt")']
            if visual:
                script+=['let selection_start=line(".")','call search("second.txt", "w")',
                         'let selection_end=line(".")','call cursor(min([selection_start,selection_end]),1)',
                         'execute "normal! V" . (abs(selection_end-selection_start) ? abs(selection_end-selection_start)."j" : "")']
            if remote:script+=['let b:netrw_curdir="scp://unreachable.invalid/root"']
            if tree_root:script+=['call cursor(1,1)']
            if parent:script+=["call search('^\\.\\./$', 'w')"]
            if editor=='nvim':script+=['call timer_start(100, { timer -> feedkeys("'+answer+'\\<CR>", "t") })']
            script+=['call feedkeys("'+delete_key+'", "xt")']
            if repeat:
                script+=['call search("second.txt","w")']
                if editor=='nvim':script+=['call timer_start(100, { timer -> feedkeys("y\\<CR>", "t") })']
                script+=['call feedkeys("D","xt")']
            script+=['enew!','call setline(1,"abcdef")','normal! 03lD',
                     'call writefile([getline(1)],$CASE_RESULT)','qa!']
            fixture=root/'case.vim';fixture.write_text('\n'.join(script)+'\n')
            arguments=[editor,'--clean','--headless','-i','NONE','-S',str(fixture)] if editor=='nvim' else [editor,'-Nu','NORC' if startup else 'NONE','-n','-es','-i','NONE','-S',str(fixture)]
            arguments[0]=shutil.which(editor)
            if editor=='vim' and repeat:
                arguments.remove('-es')
                master,slave=pty.openpty()
                fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,240,0,0))
                process=subprocess.Popen(arguments,env=environment,stdin=slave,stdout=slave,stderr=slave)
                os.close(slave);output=bytearray();confirmed=0
                try:
                    prompts=[(str(path)+' to Trash? [y/N]: ').encode() for path in [target,second]]
                    for attempt in range(300):
                        readable,_,_=select.select([master],[],[],0.05)
                        if readable:
                            try:chunk=os.read(master,65536)
                            except OSError:break
                            output.extend(chunk)
                            if len(output)>2*1024*1024:raise ValueError('Editor output limit exceeded')
                        if confirmed<len(prompts) and prompts[confirmed] in output:
                            os.write(master,b'y\r');confirmed+=1
                        if process.poll() is not None:break
                    if process.poll() is None:process.terminate()
                    process.wait(timeout=2)
                    result=subprocess.CompletedProcess(arguments,process.returncode,output.decode(errors='replace'),'')
                    self.assertEqual(confirmed,2,result.stdout)
                finally:
                    if process.poll() is None:process.kill();process.wait(timeout=2)
                    os.close(master)
            else:
                result=subprocess.run(arguments,input=answer+'\n',env=environment,capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertTrue((root/'result').is_file(),result.stdout+result.stderr)
            self.assertEqual((root/'result').read_text(),'abc\n','Normal text-buffer D changed')
            self.assertFalse((directory/'UNEXPECTED').exists(),'Filename executed as a command')
            files=root/'data/Trash/files';info=root/'data/Trash/info'
            if failure or cancel or remote or parent or modified or tree_root:
                self.assertTrue(target.exists() or target.is_symlink(),'Trash failure/cancellation deleted source')
                self.assertFalse(files.exists() and any(files.iterdir()),'Unexpected item moved to Trash')
            else:
                self.assertNotIn('Trash: ',result.stdout+result.stderr,'Trash callback reported a failure')
                self.assertFalse(target.exists() or target.is_symlink(),'Source was not moved')
                payloads=list(files.iterdir()) if files.exists() else []
                self.assertEqual(len(payloads),2 if marked or visual or repeat else 1,'Deleted entry has no recoverable Trash payload')
                records=[unquote(path.read_text()) for path in info.glob('*.trashinfo')]
                self.assertTrue(any('Path='+str(target)+'\n' in record for record in records),'Original path missing from Trash metadata')
                if scenario=='directory':
                    directories=[path for path in payloads if path.is_dir() and not path.is_symlink()]
                    self.assertEqual(len(directories),1,'Expected one recoverable folder')
                    self.assertEqual((directories[0]/'nested.txt').read_text(),'recoverable contents')
                elif scenario in ['symlink','symlink_directory']:
                    self.assertTrue(payloads[0].is_symlink())
                    original=directory/'original.txt/nested.txt' if scenario=='symlink_directory' else directory/'original.txt'
                    self.assertEqual(original.read_text(),'symlink target survives')
                else:self.assertTrue(any(path.read_text()=='recoverable contents' for path in payloads))

    def test_file_is_recoverable(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor)

    def test_nonempty_directory_is_recoverable(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,'directory')

    def test_shell_characters_are_literal(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,'special')

    def test_symlink_does_not_delete_target(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,'symlink')

    def test_trash_failure_preserves_source(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,failure=True)

    def test_cancel_preserves_source(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,cancel=True)

    def test_marked_entries_are_recoverable(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,marked=True)

    def test_visual_entries_are_recoverable(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,visual=True)

    def test_tree_listing_uses_trash(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,tree=True)


    def test_normal_startup_loads_protection(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,startup=True)

    def test_refresh_keeps_protection(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,repeat=True)

    def test_remote_delete_is_refused_without_connection(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,remote=True)

    def test_parent_directory_is_not_trashed(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,parent=True)

    def test_wide_listing_trashes_entry_under_cursor(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,wide=True)

    def test_modified_buffer_is_not_trashed(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,modified=True)

    def test_delete_key_also_uses_trash(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,delete_key="\\<Del>")

    def test_missing_trash_command_preserves_source(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,failure='missing')

    def test_stalled_trash_command_times_out_without_deleting(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,failure='timeout')

    def test_tree_directory_is_recoverable(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,'directory',tree=True)

    def test_nested_tree_directory_is_recoverable(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,'directory',tree=True,nested=True)

    def test_tree_symlinks_preserve_targets(self):
        for editor in ['vim','nvim']:
            for scenario in ['symlink','symlink_directory']:
                with self.subTest(editor=editor,scenario=scenario):self.run_editor(editor,scenario,tree=True)

    def test_tree_root_is_not_trashed(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,tree=True,tree_root=True)

    def test_marked_tree_directory_is_recoverable(self):
        for editor in ['vim','nvim']:
            with self.subTest(editor=editor):self.run_editor(editor,'directory',tree=True,marked=True)

if __name__=='__main__':unittest.main()
