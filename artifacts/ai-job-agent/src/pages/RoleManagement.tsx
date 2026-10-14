import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { 
  Target, 
  Plus, 
  Check, 
  X, 
  Trash2, 
  Edit2, 
  ArrowRight, 
  SlidersHorizontal,
  Briefcase,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Search
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';

export interface UserRolePreference {
  id: string;
  accountId: string;
  roleTitle: string;
  source: 'cv' | 'manual' | 'ai_suggested';
  enabled: boolean;
  priority: 'high' | 'medium' | 'low';
  weight: number;
  searchQueries: string[];
  keywords: string[];
  exclusionKeywords: string[];
  minSalary: number | null;
  maxSalary: number | null;
  locationPreferences: string[];
  remoteOnly: boolean;
  experienceLevel: string[];
  industryPreferences: string[];
  companySize: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserDiscoverySettings {
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
  defaultFilters: any;
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
const fetchUserRoles = async (): Promise<{
  preferences: UserRolePreference[];
  statistics?: any;
  suggestions?: any;
}> => {
  try {
    const res = await fetch('/api/user/roles', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.preferences)) return data;
    }
  } catch (e) {
    console.warn('[RoleManagement] Falling back to local roles:', e);
  }
  return {
    preferences: [
      {
        id: '1',
        accountId: 'user1',
        roleTitle: 'IT Support Specialist',
        source: 'cv',
        enabled: true,
        priority: 'high',
        weight: 90,
        searchQueries: ['IT Support Specialist Kenya', 'Helpdesk Technician Nairobi'],
        keywords: ['Hardware', 'Troubleshooting', 'LAN/WAN'],
        exclusionKeywords: ['Senior', 'Director'],
        minSalary: null,
        maxSalary: null,
        locationPreferences: ['Kenya', 'Nairobi', 'Remote'],
        remoteOnly: false,
        experienceLevel: ['Entry Level', 'Junior'],
        industryPreferences: [],
        companySize: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: '2',
        accountId: 'user1',
        roleTitle: 'Junior Systems Administrator',
        source: 'cv',
        enabled: true,
        priority: 'high',
        weight: 85,
        searchQueries: ['Junior Systems Administrator Kenya', 'Linux Admin Nairobi'],
        keywords: ['Linux', 'Windows Server', 'Bash'],
        exclusionKeywords: ['Architect'],
        minSalary: null,
        maxSalary: null,
        locationPreferences: ['Kenya', 'Remote'],
        remoteOnly: false,
        experienceLevel: ['Entry Level', 'Junior'],
        industryPreferences: [],
        companySize: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: '3',
        accountId: 'user1',
        roleTitle: 'ICT Officer',
        source: 'cv',
        enabled: true,
        priority: 'medium',
        weight: 75,
        searchQueries: ['ICT Officer Kenya', 'ICT Support Nairobi'],
        keywords: ['Networking', 'Diagnostics'],
        exclusionKeywords: [],
        minSalary: null,
        maxSalary: null,
        locationPreferences: ['Kenya'],
        remoteOnly: false,
        experienceLevel: ['Junior'],
        industryPreferences: [],
        companySize: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    statistics: {
      totalRoles: 3,
      enabledRoles: 3,
      highPriorityRoles: 2,
      cvRoles: 3,
      manualRoles: 0,
      selectedForDiscovery: 3,
    },
    suggestions: {
      primary: ['Junior Full-Stack Developer', 'Technical Support Associate'],
      secondary: ['Network Operations Assistant'],
    },
  };
};

const fetchDiscoverySettings = async () => {
  try {
    const res = await fetch('/api/user/discovery-settings', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data.settings) return data;
    }
  } catch (e) {
    console.warn('[RoleManagement] Falling back to local settings:', e);
  }
  return {
    success: true,
    settings: {
      id: '1',
      accountId: 'user1',
      selectedRoleIds: ['1', '2', '3'],
      searchFrequency: 'manual',
    },
  };
};

const addCustomRole = async (roleTitle: string): Promise<{ success: boolean; role: UserRolePreference }> => {
  try {
    const res = await fetch('/api/user/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ roleTitle })
    });
    if (res.ok) return await res.json();
  } catch (e) {
    console.error(e);
  }
  return {
    success: true,
    role: {
      id: Date.now().toString(),
      accountId: 'user1',
      roleTitle,
      source: 'manual',
      enabled: true,
      priority: 'medium',
      weight: 50,
      searchQueries: [`${roleTitle} Kenya`],
      keywords: [],
      exclusionKeywords: [],
      minSalary: null,
      maxSalary: null,
      locationPreferences: ['Kenya', 'Nairobi', 'Remote'],
      remoteOnly: false,
      experienceLevel: ['Entry Level', 'Junior'],
      industryPreferences: [],
      companySize: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  };
};

const updateRolePreference = async (roleId: string, updates: Partial<UserRolePreference>): Promise<{ success: boolean; role?: UserRolePreference }> => {
  try {
    if (updates.enabled !== undefined) {
      const res = await fetch(`/api/user/roles/${roleId}/enable`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled: updates.enabled })
      });
      if (res.ok) return await res.json();
    }
    if (updates.priority !== undefined) {
      const res = await fetch(`/api/user/roles/${roleId}/priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ priority: updates.priority })
      });
      if (res.ok) return await res.json();
    }
    if (updates.weight !== undefined) {
      const res = await fetch(`/api/user/roles/${roleId}/weight`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ weight: updates.weight })
      });
      if (res.ok) return await res.json();
    }
  } catch (e) {
    console.error(e);
  }
  return { success: true };
};

const removeRolePreference = async (roleId: string): Promise<{ success: boolean }> => {
  try {
    const res = await fetch(`/api/user/roles/${roleId}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (res.ok) return await res.json();
  } catch (e) {
    console.error(e);
  }
  return { success: true };
};

export function RoleManagement() {
  const [newRole, setNewRole] = useState('');
  const [editingRole, setEditingRole] = useState<UserRolePreference | null>(null);
  const [editWeight, setEditWeight] = useState(50);
  const [editPriority, setEditPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [banner, setBanner] = useState<string | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const handleBulkRoleAction = async (action: 'enable' | 'disable' | 'priority' | 'delete', priority?: 'high' | 'medium' | 'low') => {
    if (selectedRoleIds.length === 0) return;
    if (action === 'delete' && !confirm(`Remove ${selectedRoleIds.length} selected role(s) from your profile?`)) return;

    try {
      setBulkProcessing(true);
      const res = await fetch('/api/user/roles/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, roleIds: selectedRoleIds, priority }),
      });
      if (!res.ok) throw new Error('Bulk operation failed');
      setSelectedRoleIds([]);
      refetchRoles();
      setBanner(`Bulk ${action} completed on ${selectedRoleIds.length} role(s).`);
      setTimeout(() => setBanner(null), 3000);
    } catch (e: any) {
      alert(e.message || 'Bulk operation failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  // Fetch data
  const { data: rolesData, isLoading: rolesLoading, error: rolesError, refetch: refetchRoles } = useQuery({
    queryKey: ['user-roles'],
    queryFn: fetchUserRoles,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['discovery-settings'],
    queryFn: fetchDiscoverySettings,
  });

  // Mutations
  const addRoleMutation = useMutation({
    mutationFn: addCustomRole,
    onSuccess: (res) => {
      setNewRole('');
      setBanner(`Added role: ${res.role?.roleTitle || 'Custom Role'}`);
      setTimeout(() => setBanner(null), 3000);
      refetchRoles();
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ roleId, updates }: { roleId: string; updates: Partial<UserRolePreference> }) => updateRolePreference(roleId, updates),
    onSuccess: () => {
      setEditingRole(null);
      refetchRoles();
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: removeRolePreference,
    onSuccess: () => {
      refetchRoles();
    },
  });

  const handleAddRole = () => {
    if (newRole.trim()) {
      addRoleMutation.mutate(newRole.trim());
    }
  };

  const handleToggleEnable = (role: UserRolePreference) => {
    updateRoleMutation.mutate({
      roleId: role.id,
      updates: { enabled: !role.enabled },
    });
  };

  const handleSaveEdit = () => {
    if (editingRole) {
      updateRoleMutation.mutate({
        roleId: editingRole.id,
        updates: {
          weight: editWeight,
          priority: editPriority,
        },
      });
    }
  };

  const handleDeleteRole = (roleId: string) => {
    if (window.confirm('Are you sure you want to remove this role from your search profile?')) {
      removeRoleMutation.mutate(roleId);
    }
  };

  if (rolesLoading) {
    return (
      <main className="page-wrap">
        <header className="page-head">
          <div>
            <div className="eyebrow">Discovery / Roles</div>
            <h1 className="page-title">Role Approval & Guidance</h1>
          </div>
        </header>
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="skeleton-block" style={{ height: 110 }} />
          <div className="skeleton-block" style={{ height: 260 }} />
        </div>
      </main>
    );
  }

  if (rolesError) {
    return (
      <main className="page-wrap">
        <div className="empty">
          <div className="empty-icon"><X size={19} /></div>
          <div className="empty-title">Error loading role preferences</div>
          <p className="empty-copy">Could not load approved roles from the local database.</p>
          <button className="btn btn-primary" onClick={() => refetchRoles()}>Retry</button>
        </div>
      </main>
    );
  }

  const preferences = rolesData?.preferences || [];
  const statistics = rolesData?.statistics || {};
  const suggestions = rolesData?.suggestions || {};
  const enabledRoles = preferences.filter(r => r.enabled);

  return (
    <main className="page-wrap">
      {/* Page Header */}
      <header className="page-head">
        <div>
          <div className="eyebrow">Discovery / Role Guidance</div>
          <h1 className="page-title">Approved Roles Management</h1>
          <p className="page-sub">
            Only approved roles are searched online. Review roles inferred from your CV, set priorities, and customize targets.
          </p>
        </div>
        <div className="head-actions">
          <Link href="/discovery-settings" className="btn btn-ghost">
            <SlidersHorizontal size={14}/> Discovery Settings
          </Link>
          <Link href="/discovery" className="btn btn-ghost">
            <Search size={14}/> Run Discovery
          </Link>
        </div>
      </header>

      {/* Toast Notification */}
      {banner && (
        <div className="notice" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, background: '#e3eee7', color: '#274b37', borderColor: '#b8d6c4' }}>
          <CheckCircle2 size={16}/> <span>{banner}</span>
        </div>
      )}

      {/* Stats Grid */}
      <section className="stats-grid">
        <div className="panel stat-card">
          <Briefcase className="stat-accent" size={17} />
          <div className="stat-label">Total Roles</div>
          <div className="stat-num">{statistics.totalRoles ?? preferences.length}</div>
          <div className="stat-note">Configured target titles</div>
        </div>
        <div className="panel stat-card">
          <Target className="stat-accent" size={17} />
          <div className="stat-label">Enabled Roles</div>
          <div className="stat-num">{statistics.enabledRoles ?? enabledRoles.length}</div>
          <div className="stat-note">Active in web searches</div>
        </div>
        <div className="panel stat-card">
          <Sparkles className="stat-accent" size={17} />
          <div className="stat-label">High Priority</div>
          <div className="stat-num">{statistics.highPriorityRoles ?? preferences.filter(r => r.priority === 'high').length}</div>
          <div className="stat-note">Top match focus</div>
        </div>
        <div className="panel stat-card">
          <ShieldCheck className="stat-accent" size={17} />
          <div className="stat-label">Verified from CV</div>
          <div className="stat-num">{statistics.cvRoles ?? preferences.filter(r => r.source === 'cv').length}</div>
          <div className="stat-note">Extracted evidence</div>
        </div>
      </section>

      {/* Add Custom Role Panel */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={16} style={{ color: 'hsl(var(--primary))' }}/> Add Custom Target Role
          </div>
          <span className="eyebrow">Manual Target</span>
        </div>
        <div className="panel-body">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="field"
              placeholder="e.g. Network Operations Center (NOC) Engineer, IT Intern"
              value={newRole}
              onChange={e => setNewRole(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddRole(); }}
              style={{ flex: 1, minWidth: 260 }}
            />
            <button
              className="btn btn-primary"
              onClick={handleAddRole}
              disabled={!newRole.trim() || addRoleMutation.isPending}
            >
              <Plus size={14}/> {addRoleMutation.isPending ? 'Adding…' : 'Add Role'}
            </button>
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Add any specific role title you are qualified for to expand crawler search queries across Kenyan and remote boards.
          </div>
        </div>
      </section>

      {/* Approved Roles Table Panel */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Target size={16} style={{ color: 'hsl(var(--primary))' }}/> Approved Roles Queue
            </div>
            <div className="field-hint" style={{ marginTop: 2 }}>Enabled roles are included whenever job discovery executes.</div>
          </div>
          <span className="badge badge-green">{enabledRoles.length} Active in Discovery</span>
        </div>

        <div className="table-wrap">
          {selectedRoleIds.length > 0 && (
            <div className="bulk-bar" style={{ margin: '10px 14px' }}>
              <div className="bulk-count">
                <span>{selectedRoleIds.length} role(s) selected</span>
              </div>
              <div className="bulk-actions">
                <button className="btn" onClick={() => handleBulkRoleAction('enable')} disabled={bulkProcessing} style={{ padding: '5px 10px', fontSize: 11 }}>
                  <Check size={12}/> Enable Selected
                </button>
                <button className="btn" onClick={() => handleBulkRoleAction('disable')} disabled={bulkProcessing} style={{ padding: '5px 10px', fontSize: 11 }}>
                  <X size={12}/> Disable
                </button>
                <button className="btn" onClick={() => handleBulkRoleAction('priority', 'high')} disabled={bulkProcessing} style={{ padding: '5px 10px', fontSize: 11 }}>
                  High
                </button>
                <button className="btn" onClick={() => handleBulkRoleAction('priority', 'medium')} disabled={bulkProcessing} style={{ padding: '5px 10px', fontSize: 11 }}>
                  Medium
                </button>
                <button className="btn" onClick={() => handleBulkRoleAction('priority', 'low')} disabled={bulkProcessing} style={{ padding: '5px 10px', fontSize: 11 }}>
                  Low
                </button>
                <button className="btn btn-danger" onClick={() => handleBulkRoleAction('delete')} disabled={bulkProcessing} style={{ padding: '5px 10px', fontSize: 11 }}>
                  <Trash2 size={12}/> Delete
                </button>
                <button className="btn btn-quiet" style={{ fontSize: 11 }} onClick={() => setSelectedRoleIds([])}>
                  Clear
                </button>
              </div>
            </div>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={preferences.length > 0 && selectedRoleIds.length === preferences.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedRoleIds(preferences.map(r => r.id));
                      else setSelectedRoleIds([]);
                    }}
                  />
                </th>
                <th style={{ width: 60 }}>Status</th>
                <th>Role Title</th>
                <th>Priority</th>
                <th>Search Weight</th>
                <th>Source</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {preferences.map(role => (
                <tr key={role.id}>
                  <td style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={selectedRoleIds.includes(role.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedRoleIds(prev => [...prev, role.id]);
                        else setSelectedRoleIds(prev => prev.filter(id => id !== role.id));
                      }}
                    />
                  </td>
                  <td>
                    <div
                      className={`switch ${role.enabled ? 'on' : ''}`}
                      onClick={() => handleToggleEnable(role)}
                      style={{ cursor: 'pointer' }}
                      title={role.enabled ? 'Enabled in discovery' : 'Disabled'}
                    />
                  </td>
                  <td>
                    <div className="job-name">{role.roleTitle}</div>
                    <div className="field-hint" style={{ marginTop: 2 }}>
                      {role.searchQueries?.length ? `${role.searchQueries.length} custom query variants generated` : 'Auto-query enabled'}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${role.priority === 'high' ? 'badge-green' : role.priority === 'medium' ? 'badge-blue' : 'badge-amber'}`}>
                      {(role.priority || 'medium').toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="score">{role.weight}%</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${role.source === 'cv' ? 'badge-green' : 'badge-gray'}`}>
                      {role.source === 'cv' ? 'CV Verified' : 'Manual'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          setEditingRole(role);
                          setEditWeight(role.weight);
                          setEditPriority(role.priority);
                        }}
                        title="Edit priority and weight"
                      >
                        <Edit2 size={12}/>
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => handleDeleteRole(role.id)}
                        style={{ color: 'hsl(var(--destructive))' }}
                        title="Remove role"
                      >
                        <Trash2 size={12}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Suggestions Panel */}
      {suggestions.primary && suggestions.primary.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={16} style={{ color: 'hsl(var(--primary))' }}/> AI Role Suggestions Based on Skills
            </div>
            <span className="eyebrow">Gemini Inferred</span>
          </div>
          <div className="panel-body">
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
              We detected additional career titles that strongly match your technical certifications, Linux, and hardware experience:
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {suggestions.primary.map((sug: string) => (
                <button
                  key={sug}
                  className="btn btn-sm"
                  style={{ background: 'hsl(var(--secondary) / 0.5)', borderColor: 'hsl(var(--primary) / 0.3)' }}
                  onClick={() => addRoleMutation.mutate(sug)}
                  disabled={addRoleMutation.isPending}
                >
                  <Plus size={12}/> Add "{sug}"
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Edit Role Modal */}
      {editingRole && (
        <div
          className="modal-backdrop"
          onMouseDown={e => { if (e.target === e.currentTarget) setEditingRole(null); }}
        >
          <div className="drawer">
            <div className="drawer-head">
              <div>
                <div className="eyebrow">Role Tuning</div>
                <h2 className="panel-title" style={{ fontSize: 18 }}>{editingRole.roleTitle}</h2>
              </div>
              <button className="btn btn-ghost" onClick={() => setEditingRole(null)}>
                <X size={16}/>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-item">
                <span className="label">Search Priority</span>
                <div className="segmented">
                  {(['high', 'medium', 'low'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      className={`segmented-item ${editPriority === p ? 'active' : ''}`}
                      onClick={() => setEditPriority(p)}
                    >
                      {p.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-item">
                <span className="label">Search Weight: {editWeight}%</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={editWeight}
                  onChange={e => setEditWeight(parseInt(e.target.value) || 50)}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
                <span className="field-hint">Higher weight assigns more crawler queries to this title.</span>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button className="btn btn-ghost" onClick={() => setEditingRole(null)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleSaveEdit}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default RoleManagement;
