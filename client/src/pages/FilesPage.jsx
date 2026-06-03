import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { html }       from '@codemirror/lang-html';
import { css }        from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { php }        from '@codemirror/lang-php';
import { api } from '../lib/api';

function langFor(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['html', 'htm'].includes(ext)) return html();
  if (ext === 'css')                  return css();
  if (['js', 'mjs', 'jsx'].includes(ext)) return javascript({ jsx: true });
  if (ext === 'php')                  return php();
  return [];
}

function fileIcon(entry) {
  if (entry.type === 'dir') return '📁';
  const ext = entry.file.split('.').pop().toLowerCase();
  if (['html', 'htm', 'php'].includes(ext)) return '🌐';
  if (['js', 'mjs', 'jsx'].includes(ext))   return '📜';
  if (ext === 'css')                          return '🎨';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return '🖼️';
  if (['zip', 'tar', 'gz'].includes(ext))    return '📦';
  return '📄';
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Breadcrumb({ root, current, onNavigate }) {
  const rootParts  = root.split('/').filter(Boolean);
  const curParts   = current.split('/').filter(Boolean);
  const extra      = curParts.slice(rootParts.length);

  return (
    <div className="flex items-center gap-1 text-xs text-gray-500 overflow-x-auto whitespace-nowrap">
      <button onClick={() => onNavigate(root)} className="hover:text-indigo-600 font-mono">{root}</button>
      {extra.map((part, i) => {
        const path = [...rootParts, ...extra.slice(0, i + 1)].join('/');
        return (
          <span key={path} className="flex items-center gap-1">
            <span className="text-gray-300">/</span>
            <button onClick={() => onNavigate(path)} className="hover:text-indigo-600 font-mono">{part}</button>
          </span>
        );
      })}
    </div>
  );
}

function FileTree({ dir, root, selected, onSelect, onNavigate }) {
  const [entries, setEntries]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState('');
  const [renaming, setRenaming] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.get(`/files/list?dir=${encodeURIComponent(dir)}`);
      const files = data.files || data || [];
      setEntries([...files].sort((a, b) => {
        if (a.type === b.type) return a.file.localeCompare(b.file);
        return a.type === 'dir' ? -1 : 1;
      }));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [dir]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(entry) {
    if (!confirm(`Delete "${entry.file}"?`)) return;
    setDeleting(entry.file);
    try {
      await api.post('/files/delete', { dir, names: [entry.file] });
      load();
      if (selected === `${dir}/${entry.file}`) onSelect(null, null);
    } catch (err) { alert(`Delete failed: ${err.message}`); }
    finally { setDeleting(null); }
  }

  async function handleRename(entry) {
    if (!renameVal.trim() || renameVal === entry.file) { setRenaming(null); return; }
    try {
      await api.post('/files/rename', { dir, oldName: entry.file, newName: renameVal.trim() });
      setRenaming(null);
      load();
      if (selected === `${dir}/${entry.file}`) onSelect(`${dir}/${renameVal.trim()}`, renameVal.trim());
    } catch (err) { alert(`Rename failed: ${err.message}`); }
  }

  if (loading) return <div className="px-4 py-2 text-xs text-gray-400">Loading…</div>;
  if (error)   return <div className="px-4 py-2 text-xs text-red-500">{error}</div>;
  if (!entries?.length) return <div className="px-4 py-2 text-xs text-gray-400 italic">Empty directory</div>;

  return (
    <div>
      {entries.map(entry => {
        const fullPath = `${dir}/${entry.file}`;
        const isSelected = selected === fullPath;
        return (
          <div key={entry.file}
            className={`group flex items-center gap-1.5 px-3 py-1 cursor-pointer text-xs transition-colors ${
              isSelected ? 'bg-indigo-100 text-indigo-800' : 'hover:bg-gray-100 text-gray-700'
            }`}
            onClick={() => {
              if (entry.type === 'dir') onNavigate(fullPath);
              else onSelect(fullPath, entry.file);
            }}>
            <span className="shrink-0 text-sm leading-none">{fileIcon(entry)}</span>
            {renaming === entry.file ? (
              <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                onBlur={() => handleRename(entry)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(entry); if (e.key === 'Escape') setRenaming(null); }}
                onClick={e => e.stopPropagation()}
                className="flex-1 text-xs border border-indigo-400 rounded px-1 py-0 focus:outline-none" />
            ) : (
              <span className="flex-1 truncate font-mono">{entry.file}</span>
            )}
            <span className="text-gray-400 text-[10px] shrink-0 hidden group-hover:inline">
              {entry.type === 'file' && formatSize(entry.size)}
            </span>
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
              <button title="Rename"
                onClick={() => { setRenaming(entry.file); setRenameVal(entry.file); }}
                className="p-0.5 text-gray-400 hover:text-indigo-600 rounded transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button title="Delete" disabled={deleting === entry.file}
                onClick={() => handleDelete(entry)}
                className="p-0.5 text-gray-400 hover:text-red-600 rounded transition-colors disabled:opacity-40">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const EDITABLE_EXTS = new Set(['html', 'htm', 'php', 'css', 'js', 'mjs', 'jsx', 'json', 'txt', 'md', 'xml', 'htaccess', 'conf', 'ini', 'env', 'sh', 'svg']);

function isEditable(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return EDITABLE_EXTS.has(ext) || !filename.includes('.');
}

export default function FilesPage() {
  const { domainId }   = useParams();
  const navigate       = useNavigate();
  const [domain,       setDomain]       = useState(null);
  const [root,         setRoot]         = useState('');
  const [currentDir,   setCurrentDir]   = useState('');
  const [selectedPath, setSelectedPath] = useState(null);
  const [selectedName, setSelectedName] = useState(null);
  const [content,      setContent]      = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loadingFile,  setLoadingFile]  = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState('');
  const [treeKey,      setTreeKey]      = useState(0);
  const [newName,      setNewName]      = useState('');
  const [newType,      setNewType]      = useState(null); // 'file' | 'dir'
  const [lineWrap,     setLineWrap]     = useState(true);
  const uploadRef = useRef(null);

  useEffect(() => {
    api.get('/domains').then(domains => {
      const d = domains.find(d => String(d.id) === String(domainId));
      if (!d) return;
      setDomain(d);
      const r = d.doc_root || `public_html/${d.domain}`;
      setRoot(r);
      setCurrentDir(r);
    });
  }, [domainId]);

  const openFile = useCallback(async (path, name) => {
    if (!path) { setSelectedPath(null); setSelectedName(null); setContent(''); setSavedContent(''); return; }
    if (!isEditable(name)) {
      alert(`Binary/image files can't be opened in the editor. Download via cPanel File Manager.`);
      return;
    }
    setSelectedPath(path);
    setSelectedName(name);
    setLoadingFile(true);
    try {
      const { content: c } = await api.get(`/files/content?path=${encodeURIComponent(path)}`);
      setContent(c); setSavedContent(c);
    } catch (err) { alert(`Failed to open: ${err.message}`); }
    finally { setLoadingFile(false); }
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedPath) return;
    setSaving(true); setSaveMsg('');
    try {
      await api.post('/files/save', { path: selectedPath, content });
      setSavedContent(content);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err) { setSaveMsg(`Error: ${err.message}`); }
    finally { setSaving(false); }
  }, [selectedPath, content]);

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  async function handleNewItem(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    const fullPath = `${currentDir}/${newName.trim()}`;
    try {
      if (newType === 'file') {
        await api.post('/files/create', { path: fullPath });
      } else {
        await api.post('/files/mkdir', { path: fullPath });
      }
      setNewName(''); setNewType(null);
      setTreeKey(k => k + 1);
      if (newType === 'file') openFile(fullPath, newName.trim());
    } catch (err) { alert(`Failed: ${err.message}`); }
  }

  async function handleUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    try {
      await fetch(`/api/files/upload?dir=${encodeURIComponent(currentDir)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: form,
      }).then(r => r.json()).then(r => { if (r.message) throw new Error(r.message); });
      setTreeKey(k => k + 1);
      alert(`Uploaded ${files.length} file(s).`);
    } catch (err) { alert(`Upload failed: ${err.message}`); }
    e.target.value = '';
  }

  const isDirty = content !== savedContent;

  if (!domain) return <div className="p-6 text-gray-400">Loading domain…</div>;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-50">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
        <button onClick={() => navigate('/domains')} className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 font-mono">{domain.domain}</span>
          <span className="text-xs text-gray-400">File Manager</span>
        </div>
        <div className="flex-1" />
        {selectedPath && (
          <div className="flex items-center gap-2">
            {isDirty && <span className="text-xs text-amber-500 font-medium">● Unsaved</span>}
            {saveMsg && <span className={`text-xs font-medium ${saveMsg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{saveMsg}</span>}
            <button onClick={handleSave} disabled={saving || !isDirty}
              className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors font-medium">
              {saving ? 'Saving…' : 'Save'} <span className="text-indigo-300 ml-1">⌘S</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — file tree */}
        <div className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
          {/* Sidebar toolbar */}
          <div className="flex items-center gap-1 px-2 py-2 border-b border-gray-100">
            <Breadcrumb root={root} current={currentDir} onNavigate={setCurrentDir} />
          </div>
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-100">
            {currentDir !== root && (
              <button onClick={() => setCurrentDir(currentDir.substring(0, currentDir.lastIndexOf('/')))}
                title="Up one level"
                className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
            <button onClick={() => setTreeKey(k => k + 1)} title="Refresh"
              className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button onClick={() => { setNewType('file'); setNewName(''); }} title="New file"
              className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
            <button onClick={() => { setNewType('dir'); setNewName(''); }} title="New folder"
              className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </button>
            <button onClick={() => uploadRef.current?.click()} title="Upload files"
              className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </button>
            <input ref={uploadRef} type="file" multiple className="hidden" onChange={handleUpload} />
          </div>

          {/* New item input */}
          {newType && (
            <form onSubmit={handleNewItem} className="px-2 py-1.5 border-b border-gray-100 flex items-center gap-1">
              <span className="text-sm">{newType === 'file' ? '📄' : '📁'}</span>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder={newType === 'file' ? 'filename.html' : 'folder-name'}
                onKeyDown={e => e.key === 'Escape' && setNewType(null)}
                className="flex-1 text-xs border border-indigo-400 rounded px-1.5 py-0.5 focus:outline-none font-mono" />
              <button type="submit" className="text-xs px-1.5 py-0.5 bg-indigo-600 text-white rounded hover:bg-indigo-700">✓</button>
              <button type="button" onClick={() => setNewType(null)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
            </form>
          )}

          {/* File list */}
          <div className="flex-1 overflow-y-auto">
            <FileTree
              key={`${currentDir}-${treeKey}`}
              dir={currentDir}
              root={root}
              selected={selectedPath}
              onSelect={openFile}
              onNavigate={setCurrentDir}
            />
          </div>
        </div>

        {/* Editor panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedPath ? (
            <>
              {/* File tab bar */}
              <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 text-xs text-gray-300 shrink-0 border-b border-gray-700">
                <span className="font-mono">{selectedName}</span>
                {isDirty && <span className="text-amber-400">●</span>}
                <div className="ml-auto flex items-center gap-3">
                  <button onClick={() => setLineWrap(w => !w)}
                    title="Toggle line wrap"
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      lineWrap ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                    }`}>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6h18M3 12h12a3 3 0 010 6H9l3-3m0 6l-3-3" />
                    </svg>
                    Wrap
                  </button>
                  <span className="text-gray-600 font-mono text-[10px] truncate max-w-xs">{selectedPath}</span>
                </div>
              </div>

              {loadingFile ? (
                <div className="flex-1 flex items-center justify-center bg-gray-900 text-gray-400 text-sm">Loading…</div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <CodeMirror
                    value={content}
                    height="100%"
                    theme={oneDark}
                    extensions={[langFor(selectedName), ...(lineWrap ? [EditorView.lineWrapping] : [])]}
                    onChange={val => setContent(val)}
                    basicSetup={{ lineNumbers: true, foldGutter: true }}
                    style={{ height: '100%', fontSize: '13px' }}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 text-gray-500 select-none">
              <svg className="w-12 h-12 mb-3 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">Select a file to edit</p>
              <p className="text-xs text-gray-600 mt-1">or create a new one with the toolbar above</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
