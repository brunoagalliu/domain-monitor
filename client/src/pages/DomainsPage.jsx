import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import PublishToRTModal from '../components/PublishToRTModal';

const STATUS_COLORS = {
  active:  'bg-green-100 text-green-800',
  standby: 'bg-yellow-100 text-yellow-800',
  banned:  'bg-red-100 text-red-800',
};

const METHOD_LABEL = {
  browser:    'Chrome',
  lookup_api: 'Lookup API',
};

function ThreatBadges({ raw, isSuspicious, detectionMethod }) {
  let threats = [];
  if (raw) {
    try { threats = JSON.parse(raw); } catch (e) {}
    if (!Array.isArray(threats)) threats = [];
  }
  let methods = [];
  if (detectionMethod) {
    try { methods = JSON.parse(detectionMethod); } catch (e) { methods = [detectionMethod]; }
    if (!Array.isArray(methods)) methods = [methods];
  }
  if (threats.length === 0 && methods.length === 0 && !isSuspicious) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {methods.map(m => (
        <span key={m} className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
          {METHOD_LABEL[m] ?? m}
        </span>
      ))}
      {isSuspicious && (
        <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">suspicious</span>
      )}
      {threats.map(t => (
        <span key={t} className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
          {String(t).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
        </span>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function DomainForm({ initial = {}, landers, onSave, onClose }) {
  const isEdit = !!initial.id;
  const [form, setForm] = useState({
    domain:    initial.domain    || '',
    doc_root:  initial.doc_root  || '',
    status:    initial.status    || 'standby',
    lander_id: initial.lander_id || '',
    priority:  initial.priority  ?? 0,
    notes:     initial.notes     || '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function handleDomainBlur(e) {
    const d = e.target.value.toLowerCase().trim();
    set('domain', d);
    if (!isEdit && !form.doc_root && d) set('doc_root', `public_html/${d}`);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const body = { ...form, lander_id: form.lander_id ? Number(form.lander_id) : null, priority: Number(form.priority) };
      if (isEdit) await api.patch(`/domains/${initial.id}`, body);
      else await api.post('/domains', body);
      onSave();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Domain *</label>
          <input value={form.domain} onChange={e => set('domain', e.target.value)} onBlur={handleDomainBlur}
            required placeholder="example.com"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select value={form.status} onChange={e => set('status', e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="standby">Standby</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">cPanel Doc Root *</label>
        <input value={form.doc_root} onChange={e => set('doc_root', e.target.value)} required
          placeholder="public_html/example.com"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <p className="text-xs text-gray-400 mt-1">Path relative to your cPanel home directory</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lander</label>
          <select value={form.lander_id} onChange={e => set('lander_id', e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">None</option>
            {landers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
          <input type="number" value={form.priority} onChange={e => set('priority', e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <p className="text-xs text-gray-400 mt-1">Higher = picked first</p>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional notes"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex justify-end gap-3 pt-1">
        <button type="button" onClick={onClose}
          className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors">Cancel</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Domain'}
        </button>
      </div>
    </form>
  );
}

function LandersSubRow({ domain, allLanders, onChanged }) {
  const [landers,      setLanders]      = useState(null);
  const [adding,       setAdding]       = useState(false);
  const [newLander,    setNewLander]    = useState('');
  const [newSubdir,    setNewSubdir]    = useState('');
  const [addErr,       setAddErr]       = useState('');
  const [deploying,    setDeploying]    = useState(null);
  const [publishingDl, setPublishingDl] = useState(null);
  const [linkingId,    setLinkingId]    = useState(null);
  const [linkInput,    setLinkInput]    = useState('');
  const [linkSaving,   setLinkSaving]   = useState(false);

  const load = useCallback(async () => {
    const rows = await api.get(`/domains/${domain.id}/landers`);
    setLanders(rows);
  }, [domain.id]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!newLander) return;
    setAddErr('');
    try {
      await api.post(`/domains/${domain.id}/landers`, { lander_id: Number(newLander), subdirectory: newSubdir.trim() });
      setNewLander(''); setNewSubdir(''); setAdding(false);
      load();
    } catch (err) { setAddErr(err.message); }
  }

  async function handleRemove(dlId) {
    if (!confirm('Remove this lander from the domain?')) return;
    await api.delete(`/domains/${domain.id}/landers/${dlId}`);
    load(); onChanged();
  }

  async function handleDeploy(dl) {
    if (!confirm(`Deploy "${dl.lander_name}" to ${domain.domain}${dl.subdirectory ? '/' + dl.subdirectory : ''}?`)) return;
    setDeploying(dl.id);
    try {
      await api.post(`/domains/${domain.id}/landers/${dl.id}/deploy`);
      alert('Deployed successfully.');
    } catch (err) { alert(`Deploy failed: ${err.message}`); }
    finally { setDeploying(null); }
  }

  async function handleLinkRT(dlId) {
    if (!linkInput.trim()) return;
    setLinkSaving(true);
    try {
      await api.patch(`/domains/${domain.id}/landers/${dlId}`, { redtrack_lander_id: linkInput.trim() });
      setLinkingId(null); setLinkInput('');
      load(); onChanged();
    } catch (err) { alert(`Link failed: ${err.message}`); }
    finally { setLinkSaving(false); }
  }

  if (landers === null) {
    return <tr><td colSpan={10} className="px-8 py-2 bg-gray-50 text-xs text-gray-400">Loading landers…</td></tr>;
  }

  return (
    <>
      <tr>
        <td colSpan={10} className="px-0 py-0 bg-gray-50 border-b border-gray-200">
          <div className="px-8 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Landers</span>
              <button onClick={() => { setAdding(a => !a); setAddErr(''); }}
                className="text-xs px-2 py-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition-colors">
                {adding ? 'Cancel' : '+ Add Lander'}
              </button>
            </div>
            {landers.length === 0 && !adding && <p className="text-xs text-gray-400 italic">No landers assigned yet.</p>}
            {landers.length > 0 && (
              <div className="space-y-1 mb-2">
                {landers.map(dl => (
                  <div key={dl.id} className="bg-white rounded border border-gray-200 px-3 py-2">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-800">{dl.redtrack_lander_title || dl.lander_name}</span>
                          {dl.subdirectory && <span className="text-xs font-mono text-gray-400">/{dl.subdirectory}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {dl.redtrack_lander_id ? (
                            <>
                              <a href={`https://app.redtrack.io/landers/edit/${dl.redtrack_lander_id}`} target="_blank" rel="noopener noreferrer"
                                className="text-xs font-mono text-green-600 hover:underline">
                                RT #{dl.redtrack_lander_id.slice(0, 10)}…
                              </a>
                              <button onClick={() => { setLinkingId(dl.id); setLinkInput(dl.redtrack_lander_id); }}
                                className="text-xs text-gray-400 hover:text-gray-600 underline">re-link</button>
                            </>
                          ) : (
                            <button onClick={() => { setLinkingId(dl.id); setLinkInput(''); }}
                              className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded hover:bg-gray-200 transition-colors">
                              + Link RT
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => handleDeploy(dl)} disabled={deploying === dl.id}
                          className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50 transition-colors">
                          {deploying === dl.id ? 'Deploying…' : 'Deploy'}
                        </button>
                        <button onClick={() => setPublishingDl({ ...dl, domain: domain.domain })}
                          className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors">
                          Publish to RT
                        </button>
                        <button onClick={() => handleRemove(dl.id)}
                          className="text-xs px-2 py-0.5 bg-red-50 text-red-500 rounded hover:bg-red-100 transition-colors">
                          Remove
                        </button>
                      </div>
                    </div>
                    {linkingId === dl.id && (
                      <div className="mt-2 flex items-center gap-1.5 pt-2 border-t border-gray-100">
                        <input value={linkInput} onChange={e => setLinkInput(e.target.value)}
                          placeholder="Paste RT lander ID…" autoFocus
                          className="text-xs border border-gray-300 rounded px-2 py-1 w-56 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                        <button onClick={() => handleLinkRT(dl.id)} disabled={linkSaving || !linkInput.trim()}
                          className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                          {linkSaving ? '…' : 'Save'}
                        </button>
                        <button onClick={() => { setLinkingId(null); setLinkInput(''); }}
                          className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors">Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {adding && (
              <form onSubmit={handleAdd} className="flex items-end gap-2 mt-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Lander</label>
                  <select value={newLander} onChange={e => setNewLander(e.target.value)} required
                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500">
                    <option value="">Select lander…</option>
                    {allLanders.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Subdirectory (optional)</label>
                  <input value={newSubdir} onChange={e => setNewSubdir(e.target.value)} placeholder="e.g. lander2"
                    className="border border-gray-300 rounded px-2 py-1 text-xs font-mono w-32 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
                <button type="submit" className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 transition-colors">Add</button>
                {addErr && <span className="text-xs text-red-500">{addErr}</span>}
              </form>
            )}
          </div>
        </td>
      </tr>
      {publishingDl && (
        <PublishToRTModal
          domainId={domain.id}
          dl={publishingDl}
          onSuccess={() => { setPublishingDl(null); load(); onChanged(); }}
          onClose={() => setPublishingDl(null)}
        />
      )}
    </>
  );
}

const TABS = ['all', 'active', 'standby', 'banned'];

export default function DomainsPage() {
  const [domains,   setDomains]   = useState([]);
  const [landers,   setLanders]   = useState([]);
  const [filter,    setFilter]    = useState('all');
  const [modal,     setModal]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [rotating,  setRotating]  = useState(false);
  const [deploying, setDeploying] = useState(null);
  const [expanded,  setExpanded]  = useState(new Set());

  const load = useCallback(async () => {
    try {
      const [doms, lands] = await Promise.all([api.get('/domains'), api.get('/landers')]);
      setDomains(doms);
      setLanders(lands);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleExpanded(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const counts   = domains.reduce((acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {});
  const filtered = filter === 'all' ? domains : domains.filter(d => d.status === filter);

  async function handleDelete(id, domain) {
    if (!confirm(`Remove "${domain}" from the pool?`)) return;
    await api.delete(`/domains/${id}`);
    load();
  }

  async function handleRestore(id) {
    await api.patch(`/domains/${id}`, { status: 'standby', banned_at: null });
    load();
  }

  async function handleDeploy(id, domain) {
    if (!confirm(`Deploy lander to "${domain}" via cPanel?`)) return;
    setDeploying(id);
    try {
      await api.post(`/domains/${id}/deploy`);
      alert(`Lander deployed to ${domain} successfully.`);
    } catch (err) { alert(`Deploy failed: ${err.message}`); }
    finally { setDeploying(null); }
  }

  async function handleRotateNow(domain) {
    if (!confirm(`Manually trigger rotation away from "${domain}"?`)) return;
    setRotating(true);
    try {
      const res = await api.post('/rotate/trigger', { domain, reason: 'manual' });
      alert(`Rotated successfully:\n${res.fromDomain} → ${res.toDomain}`);
      load();
    } catch (err) { alert(`Rotation failed: ${err.message}`); }
    finally { setRotating(false); }
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Domain Pool</h1>
          <div className="flex gap-4 mt-1 text-sm">
            <span className="text-green-600 font-medium">{counts.active || 0} active</span>
            <span className="text-yellow-600 font-medium">{counts.standby || 0} standby</span>
            <span className="text-red-600 font-medium">{counts.banned || 0} banned</span>
          </div>
        </div>
        <button onClick={() => setModal('add')}
          className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors">
          + Add Domain
        </button>
      </div>

      <div className="flex gap-1 mb-4">
        {TABS.map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
              filter === t ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}>
            {t} ({t === 'all' ? domains.length : counts[t] || 0})
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="w-6 px-4 py-3"></th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Domain</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Threats</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Lander</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Priority</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Added</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">No domains found</td></tr>
            ) : filtered.map(d => (
              <>
                <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <button onClick={() => toggleExpanded(d.id)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      title={expanded.has(d.id) ? 'Collapse' : 'Expand landers'}>
                      <svg className={`w-4 h-4 transition-transform ${expanded.has(d.id) ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-800">{d.domain}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[d.status]}`}>{d.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <ThreatBadges raw={d.threat_types} isSuspicious={d.is_suspicious} detectionMethod={d.detection_method} />
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{d.lander_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{d.priority}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {d.added_at ? new Date(d.added_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {d.lander_name && (
                        <button onClick={() => handleDeploy(d.id, d.domain)} disabled={deploying === d.id}
                          className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50 transition-colors">
                          {deploying === d.id ? 'Deploying...' : 'Deploy'}
                        </button>
                      )}
                      {d.status === 'active' && (
                        <button onClick={() => handleRotateNow(d.domain)} disabled={rotating}
                          className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200 disabled:opacity-50 transition-colors">
                          Rotate Now
                        </button>
                      )}
                      {d.status === 'banned' && (
                        <button onClick={() => handleRestore(d.id)}
                          className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors">
                          Restore
                        </button>
                      )}
                      <button onClick={() => setModal(d)}
                        className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors">Edit</button>
                      <button onClick={() => handleDelete(d.id, d.domain)}
                        className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors">Delete</button>
                    </div>
                  </td>
                </tr>
                {expanded.has(d.id) && (
                  <LandersSubRow key={`landers-${d.id}`} domain={d} allLanders={landers} onChanged={load} />
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal === 'add' ? 'Add Domain' : `Edit: ${modal.domain}`} onClose={() => setModal(null)}>
          <DomainForm
            initial={modal === 'add' ? {} : modal}
            landers={landers}
            onSave={() => { setModal(null); load(); }}
            onClose={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
