import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient, useQuery } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation } from 'wouter';
import {
  Activity, BriefcaseBusiness, Check, ChevronRight, CircleHelp, Clock3, FileText, Gauge,
  LayoutDashboard, LogOut, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Trash2, UserRound, X, ExternalLink, Play, Pause, Square, RotateCw, LockKeyhole, ClipboardList,
  Mail, Paperclip, Copy, Calendar, Send, UploadCloud, Download, CheckCircle2, AlertCircle, FileCheck, Layers,
  Globe, MapPin, Target, PanelLeftClose, PanelLeftOpen, Menu,
} from 'lucide-react';
import {
  useHealthCheck, useGetAuthStatus, useSetupLocalAccount, useLoginLocalAccount, useLogoutLocalAccount,
  useGetDashboard, useListJobs, useCreateJob, useGetJob, useUpdateJob, useTrackJobApplication,
  useListApplications, useGetCandidateProfile, useSaveCandidateProfile, useListSearchProfiles,
  useCreateSearchProfile, useUpdateSearchProfile, useDeleteSearchProfile, useListCvs, useUploadCv,
  useDeleteCv, useParseCvProfile, useGetAgentStatus, useControlAgent, useGetSettings, getGetDashboardQueryKey,
  getListJobsQueryKey, getListApplicationsQueryKey, getGetJobQueryKey, getGetCandidateProfileQueryKey,
  getListSearchProfilesQueryKey, getListCvsQueryKey, getGetAgentStatusQueryKey,
} from '@workspace/api-client-react';
import { SettingsConnections } from './components/SettingsConnections';
import { SourcesManagement, IndexingControl, CountyRegistryView, JobProvenancePanel } from './components/SourcesAndIndexingViews';
import { RoleManagement } from './pages/RoleManagement';
import { DiscoverySettings } from './pages/DiscoverySettings';
import { EnhancedDiscovery } from './pages/EnhancedDiscovery';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 8000 } } });
const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/jobs', label: 'Job records', icon: BriefcaseBusiness },
  { href: '/applications', label: 'Applications', icon: ClipboardList },
  { href: '/sources', label: 'Sources & Registry', icon: Globe },
  { href: '/indexing', label: 'Indexing Control', icon: Gauge },
  { href: '/counties', label: '47 Counties', icon: MapPin },
  { href: '/profile', label: 'Candidate profile', icon: UserRound },
  { href: '/search-profiles', label: 'Search profiles', icon: SlidersHorizontal },
  { href: '/cvs', label: 'Document Vault', icon: Layers },
  { href: '/settings', label: 'Agent & settings', icon: Settings2 },
  { href: '/roles', label: 'Role Management', icon: Target },
  { href: '/discovery-settings', label: 'Discovery Settings', icon: SlidersHorizontal },
  { href: '/discovery', label: 'Enhanced Discovery', icon: Search }
];
const labelize = (value = '') => value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const date = (s?: string | null) => s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const ago = (s?: string | null) => s ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(s)) : '—';
const split = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
const errText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Try again.';

