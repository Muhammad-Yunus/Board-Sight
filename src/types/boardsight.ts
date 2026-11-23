export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
}

export interface BoardModelOption {
  id: number;
  code: string;
  displayName: string;
  pcbImageUrl: string;
  description: string | null;
}

export interface BatchOption {
  id: number;
  key: string;
  label: string;
  batchCode: string;
  shift: string;
  line: string;
  shiftDate: string;
}

export interface DefectCluster {
  index: number;
  componentRef: string;
  defectType: string;
  severity: string;
  posX: number;
  posY: number;
  count: number;
  lastSeen: string;
  rootCause: string;
  correctiveAction: string;
}

export interface DefectFrequencyItem {
  defectType: string;
  count: number;
  color: string;
}

export interface DefectShareItem extends DefectFrequencyItem {
  sharePct: number;
}

export interface RootCauseItem {
  rootCause: string;
  primaryDefectType: string;
  count: number;
  sharePct: number;
  severity: string;
  severityScore: number;
  affectedComponents: string[];
  correctiveAction: string;
  lastSeen: string;
}

export interface AiInsightData {
  id: number;
  boardModelId: number | null;
  batchId: number | null;
  headline: string;
  recommendation: string;
  targetBatchCode: string;
  forecastDelta: string;
  analysisDetail: string;
  provider?: string | null;
  modelUsed?: string | null;
  toolsUsed?: string | null;
  createdAt: string;
}

export interface BatchSummaryItem {
  id: number;
  batchCode: string;
  shift: string;
  line: string;
  shiftDate: string;
  totalInspected: number;
  defectiveBoards: number;
  defectRatePct: number;
  yieldPct: number;
  status: string;
}

export interface RecentInspectionItem {
  id: number;
  serialNumber: string;
  batchCode: string;
  shift: string;
  line: string;
  operatorName: string;
  status: string;
  stationId: string;
  source: string;
  reviewStatus: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  hasScanImage: boolean;
  defectCount: number;
  primaryDefect: string;
  inspectedAt: string;
}

export interface UnitDefectRecord {
  id: number;
  inspectionId: number;
  defectType: string;
  componentRef: string;
  severity: string;
  posX: number;
  posY: number;
  rootCause: string;
  correctiveAction: string;
  confidence: number;
  reviewStatus: 'OPEN' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'REPAIRED';
  reviewedBy: string | null;
  reviewedAt: string | null;
  detectedAt: string;
}

export interface UnitInspectionDetail {
  inspection: {
    id: number;
    serialNumber: string;
    boardModelId: number;
    boardModelCode: string;
    boardDisplayName: string;
    displayImageUrl: string;
    scanImageUrl: string | null;
    batchId: number;
    batchCode: string;
    shift: string;
    line: string;
    operatorName: string;
    status: 'PASS' | 'FAIL';
    stationId: string;
    source: string;
    reviewStatus:
      | 'PENDING_REVIEW'
      | 'CONFIRMED_FAIL'
      | 'FALSE_CALL'
      | 'REWORKED'
      | 'SCRAPPED'
      | 'PASS_VERIFIED';
    reviewedBy: string | null;
    reviewedAt: string | null;
    reviewNotes: string | null;
    inspectedAt: string;
  };
  defects: UnitDefectRecord[];
}

export interface DashboardData {
  header: {
    boardModelId: number | null;
    boardModelCode: string;
    boardDisplayName: string;
    pcbImageUrl: string;
    latestInspectionId: number | null;
    serialNumber: string;
    inspectionStatus: string;
    reviewStatus: string;
    updatedTime: string;
  };
  filterOptions: {
    boardModels: BoardModelOption[];
    batches: BatchOption[];
    defectTypes: string[];
    operators: string[];
  };
  kpis: {
    defectiveBoardsPct: number;
    totalDefects: number;
    avgDefectsPerBoard: number;
    worstShift: string;
    mostFrequentDefect: string;
    totalInspected: number;
    defectiveBoardsCount: number;
    pendingReviewCount: number;
  };
  defectMap: DefectCluster[];
  defectFrequency: DefectFrequencyItem[];
  defectShare: DefectShareItem[];
  rootCauses: RootCauseItem[];
  aiInsight: AiInsightData | null;
  batches: BatchSummaryItem[];
  recentInspections: RecentInspectionItem[];
}

export interface DashboardFilters {
  periodKey: string;
  startDate: string;
  endDate: string;
  boardModel: string;
  batchKey: string;
  defectType: string;
  operator: string;
  sortRootCause: 'frequency' | 'severity' | 'recent';
}
