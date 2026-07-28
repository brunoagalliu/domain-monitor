import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function domainStatus(d) {
  if (d.scan_suspended) return 'suspended';
  if (d.is_flagged)     return 'flagged';
  if (d.is_suspicious)  return 'suspicious';
  if (!d.last_browser_check && d.is_priority) return 'pending';
  return 'safe';
}

function timeAgo(ts) {
  if (!ts) return null;
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STATUS_ORDER = { suspended: 0, flagged: 1, suspicious: 2, pending: 3, safe: 4 };
const STATUS_BADGE = {
  suspended: 'bg-orange-100 text-orange-800 border border-orange-300',
  flagged:   'bg-red-100 text-red-800',
  suspicious:'bg-yellow-100 text-yellow-800',
  pending:   'bg-blue-100 text-blue-800',
  safe:      'bg-green-100 text-green-800',
};
const STATUS_DOT = {
  suspended: 'bg-orange-400',
  flagged:   'bg-red-500',
  suspicious:'bg-yellow-400',
  pending:   'bg-blue-400',
  safe:      'bg-green-400',
};

const PER_PAGE_OPTIONS = [25, 50, 100];

// ── Add Domain modal ──────────────────────────────────────────────────────────

function AddDomainForm({ categories, onAdded }) {
  const [open,       setOpen]       = useState(false);
  const [domain,     setDomain]     = useState('');
  const [notes,      setNotes]      = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  function close() { setOpen(false); setDomain(''); setNotes(''); setCategoryId(''); setError(''); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await api.post('/domains', {
        domain:      domain.trim().toLowerCase(),
        notes:       notes.trim() || undefined,
        category_id: categoryId ? Number(categoryId) : undefined,
      });
      close();
      onAdded();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition-colors font-medium">
        + Add Domain
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && close()}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Add Domain to Monitor</h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Domain <span className="text-red-400">*</span></label>
                <input value={domain} onChange={e => setDomain(e.target.value)} required
                  placeholder="example.com" autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Category</label>
                <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white">
                  <option value="">— none —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              </div>
              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={close}
                  className="flex-1 px-4 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving || !domain.trim()}
                  className="flex-1 px-4 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                  {saving ? 'Adding…' : 'Add Domain'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── Category health cards ─────────────────────────────────────────────────────

function CategoryCard({ label, color, domains, active, onClick }) {
  const counts = domains.reduce((acc, d) => {
    const s = domainStatus(d);
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const bad = (counts.flagged || 0) + (counts.suspended || 0) + (counts.suspicious || 0);

  return (
    <button onClick={onClick}
      className={`shrink-0 rounded-lg border px-4 py-3 text-left transition-all min-w-[120px] ${
        active ? 'border-indigo-500 ring-2 ring-indigo-200 bg-white' : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
      }`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color || '#94a3b8' }} />
        <span className="text-xs font-semibold text-gray-700 truncate">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900 leading-none mb-1">{domains.length}</p>
      <div className="flex gap-2">
        {counts.safe > 0 && <span className="text-xs text-green-600 font-medium">{counts.safe}✓</span>}
        {bad         > 0 && <span className="text-xs text-red-600 font-medium">{bad}✗</span>}
        {counts.pending > 0 && <span className="text-xs text-blue-500 font-medium">{counts.pending}…</span>}
      </div>
    </button>
  );
}

// ── Collapsible alert strip ───────────────────────────────────────────────────

function AlertStrip({ flaggedDomains, scanning, onScan }) {
  const [expanded, setExpanded] = useState(false);
  if (!flaggedDomains.length) return null;

  const suspended = flaggedDomains.filter(d => d.scan_suspended);
  const flaggedOnly = flaggedDomains.filter(d => !d.scan_suspended && d.is_flagged);

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg overflow-hidden">
      {/* Header strip — always visible, 1 line */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" />
        <span className="text-sm font-semibold text-red-800 flex-1">
          {flaggedDomains.length} domain{flaggedDomains.length !== 1 ? 's' : ''} need attention
          {suspended.length > 0 && (
            <span className="ml-2 font-normal text-red-600">
              · {suspended.length} suspended
            </span>
          )}
          {flaggedOnly.length > 0 && (
            <span className="ml-2 font-normal text-red-600">
              · {flaggedOnly.length} flagged
            </span>
          )}
        </span>
        {/* Inline chips for first few domains — visible even when collapsed */}
        <div className="hidden sm:flex items-center gap-1.5 overflow-hidden max-w-sm">
          {flaggedDomains.slice(0, 3).map(d => (
            <span key={d.id} className="text-xs font-mono bg-red-100 text-red-700 px-2 py-0.5 rounded whitespace-nowrap">
              {d.domain}
            </span>
          ))}
          {flaggedDomains.length > 3 && (
            <span className="text-xs text-red-500 shrink-0">+{flaggedDomains.length - 3} more</span>
          )}
        </div>
        <svg className={`w-4 h-4 text-red-500 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded list — scrollable, max 6 rows */}
      {expanded && (
        <div className="border-t border-red-200 divide-y divide-red-100 max-h-52 overflow-y-auto">
          {flaggedDomains.map(d => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-2 bg-white hover:bg-red-50/50 transition-colors">
              <span className="font-mono text-xs text-gray-800 flex-1 truncate">{d.domain}</span>
              {d.scan_suspended && (
                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded shrink-0">suspended</span>
              )}
              {d.is_flagged && !d.scan_suspended && (
                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded shrink-0">flagged</span>
              )}
              {d.category_name && (
                <span className="text-xs text-gray-400 shrink-0 hidden md:block">{d.category_name}</span>
              )}
              {(d.scan_suspended || d.is_flagged) && (
                <button onClick={e => { e.stopPropagation(); onScan(d); }} disabled={scanning === d.id}
                  className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0">
                  {scanning === d.id ? '…' : 'Re-scan'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const STATUS_TABS = ['all', 'flagged', 'suspicious', 'suspended', 'pending', 'safe'];

export default function DashboardPage() {
  const [domains,    setDomains]    = useState([]);
  const [categories, setCategories] = useState([]);
  const [stats,      setStats]      = useState(null);
  const [browser,    setBrowser]    = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [scanning,   setScanning]   = useState(null);
  const [deleting,   setDeleting]   = useState(null);
  const [search,     setSearch]     = useState('');
  const [statusTab,  setStatusTab]  = useState('all');
  const [catFilter,  setCatFilter]  = useState(null);
  const [page,       setPage]       = useState(0);
  const [perPage,    setPerPage]    = useState(25);

  const load = useCallback(async () => {
    try {
      const [doms, cats, st, br] = await Promise.all([
        api.get('/domains'),
        api.get('/categories').catch(() => []),
        api.get('/stats').catch(() => null),
        api.get('/browser-status').catch(() => null),
      ]);
      setDomains(doms || []);
      setCategories(cats || []);
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

  // Reset to page 0 whenever filters change
  useEffect(() => { setPage(0); }, [search, statusTab, catFilter, perPage]);

  async function togglePriority(domain) {
    try {
      await api.patch(`/domains/${domain.id}`, { is_priority: !domain.is_priority });
      setDomains(prev => prev.map(d => d.id === domain.id ? { ...d, is_priority: !d.is_priority } : d));
    } catch (err) { alert(err.message); }
  }

  async function submitForScan(domain) {
    if (!confirm(`Submit "${domain.domain}" for re-scan?`)) return;
    setScanning(domain.id);
    try {
      const result = await api.post(`/domains/${domain.id}/scan`);
      if (result.cleared) alert(`"${domain.domain}" cleared — monitoring resumed.`);
      else alert(`"${domain.domain}" still flagged.\nBrowser: ${result.browserStatus}\nLookup: ${result.lookupFlagged ? 'flagged' : 'clean'}`);
      load();
    } catch (err) { alert(`Scan failed: ${err.message}`); }
    finally { setScanning(null); }
  }

  async function deleteDomain(domain) {
    if (!confirm(`Remove "${domain.domain}" from monitoring?`)) return;
    setDeleting(domain.id);
    try {
      await api.delete(`/domains/${domain.id}`);
      setDomains(prev => prev.filter(d => d.id !== domain.id));
    } catch (err) { alert(err.message); }
    finally { setDeleting(null); }
  }

  // Build category map + grouped lists for cards
  const catMap = {};
  for (const c of categories) catMap[c.id] = c;
  const uncategorized = domains.filter(d => !d.category_id);
  const byCat = categories
    .map(c => ({ ...c, domains: domains.filter(d => d.category_id === c.id) }))
    .filter(c => c.domains.length > 0);

  // Filtered + sorted full list
  const filtered = domains
    .filter(d => {
      if (catFilter !== null && d.category_id !== catFilter) return false;
      if (statusTab !== 'all' && domainStatus(d) !== statusTab) return false;
      if (search && !d.domain.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => (STATUS_ORDER[domainStatus(a)] ?? 9) - (STATUS_ORDER[domainStatus(b)] ?? 9));

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage   = Math.min(page, totalPages - 1);
  const pageItems  = filtered.slice(safePage * perPage, safePage * perPage + perPage);

  function tabCount(tab) {
    return domains.filter(d => {
      if (catFilter !== null && d.category_id !== catFilter) return false;
      if (search && !d.domain.toLowerCase().includes(search.toLowerCase())) return false;
      return tab === 'all' || domainStatus(d) === tab;
    }).length;
  }

  const flaggedDomains = domains.filter(d => d.scan_suspended || d.is_flagged);

  return (
    <div className="p-6 max-w-7xl space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <AddDomainForm categories={categories} onAdded={load} />
          <button onClick={load}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md hover:bg-gray-100 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total',         value: stats.total_domains },
            { label: 'Flagged',       value: stats.flagged_domains,   color: 'text-red-600' },
            { label: 'Suspended',     value: stats.suspended_domains, color: 'text-orange-600' },
            { label: 'Priority',      value: stats.priority_domains ?? domains.filter(d => d.is_priority).length, color: 'text-indigo-600' },
            { label: 'Browser Scan',  value: browser?.browser_scan_active ?? 0,  color: 'text-blue-600', sub: browser?.browserScanEnabled === false ? 'disabled' : browser?.scanRunning ? 'scanning…' : null },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-lg border border-gray-200 px-5 py-4">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color || 'text-gray-900'}`}>{s.value ?? 0}</p>
              {s.sub && <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Browser scanner */}
      {browser && (
        <div className="bg-white rounded-lg border border-gray-200 px-5 py-2.5 flex items-center gap-4 text-sm">
          <span className={`w-2 h-2 rounded-full shrink-0 ${browser.browserReady ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="text-gray-600 font-medium text-sm">
            {browser.browserReady ? 'Browser scanner ready' : 'Browser scanner offline'}
          </span>
          {browser.scanRunning && <span className="text-blue-600 text-xs">Scan running…</span>}
          {browser.lastError   && <span className="text-red-500 text-xs truncate max-w-xs">{browser.lastError}</span>}
          <span className="text-gray-400 text-xs ml-auto">
            {browser.priority} priority · {browser.suspended} suspended
          </span>
        </div>
      )}

      {/* Alert strip — collapsed by default, expands to scrollable list */}
      <AlertStrip
        flaggedDomains={flaggedDomains}
        scanning={scanning}
        onScan={submitForScan}
      />

      {/* Category health cards */}
      {(byCat.length > 0 || uncategorized.length > 0) && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">By Category</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <CategoryCard label="All" color="#6366f1" domains={domains}
              active={catFilter === null} onClick={() => setCatFilter(null)} />
            {byCat.map(c => (
              <CategoryCard key={c.id} label={c.name} color={c.color} domains={c.domains}
                active={catFilter === c.id} onClick={() => setCatFilter(catFilter === c.id ? null : c.id)} />
            ))}
            {uncategorized.length > 0 && (
              <CategoryCard label="Uncategorized" color="#94a3b8" domains={uncategorized}
                active={catFilter === 0} onClick={() => setCatFilter(catFilter === 0 ? null : 0)} />
            )}
          </div>
        </div>
      )}

      {/* Domain list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">

        {/* Status tabs */}
        <div className="border-b border-gray-100">
          <div className="flex items-center gap-0.5 px-4 pt-2.5 overflow-x-auto">
            {STATUS_TABS.map(tab => {
              const count = tabCount(tab);
              const isAlert = (tab === 'flagged' || tab === 'suspended') && count > 0;
              return (
                <button key={tab} onClick={() => setStatusTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t-md whitespace-nowrap transition-colors ${
                    statusTab === tab
                      ? 'bg-indigo-600 text-white'
                      : isAlert
                        ? 'text-red-600 hover:bg-red-50'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}>
                  {tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  <span className={`ml-1 ${statusTab === tab ? 'opacity-75' : isAlert ? 'text-red-400' : 'text-gray-400'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search + per-page */}
          <div className="px-4 py-2 flex items-center gap-3">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search domains…"
              className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            {catFilter !== null && (
              <button onClick={() => setCatFilter(null)}
                className="text-xs text-indigo-600 hover:text-indigo-800 whitespace-nowrap shrink-0">
                ✕ Clear filter
              </button>
            )}
            <select value={perPage} onChange={e => setPerPage(Number(e.target.value))}
              className="text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none shrink-0">
              {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <span className="text-xs text-gray-400 shrink-0">{filtered.length} total</span>
          </div>
        </div>

        {/* Table */}
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Domain</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Status</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Category</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Browser</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Checked</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">★</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading…</td></tr>
            ) : pageItems.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">No domains match</td></tr>
            ) : pageItems.map(d => {
              const st  = domainStatus(d);
              const cat = catMap[d.category_id];
              return (
                <tr key={d.id} className={`hover:bg-gray-50 transition-colors ${
                  st === 'flagged' || st === 'suspended' ? 'bg-red-50/40' :
                  st === 'suspicious' ? 'bg-yellow-50/40' : ''
                }`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[st]}`} />
                      <span className="font-mono text-xs text-gray-800">{d.domain}</span>
                    </div>
                    {d.notes && (
                      <p className="text-xs text-gray-400 mt-0.5 pl-3 truncate max-w-[200px]" title={d.notes}>{d.notes}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[st]}`}>{st}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {cat ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-gray-700">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                        {cat.name}
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{d.browser_status || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {timeAgo(
                      [d.last_browser_check, d.last_lookup_check]
                        .filter(Boolean)
                        .sort()
                        .at(-1)
                    ) || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => togglePriority(d)}
                      title={d.is_priority ? 'Remove priority' : 'Add to priority'}
                      className="text-base leading-none hover:scale-110 transition-transform">
                      {d.is_priority ? '⭐' : '☆'}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {(d.scan_suspended || d.is_flagged) && (
                        <button onClick={() => submitForScan(d)} disabled={scanning === d.id}
                          className="text-xs px-2 py-0.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                          {scanning === d.id ? '…' : 'Re-scan'}
                        </button>
                      )}
                      <button onClick={() => deleteDomain(d)} disabled={deleting === d.id}
                        title="Remove from monitoring"
                        className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40 text-sm leading-none px-0.5">
                        {deleting === d.id ? '…' : '✕'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        {filtered.length > perPage && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-xs text-gray-400">
              {safePage * perPage + 1}–{Math.min(safePage * perPage + perPage, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button disabled={safePage === 0} onClick={() => setPage(0)}
                className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors">
                «
              </button>
              <button disabled={safePage === 0} onClick={() => setPage(p => p - 1)}
                className="px-2.5 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors">
                ‹ Prev
              </button>
              {/* Page number pills */}
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const pageNum = totalPages <= 7 ? i :
                  safePage < 4 ? i :
                  safePage > totalPages - 5 ? totalPages - 7 + i :
                  safePage - 3 + i;
                return (
                  <button key={pageNum} onClick={() => setPage(pageNum)}
                    className={`px-2.5 py-1 text-xs border rounded transition-colors ${
                      pageNum === safePage
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                    {pageNum + 1}
                  </button>
                );
              })}
              <button disabled={safePage >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                className="px-2.5 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors">
                Next ›
              </button>
              <button disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}
                className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors">
                »
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
