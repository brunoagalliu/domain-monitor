import { useState } from 'react';
import { api } from '../lib/api';

const LANDER_TYPES = [
  { value: 'l',  label: 'Landing' },
  { value: 'p',  label: 'Pre-Landing' },
  { value: 'll', label: 'Listicle Landing' },
  { value: 'lp', label: 'Listicle Pre-Landing' },
];

export default function PublishToRTModal({ domainId, dl, onSuccess, onClose }) {
  const defaultUrl = dl.subdirectory
    ? `https://${dl.domain}/${dl.subdirectory}`
    : `https://${dl.domain}`;
  const defaultTitle = `${dl.lander_name} - ${dl.domain}${dl.subdirectory ? '/' + dl.subdirectory : ''}`;

  const [title,  setTitle]  = useState(defaultTitle);
  const [url,    setUrl]    = useState(defaultUrl);
  const [type,   setType]   = useState('l');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return setError('Name and URL are required.');
    setSaving(true);
    setError('');
    try {
      const res = await api.post(`/domains/${domainId}/landers/${dl.id}/publish`, {
        title: title.trim(),
        url:   url.trim(),
        type,
      });
      onSuccess(res.redtrack_lander);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Publish to RedTrack</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-5">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name *</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800 mb-3">Type</p>
              <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                {LANDER_TYPES.map((t, i) => (
                  <button key={t.value} type="button" onClick={() => setType(t.value)}
                    className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${i > 0 ? 'border-l border-gray-300' : ''} ${type === t.value ? 'bg-gray-100 text-gray-900' : 'bg-white text-gray-400 hover:bg-gray-50'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">URL *</label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                required
                placeholder="https://example.com"
                className="w-full border border-gray-300 rounded-md px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
            <button type="button" onClick={onClose} className="px-5 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-md font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Publishing...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
