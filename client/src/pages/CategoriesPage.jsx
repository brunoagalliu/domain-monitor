import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

const PRESET_COLORS = [
  '#667eea', '#f093fb', '#4facfe', '#43e97b', '#fa709a',
  '#ffecd2', '#a18cd1', '#fda085', '#84fab0', '#30cfd0',
];

export default function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [name,       setName]       = useState('');
  const [color,      setColor]      = useState('#667eea');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.get('/categories');
      setCategories(data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError('');
    try {
      await api.post('/categories', { name: name.trim(), color });
      setName(''); setColor('#667eea');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Categories</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Add Category</h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Auto, Finance, Health"
                required
                maxLength={50}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="w-10 h-9 rounded border border-gray-300 cursor-pointer p-0.5"
                />
                <span className="text-xs font-mono text-gray-500">{color}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={c}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={saving || !name.trim()}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {saving ? 'Adding...' : 'Add Category'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Domains</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Safe</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Flagged</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : categories.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">No categories yet</td></tr>
            ) : categories.map(c => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    <span className="font-medium text-gray-800">{c.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{c.domain_count}</td>
                <td className="px-4 py-3">
                  {c.safe_count > 0
                    ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">{c.safe_count}</span>
                    : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  {c.flagged_count > 0
                    ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">{c.flagged_count}</span>
                    : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(c.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
