import { Router, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  users,
  sessions,
  apiKeys,
  boardModels,
  batches,
  inspections,
  defects,
  aiInsights,
  knowledgeDocs,
} from '../src/db/schema.ts';
import {
  type AuthenticatedRequest,
  clearLoginFailures,
  clearSessionCookie,
  createSession,
  generateRawApiKey,
  hashPassword,
  isLoginRateLimited,
  recordLoginFailure,
  requireAuth,
  requireAuthOrApiKey,
  resolveUserFromRequest,
  setSessionCookie,
  verifyPassword,
} from './auth.ts';
import {
  askBoardSightAgent,
  getAiProviderStatus,
  inspectPcbImageWithAi,
  runBoardSightAgentAnalysis,
} from './aiAgent.ts';

const router = Router();

const CANONICAL_DEFECT_TYPES = [
  'Missing Component',
  'Solder Bridge',
  'Misalignment',
  'Short Circuit',
  'Wrong Polarity',
] as const;

const DEFECT_COLORS: Record<string, string> = {
  'Missing Component': '#F7C927',
  'Solder Bridge': '#F85E5E',
  Misalignment: '#5EC96B',
  'Short Circuit': '#F85E5E',
  'Wrong Polarity': '#5EC96B',
};

function formatDateDot(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatShiftDateShort(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDate();
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${day} ${month}`;
}

function formatTimeHHMM(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Auth Routes
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Valid work email is required').toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  role: z.enum(['Operator', 'QA Engineer', 'Admin']).optional().default('Operator'),
});

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
});

router.post('/auth/register', async (req, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data' });
      return;
    }

    const { name, email, password, role } = parsed.data;
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(users)
      .values({
        name,
        email,
        passwordHash,
        role,
        avatarUrl: null,
      })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        avatarUrl: users.avatarUrl,
      });

    const { token, expiresAt } = await createSession(created.id);
    setSessionCookie(res, token, expiresAt, req);

    res.status(201).json({ user: created, token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

router.post('/auth/login', async (req, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credentials' });
      return;
    }

    const identifier = parsed.data.email.trim().toLowerCase();
    const rateKey = `${req.ip || 'unknown'}:${identifier}`;
    if (isLoginRateLimited(rateKey)) {
      res.status(429).json({ error: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.' });
      return;
    }

    const { password } = parsed.data;
    const [userRow] = await db
      .select()
      .from(users)
      .where(
        or(
          sql`lower(${users.email}) = ${identifier}`,
          sql`lower(${users.name}) = ${identifier}`
        )
      )
      .limit(1);

    if (!userRow) {
      recordLoginFailure(rateKey);
      res.status(401).json({ error: 'Invalid email/username or password.' });
      return;
    }

    const valid = await verifyPassword(password, userRow.passwordHash);
    if (!valid) {
      recordLoginFailure(rateKey);
      res.status(401).json({ error: 'Invalid email/username or password.' });
      return;
    }

    clearLoginFailures(rateKey);
    const { token, expiresAt } = await createSession(userRow.id);
    setSessionCookie(res, token, expiresAt, req);

    res.json({
      user: {
        id: userRow.id,
        name: userRow.name,
        email: userRow.email,
        role: userRow.role,
        avatarUrl: userRow.avatarUrl,
      },
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to sign in.' });
  }
});

router.post('/auth/logout', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await resolveUserFromRequest(req);
    if (req.sessionId) {
      await db.delete(sessions).where(eq(sessions.id, req.sessionId));
    }
    clearSessionCookie(res, req);
    res.json({ ok: true });
  } catch (err) {
    console.error('Logout error:', err);
    clearSessionCookie(res, req);
    res.json({ ok: true });
  }
});

router.get('/auth/me', async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({ user });
});

// ---------------------------------------------------------------------------
// AOI API Keys Management (for authentic machine ingestion)
// ---------------------------------------------------------------------------

router.get('/auth/api-keys', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, req.user!.id))
      .orderBy(desc(apiKeys.createdAt));

    res.json({ keys });
  } catch (err) {
    console.error('List API keys error:', err);
    res.status(500).json({ error: 'Failed to fetch API keys.' });
  }
});

router.post('/auth/api-keys', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schema = z.object({ name: z.string().trim().min(2).max(60) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid station/key name is required.' });
      return;
    }

    const { rawKey, prefix, hash } = generateRawApiKey();
    const [created] = await db
      .insert(apiKeys)
      .values({
        name: parsed.data.name,
        keyPrefix: prefix,
        keyHash: hash,
        userId: req.user!.id,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
      });

    res.status(201).json({ key: created, rawKey });
  } catch (err) {
    console.error('Create API key error:', err);
    res.status(500).json({ error: 'Failed to generate AOI API key.' });
  }
});

router.delete('/auth/api-keys/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid API key ID' });
      return;
    }
    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, req.user!.id)));
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete API key error:', err);
    res.status(500).json({ error: 'Failed to revoke API key.' });
  }
});

// ---------------------------------------------------------------------------
// Dashboard Query Helper
// ---------------------------------------------------------------------------

interface FilterParams {
  startDate: string;
  endDate: string;
  boardModel: string;
  batchKey: string;
  defectType: string;
  operator: string;
  sortRootCause: string;
}

async function computeDashboardPayload(filters: FilterParams) {
  const allModels = await db.select().from(boardModels).orderBy(boardModels.id);
  const activeModel =
    allModels.find((m) => m.code === filters.boardModel) || allModels[0];

  const allBatches = await db
    .select({
      id: batches.id,
      batchCode: batches.batchCode,
      shift: batches.shift,
      line: batches.line,
      shiftDate: batches.shiftDate,
      boardModelId: batches.boardModelId,
      totalInspected: batches.totalInspected,
      defectiveBoards: batches.defectiveBoards,
      status: batches.status,
      boardModelCode: boardModels.code,
    })
    .from(batches)
    .innerJoin(boardModels, eq(batches.boardModelId, boardModels.id))
    .orderBy(batches.batchCode, batches.shift);

  const operatorRows = await db
    .selectDistinct({ operatorName: inspections.operatorName })
    .from(inspections)
    .orderBy(inspections.operatorName);

  // Filter batches matching boardModel + date range + batchKey
  const startDt = filters.startDate ? new Date(`${filters.startDate}T00:00:00Z`) : null;
  const endDt = filters.endDate ? new Date(`${filters.endDate}T23:59:59.999Z`) : null;

  let selectedBatchObj: (typeof allBatches)[number] | undefined;
  if (filters.batchKey && filters.batchKey !== 'ALL') {
    const [bCode, bShift, bLine] = filters.batchKey.split('|');
    selectedBatchObj = allBatches.find(
      (b) =>
        b.batchCode === bCode &&
        b.shift === bShift &&
        b.line === bLine &&
        (!activeModel || b.boardModelId === activeModel.id)
    );
  }

  const matchingBatches = allBatches.filter((b) => {
    if (activeModel && b.boardModelId !== activeModel.id) return false;
    if (selectedBatchObj && b.id !== selectedBatchObj.id) return false;
    if (filters.startDate && b.shiftDate < filters.startDate) return false;
    if (filters.endDate && b.shiftDate > filters.endDate) return false;
    return true;
  });

  // Query inspections & defects matching filters
  const inspConditions = [];
  if (activeModel) {
    inspConditions.push(eq(inspections.boardModelId, activeModel.id));
  }
  if (selectedBatchObj) {
    inspConditions.push(eq(inspections.batchId, selectedBatchObj.id));
  }
  if (filters.operator && filters.operator !== 'ALL') {
    inspConditions.push(eq(inspections.operatorName, filters.operator));
  }
  if (startDt && !Number.isNaN(startDt.getTime())) {
    inspConditions.push(gte(inspections.inspectedAt, startDt));
  }
  if (endDt && !Number.isNaN(endDt.getTime())) {
    inspConditions.push(lte(inspections.inspectedAt, endDt));
  }

  const matchedInspections = await db
    .select({
      id: inspections.id,
      serialNumber: inspections.serialNumber,
      boardModelId: inspections.boardModelId,
      batchId: inspections.batchId,
      operatorName: inspections.operatorName,
      status: inspections.status,
      stationId: inspections.stationId,
      source: inspections.source,
      scanImageUrl: inspections.scanImageUrl,
      reviewStatus: inspections.reviewStatus,
      reviewedBy: inspections.reviewedBy,
      reviewedAt: inspections.reviewedAt,
      reviewNotes: inspections.reviewNotes,
      inspectedAt: inspections.inspectedAt,
      batchCode: batches.batchCode,
      shift: batches.shift,
      line: batches.line,
    })
    .from(inspections)
    .innerJoin(batches, eq(inspections.batchId, batches.id))
    .where(inspConditions.length > 0 ? and(...inspConditions) : undefined)
    .orderBy(desc(inspections.inspectedAt));

  const defectConditions = [
    ...inspConditions,
    ne(defects.reviewStatus, 'FALSE_POSITIVE'),
  ];
  if (filters.defectType && filters.defectType !== 'ALL') {
    defectConditions.push(eq(defects.defectType, filters.defectType));
  }

  const matchedDefects = await db
    .select({
      id: defects.id,
      inspectionId: defects.inspectionId,
      defectType: defects.defectType,
      componentRef: defects.componentRef,
      severity: defects.severity,
      posX: defects.posX,
      posY: defects.posY,
      rootCause: defects.rootCause,
      correctiveAction: defects.correctiveAction,
      confidence: defects.confidence,
      reviewStatus: defects.reviewStatus,
      detectedAt: defects.detectedAt,
      serialNumber: inspections.serialNumber,
      operatorName: inspections.operatorName,
      batchCode: batches.batchCode,
      shift: batches.shift,
      line: batches.line,
    })
    .from(defects)
    .innerJoin(inspections, eq(defects.inspectionId, inspections.id))
    .innerJoin(batches, eq(inspections.batchId, batches.id))
    .where(and(...defectConditions))
    .orderBy(desc(defects.detectedAt));

  // KPI calculations strictly from PostgreSQL rows
  const totalInspectedFromBatches = matchingBatches.reduce(
    (acc, b) => acc + b.totalInspected,
    0
  );
  const totalDefectiveFromBatches = matchingBatches.reduce(
    (acc, b) => acc + b.defectiveBoards,
    0
  );

  // If operator or defectType filter is active, count unique defective inspections matching
  const uniqueDefectiveInspectionIds = new Set(
    matchedDefects.map((d) => d.inspectionId)
  );
  const effectiveDefectiveCount =
    filters.operator !== 'ALL' || filters.defectType !== 'ALL'
      ? uniqueDefectiveInspectionIds.size
      : totalDefectiveFromBatches ||
        matchedInspections.filter((i) => i.status === 'FAIL').length;

  const effectiveTotalInspected = Math.max(
    totalInspectedFromBatches,
    matchedInspections.length
  );

  const defectiveRatePct =
    effectiveTotalInspected > 0
      ? Number(((effectiveDefectiveCount / effectiveTotalInspected) * 100).toFixed(1))
      : 0;

  const totalDefectsCount = matchedDefects.length;

  const avgDefectsPerBoard =
    effectiveDefectiveCount > 0
      ? Number((totalDefectsCount / effectiveDefectiveCount).toFixed(1))
      : 0;

  // Worst Shift calculation
  let worstShiftLabel = 'No Shift Data';
  if (matchingBatches.length > 0) {
    const worst = [...matchingBatches].sort((a, b) => {
      const rateA = a.totalInspected > 0 ? a.defectiveBoards / a.totalInspected : 0;
      const rateB = b.totalInspected > 0 ? b.defectiveBoards / b.totalInspected : 0;
      return rateB - rateA;
    })[0];
    worstShiftLabel = `Shift ${worst.shift} – ${formatShiftDateShort(worst.shiftDate)}`;
  }

  // Cluster defects by (componentRef, defectType) for PCB Defect Map & Most Frequent Defect
  const clusterMap = new Map<
    string,
    {
      componentRef: string;
      defectType: string;
      severity: string;
      posX: number;
      posY: number;
      count: number;
      lastSeenDate: Date;
      rootCause: string;
      correctiveAction: string;
    }
  >();

  for (const d of matchedDefects) {
    const key = `${d.componentRef}::${d.defectType}`;
    const existing = clusterMap.get(key);
    if (!existing) {
      clusterMap.set(key, {
        componentRef: d.componentRef,
        defectType: d.defectType,
        severity: d.severity,
        posX: d.posX,
        posY: d.posY,
        count: 1,
        lastSeenDate: new Date(d.detectedAt),
        rootCause: d.rootCause,
        correctiveAction: d.correctiveAction,
      });
    } else {
      existing.count += 1;
      const dt = new Date(d.detectedAt);
      if (dt > existing.lastSeenDate) {
        existing.lastSeenDate = dt;
      }
      if (d.severity === 'CRITICAL') {
        existing.severity = 'CRITICAL';
      }
    }
  }

  const defectClusters = Array.from(clusterMap.values())
    .sort((a, b) => b.count - a.count)
    .map((c, idx) => ({
      index: idx + 1,
      componentRef: c.componentRef,
      defectType: c.defectType,
      severity: c.severity,
      posX: c.posX,
      posY: c.posY,
      count: c.count,
      lastSeen: formatDateDot(c.lastSeenDate),
      rootCause: c.rootCause,
      correctiveAction: c.correctiveAction,
    }));

  // Most Frequent Defect KPI (prefer Missing Component (C9) or highest cluster)
  let mostFrequentDefect = 'None';
  if (defectClusters.length > 0) {
    // Check highest count cluster, tie-break cleanly
    const topCluster = defectClusters[0];
    mostFrequentDefect = `${topCluster.defectType} (${topCluster.componentRef})`;
  }

  // Defect Type Frequency (always preserve the 5 canonical defect types)
  const typeCountMap = new Map<string, number>();
  for (const t of CANONICAL_DEFECT_TYPES) typeCountMap.set(t, 0);
  for (const d of matchedDefects) {
    typeCountMap.set(d.defectType, (typeCountMap.get(d.defectType) ?? 0) + 1);
  }

  const defectFrequency = CANONICAL_DEFECT_TYPES.map((defectType) => ({
    defectType,
    count: typeCountMap.get(defectType) ?? 0,
    color: DEFECT_COLORS[defectType] || '#5EC96B',
  }));

  const defectShare = defectFrequency
    .map((item) => ({
      ...item,
      sharePct:
        totalDefectsCount > 0
          ? Number(((item.count / totalDefectsCount) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Root Cause Breakdown aggregation
  const rcMap = new Map<
    string,
    {
      rootCause: string;
      primaryDefectType: string;
      count: number;
      severityScore: number;
      severity: string;
      components: Set<string>;
      correctiveAction: string;
      lastSeenDate: Date;
    }
  >();

  for (const d of matchedDefects) {
    const existing = rcMap.get(d.rootCause);
    const sevWeight = d.severity === 'CRITICAL' ? 2 : 1;
    if (!existing) {
      rcMap.set(d.rootCause, {
        rootCause: d.rootCause,
        primaryDefectType: d.defectType,
        count: 1,
        severityScore: sevWeight,
        severity: d.severity,
        components: new Set([d.componentRef]),
        correctiveAction: d.correctiveAction,
        lastSeenDate: new Date(d.detectedAt),
      });
    } else {
      existing.count += 1;
      existing.severityScore += sevWeight;
      if (d.severity === 'CRITICAL') existing.severity = 'CRITICAL';
      existing.components.add(d.componentRef);
      const dt = new Date(d.detectedAt);
      if (dt > existing.lastSeenDate) existing.lastSeenDate = dt;
    }
  }

  const rootCauses = Array.from(rcMap.values()).map((rc) => ({
    rootCause: rc.rootCause,
    primaryDefectType: rc.primaryDefectType,
    count: rc.count,
    sharePct:
      totalDefectsCount > 0
        ? Number(((rc.count / totalDefectsCount) * 100).toFixed(1))
        : 0,
    severity: rc.severity,
    severityScore: rc.severityScore,
    affectedComponents: Array.from(rc.components),
    correctiveAction: rc.correctiveAction,
    lastSeen: formatDateDot(rc.lastSeenDate),
    lastSeenTs: rc.lastSeenDate.getTime(),
  }));

  if (filters.sortRootCause === 'severity') {
    rootCauses.sort((a, b) => b.severityScore - a.severityScore || b.count - a.count);
  } else if (filters.sortRootCause === 'recent') {
    rootCauses.sort((a, b) => b.lastSeenTs - a.lastSeenTs);
  } else {
    rootCauses.sort((a, b) => b.count - a.count);
  }

  // Latest AI insight matching active filter signature first, else model baseline
  const activeSignature = `${activeModel?.code ?? ''}|${filters.batchKey}|${filters.defectType}|${filters.operator}`;
  const modelInsights = activeModel
    ? await db
        .select()
        .from(aiInsights)
        .where(eq(aiInsights.boardModelId, activeModel.id))
        .orderBy(desc(aiInsights.createdAt))
        .limit(20)
    : [];

  const latestInsight =
    modelInsights.find((ins) => ins.filterSignature === activeSignature) ||
    modelInsights.find((ins) => !ins.filterSignature) ||
    modelInsights[0];

  // Latest inspection for header (strictly ordered by inspectedAt DESC)
  const heroInspection = matchedInspections[0] ?? null;

  const batchDetails = matchingBatches.map((b) => ({
    id: b.id,
    batchCode: b.batchCode,
    shift: b.shift,
    line: b.line,
    shiftDate: b.shiftDate,
    totalInspected: b.totalInspected,
    defectiveBoards: b.defectiveBoards,
    defectRatePct:
      b.totalInspected > 0
        ? Number(((b.defectiveBoards / b.totalInspected) * 100).toFixed(1))
        : 0,
    yieldPct:
      b.totalInspected > 0
        ? Number((((b.totalInspected - b.defectiveBoards) / b.totalInspected) * 100).toFixed(1))
        : 100,
    status: b.status,
  }));

  // Map recent inspections with defect count
  const defectCountByInspection = new Map<number, number>();
  const primaryDefectByInspection = new Map<number, string>();
  for (const d of matchedDefects) {
    defectCountByInspection.set(
      d.inspectionId,
      (defectCountByInspection.get(d.inspectionId) ?? 0) + 1
    );
    if (!primaryDefectByInspection.has(d.inspectionId)) {
      primaryDefectByInspection.set(
        d.inspectionId,
        `${d.defectType} (${d.componentRef})`
      );
    }
  }

  const recentInspections = matchedInspections.slice(0, 50).map((insp) => ({
    id: insp.id,
    serialNumber: insp.serialNumber,
    batchCode: insp.batchCode,
    shift: insp.shift,
    line: insp.line,
    operatorName: insp.operatorName,
    status: insp.status,
    stationId: insp.stationId,
    source: insp.source,
    reviewStatus: insp.reviewStatus,
    reviewedBy: insp.reviewedBy,
    reviewedAt: insp.reviewedAt,
    hasScanImage: Boolean(insp.scanImageUrl),
    defectCount: defectCountByInspection.get(insp.id) ?? 0,
    primaryDefect: primaryDefectByInspection.get(insp.id) ?? 'None',
    inspectedAt: insp.inspectedAt,
  }));

  const pendingReviewCount = matchedInspections.filter(
    (i) => i.reviewStatus === 'PENDING_REVIEW'
  ).length;

  return {
    header: {
      boardModelId: activeModel?.id ?? null,
      boardModelCode: activeModel?.code ?? '',
      boardDisplayName: activeModel?.displayName ?? 'No Board Model',
      pcbImageUrl: activeModel?.pcbImageUrl ?? '',
      latestInspectionId: heroInspection?.id ?? null,
      serialNumber: heroInspection?.serialNumber ?? 'No Records',
      inspectionStatus: heroInspection?.status ?? 'PASS',
      reviewStatus: heroInspection?.reviewStatus ?? 'PASS_VERIFIED',
      updatedTime: heroInspection ? formatTimeHHMM(heroInspection.inspectedAt) : '—',
    },
    filterOptions: {
      boardModels: allModels,
      batches: allBatches
        .filter((b) => !activeModel || b.boardModelId === activeModel.id)
        .map((b) => ({
          id: b.id,
          key: `${b.batchCode}|${b.shift}|${b.line}`,
          label: `Batch: ${b.batchCode} / Shift: ${b.shift} / Line: ${b.line}`,
          batchCode: b.batchCode,
          shift: b.shift,
          line: b.line,
          shiftDate: b.shiftDate,
        })),
      defectTypes: [...CANONICAL_DEFECT_TYPES],
      operators: operatorRows.map((o) => o.operatorName),
    },
    kpis: {
      defectiveBoardsPct: defectiveRatePct,
      totalDefects: totalDefectsCount,
      avgDefectsPerBoard,
      worstShift: worstShiftLabel,
      mostFrequentDefect,
      totalInspected: effectiveTotalInspected,
      defectiveBoardsCount: effectiveDefectiveCount,
      pendingReviewCount,
    },
    defectMap: defectClusters,
    defectFrequency,
    defectShare,
    rootCauses,
    aiInsight: latestInsight || null,
    batches: batchDetails,
    recentInspections,
    matchedDefectsExport: matchedDefects,
  };
}

// ---------------------------------------------------------------------------
// Dashboard & Analytics Routes
// ---------------------------------------------------------------------------

router.get('/dashboard', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filters: FilterParams = {
      startDate: String(req.query.startDate || '2025-05-01'),
      endDate: String(req.query.endDate || '2025-05-25'),
      boardModel: String(req.query.boardModel || 'Model X12'),
      batchKey: String(req.query.batchKey || 'ALL'),
      defectType: String(req.query.defectType || 'ALL'),
      operator: String(req.query.operator || 'ALL'),
      sortRootCause: String(req.query.sortRootCause || 'frequency'),
    };

    const payload = await computeDashboardPayload(filters);
    const { matchedDefectsExport: _omit, ...publicPayload } = payload;
    res.json(publicPayload);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load inspection analytics from PostgreSQL.' });
  }
});

router.get('/inspections/export', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filters: FilterParams = {
      startDate: String(req.query.startDate || '2025-05-01'),
      endDate: String(req.query.endDate || '2025-05-25'),
      boardModel: String(req.query.boardModel || 'Model X12'),
      batchKey: String(req.query.batchKey || 'ALL'),
      defectType: String(req.query.defectType || 'ALL'),
      operator: String(req.query.operator || 'ALL'),
      sortRootCause: 'frequency',
    };

    const payload = await computeDashboardPayload(filters);
    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };

    const headers = [
      'SerialNumber',
      'BoardModel',
      'BatchCode',
      'Shift',
      'Line',
      'Operator',
      'DefectType',
      'ComponentRef',
      'Severity',
      'PosX',
      'PosY',
      'RootCause',
      'CorrectiveAction',
      'DetectedAt',
    ];

    const lines = [headers.join(',')];
    for (const row of payload.matchedDefectsExport) {
      lines.push(
        [
          row.serialNumber,
          payload.header.boardModelCode,
          row.batchCode,
          row.shift,
          row.line,
          row.operatorName,
          row.defectType,
          row.componentRef,
          row.severity,
          row.posX,
          row.posY,
          row.rootCause,
          row.correctiveAction,
          new Date(row.detectedAt).toISOString(),
        ]
          .map(escapeCsv)
          .join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="boardsight-${payload.header.boardModelCode.replace(/\s+/g, '-')}-defects.csv"`
    );
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('Export CSV error:', err);
    res.status(500).json({ error: 'Failed to export CSV.' });
  }
});

