import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import PublishToRTModal from '../components/PublishToRTModal';
import DomainHealthModal from '../components/DomainHealthModal';

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
    <div className="flex flex-wrap gap-1">
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

const TYPE_COLORS = {
  brand:       'bg-blue-100 text-blue-700',
  'non-brand': 'bg-violet-100 text-violet-700',
};

function TypeBadge({ type }) {
  if (!type) return null;
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${TYPE_COLORS[type] || 'bg-gray-100 text-gray-500'}`}>
      {type}
    </span>
  );
}

function DomainForm({ initial = {}, landers, onSave, onClose }) {
  const isEdit = !!initial.id;
  const [form, setForm] = useState({
    domain:      initial.domain      || '',
    doc_root:    initial.doc_root    || '',
    status:      initial.status      || 'standby',
    domain_type: initial.domain_type || '',
    lander_id:   initial.lander_id   || '',
    priority:    initial.priority    ?? 0,
    notes:       initial.notes       || '',
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
      const body = { ...form, lander_id: form.lander_id ? Number(form.lander_id) : null, priority: Number(form.priority), domain_type: form.domain_type || null };
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
        <label className="block text-xs font-medium text-gray-700 mb-1">Domain Type</label>
        <div className="flex gap-2">
          {[['', 'Uncategorized'], ['brand', 'Brand'], ['non-brand', 'Non-Brand']].map(([val, label]) => (
            <button key={val} type="button" onClick={() => set('domain_type', val)}
              className={`flex-1 py-2 text-xs font-medium rounded-md border transition-colors ${
                form.domain_type === val
                  ? val === 'brand'     ? 'bg-blue-600 text-white border-blue-600'
                  : val === 'non-brand' ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-gray-700 text-white border-gray-700'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
              }`}>
              {label}
            </button>
          ))}
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

function RTLanderPicker({ onSelect, onCancel }) {
  const [rtLanders, setRtLanders] = useState(null);
  const [query,     setQuery]     = useState('');
  const [open,      setOpen]      = useState(false);
  const [error,     setError]     = useState('');
  const ref = useRef(null);

  useEffect(() => {
    api.get('/redtrack/landings')
      .then(data => setRtLanders((data.items || data || []).map(l => ({ id: l.id || l._id, title: l.title || l.name || l.id }))))
      .catch(err => setError(err.message));
  }, []);

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = (rtLanders || []).filter(l => l.title.toLowerCase().includes(query.toLowerCase())).slice(0, 50);

  if (error) return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
      <span className="text-xs text-red-500">RT error: {error}</span>
      <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 underline">Cancel</button>
    </div>
  );

  if (!rtLanders) return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
      <span className="text-xs text-gray-400">Loading RT landers…</span>
      <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 underline">Cancel</button>
    </div>
  );

  return (
    <div className="mt-2 pt-2 border-t border-gray-100">
      <div ref={ref} className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <input
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search RT landers…"
            className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {open && filtered.length > 0 && (
            <div className="absolute z-20 top-full left-0 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg">
              {filtered.map(l => (
                <button key={l.id} type="button"
                  onMouseDown={e => { e.preventDefault(); onSelect(l); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 hover:text-indigo-700 transition-colors border-b border-gray-50 last:border-0">
                  <span className="font-medium">{l.title}</span>
                  <span className="ml-2 text-gray-400 font-mono">{String(l.id).slice(0, 8)}…</span>
                </button>
              ))}
            </div>
          )}
          {open && rtLanders.length > 0 && filtered.length === 0 && (
            <div className="absolute z-20 top-full left-0 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg px-3 py-2 text-xs text-gray-400">
              No landers match "{query}"
            </div>
          )}
        </div>
        <button onClick={onCancel}
          className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors whitespace-nowrap">
          Cancel
        </button>
      </div>
    </div>
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

  async function handleLinkRT(dlId, rtLander) {
    setLinkSaving(true);
    try {
      await api.patch(`/domains/${domain.id}/landers/${dlId}`, {
        redtrack_lander_id:    rtLander.id,
        redtrack_lander_title: rtLander.title,
      });
      setLinkingId(null);
      load(); onChanged();
    } catch (err) { alert(`Link failed: ${err.message}`); }
    finally { setLinkSaving(false); }
  }

  if (landers === null) {
    return <tr><td colSpan={9} className="px-8 py-2 bg-gray-50 text-xs text-gray-400">Loading landers…</td></tr>;
  }

  return (
    <>
      <tr>
        <td colSpan={9} className="px-0 py-0 bg-gray-50 border-b border-gray-200">
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
                                RT #{dl.redtrack_lander_id.slice(0, 8)}…
                              </a>
                              <button onClick={() => setLinkingId(dl.id)}
                                className="text-xs text-gray-400 hover:text-gray-600 underline">re-link</button>
                            </>
                          ) : (
                            <button onClick={() => setLinkingId(dl.id)}
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
                    {linkingId === dl.id && !linkSaving && (
                      <RTLanderPicker
                        onSelect={rtLander => handleLinkRT(dl.id, rtLander)}
                        onCancel={() => setLinkingId(null)}
                      />
                    )}
                    {linkingId === dl.id && linkSaving && (
                      <p className="mt-2 text-xs text-gray-400 pt-2 border-t border-gray-100">Saving…</p>
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

const CF_STATUS_STYLE = {
  active:  { dot: 'bg-orange-400', label: 'CF active' },
  pending: { dot: 'bg-yellow-400', label: 'CF pending' },
};

function CfBadge({ zone }) {
  if (!zone) return null;
  const style = CF_STATUS_STYLE[zone.status] || { dot: 'bg-gray-300', label: `CF ${zone.status}` };
  return (
    <span title={style.label} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-600 border border-orange-100">
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot} shrink-0`} />
      CF
    </span>
  );
}

