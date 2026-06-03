import { useState, useEffect, useCallback, useRef } from 'react';
import { api, uploadLanderFile } from '../lib/api';

export default function LandersPage() {
  const [landers,   setLanders]   = useState([]);
  const [tab,       setTab]       = useState('zip'); // 'zip' | 'cpanel'
  const [form,      setForm]      = useState({ name: '', cpanel_path: '' });
  const [saving,    setSaving]    = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [editId,    setEditId]    = useState(null);
  const [editPath,  setEditPath]  = useState('');
  const fileRef = useRef();

  const load = useCallback(async () => {
    const data = await api.get('/landers');
    setLanders(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleZipUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) { setError('Please select a .zip file.'); return; }
    setUploading(true); setError(''); setSuccess('');
    try {
      const result = await uploadLanderFile(file);
      setSuccess(`"${result.name}" uploaded and stored on Railway.`);
      await load();
      fileRef.current.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleAddCpanel(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.cpanel_path.trim()) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      await api.post('/landers/cpanel', { name: form.name.trim(), cpanel_path: form.cpanel_path.trim() });
      setSuccess(`"${form.name}" added.`);
      setForm({ name: '', cpanel_path: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePath(id) {
    try {
      const updated = await api.patch(`/landers/${id}`, { cpanel_path: editPath.trim() || null });
      setLanders(prev => prev.map(l => l.id === id ? updated : l));
      setEditId(null);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete lander "${name}"?`)) return;
    try {
      await api.delete(`/landers/${id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Landers</h1>

      {/* Add lander card */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <div className="flex gap-1 mb-4 border-b border-gray-100 pb-3">
          <button onClick={() => { setTab('zip'); setError(''); setSuccess(''); }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'zip' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            Upload zip
          </button>
          <button onClick={() => { setTab('cpanel'); setError(''); setSuccess(''); }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'cpanel' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            cPanel path
          </button>
        </div>

        {tab === 'zip' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">
              Zip your lander so <span className="font-mono">index.html</span> / <span className="font-mono">index.php</span> is at the root. Stored on the Railway volume — survives deploys.
            </p>
            <label className={`inline-flex items-center gap-2 cursor-pointer px-4 py-2 rounded-md border text-sm font-medium transition-colors ${
              uploading ? 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed'
                       : 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {uploading ? 'Uploading…' : 'Choose .zip file'}
              <input ref={fileRef} type="file" accept=".zip" onChange={handleZipUpload} disabled={uploading} className="hidden" />
            </label>
          </div>
        )}

        {tab === 'cpanel' && (
          <form onSubmit={handleAddCpanel} className="space-y-3">
            <p className="text-xs text-gray-500">
              Point to a folder already on your cPanel hosting. Deploy will copy it to the target domain.
            </p>
            <div className="flex gap-3 flex-wrap items-end">
              <div className="flex-1 min-w-36">
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Auto" required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="flex-[2] min-w-52">
                <label className="block text-xs font-medium text-gray-600 mb-1">cPanel path</label>
                <input value={form.cpanel_path} onChange={e => setForm(f => ({ ...f, cpanel_path: e.target.value }))}
                  placeholder="public_html/templates/auto" required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <button type="submit" disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {saving ? 'Adding…' : 'Add'}
              </button>
            </div>
          </form>
        )}

        {error   && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {success && <p className="mt-3 text-sm text-green-600">{success}</p>}
      </div>

      {/* Landers table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Added</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {landers.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-10 text-gray-400">No landers yet</td></tr>
            ) : landers.map(l => (
              <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-800">{l.name}</td>
                <td className="px-4 py-3">
                  {editId === l.id ? (
                    <div className="flex items-center gap-2">
                      <input value={editPath} onChange={e => setEditPath(e.target.value)} autoFocus
                        placeholder="public_html/templates/auto or leave blank for zip"
                        className="border border-indigo-300 rounded px-2 py-1 text-xs font-mono flex-1 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      <button onClick={() => handleSavePath(l.id)}
                        className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700">Save</button>
                      <button onClick={() => setEditId(null)}
                        className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditId(l.id); setEditPath(l.cpanel_path || ''); }}
                      className="text-left hover:text-indigo-600 transition-colors">
                      {l.cpanel_path
                        ? <span className="font-mono text-xs text-gray-500">{l.cpanel_path}</span>
                        : <span className="font-mono text-xs text-gray-400">
                            {l.folder ? `Railway: landers/${l.folder}/` : <em className="not-italic text-gray-300">not set</em>}
                          </span>}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                  {new Date(l.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => handleDelete(l.id, l.name)}
                    className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
