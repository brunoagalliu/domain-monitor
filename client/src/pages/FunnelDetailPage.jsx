import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import PublishToRTModal from '../components/PublishToRTModal';

const STATUS_COLORS = {
  active:  'bg-green-100 text-green-800',
  standby: 'bg-yellow-100 text-yellow-800',
  banned:  'bg-red-100 text-red-800',
};

function AddLanderPicker({ funnelId, streamId, funnelDomains, onSave, onCancel }) {
  const [allDomains,     setAllDomains]     = useState([]);
  const [selected,       setSelected]       = useState(null);
  const [query,          setQuery]          = useState('');
  const [open,           setOpen]           = useState(false);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState('');
  const [domLanders,     setDomLanders]     = useState([]);
  const [loadingLanders, setLoadingLanders] = useState(false);
  const [selectedLander, setSelectedLander] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    api.get('/domains').then(data => {
      const inFunnel = new Set(funnelDomains.map(d => d.id));
      setAllDomains((data || []).filter(d => !inFunnel.has(d.id) && d.status !== 'banned'));
    }).catch(() => setAllDomains([]))
      .finally(() => setLoading(false));
  }, [funnelDomains]);

  useEffect(() => {
    if (!selected) { setDomLanders([]); setSelectedLander(null); return; }
    setLoadingLanders(true);
    api.get(`/domains/${selected.id}/landers`)
      .then(rows => {
        setDomLanders(rows || []);
        if (rows?.length === 1) setSelectedLander(rows[0]);
        else setSelectedLander(null);
      })
      .catch(() => setDomLanders([]))
      .finally(() => setLoadingLanders(false));
  }, [selected]);

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = allDomains.filter(d => d.domain.toLowerCase().includes(query.toLowerCase()));

  async function handleAdd() {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      const body = { funnel_id: funnelId };
      if (selectedLander?.redtrack_lander_id) body.redtrack_lander_id = selectedLander.redtrack_lander_id;
      await api.patch(`/domains/${selected.id}`, body);
      if (streamId && selectedLander?.redtrack_lander_id) {
        await api.post(`/funnels/${funnelId}/stream-lander`, {
          rt_lander_id: selectedLander.redtrack_lander_id,
        }).catch(err => setError(`Added to pool — RT stream update failed: ${err.message}`));
      }
      onSave();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50 space-y-3 mt-3">
      <p className="text-xs font-medium text-gray-700">Add existing domain to this funnel's lander pool:</p>
      {loading ? (
        <p className="text-xs text-gray-400">Loading domains...</p>
      ) : allDomains.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No unassigned domains available.</p>
      ) : (
        <>
          <div ref={containerRef} className="relative">
            <div
              className={`flex items-center w-full border rounded bg-white px-3 py-1.5 text-sm cursor-text ${open ? 'ring-2 ring-indigo-500 border-indigo-400' : 'border-gray-300'}`}
              onClick={() => setOpen(true)}
            >
              {selected && !open ? (
                <span className="flex-1 text-gray-800">{selected.domain}</span>
              ) : (
                <input
                  autoFocus={open}
                  className="flex-1 outline-none bg-transparent placeholder-gray-400 text-sm"
                  placeholder={selected ? selected.domain : 'Search domains...'}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setOpen(true); }}
                  onFocus={() => setOpen(true)}
                />
              )}
              {selected && (
                <button className="ml-2 text-gray-400 hover:text-gray-600" onClick={e => { e.stopPropagation(); setSelected(null); setQuery(''); }}>✕</button>
              )}
            </div>
            {open && (
              <ul className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto">
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-gray-400 italic">No matches</li>
                ) : filtered.map(d => (
                  <li key={d.id}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 flex items-center justify-between"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setSelected(d); setQuery(''); setOpen(false); }}
                  >
                    <span className="font-mono text-xs">{d.domain}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${d.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{d.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
            loadingLanders ? (
              <p className="text-xs text-gray-400">Loading landers…</p>
            ) : domLanders.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No landers attached to this domain yet.</p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-600">Select lander:</p>
                {domLanders.map(dl => (
                  <label key={dl.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded border cursor-pointer transition-colors ${
                      selectedLander?.id === dl.id ? 'border-indigo-400 bg-white' : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <input type="radio" name="lander-pick" checked={selectedLander?.id === dl.id}
                      onChange={() => setSelectedLander(dl)} className="text-indigo-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-gray-800">{dl.redtrack_lander_title || dl.lander_name}</span>
                      {dl.subdirectory && <span className="text-xs text-gray-400 ml-1 font-mono">/{dl.subdirectory}</span>}
                    </div>
                    {dl.redtrack_lander_id ? (
                      <a href={`https://app.redtrack.io/landers/edit/${dl.redtrack_lander_id}`} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()} className="text-xs font-mono text-green-600 hover:underline shrink-0">RT ↗</a>
                    ) : (
                      <span className="text-xs text-gray-400 shrink-0">No RT</span>
                    )}
                  </label>
                ))}
              </div>
            )
          )}
        </>
      )}
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-xs text-gray-600 hover:bg-white rounded border border-gray-300 transition-colors">Cancel</button>
        <button onClick={handleAdd} disabled={!selected || saving || loading}
          className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {saving ? 'Adding...' : 'Add to Pool'}
        </button>
      </div>
    </div>
  );
}

