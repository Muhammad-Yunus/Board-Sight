import { useState, type FormEvent } from 'react';
import { CheckCircle2, ClipboardCheck, Plus, Search, Upload } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { readAndResizePcbImage } from '../lib/imageUpload.ts';
import { PcbDefectMap } from './PcbDefectMap.tsx';
import type { DashboardData, DefectCluster } from '../types/boardsight.ts';

interface ShiftAnalyticsViewProps {
  data: DashboardData;
  onInspectBatch: (batchCode: string, batchId: number) => void;
  onReviewInspection: (inspectionId: number) => void;
}

const REVIEW_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING_REVIEW: {
    label: 'Pending Review',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  CONFIRMED_FAIL: {
    label: 'Confirmed Fail',
    cls: 'bg-red-50 text-red-700 border-red-200',
  },
  FALSE_CALL: {
    label: 'False Call',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  REWORKED: {
    label: 'Reworked',
    cls: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  SCRAPPED: {
    label: 'Scrapped',
    cls: 'bg-neutral-100 text-neutral-700 border-neutral-300',
  },
  PASS_VERIFIED: {
    label: 'Pass Verified',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
};

export function ShiftAnalyticsView({
  data,
  onInspectBatch,
  onReviewInspection,
}: ShiftAnalyticsViewProps) {
  const [reviewFilter, setReviewFilter] = useState<string>('ALL');
  const [searchSn, setSearchSn] = useState('');

  const filteredInspections = data.recentInspections.filter((insp) => {
    if (reviewFilter !== 'ALL' && insp.reviewStatus !== reviewFilter) return false;
    if (
      searchSn.trim() &&
      !insp.serialNumber.toLowerCase().includes(searchSn.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#EAECEF] rounded-xl p-5">
        <h2 className="text-[16px] font-semibold text-[#111827]">
          Shift &amp; Production Line Performance
        </h2>
        <p className="text-[12.5px] text-[#6B7280] mt-0.5">
          Yield, defect density, and QA gate status aggregated from PostgreSQL across
          active batches for {data.header.boardDisplayName}.
        </p>

        <div className="mt-4 overflow-x-auto border border-[#EAECEF] rounded-xl">
          <table className="w-full text-left border-collapse text-[12.5px]">
            <thead className="bg-[#FAFAFB] border-b border-[#EAECEF] text-[#6B7280]">
              <tr>
                <th className="py-3 px-4 font-medium">Batch</th>
                <th className="py-3 px-4 font-medium">Shift / Line</th>
                <th className="py-3 px-4 font-medium">Date</th>
                <th className="py-3 px-4 font-medium">QA Status</th>
                <th className="py-3 px-4 font-medium text-right">Inspected</th>
                <th className="py-3 px-4 font-medium text-right">Defective</th>
                <th className="py-3 px-4 font-medium text-right">Defect Rate</th>
                <th className="py-3 px-4 font-medium text-right">Yield</th>
                <th className="py-3 px-4 font-medium text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F3F5]">
              {data.batches.map((b) => (
                <tr key={b.id} className="hover:bg-[#FAFAFB]">
                  <td className="py-3 px-4 font-semibold text-[#111827] font-mono-tabular">
                    Batch {b.batchCode}
                  </td>
                  <td className="py-3 px-4 text-[#374151]">
                    Shift {b.shift} · Line {b.line}
                  </td>
                  <td className="py-3 px-4 text-[#6B7280] tabular-nums">
                    {b.shiftDate}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                        b.status === 'HOLD_REVIEW'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : b.status === 'RELEASED'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-[#111827]">
                    {b.totalInspected}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-[#EF4444] font-medium">
                    {b.defectiveBoards}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-semibold text-[#F59E0B]">
                    {b.defectRatePct.toFixed(1)}%
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-semibold text-[#16A34A]">
                    {b.yieldPct.toFixed(1)}%
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => onInspectBatch(b.batchCode, b.id)}
                      className="text-[#2563EB] hover:underline font-medium text-[12px]"
                    >
                      Inspect Batch
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Operator Review Queue & Board Inspection Ledger */}
      <div className="bg-white border border-[#EAECEF] rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
          <div>
            <h3 className="text-[15px] font-semibold text-[#111827]">
              Operator Review Queue &amp; Inspection Ledger
            </h3>
            <p className="text-[12px] text-[#6B7280]">
              Click any board unit to inspect defects, mark false calls, or log rework.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchSn}
                onChange={(e) => setSearchSn(e.target.value)}
                placeholder="Search SN..."
                className="pl-8 pr-3 py-1.5 text-[12px] border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#229A45]"
              />
            </div>

            <select
              value={reviewFilter}
              onChange={(e) => setReviewFilter(e.target.value)}
              className="px-2.5 py-1.5 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
            >
              <option value="ALL">All Review States</option>
              <option value="PENDING_REVIEW">Pending Review</option>
              <option value="CONFIRMED_FAIL">Confirmed Fail</option>
              <option value="REWORKED">Reworked</option>
              <option value="FALSE_CALL">False Call</option>
              <option value="SCRAPPED">Scrapped</option>
              <option value="PASS_VERIFIED">Pass Verified</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto border border-[#EAECEF] rounded-xl">
          <table className="w-full text-left border-collapse text-[12px]">
            <thead className="bg-[#FAFAFB] border-b border-[#EAECEF] text-[#6B7280]">
              <tr>
                <th className="py-2.5 px-3.5 font-medium">Serial Number</th>
                <th className="py-2.5 px-3.5 font-medium">Batch / Shift</th>
                <th className="py-2.5 px-3.5 font-medium">Operator</th>
                <th className="py-2.5 px-3.5 font-medium">Primary Finding</th>
                <th className="py-2.5 px-3.5 font-medium">AOI Status</th>
                <th className="py-2.5 px-3.5 font-medium">Review State</th>
                <th className="py-2.5 px-3.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F3F5]">
              {filteredInspections.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-[#6B7280]">
                    No board inspection units match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredInspections.map((insp) => {
                  const badge = REVIEW_BADGE[insp.reviewStatus] || REVIEW_BADGE.PENDING_REVIEW;
                  return (
                    <tr
                      key={insp.id}
                      onClick={() => onReviewInspection(insp.id)}
                      className="hover:bg-[#F7FBF8] cursor-pointer"
                    >
                      <td className="py-2.5 px-3.5 font-mono-tabular font-medium text-[#111827]">
                        {insp.serialNumber}
                      </td>
                      <td className="py-2.5 px-3.5 text-[#4B5563]">
                        Batch {insp.batchCode} · Shift {insp.shift}
                      </td>
                      <td className="py-2.5 px-3.5 text-[#374151]">{insp.operatorName}</td>
                      <td className="py-2.5 px-3.5 text-[#374151]">{insp.primaryDefect}</td>
                      <td className="py-2.5 px-3.5">
                        <span
                          className={`font-semibold ${
                            insp.status === 'FAIL' ? 'text-[#EF4444]' : 'text-[#16A34A]'
                          }`}
                        >
                          {insp.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5">
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded border ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onReviewInspection(insp.id);
                          }}
                          className="inline-flex items-center gap-1 text-[#229A45] hover:text-[#1B7E38] font-semibold"
                        >
                          <ClipboardCheck className="w-3.5 h-3.5" /> Review
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface BoardModelsViewProps {
  data: DashboardData;
  onSelectModel: (code: string) => void;
  onModelsUpdated: (selectCode?: string) => void;
}

export function BoardModelsView({
  data,
  onSelectModel,
  onModelsUpdated,
}: BoardModelsViewProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [pcbImageUrl, setPcbImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null
  );

  async function handleDesignFileChange(file: File | undefined) {
    if (!file) return;
    setFeedback(null);
    try {
      const dataUrl = await readAndResizePcbImage(file);
      setPcbImageUrl(dataUrl);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Failed to process PCB image.',
      });
    }
  }

  async function handleCreateModel(e: FormEvent) {
    e.preventDefault();
    if (!pcbImageUrl) {
      setFeedback({
        type: 'err',
        msg: 'Please upload a top-down PCB design or layout image (PNG, JPG, or WebP).',
      });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/board-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          displayName: displayName.trim(),
          pcbImageUrl,
          description: description.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to register board model.');
      setFeedback({
        type: 'ok',
        msg: `Registered PCB model ${json.boardModel.code} (${json.boardModel.displayName}).`,
      });
      setCode('');
      setDisplayName('');
      setDescription('');
      setPcbImageUrl('');
      setShowCreate(false);
      onModelsUpdated(json.boardModel.code);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Could not create board model.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateModelImage(modelId: number, file: File | undefined) {
    if (!file) return;
    setFeedback(null);
    try {
      const dataUrl = await readAndResizePcbImage(file);
      const res = await apiFetch(`/api/board-models/${modelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pcbImageUrl: dataUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update PCB design image.');
      setFeedback({
        type: 'ok',
        msg: `Updated PCB reference layout for ${json.boardModel.code}.`,
      });
      onModelsUpdated();
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Could not update PCB image.',
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#EAECEF] rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-[16px] font-semibold text-[#111827]">
              PCB Hardware Models &amp; Reference Designs
            </h2>
            <p className="text-[12.5px] text-[#6B7280] mt-0.5">
              Upload master top-down PCB layouts for new hardware revisions or switch the active inspection model.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowCreate((v) => !v);
              setFeedback(null);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#5AC16D] hover:bg-[#49B05C] text-white text-[12px] font-semibold rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showCreate ? 'Close Design Form' : 'Upload PCB Design'}</span>
          </button>
        </div>

        {feedback && (
          <div
            className={`mb-4 rounded-lg border px-4 py-2.5 text-[12.5px] flex items-center gap-2 ${
              feedback.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {feedback.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{feedback.msg}</span>
          </div>
        )}

        {showCreate && (
          <form
            onSubmit={handleCreateModel}
            className="mb-5 border border-[#EAECEF] bg-[#FAFAFB] rounded-xl p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-start"
          >
            <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11.5px] font-medium text-[#6B7280] mb-1">
                  Model Code
                </label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. Model Z4"
                  className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#229A45]"
                />
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-[#6B7280] mb-1">
                  Hardware Revision Name
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. IoT Gateway Ctrl v3.1"
                  className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#229A45]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11.5px] font-medium text-[#6B7280] mb-1">
                  Board Assembly Notes / Spec
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. 6-layer ENIG SMT board, 0402 passives + QFN-48 MCU"
                  className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#229A45]"
                />
              </div>

              <div className="sm:col-span-2 flex flex-wrap items-center gap-2.5 pt-1">
                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium border border-[#E5E7EB] bg-white rounded-lg hover:bg-[#F3F4F6] cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{pcbImageUrl ? 'Change PCB Design Image' : 'Select PCB Layout Image'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => handleDesignFileChange(e.target.files?.[0])}
                  />
                </label>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-[#5AC16D] hover:bg-[#49B05C] disabled:opacity-60 text-white text-[12px] font-semibold rounded-lg transition-colors"
                >
                  {saving ? 'Registering...' : 'Save Board Model'}
                </button>
              </div>
            </div>

            <div className="md:col-span-4 flex flex-col items-center">
              <div className="w-36 h-36 rounded-xl border border-dashed border-[#D1D5DB] bg-white overflow-hidden flex items-center justify-center text-[11.5px] text-[#9CA3AF] text-center p-2">
                {pcbImageUrl ? (
                  <img
                    src={pcbImageUrl}
                    alt="New PCB layout preview"
                    className="w-full h-full object-cover rounded-lg"
                  />
                ) : (
                  <span>PCB Top-Down Image Preview</span>
                )}
              </div>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.filterOptions.boardModels.map((model) => {
            const isActive = model.code === data.header.boardModelCode;
            return (
              <div
                key={model.id}
                className={`border rounded-xl p-4 flex items-center gap-4 transition-colors ${
                  isActive ? 'border-[#229A45] bg-[#F7FBF8]' : 'border-[#EAECEF] bg-white'
                }`}
              >
                <img
                  src={model.pcbImageUrl}
                  alt={model.displayName}
                  referrerPolicy="no-referrer"
                  className="w-20 h-20 rounded-xl object-cover shrink-0 bg-[#2F4A4E]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[14.5px] font-semibold text-[#111827] truncate">
                      {model.displayName}
                    </h3>
                    <span className="text-[11.5px] font-mono-tabular text-[#6B7280]">
                      {model.code}
                    </span>
                  </div>
                  <p className="text-[12px] text-[#6B7280] mt-1 line-clamp-2">
                    {model.description}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectModel(model.code)}
                      className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                        isActive
                          ? 'bg-[#229A45] text-white'
                          : 'border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[#111827]'
                      }`}
                    >
                      {isActive ? 'Active Inspection Model' : 'Load Model Analytics'}
                    </button>

                    <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[#4B5563] cursor-pointer">
                      <Upload className="w-3 h-3" />
                      <span>Update Image</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => handleUpdateModelImage(model.id, e.target.files?.[0])}
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface DefectMapExplorerViewProps {
  data: DashboardData;
  selectedCluster: DefectCluster | null;
  onSelectCluster: (c: DefectCluster) => void;
}

export function DefectMapExplorerView({
  data,
  selectedCluster,
  onSelectCluster,
}: DefectMapExplorerViewProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div className="lg:col-span-7">
        <PcbDefectMap
          pcbImageUrl={data.header.pcbImageUrl}
          boardDisplayName={data.header.boardDisplayName}
          clusters={data.defectMap}
          selectedCluster={selectedCluster}
          onSelectCluster={onSelectCluster}
          tall
        />
      </div>

      <div className="lg:col-span-5 bg-white border border-[#EAECEF] rounded-xl p-5">
        <h2 className="text-[15.5px] font-semibold text-[#111827] mb-3">
          Component Hotspot Directory ({data.defectMap.length})
        </h2>
        <div className="divide-y divide-[#F1F3F5] max-h-[470px] overflow-y-auto">
          {data.defectMap.map((c) => {
            const active =
              selectedCluster?.componentRef === c.componentRef &&
              selectedCluster?.defectType === c.defectType;
            return (
              <button
                key={`${c.componentRef}-${c.defectType}`}
                type="button"
                onClick={() => onSelectCluster(c)}
                className={`w-full text-left py-3 px-3 -mx-1 rounded-lg transition-colors flex items-start justify-between gap-3 ${
                  active ? 'bg-[#F2F7F3]' : 'hover:bg-[#FAFAFB]'
                }`}
              >
                <div>
                  <div className="text-[13px] font-semibold text-[#111827]">
                    #{c.index} · {c.defectType} ({c.componentRef})
                  </div>
                  <div className="text-[11.5px] text-[#6B7280] mt-0.5">
                    {c.rootCause} · Last seen {c.lastSeen}
                  </div>
                </div>
                <span className="text-[13px] font-semibold text-[#EF4444] tabular-nums shrink-0">
                  {c.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