router.get('/batches/:batchCode', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const batchCode = String(req.params.batchCode);
    const boardModelFilter = req.query.boardModel ? String(req.query.boardModel) : null;
    const batchIdParam = req.query.batchId ? Number(req.query.batchId) : null;

    const conditions = [eq(batches.batchCode, batchCode)];
    if (boardModelFilter) {
      conditions.push(eq(boardModels.code, boardModelFilter));
    }
    if (batchIdParam && Number.isInteger(batchIdParam)) {
      conditions.push(eq(batches.id, batchIdParam));
    }

    const batchRows = await db
      .select({
        id: batches.id,
        batchCode: batches.batchCode,
        shift: batches.shift,
        line: batches.line,
        shiftDate: batches.shiftDate,
        totalInspected: batches.totalInspected,
        defectiveBoards: batches.defectiveBoards,
        status: batches.status,
        boardModelCode: boardModels.code,
        boardDisplayName: boardModels.displayName,
      })
      .from(batches)
      .innerJoin(boardModels, eq(batches.boardModelId, boardModels.id))
      .where(and(...conditions));

    if (batchRows.length === 0) {
      res.status(404).json({ error: `Batch ${batchCode} not found.` });
      return;
    }

    const batch = batchRows[0];
    const batchDefects = await db
      .select({
        defectType: defects.defectType,
        componentRef: defects.componentRef,
        severity: defects.severity,
        rootCause: defects.rootCause,
        correctiveAction: defects.correctiveAction,
        reviewStatus: defects.reviewStatus,
        serialNumber: inspections.serialNumber,
        inspectionId: inspections.id,
        detectedAt: defects.detectedAt,
      })
      .from(defects)
      .innerJoin(inspections, eq(defects.inspectionId, inspections.id))
      .where(
        and(eq(inspections.batchId, batch.id), ne(defects.reviewStatus, 'FALSE_POSITIVE'))
      )
      .orderBy(desc(defects.detectedAt));

    const summaryMap = new Map<string, number>();
    for (const d of batchDefects) {
      summaryMap.set(d.defectType, (summaryMap.get(d.defectType) ?? 0) + 1);
    }

    res.json({
      batch: {
        ...batch,
        defectRatePct:
          batch.totalInspected > 0
            ? Number(((batch.defectiveBoards / batch.totalInspected) * 100).toFixed(1))
            : 0,
        yieldPct:
          batch.totalInspected > 0
            ? Number(
                (((batch.totalInspected - batch.defectiveBoards) / batch.totalInspected) * 100).toFixed(1)
              )
            : 100,
      },
      defectSummary: Array.from(summaryMap.entries()).map(([defectType, count]) => ({
        defectType,
        count,
      })),
      recentDefects: batchDefects.slice(0, 20),
    });
  } catch (err) {
    console.error('Batch details error:', err);
    res.status(500).json({ error: 'Failed to load batch details.' });
  }
});

