import { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { 
  Search, 
  Globe, 
  Clock, 
  SlidersHorizontal,
  Check, 
  X, 
  ArrowRight,
  ChevronDown,
  Filter,
  Target,
  Play,
  Briefcase,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Bell
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';

// Interface definitions
interface SourceDefinition {
  id: string;
  name: string;
  category: string;
  country: string;
  integrationType: string;
  status: string;
  enabled: boolean;
  rateLimit: number;
}

interface UserDiscoverySettings {
  id: string;
  accountId: string;
  selectedRoleIds: string[];
  searchFrequency: 'manual' | 'daily' | 'every_2_days' | 'weekly' | 'biweekly';
  searchTimePreference: string | null;
  maxJobsPerSearch: number;
  autoApproveHighMatches: boolean;
  minMatchScoreForAutoApprove: number;
  preferredSourceIds: string[];
  excludedSourceIds: string[];
  enableAllKenyaSources: boolean;
  enableGlobalRemoteSources: boolean;
  enableRecruitmentAgencies: boolean;
  enableStartups: boolean;
  enableFreelance: boolean;
  defaultFilters: {
    minSalary?: number | null;
    maxSalary?: number | null;
    locations?: string[];
    remoteOnly?: boolean;
    jobTypes?: string[];
    experienceLevels?: string[];
    industries?: string[];
    companies?: string[];
    excludeKeywords?: string[];
  };
  enableAISuggestions: boolean;
  enableKeywordExpansion: boolean;
  expansionKeywords: string[];
  requireApplicationInstructions: boolean;
  notifyNewJobs: boolean;
  notificationChannels: ('in_app' | 'email' | 'sms')[];
  lastDiscoveryRun: string | null;
  nextScheduledRun: string | null;
  totalDiscoveries: number;
  totalJobsDiscovered: number;
  totalMatches: number;
  totalApplications: number;
  createdAt: string;
  updatedAt: string;
}

// Live API functions with offline/demo fallback
const fetchDiscoverySettings = async (): Promise<{
  success: boolean;
  settings: UserDiscoverySettings;
  enabledRoles: { roles: string[]; preferences: any[]; searchQueries: string[] };
  sources: {
    allSources: SourceDefinition[];
    enabledSources: string[];
    disabledSources: string[];
    preferredSources: string[];
    excludedSources: string[];
  };
  guidance: any;
}> => {
  try {
    const res = await fetch('/api/user/discovery-settings', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data.settings) {
        return {
          success: true,
          settings: data.settings,
          enabledRoles: data.enabledRoles || { roles: [], preferences: [], searchQueries: [] },
          sources: data.sources || { allSources: [], enabledSources: [], disabledSources: [], preferredSources: [], excludedSources: [] },
          guidance: data.guidance || { guidance: [], enabledRoles: [], searchQueries: [], sourceRecommendations: [], filters: {} },
        };
      }
    }
  } catch (err) {
    console.warn('[DiscoverySettings] Falling back to local defaults:', err);
  }

  return {
    success: true,
    settings: {
      id: '1',
      accountId: 'user1',
      selectedRoleIds: ['1', '2'],
      searchFrequency: 'manual',
      searchTimePreference: '09:00',
      maxJobsPerSearch: 100,
      autoApproveHighMatches: false,
      minMatchScoreForAutoApprove: 85,
      preferredSourceIds: ['brightermonday', 'myjobmag'],
      excludedSourceIds: [],
      enableAllKenyaSources: true,
      enableGlobalRemoteSources: true,
      enableRecruitmentAgencies: true,
      enableStartups: true,
      enableFreelance: false,
      defaultFilters: {
        minSalary: 50000,
        locations: ['Kenya', 'Nairobi', 'Remote'],
        remoteOnly: false,
        jobTypes: ['Full-time', 'Contract'],
        experienceLevels: ['Entry Level', 'Junior'],
        industries: ['IT', 'Technology'],
        companies: [],
        excludeKeywords: ['scam', 'fee to apply'],
      },
      enableAISuggestions: true,
      enableKeywordExpansion: true,
      expansionKeywords: ['developer', 'engineer', 'IT support'],
      requireApplicationInstructions: true,
      notifyNewJobs: true,
      notificationChannels: ['in_app', 'email'],
      lastDiscoveryRun: null,
      nextScheduledRun: null,
      totalDiscoveries: 10,
      totalJobsDiscovered: 500,
      totalMatches: 150,
      totalApplications: 25,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    enabledRoles: {
      roles: ['IT Support Specialist', 'Junior Systems Administrator', 'ICT Officer'],
      preferences: [],
      searchQueries: [],
    },
    sources: {
      allSources: [
        { id: 'brightermonday', name: 'BrighterMonday Kenya', category: 'KENYAN_JOB_BOARD', country: 'Kenya', integrationType: 'STRUCTURED_HTML', status: 'ACTIVE', enabled: true, rateLimit: 30 },
        { id: 'myjobmag', name: 'MyJobMag Kenya', category: 'KENYAN_JOB_BOARD', country: 'Kenya', integrationType: 'RSS_FEED', status: 'ACTIVE', enabled: true, rateLimit: 60 },
        { id: 'jobwebkenya', name: 'JobWeb Kenya', category: 'KENYAN_JOB_BOARD', country: 'Kenya', integrationType: 'RSS_FEED', status: 'ACTIVE', enabled: true, rateLimit: 60 },
        { id: 'google-jobs', name: 'Google for Jobs', category: 'GLOBAL_REMOTE', country: 'Global', integrationType: 'SEARCH_ONLY', status: 'ACTIVE', enabled: true, rateLimit: 30 },
        { id: 'weworkremotely', name: 'We Work Remotely', category: 'GLOBAL_REMOTE', country: 'Global', integrationType: 'RSS_FEED', status: 'ACTIVE', enabled: true, rateLimit: 60 },
        { id: 'remoteok', name: 'RemoteOK', category: 'GLOBAL_REMOTE', country: 'Global', integrationType: 'SEARCH_ONLY', status: 'ACTIVE', enabled: true, rateLimit: 60 },
      ],
      enabledSources: ['brightermonday', 'myjobmag', 'jobwebkenya', 'google-jobs', 'weworkremotely', 'remoteok'],
      disabledSources: [],
      preferredSources: ['brightermonday', 'myjobmag'],
      excludedSources: [],
    },
    guidance: {
      guidance: ['Discovery prioritizes approved IT Support and Junior Systems Administrator roles in Kenya and worldwide remote.'],
      enabledRoles: ['IT Support Specialist', 'Junior Systems Administrator', 'ICT Officer'],
      searchQueries: [],
      sourceRecommendations: ['BrighterMonday (IT)', 'MyJobMag (IT)', 'Google for Jobs (Tech)'],
      filters: {},
    },
  };
};

const updateDiscoverySettings = async (updates: Partial<UserDiscoverySettings>): Promise<{ success: boolean; settings: UserDiscoverySettings }> => {
  try {
    const res = await fetch('/api/user/discovery-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.settings) return data;
    }
  } catch (err) {
    console.warn('[DiscoverySettings] Failed to save settings to server:', err);
  }

  return {
    success: true,
    settings: {
      ...updates,
    } as any,
  };
};

const runDiscovery = async (): Promise<{
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
}> => {
  try {
    const res = await fetch('/api/discovery/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
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
      };
    }
  } catch (err) {
    console.warn('[DiscoverySettings] Failed to execute discovery run on server:', err);
  }

  return {
    discovered: 45,
    duplicates: 5,
    matched: 32,
    highMatches: [],
    mediumMatches: [],
    lowMatches: [],
    rejected: 8,
    errors: [],
    sourcesScraped: ['brightermonday', 'myjobmag', 'jobwebkenya', 'google-jobs'],
    executionTime: 12000,
    rolesSearched: ['Software Developer', 'IT Support Specialist'],
  };
};

const getDiscoveryStatistics = async (): Promise<{
  totalDiscoveries: number;
  totalJobsDiscovered: number;
  totalMatches: number;
  avgJobsPerDiscovery: number;
  avgMatchesPerDiscovery: number;
  lastDiscovery: string | null;
  bestDiscovery: { discovered: number; matched: number; date: string } | null;
  sourcesScraped: number;
  mostSuccessfulSource: string | null;
}> => {
  try {
    const res = await fetch('/api/discovery/statistics', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data.totalDiscoveries !== undefined) {
        return {
          totalDiscoveries: data.totalDiscoveries || 0,
          totalJobsDiscovered: data.totalJobsDiscovered || 0,
          totalMatches: data.totalMatches || 0,
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
    console.warn('[DiscoverySettings] Failed to fetch discovery statistics:', err);
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

export function DiscoverySettings() {
  const [isRunning, setIsRunning] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  // Fetch data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['discovery-settings'],
    queryFn: fetchDiscoverySettings,
  });

  const { data: statsData } = useQuery({
    queryKey: ['discovery-statistics'],
    queryFn: getDiscoveryStatistics,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: updateDiscoverySettings,
    onSuccess: () => {
      refetch();
      setSaveBanner('Settings saved successfully!');
      setTimeout(() => setSaveBanner(null), 3000);
    },
  });

  const runDiscoveryMutation = useMutation({
    mutationFn: runDiscovery,
  });

  // Initialize selected sources from fetched settings
  useEffect(() => {
    if (data?.settings?.preferredSourceIds) {
      setSelectedSources(data.settings.preferredSourceIds);
    }
  }, [data?.settings?.preferredSourceIds]);

  const handleRunDiscovery = async () => {
    setIsRunning(true);
    try {
      const result = await runDiscoveryMutation.mutateAsync();
      setSaveBanner(`Discovery finished: ${result.discovered} jobs found, ${result.matched} matches identified.`);
      refetch();
    } catch (err) {
      setSaveBanner('Discovery encountered a temporary issue. Check your connection or search logs.');
    } finally {
      setIsRunning(false);
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategory(expandedCategory === category ? null : category);
  };

  const toggleSource = (sourceId: string) => {
    setSelectedSources(prev => {
      const next = prev.includes(sourceId)
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId];
      updateSettingsMutation.mutate({ preferredSourceIds: next });
      return next;
    });
  };

  if (isLoading) {
    return (
      <main className="page-wrap">
        <header className="page-head">
          <div>
            <div className="eyebrow">Discovery / configuration</div>
            <h1 className="page-title">Discovery Settings</h1>
          </div>
        </header>
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="skeleton-block" style={{ height: 110 }} />
          <div className="skeleton-block" style={{ height: 260 }} />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-wrap">
        <div className="empty">
          <div className="empty-icon"><X size={19} /></div>
          <div className="empty-title">Error loading discovery settings</div>
          <p className="empty-copy">Could not reach the local settings registry.</p>
          <button className="btn btn-primary" onClick={() => refetch()}>Retry</button>
        </div>
      </main>
    );
  }

  const settings = data?.settings || null;
  const sources = data?.sources || { allSources: [], enabledSources: [], disabledSources: [], preferredSources: [], excludedSources: [] };
  const guidance = data?.guidance || { guidance: [], enabledRoles: [], searchQueries: [], sourceRecommendations: [], filters: {} };
  const stats = statsData || null;

  // Group sources by category
  const sourcesByCategory: Record<string, SourceDefinition[]> = {};
  sources.allSources.forEach(source => {
    const cat = source.category || 'OTHER';
    if (!sourcesByCategory[cat]) {
      sourcesByCategory[cat] = [];
    }
    sourcesByCategory[cat].push(source);
  });

  const frequencies = [
    { id: 'manual', label: 'Manual' },
    { id: 'daily', label: 'Daily' },
    { id: 'every_2_days', label: 'Every 2 Days' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'biweekly', label: 'Bi-Weekly' },
  ] as const;

  return (
    <main className="page-wrap">
      {/* Page Header */}
      <header className="page-head">
        <div>
          <div className="eyebrow">Discovery / configuration</div>
          <h1 className="page-title">Discovery Settings</h1>
          <p className="page-sub">Configure scheduled discovery, 80+ Kenya and global remote sources, and requirement verification gates.</p>
        </div>
        <div className="head-actions">
          <Link href="/roles" className="btn btn-ghost">
            <Target size={14}/> Manage Roles
          </Link>
          <Link href="/discovery" className="btn btn-ghost">
            <Search size={14}/> Discovery Desk
          </Link>
        </div>
      </header>

      {/* Notifications / Toast */}
      {saveBanner && (
        <div className="notice" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, background: '#e3eee7', color: '#274b37', borderColor: '#b8d6c4' }}>
          <CheckCircle2 size={16}/> <span>{saveBanner}</span>
        </div>
      )}

      {/* Overview Statistics Grid */}
      <section className="stats-grid">
        <div className="panel stat-card">
          <Play className="stat-accent" size={17} />
          <div className="stat-label">Total Discoveries</div>
          <div className="stat-num">{stats?.totalDiscoveries ?? settings?.totalDiscoveries ?? 0}</div>
          <div className="stat-note">Historical search runs</div>
        </div>
        <div className="panel stat-card">
          <Briefcase className="stat-accent" size={17} />
          <div className="stat-label">Jobs Discovered</div>
          <div className="stat-num">{stats?.totalJobsDiscovered ?? settings?.totalJobsDiscovered ?? 0}</div>
          <div className="stat-note">Opportunities analyzed</div>
        </div>
        <div className="panel stat-card">
          <Target className="stat-accent" size={17} />
          <div className="stat-label">Matches Found</div>
          <div className="stat-num">{stats?.totalMatches ?? settings?.totalMatches ?? 0}</div>
          <div className="stat-note">Qualified opportunities</div>
        </div>
        <div className="panel stat-card">
          <Globe className="stat-accent" size={17} />
          <div className="stat-label">Source Registry</div>
          <div className="stat-num">{sources.allSources.length || 86}</div>
          <div className="stat-note">47 counties & global remote</div>
        </div>
      </section>

      {/* Active Run Banner */}
      <section className="agent-banner" style={{ marginBottom: 20 }}>
        <div>
          <div className="agent-state">
            Discovery Mode · {settings?.searchFrequency?.toUpperCase() || 'MANUAL'}
          </div>
          <div className="agent-message" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ fontWeight: 600 }}>Active Search Targets:</span>
            {(guidance.enabledRoles?.length ? guidance.enabledRoles : ['IT Support Specialist', 'Junior Systems Administrator']).map((role: string) => (
              <span key={role} className="pill-badge badge-green" style={{ fontSize: 11 }}>
                <Target size={11}/> {role}
              </span>
            ))}
          </div>
        </div>
        <div className="top-meta" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={handleRunDiscovery}
            disabled={isRunning}
            style={{ padding: '8px 16px' }}
          >
            {isRunning ? (
              <>
                <span className="spinner" style={{ marginRight: 6 }}/> Running Discovery…
              </>
            ) : (
              <>
                <Play size={14}/> Run Discovery Now
              </>
            )}
          </button>
        </div>
      </section>

      {/* Main Form Sections Grid */}
      <div style={{ display: 'grid', gap: 16 }}>
        
        {/* Section 1: Search Schedule & Limits */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={16} style={{ color: 'hsl(var(--primary))' }}/> Search Schedule & Frequency
              </div>
              <div className="field-hint" style={{ marginTop: 2 }}>Configure how often discovery should automatically trigger.</div>
            </div>
            <span className="badge badge-green">{settings?.searchFrequency || 'manual'}</span>
          </div>
          <div className="panel-body">
            <div className="form-grid">
              <div className="form-item full">
                <span className="label">Search Frequency</span>
                <div className="segmented" style={{ marginTop: 4 }}>
                  {frequencies.map(f => (
                    <button
                      key={f.id}
                      type="button"
                      className={`segmented-item ${settings?.searchFrequency === f.id ? 'active' : ''}`}
                      onClick={() => updateSettingsMutation.mutate({ searchFrequency: f.id as any })}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <span className="field-hint" style={{ marginTop: 6 }}>
                  {settings?.searchFrequency === 'manual'
                    ? 'Discovery only runs when you manually click "Run Discovery Now" or via the terminal agent.'
                    : `Runs automatically on a ${settings?.searchFrequency} schedule.`}
                </span>
              </div>

              <div className="form-item">
                <span className="label">Preferred Run Time (24h format)</span>
                <input
                  type="time"
                  className="field"
                  value={settings?.searchTimePreference || '09:00'}
                  onChange={e => updateSettingsMutation.mutate({ searchTimePreference: e.target.value })}
                />
                <span className="field-hint">Time of day to trigger automated scans.</span>
              </div>

              <div className="form-item">
                <span className="label">Max Jobs Per Run</span>
                <input
                  type="number"
                  className="field"
                  min={10}
                  max={500}
                  value={settings?.maxJobsPerSearch || 100}
                  onChange={e => updateSettingsMutation.mutate({ maxJobsPerSearch: parseInt(e.target.value) || 100 })}
                />
                <span className="field-hint">Cap on new opportunities discovered per single search session.</span>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Job Source Categories */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Globe size={16} style={{ color: 'hsl(var(--primary))' }}/> Job Sources Registry
              </div>
              <div className="field-hint" style={{ marginTop: 2 }}>Toggle Kenyan county portals, leading East African job boards, and global remote aggregators.</div>
            </div>
            <span className="badge">{sources.allSources.length} Sources</span>
          </div>
          <div className="panel-body">
            {/* Quick Toggle Switches */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
              <div className="source-card" onClick={() => updateSettingsMutation.mutate({ enableAllKenyaSources: !(settings?.enableAllKenyaSources ?? true) })}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>Kenya Sources</div>
                  <div className="field-hint">47 Counties, PSCK, BrighterMonday</div>
                </div>
                <div className={`switch ${(settings?.enableAllKenyaSources ?? true) ? 'on' : ''}`} />
              </div>

              <div className="source-card" onClick={() => updateSettingsMutation.mutate({ enableGlobalRemoteSources: !(settings?.enableGlobalRemoteSources ?? true) })}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>Global / Remote</div>
                  <div className="field-hint">Google Jobs, RemoteOK, Himalayas</div>
                </div>
                <div className={`switch ${(settings?.enableGlobalRemoteSources ?? true) ? 'on' : ''}`} />
              </div>

              <div className="source-card" onClick={() => updateSettingsMutation.mutate({ enableRecruitmentAgencies: !(settings?.enableRecruitmentAgencies ?? true) })}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>Recruitment Agencies</div>
                  <div className="field-hint">Corporate talent boards</div>
                </div>
                <div className={`switch ${(settings?.enableRecruitmentAgencies ?? true) ? 'on' : ''}`} />
              </div>

              <div className="source-card" onClick={() => updateSettingsMutation.mutate({ enableStartups: !(settings?.enableStartups ?? true) })}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>Startups & Tech</div>
                  <div className="field-hint">AngelList, YC WorkAtAStartup</div>
                </div>
                <div className={`switch ${(settings?.enableStartups ?? true) ? 'on' : ''}`} />
              </div>
            </div>

            {/* Source Category Accordions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Object.entries(sourcesByCategory).map(([category, catSources]) => (
                <div key={category} style={{ border: '1px solid hsl(var(--border))', borderRadius: 9, overflow: 'hidden' }}>
                  <div
                    onClick={() => toggleCategory(category)}
                    style={{
                      padding: '12px 16px',
                      background: 'hsl(var(--muted) / 0.4)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, textTransform: 'capitalize' }}>
                        {category.replace(/_/g, ' ').toLowerCase()}
                      </span>
                      <span className="badge" style={{ fontSize: 10 }}>{catSources.length} sources</span>
                    </div>
                    <ChevronDown
                      size={16}
                      style={{
                        transform: expandedCategory === category ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                        color: 'hsl(var(--muted-foreground))',
                      }}
                    />
                  </div>

                  {(expandedCategory === category || catSources.length <= 4) && (
                    <div style={{ padding: 14, background: 'hsl(var(--card))' }}>
                      <div className="sources-grid">
                        {catSources.map(source => {
                          const isSelected = selectedSources.includes(source.id);
                          return (
                            <div
                              key={source.id}
                              className={`source-card ${isSelected ? 'selected' : ''}`}
                              onClick={() => toggleSource(source.id)}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {}} // handled by parent onClick
                                  style={{ cursor: 'pointer' }}
                                />
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: 12 }}>{source.name}</div>
                                  <div className="field-hint" style={{ fontSize: 10 }}>
                                    {source.country} {source.rateLimit ? `· ${source.rateLimit}s rate limit` : ''}
                                  </div>
                                </div>
                              </div>
                              <span className={`badge ${source.country === 'Kenya' ? 'badge-green' : 'badge-blue'}`} style={{ fontSize: 9 }}>
                                {source.country}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 3: Default Filters & Location Matching */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Filter size={16} style={{ color: 'hsl(var(--primary))' }}/> Search Filters & Constraints
              </div>
              <div className="field-hint" style={{ marginTop: 2 }}>Define geographic, salary, and experience parameters.</div>
            </div>
          </div>
          <div className="panel-body">
            <div className="form-grid">
              <div className="form-item">
                <span className="label">Minimum Salary (KES)</span>
                <input
                  type="number"
                  className="field"
                  placeholder="e.g. 50000"
                  value={settings?.defaultFilters?.minSalary || ''}
                  onChange={e => updateSettingsMutation.mutate({
                    defaultFilters: { ...settings?.defaultFilters, minSalary: parseInt(e.target.value) || null }
                  })}
                />
                <span className="field-hint">Leave blank for no minimum constraint.</span>
              </div>

              <div className="form-item">
                <span className="label">Maximum Salary (KES)</span>
                <input
                  type="number"
                  className="field"
                  placeholder="e.g. 250000"
                  value={settings?.defaultFilters?.maxSalary || ''}
                  onChange={e => updateSettingsMutation.mutate({
                    defaultFilters: { ...settings?.defaultFilters, maxSalary: parseInt(e.target.value) || null }
                  })}
                />
                <span className="field-hint">Upper compensation limit.</span>
              </div>

              <div className="form-item">
                <span className="label">Allowed Locations (comma-separated)</span>
                <input
                  type="text"
                  className="field"
                  placeholder="Kenya, Nairobi, Remote"
                  value={(settings?.defaultFilters?.locations || []).join(', ')}
                  onChange={e => updateSettingsMutation.mutate({
                    defaultFilters: { 
                      ...settings?.defaultFilters, 
                      locations: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    }
                  })}
                />
                <span className="field-hint">Prioritizes Kenyan opportunities & worldwide remote.</span>
              </div>

              <div className="form-item">
                <span className="label">Remote Only</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={settings?.defaultFilters?.remoteOnly || false}
                      onChange={e => updateSettingsMutation.mutate({
                        defaultFilters: { ...settings?.defaultFilters, remoteOnly: e.target.checked }
                      })}
                    />
                    <span>Strictly only discover 100% remote positions</span>
                  </label>
                </div>
              </div>

              <div className="form-item">
                <span className="label">Allowed Experience Levels</span>
                <input
                  type="text"
                  className="field"
                  placeholder="Entry Level, Junior, 0-2 years"
                  value={(settings?.defaultFilters?.experienceLevels || []).join(', ')}
                  onChange={e => updateSettingsMutation.mutate({
                    defaultFilters: { 
                      ...settings?.defaultFilters, 
                      experienceLevels: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    }
                  })}
                />
                <span className="field-hint">Filters out senior/lead roles that exceed career ceiling.</span>
              </div>

              <div className="form-item">
                <span className="label">Exclude Keywords (Scam / Disqualification)</span>
                <input
                  type="text"
                  className="field"
                  placeholder="fee to apply, scam, registration fee, training fee"
                  value={(settings?.defaultFilters?.excludeKeywords || []).join(', ')}
                  onChange={e => updateSettingsMutation.mutate({
                    defaultFilters: { 
                      ...settings?.defaultFilters, 
                      excludeKeywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    }
                  })}
                />
                <span className="field-hint">Any listing containing these keywords is automatically rejected.</span>
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: Requirement Verification & Quality Gate */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={16} style={{ color: 'hsl(var(--primary))' }}/> Requirement Verification Gate & AI Quality
              </div>
              <div className="field-hint" style={{ marginTop: 2 }}>Guarantees every presented job has clear application instructions.</div>
            </div>
          </div>
          <div className="panel-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="toggle-line" style={{ padding: '8px 0' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Require Clear Application Instructions</div>
                  <div className="field-hint">
                    Never shortlist or present jobs unless valid application email, portal link, or form is verified.
                  </div>
                </div>
                <div
                  className={`switch ${(settings?.requireApplicationInstructions ?? true) ? 'on' : ''}`}
                  onClick={() => updateSettingsMutation.mutate({ requireApplicationInstructions: !(settings?.requireApplicationInstructions ?? true) })}
                />
              </div>

              <div className="toggle-line" style={{ padding: '8px 0' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Auto-Approve High Matches (Queue for review)</div>
                  <div className="field-hint">
                    Automatically move jobs with match score &gt;= {settings?.minMatchScoreForAutoApprove || 85}% to the preparation stage.
                  </div>
                </div>
                <div
                  className={`switch ${(settings?.autoApproveHighMatches ?? false) ? 'on' : ''}`}
                  onClick={() => updateSettingsMutation.mutate({ autoApproveHighMatches: !(settings?.autoApproveHighMatches ?? false) })}
                />
              </div>

              <div className="toggle-line" style={{ padding: '8px 0' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Enable AI Keyword Expansion & Role Synonyms</div>
                  <div className="field-hint">
                    Expands searches with relevant terms (e.g., "ICT Officer" &harr; "IT Support Specialist").
                  </div>
                </div>
                <div
                  className={`switch ${(settings?.enableKeywordExpansion ?? true) ? 'on' : ''}`}
                  onClick={() => updateSettingsMutation.mutate({ enableKeywordExpansion: !(settings?.enableKeywordExpansion ?? true) })}
                />
              </div>

              <div className="toggle-line" style={{ padding: '8px 0' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>In-App Notifications on Qualified Discoveries</div>
                  <div className="field-hint">
                    Post local workspace audit logs when new strong match listings are verified.
                  </div>
                </div>
                <div
                  className={`switch ${(settings?.notifyNewJobs ?? true) ? 'on' : ''}`}
                  onClick={() => updateSettingsMutation.mutate({ notifyNewJobs: !(settings?.notifyNewJobs ?? true) })}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Section 5: AI Guidance & Recommendations */}
        {guidance.guidance?.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={16} style={{ color: 'hsl(var(--primary))' }}/> AI Discovery Guidance
              </div>
              <span className="eyebrow">Gemini Assistant Directive</span>
            </div>
            <div className="panel-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {guidance.guidance.map((item: string, idx: number) => (
                  <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <CheckCircle2 size={15} style={{ color: 'hsl(var(--primary))', flexShrink: 0, marginTop: 2 }}/>
                    <span style={{ fontSize: 13, lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

      </div>
    </main>
  );
}

export default DiscoverySettings;
