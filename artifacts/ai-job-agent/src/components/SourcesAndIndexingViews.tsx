import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Globe, CheckCircle2, AlertCircle, RefreshCw, Power, ExternalLink,
  ShieldAlert, Play, MapPin, Database, Sparkles, Filter, Search, Layers, Clock
} from 'lucide-react';

export function SourcesManagement() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [discoveringSources, setDiscoveringSources] = useState(false);
  const [activeTab, setActiveTab] = useState<'sources' | 'proposals'>('sources');
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

  // Query sources
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

  // Query discovered proposals
  const proposalsQ = useQuery({
    queryKey: ['discovered-sources'],
    queryFn: async () => {
      const res = await fetch('/api/sources-discovered');
      if (!res.ok) throw new Error('Failed to load discovered sources');
      return res.json();
    },
  });

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
      alert(`Sync completed for ${data.name}:\nDiscovered: ${data.discoveredCount} listings\nIndexed into Workspace: ${data.indexedCount ?? data.discoveredCount} jobs\nTotal in Registry: ${data.totalIndexed ?? data.totalDiscovered ?? 0} jobs.`);
      qc.invalidateQueries({ queryKey: ['sources'] });
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
  const proposalsList = proposalsQ.data?.proposals || [];

  return (
    <main className="page-wrap">
      <header className="page-head">
        <div>
          <div className="eyebrow">KaziScout Source Registry</div>
          <h1 className="page-title">Source Management & Health</h1>
          <p className="page-sub">
            Verified recruitment endpoints covering Kenyan job boards, PSC/GHRIS, 47 County Governments, NGOs, Tech employers, and Remote boards.
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
                      <th>Category</th>
                      <th>Adapter</th>
                      <th>Status</th>
                      <th>Indexed</th>
                      <th>Last Checked</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourcesList.map((s: any) => {
                      const isAuth = s.status === 'AUTH_REQUIRED';
                      const isDegraded = s.status === 'DEGRADED' || s.status === 'ERROR';
                      const isActive = s.status === 'ACTIVE' || s.status === 'READY';
                      const isSearchOnly = s.status === 'SEARCH_ONLY';

                      return (
                        <tr key={s.id}>
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
                            <div style={{ fontWeight: 600 }}>{s.name}</div>
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
                          </td>
                          <td>
                            <span className="badge" style={{ fontSize: 10 }}>
                              {s.category.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="mono" style={{ fontSize: 11 }}>
                            {s.integrationType || s.connectorType}
                          </td>
                          <td>
                            <span
                              className={`badge ${isActive ? 'badge-green' : isDegraded ? 'badge-red' : isSearchOnly ? 'badge-amber' : ''}`}
                              style={{ fontSize: 10 }}
                            >
                              {s.status}
                            </span>
                            {s.lastErrorMessage && (
                              <div className="field-hint" style={{ color: '#ef4444', fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.lastErrorMessage}>
                                {s.lastErrorMessage}
                              </div>
                            )}
                          </td>
                          <td style={{ fontSize: 12 }}>
                            <div><strong>{s.totalIndexed ?? s.total_indexed ?? 0}</strong> jobs</div>
                            <span className="field-hint">({s.totalDiscovered ?? s.total_discovered ?? 0} found)</span>
                          </td>
                          <td className="muted" style={{ fontSize: 11 }}>
                            {s.lastCheckedAt ? new Date(s.lastCheckedAt).toLocaleDateString() : 'Never'}
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
  const [editingCounty, setEditingCounty] = useState<any | null>(null);

  const countiesQ = useQuery({
    queryKey: ['counties'],
    queryFn: async () => {
      const res = await fetch('/api/counties');
      if (!res.ok) throw new Error('Failed to load county registry');
      return res.json();
    },
  });

  const countiesList = (countiesQ.data?.counties || []).filter((c: any) =>
    search ? c.name.toLowerCase().includes(search.toLowerCase()) || String(c.code).includes(search) : true
  );

  return (
    <main className="page-wrap">
      <header className="page-head">
        <div>
          <div className="eyebrow">Devolved Governance</div>
          <h1 className="page-title">Kenyan 47 County Governments Registry</h1>
          <p className="page-sub">
            Extensible recruitment portal coverage covering all 47 counties from County 001 (Mombasa) to County 047 (Nairobi City).
          </p>
        </div>
      </header>

      <div className="toolbar">
        <div className="search-field" style={{ maxWidth: 350 }}>
          <Search size={14} />
          <input
            placeholder="Search county name or code (001–047)…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="table-wrap">
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