router.patch('/batches/:id/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid batch ID.' });
      return;
    }

    const schema = z.object({
      status: z.enum(['ACTIVE', 'HOLD_REVIEW', 'RELEASED']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid batch status.' });
      return;
    }

    const nextStatus = parsed.data.status;
    // Releasing a held batch requires QA Engineer or Admin; Operators can escalate to HOLD_REVIEW
    if (nextStatus === 'RELEASED' && !['QA Engineer', 'Admin'].includes(req.user!.role)) {
      res.status(403).json({
        error: `Releasing a batch requires QA Engineer or Admin role (current role: ${req.user!.role}).`,
      });
      return;
    }

    const [updated] = await db
      .update(batches)
      .set({ status: nextStatus })
      .where(eq(batches.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Batch not found.' });
      return;
    }

    res.json({ batch: updated });
  } catch (err) {
    console.error('Update batch status error:', err);
    res.status(500).json({ error: 'Failed to update batch status.' });
  }
});

// ---------------------------------------------------------------------------
// Board Model Design Upload & Management Routes
// ---------------------------------------------------------------------------

const pcbImageUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(6_500_000)
  .refine(
    (val) =>
      val.startsWith('/src/') ||
      val.startsWith('/assets/') ||
      /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(val),
    'PCB image must be a valid PNG, JPEG, or WebP upload or asset path.'
  );

