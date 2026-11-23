import { useEffect, useState, type FormEvent } from 'react';
import { BookOpen, Bot, Database, Plus, Send, Sparkles, X } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { AiInsightData } from '../types/boardsight.ts';
import { MarkdownContent } from './MarkdownContent.tsx';

interface AgentAssistantModalProps {
  open: boolean;
  onClose: () => void;
  boardModelCode: string;
  boardDisplayName: string;
  batchKey: string;
  defectType: string;
  aiInsight: AiInsightData | null;
}

interface AgentToolTrace {
  tool: string;
  summary: string;
}

interface KnowledgeDoc {
  id: number;
  slug: string;
  title: string;
  category: string;
  defectType: string;
  componentPattern: string;
  content: string;
  sopActions: string;
}

interface AiStatus {
  configured: boolean;
  provider: string;
  model: string;
  baseUrl: string | null;
}

export function AgentAssistantModal({
  open,
  onClose,
  boardModelCode,
  boardDisplayName,
  batchKey,
  defectType,
  aiInsight,
}: AgentAssistantModalProps) {
  const [tab, setTab] = useState<'agent' | 'rag'>('agent');
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    {
      role: 'user' | 'agent';
      text: string;
      meta?: string;
      tools?: AgentToolTrace[];
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  // Add custom SMT SOP doc form
  const [showAddSop, setShowAddSop] = useState(false);
  const [sopTitle, setSopTitle] = useState('');
  const [sopCategory, setSopCategory] = useState('SMT Process Control');
  const [sopDefectType, setSopDefectType] = useState('Solder Bridge');
  const [sopPattern, setSopPattern] = useState('*');
  const [sopContent, setSopContent] = useState('');
  const [sopActions, setSopActions] = useState('');
  const [savingSop, setSavingSop] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    apiFetch('/api/ai/status')
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => {});

    apiFetch('/api/ai/knowledge')
      .then((r) => r.json())
      .then((d) => setDocs(d.docs || []))
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  let insightTools: AgentToolTrace[] = [];
  if (aiInsight?.toolsUsed) {
    try {
      insightTools = JSON.parse(aiInsight.toolsUsed) as AgentToolTrace[];
    } catch {
      insightTools = [];
    }
  }

  async function handleAsk(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setError(null);
    setAsking(true);
    setChatHistory((prev) => [...prev, { role: 'user', text: q }]);
    setQuestion('');

    try {
      const res = await apiFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          boardModel: boardModelCode,
          batchKey,
          defectType,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Agent query failed.');

      setChatHistory((prev) => [
        ...prev,
        {
          role: 'agent',
          text: json.answer,
          meta: `${json.provider} · ${json.modelUsed}`,
          tools: json.toolsUsed || [],
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach AI Agent.');
    } finally {
      setAsking(false);
    }
  }

  async function handleSaveSop(e: FormEvent) {
    e.preventDefault();
    setSavingSop(true);
    setError(null);
    try {
      const res = await apiFetch('/api/ai/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: sopTitle,
          category: sopCategory,
          defectType: sopDefectType,
          componentPattern: sopPattern,
          content: sopContent,
          sopActions,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save SOP document.');
      setDocs((prev) => [json.doc, ...prev]);
      setSopTitle('');
      setSopContent('');
      setSopActions('');
      setShowAddSop(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save SOP.');
    } finally {
      setSavingSop(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[820px] max-h-[90vh] overflow-y-auto bg-white border border-[#EAECEF] rounded-2xl shadow-2xl p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#EAECEF]">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#2563EB]" />
              <h3 className="text-[16.5px] font-semibold text-[#111827]">
                AOI Quality Agent &amp; SMT RAG Knowledge Base
              </h3>
            </div>
            <p className="text-[12px] text-[#6B7280] mt-1">
              Connected to PostgreSQL tools &amp; IPC-A-610 RAG docs ·{' '}
              {status ? (
                <span className="font-mono-tabular text-[#111827]">
                  {status.provider} ({status.model})
                  {status.baseUrl ? ` @ ${status.baseUrl}` : ''}
                </span>
              ) : (
                'Checking provider...'
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-[#F3F4F6] rounded-lg">
              <button
                type="button"
                onClick={() => setTab('agent')}
                className={`px-3 py-1 text-[12px] font-medium rounded-md ${
                  tab === 'agent'
                    ? 'bg-white text-[#111827] shadow-2xs'
                    : 'text-[#6B7280]'
                }`}
              >
                Ask Agent
              </button>
              <button
                type="button"
                onClick={() => setTab('rag')}
                className={`px-3 py-1 text-[12px] font-medium rounded-md ${
                  tab === 'rag'
                    ? 'bg-white text-[#111827] shadow-2xs'
                    : 'text-[#6B7280]'
                }`}
              >
                RAG SOPs ({docs.length})
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close AI Agent panel"
              className="w-8 h-8 rounded-lg border border-[#E5E7EB] hover:bg-[#F3F4F6] flex items-center justify-center text-[#374151]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] text-red-700">
            {error}
          </div>
        )}

        {tab === 'agent' && (
          <div className="mt-4 space-y-4">
            {aiInsight && (
              <div className="border border-[#EAECEF] bg-[#FAFAFB] rounded-xl p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-[#111827]">
                    Latest Persisted Insight Trace ({boardDisplayName})
                  </span>
                  {aiInsight.modelUsed && (
                    <span className="text-[11px] font-mono-tabular text-[#6B7280]">
                      {aiInsight.provider || 'llm'} · {aiInsight.modelUsed}
                    </span>
                  )}
                </div>
                <MarkdownContent
                  content={aiInsight.analysisDetail}
                  className="text-[#374151]"
                />
                {insightTools.length > 0 && (
                  <div className="pt-2 border-t border-[#EAECEF] space-y-1">
                    <div className="text-[11px] font-semibold text-[#6B7280] flex items-center gap-1">
                      <Database className="w-3 h-3" /> Agent Tool Calls &amp; RAG Grounding:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {insightTools.map((t, idx) => (
                        <span
                          key={idx}
                          title={t.summary}
                          className="text-[11px] bg-white border border-[#E5E7EB] rounded px-2 py-0.5 text-[#374151]"
                        >
                          <span className="font-mono-tabular font-semibold">{t.tool}</span>:{' '}
                          {t.summary}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="border border-[#EAECEF] rounded-xl p-4 space-y-3 min-h-[220px] max-h-[380px] overflow-y-auto bg-[#FCFCFD]">
              {chatHistory.length === 0 ? (
                <div className="text-[12.5px] text-[#6B7280] py-6 text-center space-y-2">
                  <Bot className="w-6 h-6 mx-auto text-[#9CA3AF]" />
                  <p>
                    Ask the AOI Agent about batch yields, component root causes, false-call
                    rates, or SMT remediation SOPs for <strong>{boardModelCode}</strong>.
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                    {[
                      'Why is Batch 1201 defect rate high and what SOP applies?',
                      'Summarize top component hotspots and operator review status.',
                    ].map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => setQuestion(sample)}
                        className="text-[11.5px] px-2.5 py-1 bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F3F4F6] text-[#374151]"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chatHistory.map((m, idx) => (
                  <div
                    key={idx}
                    className={`rounded-xl p-3 text-[12.5px] ${
                      m.role === 'user'
                        ? 'bg-[#F2F7F3] border border-[#DCECE0] ml-8 text-[#111827]'
                        : 'bg-white border border-[#EAECEF] mr-8 text-[#1F2937]'
                    }`}
                  >
                    {m.role === 'agent' ? (
                      <MarkdownContent content={m.text} />
                    ) : (
                      <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
                    )}
                    {m.tools && m.tools.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#F1F3F5] flex flex-wrap gap-1.5">
                        {m.tools.map((t, i) => (
                          <span
                            key={i}
                            className="text-[10.5px] bg-[#FAFAFB] border border-[#E5E7EB] rounded px-1.5 py-0.5 text-[#6B7280]"
                          >
                            {t.tool}: {t.summary}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.meta && (
                      <div className="mt-1 text-[10.5px] font-mono-tabular text-[#9CA3AF]">
                        {m.meta}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleAsk} className="flex gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={`Ask AOI Agent about ${boardModelCode}...`}
                className="flex-1 px-3.5 py-2.5 text-[12.5px] border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#229A45]"
              />
              <button
                type="submit"
                disabled={asking || !question.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#5AC16D] hover:bg-[#49B05C] disabled:opacity-60 text-white text-[12.5px] font-semibold rounded-lg"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{asking ? 'Running Tools...' : 'Ask Agent'}</span>
              </button>
            </form>
          </div>
        )}

        {tab === 'rag' && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-[#6B7280]">
                Engineering SOPs stored in PostgreSQL (
                <code className="font-mono-tabular text-[11px] bg-[#F3F4F6] text-[#111827] px-1 py-0.5 rounded">
                  knowledge_docs
                </code>
                ) retrieved by the Agent during root-cause analysis.
              </p>
              <button
                type="button"
                onClick={() => setShowAddSop((v) => !v)}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#5AC16D] hover:bg-[#49B05C] text-white text-[12px] font-semibold rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showAddSop ? 'Cancel' : 'Add SMT SOP'}</span>
              </button>
            </div>

            {showAddSop && (
              <form
                onSubmit={handleSaveSop}
                className="border border-[#EAECEF] bg-[#FAFAFB] rounded-xl p-4 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={sopTitle}
                    onChange={(e) => setSopTitle(e.target.value)}
                    placeholder="SOP Title (e.g. QFN-48 Stencil Aperture Check)"
                    className="px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
                  />
                  <input
                    type="text"
                    required
                    value={sopCategory}
                    onChange={(e) => setSopCategory(e.target.value)}
                    placeholder="Category"
                    className="px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
                  />
                  <select
                    value={sopDefectType}
                    onChange={(e) => setSopDefectType(e.target.value)}
                    className="px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
                  >
                    <option value="Solder Bridge">Solder Bridge</option>
                    <option value="Missing Component">Missing Component</option>
                    <option value="Misalignment">Misalignment</option>
                    <option value="Short Circuit">Short Circuit</option>
                    <option value="Wrong Polarity">Wrong Polarity</option>
                    <option value="ALL">ALL</option>
                  </select>
                  <input
                    type="text"
                    value={sopPattern}
                    onChange={(e) => setSopPattern(e.target.value)}
                    placeholder="Component Pattern e.g. C9,IC102"
                    className="px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-lg bg-white font-mono-tabular"
                  />
                </div>
                <textarea
                  rows={2}
                  required
                  value={sopContent}
                  onChange={(e) => setSopContent(e.target.value)}
                  placeholder="Technical root cause context..."
                  className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
                />
                <textarea
                  rows={2}
                  required
                  value={sopActions}
                  onChange={(e) => setSopActions(e.target.value)}
                  placeholder="Step-by-step SOP corrective actions..."
                  className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
                />
                <button
                  type="submit"
                  disabled={savingSop}
                  className="px-4 py-2 bg-[#5AC16D] hover:bg-[#49B05C] text-white text-[12px] font-semibold rounded-lg"
                >
                  {savingSop ? 'Saving to PostgreSQL...' : 'Store SOP in RAG Base'}
                </button>
              </form>
            )}

            <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
              {docs.map((d) => (
                <div
                  key={d.id}
                  className="border border-[#EAECEF] rounded-xl p-3.5 bg-white space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#111827]">
                      <BookOpen className="w-3.5 h-3.5 text-[#229A45]" />
                      <span>{d.title}</span>
                    </div>
                    <span className="text-[11px] font-mono-tabular px-2 py-0.5 rounded bg-[#F3F4F6] text-[#374151]">
                      {d.defectType} · {d.componentPattern}
                    </span>
                  </div>
                  <MarkdownContent
                    content={d.content}
                    className="text-[12px] text-[#4B5563]"
                  />
                  <div className="text-[12px] text-[#111827] bg-[#F7FBF8] border border-[#DCECE0] rounded-lg px-2.5 py-1.5">
                    <span className="font-semibold text-[#229A45] block mb-0.5">
                      SOP Actions:
                    </span>
                    <MarkdownContent content={d.sopActions} className="text-[12px]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