const STATUS_TABS = ['all', 'active', 'standby', 'banned'];
const TYPE_TABS   = [
  { key: 'all',        label: 'All types' },
  { key: 'brand',      label: 'Brand' },
  { key: 'non-brand',  label: 'Non-Brand' },
  { key: 'none',       label: 'Uncategorized' },
];
const PER_PAGE_OPTIONS = [25, 50, 100];

const PROVISION_STEPS = [
  { key: 'cloudflare_zone',    label: 'Add to Cloudflare' },
  { key: 'dns_a_record',       label: 'Set A record' },
  { key: 'origin_certificate', label: 'Generate SSL origin certificate' },
  { key: 'cpanel_domain',      label: 'Add domain in cPanel' },
  { key: 'cpanel_ssl',         label: 'Install SSL in cPanel' },
];

function ProvisionModal({ onClose, onProvisioned }) {
  const [domain, setDomain] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);

  async function run() {
    if (!domain.trim()) return;
    setRunning(true);
    setSteps([]);
    setResult(null);
    try {
      const data = await api.post('/provision', { domain: domain.trim().toLowerCase() });
      setSteps(data.steps || []);
      setResult(data);
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setRunning(false);
    }
  }

  function stepStatus(key) {
    return steps.find(s => s.step === key);
  }

  function StepIcon({ s }) {
    if (!s) return <span className="w-5 h-5 rounded-full border-2 border-gray-200 inline-block" />;
    if (s.status === 'error') return <span className="text-red-500 font-bold">✕</span>;
    if (s.status === 'skipped') return <span className="text-yellow-500">—</span>;
    return <span className="text-green-500 font-bold">✓</span>;
  }

  return (
    <Modal title="Provision New Domain" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <input
            value={domain}
            onChange={e => setDomain(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !running && run()}
            placeholder="example.com"
            disabled={running}
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          />
          <button onClick={run} disabled={running || !domain.trim()}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {running ? 'Running…' : 'Provision'}
          </button>
        </div>

        {(running || steps.length > 0) && (
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            {PROVISION_STEPS.map(({ key, label }) => {
              const s = stepStatus(key);
              const pending = !s && running;
              return (
                <div key={key} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-5 text-center shrink-0">
                    {pending ? <span className="inline-block w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" /> : <StepIcon s={s} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${s?.status === 'error' ? 'text-red-600' : 'text-gray-700'}`}>{label}</p>
                    {s?.error && <p className="text-xs text-red-500 mt-0.5 truncate">{s.error}</p>}
                    {s?.ip && <p className="text-xs text-gray-400 mt-0.5">→ {s.ip}</p>}
                  </div>
                  {s && <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                    s.status === 'error'   ? 'bg-red-100 text-red-700' :
                    s.status === 'exists'  ? 'bg-gray-100 text-gray-500' :
                    s.status === 'skipped' ? 'bg-yellow-50 text-yellow-600' :
                    'bg-green-100 text-green-700'
                  }`}>{s.status}</span>}
                </div>
              );
            })}
          </div>
        )}

        {result?.success && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
            <p className="font-semibold mb-1">Domain provisioned successfully</p>
            {result.docRoot && <p className="text-xs text-green-700 font-mono">{result.docRoot}</p>}
            <button onClick={() => { onProvisioned?.(domain.trim()); onClose(); }}
              className="mt-3 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 transition-colors">
              Add to Monitor →
            </button>
          </div>
        )}

        {result && !result.success && !steps.length && (
          <p className="text-sm text-red-600">{result.error}</p>
        )}
      </div>
    </Modal>
  );
}

