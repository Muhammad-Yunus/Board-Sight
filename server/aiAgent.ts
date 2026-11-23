import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  batches,
  boardModels,
  defects,
  inspections,
  knowledgeDocs,
} from '../src/db/schema.ts';

export interface AiProviderStatus {
  configured: boolean;
  provider: 'openai-compatible' | 'gemini' | 'unconfigured';
  model: string;
  baseUrl: string | null;
}

export function getAiProviderStatus(): AiProviderStatus {
  const aiKey = process.env.AI_KEY?.trim();
  const aiBaseUrl = process.env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const aiModel = process.env.AI_MODEL?.trim() || 'gpt-4o-mini';

  if (aiKey && aiKey !== 'MY_AI_API_KEY') {
    return {
      configured: true,
      provider: 'openai-compatible',
      model: aiModel,
      baseUrl: aiBaseUrl,
    };
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY') {
    return {
      configured: true,
      provider: 'gemini',
      model: 'gemini-4-hydrogen',
      baseUrl: null,
    };
  }

  return {
    configured: false,
    provider: 'unconfigured',
    model: aiModel,
    baseUrl: aiBaseUrl,
  };
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(trimmed) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// PostgreSQL RAG Retrieval & Live AOI Agent Tools
// ---------------------------------------------------------------------------

export interface AgentToolTrace {
  tool: string;
  summary: string;
}

export interface RetrievedKnowledgeHit {
  id: number;
  slug: string;
  title: string;
  category: string;
  defectType: string;
  score: number;
  content: string;
  sopActions: string;
}

export async function searchSmtKnowledgeRag(params: {
  query: string;
  defectType?: string;
  componentRef?: string;
  limit?: number;
}): Promise<{
  knowledgeDocs: RetrievedKnowledgeHit[];
  operatorFieldNotes: {
    serialNumber: string;
    batchCode: string;
    reviewStatus: string;
    reviewNotes: string;
    reviewedBy: string | null;
  }[];
}> {
  const docs = await db.select().from(knowledgeDocs);
  const queryTokens = `${params.query} ${params.defectType || ''} ${params.componentRef || ''}`
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length >= 2);

  const scored: RetrievedKnowledgeHit[] = docs.map((doc) => {
    let score = 0;
    const haystack = `${doc.title} ${doc.category} ${doc.defectType} ${doc.componentPattern} ${doc.tags} ${doc.content} ${doc.sopActions}`.toLowerCase();

    if (
      params.defectType &&
      params.defectType !== 'ALL' &&
      (doc.defectType.toLowerCase() === params.defectType.toLowerCase() ||
        doc.defectType === 'ALL')
    ) {
      score += doc.defectType === 'ALL' ? 3 : 8;
    }

    if (params.componentRef) {
      const refLower = params.componentRef.toLowerCase();
      if (doc.componentPattern.toLowerCase().includes(refLower)) {
        score += 9;
      }
    }

    for (const token of queryTokens) {
      if (haystack.includes(token)) {
        score += 2;
      }
    }

    return {
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      category: doc.category,
      defectType: doc.defectType,
      score,
      content: doc.content,
      sopActions: doc.sopActions,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const topDocs = scored.slice(0, params.limit ?? 3);

  // Also retrieve recent operator field review notes from PostgreSQL as episodic RAG context
  const reviewedRows = await db
    .select({
      serialNumber: inspections.serialNumber,
      batchCode: batches.batchCode,
      reviewStatus: inspections.reviewStatus,
      reviewNotes: inspections.reviewNotes,
      reviewedBy: inspections.reviewedBy,
    })
    .from(inspections)
    .innerJoin(batches, eq(inspections.batchId, batches.id))
    .orderBy(desc(inspections.reviewedAt), desc(inspections.inspectedAt))
    .limit(20);

  const operatorFieldNotes = reviewedRows
    .filter((r) => Boolean(r.reviewNotes))
    .slice(0, 5)
    .map((r) => ({
      serialNumber: r.serialNumber,
      batchCode: r.batchCode,
      reviewStatus: r.reviewStatus,
      reviewNotes: r.reviewNotes || '',
      reviewedBy: r.reviewedBy,
    }));

  return { knowledgeDocs: topDocs, operatorFieldNotes };
}

async function toolGetShiftBatchMetrics(args: {
  boardModelCode: string;
  batchCode?: string;
}) {
  const [model] = await db
    .select()
    .from(boardModels)
    .where(eq(boardModels.code, args.boardModelCode))
    .limit(1);

  if (!model) return { error: `Board model ${args.boardModelCode} not found.` };

  const conditions = [eq(batches.boardModelId, model.id)];
  if (args.batchCode) {
    conditions.push(eq(batches.batchCode, args.batchCode));
  }

  const rows = await db
    .select()
    .from(batches)
    .where(and(...conditions))
    .orderBy(batches.shiftDate, batches.batchCode);

  return {
    boardModel: { code: model.code, displayName: model.displayName },
    batches: rows.map((b) => ({
      id: b.id,
      batchCode: b.batchCode,
      shift: b.shift,
      line: b.line,
      shiftDate: b.shiftDate,
      status: b.status,
      totalInspected: b.totalInspected,
      defectiveBoards: b.defectiveBoards,
      defectRatePct:
        b.totalInspected > 0
          ? Number(((b.defectiveBoards / b.totalInspected) * 100).toFixed(1))
          : 0,
      yieldPct:
        b.totalInspected > 0
          ? Number(
              (((b.totalInspected - b.defectiveBoards) / b.totalInspected) * 100).toFixed(1)
            )
          : 100,
    })),
  };
}

async function toolGetComponentHotspots(args: {
  boardModelCode: string;
  defectType?: string;
  limit?: number;
}) {
  const [model] = await db
    .select()
    .from(boardModels)
    .where(eq(boardModels.code, args.boardModelCode))
    .limit(1);

  if (!model) return { error: `Board model ${args.boardModelCode} not found.` };

  const conditions = [
    eq(inspections.boardModelId, model.id),
    ne(defects.reviewStatus, 'FALSE_POSITIVE'),
  ];
  if (args.defectType && args.defectType !== 'ALL') {
    conditions.push(eq(defects.defectType, args.defectType));
  }

  const rows = await db
    .select({
      componentRef: defects.componentRef,
      defectType: defects.defectType,
      severity: defects.severity,
      rootCause: defects.rootCause,
      correctiveAction: defects.correctiveAction,
      reviewStatus: defects.reviewStatus,
      batchCode: batches.batchCode,
      shift: batches.shift,
    })
    .from(defects)
    .innerJoin(inspections, eq(defects.inspectionId, inspections.id))
    .innerJoin(batches, eq(inspections.batchId, batches.id))
    .where(and(...conditions));

  const grouped = new Map<
    string,
    {
      componentRef: string;
      defectType: string;
      severity: string;
      rootCause: string;
      correctiveAction: string;
      count: number;
      batches: Set<string>;
    }
  >();

  for (const r of rows) {
    const key = `${r.componentRef}::${r.defectType}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        componentRef: r.componentRef,
        defectType: r.defectType,
        severity: r.severity,
        rootCause: r.rootCause,
        correctiveAction: r.correctiveAction,
        count: 1,
        batches: new Set([`${r.batchCode}/Shift ${r.shift}`]),
      });
    } else {
      existing.count += 1;
      existing.batches.add(`${r.batchCode}/Shift ${r.shift}`);
    }
  }

  return {
    hotspots: Array.from(grouped.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, args.limit ?? 8)
      .map((h) => ({
        componentRef: h.componentRef,
        defectType: h.defectType,
        severity: h.severity,
        count: h.count,
        rootCause: h.rootCause,
        correctiveAction: h.correctiveAction,
        affectedBatches: Array.from(h.batches),
      })),
  };
}

async function toolGetRecentUnitReviews(args: {
  boardModelCode: string;
  limit?: number;
}) {
  const [model] = await db
    .select()
    .from(boardModels)
    .where(eq(boardModels.code, args.boardModelCode))
    .limit(1);

  if (!model) return { error: `Board model ${args.boardModelCode} not found.` };

  const units = await db
    .select({
      serialNumber: inspections.serialNumber,
      status: inspections.status,
      reviewStatus: inspections.reviewStatus,
      reviewedBy: inspections.reviewedBy,
      reviewNotes: inspections.reviewNotes,
      operatorName: inspections.operatorName,
      batchCode: batches.batchCode,
      shift: batches.shift,
      inspectedAt: inspections.inspectedAt,
    })
    .from(inspections)
    .innerJoin(batches, eq(inspections.batchId, batches.id))
    .where(eq(inspections.boardModelId, model.id))
    .orderBy(desc(inspections.inspectedAt))
    .limit(args.limit ?? 30);

  const summary = {
    PENDING_REVIEW: 0,
    CONFIRMED_FAIL: 0,
    FALSE_CALL: 0,
    REWORKED: 0,
    SCRAPPED: 0,
    PASS_VERIFIED: 0,
  };
  for (const u of units) {
    if (u.reviewStatus in summary) {
      summary[u.reviewStatus as keyof typeof summary] += 1;
    }
  }

  return {
    reviewSummary: summary,
    recentUnits: units.slice(0, 12),
  };
}

async function executeAgentTool(
  toolName: string,
  rawArgs: Record<string, unknown>,
  defaultBoardModelCode: string
): Promise<{ output: unknown; traceSummary: string }> {
  const boardModelCode = String(rawArgs.boardModelCode || defaultBoardModelCode);

  if (toolName === 'get_shift_batch_metrics') {
    const res = await toolGetShiftBatchMetrics({
      boardModelCode,
      batchCode: rawArgs.batchCode ? String(rawArgs.batchCode) : undefined,
    });
    return {
      output: res,
      traceSummary: `Queried shift/batch metrics for ${boardModelCode}`,
    };
  }

  if (toolName === 'get_component_hotspots') {
    const res = await toolGetComponentHotspots({
      boardModelCode,
      defectType: rawArgs.defectType ? String(rawArgs.defectType) : undefined,
      limit: rawArgs.limit ? Number(rawArgs.limit) : 8,
    });
    return {
      output: res,
      traceSummary: `Queried component hotspots (${res.hotspots?.length ?? 0} clusters)`,
    };
  }

  if (toolName === 'get_recent_unit_reviews') {
    const res = await toolGetRecentUnitReviews({
      boardModelCode,
      limit: rawArgs.limit ? Number(rawArgs.limit) : 30,
    });
    return {
      output: res,
      traceSummary: `Inspected operator review dispositions (${res.recentUnits?.length ?? 0} units)`,
    };
  }

  if (toolName === 'search_smt_knowledge_rag') {
    const query = String(rawArgs.query || '');
    const res = await searchSmtKnowledgeRag({
      query,
      defectType: rawArgs.defectType ? String(rawArgs.defectType) : undefined,
      componentRef: rawArgs.componentRef ? String(rawArgs.componentRef) : undefined,
    });
    const titles = res.knowledgeDocs.map((d) => d.title).join('; ');
    return {
      output: res,
      traceSummary: `RAG retrieved ${res.knowledgeDocs.length} SOP(s): ${titles}`,
    };
  }

  return {
    output: { error: `Unknown tool: ${toolName}` },
    traceSummary: `Unknown tool ${toolName}`,
  };
}

const OPENAI_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_shift_batch_metrics',
      description:
        'Query live PostgreSQL production batch and shift yield metrics, defect rates, and QA hold/release status for a board model.',
      parameters: {
        type: 'object',
        properties: {
          boardModelCode: { type: 'string', description: 'e.g. Model X12' },
          batchCode: { type: 'string', description: 'Optional specific batch code like 1201' },
        },
        required: ['boardModelCode'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_component_hotspots',
      description:
        'Query PostgreSQL defect hotspots grouped by PCB component designator and defect type, excluding operator-dismissed false positives.',
      parameters: {
        type: 'object',
        properties: {
          boardModelCode: { type: 'string' },
          defectType: { type: 'string', description: 'Optional defect type filter' },
          limit: { type: 'number' },
        },
        required: ['boardModelCode'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_recent_unit_reviews',
      description:
        'Inspect recent operator verification outcomes (PENDING_REVIEW, CONFIRMED_FAIL, FALSE_CALL, REWORKED) and review notes.',
      parameters: {
        type: 'object',
        properties: {
          boardModelCode: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['boardModelCode'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_smt_knowledge_rag',
      description:
        'Retrieve SMT manufacturing SOPs, IPC-A-610 defect guidelines, and past operator rework notes from the PostgreSQL RAG knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Defect symptoms, component refs, or process concern' },
          defectType: { type: 'string' },
          componentRef: { type: 'string' },
        },
        required: ['query'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// OpenAI-Compatible Agent Runner (AI_BASE_URL + AI_KEY + AI_MODEL)
// ---------------------------------------------------------------------------

interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
}

async function runOpenAiCompatibleLoop(params: {
  systemPrompt: string;
  userPrompt: string;
  boardModelCode: string;
  expectJson: boolean;
}): Promise<{
  text: string;
  modelUsed: string;
  toolsUsed: AgentToolTrace[];
}> {
  const baseUrl = process.env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const apiKey = process.env.AI_KEY?.trim();
  const model = process.env.AI_MODEL?.trim() || 'gpt-4o-mini';

  if (!apiKey || apiKey === 'MY_AI_API_KEY') {
    throw new Error('AI_KEY is not configured.');
  }

  const endpoint = buildChatCompletionsUrl(baseUrl);
  const messages: OpenAiChatMessage[] = [
    { role: 'system', content: params.systemPrompt },
    { role: 'user', content: params.userPrompt },
  ];
  const toolsUsed: AgentToolTrace[] = [];

  for (let turn = 0; turn < 5; turn++) {
    const body: Record<string, unknown> = {
      model,
      messages,
      tools: OPENAI_TOOL_DEFINITIONS,
      tool_choice: turn === 4 ? 'none' : 'auto',
    };

    if (params.expectJson && turn === 4) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const rawBody = await res.text();
    if (!res.ok) {
      throw new Error(
        `OpenAI-compatible AI service (${res.status}): ${rawBody.slice(0, 260)}`
      );
    }

    const json = JSON.parse(rawBody) as {
      choices?: {
        message?: OpenAiChatMessage;
      }[];
    };

    const msg = json.choices?.[0]?.message;
    if (!msg) {
      throw new Error('AI service returned no completion choices.');
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
      });

      for (const tc of msg.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }

        const { output, traceSummary } = await executeAgentTool(
          tc.function.name,
          parsedArgs,
          params.boardModelCode
        );
        toolsUsed.push({ tool: tc.function.name, summary: traceSummary });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(output),
        });
      }
      continue;
    }

    return {
      text: (msg.content ?? '').trim(),
      modelUsed: model,
      toolsUsed,
    };
  }

  throw new Error('Agent exceeded maximum tool-calling iterations without a final response.');
}

// ---------------------------------------------------------------------------
// Gemini Fallback Agent Runner (when AI_KEY is empty & GEMINI_API_KEY exists)
// ---------------------------------------------------------------------------

const GEMINI_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_shift_batch_metrics',
    description:
      'Query live PostgreSQL batch and shift yield metrics, defect rates, and QA hold/release status.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        boardModelCode: { type: Type.STRING },
        batchCode: { type: Type.STRING },
      },
      required: ['boardModelCode'],
    },
  },
  {
    name: 'get_component_hotspots',
    description:
      'Query PostgreSQL defect hotspots grouped by component reference and defect type.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        boardModelCode: { type: Type.STRING },
        defectType: { type: Type.STRING },
        limit: { type: Type.NUMBER },
      },
      required: ['boardModelCode'],
    },
  },
  {
    name: 'get_recent_unit_reviews',
    description:
      'Inspect recent operator verification outcomes (PENDING_REVIEW, CONFIRMED_FAIL, FALSE_CALL, REWORKED) and review notes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        boardModelCode: { type: Type.STRING },
        limit: { type: Type.NUMBER },
      },
      required: ['boardModelCode'],
    },
  },
  {
    name: 'search_smt_knowledge_rag',
    description:
      'Retrieve SMT manufacturing SOPs, IPC-A-610 defect guidelines, and past operator rework notes from PostgreSQL.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING },
        defectType: { type: Type.STRING },
        componentRef: { type: Type.STRING },
      },
      required: ['query'],
    },
  },
];

async function runGeminiAgentLoop(params: {
  systemPrompt: string;
  userPrompt: string;
  boardModelCode: string;
  expectJson: boolean;
}): Promise<{
  text: string;
  modelUsed: string;
  toolsUsed: AgentToolTrace[];
}> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'No LLM credential configured. Set AI_BASE_URL, AI_KEY, and AI_MODEL in .env (or GEMINI_API_KEY in Secrets).'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });

  const model = 'gemini-4-hydrogen';
  const toolsUsed: AgentToolTrace[] = [];

  const contents: Array<{
    role: string;
    parts: Array<Record<string, unknown>>;
  }> = [{ role: 'user', parts: [{ text: params.userPrompt }] }];

  for (let turn = 0; turn < 5; turn++) {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        tools: [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }],
      },
    });

    const fnCalls = response.functionCalls;
    if (fnCalls && fnCalls.length > 0) {
      const modelParts = response.candidates?.[0]?.content?.parts || [];
      contents.push({
        role: 'model',
        parts: modelParts as unknown as Array<Record<string, unknown>>,
      });

      const responseParts: Array<Record<string, unknown>> = [];
      for (const call of fnCalls) {
        const callName = call.name || '';
        const args = (call.args || {}) as Record<string, unknown>;
        const { output, traceSummary } = await executeAgentTool(
          callName,
          args,
          params.boardModelCode
        );
        toolsUsed.push({ tool: callName, summary: traceSummary });
        responseParts.push({
          functionResponse: {
            name: callName,
            response: { result: output },
          },
        });
      }
      contents.push({ role: 'user', parts: responseParts });
      continue;
    }

    const text = (response.text ?? '').trim();
    if (!text) {
      throw new Error('Gemini Agent returned an empty response.');
    }
    return { text, modelUsed: model, toolsUsed };
  }

  throw new Error('Agent exceeded maximum tool-calling iterations.');
}

// ---------------------------------------------------------------------------
// Public Agent & Vision Entrypoints
// ---------------------------------------------------------------------------

export interface AgentInsightRequest {
  boardModelCode: string;
  boardDisplayName: string;
  periodLabel: string;
  batchKey: string;
  defectType: string;
  operator: string;
  totalInspected: number;
  defectiveBoards: number;
  defectiveRatePct: number;
  totalDefects: number;
  worstShift: string;
  mostFrequentDefect: string;
}

export interface AgentInsightResult {
  headline: string;
  recommendation: string;
  targetBatchCode: string;
  forecastDelta: string;
  analysisDetail: string;
  provider: string;
  modelUsed: string;
  toolsUsed: AgentToolTrace[];
}

export async function runBoardSightAgentAnalysis(
  input: AgentInsightRequest
): Promise<AgentInsightResult> {
  const status = getAiProviderStatus();
  if (!status.configured) {
    throw new Error(
      'AI Agent is not configured. Please set AI_BASE_URL, AI_KEY, and AI_MODEL in .env (or GEMINI_API_KEY in Secrets).'
    );
  }

  const systemPrompt = `You are the Board Sight Autonomous AOI Manufacturing Quality Agent connected to a live PostgreSQL database and SMT Engineering RAG Knowledge Base.
Before answering:
1. ALWAYS call tools to inspect real shift/batch metrics, component hotspots, operator review outcomes (checking false-call vs confirmed-fail ratio), and search the SMT Knowledge RAG for IPC-A-610 remediation SOPs.
2. Ground every batch code, defect percentage, component reference, and corrective action strictly in tool outputs.
3. Return ONLY a raw JSON object (no markdown fences) with these exact keys:
   - "headline": Concise 1-sentence trend/forecast headline under 95 chars (e.g., "If the 'Solder Bridge' trend does not change, forecast: +23% by 05.25.2025")
   - "recommendation": Short action recommendation under 48 chars (e.g., "Re-checking Batch 1201")
   - "targetBatchCode": Exact batch code string needing attention (e.g., "1201")
   - "forecastDelta": Short percentage delta string (e.g., "+23%")
   - "analysisDetail": 2-4 crisp engineering sentences citing retrieved database metrics, operator review verification status, and concrete SMT SOP actions from the RAG docs.`;

  const userPrompt = `Investigate current AOI inspection performance for "${input.boardDisplayName}" (${input.boardModelCode}).
Active Dashboard Filter Context:
- Period: ${input.periodLabel}
- Batch Filter: ${input.batchKey}
- Defect Type Filter: ${input.defectType}
- Operator Filter: ${input.operator}
- Current Snapshot: ${input.totalInspected} inspected, ${input.defectiveBoards} defective (${input.defectiveRatePct}%), ${input.totalDefects} total defects, worst shift "${input.worstShift}", top defect "${input.mostFrequentDefect}".

Use your PostgreSQL tools and SMT Knowledge RAG to investigate root causes, verify false-call rates, and produce the structured JSON insight.`;

  const runner =
    status.provider === 'openai-compatible'
      ? runOpenAiCompatibleLoop
      : runGeminiAgentLoop;

  const result = await runner({
    systemPrompt,
    userPrompt,
    boardModelCode: input.boardModelCode,
    expectJson: true,
  });

  const parsed = extractJsonObject(result.text);

  return {
    headline: String(parsed.headline || 'AOI quality trend analysis completed.'),
    recommendation: String(parsed.recommendation || 'Inspect worst performing batch'),
    targetBatchCode: String(parsed.targetBatchCode || ''),
    forecastDelta: String(parsed.forecastDelta || '0%'),
    analysisDetail: String(
      parsed.analysisDetail || 'Root cause analysis completed from PostgreSQL telemetry.'
    ),
    provider: status.provider,
    modelUsed: result.modelUsed,
    toolsUsed: result.toolsUsed,
  };
}

export async function askBoardSightAgent(input: {
  question: string;
  boardModelCode: string;
  boardDisplayName: string;
  batchKey: string;
  defectType: string;
}): Promise<{
  answer: string;
  provider: string;
  modelUsed: string;
  toolsUsed: AgentToolTrace[];
}> {
  const status = getAiProviderStatus();
  if (!status.configured) {
    throw new Error(
      'AI Agent is not configured. Please set AI_BASE_URL, AI_KEY, and AI_MODEL in .env (or GEMINI_API_KEY in Secrets).'
    );
  }

  const systemPrompt = `You are the Board Sight SMT/AOI Quality Engineering Agent with live access to PostgreSQL telemetry tools and an IPC-A-610 / SMT SOP RAG knowledge base.
Always use your tools to retrieve actual batch yields, component hotspots, operator review dispositions, and matching SMT SOPs before answering the engineer's question.
Answer concisely in the same language as the engineer's question (Indonesian or English), citing exact batch codes, component designators, percentages, and SOP steps from tool results.`;

  const userPrompt = `Active PCB Model: ${input.boardDisplayName} (${input.boardModelCode})
Active Filters: Batch=${input.batchKey}, DefectType=${input.defectType}

Engineer Question: ${input.question}`;

  const runner =
    status.provider === 'openai-compatible'
      ? runOpenAiCompatibleLoop
      : runGeminiAgentLoop;

  const result = await runner({
    systemPrompt,
    userPrompt,
    boardModelCode: input.boardModelCode,
    expectJson: false,
  });

  return {
    answer: result.text,
    provider: status.provider,
    modelUsed: result.modelUsed,
    toolsUsed: result.toolsUsed,
  };
}

// ---------------------------------------------------------------------------
// Multimodal PCB Optical Scan Inspection (OpenAI-Compatible Vision + Gemini Fallback)
// ---------------------------------------------------------------------------

export interface VisionDefectFinding {
  defectType:
    | 'Missing Component'
    | 'Solder Bridge'
    | 'Misalignment'
    | 'Short Circuit'
    | 'Wrong Polarity';
  componentRef: string;
  severity: 'CRITICAL' | 'WARNING';
  posX: number;
  posY: number;
  rootCause: string;
  correctiveAction: string;
  confidence: number;
}

export interface VisionInspectionResult {
  recommendedStatus: 'PASS' | 'FAIL';
  summary: string;
  findings: VisionDefectFinding[];
  provider: string;
  modelUsed: string;
}

export async function inspectPcbImageWithAi(input: {
  imageDataUrl: string;
  boardModelCode: string;
  boardDisplayName: string;
}): Promise<VisionInspectionResult> {
  const status = getAiProviderStatus();
  if (!status.configured) {
    throw new Error(
      'AI Vision is not configured. Please set AI_BASE_URL, AI_KEY, and AI_MODEL in .env (or GEMINI_API_KEY in Secrets).'
    );
  }

  const match = input.imageDataUrl.match(
    /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/
  );
  if (!match) {
    throw new Error(
      'Invalid image format. Please upload a PNG, JPEG, or WebP PCB scan image.'
    );
  }

  const prompt = `Perform an Automated Optical Inspection (AOI) visual check on this uploaded PCB top-down scan for "${input.boardDisplayName}" (${input.boardModelCode}).
Look carefully at solder joints, SMD pads, IC pins, polarities, and component alignment.
Return ONLY a raw JSON object with:
- "recommendedStatus": "PASS" or "FAIL"
- "summary": concise 1-2 sentence optical summary
- "findings": array of objects with keys { defectType (one of "Missing Component", "Solder Bridge", "Misalignment", "Short Circuit", "Wrong Polarity"), componentRef, severity ("CRITICAL" or "WARNING"), posX (2..98), posY (2..98), rootCause, correctiveAction, confidence (0.50..0.99) }.`;

  let rawText = '';
  let modelUsed = status.model;

  if (status.provider === 'openai-compatible') {
    const endpoint = buildChatCompletionsUrl(status.baseUrl!);
    const apiKey = process.env.AI_KEY!.trim();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: status.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are an AOI optical inspection vision system for SMT PCB assemblies. Output valid JSON strictly describing anomalies visible in the image.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: input.imageDataUrl } },
            ],
          },
        ],
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`OpenAI-compatible Vision (${res.status}): ${bodyText.slice(0, 260)}`);
    }
    const json = JSON.parse(bodyText) as {
      choices?: { message?: { content?: string } }[];
    };
    rawText = (json.choices?.[0]?.message?.content ?? '').trim();
  } else {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!.trim(),
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          { inlineData: { mimeType, data: match[2] } },
          { text: prompt },
        ],
      },
      config: {
        systemInstruction:
          'You are an AOI optical inspection vision system for SMT PCB assemblies. Output valid JSON.',
        responseMimeType: 'application/json',
      },
    });
    rawText = (response.text ?? '').trim();
    modelUsed = 'gemini-4-hydrogen';
  }

  if (!rawText) {
    throw new Error('AI Vision returned an empty inspection response.');
  }

  const parsed = extractJsonObject(rawText) as {
    recommendedStatus?: string;
    summary?: string;
    findings?: Partial<VisionDefectFinding>[];
  };

  const allowedTypes = new Set([
    'Missing Component',
    'Solder Bridge',
    'Misalignment',
    'Short Circuit',
    'Wrong Polarity',
  ]);

  return {
    recommendedStatus: parsed.recommendedStatus === 'PASS' ? 'PASS' : 'FAIL',
    summary: String(parsed.summary || 'Optical inspection completed.'),
    provider: status.provider,
    modelUsed,
    findings: (parsed.findings || []).map((f) => ({
      defectType: allowedTypes.has(String(f.defectType))
        ? (f.defectType as VisionDefectFinding['defectType'])
        : 'Misalignment',
      componentRef: String(f.componentRef || 'U1').slice(0, 24),
      severity: f.severity === 'WARNING' ? 'WARNING' : 'CRITICAL',
      posX: Math.min(96, Math.max(4, Number(f.posX) || 50)),
      posY: Math.min(96, Math.max(4, Number(f.posY) || 50)),
      rootCause: String(f.rootCause || 'Optical Anomaly').slice(0, 120),
      correctiveAction: String(
        f.correctiveAction || 'Operator visual verification required'
      ).slice(0, 220),
      confidence: Math.min(0.99, Math.max(0.5, Number(f.confidence) || 0.85)),
    })),
  };
}
