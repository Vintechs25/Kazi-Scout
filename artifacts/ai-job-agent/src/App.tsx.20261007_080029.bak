import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation } from 'wouter';
import {
  Activity, BriefcaseBusiness, Check, ChevronRight, CircleHelp, Clock3, FileText, Gauge,
  LayoutDashboard, LogOut, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Trash2, UserRound, X, ExternalLink, Play, Pause, Square, RotateCw, LockKeyhole, ClipboardList,
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

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 8000 } } });
const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/jobs', label: 'Job records', icon: BriefcaseBusiness },
  { href: '/applications', label: 'Applications', icon: ClipboardList },
  { href: '/profile', label: 'Candidate profile', icon: UserRound },
  { href: '/search-profiles', label: 'Search profiles', icon: SlidersHorizontal },
  { href: '/cvs', label: 'CV library', icon: FileText },
  { href: '/settings', label: 'Agent & settings', icon: Settings2 },
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
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/dashboard" className="brand"><span className="brand-mark"><Sparkles size={17}/></span><span>fieldnotes<span style={{ color: '#8cb9a3' }}> / jobs</span></span></Link>
      <div className="nav-label">Workspace</div>
      {nav.map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={`nav-link ${path === item.href ? 'active' : ''}`} data-testid={`link-${item.label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={16}/>{item.label}</Link>; })}
      <div className="side-foot"><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><ShieldCheck size={14}/>Local workspace</div><div>Private by default. Nothing submits without you.</div><button className="nav-link" style={{ paddingLeft: 0, marginTop: 13 }} onClick={() => logout.mutate(undefined, { onSuccess: () => { qc.invalidateQueries(); window.location.href = '/login'; } })}><LogOut size={14}/>Sign out</button></div>
    </aside>
    <div className="main-column"><div className="topbar"><div className="eyebrow">Personal operations desk</div><div className="top-meta"><span className="status-dot" style={{ background: health.isError ? '#b05d50' : undefined }}/>Local API {health.isLoading ? 'checking' : health.isError ? 'unavailable' : 'ready'} <span className="mono">·</span> <span>Private</span></div></div>{children}</div>
  </div>;
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
    <Route path="/profile" component={Profile}/><Route path="/search-profiles" component={SearchProfiles}/><Route path="/cvs" component={Cvs}/>
    <Route path="/settings" component={Settings}/><Route component={Dashboard}/>
  </Switch></AppShell>;
}

function Dashboard() {
  const q = useGetDashboard();
  const data = q.data;
  if (q.isLoading) return <main className="page-wrap"><Loading/></main>;
  if (q.isError) return <main className="page-wrap"><ErrorState error={q.error} retry={q.refetch}/></main>;
  if (!data) return null;
  const stats = [
    ['Job records', data.jobsDiscovered, 'Across all sources', BriefcaseBusiness],
    ['Awaiting review', data.jobsAwaitingReview, 'Your next decisions', Clock3],
    ['Applications tracked', data.applicationsPending, 'In your workspace', ClipboardList],
    ['Top match', data.topMatchScore == null ? '—' : `${data.topMatchScore}%`, 'Best recorded fit', Gauge],
  ];
  const agent = data.agent;
  return <main className="page-wrap">
    <PageHead eyebrow="Workspace / overview" title="Your search, at a glance" sub="A live view of the records you have saved locally."/>
    <section className="agent-banner"><div><div className="agent-state">Agent · {labelize(agent.state)}</div><div className="agent-message">{agent.message}</div></div><div className="top-meta"><span className={`status-dot`} style={{ background: agent.state === 'RUNNING' ? '#65a184' : '#d3a85c' }}/><span>Updated {date(agent.updatedAt)}</span></div></section>
    <section className="stats-grid">{stats.map(([label, val, note, Icon]: any) => <div className="panel stat-card" key={label}><Icon className="stat-accent" size={17}/><div className="stat-label">{label}</div><div className="stat-num">{val}</div><div className="stat-note">{note}</div></div>)}</section>
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

function Jobs() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const jobsQ = useListJobs(search ? { q: search } : undefined);
  const jobQ = useGetJob(selected || '', { query: { enabled: !!selected, queryKey: getGetJobQueryKey(selected || '') } });
  const create = useCreateJob(); const update = useUpdateJob(); const track = useTrackJobApplication();
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: getListJobsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  const items = jobsQ.data ?? [];
  return <main className="page-wrap">
    <PageHead eyebrow="Workspace / records" title="Job records" sub="Only jobs actually saved in your local workspace appear here.">
      <Button variant="primary" onClick={() => setAdding(true)}><Plus size={15}/>Add job</Button>
    </PageHead>
    <div className="toolbar"><form className="search-field" onSubmit={e => { e.preventDefault(); setSearch(query.trim()); }}><Search size={15} className="muted"/><input aria-label="Search job records" placeholder="Search title, company, location…" value={query} onChange={e => setQuery(e.target.value)}/>{search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(''); setQuery(''); }}><X size={14}/></button>}</form><Button onClick={() => setSearch(query.trim())}><Search size={14}/>Search records</Button><span className="eyebrow">{items.length} records</span></div>
    <section className="panel">{jobsQ.isLoading ? <div className="panel-body"><Loading count={4}/></div> : jobsQ.isError ? <ErrorState error={jobsQ.error} retry={jobsQ.refetch}/> : items.length === 0 ? <Empty title={search ? 'No saved jobs match' : 'Your job desk is clear'} copy={search ? 'Try another search. This only searches records already in your workspace.' : 'Add a real role you have found elsewhere. No sample listings are shown.'} action={<Button variant="primary" onClick={() => setAdding(true)}><Plus size={14}/>Add a job record</Button>}/> :
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Position</th><th>Location</th><th>Match</th><th>Saved</th><th>Status</th><th></th></tr></thead><tbody>{items.map(job => <tr key={job.id} data-testid={`row-job-${job.id}`}><td><button className="btn-quiet" style={{ textAlign: 'left' }} onClick={() => setSelected(job.id)}><div className="job-name">{job.title}</div><div className="job-company">{job.company} · {job.source}</div></button></td><td>{job.remote ? 'Remote' : job.location || '—'}</td><td className="score">{job.matchScore == null ? '—' : `${job.matchScore}%`}</td><td className="muted">{date(job.discoveredAt)}</td><td><span className={`badge ${job.status === 'MATCHED' || job.status === 'SHORTLISTED' ? 'badge-green' : job.status === 'REJECTED' || job.status === 'IGNORED' ? 'badge-red' : ''}`}>{labelize(job.status)}</span></td><td><div className="row-actions"><button className="btn btn-quiet" title="Shortlist" onClick={() => update.mutate({ id: job.id, data: { status: 'SHORTLISTED' } }, { onSuccess: refresh })}><Check size={14}/></button><button className="btn btn-quiet" title="View details" onClick={() => setSelected(job.id)}><ChevronRight size={15}/></button></div></td></tr>)}</tbody></table></div>}</section>
    {adding && <Drawer title="Add a job record" close={() => setAdding(false)}><p className="page-sub" style={{ marginBottom: 18 }}>Save a genuine opportunity you found. No listings are fabricated or fetched here.</p><form className="form-grid" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); create.mutate({ data: { title: String(f.get('title')), company: String(f.get('company')), location: String(f.get('location')) || null, remote: f.get('remote') === 'on', salary: String(f.get('salary')) || null, source: String(f.get('source')), sourceUrl: String(f.get('url')) || null, externalJobId: null, description: String(f.get('description')) } }, { onSuccess: () => { setAdding(false); refresh(); }, onError: err => alert(errText(err)) }); }}>
      <Field label="Role title" name="title" required/><Field label="Company" name="company" required/><Field label="Location" name="location"/><Field label="Salary" name="salary" placeholder="As listed, if known"/><Field label="Source" name="source" required placeholder="Where you found it"/><Field label="Original job URL" name="url" type="url"/><label className="form-item" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" name="remote"/> Remote role</label><TextArea label="Description or notes" name="description" required className="full"/><div className="form-item full"><Button variant="primary" type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save job record'}</Button></div>
    </form></Drawer>}
    {selected && <Drawer title="Job details" close={() => setSelected(null)}>{jobQ.isLoading ? <Loading/> : jobQ.isError ? <ErrorState error={jobQ.error} retry={jobQ.refetch}/> : jobQ.data ? <JobDetails job={jobQ.data} onTrack={() => track.mutate({ id: jobQ.data!.id, data: { method: 'manual' } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); alert('Added to your application review queue. Nothing was submitted.'); }, onError: err => alert(errText(err)) })} pending={track.isPending} onStatus={(status: 'DISCOVERED' | 'MATCHED' | 'SHORTLISTED' | 'NEEDS_REVIEW' | 'REJECTED' | 'IGNORED') => update.mutate({ id: jobQ.data!.id, data: { status } }, { onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: getGetJobQueryKey(selected) }); } })}/> : null}</Drawer>}
  </main>;
}
function JobDetails({ job, onTrack, pending, onStatus }: any) {
  return <div><div className="eyebrow">{job.source} · Added {date(job.discoveredAt)}</div><h2 className="page-title" style={{ fontSize: 27, marginTop: 8 }}>{job.title}</h2><div className="page-sub">{job.company} · {job.remote ? 'Remote' : job.location || 'Location not specified'}</div>
    <div style={{ display: 'flex', gap: 8, margin: '18px 0' }}><span className="badge">{labelize(job.status)}</span><span className="badge badge-green">{job.matchScore == null ? 'Match not scored' : `${job.matchScore}% match`}</span></div>
    <div className="notice">Review-stage only. Creating an application record never sends anything to an employer.</div>
    <div className="panel" style={{ marginTop: 18 }}><div className="panel-head"><div className="panel-title">Description</div></div><div className="panel-body" style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.75 }}>{job.description || 'No description was included in this record.'}</div></div>
    {job.salary && <p className="page-sub" style={{ marginTop: 17 }}>Compensation · {job.salary}</p>}
    {job.sourceUrl && <a className="btn" style={{ marginTop: 16, textDecoration: 'none' }} href={job.sourceUrl} target="_blank" rel="noreferrer">Open original listing <ExternalLink size={13}/></a>}
    <div style={{ borderTop: '1px solid hsl(var(--border))', marginTop: 24, paddingTop: 19, display: 'flex', flexWrap: 'wrap', gap: 8 }}><Button variant="primary" onClick={onTrack} disabled={pending}><ClipboardList size={14}/>{pending ? 'Adding…' : 'Add to review queue'}</Button><SelectField label="Update review status" value={job.status} onChange={(e: any) => onStatus(e.target.value)}><option value="DISCOVERED">Discovered</option><option value="MATCHED">Matched</option><option value="SHORTLISTED">Shortlisted</option><option value="NEEDS_REVIEW">Needs review</option><option value="REJECTED">Rejected</option><option value="IGNORED">Ignored</option></SelectField></div>
  </div>;
}
function Drawer({ title, close, children }: any) {
  return <div className="modal-backdrop" onMouseDown={(e: any) => { if (e.target === e.currentTarget) close(); }}><section className="drawer"><div className="drawer-head"><div><div className="eyebrow">Workspace record</div><h2 className="page-title" style={{ fontSize: 24, marginBottom: 0 }}>{title}</h2></div><Button onClick={close} aria-label="Close panel"><X size={16}/></Button></div>{children}</section></div>;
}

function Applications() {
  const q = useListApplications();
  return <main className="page-wrap"><PageHead eyebrow="Workspace / pipeline" title="Applications" sub="A factual history of application records you chose to track."/>{q.isLoading ? <Loading/> : q.isError ? <ErrorState error={q.error} retry={q.refetch}/> : !(q.data?.length) ? <section className="panel"><Empty icon={ClipboardList} title="No application records yet" copy="When you choose “Add to review queue” on a job, it appears here. That action does not submit an application."/></section> : <section className="panel"><div className="panel-head"><div className="panel-title">Tracked application history</div><span className="eyebrow">{q.data.length} records</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Position</th><th>Tracked date</th><th>Method</th><th>Match</th><th>Status</th><th>Last activity</th></tr></thead><tbody>{q.data.map(a => <tr key={a.id} data-testid={`row-application-${a.id}`}><td><div className="job-name">{a.jobTitle}</div><div className="job-company">{a.company}</div></td><td>{date(a.appliedAt)}</td><td>{labelize(a.method)}</td><td className="score">{a.matchScore == null ? '—' : `${a.matchScore}%`}</td><td><span className={`badge ${a.status === 'SUBMITTED' || a.status === 'INTERVIEW' || a.status === 'OFFER' ? 'badge-green' : ''}`}>{labelize(a.status)}</span></td><td className="muted">{date(a.lastActivityAt)}</td></tr>)}</tbody></table></div></section>}</main>;
}

function Profile() {
  const q = useGetCandidateProfile(); const save = useSaveCandidateProfile(); const qc = useQueryClient();
  const [formKey, setFormKey] = useState(0);
  const draftKey = ['candidate-profile-draft'] as const;
  if (q.isLoading) return <main className="page-wrap"><Loading count={4}/></main>;
  if (q.isError) return <main className="page-wrap"><ErrorState error={q.error} retry={q.refetch}/></main>;
  const savedProfile = q.data; if (!savedProfile) return null;
  const draft = qc.getQueryData<Partial<typeof savedProfile>>(draftKey);
  const p = { ...savedProfile, ...draft };
  return <main className="page-wrap"><PageHead eyebrow="Workspace / candidate" title="Verified candidate facts" sub="Your details stay yours. Check them before they inform a job match."/>
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
    </form></main>;
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
      <Field label="Profile name" name="name" required defaultValue={edit?.name || ''}/><SelectField label="Work mode" name="remoteSetting" defaultValue={edit?.remoteSetting || 'any'}><option value="any">Any</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></SelectField><Field label="Keywords" name="keywords" defaultValue={edit?.keywords.join(', ') || ''}/><Field label="Locations" name="locations" defaultValue={edit?.locations.join(', ') || ''}/><Field label="Minimum match score" name="minimumMatchScore" type="number" min="0" max="100" defaultValue={edit?.minimumMatchScore ?? 60}/><Field label="Minimum salary" name="minimumSalary" type="number" min="0" defaultValue={edit?.minimumSalary ?? ''}/><Field label="Excluded keywords" name="excludedKeywords" defaultValue={edit?.excludedKeywords.join(', ') || ''}/><Field label="Employment types" name="employmentTypes" defaultValue={edit?.employmentTypes.join(', ') || ''}/><label className="form-item full" style={{ flexDirection:'row', alignItems:'center' }}><input name="enabled" type="checkbox" defaultChecked={edit ? edit.enabled : true}/> Enabled</label><div className="form-item full"><Button variant="primary" type="submit" disabled={create.isPending || update.isPending}>{edit ? 'Save changes' : 'Create profile'}</Button></div>
    </form></Drawer>}
  </main>;
}

function Cvs() {
  const q = useListCvs();
  const upload = useUploadCv();
  const del = useDeleteCv();
  const parse = useParseCvProfile();
  const settingsQ = useGetSettings();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const uploadForm = useRef<HTMLFormElement | null>(null);
  const [provider, setProvider] = useState<'' | 'openai' | 'gemini'>('');
  const [consent, setConsent] = useState(false);
  const [parseTarget, setParseTarget] = useState<string | null>(null);
  const [parseProvider, setParseProvider] = useState<'' | 'openai' | 'gemini'>('');
  const [parseConsent, setParseConsent] = useState(false);
  const [parseError, setParseError] = useState('');
  const aiProviders = (settingsQ.data?.providers ?? []).filter(
    item => (item.provider === 'openai' || item.provider === 'gemini') && item.configured,
  );

  const runParse = (cvId: string, selectedProvider: 'openai' | 'gemini', confirmed: boolean) => {
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

  const uploadFile = (parseAfterUpload: boolean) => {
    const form = uploadForm.current;
    if (!form || !form.reportValidity()) return;
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file) return;
    const selectedProvider = provider;
    const confirmed = consent;
    if (parseAfterUpload && (!selectedProvider || !confirmed)) return;

    upload.mutate(
      {
        data: {
          file,
          isMaster: (form.elements.namedItem('isMaster') as HTMLInputElement).checked,
        },
      },
      {
        onSuccess: cv => {
          form.reset();
          setProvider('');
          setConsent(false);
          void qc.invalidateQueries({ queryKey: getListCvsQueryKey() });
          if (parseAfterUpload && selectedProvider) {
            runParse(cv.id, selectedProvider, confirmed);
          }
        },
      },
    );
  };

  const readyProvider = (parseProvider === 'openai' || parseProvider === 'gemini') &&
    aiProviders.some(item => item.provider === parseProvider);

  return <main className="page-wrap">
    <PageHead eyebrow="Workspace / documents" title="CV library" sub="Files stay on this device. Parsing sends extracted text only after you confirm."/>
    <section className="panel" style={{ marginBottom:14 }}>
      <div className="panel-head">
        <div>
          <div className="panel-title">Add a CV file</div>
          <div className="field-hint" style={{ marginTop:4 }}>PDF or DOCX · locally stored</div>
        </div>
        <FileText size={17} className="muted"/>
      </div>
      <div className="panel-body">
        {!settingsQ.isLoading && aiProviders.length === 0 && (
          <div className="notice" style={{ marginBottom:14 }} data-testid="status-no-ai-provider">
            Configure OpenAI or Gemini in <Link href="/settings">Agent & settings</Link> to parse CVs. You can still store a CV locally.
          </div>
        )}
        {settingsQ.isError && <ErrorState error={settingsQ.error} retry={settingsQ.refetch}/>}
        <form
          ref={uploadForm}
          onSubmit={event => { event.preventDefault(); uploadFile(false); }}
          style={{ display:'grid', gap:14 }}
          data-testid="form-upload-cv"
        >
          <div style={{ display:'flex', gap:12, alignItems:'end', flexWrap:'wrap' }}>
            <label className="form-item" style={{ flex:1,minWidth:220 }}>
              <span className="label">Choose file</span>
              <input
                className="field"
                type="file"
                name="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                required
                data-testid="input-cv-file"
              />
            </label>
            <label style={{ display:'flex',gap:7,alignItems:'center',fontSize:11,paddingBottom:12 }}>
              <input type="checkbox" name="isMaster" data-testid="input-cv-master"/>
              Set as master CV
            </label>
          </div>
          <div className="form-grid">
            <label className="form-item">
              <span className="label">AI provider for parsing</span>
              <select
                className="field select"
                value={provider}
                onChange={event => setProvider(event.target.value as '' | 'openai' | 'gemini')}
                data-testid="select-cv-provider"
              >
                <option value="">Choose a configured provider</option>
                {aiProviders.map(item => <option key={item.provider} value={item.provider}>{labelize(item.provider)}</option>)}
              </select>
            </label>
            <label className="form-item" style={{ flexDirection:'row',alignItems:'flex-start',gap:9 }}>
              <input
                type="checkbox"
                checked={consent}
                onChange={event => setConsent(event.target.checked)}
                data-testid="checkbox-cv-consent"
              />
              <span className="field-hint">
                I agree to send the text extracted from this CV to {provider || 'the selected provider'} for parsing.
                The original file stays local; parsing creates an editable draft and does not save profile changes.
              </span>
            </label>
          </div>
          <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
            <Button
              variant="primary"
              type="button"
              onClick={() => uploadFile(true)}
              disabled={upload.isPending || parse.isPending || !provider || !consent}
              data-testid="button-upload-parse-cv"
            >
              {upload.isPending ? 'Uploading…' : parse.isPending ? 'Parsing…' : 'Upload & parse CV'}
            </Button>
            <Button type="submit" disabled={upload.isPending || parse.isPending} data-testid="button-upload-cv-only">
              {upload.isPending ? 'Uploading…' : 'Upload only'}
            </Button>
          </div>
        </form>
        {(upload.isError || parseError) && (
          <p className="field-hint" style={{ color:'hsl(var(--destructive))' }} data-testid="status-cv-parse-error">
            {upload.isError ? errText(upload.error) : parseError}
          </p>
        )}
      </div>
    </section>
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title">Stored files</div>
        <span className="eyebrow" data-testid="text-cv-count">{q.data?.length ?? 0} files</span>
      </div>
      {q.isLoading ? <div className="panel-body"><Loading count={2}/></div> : q.isError ? <ErrorState error={q.error} retry={q.refetch}/> : !(q.data?.length) ? <Empty icon={FileText} title="No CVs stored" copy="Uploaded files are listed here with their local file metadata."/ > : <div className="table-wrap"><table className="data-table"><thead><tr><th>File</th><th>Type</th><th>Size</th><th>Added</th><th>Role</th><th></th></tr></thead><tbody>{q.data.map(cv => <tr key={cv.id} data-testid={`row-cv-${cv.id}`}><td><div className="job-name">{cv.fileName}</div></td><td>{cv.fileType.toUpperCase()}</td><td>{(cv.sizeBytes / 1024).toFixed(0)} KB</td><td>{date(cv.uploadedAt)}</td><td>{cv.isMaster ? <span className="badge badge-green">Master CV</span> : <span className="muted">—</span>}</td><td><div style={{ display:'flex',gap:6 }}><Button onClick={() => { setParseTarget(cv.id); setParseProvider(''); setParseConsent(false); setParseError(''); }} disabled={!aiProviders.length || parse.isPending} data-testid={`button-parse-cv-${cv.id}`}>Parse to profile</Button><Button variant="danger" onClick={() => { if (confirm(`Delete ${cv.fileName}? This removes the local file.`)) del.mutate({ id: cv.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListCvsQueryKey() }) }); }} data-testid={`button-delete-cv-${cv.id}`}><Trash2 size={14}/>Delete</Button></div></td></tr>)}</tbody></table></div>}
    </section>
    {parseTarget && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setParseTarget(null); }}>
      <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="cv-parse-title" data-testid="dialog-parse-cv">
        <div className="drawer-head">
          <div><div className="eyebrow">CV extraction</div><h2 className="panel-title" id="cv-parse-title">Review a profile draft</h2></div>
          <Button onClick={() => setParseTarget(null)} data-testid="button-close-cv-parse"><X size={16}/></Button>
        </div>
        <div className="notice" style={{ marginBottom:16 }}>
          The CV file stays local. Only text extracted from it is sent to the selected AI provider after you confirm. Nothing is saved to your candidate profile until you review and save it.
        </div>
        <label className="form-item">
          <span className="label">AI provider</span>
          <select className="field select" value={parseProvider} onChange={event => setParseProvider(event.target.value as '' | 'openai' | 'gemini')} data-testid="select-parse-provider">
            <option value="">Choose a configured provider</option>
            {aiProviders.map(item => <option key={item.provider} value={item.provider}>{labelize(item.provider)}</option>)}
          </select>
        </label>
        <label style={{ display:'flex',gap:9,alignItems:'flex-start',margin:'14px 0' }}>
          <input type="checkbox" checked={parseConsent} onChange={event => setParseConsent(event.target.checked)} data-testid="checkbox-parse-consent"/>
          <span className="field-hint">I agree to send this CV's extracted text to {parseProvider || 'the selected provider'} for parsing.</span>
        </label>
        {parseError && <p className="field-hint" style={{ color:'hsl(var(--destructive))' }} data-testid="status-parse-dialog-error">{parseError}</p>}
        <Button
          variant="primary"
          disabled={!readyProvider || !parseConsent || parse.isPending}
          onClick={() => parseTarget && readyProvider && runParse(parseTarget, parseProvider as 'openai' | 'gemini', parseConsent)}
          data-testid="button-confirm-parse-cv"
        >
          {parse.isPending ? 'Parsing…' : 'Parse CV'}
        </Button>
      </section>
    </div>}
  </main>;
}

function Settings() {
  const agentQ = useGetAgentStatus(); const settingsQ = useGetSettings(); const control = useControlAgent(); const qc = useQueryClient();
  const act = (command: 'start' | 'pause' | 'resume' | 'stop' | 'runNow') => control.mutate({ data: { command } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); }, onError: err => alert(errText(err)) });
  return <main className="page-wrap"><PageHead eyebrow="Workspace / controls" title="Agent & connections" sub="Review what is configured. You decide what runs and what gets sent."/>{agentQ.isLoading || settingsQ.isLoading ? <Loading count={3}/> : agentQ.isError ? <ErrorState error={agentQ.error} retry={agentQ.refetch}/> : settingsQ.isError ? <ErrorState error={settingsQ.error} retry={settingsQ.refetch}/> : <>
    <section className="panel" style={{ marginBottom:14 }}><div className="panel-head"><div><div className="panel-title">Agent controls</div><div className="field-hint" style={{ marginTop:4 }}>Current state: {labelize(agentQ.data?.state)}</div></div><span className="badge">{labelize(agentQ.data?.state)}</span></div><div className="panel-body"><p style={{ fontSize:12, marginTop:0 }}>{agentQ.data?.message}</p><div style={{ display:'flex', gap:8, flexWrap:'wrap' }}><Button onClick={() => act('start')} disabled={control.isPending}><Play size={14}/>Start</Button><Button onClick={() => act('pause')} disabled={control.isPending}><Pause size={14}/>Pause</Button><Button onClick={() => act('resume')} disabled={control.isPending}><RotateCw size={14}/>Resume</Button><Button onClick={() => act('runNow')} disabled={control.isPending}><Activity size={14}/>Run now</Button><Button variant="danger" onClick={() => act('stop')} disabled={control.isPending}><Square size={13}/>Stop</Button></div><div className="field-hint" style={{ marginTop:12 }}>Last state update · {date(agentQ.data?.updatedAt)}</div></div></section>
    <section className="panel" style={{ marginBottom:14 }}><div className="panel-head"><div className="panel-title">Provider & mailbox state</div><span className="eyebrow">Reported by local API</span></div><div className="panel-body">{settingsQ.data?.providers.map(provider => <div className="connection" key={provider.provider}><div><div className="connection-name">{provider.provider}</div><div className="connection-detail">{provider.detail}</div></div><span className={`badge ${provider.status === 'CONNECTED' ? 'badge-green' : provider.status === 'ERROR' ? 'badge-red' : 'badge-amber'}`}>{labelize(provider.status)}</span></div>)}</div></section>
    <section className="panel"><div className="panel-head"><div className="panel-title">Application safety</div><ShieldCheck size={16} className="muted"/></div><div className="panel-body"><div className="toggle-line"><span>Application mode</span><span className="badge">{labelize(settingsQ.data?.applicationMode)}</span></div><div className="toggle-line"><span>Duplicate protection</span><span className={`badge ${settingsQ.data?.duplicateProtection ? 'badge-green' : ''}`}>{settingsQ.data?.duplicateProtection ? 'Enabled' : 'Disabled'}</span></div><div className="notice" style={{ marginTop:15 }}>No application is sent from this workspace. Tracking a job creates a review-stage record only. Provider status is shown exactly as reported; no connection is implied.</div></div></section>
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
  return <div className="auth-screen"><aside className="auth-aside"><Link href="/login" className="brand" style={{ padding:0,color:'inherit',textDecoration:'none' }}><span className="brand-mark"><Sparkles size={17}/></span><span>fieldnotes / jobs</span></Link><div><div className="eyebrow" style={{ color:'#a9c4b4' }}>A private workspace</div><div style={{ font:'700 32px Manrope',letterSpacing:'-.05em',marginTop:10,lineHeight:1.15 }}>Your search.<br/>On your terms.</div><p style={{ color:'#bdc9c4',fontSize:13,lineHeight:1.7,maxWidth:310 }}>A local-first desk for keeping opportunities, documents and decisions in one place.</p></div><div className="field-hint" style={{ color:'#a9b7b5' }}>Local account · Your applications are never sent automatically</div></aside><main className="auth-main"><div className="auth-box"><div className="eyebrow">{setup ? 'First-time setup' : 'Welcome back'}</div><h1 className="auth-title">{setup ? 'Create your local password' : 'Sign in to your desk'}</h1><p className="page-sub" style={{ lineHeight:1.6, marginBottom:24 }}>{setup ? 'This password protects your personal workspace on this device.' : 'Your workspace is ready when you are.'}</p><form onSubmit={e => { e.preventDefault(); const password = String(new FormData(e.currentTarget).get('password')); mutation.mutate({ data: { password } }, { onSuccess: () => { queryClient.invalidateQueries(); setLoc('/dashboard'); } }); }}><input type="text" name="username" value="local" autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" style={{ position:'absolute',width:1,height:1,padding:0,margin:-1,overflow:'hidden',clip:'rect(0, 0, 0, 0)',whiteSpace:'nowrap',border:0 }}/><label className="form-item"><span className="label">Password</span><input name="password" className="field" type="password" minLength={12} maxLength={256} required autoComplete={setup ? 'new-password' : 'current-password'} placeholder="At least 12 characters"/></label>{setup && <p className="field-hint" style={{ marginTop:7 }}>Use 12 or more characters. Keep it somewhere safe.</p>}{mutation.isError && <div className="notice" style={{ marginTop:12 }}>{errText(mutation.error)}</div>}<Button type="submit" variant="primary" disabled={mutation.isPending} style={{ width:'100%',justifyContent:'center',marginTop:18 }}>{mutation.isPending ? 'Please wait…' : setup ? 'Set up local account' : 'Sign in'}<ChevronRight size={15}/></Button></form><div style={{ marginTop:22,fontSize:11,color:'hsl(var(--muted-foreground))',display:'flex',gap:7,alignItems:'center' }}><LockKeyhole size={13}/> Password authentication is handled by your local workspace.</div></div></main></div>;
}
function Router() {
  return <Switch><Route path="/setup"><AuthPage setup/></Route><Route path="/login"><AuthPage/></Route><Route><AuthGate/></Route></Switch>;
}
function App() { return <QueryClientProvider client={queryClient}><Router/></QueryClientProvider>; }
export default App;
