import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

const STATUS_ORDER = { suspended: 0, flagged: 1, suspicious: 2, unknown: 3, pending: 4, safe: 5 };

function domainStatus(d) {
  if (d.scan_suspended) return 'suspended';
  if (d.is_flagged)     return 'flagged';
  if (d.is_suspicious)  return 'suspicious';
  if (!d.last_browser_check && d.is_priority) return 'pending';
  return 'safe';
}

const STATUS_BADGE = {
  suspended: 'bg-orange-100 text-orange-800 border border-orange-300',
  flagged:   'bg-red-100 text-red-800',
  suspicious:'bg-yellow-100 text-yellow-800',
  pending:   'bg-blue-100 text-blue-800',
  safe:      'bg-green-100 text-green-800',
};

export default function DashboardPage() {
  const [domains,     setDomains]     = useState([]);
  const [stats,       setStats]       = useState(null);
  const [browser,     setBrowser]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [scanning,    setScanning]    = useState(null);
  const [search,      setSearch]      = useState('');

  const load = useCallback(async () => {
    try {
      const [doms, st, br] = await Promise.all([
        api.get('/domains'),
        api.get('/stats').catch(() => null),
        api.get('/browser-status').catch(() => null),
      ]);
      setDomains(doms || []);
      setStats(st);
      setBrowser(br);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  async function togglePriority(domain) {
    try {
      await api.patch(`/domains/${domain.id}`, { is_priority: !domain.is_priority });
      setDomains(prev => prev.map(d => d.id === domain.id ? { ...d, is_priority: !d.is_priority } : d));
    } catch (err) { alert(err.message); }
  }

  async function submitForScan(domain) {
    if (!confirm(`Submit "${domain.domain}" for re-scan? This will run both browser and Lookup API checks.`)) return;
    setScanning(domain.id);
    try {
      const result = await api.post(`/domains/${domain.id}/scan`);
      if (result.cleared) {
        alert(`Domain "${domain.domain}" cleared! Monitoring resumed.`);
      } else {
        alert(`Domain "${domain.domain}" still flagged.\nBrowser: ${result.browserStatus}\nLookup API: ${result.lookupFlagged ? 'flagged' : 'clean'}`);
      }
      load();
    } catch (err) {
      alert(`Scan failed: ${err.message}`);
    } finally {
      setScanning(null);
    }
  }

  const sorted = [...domains]
    .sort((a, b) => (STATUS_ORDER[domainStatus(a)] ?? 9) - (STATUS_ORDER[domainStatus(b)] ?? 9))
    .filter(d => !search || d.domain.includes(search.toLowerCase()));

  const priorityDomains = domains.filter(d => d.is_priority);
  const flaggedDomains  = domains.filter(d => d.scan_suspended || d.is_flagged);

  return (
    <div className="p-6 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <button onClick={load} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md hover:bg-gray-100 transition-colors">Refresh</button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Domains', value: stats.total_domains },
            { label: 'Flagged', value: stats.flagged_domains, color: 'text-red-600' },
            { label: 'Priority', value: stats.priority_domains ?? priorityDomains.length, color: 'text-indigo-600' },
            { label: 'Suspended', value: stats.suspended_domains, color: 'text-orange-600' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-lg border border-gray-200 px-5 py-4">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color || 'text-gray-900'}`}>{s.value ?? 0}</p>
            </div>
          ))}
        </div>
      )}

      {/* Browser scanner status */}
      {browser && (
        <div className="bg-white rounded-lg border border-gray-200 px-5 py-3 flex items-center gap-4 text-sm">
          <span className={`w-2 h-2 rounded-full shrink-0 ${browser.browserReady ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="text-gray-600 font-medium">{browser.browserReady ? 'Browser scanner ready' : 'Browser scanner offline'}</span>
          {browser.scanRunning && <span className="text-blue-600 text-xs">Scan running…</span>}
          {browser.lastError && <span className="text-red-500 text-xs truncate">{browser.lastError}</span>}
          <span className="text-gray-400 text-xs ml-auto">{browser.priority} priority · {browser.suspended} suspended</span>
        </div>
      )}

      {/* Flagged alert */}
      {flaggedDomains.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-red-800 mb-3">Action Required — {flaggedDomains.length} domain{flaggedDomains.length !== 1 ? 's' : ''} flagged</h2>
          <div className="space-y-2">
            {flaggedDomains.map(d => (
              <div key={d.id} className="flex items-center justify-between bg-white rounded border border-red-100 px-3 py-2">
                <div>
                  <span className="font-mono text-sm text-gray-800">{d.domain}</span>
                  {d.scan_suspended && <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">suspended</span>}
                  {d.is_flagged && !d.scan_suspended && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">flagged</span>}
                  {d.category_name && <span className="ml-2 text-xs text-gray-400">{d.category_name}</span>}
                </div>
                {d.scan_suspended && (
                  <button
                    onClick={() => submitForScan(d)}
                    disabled={scanning === d.id}
                    className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {scanning === d.id ? 'Scanning…' : 'Submit for Scan'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Priority domains panel */}
      {priorityDomains.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-indigo-800 mb-3">Priority Domains ({priorityDomains.length}) — Browser scanned every 30s</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {priorityDomains.map(d => {
              const st = domainStatus(d);
              return (
                <div key={d.id} className="bg-white rounded border border-indigo-100 px-3 py-2 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${st === 'safe' ? 'bg-green-400' : st === 'flagged' || st === 'suspended' ? 'bg-red-400' : 'bg-yellow-300'}`} />
                  <span className="font-mono text-xs text-gray-700 truncate flex-1">{d.domain}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Domain list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter domains…"
            className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-xs text-gray-400">{sorted.length} domains</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Domain</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Browser</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Priority</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">No domains found</td></tr>
            ) : sorted.map(d => {
              const st = domainStatus(d);
              return (
                <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-800">{d.domain}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[st]}`}>{st}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{d.category_name || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{d.browser_status || '—'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => togglePriority(d)}
                      title={d.is_priority ? 'Remove from priority' : 'Add to priority'}
                      className="text-lg leading-none hover:scale-110 transition-transform"
                    >
                      {d.is_priority ? '⭐' : '☆'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {d.scan_suspended && (
                      <button
                        onClick={() => submitForScan(d)}
                        disabled={scanning === d.id}
                        className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {scanning === d.id ? 'Scanning…' : 'Submit for Scan'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
