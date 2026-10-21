import { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { 
  Search, 
  Play, 
  RotateCw, 
  Check, 
  X, 
  Clock, 
  Calendar,
  Target,
  Globe,
  Filter,
  CheckCircle2,
  AlertCircle,
  SlidersHorizontal,
  Briefcase,
  ShieldCheck,
  Sparkles,
  Zap
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';

interface DiscoveryResult {
  discovered: number;
  duplicates: number;
  matched: number;
  highMatches: any[];
  mediumMatches: any[];
  lowMatches: any[];
  rejected: number;
  errors: string[];
  sourcesScraped: string[];
  executionTime: number;
  rolesSearched: string[];
  cvMatched: number;
  requirementVerified: number;
  canApply: number;
}

interface DiscoveryRun {
  id: string;
  rolesSearched: string[];
  sourcesScraped: string[];
  discovered: number;
  matched: number;
  highMatches: number;
  executionTime: number;
  errors: string[];
  startedAt: string;
  completedAt: string | null;
}

interface DiscoveryStats {
  totalDiscoveries: number;
  totalJobsDiscovered: number;
  totalMatches: number;
  liveActiveJobs?: number;
  liveStrongMatches?: number;
  livePotentialMatches?: number;
  liveDisqualified?: number;
  liveTotalInDb?: number;
  avgJobsPerDiscovery: number;
  avgMatchesPerDiscovery: number;
  lastDiscovery: string | null;
  bestDiscovery: { discovered: number; matched: number; date: string } | null;
  sourcesScraped: number;
  mostSuccessfulSource: string | null;
}

// Live API functions with fallback
const fetchDiscoveryHistory = async (limit = 20): Promise<{
  runs: DiscoveryRun[];
  total: number;
}> => {
  try {
    const res = await fetch(`/api/discovery/history?limit=${limit}`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.runs)) {
        return {
          runs: data.runs,
          total: data.total ?? data.runs.length,
        };
      }
    }
  } catch (err) {
    console.warn('[EnhancedDiscovery] Failed to fetch discovery history, falling back to local:', err);
  }

  return {
    runs: [],
    total: 0,
  };
};

const fetchDiscoveryStats = async (): Promise<DiscoveryStats> => {
  try {
    const res = await fetch('/api/discovery/statistics', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data.totalDiscoveries !== undefined) {
        return {
          totalDiscoveries: data.totalDiscoveries || 0,
          totalJobsDiscovered: data.totalJobsDiscovered || 0,
          totalMatches: data.totalMatches || 0,
          liveActiveJobs: data.liveActiveJobs ?? 0,
          liveStrongMatches: data.liveStrongMatches ?? 0,
          livePotentialMatches: data.livePotentialMatches ?? 0,
          liveDisqualified: data.liveDisqualified ?? 0,
          liveTotalInDb: data.liveTotalInDb ?? 0,
          avgJobsPerDiscovery: data.avgJobsPerDiscovery || 0,
          avgMatchesPerDiscovery: data.avgMatchesPerDiscovery || 0,
          lastDiscovery: data.lastDiscovery || null,
          bestDiscovery: data.bestDiscovery || null,
          sourcesScraped: data.sourcesScraped || 0,
          mostSuccessfulSource: data.mostSuccessfulSource || null,
        };
      }
    }
  } catch (err) {
    console.warn('[EnhancedDiscovery] Failed to fetch discovery stats:', err);
  }

  return {
    totalDiscoveries: 0,
    totalJobsDiscovered: 0,
    totalMatches: 0,
    avgJobsPerDiscovery: 0,
    avgMatchesPerDiscovery: 0,
    lastDiscovery: null,
    bestDiscovery: null,
    sourcesScraped: 0,
    mostSuccessfulSource: null,
  };
};