router.post('/board-models', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schema = z.object({
      code: z.string().trim().min(2).max(40),
      displayName: z.string().trim().min(2).max(80),
      pcbImageUrl: pcbImageUrlSchema,
      description: z.string().trim().max(260).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid board model data.' });
      return;
    }

    const [existing] = await db
      .select({ id: boardModels.id })
      .from(boardModels)
      .where(sql`lower(${boardModels.code}) = ${parsed.data.code.toLowerCase()}`)
      .limit(1);

    if (existing) {
      res.status(409).json({ error: `Board model code "${parsed.data.code}" already exists.` });
      return;
    }

    const [created] = await db
      .insert(boardModels)
      .values({
        code: parsed.data.code,
        displayName: parsed.data.displayName,
        pcbImageUrl: parsed.data.pcbImageUrl,
        description: parsed.data.description || 'Registered PCB layout revision',
      })
      .returning();

    res.status(201).json({ boardModel: created });
  } catch (err) {
    console.error('Create board model error:', err);
    res.status(500).json({ error: 'Failed to register board model.' });
  }
});

router.patch('/board-models/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid board model ID.' });
      return;
    }

    const schema = z.object({
      displayName: z.string().trim().min(2).max(80).optional(),
      pcbImageUrl: pcbImageUrlSchema.optional(),
      description: z.string().trim().max(260).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update payload.' });
      return;
    }

    const updates: Partial<typeof boardModels.$inferInsert> = {};
    if (parsed.data.displayName !== undefined) updates.displayName = parsed.data.displayName;
    if (parsed.data.pcbImageUrl !== undefined) updates.pcbImageUrl = parsed.data.pcbImageUrl;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;

    const [updated] = await db
      .update(boardModels)
      .set(updates)
      .where(eq(boardModels.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Board model not found.' });
      return;
    }

    res.json({ boardModel: updated });
  } catch (err) {
    console.error('Update board model error:', err);
    res.status(500).json({ error: 'Failed to update board model.' });
  }
});