function AddLanderForm({ domainId, currentRtLanderId, onSave, onCancel }) {
  const [domLanders, setDomLanders] = useState([]);
  const [selected,   setSelected]   = useState('');
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    api.get(`/domains/${domainId}/landers`)
      .then(rows => setDomLanders((rows || []).filter(dl => dl.redtrack_lander_id && dl.redtrack_lander_id !== currentRtLanderId)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [domainId]);

  async function handleSubmit(e) {
    e.preventDefault();
    const dl = domLanders.find(l => String(l.id) === selected);
    if (!dl) return setError('Select a lander.');
    setSaving(true); setError('');
    try {
      await api.patch(`/domains/${domainId}`, { redtrack_lander_id: dl.redtrack_lander_id });
      onSave();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex-1">
        <label className="block text-xs font-medium text-gray-600 mb-1">Lander *</label>
        {loading ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : domLanders.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No RT-linked landers — set them up in Domains first.</p>
        ) : (
          <select value={selected} onChange={e => setSelected(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">Select lander...</option>
            {domLanders.map(dl => (
              <option key={dl.id} value={dl.id}>
                {dl.redtrack_lander_title || dl.lander_name}{dl.subdirectory ? ` (/${dl.subdirectory})` : ''}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="text-red-600 text-xs self-center">{error}</p>}
      <button type="button" onClick={onCancel}
        className="px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-200 rounded transition-colors">Cancel</button>
      <button type="submit" disabled={saving || !selected || loading || domLanders.length === 0}
        className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors">
        {saving ? '…' : 'Set'}
      </button>
    </form>
  );
}

const STATUS_DOT = { active: 'bg-green-500', standby: 'bg-yellow-400', banned: 'bg-red-400' };

function DomainRow({ domain, onRotate, onDelete, onRefresh }) {
  const [landers,       setLanders]       = useState([]);
  const [expanded,      setExpanded]      = useState(false);
  const [showAddLander, setShowAddLander] = useState(false);
  const [actionState,   setActionState]   = useState({});

  const loadLanders = useCallback(async () => {
    const rows = await api.get(`/domains/${domain.id}/landers`).catch(() => []);
    setLanders(rows);
  }, [domain.id]);

  useEffect(() => { loadLanders(); }, [loadLanders]);

  const primaryLander = landers.find(l => l.redtrack_lander_id) || landers[0];

  async function handleDeploy(dl) {
    setActionState(s => ({ ...s, [dl.id]: 'deploying' }));
    try {
      await api.post(`/domains/${domain.id}/landers/${dl.id}/deploy`);
      alert(`Deployed to ${domain.domain}${dl.subdirectory ? '/' + dl.subdirectory : ''}`);
    } catch (err) { alert(`Deploy failed: ${err.message}`); }
    finally { setActionState(s => ({ ...s, [dl.id]: null })); }
  }

  async function handleRemoveLander(dl) {
    if (!confirm(`Remove lander "${dl.lander_name}" from this domain?`)) return;
    await api.delete(`/domains/${domain.id}/landers/${dl.id}`);
    loadLanders();
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${
      domain.status === 'active' ? 'border-green-200' :
      domain.status === 'banned' ? 'border-red-100 opacity-60' :
      'border-gray-200'
    }`}>
      <div className={`flex items-center gap-3 px-4 py-3 ${domain.status === 'active' ? 'bg-green-50' : 'bg-white'}`}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[domain.status]}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-gray-800 truncate">{domain.domain}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[domain.status]}`}>{domain.status}</span>
          </div>
          {primaryLander ? (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-500 truncate">
                {primaryLander.redtrack_lander_title || primaryLander.lander_name}
                {primaryLander.subdirectory ? <span className="font-mono text-gray-400">/{primaryLander.subdirectory}</span> : null}
              </span>
              {primaryLander.redtrack_lander_id
                ? <span className="text-xs text-green-600 font-medium shrink-0">✓ RT</span>
                : <span className="text-xs text-amber-500 shrink-0">not in RT</span>}
            </div>
          ) : (
            <span className="text-xs text-gray-400 mt-0.5">No lander assigned</span>
          )}
        </div>
        {domain.status === 'active' && (
          <button onClick={() => onRotate(domain.domain)}
            className="text-xs px-3 py-1.5 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors font-medium shrink-0">
            Ban &amp; Rotate
          </button>
        )}
        <button onClick={() => setExpanded(e => !e)}
          className="text-gray-300 hover:text-gray-500 transition-colors shrink-0 text-lg leading-none">
          {expanded ? '▴' : '▾'}
        </button>
        <button onClick={() => onDelete(domain.id, domain.domain)}
          className="text-gray-300 hover:text-red-500 transition-colors shrink-0 text-base leading-none">✕</button>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
          {landers.map(dl => (
            <div key={dl.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 text-gray-700 truncate">
                <span className="font-medium">{dl.redtrack_lander_title || dl.lander_name}</span>
                <span className="text-gray-400 font-mono ml-1">{dl.subdirectory ? `/${dl.subdirectory}` : '/'}</span>
                {dl.redtrack_lander_id
                  ? <a href={`https://app.redtrack.io/landers/edit/${dl.redtrack_lander_id}`} target="_blank" rel="noopener noreferrer" className="ml-2 text-green-600 font-medium hover:underline">✓ RT</a>
                  : <span className="ml-2 text-amber-500">not in RT</span>}
              </span>
              <button onClick={() => handleDeploy(dl)} disabled={!!actionState[dl.id]}
                className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50 transition-colors">
                {actionState[dl.id] === 'deploying' ? 'Deploying...' : 'Deploy'}
              </button>
              <button onClick={() => handleRemoveLander(dl)}
                className="px-2 py-0.5 text-gray-400 hover:text-red-500 transition-colors">✕</button>
            </div>
          ))}
          {showAddLander ? (
            <AddLanderForm
              domainId={domain.id}
              currentRtLanderId={domain.redtrack_lander_id}
              onSave={() => { setShowAddLander(false); loadLanders(); onRefresh(); }}
              onCancel={() => setShowAddLander(false)}
            />
          ) : (
            <button onClick={() => setShowAddLander(true)} className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors">+ Add lander</button>
          )}
        </div>
      )}
    </div>
  );
}

function LandingsCard({ funnelId, landings, domains, rotating, onRotate, onRefresh }) {
  const [editingWeight, setEditingWeight] = useState(null);
  const [savingWeight,  setSavingWeight]  = useState(null);

  async function handleWeightSave(rtLanderId) {
    const newWeight = parseInt(editingWeight.value, 10);
    if (isNaN(newWeight) || newWeight < 0) return;
    setSavingWeight(rtLanderId);
    try {
      await api.patch(`/funnels/${funnelId}/lander-weight`, { rt_lander_id: rtLanderId, weight: newWeight });
      setEditingWeight(null);
      onRefresh();
    } catch (err) { alert(`Failed: ${err.message}`); setEditingWeight(null); }
    finally { setSavingWeight(null); }
  }

  async function handleRemoveFromStream(rtLanderId) {
    if (!confirm('Remove this lander from the RT stream?')) return;
    try {
      await api.delete(`/funnels/${funnelId}/stream-lander/${rtLanderId}`);
      onRefresh();
    } catch (err) { alert(`Failed: ${err.message}`); }
  }

  const rtToDomain = {};
  for (const d of domains) {
    if (d.redtrack_lander_id) rtToDomain[String(d.redtrack_lander_id)] = d;
  }

  if (landings.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Landings</h2>
        <p className="text-xs text-gray-400 italic">No landings in this funnel template yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Landings</h2>
      <div className="space-y-2">
        {landings.map((l, i) => {
          const linked   = rtToDomain[String(l.id)];
          const weight   = l.weight ?? 100;
          const isBanned = linked?.status === 'banned';
          const isActive = weight >= 100 && !isBanned;
          const isEditing = editingWeight?.id === l.id;
          return (
            <div key={l.id} className={`flex items-start gap-3 p-3 rounded-lg border ${
              isBanned ? 'border-red-200 bg-red-50' : isActive ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50 opacity-80'
            }`}>
              <span className="text-xs font-bold text-gray-400 pt-0.5 w-4 shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${isBanned ? 'text-red-700 line-through' : isActive ? 'text-gray-800' : 'text-gray-500'}`}>
                  {l.name || `Landing ${l.id}`}
                </p>
                {linked ? (
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[linked.status]}`}>{linked.status}</span>
                    <span className="text-xs font-mono text-gray-500">{linked.domain}</span>
                    {isBanned && <span className="text-xs text-red-600 font-medium">⚠ Still in stream — remove it</span>}
                    {isActive && (
                      <button onClick={() => onRotate(linked.domain)} disabled={rotating}
                        className="text-xs px-2 py-0.5 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50 transition-colors font-medium">
                        {rotating ? 'Rotating...' : 'Rotate Now'}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-1 italic">Not linked to a domain</p>
                )}
              </div>
              {isBanned && (
                <button onClick={() => handleRemoveFromStream(l.id)}
                  className="shrink-0 text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors font-medium">
                  Remove from stream
                </button>
              )}
              {!isBanned && (
                <div className="shrink-0 flex items-center gap-1">
                  {isEditing ? (
                    <>
                      <input type="number" min="0" value={editingWeight.value}
                        onChange={e => setEditingWeight(w => ({ ...w, value: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleWeightSave(l.id); if (e.key === 'Escape') setEditingWeight(null); }}
                        autoFocus
                        className="w-16 text-xs border border-indigo-300 rounded px-1.5 py-0.5 text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button onClick={() => handleWeightSave(l.id)} disabled={savingWeight === l.id}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50">
                        {savingWeight === l.id ? '...' : '✓'}
                      </button>
                      <button onClick={() => setEditingWeight(null)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                    </>
                  ) : (
                    <button onClick={() => setEditingWeight({ id: l.id, value: String(weight) })}
                      title="Click to edit weight"
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold hover:ring-2 hover:ring-indigo-300 transition-all cursor-pointer ${
                        isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                      {weight}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OffersCard({ offers }) {
  if (offers.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Offers</h2>
        <p className="text-xs text-gray-400 italic">No offers in this funnel template.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Offers</h2>
      <div className="space-y-2">
        {offers.map((o, i) => (
          <div key={`${o.id}-${i}`} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50">
            <span className="text-xs font-bold text-gray-400 w-4 shrink-0">{i + 1}</span>
            <p className="text-sm font-medium text-gray-800 flex-1 truncate">{o.name || `Offer ${o.id}`}</p>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-400">weight</p>
              <p className="text-sm font-semibold text-gray-700">{o.weight ?? 100}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FunnelDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [funnel,      setFunnel]      = useState(null);
  const [stream,      setStream]      = useState(null);
  const [streamError, setStreamError] = useState('');
  const [loading,     setLoading]     = useState(true);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [rotating,    setRotating]    = useState(false);

  const load = useCallback(async () => {
    try {
      const f = await api.get(`/funnels/${id}`);
      setFunnel(f);
      if (f.redtrack_stream_id) {
        setStreamError('');
        try {
          const s = await api.get(`/redtrack/streams/${f.redtrack_stream_id}`);
          setStream(s);
        } catch (err) {
          setStreamError(err.message || 'Failed to load RedTrack stream');
          setStream(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function deleteDomain(domainId, domain) {
    if (!confirm(`Remove "${domain}" from this funnel?`)) return;
    await api.delete(`/domains/${domainId}`);
    load();
  }

  async function handleRotateNow(domain) {
    if (!confirm(`Ban "${domain}" and rotate to the next standby lander?`)) return;
    setRotating(true);
    try {
      const res = await api.post('/rotate/trigger', { domain, reason: 'manual' });
      const rtStatus = res.rtUpdated
        ? 'RT stream updated.'
        : res.rtWarning
          ? `Warning: RT stream not updated — ${res.rtWarning}`
          : 'RT stream not configured.';
      alert(`Rotated: ${res.fromDomain} → ${res.toDomain}\n${rtStatus}`);
      load();
    } catch (err) {
      alert(`Rotation failed: ${err.message}`);
    } finally {
      setRotating(false);
    }
  }

  if (loading) return <div className="p-6 text-gray-400">Loading...</div>;
  if (!funnel)  return <div className="p-6 text-gray-400">Funnel not found.</div>;

  const streamLandings = stream?.landings || [];
  const streamOffers   = stream?.offers   || [];
  const activeDomains  = funnel.domains.filter(d => d.status === 'active').length;
  const standbyDomains = funnel.domains.filter(d => d.status === 'standby').length;
  const bannedDomains  = funnel.domains.filter(d => d.status === 'banned').length;

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/funnels')} className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{funnel.name}</h1>
          <div className="flex items-center gap-3 mt-0.5">
            {funnel.redtrack_stream_id && (
              <span className="text-xs text-gray-400">RT stream: {funnel.redtrack_stream_id}</span>
            )}
            <div className="flex gap-3 text-xs">
              {activeDomains > 0  && <span className="text-green-600 font-medium">{activeDomains} active</span>}
              {standbyDomains > 0 && <span className="text-yellow-600 font-medium">{standbyDomains} standby</span>}
              {bannedDomains > 0  && <span className="text-red-500 font-medium">{bannedDomains} banned</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Auto-rotate</span>
            <button
              onClick={async () => {
                try {
                  const updated = await api.patch(`/funnels/${id}`, { auto_rotate: !funnel.auto_rotate });
                  setFunnel(f => ({ ...f, auto_rotate: updated.auto_rotate }));
                } catch (err) { alert(`Failed: ${err.message}`); }
              }}
              title={funnel.auto_rotate ? 'Disable auto-rotation' : 'Enable auto-rotation'}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                funnel.auto_rotate ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${
                funnel.auto_rotate ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </button>
          </div>
          {funnel.redtrack_stream_id && (
            <div className="flex gap-2">
              <button onClick={load} className="text-xs px-3 py-1.5 border border-gray-200 text-gray-500 rounded hover:bg-gray-50 transition-colors">
                Refresh from RT
              </button>
              <button onClick={async () => {
                try {
                  const r = await api.post(`/funnels/${id}/sync-from-rt`);
                  alert(`Synced — ${r.updated} domain(s) updated.`);
                  load();
                } catch (err) { alert(`Sync failed: ${err.message}`); }
              }} className="text-xs px-3 py-1.5 border border-indigo-200 text-indigo-600 rounded hover:bg-indigo-50 transition-colors">
                Sync DB from RT
              </button>
            </div>
          )}
        </div>
      </div>

      {funnel.redtrack_stream_id && streamError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          <span className="font-medium">Failed to load RedTrack stream: </span>{streamError}
        </div>
      )}
      {funnel.redtrack_stream_id && !streamError && (
        <div className="grid grid-cols-2 gap-4">
          <LandingsCard funnelId={id} landings={streamLandings} domains={funnel.domains}
            rotating={rotating} onRotate={handleRotateNow} onRefresh={load} />
          <OffersCard offers={streamOffers} />
        </div>
      )}
      {!funnel.redtrack_stream_id && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          This funnel is not linked to a RedTrack funnel template.
        </div>
      )}

      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Lander Pool</h2>
            <p className="text-xs text-gray-400 mt-0.5">Backup landers ready to rotate in. Deploy + Publish to RT to make a domain rotation-ready.</p>
          </div>
          {!showAddDomain && (
            <button onClick={() => setShowAddDomain(true)}
              className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors">
              + Add Lander
            </button>
          )}
        </div>
        {funnel.domains.length === 0 && !showAddDomain ? (
          <p className="text-sm text-gray-400 text-center py-4">No domains yet. Add one to get started.</p>
        ) : (
          <div className="space-y-2">
            {funnel.domains.map(d => (
              <DomainRow key={d.id} domain={d} onRotate={handleRotateNow} onDelete={deleteDomain} onRefresh={load} />
            ))}
          </div>
        )}
        {showAddDomain && (
          <AddLanderPicker
            funnelId={Number(id)}
            streamId={funnel.redtrack_stream_id}
            funnelDomains={funnel.domains}
            onSave={() => { setShowAddDomain(false); load(); }}
            onCancel={() => setShowAddDomain(false)}
          />
        )}
      </section>
    </div>
  );
}