const runDiscovery = async (config: any): Promise<DiscoveryResult> => {
  try {
    const res = await fetch('/api/discovery/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(config),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        discovered: data.discovered || 0,
        duplicates: data.duplicates || 0,
        matched: data.matched || 0,
        highMatches: data.highMatches || [],
        mediumMatches: data.mediumMatches || [],
        lowMatches: data.lowMatches || [],
        rejected: data.rejected || 0,
        errors: data.errors || [],
        sourcesScraped: data.sourcesScraped || [],
        executionTime: data.executionTime || 0,
        rolesSearched: data.rolesSearched || [],
        cvMatched: data.cvMatched || 0,
        requirementVerified: data.requirementVerified || 0,
        canApply: data.canApply || 0,
      };
    }
  } catch (err) {
    console.warn('[EnhancedDiscovery] Failed to run discovery via API:', err);
    throw err;
  }

  return {
    discovered: 0,
    duplicates: 0,
    matched: 0,
    highMatches: [],
    mediumMatches: [],
    lowMatches: [],
    rejected: 0,
    errors: [],
    sourcesScraped: [],
    executionTime: 0,
    rolesSearched: [],
    cvMatched: 0,
    requirementVerified: 0,
    canApply: 0,
  };
};

const getEnabledRoles = async (): Promise<{ roles: string[]; preferences: any[]; searchQueries: string[] }> => {
  try {
    const res = await fetch('/api/user/roles/enabled', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.roles)) {
        return {
          roles: data.roles,
          preferences: data.preferences || [],
          searchQueries: data.searchQueries || [],
        };
      }
    }
  } catch (err) {
    console.warn('[EnhancedDiscovery] Failed to fetch enabled roles:', err);
  }

  return {
    roles: [],
    preferences: [],
    searchQueries: [],
  };
};