// ---------------------------------------------------------------------------
// Gemini Vision Optical PCB Scan Processing
// ---------------------------------------------------------------------------

router.post('/inspections/analyze-image', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schema = z.object({
      imageDataUrl: pcbImageUrlSchema,
      boardModelCode: z.string().trim().min(1).max(40).default('Model X12'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Valid PCB image is required.' });
      return;
    }

    const [model] = await db
      .select()
      .from(boardModels)
      .where(eq(boardModels.code, parsed.data.boardModelCode))
      .limit(1);

    const result = await inspectPcbImageWithAi({
      imageDataUrl: parsed.data.imageDataUrl,
      boardModelCode: parsed.data.boardModelCode,
      boardDisplayName: model?.displayName || parsed.data.boardModelCode,
    });

    res.json(result);
  } catch (err) {
    console.error('Vision inspection error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Optical image inspection failed.',
    });
  }
});

// ---------------------------------------------------------------------------
// Operator Unit Inspection Queue & Review Workflow
// ---------------------------------------------------------------------------

router.get('/inspections', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const boardModel = req.query.boardModel ? String(req.query.boardModel) : null;
    const reviewStatus = req.query.reviewStatus ? String(req.query.reviewStatus) : 'ALL';
    const search = req.query.search ? String(req.query.search).trim() : '';

    const conditions = [];
    if (boardModel && boardModel !== 'ALL') {
      conditions.push(eq(boardModels.code, boardModel));
    }
    if (reviewStatus && reviewStatus !== 'ALL') {
      conditions.push(eq(inspections.reviewStatus, reviewStatus));
    }
    if (search) {
      conditions.push(sql`lower(${inspections.serialNumber}) LIKE ${`%${search.toLowerCase()}%`}`);
    }

    const rows = await db
      .select({
        id: inspections.id,
        serialNumber: inspections.serialNumber,
        boardModelCode: boardModels.code,
        boardDisplayName: boardModels.displayName,
        batchCode: batches.batchCode,
        shift: batches.shift,
        line: batches.line,
        operatorName: inspections.operatorName,
        status: inspections.status,
        stationId: inspections.stationId,
        source: inspections.source,
        reviewStatus: inspections.reviewStatus,
        reviewedBy: inspections.reviewedBy,
        reviewedAt: inspections.reviewedAt,
        hasScanImage: sql<boolean>`(${inspections.scanImageUrl} IS NOT NULL)`,
        inspectedAt: inspections.inspectedAt,
      })
      .from(inspections)
      .innerJoin(boardModels, eq(inspections.boardModelId, boardModels.id))
      .innerJoin(batches, eq(inspections.batchId, batches.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(inspections.inspectedAt))
      .limit(100);

    res.json({ inspections: rows });
  } catch (err) {
    console.error('List inspections error:', err);
    res.status(500).json({ error: 'Failed to load inspection review queue.' });
  }
});

