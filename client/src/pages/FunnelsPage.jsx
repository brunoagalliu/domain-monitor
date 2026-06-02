import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

function SearchSelect({ value, options, placeholder, onChange }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect]   = useState(null);
  const triggerRef        = useRef(null);
  const dropdownRef       = useRef(null);
  const inputRef          = useRef(null);

  const selected = options.find(o => o.id === value);
  const filtered = options.filter(o => (o.title || '').toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (triggerRef.current?.contains(e.target) || dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleOpen() {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    setOpen(o => !o); setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div ref={triggerRef} className="flex-1 min-w-0">
      <div onClick={handleOpen} className={`flex items-center gap-2 border rounded-md px-3 py-2 text-sm cursor-pointer bg-white transition-colors ${open ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-300 hover:border-gray-400'}`}>
        <span className={`flex-1 truncate ${selected ? 'text-gray-800' : 'text-gray-400'}`}>{selected ? selected.title : placeholder}</span>
        {selected && <button onClick={e => { e.stopPropagation(); onChange(null); }} className="text-gray-300 hover:text-gray-500 shrink-0">×</button>}
        <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {open && rect && createPortal(
        <div ref={dropdownRef} style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search..."
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="max-h-52 overflow-y-auto">
            <div onClick={() => { onChange(null); setOpen(false); }} className="px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 cursor-pointer">None</div>
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-400 italic">No results</p>
            ) : filtered.map(opt => (
              <div key={opt.id} onClick={() => { onChange(opt); setOpen(false); }}
                className={`px-3 py-2 text-sm cursor-pointer truncate transition-colors ${opt.id === value ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>
                {opt.title}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const CATEGORIES = ['Auto', 'Cloud'];
const CATEGORY_COLORS = { Auto: 'bg-blue-100 text-blue-700', Cloud: 'bg-purple-100 text-purple-700' };
const FUNNEL_TYPES = [
  { value: 'single_landing', label: 'Single landing' },
  { value: 'multi_landing',  label: 'Multi landing' },
  { value: 'offers_only',    label: 'Offers only' },
];

function ItemRow({ index, item, rtOptions, onChange, onRemove }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-gray-500 w-5 shrink-0">{index + 1}</span>
        <SearchSelect value={item.id} options={rtOptions} placeholder="Select..."
          onChange={opt => onChange({ ...item, id: opt?.id || '', name: opt?.title || '' })} />
        <div className="flex items-center gap-1 shrink-0">
          <label className="text-xs text-gray-400">Weight</label>
          <input type="number" min="1" value={item.weight} onChange={e => onChange({ ...item, weight: Number(e.target.value) })}
            className="w-16 border border-gray-300 rounded-md px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
}

function FunnelModal({ stream, onSave, onClose }) {
  const isEdit = !!stream;
  function inferType(s) {
    if (!s?.landings?.length) return 'offers_only';
    if (s.landings.length === 1) return 'single_landing';
    return 'multi_landing';
  }

  const [title,      setTitle]      = useState(stream?.title || '');
  const [type,       setType]       = useState(isEdit ? inferType(stream) : 'single_landing');
  const [landings,   setLandings]   = useState(stream?.landings?.length ? stream.landings.map(l => ({ id: String(l.id), name: l.name || '', weight: l.weight ?? 100 })) : [{ id: '', name: '', weight: 100 }]);
  const [offers,     setOffers]     = useState(stream?.offers?.length ? stream.offers.map(o => ({ id: String(o.id), name: o.name || '', weight: o.weight ?? 100 })) : [{ id: '', name: '', weight: 100 }]);
  const [rtLandings, setRtLandings] = useState([]);
  const [rtOffers,   setRtOffers]   = useState([]);
  const [loadingRt,  setLoadingRt]  = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    Promise.all([api.get('/redtrack/landings').catch(() => []), api.get('/redtrack/offers').catch(() => [])])
      .then(([l, o]) => { setRtLandings(Array.isArray(l) ? l : []); setRtOffers(Array.isArray(o) ? o : []); })
      .finally(() => setLoadingRt(false));
  }, []);

  async function handleSave() {
    if (!title.trim()) return setError('Title is required.');
    const validOffers = offers.filter(o => o.id);
    if (validOffers.length === 0) return setError('At least one offer is required.');
    setSaving(true); setError('');
    try {
      const payload = {
        title: title.trim(), type,
        landings: landings.filter(l => l.id).map(({ id, weight }) => ({ id, weight })),
        offers:   validOffers.map(({ id, weight }) => ({ id, weight })),
      };
      if (isEdit) {
        const updated = await api.put(`/redtrack/streams/${stream.id}`, payload);
        onSave(updated);
      } else {
        const created = await api.post('/redtrack/streams', payload);
        const funnel = await api.post('/funnels/by-stream', { redtrack_stream_id: created.id, title: created.title });
        onSave(funnel);
      }
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Funnel</h2>
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving || loadingRt} className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-md font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={onClose} className="px-5 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors">Close</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          <div className="px-6 py-5 border-b border-gray-100 space-y-4">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title *"
              className="w-full border border-gray-300 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {FUNNEL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {loadingRt ? (
            <div className="px-6 py-8 text-sm text-gray-400 text-center">Loading RedTrack data...</div>
          ) : (
            <div className={`grid divide-x divide-gray-200 ${type === 'offers_only' ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {type !== 'offers_only' && (
                <div className="px-6 py-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-800">Landings</h3>
                    <button onClick={() => setLandings(p => [...p, { id: '', name: '', weight: 100 }])} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded hover:bg-green-600 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg> ADD
                    </button>
                  </div>
                  <div className="space-y-2">
                    {landings.map((l, i) => (
                      <ItemRow key={i} index={i} item={l} rtOptions={rtLandings}
                        onChange={u => setLandings(p => p.map((x, j) => j === i ? u : x))}
                        onRemove={() => setLandings(p => p.filter((_, j) => j !== i))} />
                    ))}
                  </div>
                </div>
              )}
              <div className="px-6 py-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-800">Offers</h3>
                  <button onClick={() => setOffers(p => [...p, { id: '', name: '', weight: 100 }])} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded hover:bg-green-600 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg> ADD
                  </button>
                </div>
                <div className="space-y-2">
                  {offers.map((o, i) => (
                    <ItemRow key={i} index={i} item={o} rtOptions={rtOffers}
                      onChange={u => setOffers(p => p.map((x, j) => j === i ? u : x))}
                      onRemove={() => setOffers(p => p.filter((_, j) => j !== i))} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 shrink-0">
          {error ? <p className="text-red-600 text-sm">{error}</p> : <span />}
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving || loadingRt} className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-md font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={onClose} className="px-5 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FunnelsPage() {
  const navigate = useNavigate();
  const [streams,       setStreams]       = useState([]);
  const [localFunnels,  setLocalFunnels]  = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [managing,      setManaging]      = useState(null);
  const [showCreate,    setShowCreate]    = useState(false);
  const [editingStream, setEditingStream] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [data, funnels] = await Promise.all([api.get('/redtrack/streams'), api.get('/funnels').catch(() => [])]);
      setStreams(data);
      setLocalFunnels(Array.isArray(funnels) ? funnels : []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCategoryChange(funnel, category) {
    try {
      await api.patch(`/funnels/${funnel.id}`, { category: category || null });
      setLocalFunnels(prev => prev.map(f => f.id === funnel.id ? { ...f, category: category || null } : f));
    } catch (err) { alert(err.message); }
  }

  async function handleManage(stream) {
    setManaging(stream.id);
    try {
      const funnel = await api.post('/funnels/by-stream', { redtrack_stream_id: stream.id, title: stream.title });
      navigate(`/funnels/${funnel.id}`);
    } catch (err) { alert(err.message); }
    finally { setManaging(null); }
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Funnel Templates</h1>
          <p className="text-sm text-gray-500 mt-1">Your RedTrack funnel templates</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md hover:bg-gray-100 transition-colors">Refresh</button>
          <button onClick={() => setShowCreate(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors">+ New Template</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading funnel templates...</div>
      ) : error ? (
        <div className="text-center py-16 text-red-500">{error}</div>
      ) : streams.length === 0 ? (
        <div className="text-center py-16 text-gray-400">No funnel templates found in RedTrack.</div>
      ) : (
        <div className="grid gap-3">
          {streams.map(s => {
            const localFunnel = localFunnels.find(f => String(f.redtrack_stream_id) === String(s.id));
            return (
              <div key={s.id} className="bg-white rounded-lg border border-gray-200 px-5 py-4 flex items-center gap-4 hover:border-indigo-200 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{s.title}</p>
                </div>
                <div className="flex items-center gap-5 text-xs text-gray-500 shrink-0">
                  <span><span className="font-medium text-gray-700">{s.landings?.length ?? 0}</span> lander{s.landings?.length !== 1 ? 's' : ''}</span>
                  <span><span className="font-medium text-gray-700">{s.offers?.length ?? 0}</span> offer{s.offers?.length !== 1 ? 's' : ''}</span>
                </div>
                {localFunnel && (
                  <select value={localFunnel.category || ''} onChange={e => handleCategoryChange(localFunnel, e.target.value)}
                    className={`text-xs px-2 py-1 rounded border-0 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shrink-0 ${localFunnel.category ? CATEGORY_COLORS[localFunnel.category] : 'bg-gray-100 text-gray-400'}`}>
                    <option value="">— none —</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <button onClick={() => setEditingStream(s)} className="text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors font-medium shrink-0">Edit</button>
                <button onClick={() => handleManage(s)} disabled={managing === s.id}
                  className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium shrink-0">
                  {managing === s.id ? 'Opening...' : 'Manage'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && <FunnelModal onSave={f => { setShowCreate(false); navigate(`/funnels/${f.id}`); }} onClose={() => setShowCreate(false)} />}
      {editingStream && (
        <FunnelModal stream={editingStream}
          onSave={updated => { setStreams(p => p.map(s => s.id === updated.id ? updated : s)); setEditingStream(null); }}
          onClose={() => setEditingStream(null)} />
      )}
    </div>
  );
}