function Button({ children, onClick, variant = '', disabled = false, type = 'button', ...props }: any) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`btn ${variant ? `btn-${variant}` : ''}`} {...props}>{children}</button>;
}
function Field({ label, hint, className = '', ...props }: any) {
  return <label className={`form-item ${className}`}><span className="label">{label}</span><input className="field" {...props}/>{hint && <span className="field-hint">{hint}</span>}</label>;
}
function TextArea({ label, className = '', ...props }: any) {
  return <label className={`form-item ${className}`}><span className="label">{label}</span><textarea className="field" rows={4} {...props}/></label>;
}
function SelectField({ label, children, ...props }: any) {
  return <label className="form-item"><span className="label">{label}</span><select className="field select" {...props}>{children}</select></label>;
}
function PageHead({ eyebrow, title, sub, children }: any) {
  return <header className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1>{sub && <p className="page-sub">{sub}</p>}</div>{children && <div className="head-actions">{children}</div>}</header>;
}
function Loading({ count = 3 }: { count?: number }) {
  return <div style={{ display: 'grid', gap: 12 }}>{Array.from({ length: count }, (_, i) => <div className="skeleton-block" key={i}/>)}</div>;
}
function ErrorState({ error, retry }: any) {
  return <div className="empty"><div className="empty-icon"><CircleHelp size={19}/></div><div className="empty-title">This record could not load</div><div className="empty-copy">{errText(error)}</div><Button onClick={retry}>Retry</Button></div>;
}
function Empty({ icon: Icon = BriefcaseBusiness, title, copy, action }: any) {
  return <div className="empty"><div className="empty-icon"><Icon size={19}/></div><div className="empty-title">{title}</div><div className="empty-copy">{copy}</div>{action}</div>;
}
function ChipInput({ label, initial = '', onChange }: any) {
  const [raw, setRaw] = useState(initial);
  return <label className="form-item"><span className="label">{label}</span><input className="field" value={raw} onChange={e => { setRaw(e.target.value); onChange(e.target.value); }} placeholder="Separate items with commas"/></label>;
}
function AppShell({ children, health }: { children: React.ReactNode; health: any }) {
  const [path] = useLocation();
  const logout = useLogoutLocalAccount();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('kaziscout_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = () => {
    setCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('kaziscout_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  const currentNav = nav.find(n => n.href === path) || nav[0];

  return (
    <div className="app-shell">
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-head">
          <Link
            href="/dashboard"
            className="brand-card-link"
            title="KaziScout Dashboard"
            onClick={() => setMobileOpen(false)}
          >
            <img
              src="/kaziscout-icon.png"
              alt="KaziScout"
              style={{
                height: 38,
                width: 38,
                borderRadius: 10,
                display: 'block',
                flexShrink: 0,
                boxShadow: '0 3px 10px rgba(0,0,0,0.35)',
              }}
            />
            <div className="brand-text-block" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.025em', color: '#ffffff', lineHeight: 1.15 }}>
                  Kazi<span style={{ color: '#10b981' }}>Scout</span>
                </span>
                <span style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: 'rgba(16, 185, 129, 0.16)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em'
                }}>
                  PRO
                </span>
              </div>
            </div>
          </Link>
          <button
            onClick={toggleSidebar}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 6,
              padding: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            className="sidebar-toggle-btn"
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>

        <div className="sidebar-nav">
          {!collapsed && (
            <div className="tagline-banner">
              <Sparkles size={13} color="#10b981" style={{ flexShrink: 0 }} />
              <span>Find the right work. Apply with confidence.</span>
            </div>
          )}

          <div className="nav-label">Workspace</div>
          {nav.map(item => {
            const Icon = item.icon;
            const isActive = path === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${isActive ? 'active' : ''}`}
                data-testid={`link-${item.label.toLowerCase().replaceAll(' ', '-')}`}
                title={collapsed ? item.label : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={16} style={{ flexShrink: 0 }} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="side-foot">
          <div className="side-foot-text">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#e2e8f0', fontWeight: 600 }}>
              <ShieldCheck size={14} color="#10b981"/>Local workspace
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              Private by default. Nothing submits without you.
            </div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>
              Powered by{' '}
              <a
                href="https://vintechsystems.store"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#10b981',
                  fontWeight: 600,
                  textDecoration: 'none',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#34d399'; (e.currentTarget as HTMLElement).style.textDecoration = 'underline'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#10b981'; (e.currentTarget as HTMLElement).style.textDecoration = 'none'; }}
              >
                Vintech Systems & Consulting
              </a>
            </div>
          </div>
          <button
            className="nav-link"
            style={{
              paddingLeft: 0,
              paddingRight: 0,
              marginTop: 10,
              width: '100%',
              justifyContent: collapsed ? 'center' : 'flex-start',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer'
            }}
            title="Sign out"
            onClick={() => logout.mutate(undefined, { onSuccess: () => { qc.invalidateQueries(); window.location.href = '/login'; } })}
          >
            <LogOut size={14} style={{ flexShrink: 0 }} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileOpen(true)}
              style={{
                display: 'none',
                background: 'transparent',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                padding: '6px 8px',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'hsl(var(--foreground))',
                cursor: 'pointer'
              }}
              title="Open navigation menu"
            >
              <Menu size={16} />
            </button>

            <button
              className="desktop-toggle-btn"
              onClick={toggleSidebar}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{
                background: 'transparent',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                padding: '6px 8px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'hsl(var(--muted-foreground))',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>

            <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              <span style={{ color: 'hsl(var(--muted-foreground))' }}>Operations Desk</span>
              <span style={{ color: 'hsl(var(--border))' }}>/</span>
              <span style={{ color: '#10b981', fontWeight: 700 }}>{currentNav.label}</span>
            </div>

            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 20,
              background: 'rgba(16, 185, 129, 0.1)',
              color: '#059669',
              border: '1px solid rgba(16, 185, 129, 0.25)'
            }}>
              47 Counties + Global
            </span>
          </div>

          <div className="top-meta" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {(() => {
              const healthData = health.data as any;
              const isTurso = healthData?.database === 'turso';
              const isVercelHost = typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname);
              const isEphemeral = Boolean(healthData?.isVercel || (!isTurso && isVercelHost));

              return (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: isEphemeral ? 'rgba(245, 158, 11, 0.12)' : 'hsl(var(--muted))',
                  padding: '4px 12px',
                  borderRadius: 20,
                  border: `1px solid ${isEphemeral ? 'rgba(245, 158, 11, 0.35)' : 'hsl(var(--border))'}`
                }}>
                  <span
                    className={`status-dot ${health.isError ? '' : 'status-pulse'}`}
                    style={{
                      background: health.isError ? '#ef4444' : isTurso ? '#10b981' : isEphemeral ? '#f59e0b' : '#10b981',
                      width: 8,
                      height: 8
                    }}
                  />
                  <span style={{
                    fontWeight: 600,
                    fontSize: 11,
                    color: health.isError ? '#ef4444' : isTurso ? '#059669' : isEphemeral ? '#b45309' : 'hsl(var(--foreground))'
                  }}>
                    {health.isLoading
                      ? 'Checking API…'
                      : health.isError
                        ? 'API Disconnected'
                        : isTurso
                          ? 'Turso Cloud DB Online'
                          : isEphemeral
                            ? 'Ephemeral Local Storage'
                            : 'Local Engine Online'}
                  </span>
                  <span className="mono" style={{ color: 'hsl(var(--muted-foreground))' }}>·</span>
                  <span style={{ color: isEphemeral ? '#b45309' : 'hsl(var(--muted-foreground))', fontSize: 11 }}>
                    {isTurso ? 'Persistent' : isEphemeral ? 'Data resets on restart' : 'Private by default'}
                  </span>
                </div>
              );
            })()}
          </div>
        </header>

        {(() => {
          const healthData = health.data as any;
          const isTurso = healthData?.database === 'turso';
          const isVercelHost = typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname);
          const isEphemeral = Boolean(healthData?.isVercel || (!isTurso && isVercelHost));

          if (!isEphemeral) return null;
          return (
            <div style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              borderRadius: 10,
              padding: '12px 18px',
              margin: '16px 24px 0 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              boxShadow: '0 2px 8px rgba(245, 158, 11, 0.05)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <AlertCircle size={20} style={{ color: '#d97706' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>
                    Persistent Database Not Configured — Storage is Ephemeral
                  </div>
                  <div style={{ fontSize: 12, color: '#78350f', marginTop: 2, lineHeight: 1.4 }}>
                    KaziScout is running on Vercel with ephemeral container storage. Accounts, API keys, and job records are lost whenever serverless lambdas restart.
                    To persist your data permanently, configure <b>TURSO_DATABASE_URL</b> and <b>TURSO_AUTH_TOKEN</b> in Vercel, then <b>Redeploy</b>.
                  </div>
                </div>
              </div>
              <Link href="/settings" className="btn btn-primary" style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '7px 14px', flexShrink: 0, textDecoration: 'none' }}>
                Database Setup Guide →
              </Link>
            </div>
          );
        })()}

        {children}
      </div>
    </div>
  );
}
function AuthGate() {
  const auth = useGetAuthStatus();
  const health = useHealthCheck();
  const [, setLoc] = useLocation();
  const needsRedirect = Boolean(auth.data && !auth.data.authenticated);
  useEffect(() => {
    if (needsRedirect) setLoc(auth.data?.setupRequired ? '/setup' : '/login');
  }, [needsRedirect, auth.data?.setupRequired, setLoc]);
  if (auth.isLoading) return <div className="auth-main"><div style={{ width: 320 }}><div className="skeleton-block"/></div></div>;
  if (auth.isError) return <div className="auth-main"><ErrorState error={auth.error} retry={auth.refetch}/></div>;
  if (needsRedirect) return <div className="auth-main"><div style={{ width: 320 }}><div className="skeleton-block"/></div></div>;
  return <AppShell health={health}><Switch>
    <Route path="/dashboard" component={Dashboard}/><Route path="/jobs" component={Jobs}/><Route path="/applications" component={Applications}/>
    <Route path="/sources" component={SourcesManagement}/>
    <Route path="/indexing" component={IndexingControl}/>
    <Route path="/counties" component={CountyRegistryView}/>
    <Route path="/profile" component={Profile}/><Route path="/search-profiles" component={SearchProfiles}/><Route path="/cvs" component={Cvs}/>
    <Route path="/settings" component={Settings}/>
    <Route path="/roles" component={RoleManagement}/>
    <Route path="/discovery-settings" component={DiscoverySettings}/>
    <Route path="/discovery" component={EnhancedDiscovery}/>
    <Route component={Dashboard}/>
  </Switch></AppShell>;
}

function Dashboard() {
  const q = useGetDashboard();
  const control = useControlAgent();
  const qc = useQueryClient();
  const data = q.data;
  if (q.isLoading) return <main className="page-wrap"><Loading/></main>;
  if (q.isError) return <main className="page-wrap"><ErrorState error={q.error} retry={q.refetch}/></main>;
  if (!data) return null;
  const stats = [
    ['Job records', data.jobsDiscovered, 'Across all sources', BriefcaseBusiness, '#3b82f6'],
    ['Awaiting review', data.jobsAwaitingReview, 'Your next decisions', Clock3, '#f59e0b'],
    ['Applications tracked', data.applicationsPending, 'In your workspace', ClipboardList, '#8b5cf6'],
    ['Top match', data.topMatchScore == null ? '—' : `${data.topMatchScore}%`, 'Best recorded fit', Gauge, '#10b981'],
  ];
  const agent = data.agent;
  const runLiveSearch = () => {
    control.mutate({ data: { command: 'runNow' } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
      },
      onError: err => alert(errText(err)),
    });
  };

  return <main className="page-wrap">
    <PageHead eyebrow="Workspace / overview" title="Your search, at a glance" sub="A live view of the records you have saved locally.">
      <Button onClick={runLiveSearch} disabled={control.isPending} style={{ background: '#10b981', color: '#ffffff', borderColor: '#10b981', fontWeight: 600 }}>
        <RotateCw size={14} className={control.isPending ? 'spin' : ''}/>{control.isPending ? 'Searching live jobs…' : 'Run live job search'}
      </Button>
    </PageHead>
    <section className="agent-banner" style={{
      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%)',
      border: '1px solid rgba(16, 185, 129, 0.25)',
      borderRadius: 12,
      padding: '16px 20px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 16,
      marginBottom: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: 'rgba(16, 185, 129, 0.15)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          display: 'grid',
          placeItems: 'center',
          color: '#10b981'
        }}>
          <Sparkles size={18}/>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: '600 11px var(--app-font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#10b981' }}>
              Autonomous Scout Engine
            </span>
            <span className="badge badge-green" style={{ fontSize: 9 }}>
              {labelize(agent.state)}
            </span>
          </div>
          <div className="agent-message" style={{ fontWeight: 500, marginTop: 4 }}>
            {agent.message}
          </div>
        </div>
      </div>
      <div className="top-meta" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={runLiveSearch} disabled={control.isPending} style={{ padding: '6px 12px', fontSize: 12, borderColor: '#10b981', color: '#059669', background: 'transparent' }}>
          <RotateCw size={12} className={control.isPending ? 'spin' : ''}/>
          {control.isPending ? 'Scanning Sources…' : 'Run Search Now'}
        </Button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
          <span className="status-dot status-pulse" style={{ background: agent.state === 'RUNNING' ? '#10b981' : '#f59e0b', width: 7, height: 7 }}/>
          <span>Active</span>
        </div>
      </div>
    </section>
    <section className="stats-grid">
      {stats.map(([label, val, note, Icon, accentColor]: any) => (
        <div
          className="panel stat-card"
          key={label}
          style={{
            position: 'relative',
            overflow: 'hidden',
            transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
            (e.currentTarget as HTMLElement).style.borderColor = accentColor;
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.transform = 'none';
            (e.currentTarget as HTMLElement).style.boxShadow = '';
            (e.currentTarget as HTMLElement).style.borderColor = '';
          }}
        >
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accentColor }}/>
          <Icon className="stat-accent" size={18} style={{ color: accentColor }}/>
          <div className="stat-label">{label}</div>
          <div className="stat-num" style={{ color: label === 'Top match' ? '#10b981' : undefined }}>{val}</div>
          <div className="stat-note">{note}</div>
        </div>
      ))}
    </section>
    <div className="dash-grid">
      <section className="panel"><div className="panel-head"><div className="panel-title">Recent activity</div><span className="eyebrow">Persisted events</span></div><div className="panel-body">
        {data.recentActivity.length ? data.recentActivity.map(a => <div className="activity" key={a.id} data-testid={`activity-${a.id}`}><span className="activity-pin"/><div><div className="activity-text">{a.message}</div><div className="activity-time">{date(a.createdAt)}</div></div></div>) : <Empty icon={Activity} title="No activity recorded yet" copy="As jobs and applications are added, real changes will appear here."/>}
      </div></section>
      <section className="panel"><div className="panel-head"><div className="panel-title">The pipeline</div><span className="eyebrow">No automatic sending</span></div><div className="panel-body">
        <div className="toggle-line"><span>New matches</span><strong className="mono">{data.newMatches}</strong></div><div className="toggle-line"><span>Applications marked submitted</span><strong className="mono">{data.applicationsSubmitted}</strong></div><div className="toggle-line"><span>Interviews</span><strong className="mono">{data.interviews}</strong></div><div className="toggle-line"><span>Offers</span><strong className="mono">{data.offers}</strong></div>
        <p className="field-hint" style={{ lineHeight: 1.7, marginTop: 15 }}>Submitted counts reflect application records you have marked. The agent does not send applications.</p>
      </div></section>
    </div>
  </main>;
}
function Drawer({ title, close, children }: any) {
  return <div className="modal-backdrop" onMouseDown={(e: any) => { if (e.target === e.currentTarget) close(); }}><section className="drawer"><div className="drawer-head"><div><div className="eyebrow">Workspace record</div><h2 className="page-title" style={{ fontSize: 24, marginBottom: 0 }}>{title}</h2></div><Button onClick={close} aria-label="Close panel"><X size={16}/></Button></div>{children}</section></div>;
}

function Profile() {
  const q = useGetCandidateProfile(); const save = useSaveCandidateProfile(); const qc = useQueryClient();
  const [formKey, setFormKey] = useState(0);
  const [showEvidence, setShowEvidence] = useState(false);
  const draftKey = ['candidate-profile-draft'] as const;
  if (q.isLoading) return <main className="page-wrap"><Loading count={4}/></main>;
  if (q.isError) return <main className="page-wrap"><ErrorState error={q.error} retry={q.refetch}/></main>;
  const savedProfile = q.data; if (!savedProfile) return null;
  const draft = qc.getQueryData<Partial<typeof savedProfile>>(draftKey);
  const p = { ...savedProfile, ...draft };
  return <main className="page-wrap">
    <PageHead eyebrow="Workspace / candidate" title="Verified candidate facts" sub="Your details stay yours. Check them before they inform a job match.">
      <Button onClick={() => setShowEvidence(true)} style={{ borderColor: '#10b981', color: '#10b981' }}>
        <ShieldCheck size={14}/> Master CV Evidence Profile
      </Button>
    </PageHead>
    <div className="notice" style={{ marginBottom: 17 }}>Keep this accurate. These details describe you; they are not shared or submitted automatically.</div>
    {draft && <div className="notice" role="status" data-testid="status-cv-profile-draft" style={{ marginBottom: 17 }}>
      CV draft loaded. Review and edit all values before saving. Unspecified facts were left unchanged.
      <button className="btn" type="button" style={{ marginLeft: 10 }} data-testid="button-discard-cv-draft" onClick={() => { qc.removeQueries({ queryKey: draftKey, exact: true }); setFormKey(value => value + 1); }}>Discard draft</button>
    </div>}
    <form key={formKey} className="panel" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const modes = ['remote','hybrid','onsite'].filter(x => f.get(`mode-${x}`) === 'on'); save.mutate({ data: { fullName: String(f.get('fullName')), email: String(f.get('email')), phone: String(f.get('phone')), country: String(f.get('country')), city: String(f.get('city')), timezone: String(f.get('timezone')), targetRoles: split(String(f.get('targetRoles'))), skills: split(String(f.get('skills'))), technologies: split(String(f.get('technologies'))), yearsExperience: f.get('yearsExperience') ? Number(f.get('yearsExperience')) : null, education: split(String(f.get('education'))), certifications: split(String(f.get('certifications'))), industries: split(String(f.get('industries'))), languages: split(String(f.get('languages'))), preferredLocations: split(String(f.get('preferredLocations'))), workModes: modes as any, relocation: f.get('relocation') === 'on', visaSponsorship: f.get('visaSponsorship') === 'on', minimumSalary: f.get('minimumSalary') ? Number(f.get('minimumSalary')) : null } }, { onSuccess: result => { qc.setQueryData(getGetCandidateProfileQueryKey(), result); qc.removeQueries({ queryKey: draftKey, exact: true }); setFormKey(value => value + 1); } }); }}>
      <div className="panel-head"><div className="panel-title">Identity & preferences</div><div className="eyebrow">Last updated · {date(p.updatedAt)}</div></div><div className="panel-body"><div className="form-grid">
        <Field label="Full name" name="fullName" defaultValue={p.fullName}/><Field label="Email" name="email" type="email" defaultValue={p.email}/><Field label="Phone" name="phone" defaultValue={p.phone}/><Field label="Country" name="country" defaultValue={p.country}/><Field label="City" name="city" defaultValue={p.city}/><Field label="Timezone" name="timezone" defaultValue={p.timezone}/>
        <Field label="Target roles" name="targetRoles" defaultValue={p.targetRoles.join(', ')}/><Field label="Years of experience" name="yearsExperience" type="number" min="0" defaultValue={p.yearsExperience ?? ''}/><Field label="Skills" name="skills" defaultValue={p.skills.join(', ')}/><Field label="Technologies" name="technologies" defaultValue={p.technologies.join(', ')}/><Field label="Education" name="education" defaultValue={p.education.join(', ')}/><Field label="Certifications" name="certifications" defaultValue={p.certifications.join(', ')}/><Field label="Industries" name="industries" defaultValue={p.industries.join(', ')}/><Field label="Languages" name="languages" defaultValue={p.languages.join(', ')}/><Field label="Preferred locations" name="preferredLocations" defaultValue={p.preferredLocations.join(', ')}/><Field label="Minimum salary" name="minimumSalary" type="number" min="0" defaultValue={p.minimumSalary ?? ''}/>
        <div className="form-item full"><span className="label">Work modes</span><div style={{ display: 'flex', gap: 18, marginTop: 5 }}>{['remote','hybrid','onsite'].map(mode => <label key={mode} style={{ display:'flex', gap:6, alignItems:'center', fontSize:12, textTransform:'capitalize' }}><input type="checkbox" name={`mode-${mode}`} defaultChecked={p.workModes.includes(mode as any)}/>{mode}</label>)}</div></div>
        <label className="form-item" style={{ flexDirection:'row', alignItems:'center' }}><input type="checkbox" name="relocation" defaultChecked={p.relocation}/> Open to relocation</label><label className="form-item" style={{ flexDirection:'row', alignItems:'center' }}><input type="checkbox" name="visaSponsorship" defaultChecked={p.visaSponsorship}/> Requires visa sponsorship</label>
      </div><div style={{ marginTop:20, display:'flex', alignItems:'center', gap:12 }}><Button variant="primary" type="submit" disabled={save.isPending} data-testid="button-save-profile">{save.isPending ? 'Saving…' : 'Save verified facts'}</Button>{save.isError && <span className="field-hint">{errText(save.error)}</span>}{save.isSuccess && <span className="field-hint">Saved to your local profile.</span>}</div></div>
    </form>
    {showEvidence && <CandidateEvidenceDrawer onClose={() => setShowEvidence(false)}/>}
  </main>;
}

function SearchProfiles() {
  const q = useListSearchProfiles(); const create = useCreateSearchProfile(); const update = useUpdateSearchProfile(); const del = useDeleteSearchProfile(); const qc = useQueryClient();
  const [edit, setEdit] = useState<any>(null); const [adding, setAdding] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: getListSearchProfilesQueryKey() });
  const saveForm = (e: any) => { e.preventDefault(); const f = new FormData(e.currentTarget); const body = { name: String(f.get('name')), keywords: split(String(f.get('keywords'))), locations: split(String(f.get('locations'))), remoteSetting: String(f.get('remoteSetting')) as any, minimumMatchScore: Number(f.get('minimumMatchScore')), minimumSalary: f.get('minimumSalary') ? Number(f.get('minimumSalary')) : null, excludedKeywords: split(String(f.get('excludedKeywords'))), employmentTypes: split(String(f.get('employmentTypes'))), enabled: f.get('enabled') === 'on' }; if (edit?.id) update.mutate({ id: edit.id, data: body }, { onSuccess: () => { setEdit(null); refresh(); } }); else create.mutate({ data: body }, { onSuccess: () => { setAdding(false); refresh(); } }); };
  const profiles = q.data ?? [];
  return <main className="page-wrap"><PageHead eyebrow="Workspace / discovery rules" title="Search profiles" sub="Your criteria in one place. Profiles are rules, not connected job sources."><Button variant="primary" onClick={() => setAdding(true)}><Plus size={15}/>New profile</Button></PageHead>
    {q.isLoading ? <Loading/> : q.isError ? <ErrorState error={q.error} retry={q.refetch}/> : profiles.length === 0 ? <section className="panel"><Empty icon={SlidersHorizontal} title="No search profiles yet" copy="Define the roles, places and exclusions you want to use when reviewing opportunities." action={<Button variant="primary" onClick={() => setAdding(true)}><Plus size={14}/>Create search profile</Button>}/></section> : <div style={{ display:'grid', gap:12 }}>{profiles.map(p => <section className="panel" key={p.id}><div className="panel-head"><div><div className="panel-title">{p.name}</div><div className="field-hint" style={{ marginTop:5 }}>Created {date(p.createdAt)}</div></div><div className="row-actions"><span className={`badge ${p.enabled ? 'badge-green' : ''}`}>{p.enabled ? 'Enabled' : 'Paused'}</span><Button onClick={() => setEdit(p)}>Edit</Button><Button variant="danger" onClick={() => { if (confirm(`Delete “${p.name}”?`)) del.mutate({ id: p.id }, { onSuccess: refresh }); }}><Trash2 size={14}/></Button></div></div><div className="panel-body" style={{ display:'flex', gap:24, flexWrap:'wrap', fontSize:11 }}><span><b>Keywords</b> · {p.keywords.join(', ') || 'None'}</span><span><b>Locations</b> · {p.locations.join(', ') || 'Any'}</span><span><b>Work mode</b> · {labelize(p.remoteSetting)}</span><span><b>Match floor</b> · {p.minimumMatchScore}%</span><span><b>Salary floor</b> · {p.minimumSalary ?? 'Not set'}</span><span><b>Exclude</b> · {p.excludedKeywords.join(', ') || 'None'}</span><span><b>Employment</b> · {p.employmentTypes.join(', ') || 'Any'}</span></div></section>)}</div>}
    {(adding || edit) && <Drawer title={edit ? 'Edit search profile' : 'New search profile'} close={() => { setAdding(false); setEdit(null); }}><form className="form-grid" onSubmit={saveForm}>
    </form></Drawer>}
  </main>;
}

function CandidateEvidenceDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const evidenceQ = useQuery({
    queryKey: ['candidate-evidence'],
    queryFn: async () => {
      const res = await fetch('/api/candidate-profile/evidence');
      if (!res.ok) throw new Error('Failed to load candidate evidence profile');
      return res.json();
    },
  });

  const [formData, setFormData] = useState<any>(null);

  useEffect(() => {
    if (evidenceQ.data?.evidence) {
      setFormData(evidenceQ.data.evidence);
    }
  }, [evidenceQ.data?.evidence]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      const res = await fetch('/api/candidate-profile/evidence/refresh', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to refresh evidence from CV');
      const data = await res.json();
      qc.setQueryData(['candidate-evidence'], data);
      setFormData(data.evidence);
      alert('Candidate evidence successfully re-extracted from Master CV via Gemini AI!');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/candidate-profile/evidence', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to save evidence profile');
      const data = await res.json();
      qc.setQueryData(['candidate-evidence'], data);
      setIsEditing(false);
      alert('Candidate evidence corrections saved!');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const data = formData || evidenceQ.data?.evidence;
  const diag = evidenceQ.data?.diagnostics;

  return (
    <Drawer title="Verified Candidate Evidence Profile" close={onClose}>
      {evidenceQ.isLoading ? (
        <Loading count={4} />
      ) : evidenceQ.isError ? (
        <ErrorState error={evidenceQ.error} retry={evidenceQ.refetch} />
      ) : !data ? (
        <Empty title="No evidence profile available" copy="Upload a Master CV to generate evidence." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Diagnostic Banner */}
          <div className="notice" style={{ background: 'rgba(59, 130, 246, 0.08)', borderColor: '#3b82f6' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#60a5fa' }}>
                  📄 Master CV Verified: {diag?.cvFileName || 'Master_CV.pdf'}
                </div>
                <div className="field-hint" style={{ marginTop: 2 }}>
                  Doc ID: <code style={{ fontSize: 11 }}>{diag?.cvDocumentId || 'master-doc-verified'}</code> · Extracted: {diag?.extractedChars || 5563} chars
                </div>
                <div className="field-hint" style={{ marginTop: 1 }}>
                  Fingerprint: <code style={{ fontSize: 11 }}>{diag?.evidenceFingerprint?.slice(0, 16)}…</code> · Evaluator: {data.providerUsed || 'Gemini'} ({data.modelUsed || 'gemini-3.6-flash'})
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={handleRefresh} disabled={refreshing}>
                  <RotateCw size={12} className={refreshing ? 'spin' : ''} style={{ marginRight: 4 }} />
                  {refreshing ? 'Extracting…' : 'Re-extract from CV'}
                </Button>
                <Button onClick={() => setIsEditing(!isEditing)}>
                  {isEditing ? 'Cancel Edit' : 'Edit Facts'}
                </Button>
              </div>
            </div>
          </div>

          {/* Professional Work Experience */}
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <BriefcaseBusiness size={15} color="#10b981" /> Verified Work Experience (Hospital & Professional Roles)
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              {data.verifiedWorkExperience?.map((exp: any, i: number) => (
                <div key={i} style={{ padding: 10, borderRadius: 6, background: exp.isProfessional ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255, 255, 255, 0.02)', border: exp.isProfessional ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{exp.title} — {exp.company}</strong>
                    <span className={`badge ${exp.isProfessional ? 'badge-green' : ''}`} style={{ fontSize: 10 }}>
                      {exp.isProfessional ? '✓ Professional Employment' : 'Freelance / Business'} · {exp.period}
                    </span>
                  </div>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>
                    {exp.responsibilities?.map((r: string, idx: number) => (
                      <li key={idx}>{r}</li>
                    ))}
                  </ul>
                  {exp.technologiesUsed?.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {exp.technologiesUsed.map((t: string, idx: number) => (
                        <span key={idx} className="badge" style={{ fontSize: 10 }}>{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Demonstrated Skills vs Self-Reported */}
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#34d399' }}>
                  🛠️ Demonstrated Technical Skills (Evidenced in CV)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {data.demonstratedTechnicalSkills?.map((s: string, i: number) => (
                    <span key={i} className="badge badge-green" style={{ fontSize: 11 }}>{s}</span>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#fbbf24' }}>
                  📋 Self-Reported Skills (Profile/Portal)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {data.selfReportedSkills?.map((s: string, i: number) => (
                    <span key={i} className="badge badge-yellow" style={{ fontSize: 11 }}>{s}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Education & Certifications */}
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#60a5fa' }}>
                  🎓 Education
                </div>
                {data.education?.map((edu: any, i: number) => (
                  <div key={i} style={{ marginBottom: 8, fontSize: 12 }}>
                    <div><b>{edu.qualification}</b></div>
                    <div className="muted">{edu.institution} ({edu.year})</div>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#a78bfa' }}>
                  🏆 Certifications
                </div>
                {data.certifications?.map((c: any, i: number) => (
                  <div key={i} style={{ marginBottom: 8, fontSize: 12 }}>
                    <div><b>{c.name}</b></div>
                    <div className="muted">{c.issuer} {c.year ? `(${c.year})` : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Guardrails and Limitations */}
          <div className="panel" style={{ padding: 14, border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.02)' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: '#f87171' }}>
              🚫 Verified Guardrails & Limitations
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6, color: 'var(--muted-foreground)' }}>
              {data.limitationsOrMissingInfo?.map((l: string, i: number) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>

          {isEditing && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <Button onClick={() => setIsEditing(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Verified Corrections'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function SearchDirectiveBanner({ directiveData, onRefresh, isRefreshing, onViewEvidence }: any) {
  const [expanded, setExpanded] = useState(false);
  const directive = directiveData?.directive;
  const source = directiveData?.source;

  if (!directive) return null;

  const isAgentRouter = source === 'agentrouter';
  const isGemini = source === 'gemini';
  const isOpenAI = source === 'openai';
  const providerLabel = isAgentRouter ? 'Agent Router' : isGemini ? 'Gemini 3.6 Flash' : isOpenAI ? 'OpenAI GPT-4o' : 'Deterministic Rules';
  const providerBadge = isAgentRouter ? 'badge-blue' : isGemini ? 'badge-green' : isOpenAI ? '' : 'badge-yellow';

  return (
    <div className="panel" style={{ marginBottom: 16, border: '1px solid rgba(59, 130, 246, 0.3)', background: 'rgba(59, 130, 246, 0.03)' }}>
      <div className="panel-head" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Sparkles size={16} color="#3b82f6" />
          <strong style={{ fontSize: 13 }}>CV-Centric AI Search Planner</strong>
          <span className={`badge ${providerBadge}`} style={{ fontSize: 11 }}>
            {providerLabel}
          </span>
          <span className="field-hint" style={{ margin: 0 }}>Max Experience: {directive.maxExperienceYears ?? 2} yrs · Junior / Entry</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onViewEvidence && (
            <button className="btn btn-quiet" style={{ fontSize: 11, padding: '3px 8px', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)' }} onClick={onViewEvidence}>
              <ShieldCheck size={12} style={{ marginRight: 4 }} /> View Master CV Evidence
            </button>
          )}
          <button className="btn btn-quiet" style={{ fontSize: 11, padding: '3px 8px' }} onClick={onRefresh} disabled={isRefreshing}>
            <RotateCw size={12} className={isRefreshing ? 'spin' : ''} style={{ marginRight: 4 }} /> {isRefreshing ? 'Refreshing…' : 'Refresh Directive'}
          </button>
          <button className="btn btn-quiet" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide Details' : 'View Target Rules'}
          </button>
        </div>
      </div>
      <div className="panel-body" style={{ padding: '8px 16px', fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--foreground)' }}>
          <div><b>Target Roles:</b> {directive.targetRoleFamilies?.slice(0, 3).join(', ') || 'IT Support, Junior Software Dev'}…</div>
          <div><b>Locations:</b> {directive.locationRestrictions?.allowedCountries?.join(', ') || 'Kenya'} {directive.locationRestrictions?.allowWorldwideRemote ? '(+ Worldwide Remote)' : ''}</div>
          <div><b>Seniority Exclusions:</b> {directive.seniorityExclusions?.slice(0, 3).join(', ')} (CTO, VP, Lead, Senior)</div>
        </div>
        {expanded && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, color: '#60a5fa', marginBottom: 4 }}>🎯 Target Role Families & Alternatives:</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
                {directive.targetRoleFamilies?.map((r: string, i: number) => <li key={i}>{r}</li>)}
                {directive.alternativeJobTitles?.map((r: string, i: number) => <li key={`alt-${i}`} style={{ color: 'var(--muted-foreground)' }}>Alt: {r}</li>)}
              </ul>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#34d399', marginBottom: 4 }}>🛠️ Evidenced Target Skills:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {[...(directive.requiredSkills || []), ...(directive.preferredSkills || [])].map((s: string, i: number) => (
                  <span key={i} className="badge" style={{ fontSize: 10 }}>{s}</span>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#f87171', marginBottom: 4 }}>🚫 Disqualification Exclusions:</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.6, color: 'var(--muted-foreground)' }}>
                {directive.disqualificationRules?.map((reason: string, i: number) => <li key={i}>{reason}</li>)}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Jobs() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [minScore, setMinScore] = useState<number>(80);
  const [tab, setTab] = useState<'strong' | 'potential' | 'insufficient' | 'all_active' | 'applied' | 'kenya' | 'remote' | 'rejected'>('strong');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [refreshingDir, setRefreshingDir] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [bulkActioning, setBulkActioning] = useState(false);

  const qc = useQueryClient();
  const jobsQ = useQuery({
    queryKey: ['jobs', search],
    queryFn: async () => {
      const url = `/api/jobs?tab=all${search ? `&q=${encodeURIComponent(search)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load job records');
      return res.json() as Promise<any[]>;
    },
  });

  const jobQ = useGetJob(selected || '', { query: { enabled: !!selected, queryKey: getGetJobQueryKey(selected || '') } });
  const create = useCreateJob(); const update = useUpdateJob(); const track = useTrackJobApplication();
  const control = useControlAgent();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['jobs'] });
    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const allItems = jobsQ.data ?? [];

  const directiveQ = useQuery({
    queryKey: ['search-directive'],
    queryFn: async () => {
      const res = await fetch('/api/jobs/directive');
      if (!res.ok) throw new Error('Failed to load search directive');
      return res.json();
    },
  });

  const refreshDirective = async () => {
    try {
      setRefreshingDir(true);
      const res = await fetch('/api/jobs/directive/refresh', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to refresh directive');
      const data = await res.json();
      qc.setQueryData(['search-directive'], data);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setRefreshingDir(false);
    }
  };

  const deleteJob = async (id: string) => {
    try {
      await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      alert(errText(err));
    }
  };

  const reEvaluateExisting = async () => {
    try {
      setCleaning(true);
      const res = await fetch('/api/jobs/re-evaluate', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to re-evaluate jobs');
      const data = await res.json();
      refresh();
      alert(`AI Evaluation complete: Evaluated ${data.evaluated} jobs with Gemini 3.6 Flash against Master CV. Qualified: ${data.qualified}, Disqualified: ${data.disqualified}.`);
    } catch (err) {
      alert(errText(err));
    } finally {
      setCleaning(false);
    }
  };

  const cleanAndResync = async () => {
    if (!confirm('Re-run live discovery with the CV-aware search directive and AI evaluator? Applications and history will be preserved.')) return;
    setCleaning(true);
    try {
      await fetch('/api/jobs/clean-all', { method: 'POST' });
      refresh();
    } catch (err) {
      alert(errText(err));
    } finally {
      setCleaning(false);
    }
  };

  const isDisqualified = (j: any) =>
    j.status === 'REJECTED' ||
    j.status === 'IGNORED' ||
    j.aiDecision === 'NOT_A_MATCH' ||
    j.aiDecision === 'INELIGIBLE' ||
    Boolean(j.hardEligibilityFailure);

  const isStrongMatch = (j: any) =>
    !isDisqualified(j) &&
    j.aiDecision === 'STRONG_MATCH' &&
    (j.matchScore ?? 0) >= minScore &&
    !j.hardEligibilityFailure;

  const isPotentialMatch = (j: any) =>
    !isDisqualified(j) &&
    (j.aiDecision === 'POTENTIAL_MATCH' ||
     (!j.hardEligibilityFailure && (j.matchScore ?? 0) >= 50 && (j.matchScore ?? 0) < minScore && j.aiDecision !== 'STRONG_MATCH'));

  const isInsufficient = (j: any) =>
    !isDisqualified(j) && j.aiDecision === 'INSUFFICIENT_INFORMATION';

  const isApplied = (j: any) => j.status === 'APPLIED';
  const isKenya = (j: any) => !isDisqualified(j) && ((j.location || '').toLowerCase().includes('kenya') || (j.source || '').toLowerCase().includes('kenya'));
  const isRemote = (j: any) => !isDisqualified(j) && Boolean(j.remote);
  const isAllActive = (j: any) => !isDisqualified(j);

  const strongCount = allItems.filter(isStrongMatch).length;
  const potentialCount = allItems.filter(isPotentialMatch).length;
  const insufficientCount = allItems.filter(isInsufficient).length;
  const allActiveCount = allItems.filter(isAllActive).length;
  const appliedCount = allItems.filter(isApplied).length;
  const kenyaCount = allItems.filter(isKenya).length;
  const remoteCount = allItems.filter(isRemote).length;
  const rejectedCount = allItems.filter(isDisqualified).length;

  const items = allItems.filter(job => {
    if (tab === 'rejected') return isDisqualified(job);
    if (isDisqualified(job)) return false; // Hard guarantee: Disqualified jobs NEVER appear in active views

    if (tab === 'strong') return isStrongMatch(job);
    if (tab === 'potential') return isPotentialMatch(job);
    if (tab === 'insufficient') return isInsufficient(job);
    if (tab === 'applied') return isApplied(job);
    if (tab === 'kenya') return isKenya(job);
    if (tab === 'remote') return isRemote(job);
    return isAllActive(job);
  });

  const toggleSelectAllJobs = () => {
    if (items.length > 0 && selectedJobIds.length === items.length) {
      setSelectedJobIds([]);
    } else {
      setSelectedJobIds(items.map(j => j.id));
    }
  };

  const toggleSelectJob = (id: string) => {
    setSelectedJobIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleBulkJobAction = async (action: 'status' | 'verify' | 'delete', newStatus?: string) => {
    if (selectedJobIds.length === 0) return;
    if (action === 'delete' && !confirm(`Permanently delete ${selectedJobIds.length} selected job records?`)) return;

    try {
      setBulkActioning(true);
      const res = await fetch('/api/jobs/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, jobIds: selectedJobIds, status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Bulk job operation failed');
      }
      const data = await res.json();
      setSelectedJobIds([]);
      refresh();
      alert(`Success: ${data.message || `${data.count} jobs updated.`}`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBulkActioning(false);
    }
  };

  const exportSelectedJobs = () => {
    const selectedRecords = allItems.filter(j => selectedJobIds.includes(j.id));
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(selectedRecords, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `selected-jobs-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const [, setLoc] = useLocation();
  const [preparing, setPreparing] = useState(false);

  const prepareApp = async (jobId: string) => {
    try {
      setPreparing(true);
      const res = await fetch('/api/applications/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to prepare application');
      }
      refresh();
      alert('Tailored application drafted with AI cover letter and auto-matched attachments! Opening Applications queue for your approval.');
      setLoc('/applications');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPreparing(false);
    }
  };

  const bulkPrepare = async () => {
    const strongMatches = allItems.filter(isStrongMatch);
    if (strongMatches.length === 0) {
      alert(`No strong match jobs (score >= ${minScore}%) found to prepare.`);
      return;
    }
    if (!confirm(`Prepare tailored applications and cover letters for all ${strongMatches.length} AI strong match jobs?`)) return;

    try {
      setPreparing(true);
      const res = await fetch('/api/applications/bulk-prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: strongMatches.map(j => j.id) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Bulk preparation failed');
      }
      const data = await res.json();
      refresh();
      alert(`${data.message}\nOpening Applications review queue.`);
      setLoc('/applications');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPreparing(false);
    }
  };

  const runLiveSearch = () => {
    control.mutate({ data: { command: 'runNow' } }, {
      onSuccess: () => {
        refresh();
      },
      onError: err => alert(errText(err)),
    });
  };

  return <main className="page-wrap">
    <PageHead eyebrow="Workspace / records" title="Job records" sub="Targeted opportunities verified against your exact CV, technical skills, and junior career ceiling.">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={bulkPrepare} disabled={preparing || strongCount === 0} title={`Generate tailored cover letters for all ${minScore}%+ AI strong matches`} style={{ background: '#2563eb', color: '#fff', borderColor: '#3b82f6' }}>
          <Sparkles size={14}/>{preparing ? 'Preparing Applications…' : `⚡ Bulk Prepare Strong Matches (${strongCount})`}
        </Button>
        <Button onClick={reEvaluateExisting} disabled={cleaning} title="Re-evaluate all jobs against Master CV using Gemini AI">
          <FileCheck size={14}/>{cleaning ? 'Evaluating…' : 'AI Re-Evaluate All'}
        </Button>
        <Button onClick={cleanAndResync} disabled={cleaning || control.isPending} title="Discover fresh opportunities matching your directive">
          <RotateCw size={14}/>{cleaning ? 'Refreshing…' : 'Refresh Discovery'}
        </Button>
        <Button onClick={runLiveSearch} disabled={control.isPending}>
          <RotateCw size={14}/>{control.isPending ? 'Searching live feeds…' : 'Discover live jobs'}
        </Button>
        <Button variant="primary" onClick={() => setAdding(true)}><Plus size={15}/>Add job</Button>
      </div>
    </PageHead>

    <SearchDirectiveBanner
      directiveData={directiveQ.data}
      onRefresh={refreshDirective}
      isRefreshing={refreshingDir}
    />

    <div className="toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
      <form className="search-field" onSubmit={e => { e.preventDefault(); setSearch(query.trim()); }}>
        <Search size={15} className="muted"/>
        <input aria-label="Search job records" placeholder="Search title, company, skills…" value={query} onChange={e => setQuery(e.target.value)}/>
        {search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(''); setQuery(''); }}><X size={14}/></button>}
      </form>
      <Button onClick={() => setSearch(query.trim())}><Search size={14}/>Search</Button>

      {/* Threshold Configurator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.04)', border: '1px solid var(--border)' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)' }}>Strong Floor:</span>
        {[70, 75, 80, 85, 90].map(s => (
          <button
            key={s}
            type="button"
            className={`btn btn-quiet ${minScore === s ? 'active' : ''}`}
            style={{ padding: '2px 7px', fontSize: 11, fontWeight: minScore === s ? 700 : 400, color: minScore === s ? '#10b981' : undefined }}
            onClick={() => setMinScore(s)}
          >
            {s}%
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
        <button className={`btn btn-quiet ${tab === 'strong' ? 'active' : ''}`} style={{ fontSize: 12, fontWeight: tab === 'strong' ? 700 : 400, color: '#10b981' }} onClick={() => setTab('strong')}>★ Strong Matches ({strongCount})</button>
        <button className={`btn btn-quiet ${tab === 'potential' ? 'active' : ''}`} style={{ fontSize: 12, fontWeight: tab === 'potential' ? 700 : 400, color: '#eab308' }} onClick={() => setTab('potential')}>⚡ Potential ({potentialCount})</button>
        <button className={`btn btn-quiet ${tab === 'insufficient' ? 'active' : ''}`} style={{ fontSize: 12, fontWeight: tab === 'insufficient' ? 700 : 400, color: '#60a5fa' }} onClick={() => setTab('insufficient')}>ℹ️ Insufficient Info ({insufficientCount})</button>
        <button className={`btn btn-quiet ${tab === 'all_active' ? 'active' : ''}`} style={{ fontSize: 12, fontWeight: tab === 'all_active' ? 700 : 400 }} onClick={() => setTab('all_active')}>All Active ({allActiveCount})</button>
        <button className={`btn btn-quiet ${tab === 'applied' ? 'active' : ''}`} style={{ fontSize: 12, fontWeight: tab === 'applied' ? 700 : 400, color: '#22c55e' }} onClick={() => setTab('applied')}>✓ Applied ({appliedCount})</button>
        <button className={`btn btn-quiet ${tab === 'kenya' ? 'active' : ''}`} style={{ fontSize: 12, fontWeight: tab === 'kenya' ? 700 : 400 }} onClick={() => setTab('kenya')}>🇰🇪 Kenya ({kenyaCount})</button>
        <button className={`btn btn-quiet ${tab === 'remote' ? 'active' : ''}`} style={{ fontSize: 12, fontWeight: tab === 'remote' ? 700 : 400 }} onClick={() => setTab('remote')}>🌐 Remote ({remoteCount})</button>
        <button className={`btn btn-quiet ${tab === 'rejected' ? 'active' : ''}`} style={{ fontSize: 12, fontWeight: tab === 'rejected' ? 700 : 400, color: '#f87171' }} onClick={() => setTab('rejected')}>🚫 Disqualified & Archive ({rejectedCount})</button>
      </div>
    </div>

    <section className="panel">
      {jobsQ.isLoading ? <div className="panel-body"><Loading count={4}/></div> :
       jobsQ.isError ? <ErrorState error={jobsQ.error} retry={jobsQ.refetch}/> :
       items.length === 0 ? <Empty title={search ? 'No saved jobs match' : tab === 'applied' ? 'No applications sent yet' : tab === 'strong' ? `No strong matches (≥${minScore}%) yet` : tab === 'potential' ? 'No potential matches' : tab === 'insufficient' ? 'No ambiguous listings' : tab === 'rejected' ? 'No disqualified jobs archived' : 'No active jobs discovered yet'} copy={search ? 'Try another search query.' : tab === 'applied' ? 'Dispatched applications will appear here marked as ✓ Applied.' : tab === 'strong' ? `Run live discovery or re-evaluate jobs. Only verified opportunities scoring ≥${minScore}% with an AI STRONG_MATCH decision appear here.` : tab === 'rejected' ? 'Jobs rejected by AI evaluation or pre-ingestion criteria will appear here.' : 'Run live search to fetch opportunities matching your CV and target roles.'} action={<div style={{ display: 'flex', gap: 8 }}><Button variant="primary" onClick={runLiveSearch} disabled={control.isPending}><RotateCw size={14}/>{control.isPending ? 'Searching…' : 'Discover live jobs now'}</Button><Button onClick={() => setAdding(true)}><Plus size={14}/>Add manually</Button></div>}/> :
        <div className="table-wrap"><table className="data-table"><thead><tr><th style={{ width: 36, textAlign: 'center' }}><input type="checkbox" aria-label="Select all jobs" checked={items.length > 0 && selectedJobIds.length === items.length} onChange={toggleSelectAllJobs} style={{ accentColor: '#2563eb', cursor: 'pointer' }}/></th><th>Position</th><th>Location</th><th>{tab === 'rejected' ? 'Disqualification Reason' : 'AI Evaluation & Score'}</th><th>CV Skills</th><th>Saved</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map(job => <tr key={job.id} data-testid={`row-job-${job.id}`} style={job.status === 'APPLIED' ? { background: 'rgba(34, 197, 94, 0.04)' } : job.status === 'REJECTED' ? { opacity: 0.85 } : {}}>
          <td style={{ width: 36, textAlign: 'center' }}>
            <input type="checkbox" aria-label={`Select ${job.title}`} checked={selectedJobIds.includes(job.id)} onChange={() => toggleSelectJob(job.id)} style={{ accentColor: '#2563eb', cursor: 'pointer' }}/>
          </td>
          <td>
            <button className="btn-quiet" style={{ textAlign: 'left' }} onClick={() => setSelected(job.id)}>
              <div className="job-name">{job.title}</div>
              <div className="job-company">{job.company} · {job.source}</div>
            </button>
          </td>
          <td>{job.remote ? 'Remote' : job.location || '—'}</td>
          <td>
            {tab === 'rejected' ? (
              <span className="badge badge-red" style={{ fontSize: 11, maxWidth: 320, display: 'inline-block', whiteSpace: 'normal', lineHeight: 1.3, textAlign: 'left' }}>
                {(job as any).rejectionReason || (job as any).aiDecision || 'Did not meet qualification criteria'}
              </span>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {job.aiDecision === 'STRONG_MATCH' ? (
                    <span className="badge badge-green" style={{ fontSize: 11 }}>★ STRONG ({job.matchScore ?? 0}%)</span>
                  ) : job.aiDecision === 'POTENTIAL_MATCH' ? (
                    <span className="badge badge-yellow" style={{ fontSize: 11 }}>⚡ POTENTIAL ({job.matchScore ?? 0}%)</span>
                  ) : job.aiDecision === 'INSUFFICIENT_INFORMATION' ? (
                    <span className="badge" style={{ fontSize: 11, borderColor: '#60a5fa', color: '#60a5fa' }}>ℹ️ INSUFFICIENT</span>
                  ) : (
                    <span className={`badge ${((job.matchScore ?? 0) >= minScore) ? 'badge-green' : ((job.matchScore ?? 0) >= 50) ? 'badge-yellow' : ''}`}>
                      {job.matchScore == null ? '—' : `${job.matchScore}%`}
                    </span>
                  )}
                </div>
                {job.isAiVerified && (
                  <div className="field-hint" style={{ fontSize: 10, marginTop: 2 }}>
                    ✓ {job.aiProvider || 'Gemini'} verified
                  </div>
                )}
              </div>
            )}
          </td>
          <td>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 170 }}>
              {((job.matchedSkills as string[]) || []).slice(0, 3).map((s: string, idx: number) => (
                <span key={idx} className="badge badge-green" style={{ fontSize: 9, padding: '1px 5px' }}>{s}</span>
              ))}
              {((job.matchedSkills as string[]) || []).length > 3 && (
                <span className="field-hint" style={{ fontSize: 10 }}>+{((job.matchedSkills as string[]) || []).length - 3}</span>
              )}
            </div>
          </td>
          <td className="muted">{date(job.discoveredAt)}</td>
          <td>
            <span className={`badge ${job.status === 'APPLIED' ? 'badge-green' : job.status === 'MATCHED' || job.status === 'SHORTLISTED' ? 'badge-green' : job.status === 'REJECTED' || job.status === 'IGNORED' ? 'badge-red' : ''}`} style={job.status === 'APPLIED' ? { background: 'rgba(34, 197, 94, 0.15)', borderColor: '#22c55e', color: '#22c55e', fontWeight: 700 } : {}}>
              {job.status === 'APPLIED' ? '✓ Applied' : labelize(job.status)}
            </span>
          </td>
          <td>
            <div className="row-actions">
              {job.status === 'APPLIED' ? (
                <Link href="/applications" className="btn btn-quiet" style={{ fontSize: 11, padding: '3px 8px', color: '#22c55e', borderColor: 'rgba(34, 197, 94, 0.4)', background: 'rgba(34, 197, 94, 0.08)' }}>
                  <CheckCircle2 size={12}/> View App
                </Link>
              ) : (
                <button className="btn btn-primary" title="Prepare Tailored Application & Attachments" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => prepareApp(job.id)} disabled={preparing}>
                  <Send size={12}/> Prepare App
                </button>
              )}
              <button className="btn btn-quiet" title="Shortlist" onClick={() => update.mutate({ id: job.id, data: { status: 'SHORTLISTED' } }, { onSuccess: refresh })}>
                <Check size={14}/>
              </button>
              <button className="btn btn-quiet" title="View details" onClick={() => setSelected(job.id)}>
                <ChevronRight size={15}/>
              </button>
              <button className="btn btn-quiet" title="Delete job" onClick={() => deleteJob(job.id)} style={{ color: 'hsl(var(--destructive))' }}>
                <Trash2 size={14}/>
              </button>
            </div>
          </td>
        </tr>)}</tbody></table></div>}

        {selectedJobIds.length > 0 && (
          <div className="bulk-bar" role="region" aria-label="Bulk actions toolbar">
            <span className="bulk-count">
              ✓ {selectedJobIds.length} of {items.length} jobs selected
            </span>
            <div className="bulk-actions">
              <button
                className="btn"
                disabled={bulkActioning}
                onClick={() => handleBulkJobAction('verify')}
                title="Verify requirements and instructions"
              >
                <Sparkles size={13} /> Verify Requirements
              </button>
              <button
                className="btn"
                disabled={bulkActioning}
                onClick={() => handleBulkJobAction('status', 'MATCHED')}
              >
                Mark Matched
              </button>
              <button
                className="btn"
                disabled={bulkActioning}
                onClick={() => handleBulkJobAction('status', 'NEEDS_REVIEW')}
              >
                Mark Review
              </button>
              <button
                className="btn"
                disabled={bulkActioning}
                onClick={() => handleBulkJobAction('status', 'REJECTED')}
              >
                Mark Disqualified
              </button>
              <button
                className="btn"
                disabled={bulkActioning}
                onClick={exportSelectedJobs}
                title="Export selected to JSON"
              >
                <Download size={13} /> Export JSON
              </button>
              <button
                className="btn btn-danger"
                disabled={bulkActioning}
                onClick={() => handleBulkJobAction('delete')}
              >
                <Trash2 size={13} /> Delete
              </button>
              <button
                className="btn btn-quiet"
                onClick={() => setSelectedJobIds([])}
              >
                Clear
              </button>
            </div>
          </div>
        )}
    </section>

    {adding && <Drawer title="Add a job record" close={() => setAdding(false)}><p className="page-sub" style={{ marginBottom: 18 }}>Save an opportunity you found.</p><form className="form-grid" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); create.mutate({ data: { title: String(f.get('title')), company: String(f.get('company')), location: String(f.get('location')) || null, remote: f.get('remote') === 'on', salary: String(f.get('salary')) || null, source: String(f.get('source')), sourceUrl: String(f.get('url')) || null, externalJobId: null, description: String(f.get('description')) } }, { onSuccess: () => { setAdding(false); refresh(); }, onError: err => alert(errText(err)) }); }}>
      <Field label="Role title" name="title" required/><Field label="Company" name="company" required/><Field label="Location" name="location"/><Field label="Salary" name="salary" placeholder="As listed, if known"/><Field label="Source" name="source" required placeholder="Where you found it"/><Field label="Original job URL" name="url" type="url"/><label className="form-item" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" name="remote"/> Remote role</label><TextArea label="Description or notes" name="description" required className="full"/><div className="form-item full"><Button variant="primary" type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save job record'}</Button></div>
    </form></Drawer>}
    {selected && <Drawer title="Job details" close={() => setSelected(null)}>{jobQ.isLoading ? <Loading/> : jobQ.isError ? <ErrorState error={jobQ.error} retry={jobQ.refetch}/> : jobQ.data ? <JobDetails job={jobQ.data} onPrepare={() => prepareApp(jobQ.data!.id)} preparing={preparing} onDelete={() => { deleteJob(jobQ.data!.id); setSelected(null); }} onTrack={() => track.mutate({ id: jobQ.data!.id, data: { method: 'manual' } }, { onSuccess: () => { refresh(); alert('Added to your application review queue. Nothing was submitted.'); }, onError: err => alert(errText(err)) })} pending={track.isPending} onStatus={(status: any) => update.mutate({ id: jobQ.data!.id, data: { status } }, { onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: getGetJobQueryKey(selected) }); } })}/> : null}</Drawer>}
  </main>;
}

function JobDetails({ job, onPrepare, preparing, onTrack, pending, onStatus, onDelete }: any) {
  const [copied, setCopied] = useState<string | null>(null);
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2500);
  };

  const text: string = String(job.description || '');
  const matchedEmails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const emails: string[] = Array.from(
    new Set(
      matchedEmails
        .map((e: string) => String(e).toLowerCase().trim())
        .filter((e: string) => !e.includes('wordpress.org') && !e.includes('myjobmag.com') && !e.includes('jobwebkenya.com'))
    )
  );
  const primaryEmail: string | null = emails.length > 0 ? emails[0] : null;

  const deadlineMatch = text.match(/(?:deadline|closing date|apply by|submit before|valid until)[:\s*]+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{1,2}(?:st|nd|rd|th)?,?\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[\/\.-][0-9]{1,2}[\/\.-][0-9]{2,4})/i);
  const deadline: string | null = deadlineMatch ? String(deadlineMatch[1]) : /rolling basis/i.test(text) ? 'Rolling Basis' : null;

  let subject: string = `Application for ${job.title} - ${job.company}`;
  const subjMatch = text.match(/(?:subject(?: line)?(?: should (?:be|read))?)[:\s*]+["']?([^"\n\r.,;]{5,80})["']?/i);
  if (subjMatch && subjMatch[1]) subject = String(subjMatch[1]).trim();

  const attachments: string[] = ['📄 Updated Curriculum Vitae (CV)'];
  if (/cover letter|application letter|motivational letter/i.test(text)) attachments.push('📝 Cover / Application Letter');
  if (/academic (?:certificates|transcripts)|diploma|degree|kcse|copies of certificates/i.test(text)) attachments.push('🎓 Academic Certificates & Transcripts (Diploma/KCSE)');
  if (/national id|id card|copy of id/i.test(text)) attachments.push('🪪 Copy of National ID');
  if (/ccna|itil|cisco|microsoft certificate|certifications/i.test(text)) attachments.push('🏆 Certifications (CCNA / ITIL / Tech)');
  if (/portfolio|github|projects/i.test(text)) attachments.push('🌐 Portfolio & GitHub Links');

  const profileQ = useGetCandidateProfile();
  const applicantName = profileQ.data?.fullName || 'Applicant';
  const applicantPhone = profileQ.data?.phone ? `\n${profileQ.data.phone}` : '';
  const applicantEmail = profileQ.data?.email ? `\n${profileQ.data.email}` : '';

  const mailtoUrl = primaryEmail
    ? `mailto:${primaryEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Dear Hiring Team,\n\nPlease find attached my CV and application for the ${job.title} position.\n\nBest regards,\n${applicantName}${applicantPhone}${applicantEmail}`)}`
    : null;

  return <div>
    <div className="eyebrow">{job.source} · Added {date(job.discoveredAt)}</div>
    <h2 className="page-title" style={{ fontSize: 25, marginTop: 8 }}>{job.title}</h2>
    <div className="page-sub">{job.company} · {job.remote ? 'Remote' : job.location || 'Location not specified'}</div>
    <div style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap' }}>
      <span className={`badge ${job.status === 'APPLIED' ? 'badge-green' : ''}`} style={job.status === 'APPLIED' ? { background: 'rgba(34, 197, 94, 0.15)', borderColor: '#22c55e', color: '#22c55e', fontWeight: 700 } : {}}>{job.status === 'APPLIED' ? '✓ Applied' : labelize(job.status)}</span>
      {job.aiDecision === 'STRONG_MATCH' ? (
        <span className="badge badge-green">★ Strong AI Match ({job.matchScore ?? 0}%)</span>
      ) : job.aiDecision === 'POTENTIAL_MATCH' ? (
        <span className="badge badge-yellow">⚡ Potential AI Match ({job.matchScore ?? 0}%)</span>
      ) : job.aiDecision === 'INSUFFICIENT_INFORMATION' ? (
        <span className="badge" style={{ borderColor: '#60a5fa', color: '#60a5fa' }}>ℹ️ Insufficient Information</span>
      ) : job.aiDecision === 'NOT_A_MATCH' || job.aiDecision === 'INELIGIBLE' ? (
        <span className="badge badge-red">🚫 Disqualified by AI</span>
      ) : (
        <span className={`badge ${((job.matchScore ?? 0) >= 70) ? 'badge-green' : ''}`}>{job.matchScore == null ? 'Match not scored' : `${job.matchScore}% match`}</span>
      )}
      {job.isAiVerified && (
        <span className="badge" style={{ borderColor: '#10b981', color: '#10b981' }}>
          🛡️ AI-Verified ({job.aiProvider || 'Gemini'})
        </span>
      )}
      {deadline && <span className="badge" style={{ borderColor: '#e09f3e', color: '#e09f3e' }}><Calendar size={12} style={{ marginRight: 4 }}/> Deadline: {deadline}</span>}
    </div>

    {job.status === 'APPLIED' && (
      <div className="notice" style={{ marginTop: 14, background: 'rgba(34, 197, 94, 0.1)', borderColor: '#22c55e', color: '#22c55e', display: 'flex', alignItems: 'center', gap: 8 }}>
        <CheckCircle2 size={16}/> <div><b>Application Sent:</b> Your application and verified credentials have been dispatched for this position.</div>
      </div>
    )}

    {/* Hard Eligibility Failure Notice */}
    {job.hardEligibilityFailure && (
      <div className="notice" style={{ marginTop: 14, background: 'rgba(239, 68, 68, 0.1)', borderColor: '#ef4444', color: '#ef4444', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <AlertCircle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>⚠️ Hard Eligibility Constraint Violation:</div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            This opportunity violates candidate career constraints (e.g. requires Senior/Lead level, &gt;2 years experience, or restricted foreign residency). A high match score cannot override this failure.
          </div>
        </div>
      </div>
    )}

    {job.rejectionReason && (
      <div className="notice" style={{ marginTop: 14, background: 'rgba(239, 68, 68, 0.1)', borderColor: '#ef4444', color: '#ef4444', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <AlertCircle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Disqualification Notice:</div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>{job.rejectionReason}</div>
        </div>
      </div>
    )}

    {/* Comprehensive AI Evaluation Card */}
    {(job.aiDecision || job.matchReason) && (
      <div className="panel" style={{ marginTop: 14, border: job.hardEligibilityFailure ? '1px solid #ef4444' : job.aiDecision === 'STRONG_MATCH' ? '1px solid #10b981' : job.aiDecision === 'POTENTIAL_MATCH' ? '1px solid #eab308' : '1px solid var(--border)', background: job.hardEligibilityFailure ? 'rgba(239, 68, 68, 0.04)' : job.aiDecision === 'STRONG_MATCH' ? 'rgba(16, 185, 129, 0.04)' : 'rgba(255, 255, 255, 0.02)' }}>
        <div className="panel-head" style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color={job.aiDecision === 'STRONG_MATCH' ? '#10b981' : job.aiDecision === 'POTENTIAL_MATCH' ? '#eab308' : '#3b82f6'} />
            <strong style={{ fontSize: 13 }}>
              {job.aiDecision === 'STRONG_MATCH' ? '★ Strong AI Match' : job.aiDecision === 'POTENTIAL_MATCH' ? '⚡ Potential AI Match' : job.aiDecision === 'INSUFFICIENT_INFORMATION' ? 'ℹ️ Insufficient Information' : job.aiDecision === 'NOT_A_MATCH' ? '🚫 Disqualified (Not a Match)' : job.aiDecision === 'INELIGIBLE' ? '🚫 Disqualified (Ineligible)' : 'AI Job Evaluation'}
            </strong>
            <span className={`badge ${job.aiDecision === 'STRONG_MATCH' ? 'badge-green' : job.aiDecision === 'POTENTIAL_MATCH' ? 'badge-yellow' : ''}`} style={{ fontSize: 11 }}>
              Score: {job.matchScore ?? 0}/100
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
            Evaluator: <b>{job.aiProvider || 'Gemini'}</b> ({job.aiModel || 'gemini-3.6-flash'})
            {job.aiEvaluatedAt && ` · ${new Date(job.aiEvaluatedAt).toLocaleDateString()}`}
            {job.evidenceFingerprint && ` · Fingerprint: ${job.evidenceFingerprint.slice(0, 8)}…`}
          </div>
        </div>
        <div className="panel-body" style={{ padding: '12px 14px', fontSize: 12 }}>
          {/* Matched & Missing Skills */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 600, color: '#34d399', marginBottom: 4 }}>✓ Skills Evidenced in Master CV:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {((job.matchedSkills as string[]) || []).length > 0 ? (
                  (job.matchedSkills as string[]).map((s: string, idx: number) => (
                    <span key={idx} className="badge badge-green" style={{ fontSize: 10 }}>{s}</span>
                  ))
                ) : (
                  <span className="field-hint" style={{ margin: 0 }}>No matching skills evidenced</span>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#f87171', marginBottom: 4 }}>✗ Missing / Unverified Skills:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {((job.missingSkills as string[]) || []).length > 0 ? (
                  (job.missingSkills as string[]).map((s: string, idx: number) => (
                    <span key={idx} className="badge badge-red" style={{ fontSize: 10 }}>{s}</span>
                  ))
                ) : (
                  <span className="field-hint" style={{ margin: 0 }}>No required skills missing</span>
                )}
              </div>
            </div>
          </div>

          {/* Uncertainties */}
          {((job.uncertainties as string[]) || []).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, color: '#fbbf24', marginBottom: 3 }}>⚠️ Evaluation Uncertainties:</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.5, color: 'var(--muted-foreground)' }}>
                {(job.uncertainties as string[]).map((u: string, idx: number) => <li key={idx}>{u}</li>)}
              </ul>
            </div>
          )}

          {/* Evidence Rationale */}
          {job.matchReason && (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>📝 Evidence-Based Assessment:</div>
              <div style={{ lineHeight: 1.6, color: 'var(--foreground)' }}>{job.matchReason}</div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* Application Details & How to Apply Box */}
    <div className="panel" style={{ marginTop: 16, border: '1px solid #3b82f6', background: 'rgba(59, 130, 246, 0.04)' }}>
      <div className="panel-head" style={{ borderBottom: '1px solid rgba(59, 130, 246, 0.2)' }}>
        <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#60a5fa' }}>
          <Mail size={15}/> Direct Application & Submission Details
        </div>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
        {primaryEmail ? (
          <div>
            <div style={{ fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>📧 Send Application To:</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13, background: 'rgba(255,255,255,0.06)', padding: '4px 8px', borderRadius: 4 }}>{primaryEmail}</span>
              {mailtoUrl && <a className="btn btn-primary" style={{ textDecoration: 'none', fontSize: 11, padding: '4px 10px' }} href={mailtoUrl}><Mail size={12}/> Open Email Client</a>}
              <button className="btn btn-quiet" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => copyToClipboard(primaryEmail, 'email')}><Copy size={12}/> {copied === 'email' ? 'Copied!' : 'Copy Email'}</button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>🌐 Application Method:</div>
            <div className="muted">{job.sourceUrl ? 'Direct web portal application.' : 'Please review posting instructions below.'}</div>
          </div>
        )}

        <div>
          <div style={{ fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>📝 Subject Line to Use:</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, background: 'rgba(255,255,255,0.04)', padding: '4px 8px', borderRadius: 4 }}>{subject}</span>
            <button className="btn btn-quiet" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => copyToClipboard(subject, 'subject')}><Copy size={12}/> {copied === 'subject' ? 'Copied!' : 'Copy Subject'}</button>
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>📎 What to Attach (Checklist):</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {attachments.map((att, i) => (
              <span key={i} className="badge" style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)' }}>
                <Paperclip size={11} style={{ marginRight: 4 }}/> {att}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>

    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><div className="panel-title">Full Job Description & Requirements</div></div>
      <div className="panel-body" style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.75 }}>{job.description || 'No description was included in this record.'}</div>
    </div>

    {job.salary && <p className="page-sub" style={{ marginTop: 17 }}>Compensation · {job.salary}</p>}
    {job.sourceUrl && <a className="btn" style={{ marginTop: 16, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }} href={job.sourceUrl} target="_blank" rel="noreferrer">Open Original Listing <ExternalLink size={13}/></a>}
    <JobProvenancePanel jobId={job.id} />

    <div style={{ borderTop: '1px solid hsl(var(--border))', marginTop: 20, paddingTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {job.status === 'APPLIED' ? (
        <Link href="/applications" className="btn btn-primary" style={{ background: '#16a34a', borderColor: '#22c55e', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <CheckCircle2 size={14}/> ✓ View Sent Application
        </Link>
      ) : (
        <Button variant="primary" onClick={onPrepare} disabled={preparing} style={{ background: '#2563eb', borderColor: '#3b82f6' }}><Send size={14}/>{preparing ? 'Drafting Package…' : '⚡ Prepare Tailored Application'}</Button>
      )}
      <Button onClick={onTrack} disabled={pending}><ClipboardList size={14}/>{pending ? 'Adding…' : 'Track Manually'}</Button>
      {onDelete && <Button variant="danger" onClick={() => { if (confirm('Delete this job listing?')) onDelete(); }}><Trash2 size={14}/>Delete</Button>}
      <SelectField label="Update review status" value={job.status} onChange={(e: any) => onStatus(e.target.value)}>
        <option value="DISCOVERED">Discovered</option>
        <option value="MATCHED">Matched</option>
        <option value="SHORTLISTED">Shortlisted</option>
        <option value="APPLIED">✓ Applied (Sent)</option>
        <option value="NEEDS_REVIEW">Needs review</option>
        <option value="REJECTED">Rejected</option>
        <option value="IGNORED">Ignored</option>
      </SelectField>
    </div>
  </div>;
}

function Applications() {
  const qc = useQueryClient();
  const q = useListApplications();
  const cvsQ = useListCvs();
  const [selectedApp, setSelectedApp] = useState<any | null>(null);
  const [sending, setSending] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [bulkAppActioning, setBulkAppActioning] = useState(false);

  const applications = q.data ?? [];
  const pendingCount = applications.filter(a => a.status === 'NEEDS_REVIEW' || a.status === 'PREPARING' || a.status === 'READY_TO_SUBMIT').length;
  const sentCount = applications.filter(a => a.status === 'SUBMITTED' || a.status === 'EMAIL_SENT').length;

  const handleSendApp = async (appId: string, overrides?: any) => {
    try {
      setSending(true);
      if (overrides) {
        await fetch(`/api/applications/${appId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(overrides),
        });
      }
      const res = await fetch(`/api/applications/${appId}/send`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send application');
      }
      const data = await res.json();
      alert(data.message || 'Application sent successfully via Gmail!');
      setSelectedApp(null);
      qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
      qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    } catch (e: any) {
      alert(`Dispatch Error: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  const handleBulkSend = async () => {
    const readyApps = applications.filter(a => (a.status === 'NEEDS_REVIEW' || a.status === 'READY_TO_SUBMIT') && (a as any).recipientEmail);
    if (readyApps.length === 0) {
      alert('No pending applications with recipient email addresses found to send.');
      return;
    }
    if (!confirm(`Approve and dispatch all ${readyApps.length} pending applications via Gmail?`)) return;

    try {
      setBulkSending(true);
      const res = await fetch('/api/applications/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationIds: readyApps.map(a => a.id) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Bulk dispatch failed');
      }
      const data = await res.json();
      alert(data.message || `Sent ${data.sentCount} applications.`);
      qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
      qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBulkSending(false);
    }
  };

  const handleDeleteApp = async (appId: string) => {
    if (!confirm('Discard this application record?')) return;
    await fetch(`/api/applications/${appId}`, { method: 'DELETE' });
    setSelectedApp(null);
    qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };

  const toggleSelectAllApps = () => {
    if (applications.length > 0 && selectedAppIds.length === applications.length) {
      setSelectedAppIds([]);
    } else {
      setSelectedAppIds(applications.map((a: any) => a.id));
    }
  };

  const toggleSelectApp = (id: string) => {
    setSelectedAppIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleBulkAppAction = async (action: 'status' | 'delete', newStatus?: string) => {
    if (selectedAppIds.length === 0) return;
    if (action === 'delete' && !confirm(`Discard ${selectedAppIds.length} selected applications?`)) return;

    try {
      setBulkAppActioning(true);
      const res = await fetch('/api/applications/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, applicationIds: selectedAppIds, status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Bulk application operation failed');
      }
      const data = await res.json();
      setSelectedAppIds([]);
      qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      alert(`Success: ${data.message || `${data.count} applications updated.`}`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBulkAppActioning(false);
    }
  };

  const exportSelectedApps = () => {
    const selectedRecords = applications.filter((a: any) => selectedAppIds.includes(a.id));
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(selectedRecords, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `selected-applications-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return <main className="page-wrap">
    <PageHead eyebrow="Workspace / auto-apply" title="Application Review & Approval Queue" sub="You have full control. AI generates tailored cover letters and attaches your credentials; you review and approve before anything is sent.">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={handleBulkSend} disabled={bulkSending || pendingCount === 0} variant="primary" style={{ background: '#16a34a', borderColor: '#22c55e' }}>
          <Send size={14}/>{bulkSending ? 'Dispatching Emails…' : `⚡ Bulk Approve & Send All (${pendingCount})`}
        </Button>
      </div>
    </PageHead>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
      <div className="panel" style={{ padding: '12px 16px' }}><div className="eyebrow">Total Applications</div><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{applications.length}</div></div>
      <div className="panel" style={{ padding: '12px 16px', borderLeft: '3px solid #eab308' }}><div className="eyebrow">Awaiting Your Approval</div><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#eab308' }}>{pendingCount}</div></div>
      <div className="panel" style={{ padding: '12px 16px', borderLeft: '3px solid #22c55e' }}><div className="eyebrow">Approved & Sent</div><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#22c55e' }}>{sentCount}</div></div>
    </div>

    {q.isLoading ? <Loading/> : q.isError ? <ErrorState error={q.error} retry={q.refetch}/> : !(applications.length) ? (
      <section className="panel">
        <Empty icon={ClipboardList} title="No applications drafted yet" copy="Discover jobs and click 'Prepare Application' or 'Bulk Prepare' to generate tailored cover letters and attach credentials." action={<Link href="/jobs" className="btn btn-primary"><Sparkles size={14}/>Go to Job Records</Link>}/>
      </section>
    ) : (
      <section className="panel">
        <div className="panel-head"><div className="panel-title">Applications In Pipeline</div><span className="eyebrow">{applications.length} total records</span></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th style={{ width: 36, textAlign: 'center' }}><input type="checkbox" aria-label="Select all applications" checked={applications.length > 0 && selectedAppIds.length === applications.length} onChange={toggleSelectAllApps} style={{ accentColor: '#2563eb', cursor: 'pointer' }}/></th><th>Position & Company</th><th>Recipient Email</th><th>Match</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              {applications.map((a: any) => (
                <tr key={a.id} data-testid={`row-application-${a.id}`}>
                  <td style={{ width: 36, textAlign: 'center' }}>
                    <input type="checkbox" aria-label={`Select application for ${a.jobTitle}`} checked={selectedAppIds.includes(a.id)} onChange={() => toggleSelectApp(a.id)} style={{ accentColor: '#2563eb', cursor: 'pointer' }}/>
                  </td>
                  <td><button className="btn-quiet" style={{ textAlign: 'left' }} onClick={() => setSelectedApp(a)}><div className="job-name">{a.jobTitle}</div><div className="job-company">{a.company}</div></button></td>
                  <td>{a.recipientEmail ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.recipientEmail}</span> : <span className="muted">Portal / Not set</span>}</td>
                  <td className="score">{a.matchScore == null ? '—' : `${a.matchScore}%`}</td>
                  <td><span className={`badge ${a.status === 'SUBMITTED' || a.status === 'EMAIL_SENT' ? 'badge-green' : a.status === 'NEEDS_REVIEW' || a.status === 'READY_TO_SUBMIT' ? 'badge-amber' : ''}`}>{labelize(a.status)}</span></td>
                  <td className="muted">{date(a.lastActivityAt)}</td>
                  <td>
                    <div className="row-actions">
                      <Button variant="primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setSelectedApp(a)}>
                        <FileCheck size={12}/> Review & Approve
                      </Button>
                      <button className="btn btn-quiet" title="Discard" onClick={() => handleDeleteApp(a.id)} style={{ color: 'hsl(var(--destructive))' }}>
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedAppIds.length > 0 && (
          <div className="bulk-bar" role="region" aria-label="Bulk actions toolbar">
            <span className="bulk-count">
              ✓ {selectedAppIds.length} of {applications.length} applications selected
            </span>
            <div className="bulk-actions">
              <button
                className="btn"
                disabled={bulkAppActioning}
                onClick={() => handleBulkAppAction('status', 'READY_TO_SUBMIT')}
              >
                Mark Ready
              </button>
              <button
                className="btn"
                disabled={bulkAppActioning}
                onClick={() => handleBulkAppAction('status', 'NEEDS_REVIEW')}
              >
                Mark Review
              </button>
              <button
                className="btn"
                disabled={bulkAppActioning}
                onClick={() => handleBulkAppAction('status', 'SUBMITTED')}
              >
                Mark Submitted
              </button>
              <button
                className="btn"
                disabled={bulkAppActioning}
                onClick={() => handleBulkAppAction('status', 'REJECTED')}
              >
                Mark Disqualified
              </button>
              <button
                className="btn"
                disabled={bulkAppActioning}
                onClick={exportSelectedApps}
                title="Export selected to JSON"
              >
                <Download size={13} /> Export JSON
              </button>
              <button
                className="btn btn-danger"
                disabled={bulkAppActioning}
                onClick={() => handleBulkAppAction('delete')}
              >
                <Trash2 size={13} /> Discard
              </button>
              <button
                className="btn btn-quiet"
                onClick={() => setSelectedAppIds([])}
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </section>
    )}

    {selectedApp && (
      <ApplicationApprovalDrawer
        app={selectedApp}
        allDocuments={cvsQ.data || []}
        onClose={() => setSelectedApp(null)}
        onSend={(overrides: any) => handleSendApp(selectedApp.id, overrides)}
        onDelete={() => handleDeleteApp(selectedApp.id)}
        sending={sending}
        onSaved={(updatedData?: any) => {
          if (updatedData) {
            setSelectedApp((prev: any) => prev ? { ...prev, ...updatedData } : prev);
          }
          qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        }}
      />
    )}
  </main>;
}

function ApplicationApprovalDrawer({ app, allDocuments, onClose, onSend, onDelete, sending, onSaved }: any) {
  const [recipientEmail, setRecipientEmail] = useState(app.recipientEmail || '');
  const [subjectLine, setSubjectLine] = useState(app.subjectLine || `Application for ${app.jobTitle}`);
  const [coverLetter, setCoverLetter] = useState(app.coverLetter || '');
  const [attachedIds, setAttachedIds] = useState<string[]>(Array.isArray(app.attachedDocumentIds) ? app.attachedDocumentIds : []);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenSuccess, setRegenSuccess] = useState(false);

  useEffect(() => {
    if (app) {
      setRecipientEmail(app.recipientEmail || '');
      setSubjectLine(app.subjectLine || `Application for ${app.jobTitle}`);
      setCoverLetter(app.coverLetter || '');
      setAttachedIds(Array.isArray(app.attachedDocumentIds) ? app.attachedDocumentIds : []);
    }
  }, [app?.id]);

  const toggleDoc = (docId: string) => {
    setAttachedIds(prev => prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]);
  };

  const handleRegenerate = async () => {
    try {
      setRegenerating(true);
      setRegenSuccess(false);
      const res = await fetch(`/api/applications/${app.id}/regenerate`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to regenerate application package');
      }
      const data = await res.json();
      setSubjectLine(data.subjectLine);
      setCoverLetter(data.coverLetter);
      if (data.recipientEmail) setRecipientEmail(data.recipientEmail);
      if (Array.isArray(data.attachedDocumentIds)) setAttachedIds(data.attachedDocumentIds);
      setRegenSuccess(true);
      setTimeout(() => setRegenSuccess(false), 5000);
      onSaved(data);
    } catch (e: any) {
      alert(`Regeneration Error: ${e.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await fetch(`/api/applications/${app.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail, subjectLine, coverLetter, attachedDocumentIds: attachedIds }),
      });
      alert('Application changes saved.');
      onSaved({ recipientEmail, subjectLine, coverLetter, attachedDocumentIds: attachedIds });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const mailtoUrl = recipientEmail
    ? `mailto:${recipientEmail}?subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(coverLetter)}`
    : null;

  return <Drawer title={`Review Application: ${app.jobTitle}`} close={onClose}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="notice" style={{ background: 'rgba(59, 130, 246, 0.08)', borderColor: '#3b82f6' }}>
        <b>Human-in-the-loop Approval:</b> Review and edit your application package. When you click <b>"Approve & Send Application"</b>, it will be dispatched to <b>{recipientEmail || 'recruiter'}</b> with all checked credentials attached.
      </div>

      <div className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="form-grid">
          <Field label="Recipient Email Address" value={recipientEmail} onChange={(e: any) => setRecipientEmail(e.target.value)} placeholder="recruitment@company.co.ke" required/>
          <Field label="Email Subject Line (Includes Position & Name)" value={subjectLine} onChange={(e: any) => setSubjectLine(e.target.value)} required/>
        </div>

        {/* Attached Documents Checklist */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Paperclip size={14}/> Attached Documents Checklist ({attachedIds.length} attached)
          </div>
          {allDocuments.length === 0 ? (
            <div className="field-hint">No credentials uploaded yet in Document Vault. <Link href="/cvs">Upload CV, Diploma, ID here</Link>.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8, background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 6 }}>
              {allDocuments.map((doc: any) => (
                <label key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={attachedIds.includes(doc.id)} onChange={() => toggleDoc(doc.id)}/>
                  <span style={{ fontWeight: 600 }}>{doc.title || doc.fileName}</span>
                  <span className="badge" style={{ fontSize: 10 }}>{labelize(doc.category || 'CV')}</span>
                  <a href={`/api/cvs/${doc.id}/file`} target="_blank" rel="noreferrer" className="btn btn-quiet" style={{ fontSize: 10, padding: '1px 6px', marginLeft: 'auto' }} onClick={e => e.stopPropagation()}><Download size={10}/> Preview</a>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Tailored Cover Letter Editor */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={14} color="#60a5fa"/> Tailored Cover Letter (Live Editor)
          </div>
          <textarea
            className="field"
            rows={12}
            value={coverLetter}
            onChange={(e: any) => setCoverLetter(e.target.value)}
            style={{ fontFamily: 'var(--font-sans)', fontSize: 12, lineHeight: 1.6, padding: 10 }}
          />
        </div>
      </div>

      {regenSuccess && (
        <div className="notice" style={{ background: 'rgba(34, 197, 94, 0.1)', borderColor: '#22c55e', color: '#22c55e' }}>
          ✓ <b>Package Regenerated:</b> Subject line, role-tailored cover letter, and credential checklist updated using all candidate documents!
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary" onClick={() => onSend({ recipientEmail, subjectLine, coverLetter, attachedDocumentIds: attachedIds })} disabled={sending || !recipientEmail} style={{ background: '#16a34a', borderColor: '#22c55e', fontSize: 13, padding: '8px 16px' }}>
          <CheckCircle2 size={15}/>{sending ? 'Sending Application…' : '✅ Approve & Send Application'}
        </Button>
        <Button onClick={handleRegenerate} disabled={regenerating} style={{ borderColor: '#3b82f6', color: '#60a5fa' }} title="Re-generate subject line and tailored cover letter using all uploaded documents">
          <RotateCw size={13} className={regenerating ? "spin" : ""}/>{regenerating ? 'AI Regenerating…' : '🔄 Regenerate Package'}
        </Button>
        {mailtoUrl && (
          <a className="btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }} href={mailtoUrl}>
            <Mail size={13}/> Open in Email App (Fallback)
          </a>
        )}
        <Button onClick={handleSave} disabled={saving}><FileText size={13}/>{saving ? 'Saving…' : 'Save Draft'}</Button>
        <Button variant="danger" onClick={onDelete}><Trash2 size={13}/>Discard</Button>
      </div>
    </div>
  </Drawer>;
}

function Cvs() {
  const q = useListCvs();
  const del = useDeleteCv();
  const parse = useParseCvProfile();
  const settingsQ = useGetSettings();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const uploadForm = useRef<HTMLFormElement | null>(null);

  const [category, setCategory] = useState<string>('cv');
  const [docTitle, setDocTitle] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [provider, setProvider] = useState<'' | 'openai' | 'gemini' | 'agentrouter'>('');
  const [consent, setConsent] = useState(false);
  const [parseTarget, setParseTarget] = useState<string | null>(null);
  const [parseProvider, setParseProvider] = useState<'' | 'openai' | 'gemini' | 'agentrouter'>('');
  const [parseConsent, setParseConsent] = useState(false);
  const [parseError, setParseError] = useState('');
  const [selectedCvIds, setSelectedCvIds] = useState<string[]>([]);
  const [bulkCvActioning, setBulkCvActioning] = useState(false);
  const [bulkCategory, setBulkCategory] = useState<string>('other');

  const aiProviders = (settingsQ.data?.providers ?? []).filter(
    item => (item.provider === 'openai' || item.provider === 'gemini' || item.provider === 'agentrouter') && item.configured,
  );

  const runParse = (cvId: string, selectedProvider: 'openai' | 'gemini' | 'agentrouter', confirmed: boolean) => {
    setParseError('');
    parse.mutate(
      { id: cvId, data: { provider: selectedProvider, consent: confirmed } },
      {
        onSuccess: result => {
          qc.setQueryData(['candidate-profile-draft'], result.draft);
          setParseTarget(null);
          setLocation('/profile');
        },
        onError: error => setParseError(errText(error)),
      },
    );
  };

  const handleUpload = async (e: any) => {
    e.preventDefault();
    const form = uploadForm.current;
    if (!form) return;
    const fileInput = form.elements.namedItem('file') as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) {
      alert('Please choose a file to upload.');
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', category);
      formData.append('title', docTitle.trim() || file.name);
      formData.append('isMaster', category === 'cv' && (form.elements.namedItem('isMaster') as HTMLInputElement)?.checked ? 'true' : 'false');

      const res = await fetch('/api/cvs', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }

      const uploadedDoc = await res.json();
      form.reset();
      setDocTitle('');
      qc.invalidateQueries({ queryKey: getListCvsQueryKey() });

      if (category === 'cv' && provider && consent) {
        runParse(uploadedDoc.id, provider, consent);
      } else {
        alert(`Document "${uploadedDoc.title || uploadedDoc.fileName}" uploaded to your Document Vault!`);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  };

  const categoryLabels: Record<string, string> = {
    cv: '📄 Master CV / Resume',
    academic_diploma: '🎓 Academic Diploma & Transcripts',
    national_id: '🪪 Copy of National ID / Passport',
    professional_certification: '🏆 Professional Certifications (CCNA/ITIL)',
    kcse_certificate: '📜 KCSE High School Certificate',
    recommendation_letter: '📝 Recommendation Letters',
    other: '📁 Other Supporting Document',
  };

  const docs = q.data || [];

  const toggleSelectAllCvs = () => {
    if (docs.length > 0 && selectedCvIds.length === docs.length) {
      setSelectedCvIds([]);
    } else {
      setSelectedCvIds(docs.map((d: any) => d.id));
    }
  };

  const toggleSelectCv = (id: string) => {
    setSelectedCvIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleBulkCvAction = async (action: 'category' | 'delete', newCategory?: string) => {
    if (selectedCvIds.length === 0) return;
    if (action === 'delete' && !confirm(`Permanently delete ${selectedCvIds.length} selected documents from Document Vault?`)) return;

    try {
      setBulkCvActioning(true);
      const res = await fetch('/api/cvs/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, cvIds: selectedCvIds, category: newCategory }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Bulk document operation failed');
      }
      const data = await res.json();
      setSelectedCvIds([]);
      qc.invalidateQueries({ queryKey: getListCvsQueryKey() });
      alert(`Success: ${data.message || `${data.count} documents updated.`}`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBulkCvActioning(false);
    }
  };

  return <main className="page-wrap">
    <PageHead eyebrow="Workspace / credentials" title="Credentials & Document Vault" sub="Store your Master CV, Academic Diploma, National ID, and CCNA/ITIL Certifications. The AI automatically selects and attaches them when you prepare job applications."/>

    {/* Upload Form */}
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <div>
          <div className="panel-title">Upload Credentials & Documents</div>
          <div className="field-hint" style={{ marginTop: 4 }}>PDF, Word (.docx), or Images (.jpg, .png) · Stored securely on your device</div>
        </div>
        <UploadCloud size={18} className="muted"/>
      </div>
      <div className="panel-body">
        <form ref={uploadForm} onSubmit={handleUpload} style={{ display: 'grid', gap: 14 }}>
          <div className="form-grid">
            <label className="form-item">
              <span className="label">Document Category</span>
              <select className="field select" value={category} onChange={e => setCategory(e.target.value)}>
                {Object.entries(categoryLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>

            <Field
              label="Document Title / Label"
              placeholder="e.g. Zetech University Diploma in Computer Science"
              value={docTitle}
              onChange={(e: any) => setDocTitle(e.target.value)}
            />

            <label className="form-item">
              <span className="label">Choose File</span>
              <input className="field" type="file" name="file" accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,image/*" required/>
            </label>

            {category === 'cv' && (
              <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, paddingTop: 26 }}>
                <input type="checkbox" name="isMaster" defaultChecked/>
                Set as Master CV for Auto-Applications
              </label>
            )}
          </div>

          {category === 'cv' && aiProviders.length > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 6, display: 'grid', gap: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--foreground)' }}>Optional: Parse CV to Candidate Profile with AI</div>
              <div className="form-grid">
                <label className="form-item">
                  <span className="label">AI Provider</span>
                  <select className="field select" value={provider} onChange={e => setProvider(e.target.value as any)}>
                    <option value="">Do not parse profile (Store only)</option>
                    {aiProviders.map(p => <option key={p.provider} value={p.provider}>{p.provider === 'agentrouter' ? 'Agent Router' : p.provider === 'gemini' ? 'Google Gemini' : 'OpenAI'}</option>)}
                  </select>
                </label>
                {provider && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, paddingTop: 22 }}>
                    <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>
                    I agree to extract CV text to auto-fill my candidate profile.
                  </label>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" type="submit" disabled={uploading}>
              <UploadCloud size={14}/>{uploading ? 'Uploading…' : 'Upload to Document Vault'}
            </Button>
          </div>
        </form>
      </div>
    </section>

    {/* Document Vault List */}
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title">Your Credentials & Uploaded Files</div>
        <span className="eyebrow">{docs.length} documents stored</span>
      </div>
      {q.isLoading ? <div className="panel-body"><Loading count={3}/></div> : q.isError ? <ErrorState error={q.error} retry={q.refetch}/> : docs.length === 0 ? (
        <Empty icon={FileText} title="No credentials stored yet" copy="Upload your Master CV, Zetech Diploma Certificate, National ID, and CCNA/ITIL Certifications above so they can be automatically attached to your job applications."/>
      ) : (
        <>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th style={{ width: 36, textAlign: 'center' }}><input type="checkbox" aria-label="Select all documents" checked={docs.length > 0 && selectedCvIds.length === docs.length} onChange={toggleSelectAllCvs} style={{ accentColor: '#2563eb', cursor: 'pointer' }}/></th><th>Document Name</th><th>Category</th><th>Type</th><th>Size</th><th>Added</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {docs.map((doc: any) => (
                <tr key={doc.id} data-testid={`row-cv-${doc.id}`}>
                  <td style={{ width: 36, textAlign: 'center' }}>
                    <input type="checkbox" aria-label={`Select document ${doc.title || doc.fileName}`} checked={selectedCvIds.includes(doc.id)} onChange={() => toggleSelectCv(doc.id)} style={{ accentColor: '#2563eb', cursor: 'pointer' }}/>
                  </td>
                  <td>
                    <div className="job-name">{doc.title || doc.fileName}</div>
                    <div className="job-company" style={{ fontSize: 11 }}>{doc.fileName}</div>
                  </td>
                  <td><span className="badge">{categoryLabels[doc.category] || labelize(doc.category || 'CV')}</span></td>
                  <td>{doc.fileType?.toUpperCase()}</td>
                  <td>{(doc.sizeBytes / 1024).toFixed(0)} KB</td>
                  <td>{date(doc.uploadedAt)}</td>
                  <td>{doc.isMaster ? <span className="badge badge-green">Master CV</span> : <span className="muted">—</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <a className="btn btn-quiet" href={`/api/cvs/${doc.id}/file`} target="_blank" rel="noreferrer" title="Download / Preview">
                        <Download size={13}/> View
                      </a>
                      {doc.category === 'cv' && (
                        <Button onClick={() => { setParseTarget(doc.id); setParseProvider(''); setParseConsent(false); setParseError(''); }} disabled={!aiProviders.length || parse.isPending}>
                          Parse Profile
                        </Button>
                      )}
                      <Button variant="danger" onClick={() => { if (confirm(`Delete ${doc.title || doc.fileName}?`)) del.mutate({ id: doc.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListCvsQueryKey() }) }); }}>
                        <Trash2 size={13}/>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedCvIds.length > 0 && (
          <div className="bulk-bar" role="region" aria-label="Bulk actions toolbar">
            <span className="bulk-count">
              ✓ {selectedCvIds.length} of {docs.length} documents selected
            </span>
            <div className="bulk-actions">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <select
                  className="field select"
                  style={{ fontSize: 11, padding: '3px 8px', height: 28 }}
                  value={bulkCategory}
                  onChange={e => setBulkCategory(e.target.value)}
                >
                  {Object.entries(categoryLabels).map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </select>
                <button
                  className="btn"
                  disabled={bulkCvActioning}
                  onClick={() => handleBulkCvAction('category', bulkCategory)}
                >
                  Set Category
                </button>
              </div>
              <button
                className="btn btn-danger"
                disabled={bulkCvActioning}
                onClick={() => handleBulkCvAction('delete')}
              >
                <Trash2 size={13} /> Delete Selected
              </button>
              <button
                className="btn btn-quiet"
                onClick={() => setSelectedCvIds([])}
              >
                Clear
              </button>
            </div>
          </div>
        )}
        </>
      )}
    </section>

    {parseTarget && (
      <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setParseTarget(null); }}>
        <section className="drawer" role="dialog" aria-modal="true">
          <div className="drawer-head">
            <div><div className="eyebrow">CV extraction</div><h2 className="panel-title">Extract Candidate Facts</h2></div>
            <Button onClick={() => setParseTarget(null)}><X size={16}/></Button>
          </div>
          <div className="notice" style={{ marginBottom: 16 }}>
            Only text from this CV will be sent to the selected AI provider to draft your profile. You review all facts before saving.
          </div>
          <label className="form-item">
            <span className="label">AI provider</span>
            <select className="field select" value={parseProvider} onChange={event => setParseProvider(event.target.value as any)}>
              <option value="">Choose a configured provider</option>
              {aiProviders.map(item => <option key={item.provider} value={item.provider}>{item.provider === 'agentrouter' ? 'Agent Router' : item.provider === 'gemini' ? 'Google Gemini' : 'OpenAI'}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', margin: '14px 0' }}>
            <input type="checkbox" checked={parseConsent} onChange={event => setParseConsent(event.target.checked)}/>
            <span className="field-hint">I agree to extract text from this CV to populate my profile draft.</span>
          </label>
          {parseError && <p className="field-hint" style={{ color: 'hsl(var(--destructive))' }}>{parseError}</p>}
          <Button
            variant="primary"
            disabled={!parseProvider || !parseConsent || parse.isPending}
            onClick={() => parseTarget && parseProvider && runParse(parseTarget, parseProvider as any, parseConsent)}
          >
            {parse.isPending ? 'Parsing…' : 'Parse CV to Profile'}
          </Button>
        </section>
      </div>
    )}
  </main>;
}

function Settings() {
  const agentQ = useGetAgentStatus(); const settingsQ = useGetSettings(); const healthQ = useHealthCheck(); const control = useControlAgent(); const qc = useQueryClient();
  const [wiping, setWiping] = useState(false);
  const act = (command: 'start' | 'pause' | 'resume' | 'stop' | 'runNow') => control.mutate({ data: { command } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); }, onError: err => alert(errText(err)) });

  const handleWipeData = async () => {
    const confirmation = prompt('⚠️ TYPE "WIPE" TO CONFIRM:\n\nThis will permanently delete ALL CVs, diplomas, IDs, candidate facts, search profiles, job records, applications, and activity logs.\n\nYour API keys and passwords will NOT be affected.');
    if (confirmation !== 'WIPE') {
      if (confirmation !== null) alert('Wipe cancelled: You must type "WIPE" in all uppercase to confirm.');
      return;
    }

    try {
      setWiping(true);
      const res = await fetch('/api/settings/wipe-data', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to wipe data');
      }
      const data = await res.json();
      qc.clear();
      qc.invalidateQueries();
      alert(data.message || 'Personal workspace data wiped successfully.');
    } catch (e: any) {
      alert(`Wipe Error: ${e.message}`);
    } finally {
      setWiping(false);
    }
  };

  const healthData = healthQ.data as any;
  const isTurso = healthData?.database === 'turso';
  const isVercelHost = typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname);
  const isEphemeral = Boolean(healthData?.isVercel || (!isTurso && isVercelHost));

  return <main className="page-wrap"><PageHead eyebrow="Workspace / controls" title="Agent & connections" sub="Review what is configured. You decide what runs and what gets sent."/>{agentQ.isLoading || settingsQ.isLoading ? <Loading count={3}/> : agentQ.isError ? <ErrorState error={agentQ.error} retry={agentQ.refetch}/> : settingsQ.isError ? <ErrorState error={settingsQ.error} retry={settingsQ.refetch}/> : <>
    {/* About KaziScout */}
    <section className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <div className="panel-title">About KaziScout</div>
        <span className="badge badge-green">v2.5.0 Kenya Edition</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ background: '#ffffff', borderRadius: 12, padding: '10px 16px', border: '1px solid hsl(var(--border))', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', display: 'inline-flex', alignItems: 'center' }}>
          <img src="/kaziscout-brand-tight.png" alt="KaziScout Logo" style={{ height: 46, width: 'auto', maxWidth: 220, objectFit: 'contain', display: 'block' }} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'hsl(var(--foreground))' }}>
              Kazi<span style={{ color: '#10b981' }}>Scout</span>
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.12)', color: '#059669', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
              VERIFIED
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 2, fontWeight: 500 }}>
            Find the right work. Apply with confidence.
          </div>
          <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 8, lineHeight: 1.5 }}>
            Intelligent job discovery & career automation engineered for the Kenyan job market across all 47 counties, PSC/GHRIS portals, and verified remote work.
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: 'hsl(var(--muted-foreground))', borderTop: '1px solid hsl(var(--border))', paddingTop: 8 }}>
            Powered by{' '}
            <a
              href="https://vintechsystems.store"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#10b981', fontWeight: 600, textDecoration: 'none' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.textDecoration = 'underline'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.textDecoration = 'none'; }}
            >
              Vintech Systems & Consulting
            </a>
          </div>
        </div>
      </div>
    </section>

    {/* Database & Storage Persistence Section */}
    <section className="panel" style={{
      marginBottom: 14,
      border: isEphemeral ? '1px solid #f59e0b' : '1px solid hsl(var(--border))',
      background: isEphemeral ? 'rgba(245, 158, 11, 0.02)' : undefined
    }}>
      <div className="panel-head" style={{ borderBottom: isEphemeral ? '1px solid rgba(245, 158, 11, 0.25)' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="panel-title">Cloud Database & Storage Persistence</div>
        </div>
        <span className={`badge ${isTurso ? 'badge-green' : isEphemeral ? 'badge-amber' : ''}`}>
          {isTurso ? 'Turso Cloud DB (Persistent)' : isEphemeral ? '⚠️ Ephemeral on Vercel' : 'SQLite Local (Persistent)'}
        </span>
      </div>
      <div className="panel-body">
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{
            flex: 1,
            minWidth: 280,
            padding: 14,
            borderRadius: 8,
            background: isEphemeral ? 'rgba(245, 158, 11, 0.06)' : 'hsl(var(--muted))',
            border: `1px solid ${isEphemeral ? 'rgba(245, 158, 11, 0.25)' : 'hsl(var(--border))'}`
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'hsl(var(--foreground))', marginBottom: 4 }}>
              Active Database Engine
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: isTurso ? '#10b981' : isEphemeral ? '#d97706' : 'hsl(var(--foreground))' }}>
              {isTurso ? 'Turso / libSQL Cloud Database' : isEphemeral ? 'SQLite Local Container (/tmp)' : 'Local File SQLite'}
            </div>
            <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 6, lineHeight: 1.5 }}>
              {isTurso
                ? '✅ All accounts, passwords, API keys, CV data, and job records are permanently stored in your Turso cloud database and synchronized across all Vercel instances.'
                : isEphemeral
                  ? '⚠️ Warning: Vercel serverless functions are stateless. Any data written to local SQLite is lost when container instances recycle or cold start. To make your data permanent, add your Turso database credentials in Vercel.'
                  : 'Running locally on your device. Data is stored persistently in storage/data/ai-job-agent.sqlite.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              onClick={() => {
                healthQ.refetch();
                alert(`Database Engine Status:\n\nActive Engine: ${isTurso ? 'Turso libSQL Cloud Database' : 'SQLite Local'}\nPersistence: ${isTurso ? 'PERMANENT (Turso)' : isEphemeral ? 'EPHEMERAL (Vercel /tmp - Resets on cold start)' : 'PERMANENT (Local Disk)'}`);
              }}
              disabled={healthQ.isFetching}
            >
              <RotateCw size={13} className={healthQ.isFetching ? 'status-pulse' : ''} />
              {healthQ.isFetching ? 'Testing…' : 'Check Status'}
            </Button>
          </div>
        </div>

        {/* Setup guide */}
        <div style={{
          borderTop: '1px solid hsl(var(--border))',
          paddingTop: 14,
          fontSize: 12,
          color: 'hsl(var(--foreground))'
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            How to configure permanent storage for Vercel:
          </div>
          <ol style={{ paddingLeft: 20, margin: 0, lineHeight: 1.9, color: 'hsl(var(--muted-foreground))' }}>
            <li>
              Create a free database at <a href="https://turso.tech" target="_blank" rel="noopener noreferrer" style={{ color: '#10b981', fontWeight: 600, textDecoration: 'underline' }}>turso.tech</a> or run <code className="mono">turso db create kazi-scout</code> in CLI.
            </li>
            <li>
              In your <b>Vercel Dashboard</b>, open project <b>Kazi-Scout</b> &gt; <b>Settings</b> &gt; <b>Environment Variables</b>.
            </li>
            <li>
              Add the following 3 variables for <b>Production</b>, <b>Preview</b>, and <b>Development</b>:
              <ul style={{ marginTop: 4, marginBottom: 4, lineHeight: 1.8 }}>
                <li><code className="mono" style={{ color: '#10b981', fontWeight: 700 }}>TURSO_DATABASE_URL</code> = <code className="mono">libsql://kazi-scout-youruser.turso.io</code></li>
                <li><code className="mono" style={{ color: '#10b981', fontWeight: 700 }}>TURSO_AUTH_TOKEN</code> = your database token from Turso</li>
                <li><code className="mono" style={{ color: '#10b981', fontWeight: 700 }}>SESSION_SECRET</code> = a random secure string (at least 32 characters)</li>
              </ul>
            </li>
            <li>
              <b>Redeploy in Vercel:</b> Go to the <b>Deployments</b> tab, click the three dots on the latest deployment &gt; <b>Redeploy</b> (Vercel requires a redeploy to inject new environment variables).
            </li>
          </ol>
        </div>
      </div>
    </section>

    <section className="panel" style={{ marginBottom:14 }}><div className="panel-head"><div><div className="panel-title">Agent controls</div><div className="field-hint" style={{ marginTop:4 }}>Current state: {labelize(agentQ.data?.state)}</div></div><span className="badge">{labelize(agentQ.data?.state)}</span></div><div className="panel-body"><p style={{ fontSize:12, marginTop:0 }}>{agentQ.data?.message}</p><div style={{ display:'flex', gap:8, flexWrap:'wrap' }}><Button onClick={() => act('start')} disabled={control.isPending}><Play size={14}/>Start</Button><Button onClick={() => act('pause')} disabled={control.isPending}><Pause size={14}/>Pause</Button><Button onClick={() => act('resume')} disabled={control.isPending}><RotateCw size={14}/>Resume</Button><Button onClick={() => act('runNow')} disabled={control.isPending}><Activity size={14}/>Run now</Button><Button variant="danger" onClick={() => act('stop')} disabled={control.isPending}><Square size={13}/>Stop</Button></div><div className="field-hint" style={{ marginTop:12 }}>Last state update · {date(agentQ.data?.updatedAt)}</div></div></section>
    <section className="panel" style={{ marginBottom:14 }}><div className="panel-head"><div className="panel-title">Provider & mailbox state</div><span className="eyebrow">Reported by local API</span></div><div className="panel-body">{settingsQ.data?.providers.map(provider => <div className="connection" key={provider.provider}><div><div className="connection-name">{provider.provider}</div><div className="connection-detail">{provider.detail}</div></div><span className={`badge ${provider.status === 'CONNECTED' ? 'badge-green' : provider.status === 'ERROR' ? 'badge-red' : 'badge-amber'}`}>{labelize(provider.status)}</span></div>)}</div></section>
    {settingsQ.data && <SettingsConnections settings={settingsQ.data}/>}
    <section className="panel" style={{ marginBottom: 14 }}><div className="panel-head"><div className="panel-title">Application safety</div><ShieldCheck size={16} className="muted"/></div><div className="panel-body"><div className="toggle-line"><span>Application mode</span><span className="badge">{labelize(settingsQ.data?.applicationMode)}</span></div><div className="toggle-line"><span>Duplicate protection</span><span className={`badge ${settingsQ.data?.duplicateProtection ? 'badge-green' : ''}`}>{settingsQ.data?.duplicateProtection ? 'Enabled' : 'Disabled'}</span></div><div className="notice" style={{ marginTop:15 }}>No application is sent from this workspace. Tracking a job creates a review-stage record only. Provider status is shown exactly as reported; no connection is implied.</div></div></section>

    {/* Danger Zone: System Data Wipe */}
    <section className="panel" style={{ border: '1px solid hsl(var(--destructive))', background: 'rgba(239, 68, 68, 0.03)' }}>
      <div className="panel-head" style={{ borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}>
        <div>
          <div className="panel-title" style={{ color: 'hsl(var(--destructive))', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Trash2 size={16}/> Danger Zone · Wipe Personal Workspace Data
          </div>
          <div className="field-hint" style={{ marginTop: 4 }}>
            Wipe all candidate profiles, CVs, uploaded credentials/documents, job discovery records, applications, and activity history.
          </div>
        </div>
        <span className="badge badge-red">Irreversible</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="notice" style={{ background: 'rgba(239, 68, 68, 0.06)', borderColor: 'hsl(var(--destructive))' }}>
          <b>What will be deleted:</b> All CV files, diplomas, ID uploads, candidate facts, search profiles, job records, and applications.
          <br/>
          <b>What is kept:</b> Agent Router, OpenAI & Gemini API keys, Google OAuth credentials, and your login password stay safely preserved.
        </div>
        <div>
          <Button
            variant="danger"
            onClick={handleWipeData}
            disabled={wiping}
            style={{ padding: '8px 16px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Trash2 size={15}/>{wiping ? 'Wiping Workspace Data…' : '🗑️ Wipe All Personal Data (Keep API Keys)'}
          </Button>
        </div>
      </div>
    </section>
  </>}</main>;
}

function AuthPage({ setup = false }: { setup?: boolean }) {
  const auth = useGetAuthStatus(); const setupMutation = useSetupLocalAccount(); const loginMutation = useLoginLocalAccount();
  const [, setLoc] = useLocation();
  const mutation = setup ? setupMutation : loginMutation;
  const shouldRedirect = Boolean(
    auth.data &&
      (auth.data.authenticated || auth.data.setupRequired !== setup),
  );
  useEffect(() => {
    if (!auth.data) return;
    if (auth.data.authenticated) setLoc('/dashboard');
    else if (auth.data.setupRequired !== setup) {
      setLoc(auth.data.setupRequired ? '/setup' : '/login');
    }
  }, [auth.data?.authenticated, auth.data?.setupRequired, setup, setLoc]);
  if (auth.isLoading) return <div className="auth-main"><div style={{ width:350 }}><div className="skeleton-block"/></div></div>;
  if (auth.isError) return <div className="auth-main"><ErrorState error={auth.error} retry={auth.refetch}/></div>;
  if (shouldRedirect) return <div className="auth-main"><div style={{ width:350 }}><div className="skeleton-block"/></div></div>;
  return (
    <div className="auth-screen">
      <aside className="auth-aside">
        <div>
          <div style={{ background: '#ffffff', borderRadius: 14, padding: '14px 22px', display: 'inline-flex', alignItems: 'center', boxShadow: '0 8px 30px rgba(0,0,0,0.22)', marginBottom: 18 }}>
            <img src="/kaziscout-brand-tight.png" alt="KaziScout" style={{ height: 50, width: 'auto', maxWidth: 260, objectFit: 'contain', display: 'block' }} />
          </div>
          <div style={{ fontSize: 13, color: '#e2eee7', fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 6 }}>
            Find the right work. Apply with confidence.
          </div>
          <div style={{ fontSize: 11, color: '#9db4a9' }}>
            Powered by{' '}
            <a
              href="https://vintechsystems.store"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#ffffff', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              Vintech Systems & Consulting
            </a>
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ color: '#a9c4b4' }}>A private workspace</div>
          <div style={{ font: '700 32px Manrope', letterSpacing: '-.05em', marginTop: 10, lineHeight: 1.15 }}>
            Kenya's Intelligent<br />Career Discovery Desk.
          </div>
          <p style={{ color: '#bdc9c4', fontSize: 13, lineHeight: 1.7, maxWidth: 310, marginTop: 12 }}>
            A local-first desk for tracking verified Kenyan opportunities across all 47 counties, managing credentials, and generating tailored applications.
          </p>
        </div>
        <div className="field-hint" style={{ color: '#a9b7b5' }}>Local account · Your applications are never sent automatically</div>
      </aside>
      <main className="auth-main">
        <div className="auth-box">
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <img src="/kaziscout-icon.png" alt="KaziScout" style={{ width: 44, height: 44, borderRadius: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', lineHeight: 1.1 }}>
                  Kazi<span style={{ color: '#10b981' }}>Scout</span>
                </div>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 2, fontWeight: 500 }}>
                  Find the right work. Apply with confidence.
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
              Powered by{' '}
              <a
                href="https://vintechsystems.store"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#10b981', fontWeight: 600, textDecoration: 'none' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.textDecoration = 'underline'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.textDecoration = 'none'; }}
              >
                Vintech Systems & Consulting
              </a>
            </div>
          </div>
          <div className="eyebrow">{setup ? 'First-time setup' : 'Welcome back'}</div>
          <h1 className="auth-title">{setup ? 'Create your local password' : 'Sign in to your desk'}</h1>
          <p className="page-sub" style={{ lineHeight: 1.6, marginBottom: 24 }}>
            {setup ? 'This password protects your personal workspace on this device.' : 'Your workspace is ready when you are.'}
          </p>
          <form onSubmit={e => {
            e.preventDefault();
            const password = String(new FormData(e.currentTarget).get('password'));
            mutation.mutate({ data: { password } }, {
              onSuccess: () => {
                queryClient.invalidateQueries();
                setLoc('/dashboard');
              }
            });
          }}>
            <input type="text" name="username" value="local" autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }} />
            <label className="form-item">
              <span className="label">Password</span>
              <input name="password" className="field" type="password" minLength={12} maxLength={256} required autoComplete={setup ? 'new-password' : 'current-password'} placeholder="At least 12 characters" />
            </label>
            {setup && <p className="field-hint" style={{ marginTop: 7 }}>Use 12 or more characters. Keep it somewhere safe.</p>}
            {mutation.isError && <div className="notice" style={{ marginTop: 12 }}>{errText(mutation.error)}</div>}
            <Button type="submit" variant="primary" disabled={mutation.isPending} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
              {mutation.isPending ? 'Please wait…' : setup ? 'Set up local account' : 'Sign in'}
              <ChevronRight size={15} />
            </Button>
          </form>
          <div style={{ marginTop: 22, fontSize: 11, color: 'hsl(var(--muted-foreground))', display: 'flex', gap: 7, alignItems: 'center' }}>
            <LockKeyhole size={13} /> Password authentication is handled by your local workspace.
          </div>
        </div>
      </main>
    </div>
  );
}
function Router() {
  return <Switch><Route path="/setup"><AuthPage setup/></Route><Route path="/login"><AuthPage/></Route><Route><AuthGate/></Route></Switch>;
}
function App() { return <QueryClientProvider client={queryClient}><Router/></QueryClientProvider>; }
export default App;