router.get('/inspections/:idOrSerial', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const param = String(req.params.idOrSerial);
    const numericId = /^\d+$/.test(param) ? Number(param) : null;

    const [row] = await db
      .select({
        id: inspections.id,
        serialNumber: inspections.serialNumber,
        boardModelId: inspections.boardModelId,
        boardModelCode: boardModels.code,
        boardDisplayName: boardModels.displayName,
        modelPcbImageUrl: boardModels.pcbImageUrl,
        batchId: inspections.batchId,
        batchCode: batches.batchCode,
        shift: batches.shift,
        line: batches.line,
        operatorName: inspections.operatorName,
        status: inspections.status,
        stationId: inspections.stationId,
        source: inspections.source,
        scanImageUrl: inspections.scanImageUrl,
        reviewStatus: inspections.reviewStatus,
        reviewedBy: inspections.reviewedBy,
        reviewedAt: inspections.reviewedAt,
        reviewNotes: inspections.reviewNotes,
        inspectedAt: inspections.inspectedAt,
      })
      .from(inspections)
      .innerJoin(boardModels, eq(inspections.boardModelId, boardModels.id))
      .innerJoin(batches, eq(inspections.batchId, batches.id))
      .where(
        numericId !== null
          ? eq(inspections.id, numericId)
          : eq(inspections.serialNumber, param)
      )
      .limit(1);

    if (!row) {
      res.status(404).json({ error: 'Inspection record not found.' });
      return;
    }

    const unitDefects = await db
      .select()
      .from(defects)
      .where(eq(defects.inspectionId, row.id))
      .orderBy(defects.id);

    res.json({
      inspection: {
        ...row,
        displayImageUrl: row.scanImageUrl || row.modelPcbImageUrl,
      },
      defects: unitDefects,
    });
  } catch (err) {
    console.error('Get inspection detail error:', err);
    res.status(500).json({ error: 'Failed to load unit inspection details.' });
  }
});

router.patch('/inspections/:id/review', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid inspection ID.' });
      return;
    }

    const schema = z.object({
      reviewStatus: z.enum([
        'PENDING_REVIEW',
        'CONFIRMED_FAIL',
        'FALSE_CALL',
        'REWORKED',
        'SCRAPPED',
        'PASS_VERIFIED',
      ]),
      reviewNotes: z.string().trim().max(500).optional().default(''),
      defectUpdates: z
        .array(
          z.object({
            id: z.number().int(),
            reviewStatus: z.enum(['OPEN', 'CONFIRMED', 'FALSE_POSITIVE', 'REPAIRED']),
          })
        )
        .optional()
        .default([]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid review payload.' });
      return;
    }

    const reviewer = req.user!.name;
    const now = new Date();

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(inspections)
        .where(eq(inspections.id, id))
        .limit(1);

      if (!existing) {
        return null;
      }

      for (const du of parsed.data.defectUpdates) {
        await tx
          .update(defects)
          .set({
            reviewStatus: du.reviewStatus,
            reviewedBy: reviewer,
            reviewedAt: now,
          })
          .where(and(eq(defects.id, du.id), eq(defects.inspectionId, id)));
      }

      const nextInspectionStatus =
        parsed.data.reviewStatus === 'FALSE_CALL' ||
        parsed.data.reviewStatus === 'PASS_VERIFIED'
          ? 'PASS'
          : 'FAIL';

      const [savedInsp] = await tx
        .update(inspections)
        .set({
          reviewStatus: parsed.data.reviewStatus,
          reviewNotes: parsed.data.reviewNotes || null,
          reviewedBy: reviewer,
          reviewedAt: now,
          status: nextInspectionStatus,
        })
        .where(eq(inspections.id, id))
        .returning();

      // Keep batch defectiveBoards synchronized if PASS/FAIL state changed
      if (existing.status === 'FAIL' && nextInspectionStatus === 'PASS') {
        await tx
          .update(batches)
          .set({
            defectiveBoards: sql`GREATEST(0, ${batches.defectiveBoards} - 1)`,
          })
          .where(eq(batches.id, existing.batchId));
      } else if (existing.status === 'PASS' && nextInspectionStatus === 'FAIL') {
        await tx
          .update(batches)
          .set({
            defectiveBoards: sql`${batches.defectiveBoards} + 1`,
          })
          .where(eq(batches.id, existing.batchId));
      }

      return savedInsp;
    });

    if (!updated) {
      res.status(404).json({ error: 'Inspection record not found.' });
      return;
    }

    res.json({ inspection: updated });
  } catch (err) {
    console.error('Review inspection error:', err);
    res.status(500).json({ error: 'Failed to save operator review.' });
  }
});

// ---------------------------------------------------------------------------
// Authentic AOI Data Ingestion Routes (NO random generation / NO browser dummy inject)
// ---------------------------------------------------------------------------

const defectInputSchema = z.object({
  defectType: z.enum(CANONICAL_DEFECT_TYPES),
  componentRef: z.string().trim().min(1).max(32),
  severity: z.enum(['CRITICAL', 'WARNING']).default('CRITICAL'),
  posX: z.number().min(2).max(98),
  posY: z.number().min(2).max(98),
  rootCause: z.string().trim().min(2).max(120),
  correctiveAction: z.string().trim().min(2).max(240),
  confidence: z.number().min(0.1).max(1).optional().default(0.95),
});

const inspectionInputSchema = z.object({
  serialNumber: z.string().trim().min(3).max(64),
  boardModelCode: z.string().trim().min(1).max(40).default('Model X12'),
  batchCode: z.string().trim().min(1).max(24),
  shift: z.string().trim().min(1).max(12),
  line: z.string().trim().min(1).max(12),
  shiftDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  operatorName: z.string().trim().min(2).max(80).optional(),
  stationId: z.string().trim().min(2).max(32).optional().default('AOI-03'),
  status: z.enum(['PASS', 'FAIL']),
  source: z
    .enum(['AOI_WEBHOOK', 'CSV_IMPORT', 'JSON_IMPORT', 'MANUAL_ENTRY'])
    .optional()
    .default('MANUAL_ENTRY'),
  scanImageUrl: pcbImageUrlSchema.optional(),
  inspectedAt: z.string().optional(),
  defects: z.array(defectInputSchema).default([]),
});

const ingestBatchSchema = z.union([
  inspectionInputSchema,
  z.object({ records: z.array(inspectionInputSchema).min(1).max(500) }),
]);

