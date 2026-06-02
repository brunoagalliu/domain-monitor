import { useState, useEffect, useCallback, useRef } from 'react';
import { api, uploadLanderFile } from '../lib/api';

const CATEGORIES = ['Auto', 'Cloud'];

const CATEGORY_COLORS = {
  Auto:  'bg-blue-100 text-blue-700',
  Cloud: 'bg-purple-100 text-purple-700',
};

export default function LandersPage() {
  const [landers,   setLanders]   = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const fileRef = useRef();

  const load = useCallback(async () => {
    const data = await api.get('/landers');
    setLanders(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) { setError('Please select a .zip file.'); return; }
    setUploading(true); setError(''); setSuccess('');
    try {
      const result = await uploadLanderFile(file);
      setSuccess(`Lander "${result.name}" uploaded successfully.`);
      await load();
      fileRef.current.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleCategoryChange(id, category) {
    try {
      const updated = await api.patch(`/landers/${id}`, { category: category || null });
      setLanders(prev => prev.map(l => l.id === id ? { ...l, category: updated.category } : l));
    } catch (err) { setError(err.message); }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete lander "${name}"? This will remove the files from the server.`)) return;
    try {
      await api.delete(`/landers/${id}`);
      await load();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Landers</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Upload Lander</h2>
        <p className="text-xs text-gray-500 mb-4">
          Zip your lander folder so that <span className="font-mono">index.html</span>, CSS, JS, and images are at the root of the zip. Upload it here and it will be stored on the server ready to deploy.
        </p>
        <label className={`inline-flex items-center gap-3 cursor-pointer px-4 py-2 rounded-md border text-sm font-medium transition-colors ${uploading ? 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed' : 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          {uploading ? 'Uploading...' : 'Choose .zip file'}
          <input ref={fileRef} type="file" accept=".zip" onChange={handleFileChange} disabled={uploading} className="hidden" />
        </label>
        {error   && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {success && <p className="mt-3 text-sm text-green-600">{success}</p>}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Folder</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Uploaded</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {landers.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">No landers uploaded yet</td></tr>
            ) : landers.map(l => (
              <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-800">{l.name}</td>
                <td className="px-4 py-3">
                  <select value={l.category || ''} onChange={e => handleCategoryChange(l.id, e.target.value)}
                    className={`text-xs px-2 py-1 rounded border-0 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer ${l.category ? CATEGORY_COLORS[l.category] : 'bg-gray-100 text-gray-400'}`}>
                    <option value="">— none —</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">landers/{l.folder}/</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(l.created_at).toLocaleString()}</td>
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
