import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

const STATUS_COLORS = {
  success: 'bg-green-100 text-green-800',
  failed:  'bg-red-100 text-red-800',
};

const LIMIT = 50;

export default function HistoryPage() {
  const [data,    setData]    = useState({ rows: [], total: 0 });
  const [offset,  setOffset]  = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/history?limit=${LIMIT}&offset=${offset}`);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rotation History</h1>
          <p className="text-sm text-gray-500 mt-1">{data.total} total rotations</p>
        </div>
        <button onClick={load} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">Refresh</button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">When</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">From</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">To</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Lander</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Trigger</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : data.rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">No rotations yet</td></tr>
            ) : data.rows.map(h => (
              <tr key={h.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                  {new Date(h.rotated_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-red-500">{h.from_domain || '—'}</td>
                <td className="px-4 py-3 font-mono text-xs text-green-600">
                  {h.to_domain || <span className="text-red-400 not-italic font-sans">banned</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{h.lander_name || '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs capitalize">{h.trigger_source?.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[h.status] || 'bg-gray-100 text-gray-600'}`}>
                    {h.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-red-500 text-xs max-w-xs truncate" title={h.error || ''}>{h.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.total > LIMIT && (
        <div className="flex items-center justify-center gap-4 mt-4">
          <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 transition-colors">
            Previous
          </button>
          <span className="text-sm text-gray-500">
            {offset + 1}–{Math.min(offset + LIMIT, data.total)} of {data.total}
          </span>
          <button disabled={offset + LIMIT >= data.total} onClick={() => setOffset(o => o + LIMIT)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 transition-colors">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
