import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

const METHOD_LABEL = {
  browser:    'Chrome',
  lookup_api: 'Lookup API',
};

const THREAT_COLORS = {
  SOCIAL_ENGINEERING: 'bg-red-100 text-red-700',
  MALWARE:            'bg-red-100 text-red-700',
  CHROME_BROWSING:    'bg-orange-100 text-orange-700',
};

export default function LogsPage() {
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit,   setLimit]   = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/logs?limit=${limit}`);
      setLogs(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Flag Logs</h1>
          <p className="text-sm text-gray-500 mt-1">Domains detected as flagged or suspicious</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={200}>Last 200</option>
            <option value={500}>Last 500</option>
          </select>
          <button onClick={load} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">Refresh</button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">When</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Domain</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Method</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Threat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">No flag events recorded</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                  {new Date(log.detected_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-800">{log.domain}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{log.category || '—'}</td>
                <td className="px-4 py-3">
                  {log.method
                    ? <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                        {METHOD_LABEL[log.method] ?? log.method}
                      </span>
                    : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  {log.threat_type
                    ? <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${THREAT_COLORS[log.threat_type] || 'bg-gray-100 text-gray-600'}`}>
                        {log.threat_type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                    : <span className="text-gray-300 text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