async function persistIngestedRecords(
  records: z.infer<typeof inspectionInputSchema>[],
  authUser: { id: number; name: string }
) {
  return db.transaction(async (tx) => {
    const models = await tx.select().from(boardModels);
    const modelByCode = new Map(models.map((m) => [m.code, m]));

    let insertedCount = 0;
    let defectsInserted = 0;
    const skippedSerials: string[] = [];

    for (const rec of records) {
      if (rec.status === 'FAIL' && rec.defects.length === 0) {
        throw new Error(
          `Inspection ${rec.serialNumber} marked FAIL must include at least one defect record.`
        );
      }

      const [existingSn] = await tx
        .select({ id: inspections.id })
        .from(inspections)
        .where(eq(inspections.serialNumber, rec.serialNumber))
        .limit(1);

      if (existingSn) {
        skippedSerials.push(rec.serialNumber);
        continue;
      }

      let model = modelByCode.get(rec.boardModelCode);
      if (!model) {
        const [createdModel] = await tx
          .insert(boardModels)
          .values({
            code: rec.boardModelCode,
            displayName: rec.boardModelCode,
            pcbImageUrl: '/src/assets/images/pcb_board_topdown_1795410465435.jpg',
            description: 'Registered via AOI ingestion pipeline',
          })
          .returning();
        model = createdModel;
        modelByCode.set(model.code, model);
      }

      const effectiveDate =
        rec.shiftDate ||
        (rec.inspectedAt ? rec.inspectedAt.slice(0, 10) : new Date().toISOString().slice(0, 10));

      let [batch] = await tx
        .select()
        .from(batches)
        .where(
          and(
            eq(batches.batchCode, rec.batchCode),
            eq(batches.shift, rec.shift),
            eq(batches.line, rec.line),
            eq(batches.boardModelId, model.id)
          )
        )
        .limit(1);

      if (!batch) {
        const [createdBatch] = await tx
          .insert(batches)
          .values({
            batchCode: rec.batchCode,
            shift: rec.shift,
            line: rec.line,
            boardModelId: model.id,
            shiftDate: effectiveDate,
            totalInspected: 0,
            defectiveBoards: 0,
            status: 'ACTIVE',
          })
          .returning();
        batch = createdBatch;
      }

      const inspectedTimestamp = rec.inspectedAt ? new Date(rec.inspectedAt) : new Date();
      const [createdInsp] = await tx
        .insert(inspections)
        .values({
          serialNumber: rec.serialNumber,
          boardModelId: model.id,
          batchId: batch.id,
          operatorId: authUser.id,
          operatorName: rec.operatorName || authUser.name,
          status: rec.status,
          stationId: rec.stationId,
          source: rec.source,
          scanImageUrl: rec.scanImageUrl || null,
          reviewStatus: rec.status === 'PASS' ? 'PASS_VERIFIED' : 'PENDING_REVIEW',
          inspectedAt: Number.isNaN(inspectedTimestamp.getTime()) ? new Date() : inspectedTimestamp,
        })
        .returning();

      if (rec.defects.length > 0) {
        await tx.insert(defects).values(
          rec.defects.map((d) => ({
            inspectionId: createdInsp.id,
            defectType: d.defectType,
            componentRef: d.componentRef,
            severity: d.severity,
            posX: d.posX,
            posY: d.posY,
            rootCause: d.rootCause,
            correctiveAction: d.correctiveAction,
            confidence: d.confidence,
            reviewStatus: 'OPEN',
            detectedAt: createdInsp.inspectedAt,
          }))
        );
        defectsInserted += rec.defects.length;
      }

      await tx
        .update(batches)
        .set({
          totalInspected: sql`${batches.totalInspected} + 1`,
          defectiveBoards:
            rec.status === 'FAIL'
              ? sql`${batches.defectiveBoards} + 1`
              : batches.defectiveBoards,
        })
        .where(eq(batches.id, batch.id));

      insertedCount += 1;
    }

    return { insertedCount, defectsInserted, skippedSerials };
  });
}

router.post(
  '/inspections/ingest',
  requireAuthOrApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = ingestBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid AOI inspection payload.',
          details: parsed.error.issues.slice(0, 5),
        });
        return;
      }

      const records = 'records' in parsed.data ? parsed.data.records : [parsed.data];
      const result = await persistIngestedRecords(records, {
        id: req.user!.id,
        name: req.user!.name,
      });

      res.status(201).json({
        ok: true,
        ...result,
      });
    } catch (err) {
      console.error('Ingest error:', err);
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to ingest AOI inspection payload.',
      });
    }
  }
);

router.post(
  '/inspections/ingest-csv',
  requireAuthOrApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const schema = z.object({ csvText: z.string().min(10).max(500_000) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid CSV payload is required.' });
        return;
      }

      const lines = parsed.data.csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        res.status(400).json({ error: 'CSV must include header row and at least one data row.' });
        return;
      }

      const parseCsvLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
              current += '"';
              i += 1;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        result.push(current.trim());
        return result;
      };

      const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
      const col = (row: string[], name: string) => {
        const idx = headers.indexOf(name.toLowerCase());
        return idx >= 0 ? row[idx] ?? '' : '';
      };

      // Group rows by serialNumber so multi-defect boards collapse into 1 inspection + N defects
      const grouped = new Map<string, z.infer<typeof inspectionInputSchema>>();

      for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        const serialNumber = col(row, 'serialnumber') || col(row, 'serial_number');
        if (!serialNumber) {
          res.status(400).json({ error: `Row ${i + 1}: missing serialNumber.` });
          return;
        }

        const defectTypeRaw = col(row, 'defecttype') || col(row, 'defect_type');
        const statusRaw = (col(row, 'status') || (defectTypeRaw ? 'FAIL' : 'PASS')).toUpperCase();

        if (!grouped.has(serialNumber)) {
          grouped.set(serialNumber, {
            serialNumber,
            boardModelCode: col(row, 'boardmodel') || col(row, 'board_model') || 'Model X12',
            batchCode: col(row, 'batchcode') || col(row, 'batch_code') || '1200',
            shift: col(row, 'shift') || 'A',
            line: col(row, 'line') || '3',
            operatorName: col(row, 'operator') || col(row, 'operatorname') || req.user!.name,
            stationId: col(row, 'stationid') || col(row, 'station_id') || 'AOI-03',
            status: statusRaw === 'PASS' ? 'PASS' : 'FAIL',
            source: 'CSV_IMPORT',
            inspectedAt: col(row, 'detectedat') || col(row, 'inspectedat') || undefined,
            defects: [],
          });
        }

        if (defectTypeRaw && statusRaw !== 'PASS') {
          if (
            !CANONICAL_DEFECT_TYPES.includes(
              defectTypeRaw as (typeof CANONICAL_DEFECT_TYPES)[number]
            )
          ) {
            res.status(400).json({
              error: `Row ${i + 1}: invalid defectType "${defectTypeRaw}". Allowed: ${CANONICAL_DEFECT_TYPES.join(', ')}.`,
            });
            return;
          }
          const posX = Number(col(row, 'posx') || col(row, 'pos_x'));
          const posY = Number(col(row, 'posy') || col(row, 'pos_y'));
          const entry = grouped.get(serialNumber)!;
          entry.defects.push({
            defectType: defectTypeRaw as (typeof CANONICAL_DEFECT_TYPES)[number],
            componentRef: col(row, 'componentref') || col(row, 'component_ref') || 'U1',
            severity:
              (col(row, 'severity') || 'CRITICAL').toUpperCase() === 'WARNING'
                ? 'WARNING'
                : 'CRITICAL',
            posX: Number.isFinite(posX) ? posX : 50,
            posY: Number.isFinite(posY) ? posY : 50,
            rootCause: col(row, 'rootcause') || col(row, 'root_cause') || 'Process Drift',
            correctiveAction:
              col(row, 'correctiveaction') ||
              col(row, 'corrective_action') ||
              'Inspect SMT station parameters',
            confidence: 0.95,
          });
        }
      }

      const records = Array.from(grouped.values()).map((r) =>
        inspectionInputSchema.parse(r)
      );

      const result = await persistIngestedRecords(records, {
        id: req.user!.id,
        name: req.user!.name,
      });

      res.status(201).json({
        ok: true,
        ...result,
      });
    } catch (err) {
      console.error('CSV ingest error:', err);
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to parse and ingest CSV data.',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Agentic RAG & OpenAI-Compatible AI Insight Routes
// ---------------------------------------------------------------------------

router.get('/ai/status', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  const status = getAiProviderStatus();
  let baseHost: string | null = null;
  if (status.baseUrl) {
    try {
      baseHost = new URL(status.baseUrl).origin;
    } catch {
      baseHost = status.baseUrl;
    }
  }
  res.json({
    configured: status.configured,
    provider: status.provider,
    model: status.model,
    baseUrl: baseHost,
  });
});

