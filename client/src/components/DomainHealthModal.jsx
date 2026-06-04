import { useState, useEffect } from 'react';
import { api } from '../lib/api';

const RECOVERY_STEPS = [
  { key: 'cleaning',      label: 'Cleaning',      color: 'bg-yellow-500',  text: 'text-yellow-700',  bg: 'bg-yellow-50',  border: 'border-yellow-200' },
  { key: 'submitted',     label: 'Submitted',     color: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200' },
  { key: 'under_review',  label: 'Under Review',  color: 'bg-purple-500',  text: 'text-purple-700',  bg: 'bg-purple-50',  border: 'border-purple-200' },
  { key: 'resolved',      label: 'Resolved',      color: 'bg-green-500',   text: 'text-green-700',   bg: 'bg-green-50',   border: 'border-green-200' },
];

function stepFor(key) {
  return RECOVERY_STEPS.find(s => s.key === key) || { label: key, color: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' };
}

function SectionHeader({ children }) {
  return (
    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{children}</h3>
  );
}

function SslBadge({ ssl }) {
  if (!ssl || ssl.length === 0) return <span className="text-xs text-gray-400">No SSL data</span>;
  const pack = ssl.find(p => p.status === 'active') || ssl[0];
  const cert = pack?.certificates?.[0];
  const expiry = cert?.expires_on ? new Date(cert.expires_on) : null;
  const daysLeft = expiry ? Math.ceil((expiry - Date.now()) / 86400000) : null;
  const color = !expiry ? 'text-gray-400'
    : daysLeft < 0   ? 'text-red-600'
    : daysLeft < 30  ? 'text-yellow-600'
    : 'text-green-600';

  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-medium ${color}`}>
        {pack.status === 'active' ? '✓ SSL Active' : `⚠ SSL ${pack.status}`}
      </span>
      {expiry && (
        <span className="text-xs text-gray-400">
          · expires {expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {daysLeft >= 0 ? ` (${daysLeft}d)` : ' (expired)'}
        </span>
      )}
    </div>
  );
}

export default function DomainHealthModal({ domain, cfZone: cfZoneProp, onClose }) {
  const [cfZone,    setCfZone]     = useState(cfZoneProp || null);
  const [cfDetails, setCfDetails]  = useState(null);
  const [cfLoading, setCfLoading]  = useState(false);
  const [gscStatus, setGscStatus]  = useState(null);
  const [gscSites,  setGscSites]   = useState(null);
  const [gscError,  setGscError]   = useState('');
  const [verifying, setVerifying]  = useState(false);
  const [recovery,  setRecovery]   = useState(null);
  const [note,      setNote]       = useState('');
  const [adding,    setAdding]     = useState(false);
  const [clearing,  setClearing]   = useState(false);

  useEffect(() => {
    // If zone wasn't pre-loaded, look it up directly
    const zonePromise = cfZoneProp
      ? Promise.resolve(cfZoneProp)
      : api.get(`/cloudflare/domain/${domain.domain}`).catch(() => null);

    zonePromise.then(zone => {
      if (zone) {
        setCfZone(zone);
        setCfLoading(true);
        api.get(`/cloudflare/zones/${zone.id}`)
          .then(data => setCfDetails(data))
          .catch(() => {})
          .finally(() => setCfLoading(false));
      }
    });

    // Load GSC status + sites
    api.get('/gsc/status').then(s => {
      setGscStatus(s);
      if (s.connected) {
        api.get('/gsc/sites').then(sites => setGscSites(sites)).catch(() => setGscSites([]));
      }
    }).catch(() => setGscStatus({ connected: false }));
    // Load recovery
    api.get(`/recovery/${domain.id}`).then(setRecovery).catch(() => setRecovery({ recovery_status: null, logs: [] }));
  }, [domain.id]);

  const isInGsc = gscSites?.some(s =>
    s.siteUrl === `sc-domain:${domain.domain}` ||
    s.siteUrl === `https://${domain.domain}/` ||
    s.siteUrl === `http://${domain.domain}/`
  );

  async function handleVerify() {
    if (!cfZone?.id) return;
    if (!confirm(`Add "${domain.domain}" to Google Search Console and verify via Cloudflare DNS?`)) return;
    setVerifying(true); setGscError('');
    try {
      await api.post('/gsc/verify', { domain: domain.domain, zoneId: cfZone.id });
      const sites = await api.get('/gsc/sites');
      setGscSites(sites);
    } catch (err) {
      setGscError(err.message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleDisconnectGsc() {
    if (!confirm('Disconnect Google account? You will need to reconnect to use GSC features.')) return;
    await api.delete('/gsc/disconnect').catch(() => {});
    setGscStatus({ connected: false });
    setGscSites(null);
  }

  async function handleAddLog(status) {
    setAdding(true);
    try {
      const updated = await api.post(`/recovery/${domain.id}/log`, { status, note });
      setRecovery(updated);
      setNote('');
    } catch (err) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleClear() {
    if (!confirm('Clear all recovery history for this domain?')) return;
    setClearing(true);
    try {
      await api.delete(`/recovery/${domain.id}`);
      setRecovery({ recovery_status: null, logs: [] });
    } finally {
      setClearing(false);
    }
  }

  const currentStep = recovery?.recovery_status ? stepFor(recovery.recovery_status) : null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900 font-mono">{domain.domain}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Domain Health</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">

          {/* ── Cloudflare ── */}
          <div>
            <SectionHeader>Cloudflare</SectionHeader>
            {!cfZone ? (
              <p className="text-xs text-gray-400">Domain not found in your Cloudflare account.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${cfZone.status === 'active' ? 'bg-orange-400' : 'bg-yellow-400'}`} />
                  <span className="text-xs font-medium text-gray-700">Zone {cfZone.status}</span>
                  <span className="text-xs text-gray-400 font-mono">· {cfZone.id}</span>
                </div>
                {cfLoading && <p className="text-xs text-gray-400">Loading SSL info…</p>}
                {cfDetails && <SslBadge ssl={cfDetails.ssl} />}
              </div>
            )}
          </div>

          {/* ── Google Search Console ── */}
          <div>
            <SectionHeader>Google Search Console</SectionHeader>
            {!gscStatus ? (
              <p className="text-xs text-gray-400">Checking…</p>
            ) : !gscStatus.connected ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Google account not connected.</p>
                <a href="/api/gsc/auth" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
                  Connect Google Account
                </a>
              </div>
            ) : gscSites === null ? (
              <p className="text-xs text-gray-400">Loading GSC sites…</p>
            ) : isInGsc ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                  <span className="text-xs font-medium text-green-700">Verified in GSC</span>
                  <a href={`https://search.google.com/search-console/security-issues?resource_id=sc-domain%3A${domain.domain}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:underline ml-2">View in GSC →</a>
                </div>
                <button onClick={handleDisconnectGsc} className="text-xs text-gray-400 hover:text-red-500 transition-colors">Disconnect Google</button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                  <span className="text-xs text-gray-500">Not in GSC</span>
                  <button onClick={handleDisconnectGsc} className="text-xs text-gray-400 hover:text-red-500 transition-colors ml-2">Disconnect</button>
                </div>
                {!cfZone ? (
                  <p className="text-xs text-gray-400">Cloudflare zone required for auto-verification.</p>
                ) : (
                  <button onClick={handleVerify} disabled={verifying}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                    {verifying ? 'Adding DNS & waiting for propagation…' : 'Add & Verify via Cloudflare DNS'}
                  </button>
                )}
                {gscError && <p className="text-xs text-red-500">{gscError}</p>}
              </div>
            )}
          </div>

          {/* ── Recovery Tracker ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <SectionHeader>Recovery Tracker</SectionHeader>
              {recovery?.recovery_status && (
                <button onClick={handleClear} disabled={clearing}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                  Clear
                </button>
              )}
            </div>

            {!recovery ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : (
              <>
                {/* Status stepper */}
                <div className="flex items-center gap-1 mb-4">
                  {RECOVERY_STEPS.map((step, i) => {
                    const idx = RECOVERY_STEPS.findIndex(s => s.key === recovery.recovery_status);
                    const done = idx >= i;
                    return (
                      <div key={step.key} className="flex items-center gap-1 flex-1">
                        <div className={`flex-1 text-center py-1 px-1 rounded text-[10px] font-semibold transition-colors ${
                          done ? `${step.color} text-white` : 'bg-gray-100 text-gray-400'
                        }`}>{step.label}</div>
                        {i < RECOVERY_STEPS.length - 1 && (
                          <div className={`w-3 h-0.5 shrink-0 ${done && idx > i ? step.color : 'bg-gray-200'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Log timeline */}
                {recovery.logs.length > 0 && (
                  <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                    {recovery.logs.map(log => {
                      const s = stepFor(log.status);
                      return (
                        <div key={log.id} className={`rounded-md px-3 py-2 border ${s.bg} ${s.border}`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-[10px] font-semibold uppercase ${s.text}`}>{s.label}</span>
                            <span className="text-[10px] text-gray-400">
                              {new Date(log.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {log.note && <p className="text-xs text-gray-600 mt-0.5">{log.note}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add log entry */}
                <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="Add a note (optional)…"
                    rows={2}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {RECOVERY_STEPS.map(step => (
                      <button key={step.key} onClick={() => handleAddLog(step.key)} disabled={adding}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50 ${
                          recovery.recovery_status === step.key
                            ? `${step.color} text-white`
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}>
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
