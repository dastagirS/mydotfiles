if exists('g:loaded_personal_netrw_trash')
    finish
endif
let g:loaded_personal_netrw_trash = 1
let s:entries_count_max = 64
let s:path_bytes_max = 4096
let s:timeout_seconds = 10
let s:terminate_grace_seconds = 1
let s:wide_list_style = 2
let s:tree_list_style = 3
let s:tree_header_line_count = 1
let s:compatibility_options = &cpo
set cpo&vim

function! s:TrashEntries(first, last, visual) abort
    let view = winsaveview()
    try
        if &filetype !=# 'netrw' || !isdirectory(get(b:, 'netrw_curdir', ''))
            throw 'Only local netrw entries can be moved to Trash.'
        endif
        let gio = exepath('gio')
        let timeout = exepath('timeout')
        if empty(gio) || empty(timeout)
            throw 'gio or timeout is unavailable; nothing was deleted.'
        endif
        let marked = netrw#Expose('netrwmarkfilelist_' . bufnr('%'))
        let entries = []
        if type(marked) == v:t_list && !empty(marked)
            if len(marked) > s:entries_count_max
                throw 'Select at most ' . s:entries_count_max . ' entries per operation.'
            endif
            for name in marked
                call add(entries, [b:netrw_curdir, name])
            endfor
        else
            if a:visual && get(w:, 'netrw_liststyle', 0) == s:wide_list_style
                throw 'In wide listings, mark entries with mf instead of using a visual selection.'
            endif
            if a:first < 1 || a:last > line('$') || a:last < a:first || a:last - a:first + 1 > s:entries_count_max
                throw 'Invalid selection or too many entries.'
            endif
            for line_number in range(a:first, a:last)
                call cursor(line_number, a:first == a:last ? view.col + 1 : 1)
                if get(w:, 'netrw_liststyle', 0) == s:tree_list_style && line('.') <= w:netrw_bannercnt + s:tree_header_line_count
                    continue
                endif
                let name = netrw#Call('NetrwGetWord')
                let directory = b:netrw_curdir
                if get(w:, 'netrw_liststyle', 0) == s:tree_list_style
                    " TreePath includes directory/link names; GetCurdir also mutates the browsing directory.
                    let directory = netrw#Call('NetrwTreePath', w:netrw_treetop)
                    if name =~# '/$' || getline('.') =~# '@\s\+-->'
                        let directory = fnamemodify(substitute(directory, '/\+$', '', ''), ':h')
                    endif
                endif
                call add(entries, [directory, name])
            endfor
        endif
        let paths = []
        for entry in entries
            let name = substitute(entry[1], '/\+$', '', '')
            if empty(name) || name ==# '.' || name ==# '..'
                continue
            endif
            let path = name =~# '^/' ? name : entry[0] . '/' . name
            let path = substitute(fnamemodify(path, ':p'), '/\+$', '', '')
            let directory = substitute(fnamemodify(entry[0], ':p'), '/\+$', '', '')
            if empty(path) || path ==# directory || path =~# '[\r\n]' || strlen(path) > s:path_bytes_max || empty(getftype(path))
                throw 'Unsafe, missing or unsupported entry; nothing was deleted.'
            endif
            if getbufvar(bufnr(path), '&modified')
                throw 'Save or discard the modified buffer before trashing its file.'
            endif
            if index(paths, path) < 0
                call add(paths, path)
            endif
        endfor
        if empty(paths)
            return
        endif
        call winrestview(view)
        call inputsave()
        try
            let answer = input('Move ' . (len(paths) == 1 ? paths[0] : len(paths) . ' selected entries') . ' to Trash? [y/N]: ')
        finally
            call inputrestore()
        endtry
        if answer !~? '^y\%[es]$'
            return
        endif
        " Shell-quote every path: Vim's system() does not accept argv lists.
        let command = shellescape(timeout) . ' --kill-after=' . s:terminate_grace_seconds . 's ' . s:timeout_seconds . 's '
                    \ . shellescape(gio) . ' trash -- ' . join(map(copy(paths), 'shellescape(v:val)'), ' ')
        let output = system(command)
        if v:shell_error
            throw 'Trash failed or timed out; no permanent-delete fallback was used. Some entries may already be in Trash. ' . output
        endif
        if type(marked) == v:t_list && !empty(marked)
            call netrw#Call('NetrwUnMarkFile', 1)
        endif
        call netrw#Call('NetrwRefresh', 1, netrw#Call('NetrwBrowseChgDir', 1, './', 0))
        echom 'Moved ' . len(paths) . ' item(s) to Trash.'
    catch
        echohl ErrorMsg
        echom 'Trash: ' . v:exception
        echohl None
    finally
        call winrestview(view)
    endtry
endfunction

" Netrw rebuilds its defaults before FileType, including after refresh/navigation.
augroup PersonalNetrwTrash
    autocmd!
    autocmd FileType netrw nnoremap <buffer> <silent> D :<C-U>call <SID>TrashEntries(line('.'), line('.'), 0)<CR>
    autocmd FileType netrw nnoremap <buffer> <silent> <Del> :<C-U>call <SID>TrashEntries(line('.'), line('.'), 0)<CR>
    autocmd FileType netrw xnoremap <buffer> <silent> D :<C-U>call <SID>TrashEntries(line("'<"), line("'>"), 1)<CR>
    autocmd FileType netrw xnoremap <buffer> <silent> <Del> :<C-U>call <SID>TrashEntries(line("'<"), line("'>"), 1)<CR>
augroup END

let &cpo = s:compatibility_options
unlet s:compatibility_options