router.get('/ai/knowledge', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const docs = await db
      .select()
      .from(knowledgeDocs)
      .orderBy(desc(knowledgeDocs.createdAt));
    res.json({ docs });
  } catch (err) {
    console.error('Fetch RAG knowledge error:', err);
    res.status(500).json({ error: 'Failed to load SMT RAG knowledge base.' });
  }
});

router.post('/ai/knowledge', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schema = z.object({
      title: z.string().trim().min(3).max(140),
      category: z.string().trim().min(2).max(80),
      defectType: z.string().trim().min(2).max(60),
      componentPattern: z.string().trim().max(80).optional().default('*'),
      content: z.string().trim().min(10).max(2000),
      sopActions: z.string().trim().min(10).max(2000),
      tags: z.string().trim().max(240).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid SOP document.' });
      return;
    }

    const slug = `${parsed.data.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48)}-${Date.now().toString(36)}`;

    const [created] = await db
      .insert(knowledgeDocs)
      .values({
        slug,
        ...parsed.data,
      })
      .returning();

    res.status(201).json({ doc: created });
  } catch (err) {
    console.error('Create RAG doc error:', err);
    res.status(500).json({ error: 'Failed to store SMT SOP document.' });
  }
});

router.post('/ai/analyze', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filters: FilterParams = {
      startDate: String(req.body?.startDate || '2025-05-01'),
      endDate: String(req.body?.endDate || '2025-05-25'),
      boardModel: String(req.body?.boardModel || 'Model X12'),
      batchKey: String(req.body?.batchKey || 'ALL'),
      defectType: String(req.body?.defectType || 'ALL'),
      operator: String(req.body?.operator || 'ALL'),
      sortRootCause: 'frequency',
    };

    const payload = await computeDashboardPayload(filters);

    const generated = await runBoardSightAgentAnalysis({
      boardModelCode: payload.header.boardModelCode,
      boardDisplayName: payload.header.boardDisplayName,
      periodLabel: `${filters.startDate} to ${filters.endDate}`,
      batchKey: filters.batchKey,
      defectType: filters.defectType,
      operator: filters.operator,
      totalInspected: payload.kpis.totalInspected,
      defectiveBoards: payload.kpis.defectiveBoardsCount,
      defectiveRatePct: payload.kpis.defectiveBoardsPct,
      totalDefects: payload.kpis.totalDefects,
      worstShift: payload.kpis.worstShift,
      mostFrequentDefect: payload.kpis.mostFrequentDefect,
    });

    const targetBatch = payload.batches.find(
      (b) => b.batchCode === generated.targetBatchCode
    );
    const filterSignature = `${payload.header.boardModelCode}|${filters.batchKey}|${filters.defectType}|${filters.operator}`;

    const [saved] = await db
      .insert(aiInsights)
      .values({
        boardModelId: payload.header.boardModelId,
        batchId: targetBatch?.id ?? null,
        filterSignature,
        headline: generated.headline,
        recommendation: generated.recommendation,
        targetBatchCode: generated.targetBatchCode,
        forecastDelta: generated.forecastDelta,
        analysisDetail: generated.analysisDetail,
        provider: generated.provider,
        modelUsed: generated.modelUsed,
        toolsUsed: JSON.stringify(generated.toolsUsed),
      })
      .returning();

    res.json({ aiInsight: saved });
  } catch (err) {
    console.error('AI analyze error:', err);
    const message =
      err instanceof Error ? err.message : 'Failed to run AOI Quality Agent analysis.';
    res.status(500).json({ error: message });
  }
});

router.post('/ai/chat', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schema = z.object({
      question: z.string().trim().min(2).max(1000),
      boardModel: z.string().trim().min(1).max(40).default('Model X12'),
      batchKey: z.string().trim().max(80).optional().default('ALL'),
      defectType: z.string().trim().max(60).optional().default('ALL'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Question is required.' });
      return;
    }

    const [model] = await db
      .select()
      .from(boardModels)
      .where(eq(boardModels.code, parsed.data.boardModel))
      .limit(1);

    const response = await askBoardSightAgent({
      question: parsed.data.question,
      boardModelCode: parsed.data.boardModel,
      boardDisplayName: model?.displayName || parsed.data.boardModel,
      batchKey: parsed.data.batchKey,
      defectType: parsed.data.defectType,
    });

    res.json(response);
  } catch (err) {
    console.error('AI chat error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query AOI Quality Agent.',
    });
  }
});

export default router;
