import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Globe, CheckCircle2, AlertCircle, RefreshCw, Power, ExternalLink,
  ShieldAlert, Play, MapPin, Database, Sparkles, Filter, Search, Layers, Clock,
  Pin, EyeOff, ShieldCheck, XCircle, AlertTriangle, UserCheck, Check, Activity, Trash2
} from 'lucide-react';

export function SourcesManagement() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [discoveringSources, setDiscoveringSources] = useState(false);
  const [activeTab, setActiveTab] = useState<'sources' | 'selected' | 'runs' | 'rejected' | 'proposals'>('sources');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const handleBulkSources = async (action: 'enable' | 'disable' | 'test' | 'sync') => {
    if (selectedSourceIds.length === 0) return;
    try {
      setBulkProcessing(true);
      const res = await fetch('/api/sources/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sourceIds: selectedSourceIds }),
      });
      if (!res.ok) throw new Error('Bulk operation failed');
      const data = await res.json();
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['indexing-overview'] });
      setSelectedSourceIds([]);
      if (action === 'sync') {
        alert(`Bulk sync completed on ${data.count} source(s):\nDiscovered: ${data.totalDiscovered} listings\nIndexed: ${data.totalIndexed} new jobs.`);
      } else {
        alert(`Bulk ${action} successfully executed on ${data.count} source(s).`);
      }
    } catch (e: any) {
      alert(e.message || 'Bulk operation failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  // Query all sources
  const sourcesQ = useQuery({
    queryKey: ['sources', search, categoryFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (categoryFilter) params.append('category', categoryFilter);
      if (statusFilter) params.append('status', statusFilter);
      const res = await fetch(`/api/sources?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load source registry');
      return res.json();
    },
  });

  // Query routed/selected sources for the profile
  const selectedSourcesQ = useQuery({
    queryKey: ['sources-selected'],
    queryFn: async () => {
      const res = await fetch('/api/sources-selected');
      if (!res.ok) return { sources: [] };
      return res.json();
    },
  });

  // Query source run logs
  const runsQ = useQuery({
    queryKey: ['sources-runs'],
    queryFn: async () => {
      const res = await fetch('/api/sources/runs?limit=40');
      if (!res.ok) return { runs: [] };
      return res.json();
    },
  });

  // Query rejected candidates audit log
  const rejectedQ = useQuery({
    queryKey: ['sources-rejected'],
    queryFn: async () => {
      const res = await fetch('/api/sources/rejected?limit=50');
      if (!res.ok) return { rejected: [] };
      return res.json();
    },
  });

  // Query discovered proposals
  const proposalsQ = useQuery({
    queryKey: ['discovered-sources'],
    queryFn: async () => {
      const res = await fetch('/api/sources-discovered');
      if (!res.ok) throw new Error('Failed to load discovered sources');
      return res.json();
    },
  });

  const setSourceMode = async (id: string, mode: 'AUTO' | 'PINNED' | 'EXCLUDED') => {
    try {
      const res = await fetch(`/api/sources/${id}/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, profileId: 'primary' }),
      });
      if (!res.ok) throw new Error('Failed to update source mode');
      qc.invalidateQueries({ queryKey: ['sources-selected'] });
      qc.invalidateQueries({ queryKey: ['sources'] });
    } catch (e: any) {
      alert(e.message);
    }
  };

  const toggleSource = async (id: string, currentEnabled: boolean) => {
    try {
      const endpoint = currentEnabled ? `/api/sources/${id}/disable` : `/api/sources/${id}/enable`;
      const res = await fetch(endpoint, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to update source state');
      qc.invalidateQueries({ queryKey: ['sources'] });
    } catch (e: any) {
      alert(e.message);
    }
  };

  const testConnection = async (id: string) => {
    try {
      setTestingId(id);
      const res = await fetch(`/api/sources/${id}/test`, { method: 'POST' });
      const data = await res.json();
      alert(`Test result for ${data.name}:\nStatus: ${data.assignedStatus}\nLatency: ${data.latencyMs ?? 0}ms\nMessage: ${data.errorMessage || 'Connection verified successfully.'}`);
      qc.invalidateQueries({ queryKey: ['sources'] });
    } catch (e: any) {
      alert(`Test error: ${e.message}`);
    } finally {
      setTestingId(null);
    }
  };

  const syncSource = async (id: string) => {
    try {
      setSyncingId(id);
      const res = await fetch(`/api/sources/${id}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync source');
      alert(`Sync completed for ${data.name}:\nDiscovered: ${data.discoveredCount} listings\nValidated & Saved: ${data.savedCount ?? data.indexedCount ?? 0} jobs\nYield Rate: ${data.yieldRate ? Math.round(data.yieldRate * 100) + '%' : '100%'}\nTotal in Registry: ${data.totalIndexed ?? data.totalDiscovered ?? 0} jobs.`);
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['sources-runs'] });
      qc.invalidateQueries({ queryKey: ['sources-rejected'] });
      qc.invalidateQueries({ queryKey: ['indexing-overview'] });
    } catch (e: any) {
      alert(`Sync error: ${e.message}`);
    } finally {
      setSyncingId(null);
    }
  };

  const runDiscoveryEngine = async () => {
    try {
      setDiscoveringSources(true);
      const res = await fetch('/api/sources-discovered/run', { method: 'POST' });
      const data = await res.json();
      alert(`Source discovery probe finished. Generated ${data.proposalsGenerated} new source proposals for review.`);
      qc.invalidateQueries({ queryKey: ['discovered-sources'] });
      setActiveTab('proposals');
    } catch (e: any) {
      alert(`Discovery run error: ${e.message}`);
    } finally {
      setDiscoveringSources(false);
    }
  };

  const reviewProposal = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await fetch(`/api/sources-discovered/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error('Failed to review proposal');
      qc.invalidateQueries({ queryKey: ['discovered-sources'] });
      qc.invalidateQueries({ queryKey: ['sources'] });
    } catch (e: any) {
      alert(e.message);
    }
  };

  const sourcesList = sourcesQ.data?.sources || [];
  const selectedSourcesList = selectedSourcesQ.data?.sources || [];
  const selectedMap = new Map<string, any>(selectedSourcesList.map((item: any) => [item.source.id, item]));
  const proposalsList = proposalsQ.data?.proposals || [];
  const runsList = runsQ.data?.runs || [];
  const rejectedList = rejectedQ.data?.rejected || [];

  return (
    <main className="page-wrap">
      <header className="page-head">
        <div>
          <div className="eyebrow">KaziScout Source Registry</div>
          <h1 className="page-title">Source Management & Router</h1>
          <p className="page-sub">
            Verified recruitment endpoints covering Kenyan job boards, PSC/GHRIS, 47 County Governments, NGOs, Tech employers, and Remote boards with profile-adaptive routing.
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={runDiscoveryEngine} disabled={discoveringSources}>
            <Sparkles size={14} className={discoveringSources ? 'spin' : ''} />
            {discoveringSources ? 'Probing…' : 'Run Source Discovery Probe'}
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="toolbar" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        <button
          className={`btn ${activeTab === 'sources' ? 'btn-primary' : 'btn-quiet'}`}
          onClick={() => setActiveTab('sources')}
        >
          <Globe size={14} /> Registered Sources ({sourcesQ.data?.total ?? sourcesList.length})
        </button>
        <button
          className={`btn ${activeTab === 'selected' ? 'btn-primary' : 'btn-quiet'}`}
          onClick={() => setActiveTab('selected')}
        >
          <UserCheck size={14} /> Selected For You ({selectedSourcesList.length})
        </button>
        <button
          className={`btn ${activeTab === 'runs' ? 'btn-primary' : 'btn-quiet'}`}
          onClick={() => setActiveTab('runs')}
        >
          <Activity size={14} /> Run Logs ({runsList.length})
        </button>
        <button
          className={`btn ${activeTab === 'rejected' ? 'btn-primary' : 'btn-quiet'}`}
          onClick={() => setActiveTab('rejected')}
        >
          <Trash2 size={14} /> Discard Audit Log ({rejectedList.length})
        </button>
        <button
          className={`btn ${activeTab === 'proposals' ? 'btn-primary' : 'btn-quiet'}`}
          onClick={() => setActiveTab('proposals')}
        >
          <Sparkles size={14} /> Discovered Proposals ({proposalsList.length})
        </button>
      </div>

      {activeTab === 'sources' ? (
        <>
          {/* Filters */}
          <div className="toolbar" style={{ marginTop: 12 }}>
            <div className="search-field" style={{ flex: 1, minWidth: 200 }}>
              <Search size={14} />
              <input
                placeholder="Search source name or URL…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select
              className="field select"
              style={{ width: 180 }}
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              <option value="KENYAN_JOB_BOARD">Kenyan Job Boards</option>
              <option value="GOVERNMENT_NATIONAL">National Government</option>
              <option value="COUNTY_GOVERNMENTS">County Governments</option>
              <option value="STATE_CORPORATIONS">State Corporations</option>
              <option value="NGO_HUMANITARIAN">NGOs & UN</option>
              <option value="TECH_COMPANIES">Tech Employers</option>
              <option value="BANKS_FINTECH">Banks & Fintech</option>
              <option value="RECRUITMENT_AGENCIES">Agencies</option>
              <option value="GLOBAL_REMOTE">Global Remote</option>
              <option value="AGGREGATORS">Aggregators</option>
              <option value="COMMUNITY_CHANNELS">Public Channels</option>
            </select>
            <select
              className="field select"
              style={{ width: 150 }}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="READY">READY</option>
              <option value="CONFIGURED">CONFIGURED</option>
              <option value="SEARCH_ONLY">SEARCH_ONLY</option>
              <option value="AUTH_REQUIRED">AUTH_REQUIRED</option>
              <option value="DEGRADED">DEGRADED</option>
              <option value="DISABLED">DISABLED</option>
              <option value="UNSUPPORTED">UNSUPPORTED</option>
            </select>
          </div>

          <section className="panel" style={{ marginTop: 14 }}>
            {selectedSourceIds.length > 0 && (
              <div className="bulk-bar" style={{ margin: '12px 16px' }}>
                <div className="bulk-count">
                  <span>{selectedSourceIds.length} source(s) selected</span>
                </div>
                <div className="bulk-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => handleBulkSources('sync')} disabled={bulkProcessing}>
                    <Play size={13}/> Sync & Ingest Jobs
                  </button>
                  <button className="btn btn-sm" onClick={() => handleBulkSources('enable')} disabled={bulkProcessing}>
                    <CheckCircle2 size={13}/> Enable Selected
                  </button>
                  <button className="btn btn-sm" onClick={() => handleBulkSources('disable')} disabled={bulkProcessing}>
                    <Power size={13}/> Disable Selected
                  </button>
                  <button className="btn btn-sm" onClick={() => handleBulkSources('test')} disabled={bulkProcessing}>
                    <RefreshCw size={13}/> Test Connections
                  </button>
                  <button className="btn-quiet" style={{ fontSize: 11 }} onClick={() => setSelectedSourceIds([])}>
                    Clear
                  </button>
                </div>
              </div>
            )}
            {sourcesQ.isLoading ? (
              <div className="panel-body">Loading sources…</div>
            ) : sourcesQ.isError ? (
              <div className="panel-body">Error loading sources.</div>
            ) : sourcesList.length === 0 ? (
              <div className="panel-body">No sources match the selected filters.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          checked={sourcesList.length > 0 && selectedSourceIds.length === sourcesList.length}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedSourceIds(sourcesList.map((s: any) => s.id));
                            else setSelectedSourceIds([]);
                          }}
                        />
                      </th>
                      <th>Source Name</th>
                      <th>Kind & Scope</th>
                      <th>Status & Health</th>
                      <th>Quality & Yield</th>
                      <th>Profile Mode</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourcesList.map((s: any) => {
                      const isAuth = s.status === 'AUTH_REQUIRED';
                      const isDegraded = s.status === 'DEGRADED' || s.status === 'ERROR';
                      const isActive = s.status === 'ACTIVE' || s.status === 'READY';
                      const isSearchOnly = s.status === 'SEARCH_ONLY';
                      const isDefunct = Boolean(s.isDefunct || s.status === 'UNSUPPORTED');
                      const sel = selectedMap.get(s.id);

                      return (
                        <tr key={s.id} style={{ opacity: isDefunct ? 0.6 : 1 }}>
                          <td style={{ width: 40 }}>
                            <input
                              type="checkbox"
                              checked={selectedSourceIds.includes(s.id)}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedSourceIds(prev => [...prev, s.id]);
                                else setSelectedSourceIds(prev => prev.filter(id => id !== s.id));
                              }}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>{s.name}</span>
                              {isDefunct && (
                                <span className="badge badge-red" style={{ fontSize: 9 }}>DEFUNCT</span>
                              )}
                              {sel?.mode === 'PINNED' && (
                                <span className="badge badge-green" style={{ fontSize: 9 }} title="Pinned for candidate profile">PINNED</span>
                              )}
                              {sel?.mode === 'EXCLUDED' && (
                                <span className="badge badge-amber" style={{ fontSize: 9 }} title="Excluded for candidate profile">EXCLUDED</span>
                              )}
                            </div>
                            <a
                              href={s.canonicalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="field-hint"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}
                            >
                              {s.canonicalUrl.replace(/^https?:\/\//, '').slice(0, 35)}
                              <ExternalLink size={10} />
                            </a>
                            {sel?.reason && (
                              <div className="field-hint" style={{ color: '#10b981', fontSize: 10, marginTop: 2 }}>
                                Selected: {sel.reason}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className="badge" style={{ fontSize: 10 }}>
                              {(s.sourceKind || s.category || 'GENERAL_BOARD').replace(/_/g, ' ')}
                            </span>
                            <div className="field-hint" style={{ fontSize: 10, marginTop: 2 }}>
                              {Array.isArray(s.countries) ? s.countries.join(', ') : (s.country || 'KE')}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`badge ${isDefunct ? 'badge-red' : isActive ? 'badge-green' : isDegraded ? 'badge-red' : isSearchOnly ? 'badge-amber' : ''}`}
                              style={{ fontSize: 10 }}
                            >
                              {isDefunct ? 'UNSUPPORTED' : s.status}
                            </span>
                            {s.lastErrorMessage && (
                              <div className="field-hint" style={{ color: '#ef4444', fontSize: 10, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.lastErrorMessage}>
                                {s.lastErrorMessage}
                              </div>
                            )}
                          </td>
                          <td style={{ fontSize: 11 }}>
                            <div>
                              <strong>{s.yieldRate != null ? `${Math.round(s.yieldRate * 100)}%` : '—'}</strong> yield
                            </div>
                            <span className="field-hint">{s.totalIndexed ?? 0} saved / {s.totalDiscovered ?? 0} found</span>
                            {s.rejectReasons && Object.keys(s.rejectReasons).length > 0 && (
                              <div className="field-hint" style={{ color: '#f59e0b', fontSize: 10 }} title={JSON.stringify(s.rejectReasons)}>
                                Rejects: {Object.entries(s.rejectReasons).map(([k, v]) => `${k}(${v})`).slice(0, 2).join(', ')}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                className={`btn ${sel?.mode === 'PINNED' ? 'btn-primary' : 'btn-quiet'}`}
                                style={{ fontSize: 10, padding: '2px 6px' }}
                                onClick={() => setSourceMode(s.id, sel?.mode === 'PINNED' ? 'AUTO' : 'PINNED')}
                                title="Pin source for profile"
                              >
                                <Pin size={10} /> Pin
                              </button>
                              <button
                                className={`btn ${sel?.mode === 'EXCLUDED' ? 'btn-danger' : 'btn-quiet'}`}
                                style={{ fontSize: 10, padding: '2px 6px' }}
                                onClick={() => setSourceMode(s.id, sel?.mode === 'EXCLUDED' ? 'AUTO' : 'EXCLUDED')}
                                title="Exclude source for profile"
                              >
                                <EyeOff size={10} /> Exclude
                              </button>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <button
                                className={`btn btn-quiet ${s.enabled ? '' : 'btn-danger'}`}
                                style={{ fontSize: 11, padding: '4px 7px' }}
                                onClick={() => toggleSource(s.id, Boolean(s.enabled))}
                                title={s.enabled ? 'Disable source' : 'Enable source'}
                              >
                                <Power size={12} color={s.enabled ? '#10b981' : '#ef4444'} />
                                {s.enabled ? 'Enabled' : 'Disabled'}
                              </button>
                              <button
                                className="btn"
                                style={{ fontSize: 11, padding: '4px 7px' }}
                                onClick={() => testConnection(s.id)}
                                disabled={testingId === s.id}
                              >
                                <RefreshCw size={11} className={testingId === s.id ? 'spin' : ''} />
                                {testingId === s.id ? 'Testing…' : 'Test'}
                              </button>
                              <button
                                className="btn"
                                style={{ fontSize: 11, padding: '4px 7px' }}
                                onClick={() => syncSource(s.id)}
                                disabled={syncingId === s.id}
                              >
                                <Play size={11} />
                                {syncingId === s.id ? 'Syncing…' : 'Sync'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : activeTab === 'selected' ? (
        /* Selected For You Tab */
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <span className="panel-title">Personalized Profile Source Selection</span>
            <span className="field-hint">Automatically routed based on your occupation taxonomy, target industries, locations, and work arrangements</span>
          </div>
          <div className="panel-body">
            {selectedSourcesList.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <p>No sources routed yet. Configure your candidate profile or add skills to trigger personalized source routing.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source Name</th>
                      <th>Relevance Score</th>
                      <th>Selection Reason</th>
                      <th>Mode</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSourcesList.map((item: any) => (
                      <tr key={item.source.id}>
                        <td>
                          <strong>{item.source.name}</strong>
                          <div className="field-hint">{item.source.canonicalUrl}</div>
                        </td>
                        <td>
                          <span className="badge badge-green" style={{ fontSize: 11 }}>
                            {Math.round(item.relevanceScore)} / 100
                          </span>
                        </td>
                        <td style={{ maxWidth: 350, fontSize: 12 }}>
                          {item.reason}
                        </td>
                        <td>
                          <span className={`badge ${item.mode === 'PINNED' ? 'badge-green' : item.mode === 'EXCLUDED' ? 'badge-red' : ''}`}>
                            {item.mode}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className={`btn ${item.mode === 'PINNED' ? 'btn-primary' : 'btn-quiet'}`}
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => setSourceMode(item.source.id, item.mode === 'PINNED' ? 'AUTO' : 'PINNED')}
                            >
                              <Pin size={11} /> {item.mode === 'PINNED' ? 'Unpin' : 'Pin'}
                            </button>
                            <button
                              className={`btn ${item.mode === 'EXCLUDED' ? 'btn-danger' : 'btn-quiet'}`}
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => setSourceMode(item.source.id, item.mode === 'EXCLUDED' ? 'AUTO' : 'EXCLUDED')}
                            >
                              <EyeOff size={11} /> {item.mode === 'EXCLUDED' ? 'Restore' : 'Exclude'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : activeTab === 'runs' ? (
        /* Source Run Logs Tab */
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <span className="panel-title">Source Crawl & Execution Logs</span>
            <span className="field-hint">Granular audit log of fetched, parsed, validated, and saved jobs per run</span>
          </div>
          <div className="panel-body">
            {runsList.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <p>No recent source runs recorded. Click &quot;Sync&quot; on any source to trigger an execution.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source ID</th>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Fetched</th>
                      <th>Parsed</th>
                      <th>Validated</th>
                      <th>Saved</th>
                      <th>Reject Reasons</th>
                      <th>Status / Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runsList.map((r: any) => (
                      <tr key={r.id}>
                        <td><strong>{r.sourceId}</strong></td>
                        <td className="muted" style={{ fontSize: 11 }}>
                          {r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : '—'}
                        </td>
                        <td style={{ fontSize: 11 }}>{r.durationMs ? `${r.durationMs}ms` : '—'}</td>
                        <td>{r.fetched ?? 0}</td>
                        <td>{r.parsed ?? 0}</td>
                        <td><strong style={{ color: '#10b981' }}>{r.validated ?? 0}</strong></td>
                        <td><strong>{r.saved ?? 0}</strong></td>
                        <td style={{ fontSize: 11, maxWidth: 200 }}>
                          {r.rejectReasons && Object.keys(r.rejectReasons).length > 0
                            ? Object.entries(r.rejectReasons).map(([k, v]) => `${k}: ${v}`).join(', ')
                            : 'None'}
                        </td>
                        <td>
                          {r.error ? (
                            <span className="badge badge-red" title={r.error}>ERROR</span>
                          ) : (
                            <span className="badge badge-green">SUCCESS</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : activeTab === 'rejected' ? (
        /* Discard Audit Log Tab */
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <span className="panel-title">Discard Audit Log (Hard Validation Gate)</span>
            <span className="field-hint">Rejected candidates that failed gate criteria (stub queries, search URLs, missing employers, short descriptions, or expired posts)</span>
          </div>
          <div className="panel-body">
            {rejectedList.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <p>No discarded candidate records. All parsed jobs passed the hard gate.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Job Title</th>
                      <th>Source</th>
                      <th>Rejection Reason</th>
                      <th>URL</th>
                      <th>Discarded At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejectedList.map((rec: any) => (
                      <tr key={rec.id}>
                        <td>
                          <strong>{rec.title || 'Untitled Listing'}</strong>
                        </td>
                        <td><span className="badge">{rec.sourceId}</span></td>
                        <td>
                          <span className="badge badge-amber" style={{ fontSize: 11 }}>
                            {rec.reason}
                          </span>
                        </td>
                        <td style={{ fontSize: 11, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <a href={rec.url} target="_blank" rel="noreferrer">
                            {rec.url}
                          </a>
                        </td>
                        <td className="muted" style={{ fontSize: 11 }}>
                          {rec.createdAt ? new Date(rec.createdAt).toLocaleTimeString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : (
        /* Proposals Tab */
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <span className="panel-title">Automated Source Discovery Proposals</span>
            <span className="field-hint">Sources discovered through SSRF-validated web probes and candidate skill queries</span>
          </div>
          <div className="panel-body">
            {proposalsList.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <p>No pending source proposals. Click &quot;Run Source Discovery Probe&quot; above to discover new potential recruitment sites.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Discovered Domain</th>
                      <th>Candidate Category</th>
                      <th>SSRF / Robots</th>
                      <th>Evidence</th>
                      <th>Status</th>
                      <th>Review Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposalsList.map((p: any) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.suggestedName || p.domain}</strong>
                          <div className="field-hint">{p.url}</div>
                        </td>
                        <td>
                          <span className="badge">{p.suggestedCategory}</span>
                        </td>
                        <td>
                          <div style={{ fontSize: 11 }}>
                            {p.ssrfChecked ? '✓ SSRF Safe' : '⚠️ Pending SSRF'}
                          </div>
                          <div className="field-hint">
                            {p.robotsAllowed ? 'Robots Allowed' : 'Robots Restricted'}
                          </div>
                        </td>
                        <td style={{ fontSize: 11, maxWidth: 300 }}>
                          {p.evidence}
                        </td>
                        <td>
                          <span className={`badge ${p.status === 'APPROVED' ? 'badge-green' : p.status === 'REJECTED' ? 'badge-red' : 'badge-amber'}`}>
                            {p.status}
                          </span>
                        </td>
                        <td>
                          {p.status === 'PROPOSED' ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                className="btn btn-primary"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => reviewProposal(p.id, 'APPROVED')}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-danger"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => reviewProposal(p.id, 'REJECTED')}
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="muted" style={{ fontSize: 11 }}>Reviewed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

export function IndexingControl() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const overviewQ = useQuery({
    queryKey: ['indexing-overview'],
    queryFn: async () => {
      const res = await fetch('/api/indexing/overview');
      if (!res.ok) throw new Error('Failed to load indexing overview');
      return res.json();
    },
    refetchInterval: 12000,
  });

  const triggerIndexing = async () => {
    try {
      setRunning(true);
      const res = await fetch('/api/agent/trigger-search', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to trigger indexing run');
      alert('Verified discovery & AI evaluation cycle triggered successfully!');
      qc.invalidateQueries({ queryKey: ['indexing-overview'] });
    } catch (e: any) {
      alert(`Indexing trigger error: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  const data = overviewQ.data;

  return (
    <main className="page-wrap">
      <header className="page-head">
        <div>
          <div className="eyebrow">KaziScout Architecture</div>
          <h1 className="page-title">Intelligent Indexing Control Panel</h1>
          <p className="page-sub">
            Real-time pipeline metrics: Ingestion, cross-source deduplication, provenance tracking, and CV-evidence AI evaluation.
          </p>
        </div>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={triggerIndexing} disabled={running}>
            <Play size={14} className={running ? 'spin' : ''} />
            {running ? 'Indexing In Progress…' : 'Start Full Discovery Run'}
          </button>
        </div>
      </header>

      {/* Metrics Grid */}
      <div className="stats-grid">
        <div className="panel stat-card">
          <div className="stat-label">Total Jobs in Index</div>
          <div className="stat-num">{data?.jobs?.total ?? '—'}</div>
          <div className="stat-note">Canonical vacancy records</div>
          <Database size={16} className="stat-accent" />
        </div>

        <div className="panel stat-card">
          <div className="stat-label">Strong AI Matches</div>
          <div className="stat-num" style={{ color: '#10b981' }}>{data?.jobs?.strongMatches ?? '—'}</div>
          <div className="stat-note">Strict CV-verified opportunities</div>
          <CheckCircle2 size={16} className="stat-accent" style={{ color: '#10b981' }} />
        </div>

        <div className="panel stat-card">
          <div className="stat-label">Duplicates & Provenance</div>
          <div className="stat-num">{data?.jobs?.provenanceRecords ?? '—'}</div>
          <div className="stat-note">{data?.jobs?.duplicates ?? 0} cross-source duplicates mapped</div>
          <Layers size={16} className="stat-accent" />
        </div>

        <div className="panel stat-card">
          <div className="stat-label">AI Evaluations</div>
          <div className="stat-num">{data?.jobs?.aiEvaluatedCount ?? '—'}</div>
          <div className="stat-note">Gemini & OpenAI evaluated</div>
          <Sparkles size={16} className="stat-accent" />
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Job Status Distribution</span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>★ Strong Matches (Passed AI Gate)</span>
                <strong style={{ color: '#10b981' }}>{data?.jobs?.strongMatches ?? 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>⚡ Potential Matches (Needs Review)</span>
                <strong>{data?.jobs?.potentialMatches ?? 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>ℹ️ Insufficient Information</span>
                <strong>{data?.jobs?.insufficientInfo ?? 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>🚫 Disqualified / Excluded Roles</span>
                <strong style={{ color: '#ef4444' }}>{data?.jobs?.notAMatch ?? 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span>🔗 Cross-Source Provenance Links</span>
                <strong>{data?.jobs?.provenanceRecords ?? 0}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Source Connector Statuses</span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>Total Catalog Sources</span>
                <strong>{data?.sources?.total ?? 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>Active & Ready Sources</span>
                <strong style={{ color: '#10b981' }}>{(data?.sources?.active ?? 0) + (data?.sources?.configured ?? 0)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>Search-Only / Portals</span>
                <strong>{data?.sources?.searchOnly ?? 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>Degraded / Error</span>
                <strong style={{ color: '#ef4444' }}>{data?.sources?.degraded ?? 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span>Pending Source Proposals</span>
                <strong>{data?.sourceDiscovery?.pendingProposals ?? 0}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export function CountyRegistryView() {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'counties' | 'adminRegions'>('counties');

  const countiesQ = useQuery({
    queryKey: ['counties'],
    queryFn: async () => {
      const res = await fetch('/api/counties');
      if (!res.ok) throw new Error('Failed to load county registry');
      return res.json();
    },
  });

  const adminRegionsQ = useQuery({
    queryKey: ['admin-regions'],
    queryFn: async () => {
      const res = await fetch('/api/admin-regions');
      if (!res.ok) return { regions: [] };
      return res.json();
    },
  });

  const countiesList = (countiesQ.data?.counties || []).filter((c: any) =>
    search ? c.name.toLowerCase().includes(search.toLowerCase()) || String(c.code).includes(search) : true
  );

  const adminRegionsList = (adminRegionsQ.data?.regions || []).filter((r: any) =>
    search ? r.name.toLowerCase().includes(search.toLowerCase()) || String(r.code).includes(search) || r.countryCode.toLowerCase().includes(search.toLowerCase()) : true
  );

  return (
    <main className="page-wrap">
      <header className="page-head">
        <div>
          <div className="eyebrow">Public Sector Governance</div>
          <h1 className="page-title">Administrative Regions & Devolved Portals</h1>
          <p className="page-sub">
            Global and devolved recruitment portal coverage spanning all 47 Kenyan Counties and generalized regional admin directories.
          </p>
        </div>
      </header>

      <div className="toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="search-field" style={{ maxWidth: 350 }}>
          <Search size={14} />
          <input
            placeholder="Search region, county name or code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={`btn ${viewMode === 'counties' ? 'btn-primary' : 'btn-quiet'}`}
            onClick={() => setViewMode('counties')}
          >
            Kenyan 47 Counties ({countiesList.length})
          </button>
          <button
            className={`btn ${viewMode === 'adminRegions' ? 'btn-primary' : 'btn-quiet'}`}
            onClick={() => setViewMode('adminRegions')}
          >
            Admin Regions ({adminRegionsList.length})
          </button>
        </div>
      </div>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="table-wrap">
          {viewMode === 'counties' ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>County</th>
                  <th>Capital</th>
                  <th>Official Website</th>
                  <th>Recruitment / CPSB Portal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {countiesList.map((c: any) => (
                  <tr key={c.id}>
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {String(c.code).padStart(3, '0')}
                    </td>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td className="muted">{c.capital || '—'}</td>
                    <td>
                      {c.officialWebsite ? (
                        <a href={c.officialWebsite} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                          {c.officialWebsite.replace(/^https?:\/\//, '')}
                          <ExternalLink size={10} />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {c.recruitmentUrl || c.cpsbUrl ? (
                        <a
                          href={c.recruitmentUrl || c.cpsbUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="badge badge-green"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                        >
                          Recruitment Endpoint <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span className="field-hint">Public Announcement Discovery</span>
                      )}
                    </td>
                    <td>
                      <span className="badge">{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th>Level</th>
                  <th>Code</th>
                  <th>Region Name</th>
                  <th>Recruitment Endpoint</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {adminRegionsList.map((r: any) => (
                  <tr key={r.id}>
                    <td><span className="badge">{r.countryCode}</span></td>
                    <td className="mono" style={{ fontSize: 11 }}>{r.level}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{r.code}</td>
                    <td><strong>{r.name}</strong></td>
                    <td>
                      {r.recruitmentUrl ? (
                        <a href={r.recruitmentUrl} target="_blank" rel="noreferrer" className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          Portal <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span className="field-hint">—</span>
                      )}
                    </td>
                    <td><span className="badge">{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}

export function JobProvenancePanel({ jobId }: { jobId: string }) {
  const provQ = useQuery({
    queryKey: ['job-provenance', jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/provenance`);
      if (!res.ok) throw new Error('Failed to load provenance');
      return res.json();
    },
    enabled: Boolean(jobId),
  });

  const records = provQ.data?.provenance || [];
  if (records.length === 0) return null;

  return (
    <div className="panel" style={{ padding: 12, marginTop: 14, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Layers size={13} color="#10b981" /> Source Provenance & Discovery Trace ({records.length} records)
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {records.map((r: any) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, padding: '4px 6px', borderRadius: 4, background: 'var(--muted)' }}>
            <div>
              <strong>{r.sourceName}</strong> {r.isPrimary ? <span className="badge badge-green" style={{ fontSize: 9, marginLeft: 4 }}>Primary Source</span> : <span className="field-hint">(Duplicate Match)</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="muted">{new Date(r.discoveredAt).toLocaleDateString()}</span>
              {r.originalUrl && (
                <a href={r.originalUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