export default function DomainsPage() {
  const navigate = useNavigate();
  const [domains,   setDomains]   = useState([]);
  const [landers,   setLanders]   = useState([]);
  const [filter,     setFilter]     = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search,     setSearch]     = useState('');
  const [modal,      setModal]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [rotating,  setRotating]  = useState(false);
  const [deploying, setDeploying] = useState(null);
  const [expanded,  setExpanded]  = useState(new Set());
  const [page,      setPage]      = useState(0);
  const [perPage,   setPerPage]   = useState(25);
  const [sortKey,     setSortKey]     = useState('domain');
  const [sortDir,     setSortDir]     = useState('asc');
  const [cfZones,     setCfZones]     = useState({});
  const [healthDomain, setHealthDomain] = useState(null);
  const [showProvision, setShowProvision] = useState(false);

  const load = useCallback(async () => {
    try {
      const [doms, lands] = await Promise.all([api.get('/domains'), api.get('/landers')]);
      setDomains(doms);
      setLanders(lands);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.get('/cloudflare/zones')
      .then(zones => {
        const map = {};
        (zones || []).forEach(z => { map[z.name] = z; });
        setCfZones(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleExpanded(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  // Type counts always from full list so the type pills show totals
  const typeCounts = useMemo(() => domains.reduce((acc, d) => {
    const k = d.domain_type || 'none';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {}), [domains]);

  // Base list after applying type filter — status counts and status filter both work from this
  const typeFiltered = useMemo(() => {
    if (typeFilter === 'all') return domains;
    return domains.filter(d => typeFilter === 'none' ? !d.domain_type : d.domain_type === typeFilter);
  }, [domains, typeFilter]);

  // Status counts reflect current type filter
  const counts = useMemo(() =>
    typeFiltered.reduce((acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {}),
  [typeFiltered]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? typeFiltered : typeFiltered.filter(d => d.status === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(d =>
        d.domain.toLowerCase().includes(q) ||
        (d.funnel_name || '').toLowerCase().includes(q) ||
        (d.lander_name || '').toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      let av = a[sortKey] ?? '';
      let bv = b[sortKey] ?? '';
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [typeFiltered, filter, search, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated  = filtered.slice(page * perPage, (page + 1) * perPage);

  function resetPage() { setPage(0); }
  function handleFilterChange(t)     { setFilter(t); resetPage(); }
  function handleTypeFilterChange(t) { setTypeFilter(t); resetPage(); }
  function handleSearchChange(e)     { setSearch(e.target.value); resetPage(); }
  function handlePerPageChange(e)    { setPerPage(Number(e.target.value)); resetPage(); }

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

  function SortTh({ label, colKey, className = '' }) {
    const active = sortKey === colKey;
    return (
      <th onClick={() => handleSort(colKey)}
        className={`text-left px-3 py-2.5 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900 whitespace-nowrap ${className}`}>
        {label}
        <span className="ml-1 text-gray-300">
          {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </th>
    );
  }

  const start = page * perPage + 1;
  const end   = Math.min((page + 1) * perPage, filtered.length);

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Domain Pool</h1>
          <div className="flex gap-4 mt-1 text-sm">
            <span className="text-green-600 font-medium">{counts.active || 0} active</span>
            <span className="text-yellow-600 font-medium">{counts.standby || 0} standby</span>
            <span className="text-red-600 font-medium">{counts.banned || 0} banned</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowProvision(true)}
            className="bg-white border border-indigo-300 text-indigo-600 px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-50 transition-colors">
            ⚡ Provision Domain
          </button>
          <button onClick={() => setModal('add')}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors">
            + Add Domain
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Type pills */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {TYPE_TABS.map(({ key, label }) => {
            const count = key === 'all' ? domains.length : (typeCounts[key] || 0);
            const active = typeFilter === key;
            return (
              <button key={key} onClick={() => handleTypeFilterChange(key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? key === 'brand'     ? 'bg-blue-600 text-white shadow-sm'
                    : key === 'non-brand' ? 'bg-violet-600 text-white shadow-sm'
                    : key === 'none'      ? 'bg-gray-700 text-white shadow-sm'
                    : 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}>
                {label} <span className="ml-0.5 opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Status tabs */}
        <div className="flex gap-1">
          {STATUS_TABS.map(t => (
            <button key={t} onClick={() => handleFilterChange(t)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                filter === t
                  ? 'bg-indigo-600 text-white'
                  : t === 'banned' && (counts.banned || 0) > 0
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-gray-600 hover:bg-gray-100'
              }`}>
              {t} ({t === 'all' ? typeFiltered.length : counts[t] || 0})
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-48 max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={search} onChange={handleSearchChange}
            placeholder="Search domains, funnels…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          {search && (
            <button onClick={() => { setSearch(''); resetPage(); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>
          )}
        </div>

        {/* Per-page selector */}
        <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
          <span>Show</span>
          <select value={perPage} onChange={handlePerPageChange}
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500">
            {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="w-8 px-3 py-2.5"></th>
              <SortTh label="Domain"   colKey="domain"      />
              <SortTh label="Status"   colKey="status"      />
              <th className="text-left px-3 py-2.5 font-medium text-gray-600">Threats</th>
              <SortTh label="Funnel"   colKey="funnel_name" />
              <SortTh label="Lander"   colKey="lander_name" />
              <SortTh label="Priority" colKey="priority"    />
              <SortTh label="Added"    colKey="added_at"    />
              <th className="text-left px-3 py-2.5 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={9} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : paginated.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-10 text-gray-400">
                {search ? `No domains match "${search}"` : 'No domains found'}
              </td></tr>
            ) : paginated.map(d => (
              <>
                <tr key={d.id} className={`hover:bg-gray-50 transition-colors ${d.status === 'banned' ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleExpanded(d.id)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      title={expanded.has(d.id) ? 'Collapse' : 'Expand landers'}>
                      <svg className={`w-3.5 h-3.5 transition-transform ${expanded.has(d.id) ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-gray-800">{d.domain}</span>
                      <TypeBadge type={d.domain_type} />
                      <CfBadge zone={cfZones[d.domain]} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[d.status]}`}>{d.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    <ThreatBadges raw={d.threat_types} isSuspicious={d.is_suspicious} detectionMethod={d.detection_method} />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-32 truncate" title={d.funnel_name || ''}>
                    {d.funnel_name || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-28 truncate" title={d.lander_name || ''}>
                    {d.lander_name || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400 text-center">{d.priority ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">
                    {d.added_at ? new Date(d.added_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {d.lander_name && (
                        <button onClick={() => handleDeploy(d.id, d.domain)} disabled={deploying === d.id}
                          className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50 transition-colors">
                          {deploying === d.id ? 'Deploying...' : 'Deploy'}
                        </button>
                      )}
                      {(d.status === 'active' || d.status === 'standby') && (
                        <button onClick={() => handleRotateNow(d.domain)} disabled={rotating}
                          className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded hover:bg-orange-200 disabled:opacity-50 transition-colors">
                          Rotate
                        </button>
                      )}
                      {d.status === 'banned' && (
                        <button onClick={() => handleRestore(d.id)}
                          className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors">
                          Restore
                        </button>
                      )}
                      <button onClick={() => setHealthDomain(d)}
                        className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition-colors"
                        title="Domain health: Cloudflare, GSC, Recovery">Health</button>
                      <button onClick={() => navigate(`/files/${d.id}`)}
                        className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                        title="Open file manager">Files</button>
                      <button onClick={() => setModal(d)}
                        className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors">Edit</button>
                      <button onClick={() => handleDelete(d.id, d.domain)}
                        className="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors">Del</button>
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

        {/* Pagination footer */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-500">
            <span>{start}–{end} of {filtered.length}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(0)} disabled={page === 0}
                className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs">«</button>
              <button onClick={() => setPage(p => p - 1)} disabled={page === 0}
                className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs">‹</button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const p = totalPages <= 7 ? i : Math.max(0, Math.min(page - 3, totalPages - 7)) + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`px-2.5 py-1 rounded text-xs transition-colors ${p === page ? 'bg-indigo-600 text-white' : 'hover:bg-gray-200'}`}>
                    {p + 1}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
                className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs">›</button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs">»</button>
            </div>
          </div>
        )}
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

      {healthDomain && (
        <DomainHealthModal
          domain={healthDomain}
          cfZone={cfZones[healthDomain.domain] || null}
          onClose={() => setHealthDomain(null)}
        />
      )}

      {showProvision && (
        <ProvisionModal
          onClose={() => setShowProvision(false)}
          onProvisioned={provisionedDomain => {
            setModal({ domain: provisionedDomain });
          }}
        />
      )}
    </div>
  );
}