export function EnhancedDiscovery() {
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<DiscoveryResult | null>(null);
  const [aggressiveMode, setAggressiveMode] = useState(true);
  const [verifyRequirements, setVerifyRequirements] = useState(true);
  const [maxJobs, setMaxJobs] = useState(300);
  const [inspectedRun, setInspectedRun] = useState<DiscoveryRun | null>(null);

  // Queries
  const { data: brainStatus, refetch: refetchBrainStatus } = useQuery({
    queryKey: ['ai-brain-status'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/ai/brain-status', { credentials: 'include' });
        if (res.ok) return await res.json();
      } catch {}
      return null;
    },
    refetchInterval: 45000,
  });

  const { data: historyData, isLoading: historyLoading, refetch: refetchHistory } = useQuery({
    queryKey: ['discovery-history'],
    queryFn: () => fetchDiscoveryHistory(20),
  });

  const { data: statsData } = useQuery({
    queryKey: ['discovery-stats'],
    queryFn: fetchDiscoveryStats,
  });

  const { data: rolesData } = useQuery({
    queryKey: ['enabled-roles'],
    queryFn: getEnabledRoles,
  });

  const { data: candidateProfile } = useQuery({
    queryKey: ['candidate-profile'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/candidate-profile', { credentials: 'include' });
        if (res.ok) return await res.json();
      } catch {}
      return null;
    },
  });

  const profileRoles: string[] = Array.isArray(candidateProfile?.targetRoles)
    ? candidateProfile.targetRoles.filter((r: any) => typeof r === 'string' && r.trim().length > 0)
    : [];

  const LEGACY_IT_ROLES = new Set([
    'it support specialist',
    'ict officer',
    'junior systems administrator',
    'junior software developer',
    'help desk technician',
    'it intern',
  ]);

  const rawApiRoles = rolesData?.roles || [];
  const cleanApiRoles = rawApiRoles.filter((r: string) => !LEGACY_IT_ROLES.has(r.toLowerCase().trim()));

  const activeRoles: string[] = cleanApiRoles.length > 0
    ? cleanApiRoles
    : (profileRoles.length > 0 ? profileRoles : rawApiRoles);

  const runDiscoveryMutation = useMutation({
    mutationFn: runDiscovery,
  });

  const handleRunDiscovery = async () => {
    if (brainStatus?.status === 'OFFLINE') {
      const proceed = confirm(
        `AI Core Brain Offline Warning:\n\n${brainStatus.errors?.[0] || 'No working AI provider credentials found.'}\n\nJobs will be crawled from live feeds, but AI fit qualification will remain pending until a working API key is configured in Settings.\n\nDo you want to proceed with scraping anyway?`
      );
      if (!proceed) return;
    }
    setIsRunning(true);
    setLastResult(null);
    try {
      const result = await runDiscoveryMutation.mutateAsync({
        roles: activeRoles,
        aggressiveMode,
        verifyRequirements,
        maxJobs,
      });
      setLastResult(result);
      refetchHistory();
      refetchBrainStatus();
    } catch (err: any) {
      alert(`Discovery failed: ${err?.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  const runs = historyData?.runs || [];

  return (
    <main className="page-wrap">
      {/* Header */}
      <header className="page-head">
        <div>
          <div className="eyebrow">KaziScout / Discovery Desk</div>
          <h1 className="page-title">KaziScout Job Discovery</h1>
          <p className="page-sub">
            Targeted KaziScout crawler engine searching verified Kenyan public & private portals plus high-match remote hubs.
          </p>
        </div>
        <div className="head-actions">
          <Link href="/roles" className="btn btn-ghost">
            <Target size={14}/> Manage Roles
          </Link>
          <Link href="/discovery-settings" className="btn btn-ghost">
            <SlidersHorizontal size={14}/> Settings
          </Link>
        </div>
      </header>

      {/* AI Core Brain Status Indicator */}
      {brainStatus && brainStatus.status === 'OFFLINE' && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '14px 18px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', borderRadius: 10, marginBottom: 16, gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle size={20} style={{ color: '#ef4444', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 14, color: '#fca5a5' }}>AI Core Brain Offline</strong>
                <span className="badge" style={{ fontSize: 10, textTransform: 'uppercase', background: 'rgba(239,68,68,0.25)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}>Action Required</span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#fca5a5', opacity: 0.9 }}>
                {brainStatus.recommendation || 'AI candidate evaluation and matching are offline because the configured AI provider credentials failed or are invalid.'}
              </p>
              {brainStatus.errors && brainStatus.errors.length > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6, fontSize: 11, fontFamily: 'monospace', color: '#fecaca', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {brainStatus.errors.map((e: string, i: number) => (
                    <div key={i}>• {e}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Link href="/settings" className="btn btn-sm" style={{ background: '#dc2626', color: '#fff', fontWeight: 600, border: 'none', whiteSpace: 'nowrap', marginTop: 2 }}>
            Fix API Key in Settings &rarr;
          </Link>
        </div>
      )}

      {brainStatus && brainStatus.status === 'DEGRADED' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 8, marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Zap size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#fde68a' }}>
              <strong>AI Core Brain Operating on Fallback:</strong> Running via <strong>{brainStatus.activeProviderLabel || brainStatus.activeProvider}</strong> ({brainStatus.activeModel}). Primary provider: {brainStatus.errors?.[0] || 'issue reported'}.
            </span>
          </div>
          <Link href="/settings" style={{ fontSize: 12, color: '#fde68a', textDecoration: 'underline', fontWeight: 600 }}>
            Configure Providers &rarr;
          </Link>
        </div>
      )}

      {brainStatus && brainStatus.status === 'ONLINE' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.22)', borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#6ee7b7' }}>
          <Sparkles size={14} style={{ color: '#10b981' }} />
          <span>
            AI Core Brain <strong>Online</strong> • Active Provider: <strong>{brainStatus.activeProviderLabel || brainStatus.activeProvider?.toUpperCase()}</strong> ({brainStatus.activeModel}) • Real-time CV evaluation active.
          </span>
        </div>
      )}

      {/* Stats Grid */}
      <section className="stats-grid">
        <div className="panel stat-card">
          <Briefcase className="stat-accent" size={17} style={{ color: '#10b981' }} />
          <div className="stat-label">Active in Records</div>
          <div className="stat-num">{statsData?.liveActiveJobs ?? statsData?.totalMatches ?? 0}</div>
          <div className="stat-note">Live in Job Records</div>
        </div>
        <div className="panel stat-card">
          <Target className="stat-accent" size={17} style={{ color: '#2563eb' }} />
          <div className="stat-label">Strong Direct Fits</div>
          <div className="stat-num">{statsData?.liveStrongMatches ?? 0}</div>
          <div className="stat-note">≥70% match to target roles</div>
        </div>
        <div className="panel stat-card">
          <Play className="stat-accent" size={17} />
          <div className="stat-label">Total Ingested (All Time)</div>
          <div className="stat-num">{statsData?.totalJobsDiscovered || 0}</div>
          <div className="stat-note">Lifetime across {statsData?.totalDiscoveries || 0} runs</div>
        </div>
        <div className="panel stat-card">
          <Globe className="stat-accent" size={17} />
          <div className="stat-label">Sources Monitored</div>
          <div className="stat-num">{statsData?.sourcesScraped || 86}</div>
          <div className="stat-note">Active boards & portals</div>
        </div>
      </section>

      {/* Workspace Live Sync Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: 'hsl(var(--card))', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
          <span>
            <strong>Workspace Records:</strong> {statsData?.liveActiveJobs ?? 0} Active Opportunities ({statsData?.liveStrongMatches ?? 0} Strong Matches) • {statsData?.liveDisqualified ?? 0} Disqualified & Archive • {statsData?.totalJobsDiscovered ?? 0} Lifetime Ingested
          </span>
        </div>
        <Link href="/jobs" style={{ fontSize: 13, color: 'hsl(var(--primary))', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          Browse Job Records &rarr;
        </Link>
      </div>

      {/* Discovery Launcher Panel */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={16} style={{ color: 'hsl(var(--primary))' }}/> Run Role-Guided Discovery
            </div>
            <div className="field-hint" style={{ marginTop: 2 }}>
              Searches online job feeds strictly for your approved target roles.
            </div>
          </div>
          <span className="badge badge-green">
            {activeRoles.length} Target Roles
          </span>
        </div>
        <div className="panel-body">
          {/* Target Roles Pills */}
          <div style={{ marginBottom: 18 }}>
            <span className="label" style={{ display: 'block', marginBottom: 8 }}>Roles to Search:</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {activeRoles.map((role, idx) => (
                <span key={idx} className="pill-badge badge-green" style={{ fontSize: 12 }}>
                  <Target size={12}/> {role}
                </span>
              ))}
              {activeRoles.length === 0 && (
                <span className="field-hint">No roles currently set. Add your career roles in <Link href="/profile" style={{ color: 'hsl(var(--primary))' }}>Candidate Profile</Link> or <Link href="/roles" style={{ color: 'hsl(var(--primary))' }}>Role Management</Link>.</span>
              )}
            </div>
          </div>

          {/* Crawler Options Controls */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 20 }}>
            <div className="source-card" onClick={() => setVerifyRequirements(!verifyRequirements)}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={14} style={{ color: 'hsl(var(--primary))' }}/> Requirement Verification Gate
                </div>
                <div className="field-hint">Reject jobs lacking clear application email or portal</div>
              </div>
              <div className={`switch ${verifyRequirements ? 'on' : ''}`} />
            </div>

            <div className="source-card" onClick={() => setAggressiveMode(!aggressiveMode)}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={14} style={{ color: aggressiveMode ? '#d97706' : 'inherit' }}/> Aggressive Scraper Mode
                </div>
                <div className="field-hint">Scan all county portals & Google Jobs deeply</div>
              </div>
              <div className={`switch ${aggressiveMode ? 'on' : ''}`} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="label">Max Listings to Ingest: {maxJobs}</span>
              <input
                type="range"
                min={50}
                max={800}
                step={25}
                value={maxJobs}
                onChange={e => setMaxJobs(parseInt(e.target.value) || 300)}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>
          </div>

          {/* Launch Button */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleRunDiscovery}
              disabled={isRunning || !activeRoles.length}
              style={{ minWidth: 220, justifyContent: 'center' }}
            >
              {isRunning ? (
                <>
                  <span className="spinner" style={{ marginRight: 8 }}/> Crawling & Matching Jobs…
                </>
              ) : (
                <>
                  <Play size={16}/> Start Targeted Job Discovery
                </>
              )}
            </button>
            <span className="field-hint">
              {isRunning ? 'Analyzing job feeds across Kenya and worldwide remote…' : 'Applications are kept at review-stage; nothing auto-submits.'}
            </span>
          </div>
        </div>
      </section>

      {/* Discovery Results Summary (When executed) */}
      {lastResult && (
        <section className="panel" style={{ marginBottom: 16, borderColor: 'hsl(var(--primary) / 0.5)' }}>
          <div className="panel-head" style={{ background: 'hsl(var(--secondary) / 0.25)' }}>
            <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'hsl(var(--primary))' }}>
              <CheckCircle2 size={16}/> Discovery Run Completed in {(lastResult.executionTime / 1000).toFixed(1)}s
            </div>
            <Link href="/jobs" className="btn btn-sm btn-primary">
              View Verified Records &rarr;
            </Link>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
              <div style={{ padding: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}>
                <div className="stat-label">Ingested</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{lastResult.discovered}</div>
              </div>
              <div style={{ padding: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}>
                <div className="stat-label">Duplicates Filtered</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{lastResult.duplicates}</div>
              </div>
              <div style={{ padding: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}>
                <div className="stat-label">CV Matched</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'hsl(var(--primary))', marginTop: 4 }}>{lastResult.matched}</div>
              </div>
              <div style={{ padding: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}>
                <div className="stat-label">Instructions Verified</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a', marginTop: 4 }}>{lastResult.requirementVerified}</div>
              </div>
              <div style={{ padding: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}>
                <div className="stat-label">Sources Scraped</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{lastResult.sourcesScraped.length}</div>
              </div>
            </div>

            {lastResult.errors && lastResult.errors.length > 0 && (
              <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fca5a5', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                  <AlertCircle size={16} style={{ color: '#ef4444' }} />
                  <span>Pipeline & AI Brain Warnings ({lastResult.errors.length})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {lastResult.errors.map((err, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#fca5a5', fontFamily: 'monospace' }}>
                      • {err}
                    </div>
                  ))}
                </div>
                {lastResult.errors.some(e => e.includes('AI Brain Error') || e.includes('API key') || e.includes('API_KEY')) && (
                  <div style={{ marginTop: 8 }}>
                    <Link href="/settings" style={{ fontSize: 12, color: '#fff', background: '#dc2626', padding: '4px 10px', borderRadius: 6, textDecoration: 'none', display: 'inline-block', fontWeight: 600 }}>
                      Update AI API Key in Settings &rarr;
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Discovery History Log Panel */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={16} style={{ color: 'hsl(var(--primary))' }}/> Discovery History Log
          </div>
          <span className="eyebrow">{runs.length} Sessions Logged</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Execution Time</th>
                <th>Roles Searched</th>
                <th>Sources Crawled</th>
                <th>Discovered</th>
                <th>Matched</th>
                <th>Duration</th>
                <th>Status (Click to Inspect)</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run.id} style={{ cursor: 'pointer' }} onClick={() => setInspectedRun(run)}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>
                      {new Date(run.startedAt).toLocaleDateString()}
                    </div>
                    <div className="field-hint" style={{ fontSize: 10 }}>
                      {new Date(run.startedAt).toLocaleTimeString()}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {run.rolesSearched.map((r, i) => (
                        <span key={i} className="badge" style={{ fontSize: 10 }}>{r}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className="field-hint">
                      {run.sourcesScraped.length} sources crawled
                    </span>
                  </td>
                  <td>
                    <strong className="mono">{run.discovered}</strong>
                  </td>
                  <td>
                    <span className="score" style={{ fontWeight: 700 }}>
                      {run.matched}
                    </span>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 11 }}>
                      {(run.executionTime / 1000).toFixed(1)}s
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInspectedRun(run);
                      }}
                      className={`badge ${run.errors?.length ? 'badge-amber' : 'badge-green'}`}
                      style={{
                        cursor: 'pointer',
                        border: 'none',
                        background: run.errors?.length ? 'rgba(245, 158, 11, 0.2)' : undefined,
                        color: run.errors?.length ? '#f59e0b' : undefined,
                        fontWeight: 600,
                      }}
                      title="Click to view run details and errors"
                    >
                      {run.errors?.length ? `Warnings (${run.errors.length}) ↗` : 'Completed ↗'}
                    </button>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '32px 16px' }}>
                    <div className="empty">
                      <div className="empty-icon"><Search size={18}/></div>
                      <div className="empty-title">No discovery sessions recorded yet</div>
                      <p className="empty-copy">Click "Start Targeted Job Discovery" above to begin crawling.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Run Inspection Modal */}
      {inspectedRun && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 16,
        }} onClick={() => setInspectedRun(null)}>
          <div style={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 12,
            maxWidth: 640,
            width: '100%',
            maxHeight: '85vh',
            overflowY: 'auto',
            padding: 24,
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid hsl(var(--border))', paddingBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Clock size={18} style={{ color: 'hsl(var(--primary))' }} /> Discovery Session Details
                </h3>
                <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
                  {new Date(inspectedRun.startedAt).toLocaleString()} • Duration: {(inspectedRun.executionTime / 1000).toFixed(1)}s
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectedRun(null)}
                style={{ background: 'transparent', border: 'none', color: 'hsl(var(--muted-foreground))', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
              <div style={{ padding: '10px 12px', background: 'hsl(var(--secondary) / 0.3)', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>Discovered</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{inspectedRun.discovered}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'hsl(var(--secondary) / 0.3)', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>Matched</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'hsl(var(--primary))' }}>{inspectedRun.matched}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'hsl(var(--secondary) / 0.3)', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>Sources</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{inspectedRun.sourcesScraped.length}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'hsl(var(--secondary) / 0.3)', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>Errors/Warnings</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: inspectedRun.errors?.length ? '#f59e0b' : '#10b981' }}>
                  {inspectedRun.errors?.length || 0}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'hsl(var(--muted-foreground))', marginBottom: 6 }}>
                Target Roles Searched:
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {inspectedRun.rolesSearched.map((role, idx) => (
                  <span key={idx} className="badge" style={{ fontSize: 11 }}>{role}</span>
                ))}
              </div>
            </div>

            {/* AI and Pipeline Errors Section */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'hsl(var(--muted-foreground))', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={14} style={{ color: inspectedRun.errors?.length ? '#ef4444' : '#10b981' }} />
                <span>AI Brain Status & Execution Logs:</span>
              </div>
              {inspectedRun.errors && inspectedRun.errors.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inspectedRun.errors.map((err, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '10px 12px',
                        background: err.includes('AI Brain Error') || err.includes('API_KEY') ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.1)',
                        border: `1px solid ${err.includes('AI Brain Error') || err.includes('API_KEY') ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                        borderRadius: 8,
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: err.includes('AI Brain Error') || err.includes('API_KEY') ? '#fca5a5' : '#fde68a',
                      }}
                    >
                      {err}
                    </div>
                  ))}
                  <div style={{ marginTop: 4 }}>
                    <Link href="/settings" className="btn btn-sm" style={{ background: 'hsl(var(--primary))', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>
                      Update AI Settings & Keys &rarr;
                    </Link>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '10px 12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: 8, fontSize: 12, color: '#6ee7b7' }}>
                  ✓ Run completed smoothly with no pipeline or AI errors.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setInspectedRun(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default EnhancedDiscovery;
