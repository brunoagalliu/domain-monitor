import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export default function LandersPage() {
  const [landers, setLanders]   = useState([]);
  const [form,    setForm]      = useState({ name: '', cpanel_path: '' });
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState('');
  const [editId,  setEditId]    = useState(null);
  const [editPath, setEditPath] = useState('');

  const load = useCallback(async () => {
    const data = await api.get('/landers');
    setLanders(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.cpanel_path.trim()) return;
    setSaving(true); setError('');
    try {
      await api.post('/landers/cpanel', { name: form.name.trim(), cpanel_path: form.cpanel_path.trim() });
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
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Landers</h1>
      <p className="text-sm text-gray-500 mb-6">
        Each lander points to a folder already on your cPanel hosting. The Deploy button copies that folder to a domain's doc root.
      </p>

      {/* Add lander form */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Add Lander</h2>
        <form onSubmit={handleAdd} className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-40">
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Auto Lander"
              required
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex-[2] min-w-60">
            <label className="block text-xs font-medium text-gray-600 mb-1">cPanel Source Path</label>
            <input
              value={form.cpanel_path}
              onChange={e => setForm(f => ({ ...f, cpanel_path: e.target.value }))}
              placeholder="e.g. public_html/templates/auto"
              required
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {saving ? 'Adding…' : 'Add Lander'}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <p className="mt-3 text-xs text-gray-400">
          The path is relative to your cPanel home directory. You can find it in the File Manager — e.g. if your template is at <span className="font-mono">/home/user/public_html/templates/auto</span>, enter <span className="font-mono">public_html/templates/auto</span>.
        </p>
      </div>

      {/* Landers table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">cPanel Source Path</th>
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
                      <input
                        value={editPath}
                        onChange={e => setEditPath(e.target.value)}
                        autoFocus
                        className="border border-indigo-300 rounded px-2 py-1 text-xs font-mono flex-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <button onClick={() => handleSavePath(l.id)}
                        className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors">Save</button>
                      <button onClick={() => setEditId(null)}
                        className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditId(l.id); setEditPath(l.cpanel_path || ''); }}
                      className="font-mono text-xs text-gray-500 hover:text-indigo-600 transition-colors text-left">
                      {l.cpanel_path || <span className="text-gray-300 italic">not set — click to add</span>}
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
