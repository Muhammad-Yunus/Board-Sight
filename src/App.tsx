import { useCallback, useEffect, useState } from 'react';
import {
  BarChart2,
  Bell,
  Bot,
  Box,
  Calendar,
  ChevronDown,
  Cpu,
  Download,
  LineChart,
  LogOut,
  MapPin,
  Menu,
  MonitorCheck,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { BrandLogo } from './components/BrandLogo.tsx';
import { AuthScreen } from './components/AuthScreen.tsx';
import { apiFetch, setStoredAuthToken } from './lib/api.ts';
import { PcbDefectMap } from './components/PcbDefectMap.tsx';
import { DefectFrequencyChart } from './components/DefectFrequencyChart.tsx';
import { DefectShareCard } from './components/DefectShareCard.tsx';
import { RootCauseCard } from './components/RootCauseCard.tsx';
import { BatchDetailsModal } from './components/BatchDetailsModal.tsx';
import { InspectionReviewModal } from './components/InspectionReviewModal.tsx';
import { AgentAssistantModal } from './components/AgentAssistantModal.tsx';
import { IngestionView } from './components/IngestionView.tsx';
import {
  BoardModelsView,
  DefectMapExplorerView,
  ShiftAnalyticsView,
} from './components/SecondaryViews.tsx';
import type {
  AuthUser,
  DashboardData,
  DashboardFilters,
  DefectCluster,
} from './types/boardsight.ts';

type NavSection = 'analytics' | 'models' | 'ingest' | 'dashboard' | 'map' | 'batches';

const PERIOD_PRESETS: Record<
  string,
  { label: string; startDate: string; endDate: string }
> = {
  may_1_20: {
    label: '01 May 2025 – 20 May 2025',
    startDate: '2025-05-01',
    endDate: '2025-05-20',
  },
  may_15_17: {
    label: '15 May 2025 – 17 May 2025',
    startDate: '2025-05-15',
    endDate: '2025-05-17',
  },
  all_dates: {
    label: 'All Inspection Dates',
    startDate: '2024-01-01',
    endDate: '2030-12-31',
  },
};

const DEFAULT_FILTERS: DashboardFilters = {
  periodKey: 'may_1_20',
  startDate: '2025-05-01',
  endDate: '2025-05-20',
  boardModel: 'Model X12',
  batchKey: 'ALL',
  defectType: 'ALL',
  operator: 'ALL',
  sortRootCause: 'frequency',
};

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [draftFilters, setDraftFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCluster, setSelectedCluster] = useState<DefectCluster | null>(null);
  const [batchModalTarget, setBatchModalTarget] = useState<{
    batchCode: string;
    batchId?: number | null;
  } | null>(null);
  const [reviewInspectionTarget, setReviewInspectionTarget] = useState<
    number | string | null
  >(null);

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const [aiRefreshing, setAiRefreshing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [nextUpdateMin, setNextUpdateMin] = useState(4);

  // Check active session on boot
  useEffect(() => {
    apiFetch('/api/auth/me')
      .then(async (res) => {
        if (!res.ok) {
          setStoredAuthToken(null);
          return null;
        }
        const json = await res.json();
        return json.user as AuthUser;
      })
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setAuthChecking(false));
  }, []);

  const fetchDashboard = useCallback(async (filters: DashboardFilters) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        startDate: filters.startDate,
        endDate: filters.endDate,
        boardModel: filters.boardModel,
        batchKey: filters.batchKey,
        defectType: filters.defectType,
        operator: filters.operator,
        sortRootCause: filters.sortRootCause,
      });

      const res = await apiFetch(`/api/dashboard?${qs.toString()}`);
      if (res.status === 401) {
        setStoredAuthToken(null);
        setUser(null);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load dashboard');
      const data = json as DashboardData;
      setDashboard(data);

      // Default active hotspot to Missing Component (C9) if present, else top cluster
      const preferred =
        data.defectMap.find(
          (c) => c.componentRef === 'C9' && c.defectType === 'Missing Component'
        ) || data.defectMap[0] || null;
      setSelectedCluster(preferred);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchDashboard(appliedFilters);
  }, [user, appliedFilters, fetchDashboard]);

  // Live 4-minute refresh countdown
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      setNextUpdateMin((prev) => {
        if (prev <= 1) {
          fetchDashboard(appliedFilters);
          return 4;
        }
        return prev - 1;
      });
    }, 60_000);
    return () => clearInterval(timer);
  }, [user, appliedFilters, fetchDashboard]);

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setStoredAuthToken(null);
    setUser(null);
    setDashboard(null);
    setProfileMenuOpen(false);
  }

  function handleApplyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function handleResetFilters() {
    const resetFilters: DashboardFilters = {
      ...DEFAULT_FILTERS,
      periodKey: 'all_dates',
      startDate: PERIOD_PRESETS.all_dates.startDate,
      endDate: PERIOD_PRESETS.all_dates.endDate,
    };
    setDraftFilters(resetFilters);
    setAppliedFilters(resetFilters);
  }

  async function handleExportCsv() {
    const qs = new URLSearchParams({
      startDate: appliedFilters.startDate,
      endDate: appliedFilters.endDate,
      boardModel: appliedFilters.boardModel,
      batchKey: appliedFilters.batchKey,
      defectType: appliedFilters.defectType,
      operator: appliedFilters.operator,
    });
    const res = await apiFetch(`/api/inspections/export?${qs.toString()}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boardsight-${appliedFilters.boardModel.replace(/\s+/g, '-')}-defects.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRunAiInsight() {
    setAiRefreshing(true);
    setAiError(null);
    try {
      const res = await apiFetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appliedFilters),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to generate AI analysis.');
      setDashboard((prev) => (prev ? { ...prev, aiInsight: json.aiInsight } : prev));
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI analysis failed.');
    } finally {
      setAiRefreshing(false);
    }
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#FAFAFB] flex items-center justify-center">
        <div className="flex items-center gap-3 text-[13px] text-[#6B7280]">
          <BrandLogo size={28} />
          <span>Initializing Board Sight session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={(u) => setUser(u)} />;
  }

  const navItems: { id: NavSection; label: string; icon: typeof LineChart }[] = [
    { id: 'analytics', label: 'Shift Analytics', icon: BarChart2 },
    { id: 'models', label: 'Board Models', icon: Cpu },
    { id: 'ingest', label: 'AOI Ingestion', icon: MonitorCheck },
    { id: 'dashboard', label: 'Defect Inspection', icon: LineChart },
    { id: 'map', label: 'Defect Map', icon: MapPin },
    { id: 'batches', label: 'Batch Ledger', icon: Box },
  ];

  const userInitials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const holdBatches =
    dashboard?.batches.filter((b) => b.status === 'HOLD_REVIEW' || b.defectRatePct > 14) ||
    [];
  const pendingReviewUnits =
    dashboard?.recentInspections.filter((i) => i.reviewStatus === 'PENDING_REVIEW') ||
    [];

  return (
    <div className="min-h-screen bg-[#FAFAFB] text-[#111827] flex">
      {/* Desktop Left Vertical Icon Sidebar (matching mockup) */}
      <aside className="hidden md:flex w-[68px] shrink-0 bg-white border-r border-[#EAECEF] flex-col items-center sticky top-0 h-screen z-30">
        <button
          type="button"
          onClick={() => setActiveNav('dashboard')}
          title="Board Sight"
          className="h-[64px] w-full flex items-center justify-center border-b border-transparent hover:opacity-90 transition-opacity"
        >
          <BrandLogo size={32} />
        </button>

        <nav className="mt-5 flex flex-col items-center gap-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                title={item.label}
                aria-label={item.label}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                  active
                    ? 'bg-[#F2F7F3] text-[#229A45]'
                    : 'text-[#374151] hover:bg-[#F3F4F6] hover:text-[#111827]'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" strokeWidth={1.8} />
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/30 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-64 h-full bg-white border-r border-[#EAECEF] p-4 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-[#EAECEF]">
              <div className="flex items-center gap-2.5">
                <BrandLogo size={26} />
                <span className="text-[15px] font-semibold text-[#111827]">
                  Board Sight
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[#F3F4F6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="mt-4 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium ${
                      active
                        ? 'bg-[#F2F7F3] text-[#229A45]'
                        : 'text-[#374151] hover:bg-[#F3F4F6]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Right Main Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar (matching mockup: clean right-aligned Bell + User Profile Card) */}
        <header className="h-[64px] bg-white border-b border-[#EAECEF] px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 md:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="w-9 h-9 rounded-lg border border-[#E5E7EB] flex items-center justify-center text-[#374151]"
            >
              <Menu className="w-4 h-4" />
            </button>
            <BrandLogo size={26} />
            <span className="text-[15px] font-semibold text-[#111827]">
              Board Sight
            </span>
          </div>

          <div className="hidden md:block" />

          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotificationsOpen((o) => !o);
                  setProfileMenuOpen(false);
                }}
                aria-label="Inspection alerts"
                className="w-10 h-10 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] flex items-center justify-center text-[#374151] relative transition-colors"
              >
                <Bell className="w-[17px] h-[17px]" strokeWidth={1.8} />
                {(holdBatches.length > 0 || pendingReviewUnits.length > 0) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] absolute top-2.5 right-2.5" />
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-[#E5E7EB] rounded-xl shadow-xl p-3 z-40 max-h-[420px] overflow-y-auto">
                  <div className="text-[12.5px] font-semibold text-[#111827] pb-2 border-b border-[#F1F3F5]">
                    AOI Line Alerts &amp; Operator Queue
                  </div>

                  {pendingReviewUnits.length > 0 && (
                    <div className="mt-2 pb-2 border-b border-[#F1F3F5]">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#D97706] px-1.5 mb-1">
                        Pending Operator Review ({dashboard?.kpis.pendingReviewCount ?? pendingReviewUnits.length})
                      </div>
                      {pendingReviewUnits.slice(0, 4).map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setReviewInspectionTarget(u.id);
                            setNotificationsOpen(false);
                          }}
                          className="w-full text-left py-1.5 hover:bg-[#FAFAFB] rounded px-1.5 flex items-center justify-between gap-2"
                        >
                          <span className="text-[12px] font-mono-tabular font-medium text-[#111827]">
                            {u.serialNumber}
                          </span>
                          <span className="text-[11px] text-[#6B7280] truncate">
                            {u.primaryDefect}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {holdBatches.length === 0 && pendingReviewUnits.length === 0 ? (
                    <p className="text-[12px] text-[#6B7280] py-3">
                      All active batches within nominal yield thresholds.
                    </p>
                  ) : (
                    <div className="divide-y divide-[#F1F3F5] mt-1">
                      {holdBatches.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            setBatchModalTarget({ batchCode: b.batchCode, batchId: b.id });
                            setNotificationsOpen(false);
                          }}
                          className="w-full text-left py-2.5 hover:bg-[#FAFAFB] rounded px-1.5"
                        >
                          <div className="text-[12px] font-semibold text-[#EF4444]">
                            Batch {b.batchCode} · Shift {b.shift} Alert
                          </div>
                          <div className="text-[11.5px] text-[#6B7280]">
                            Defect rate at {b.defectRatePct}% ({b.defectiveBoards}/
                            {b.totalInspected} boards)
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* User Profile Card */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen((o) => !o);
                  setNotificationsOpen(false);
                }}
                className="rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] px-2.5 py-1.5 flex items-center gap-2.5 transition-colors"
              >
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-md object-cover shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-md bg-[#F2F7F3] text-[#229A45] text-[12px] font-semibold flex items-center justify-center shrink-0">
                    {userInitials}
                  </div>
                )}
                <div className="hidden sm:block text-left pr-1">
                  <div className="text-[13px] font-semibold text-[#111827] leading-tight whitespace-nowrap">
                    {user.name}
                  </div>
                  <div className="text-[11px] text-[#6B7280] leading-tight">
                    {user.role}
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-[#6B7280] shrink-0" />
              </button>

              {profileMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-[#E5E7EB] rounded-xl shadow-xl py-1.5 z-40 text-[12.5px]">
                  <div className="px-3.5 py-2 border-b border-[#F1F3F5]">
                    <div className="font-semibold text-[#111827] truncate">
                      {user.name}
                    </div>
                    <div className="text-[11px] text-[#6B7280] truncate">
                      {user.email}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveNav('ingest');
                      setProfileMenuOpen(false);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-[#F9FAFB] text-[#374151] flex items-center gap-2"
                  >
                    <MonitorCheck className="w-3.5 h-3.5" /> AOI Ingestion &amp; Keys
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full text-left px-3.5 py-2 hover:bg-red-50 text-red-600 flex items-center gap-2"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Sub-Header Context Strip */}
        <div className="bg-white border-b border-[#EAECEF] px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {dashboard ? (
              <>
                <h1 className="text-[18px] font-semibold text-[#111827] tracking-[-0.015em]">
                  {dashboard.header.boardDisplayName}
                </h1>
                <button
                  type="button"
                  disabled={!dashboard.header.latestInspectionId}
                  onClick={() => {
                    if (dashboard.header.latestInspectionId) {
                      setReviewInspectionTarget(dashboard.header.latestInspectionId);
                    }
                  }}
                  title="Click to inspect & verify this board unit"
                  className="bg-[#FAFAFB] hover:bg-[#F3F4F6] border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-[12px] font-medium text-[#111827] tabular-nums transition-colors cursor-pointer disabled:cursor-default"
                >
                  SN: {dashboard.header.serialNumber}
                </button>
              </>
            ) : (
              <div className="h-7 w-64 bg-[#F3F4F6] rounded-lg animate-pulse" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            {dashboard && (
              <>
                <div className="flex items-center gap-1.5 text-[12.5px]">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      dashboard.header.inspectionStatus === 'PASS'
                        ? 'bg-[#16A34A]'
                        : 'bg-[#EF4444]'
                    }`}
                  />
                  <span
                    className={`font-medium ${
                      dashboard.header.inspectionStatus === 'PASS'
                        ? 'text-[#16A34A]'
                        : 'text-[#EF4444]'
                    }`}
                  >
                    Inspection Status: {dashboard.header.inspectionStatus}
                  </span>
                </div>

                <div className="text-[12.5px] tabular-nums hidden sm:block">
                  <span className="font-semibold text-[#111827]">
                    Updated: {dashboard.header.updatedTime}
                  </span>
                  <span className="text-[#6B7280] ml-1.5">
                    Next update in {nextUpdateMin} min
                  </span>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!dashboard}
              className="border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] disabled:opacity-50 rounded-lg px-3.5 py-2 text-[12.5px] font-medium text-[#111827] inline-flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-[#374151]" />
              <span>Export as CSV</span>
            </button>
          </div>
        </div>

        {/* Main Viewport */}
        <main className="p-4 sm:p-5 lg:p-6 space-y-4 max-w-[1600px] w-full mx-auto">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-700">
              {error}
            </div>
          )}

          {activeNav === 'ingest' && dashboard && (
            <IngestionView
              boardModels={dashboard.filterOptions.boardModels}
              operatorName={user.name}
              onIngestionSuccess={(ingestedModelCode) => {
                const expanded: DashboardFilters = {
                  ...appliedFilters,
                  boardModel: ingestedModelCode || appliedFilters.boardModel,
                  batchKey: 'ALL',
                  periodKey: 'all_dates',
                  startDate: '2024-01-01',
                  endDate: '2030-12-31',
                };
                setDraftFilters(expanded);
                setAppliedFilters(expanded);
              }}
            />
          )}

          {activeNav === 'models' && dashboard && (
            <BoardModelsView
              data={dashboard}
              onSelectModel={(code) => {
                const updated: DashboardFilters = {
                  ...DEFAULT_FILTERS,
                  boardModel: code,
                  periodKey: 'all_dates',
                  startDate: '2024-01-01',
                  endDate: '2030-12-31',
                };
                setDraftFilters(updated);
                setAppliedFilters(updated);
                setActiveNav('dashboard');
              }}
              onModelsUpdated={(selectCode) => {
                if (selectCode) {
                  const updated: DashboardFilters = {
                    ...DEFAULT_FILTERS,
                    boardModel: selectCode,
                    periodKey: 'all_dates',
                    startDate: '2024-01-01',
                    endDate: '2030-12-31',
                  };
                  setDraftFilters(updated);
                  setAppliedFilters(updated);
                } else {
                  fetchDashboard(appliedFilters);
                }
              }}
            />
          )}

          {(activeNav === 'analytics' || activeNav === 'batches') && dashboard && (
            <ShiftAnalyticsView
              data={dashboard}
              onInspectBatch={(batchCode, batchId) =>
                setBatchModalTarget({ batchCode, batchId })
              }
              onReviewInspection={(inspectionId) =>
                setReviewInspectionTarget(inspectionId)
              }
            />
          )}

          {activeNav === 'map' && dashboard && (
            <DefectMapExplorerView
              data={dashboard}
              selectedCluster={selectedCluster}
              onSelectCluster={setSelectedCluster}
            />
          )}

          {activeNav === 'dashboard' && (
            <>
              {/* Filter Bar Card */}
              <section className="bg-white border border-[#EAECEF] rounded-xl px-4 sm:px-5 py-3.5">
                <div className="flex flex-col xl:flex-row xl:items-end gap-3.5">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-12 gap-3.5">
                    {/* Select Period */}
                    <div className="lg:col-span-3">
                      <label className="flex items-center gap-1.5 text-[11.5px] text-[#6B7280] mb-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#6B7280]" />
                        <span>Select Period</span>
                      </label>
                      <div className="relative">
                        <select
                          value={draftFilters.periodKey}
                          onChange={(e) => {
                            const preset = PERIOD_PRESETS[e.target.value];
                            if (!preset) return;
                            setDraftFilters((prev) => ({
                              ...prev,
                              periodKey: e.target.value,
                              startDate: preset.startDate,
                              endDate: preset.endDate,
                            }));
                          }}
                          className="w-full appearance-none bg-white border border-[#E5E7EB] rounded-lg pl-3 pr-8 py-2 text-[12.5px] font-medium text-[#111827] focus:outline-none focus:border-[#229A45] cursor-pointer truncate"
                        >
                          {Object.entries(PERIOD_PRESETS).map(([key, p]) => (
                            <option key={key} value={key}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>

                    {/* Board Model */}
                    <div className="lg:col-span-2">
                      <label className="block text-[11.5px] text-[#6B7280] mb-1.5">
                        Board Model
                      </label>
                      <div className="relative">
                        <select
                          value={draftFilters.boardModel}
                          onChange={(e) =>
                            setDraftFilters((prev) => ({
                              ...prev,
                              boardModel: e.target.value,
                              batchKey: 'ALL',
                            }))
                          }
                          className="w-full appearance-none bg-white border border-[#E5E7EB] rounded-lg pl-3 pr-8 py-2 text-[12.5px] font-medium text-[#111827] focus:outline-none focus:border-[#229A45] cursor-pointer truncate"
                        >
                          {(dashboard?.filterOptions.boardModels || []).map((m) => (
                            <option key={m.id} value={m.code}>
                              {m.code}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>

                    {/* Batch / Shift / Line */}
                    <div className="lg:col-span-3">
                      <label className="block text-[11.5px] text-[#6B7280] mb-1.5">
                        Batch / Shift / Line
                      </label>
                      <div className="relative">
                        <select
                          value={draftFilters.batchKey}
                          onChange={(e) =>
                            setDraftFilters((prev) => ({
                              ...prev,
                              batchKey: e.target.value,
                            }))
                          }
                          className="w-full appearance-none bg-white border border-[#E5E7EB] rounded-lg pl-3 pr-8 py-2 text-[12.5px] font-medium text-[#111827] focus:outline-none focus:border-[#229A45] cursor-pointer truncate"
                        >
                          <option value="ALL">All Batches / Shifts / Lines</option>
                          {(dashboard?.filterOptions.batches || []).map((b) => (
                            <option key={b.id} value={b.key}>
                              {b.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>

                    {/* Defect Type */}
                    <div className="lg:col-span-2">
                      <label className="block text-[11.5px] text-[#6B7280] mb-1.5">
                        Defect Type
                      </label>
                      <div className="relative">
                        <select
                          value={draftFilters.defectType}
                          onChange={(e) =>
                            setDraftFilters((prev) => ({
                              ...prev,
                              defectType: e.target.value,
                            }))
                          }
                          className="w-full appearance-none bg-white border border-[#E5E7EB] rounded-lg pl-3 pr-8 py-2 text-[12.5px] font-medium text-[#111827] focus:outline-none focus:border-[#229A45] cursor-pointer truncate"
                        >
                          <option value="ALL">All Defect Types</option>
                          {(dashboard?.filterOptions.defectTypes || []).map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>

                    {/* Operator */}
                    <div className="lg:col-span-2">
                      <label className="block text-[11.5px] text-[#6B7280] mb-1.5">
                        Operator
                      </label>
                      <div className="relative">
                        <select
                          value={draftFilters.operator}
                          onChange={(e) =>
                            setDraftFilters((prev) => ({
                              ...prev,
                              operator: e.target.value,
                            }))
                          }
                          className="w-full appearance-none bg-white border border-[#E5E7EB] rounded-lg pl-3 pr-8 py-2 text-[12.5px] font-medium text-[#111827] focus:outline-none focus:border-[#229A45] cursor-pointer truncate"
                        >
                          <option value="ALL">All Operators</option>
                          {(dashboard?.filterOptions.operators || []).map((op) => (
                            <option key={op} value={op}>
                              {op}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                  </div>

                  {/* Inline Apply & Reset */}
                  <div className="flex flex-row items-center justify-end gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleApplyFilters}
                      disabled={loading}
                      className="bg-[#5AC16D] hover:bg-[#49B05C] disabled:opacity-60 text-white text-[12px] font-semibold rounded-lg px-4 py-2 whitespace-nowrap shrink-0 transition-colors"
                    >
                      Apply Filters
                    </button>
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="text-[#229A45] hover:text-[#1B7E38] hover:bg-[#F2F7F3] text-[12px] font-medium rounded-lg px-3 py-2 whitespace-nowrap shrink-0 transition-colors"
                    >
                      Reset Filters
                    </button>
                  </div>
                </div>
              </section>

              {/* 5 KPI Summary Cards Row (matching mockup) */}
              <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
                <div className="bg-white border border-[#EAECEF] rounded-xl py-4 px-4 text-center flex flex-col items-center justify-center">
                  <div className="text-[19px] font-semibold text-[#EAB308] tabular-nums leading-snug">
                    {dashboard ? `${dashboard.kpis.defectiveBoardsPct}%` : '—'}
                  </div>
                  <div className="text-[12px] text-[#6B7280] mt-1">
                    Defective Boards
                  </div>
                </div>

                <div className="bg-white border border-[#EAECEF] rounded-xl py-4 px-4 text-center flex flex-col items-center justify-center">
                  <div className="text-[19px] font-semibold text-[#F05252] tabular-nums leading-snug">
                    {dashboard ? dashboard.kpis.totalDefects : '—'}
                  </div>
                  <div className="text-[12px] text-[#6B7280] mt-1">
                    Total Defects
                  </div>
                </div>

                <div className="bg-white border border-[#EAECEF] rounded-xl py-4 px-4 text-center flex flex-col items-center justify-center">
                  <div className="text-[19px] font-semibold text-[#EAB308] tabular-nums leading-snug">
                    {dashboard ? dashboard.kpis.avgDefectsPerBoard : '—'}
                  </div>
                  <div className="text-[12px] text-[#6B7280] mt-1">
                    Avg Defects per Board
                  </div>
                </div>

                <div className="bg-white border border-[#EAECEF] rounded-xl py-4 px-4 text-center flex flex-col items-center justify-center">
                  <div className="text-[16px] font-semibold text-[#111827] leading-snug">
                    {dashboard ? dashboard.kpis.worstShift : '—'}
                  </div>
                  <div className="text-[12px] text-[#6B7280] mt-1">
                    Worst Shift
                  </div>
                </div>

                <div className="bg-white border border-[#EAECEF] rounded-xl py-4 px-4 text-center flex flex-col items-center justify-center sm:col-span-2 md:col-span-1">
                  <div className="text-[16px] font-semibold text-[#111827] leading-snug truncate max-w-full">
                    {dashboard ? dashboard.kpis.mostFrequentDefect : '—'}
                  </div>
                  <div className="text-[12px] text-[#6B7280] mt-1">
                    Most Frequent Defect
                  </div>
                </div>
              </section>

              {/* Main 2-Column Split Grid: Left PCB Defect Map + Right Frequency & AI Insight */}
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                <div className="lg:col-span-6">
                  <PcbDefectMap
                    pcbImageUrl={dashboard?.header.pcbImageUrl || ''}
                    boardDisplayName={dashboard?.header.boardDisplayName || ''}
                    clusters={dashboard?.defectMap || []}
                    selectedCluster={selectedCluster}
                    onSelectCluster={setSelectedCluster}
                  />
                </div>

                <div className="lg:col-span-6 flex flex-col gap-4">
                  <DefectFrequencyChart
                    data={dashboard?.defectFrequency || []}
                    activeDefectType={appliedFilters.defectType}
                    onSelectDefectType={(defectType) => {
                      setDraftFilters((p) => ({ ...p, defectType }));
                      setAppliedFilters((p) => ({ ...p, defectType }));
                    }}
                  />

                  {/* AI Insight Card */}
                  <div className="bg-white border border-[#EAECEF] rounded-xl p-5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-[17px] h-[17px] text-[#111827]" strokeWidth={1.8} />
                        <h2 className="text-[15.5px] font-semibold text-[#111827] tracking-[-0.01em]">
                          AI Insight
                        </h2>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAgentModalOpen(true)}
                          disabled={!dashboard}
                          className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#2563EB] hover:text-[#1D4ED8] border border-[#DBEAFE] bg-[#EFF6FF] hover:bg-[#DBEAFE] rounded-lg px-2.5 py-1 transition-colors disabled:opacity-50"
                        >
                          <Bot className="w-3 h-3" />
                          <span>Agent &amp; RAG</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleRunAiInsight}
                          disabled={aiRefreshing || !dashboard}
                          className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#6B7280] hover:text-[#111827] border border-[#E5E7EB] rounded-lg px-2.5 py-1 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`w-3 h-3 ${aiRefreshing ? 'animate-spin' : ''}`}
                          />
                          <span>{aiRefreshing ? 'Analyzing...' : 'Refresh AI'}</span>
                        </button>
                      </div>
                    </div>

                    {aiError && (
                      <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                        {aiError}
                      </div>
                    )}

                    {dashboard?.aiInsight ? (
                      <>
                        <p className="mt-3 text-[13px] font-medium text-[#111827] leading-relaxed">
                          {dashboard.aiInsight.headline}
                        </p>

                        <div className="mt-3.5 border border-[#EAECEF] bg-[#FCFCFD] rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                          <div className="text-[12.5px]">
                            <span className="font-semibold text-[#2563EB]">
                              Recommend:{' '}
                            </span>
                            <span className="font-medium text-[#2563EB]">
                              {dashboard.aiInsight.recommendation}
                            </span>
                          </div>
                          {dashboard.aiInsight.targetBatchCode && (
                            <button
                              type="button"
                              onClick={() =>
                                setBatchModalTarget({
                                  batchCode: dashboard.aiInsight!.targetBatchCode,
                                  batchId: dashboard.aiInsight!.batchId,
                                })
                              }
                              className="text-[12.5px] font-medium text-[#2563EB] hover:text-[#1D4ED8] underline whitespace-nowrap"
                            >
                              See batch details
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="mt-3 text-[12.5px] text-[#6B7280]">
                        {loading
                          ? 'Loading persisted AI telemetry insight...'
                          : 'No AI insight recorded yet for this board model. Click Refresh AI to run analysis on current PostgreSQL metrics.'}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Bottom 2-Column Split Grid: Defect Share by Type + Root Cause Breakdown */}
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-6">
                  <DefectShareCard
                    data={dashboard?.defectShare || []}
                    totalDefects={dashboard?.kpis.totalDefects || 0}
                    onSelectDefectType={(defectType) => {
                      const next =
                        appliedFilters.defectType === defectType ? 'ALL' : defectType;
                      setDraftFilters((p) => ({ ...p, defectType: next }));
                      setAppliedFilters((p) => ({ ...p, defectType: next }));
                    }}
                  />
                </div>

                <div className="lg:col-span-6">
                  <RootCauseCard
                    data={dashboard?.rootCauses || []}
                    sortBy={appliedFilters.sortRootCause}
                    onChangeSort={(sort) => {
                      setDraftFilters((p) => ({ ...p, sortRootCause: sort }));
                      setAppliedFilters((p) => ({ ...p, sortRootCause: sort }));
                    }}
                  />
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      {/* Batch Details Modal */}
      <BatchDetailsModal
        batchCode={batchModalTarget?.batchCode || null}
        batchId={batchModalTarget?.batchId}
        boardModelCode={dashboard?.header.boardModelCode}
        userRole={user.role}
        aiInsight={dashboard?.aiInsight || null}
        onClose={() => setBatchModalTarget(null)}
        onBatchStatusUpdated={() => fetchDashboard(appliedFilters)}
        onInspectUnit={(sn) => setReviewInspectionTarget(sn)}
      />

      {/* Operator Unit Review & Disposition Modal */}
      <InspectionReviewModal
        inspectionIdOrSerial={reviewInspectionTarget}
        onClose={() => setReviewInspectionTarget(null)}
        onReviewSaved={() => fetchDashboard(appliedFilters)}
      />

      {/* AOI Quality Agent & PostgreSQL RAG Modal */}
      <AgentAssistantModal
        open={agentModalOpen}
        onClose={() => setAgentModalOpen(false)}
        boardModelCode={dashboard?.header.boardModelCode || appliedFilters.boardModel}
        boardDisplayName={dashboard?.header.boardDisplayName || appliedFilters.boardModel}
        batchKey={appliedFilters.batchKey}
        defectType={appliedFilters.defectType}
        aiInsight={dashboard?.aiInsight || null}
      />
    </div>
  );
}
