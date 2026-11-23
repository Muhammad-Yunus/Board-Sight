import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert, Sparkles, X } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { AiInsightData } from '../types/boardsight.ts';
import { MarkdownContent } from './MarkdownContent.tsx';

interface BatchDetailsModalProps {
  batchCode: string | null;
  batchId?: number | null;
  boardModelCode?: string;
  userRole: string;
  aiInsight: AiInsightData | null;
  onClose: () => void;
  onBatchStatusUpdated: () => void;
  onInspectUnit: (serialNumber: string) => void;
}

interface BatchDetailResponse {
  batch: {
    id: number;
    batchCode: string;
    shift: string;
    line: string;
    shiftDate: string;
    totalInspected: number;
    defectiveBoards: number;
    defectRatePct: number;
    yieldPct: number;
    status: 'ACTIVE' | 'HOLD_REVIEW' | 'RELEASED' | string;
    boardModelCode: string;
    boardDisplayName: string;
  };
  defectSummary: { defectType: string; count: number }[];
  recentDefects: {
    defectType: string;
    componentRef: string;
    severity: string;
    rootCause: string;
    correctiveAction: string;
    reviewStatus: string;
    serialNumber: string;
    inspectionId: number;
    detectedAt: string;
  }[];
}

export function BatchDetailsModal({
  batchCode,
  batchId,
  boardModelCode,
  userRole,
  aiInsight,
  onClose,
  onBatchStatusUpdated,
  onInspectUnit,
}: BatchDetailsModalProps) {
  const [data, setData] = useState<BatchDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchCode) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (boardModelCode) params.set('boardModel', boardModelCode);
    if (batchId) params.set('batchId', String(batchId));
    const qs = params.toString() ? `?${params.toString()}` : '';

    apiFetch(`/api/batches/${encodeURIComponent(batchCode)}${qs}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load batch details');
        return json as BatchDetailResponse;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error loading batch');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [batchCode, batchId, boardModelCode]);

  if (!batchCode) return null;

  async function handleStatusChange(nextStatus: 'ACTIVE' | 'HOLD_REVIEW' | 'RELEASED') {
    if (!data) return;
    setUpdatingStatus(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/batches/${data.batch.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update batch status');
      setData((prev) =>
        prev ? { ...prev, batch: { ...prev.batch, status: json.batch.status } } : prev
      );
      onBatchStatusUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update batch status.');
    } finally {
      setUpdatingStatus(false);
    }
  }

  const canRelease = userRole === 'QA Engineer' || userRole === 'Admin';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[700px] max-h-[88vh] overflow-y-auto bg-white border border-[#EAECEF] rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#EAECEF]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[17px] font-semibold text-[#111827]">
                Batch {batchCode} Inspection Details
              </h3>
              {data && (
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                    data.batch.status === 'HOLD_REVIEW'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : data.batch.status === 'RELEASED'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-blue-50 text-blue-700 border-blue-200'
                  }`}
                >
                  {data.batch.status}
                </span>
              )}
            </div>
            {data && (
              <p className="text-[12.5px] text-[#6B7280] mt-0.5">
                {data.batch.boardDisplayName} · Shift {data.batch.shift} · Line{' '}
                {data.batch.line} · {data.batch.shiftDate}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close batch details"
            className="w-8 h-8 rounded-lg border border-[#E5E7EB] hover:bg-[#F3F4F6] flex items-center justify-center text-[#374151]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading && (
          <div className="py-12 text-center text-[13px] text-[#6B7280]">
            Querying PostgreSQL batch telemetry...
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-700">
            {error}
          </div>
        )}

        {data && !loading && (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="border border-[#EAECEF] rounded-xl p-3.5 text-center">
                <div className="text-[18px] font-semibold text-[#111827] tabular-nums">
                  {data.batch.totalInspected}
                </div>
                <div className="text-[11.5px] text-[#6B7280] mt-0.5">
                  Boards Inspected
                </div>
              </div>
              <div className="border border-[#EAECEF] rounded-xl p-3.5 text-center">
                <div className="text-[18px] font-semibold text-[#EF4444] tabular-nums">
                  {data.batch.defectiveBoards}
                </div>
                <div className="text-[11.5px] text-[#6B7280] mt-0.5">
                  Defective Boards
                </div>
              </div>
              <div className="border border-[#EAECEF] rounded-xl p-3.5 text-center">
                <div className="text-[18px] font-semibold text-[#F59E0B] tabular-nums">
                  {data.batch.defectRatePct}%
                </div>
                <div className="text-[11.5px] text-[#6B7280] mt-0.5">
                  Defect Rate
                </div>
              </div>
              <div className="border border-[#EAECEF] rounded-xl p-3.5 text-center">
                <div className="text-[18px] font-semibold text-[#16A34A] tabular-nums">
                  {data.batch.yieldPct}%
                </div>
                <div className="text-[11.5px] text-[#6B7280] mt-0.5">
                  First-Pass Yield
                </div>
              </div>
            </div>

            {/* QA Decision Controls */}
            <div className="border border-[#EAECEF] bg-[#FAFAFB] rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="text-[12px] text-[#4B5563]">
                <span className="font-semibold text-[#111827]">Batch QA Gate:</span>{' '}
                Escalate anomalous batches to Hold or release verified batches to packing.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {data.batch.status !== 'HOLD_REVIEW' && (
                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => handleStatusChange('HOLD_REVIEW')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg disabled:opacity-50"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" /> Hold Batch
                  </button>
                )}
                {data.batch.status !== 'RELEASED' && (
                  <button
                    type="button"
                    disabled={updatingStatus || !canRelease}
                    title={
                      canRelease
                        ? 'Release batch for downstream shipment'
                        : `Requires QA Engineer or Admin role (current: ${userRole})`
                    }
                    onClick={() => handleStatusChange('RELEASED')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-[#5AC16D] hover:bg-[#49B05C] text-white rounded-lg disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Release Batch
                  </button>
                )}
              </div>
            </div>

            {aiInsight && aiInsight.targetBatchCode === batchCode && (
              <div className="border border-[#E5E7EB] bg-[#FAFAFB] rounded-xl p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#111827]">
                    <Sparkles className="w-4 h-4 text-[#2563EB]" />
                    <span>AI Root Cause &amp; Yield Assessment</span>
                  </div>
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
                {(() => {
                  if (!aiInsight.toolsUsed) return null;
                  try {
                    const tools = JSON.parse(aiInsight.toolsUsed) as {
                      tool: string;
                      summary: string;
                    }[];
                    if (!tools.length) return null;
                    return (
                      <div className="pt-2 border-t border-[#EAECEF] flex flex-wrap gap-1.5">
                        {tools.map((t, idx) => (
                          <span
                            key={idx}
                            className="text-[10.5px] bg-white border border-[#E5E7EB] rounded px-2 py-0.5 text-[#4B5563]"
                          >
                            <span className="font-mono-tabular font-semibold">{t.tool}</span>:{' '}
                            {t.summary}
                          </span>
                        ))}
                      </div>
                    );
                  } catch {
                    return null;
                  }
                })()}
              </div>
            )}

            <div>
              <h4 className="text-[13.5px] font-semibold text-[#111827] mb-2.5">
                Defect Distribution in Batch {batchCode}
              </h4>
              {data.defectSummary.length === 0 ? (
                <p className="text-[12.5px] text-[#6B7280]">
                  Zero active defects recorded in this batch.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {data.defectSummary.map((d) => (
                    <div
                      key={d.defectType}
                      className="border border-[#EAECEF] rounded-lg px-3 py-2 flex items-center justify-between text-[12px]"
                    >
                      <span className="text-[#4B5563]">{d.defectType}</span>
                      <span className="font-semibold text-[#111827] tabular-nums">
                        {d.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-[13.5px] font-semibold text-[#111827] mb-2.5">
                Recent Logged Defects (Click Serial to Review Unit)
              </h4>
              <div className="border border-[#EAECEF] rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead className="bg-[#FAFAFB] border-b border-[#EAECEF] text-[#6B7280]">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">Serial</th>
                      <th className="py-2.5 px-3 font-medium">Defect</th>
                      <th className="py-2.5 px-3 font-medium">Ref</th>
                      <th className="py-2.5 px-3 font-medium">Root Cause</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F3F5]">
                    {data.recentDefects.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-[#6B7280]">
                          No active defect records found for this batch.
                        </td>
                      </tr>
                    ) : (
                      data.recentDefects.slice(0, 8).map((row, idx) => (
                        <tr
                          key={`${row.serialNumber}-${idx}`}
                          onClick={() => {
                            onClose();
                            onInspectUnit(row.serialNumber);
                          }}
                          className="hover:bg-[#F7FBF8] cursor-pointer"
                        >
                          <td className="py-2 px-3 font-mono-tabular text-[#2563EB] font-medium hover:underline">
                            {row.serialNumber}
                          </td>
                          <td className="py-2 px-3 text-[#EF4444] font-medium">
                            {row.defectType}
                          </td>
                          <td className="py-2 px-3 font-mono-tabular text-[#374151]">
                            {row.componentRef}
                          </td>
                          <td className="py-2 px-3 text-[#4B5563]">{row.rootCause}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
