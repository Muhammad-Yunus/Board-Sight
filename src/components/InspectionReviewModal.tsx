import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert, Wrench, X } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { UnitDefectRecord, UnitInspectionDetail } from '../types/boardsight.ts';

interface InspectionReviewModalProps {
  inspectionIdOrSerial: number | string | null;
  onClose: () => void;
  onReviewSaved: () => void;
}

const REVIEW_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  PENDING_REVIEW: {
    label: 'Pending Operator Review',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  CONFIRMED_FAIL: {
    label: 'Confirmed Fail',
    tone: 'bg-red-50 text-red-700 border-red-200',
  },
  FALSE_CALL: {
    label: 'False Call (Passed)',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  REWORKED: {
    label: 'Reworked & Repaired',
    tone: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  SCRAPPED: {
    label: 'Scrapped',
    tone: 'bg-neutral-100 text-neutral-700 border-neutral-300',
  },
  PASS_VERIFIED: {
    label: 'Pass Verified',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
};

export function InspectionReviewModal({
  inspectionIdOrSerial,
  onClose,
  onReviewSaved,
}: InspectionReviewModalProps) {
  const [detail, setDetail] = useState<UnitInspectionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedDefectId, setSelectedDefectId] = useState<number | null>(null);
  const [defectStatuses, setDefectStatuses] = useState<
    Record<number, UnitDefectRecord['reviewStatus']>
  >({});
  const [reviewStatus, setReviewStatus] =
    useState<UnitInspectionDetail['inspection']['reviewStatus']>('PENDING_REVIEW');
  const [reviewNotes, setReviewNotes] = useState('');

  useEffect(() => {
    if (inspectionIdOrSerial === null || inspectionIdOrSerial === undefined) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch(`/api/inspections/${encodeURIComponent(String(inspectionIdOrSerial))}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load inspection unit.');
        return json as UnitInspectionDetail;
      })
      .then((json) => {
        if (cancelled) return;
        setDetail(json);
        setReviewStatus(json.inspection.reviewStatus || 'PENDING_REVIEW');
        setReviewNotes(json.inspection.reviewNotes || '');
        const initialStatuses: Record<number, UnitDefectRecord['reviewStatus']> = {};
        for (const d of json.defects) {
          initialStatuses[d.id] = d.reviewStatus || 'OPEN';
        }
        setDefectStatuses(initialStatuses);
        setSelectedDefectId(json.defects[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load inspection.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [inspectionIdOrSerial]);

  if (inspectionIdOrSerial === null || inspectionIdOrSerial === undefined) return null;

  async function handleSaveReview() {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      const defectUpdates = detail.defects.map((d) => ({
        id: d.id,
        reviewStatus: defectStatuses[d.id] || 'OPEN',
      }));

      const res = await apiFetch(`/api/inspections/${detail.inspection.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewStatus,
          reviewNotes,
          defectUpdates,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save operator review.');
      onReviewSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review.');
    } finally {
      setSaving(false);
    }
  }

  function applyQuickDisposition(
    nextUnitStatus: UnitInspectionDetail['inspection']['reviewStatus'],
    defectTargetStatus: UnitDefectRecord['reviewStatus']
  ) {
    setReviewStatus(nextUnitStatus);
    if (!detail) return;
    const updated: Record<number, UnitDefectRecord['reviewStatus']> = {};
    for (const d of detail.defects) {
      updated[d.id] = defectTargetStatus;
    }
    setDefectStatuses(updated);
  }

  const badge = detail
    ? REVIEW_STATUS_LABELS[detail.inspection.reviewStatus] || REVIEW_STATUS_LABELS.PENDING_REVIEW
    : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[920px] max-h-[90vh] overflow-y-auto bg-white border border-[#EAECEF] rounded-2xl shadow-2xl p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#EAECEF]">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-[17px] font-semibold text-[#111827] font-mono-tabular">
                {detail ? `Unit Review: ${detail.inspection.serialNumber}` : 'Loading Unit...'}
              </h3>
              {badge && (
                <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-md border ${badge.tone}`}>
                  {badge.label}
                </span>
              )}
            </div>
            {detail && (
              <p className="text-[12.5px] text-[#6B7280] mt-1">
                {detail.inspection.boardDisplayName} ({detail.inspection.boardModelCode}) · Batch{' '}
                {detail.inspection.batchCode} · Shift {detail.inspection.shift} · Line{' '}
                {detail.inspection.line} · Station {detail.inspection.stationId}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close unit review"
            className="w-8 h-8 rounded-lg border border-[#E5E7EB] hover:bg-[#F3F4F6] flex items-center justify-center text-[#374151] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading && (
          <div className="py-12 text-center text-[13px] text-[#6B7280]">
            Loading board inspection scan &amp; defect findings...
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-700">
            {error}
          </div>
        )}

        {detail && !loading && (
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left: Unit Optical PCB Scan */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between text-[12px] text-[#6B7280]">
                <span className="font-medium text-[#111827]">
                  {detail.inspection.scanImageUrl
                    ? 'Unit Optical Capture'
                    : 'Model Reference PCB Layout'}
                </span>
                <span>{detail.defects.length} finding(s)</span>
              </div>

              <div className="relative w-full aspect-square rounded-[18px] overflow-hidden shadow-md bg-[#2F4A4E]">
                <img
                  src={detail.inspection.displayImageUrl}
                  alt={detail.inspection.serialNumber}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                {detail.defects.map((d, idx) => {
                  const currentState = defectStatuses[d.id] || d.reviewStatus;
                  const active = selectedDefectId === d.id;
                  const pinColor =
                    currentState === 'FALSE_POSITIVE'
                      ? 'bg-[#9CA3AF]'
                      : currentState === 'REPAIRED'
                      ? 'bg-[#22C55E]'
                      : d.severity === 'CRITICAL'
                      ? 'bg-[#EF4444]'
                      : 'bg-[#FACC15]';

                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedDefectId(d.id)}
                      style={{ left: `${d.posX}%`, top: `${d.posY}%` }}
                      title={`#${idx + 1} ${d.defectType} (${d.componentRef})`}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/90 shadow flex items-center justify-center transition-transform ${
                        active ? 'scale-125 ring-2 ring-[#111827] z-20' : 'hover:scale-110 z-10'
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${pinColor}`} />
                    </button>
                  );
                })}
              </div>

              <div className="text-[11.5px] text-[#6B7280] bg-[#FAFAFB] border border-[#EAECEF] rounded-lg px-3 py-2 space-y-0.5">
                <div>
                  Logged by <span className="font-medium text-[#111827]">{detail.inspection.operatorName}</span>{' '}
                  via <span className="font-mono-tabular">{detail.inspection.source}</span>
                </div>
                {detail.inspection.reviewedBy && (
                  <div>
                    Last reviewed by{' '}
                    <span className="font-medium text-[#111827]">{detail.inspection.reviewedBy}</span>{' '}
                    on{' '}
                    {detail.inspection.reviewedAt
                      ? new Date(detail.inspection.reviewedAt).toLocaleString()
                      : '—'}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Operator Defect Verification & Unit Disposition */}
            <div className="lg:col-span-7 space-y-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <h4 className="text-[13.5px] font-semibold text-[#111827]">
                    Per-Defect Verification ({detail.defects.length})
                  </h4>
                  {detail.defects.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => applyQuickDisposition('CONFIRMED_FAIL', 'CONFIRMED')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-red-200 bg-red-50 text-red-700 rounded-md hover:bg-red-100"
                      >
                        <ShieldAlert className="w-3 h-3" /> Confirm All
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickDisposition('REWORKED', 'REPAIRED')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-blue-200 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100"
                      >
                        <Wrench className="w-3 h-3" /> Mark Reworked
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickDisposition('FALSE_CALL', 'FALSE_POSITIVE')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-md hover:bg-emerald-100"
                      >
                        <CheckCircle2 className="w-3 h-3" /> False Call (Pass)
                      </button>
                    </div>
                  )}
                </div>

                {detail.defects.length === 0 ? (
                  <div className="border border-[#EAECEF] rounded-xl p-4 text-[12.5px] text-[#6B7280] bg-[#FAFAFB]">
                    Zero defects logged on this board unit.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[260px] overflow-y-auto pr-1">
                    {detail.defects.map((d, idx) => {
                      const active = selectedDefectId === d.id;
                      const currentState = defectStatuses[d.id] || d.reviewStatus;
                      return (
                        <div
                          key={d.id}
                          onClick={() => setSelectedDefectId(d.id)}
                          className={`border rounded-xl p-3 cursor-pointer transition-colors ${
                            active
                              ? 'border-[#229A45] bg-[#F7FBF8]'
                              : 'border-[#EAECEF] bg-white hover:bg-[#FAFAFB]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[12.5px] font-semibold text-[#111827]">
                              #{idx + 1} · {d.defectType}{' '}
                              <span className="font-mono-tabular text-[#4B5563]">
                                ({d.componentRef})
                              </span>
                            </div>
                            <select
                              value={currentState}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setDefectStatuses((prev) => ({
                                  ...prev,
                                  [d.id]: e.target.value as UnitDefectRecord['reviewStatus'],
                                }))
                              }
                              className="px-2.5 py-1 text-[11.5px] font-medium border border-[#E5E7EB] rounded-lg bg-white"
                            >
                              <option value="OPEN">OPEN</option>
                              <option value="CONFIRMED">CONFIRMED</option>
                              <option value="REPAIRED">REPAIRED</option>
                              <option value="FALSE_POSITIVE">FALSE POSITIVE</option>
                            </select>
                          </div>
                          <div className="text-[11.5px] text-[#4B5563] mt-1">
                            Root cause: <span className="font-medium">{d.rootCause}</span> · Coord (
                            {d.posX.toFixed(1)}%, {d.posY.toFixed(1)}%)
                          </div>
                          <div className="text-[11.5px] text-[#6B7280] mt-0.5">
                            Action: {d.correctiveAction}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-[#EAECEF] pt-4 space-y-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#374151] mb-1">
                    Final Unit Disposition
                  </label>
                  <select
                    value={reviewStatus}
                    onChange={(e) =>
                      setReviewStatus(
                        e.target.value as UnitInspectionDetail['inspection']['reviewStatus']
                      )
                    }
                    className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#229A45]"
                  >
                    <option value="PENDING_REVIEW">Pending Operator Review</option>
                    <option value="CONFIRMED_FAIL">Confirmed Fail (Send to Rework)</option>
                    <option value="REWORKED">Reworked &amp; Repaired</option>
                    <option value="FALSE_CALL">False Call (Override to PASS &amp; Update Yield)</option>
                    <option value="SCRAPPED">Scrapped (Beyond Repair)</option>
                    <option value="PASS_VERIFIED">Pass Verified</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-[#374151] mb-1">
                    Operator Review / Rework Notes
                  </label>
                  <textarea
                    rows={2}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Document solder rework performed, false-call reason, or feeder calibration check..."
                    className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#229A45]"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-[12.5px] font-medium border border-[#E5E7EB] rounded-lg text-[#374151] hover:bg-[#F9FAFB]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveReview}
                    className="px-4 py-2 bg-[#5AC16D] hover:bg-[#49B05C] disabled:opacity-60 text-white text-[12.5px] font-semibold rounded-lg transition-colors"
                  >
                    {saving ? 'Saving Review...' : 'Save Operator Review'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
