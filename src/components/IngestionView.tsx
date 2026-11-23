import { useEffect, useState, type FormEvent } from 'react';
import {
  Camera,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { readAndResizePcbImage } from '../lib/imageUpload.ts';
import type { BoardModelOption } from '../types/boardsight.ts';

interface IngestionViewProps {
  boardModels: BoardModelOption[];
  selectedBoardModel?: string;
  onBoardModelChange?: (boardModelCode: string) => void;
  operatorName: string;
  onIngestionSuccess: (
    boardModelCode: string,
    createdSerialNumber?: string
  ) => void;
}

interface ApiKeyItem {
  id: number;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface DraftDefect {
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
  confidence?: number;
}

const DEFECT_TYPES = [
  'Missing Component',
  'Solder Bridge',
  'Misalignment',
  'Short Circuit',
  'Wrong Polarity',
] as const;

export function IngestionView({
  boardModels,
  selectedBoardModel,
  onBoardModelChange,
  operatorName,
  onIngestionSuccess,
}: IngestionViewProps) {
  const [tab, setTab] = useState<'manual' | 'file' | 'webhook'>('manual');

  // Structured manual inspection state
  const [serialNumber, setSerialNumber] = useState('');
  const [boardModelCode, setBoardModelCode] = useState(
    selectedBoardModel || boardModels[0]?.code || 'Model X12'
  );
  const [batchCode, setBatchCode] = useState('');
  const [shift, setShift] = useState('A');
  const [line, setLine] = useState('');
  const [stationId, setStationId] = useState('');
  const [status, setStatus] = useState<'FAIL' | 'PASS'>('FAIL');
  const [scanImageUrl, setScanImageUrl] = useState<string | null>(null);
  const [visionScanning, setVisionScanning] = useState(false);
  const [visionSummary, setVisionSummary] = useState<string | null>(null);
  const [activePinIndex, setActivePinIndex] = useState(0);

  const [defects, setDefects] = useState<DraftDefect[]>([
    {
      defectType: 'Missing Component',
      componentRef: '',
      severity: 'CRITICAL',
      posX: 50,
      posY: 50,
      rootCause: '',
      correctiveAction: '',
    },
  ]);

  // File import state
  const [fileText, setFileText] = useState('');
  const [fileKind, setFileKind] = useState<'csv' | 'json'>('csv');

  // API keys state
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null
  );

  const activeBoard =
    boardModels.find((m) => m.code === boardModelCode) || boardModels[0];

  useEffect(() => {
    if (selectedBoardModel && boardModels.some((m) => m.code === selectedBoardModel)) {
      setBoardModelCode(selectedBoardModel);
      return;
    }
    setBoardModelCode((prev) => {
      if (boardModels.length > 0 && !boardModels.some((m) => m.code === prev)) {
        return boardModels[0].code;
      }
      return prev;
    });
  }, [boardModels, selectedBoardModel]);

  useEffect(() => {
    if (tab !== 'webhook') return;
    apiFetch('/api/auth/api-keys')
      .then((r) => r.json())
      .then((d) => setApiKeys(d.keys || []))
      .catch(() => {});
  }, [tab]);

  async function handleScanImageUpload(file: File | undefined) {
    if (!file) return;
    setFeedback(null);
    setVisionSummary(null);
    try {
      const dataUrl = await readAndResizePcbImage(file);
      setScanImageUrl(dataUrl);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Failed to load PCB scan image.',
      });
    }
  }

  async function handleAnalyzeScanWithAi() {
    if (!scanImageUrl) return;
    setVisionScanning(true);
    setFeedback(null);
    setVisionSummary(null);
    try {
      const res = await apiFetch('/api/inspections/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl: scanImageUrl,
          boardModelCode,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Optical vision analysis failed.');

      setVisionSummary(json.summary || 'Optical scan processed.');
      if (json.recommendedStatus === 'PASS' || !json.findings?.length) {
        setStatus('PASS');
        setDefects([]);
        setActivePinIndex(0);
      } else {
        setStatus('FAIL');
        setDefects(
          json.findings.map((f: DraftDefect) => ({
            defectType: f.defectType,
            componentRef: f.componentRef,
            severity: f.severity,
            posX: f.posX,
            posY: f.posY,
            rootCause: f.rootCause,
            correctiveAction: f.correctiveAction,
            confidence: f.confidence,
          }))
        );
        setActivePinIndex(0);
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'AI Vision analysis failed.',
      });
    } finally {
      setVisionScanning(false);
    }
  }

  async function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setSubmitting(true);

    try {
      const sn = serialNumber.trim();
      const res = await apiFetch('/api/inspections/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialNumber: sn,
          boardModelCode,
          batchCode: batchCode.trim(),
          shift: shift.trim(),
          line: line.trim(),
          stationId: stationId.trim(),
          operatorName,
          status,
          source: 'MANUAL_ENTRY',
          scanImageUrl: scanImageUrl || undefined,
          defects: status === 'FAIL' ? defects : [],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to record inspection.');
      setFeedback({
        type: 'ok',
        msg: `Persisted inspection ${sn} (${json.defectsInserted} defect(s)) to PostgreSQL. Queued for operator verification.`,
      });
      setSerialNumber('');
      setScanImageUrl(null);
      setVisionSummary(null);
      onIngestionSuccess(boardModelCode, sn);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Ingestion failed.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFileSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setSubmitting(true);

    try {
      if (!fileText.trim()) {
        throw new Error('Select or paste a real AOI CSV or JSON payload first.');
      }

      const res =
        fileKind === 'csv'
          ? await apiFetch('/api/inspections/ingest-csv', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ csvText: fileText }),
            })
          : await apiFetch('/api/inspections/ingest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(JSON.parse(fileText)),
            });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'File ingestion failed.');
      setFeedback({
        type: 'ok',
        msg: `Ingested ${json.insertedCount} board inspection(s) and ${json.defectsInserted} defect(s).${
          json.skippedSerials?.length
            ? ` Skipped ${json.skippedSerials.length} existing serial(s).`
            : ''
        }`,
      });
      setFileText('');
      onIngestionSuccess(boardModelCode);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Failed to ingest file.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateApiKey(e: FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setFeedback(null);
    const res = await apiFetch('/api/auth/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName.trim() }),
    });
    const json = await res.json();
    if (res.ok) {
      setRevealedKey(json.rawKey);
      setApiKeys((prev) => [json.key, ...prev]);
      setNewKeyName('');
    } else {
      setFeedback({ type: 'err', msg: json.error || 'Could not create API key.' });
    }
  }

  async function handleDeleteApiKey(id: number) {
    await apiFetch(`/api/auth/api-keys/${id}`, { method: 'DELETE' });
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
  }

  function downloadCsvTemplate() {
    const csv = [
      'serialNumber,boardModel,batchCode,shift,line,operator,stationId,status,defectType,componentRef,severity,posX,posY,rootCause,correctiveAction',
      'SSX-23-045900,Model X12,1203,A,3,Michael Johnson,AOI-03,FAIL,Solder Bridge,IC102,CRITICAL,57.2,42.5,Excess Solder Paste Volume,Clean stencil underside',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'boardsight-aoi-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const safeActiveIdx =
    defects.length > 0 ? Math.min(activePinIndex, defects.length - 1) : 0;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#EAECEF] rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[16px] font-semibold text-[#111827]">
              AOI Station &amp; PCB Scan Processing
            </h2>
            <p className="text-[12.5px] text-[#6B7280] mt-0.5">
              Upload a unit PCB optical scan for AI-assisted inspection, pin defects on
              the board layout, import CSV/JSON logs, or connect AOI machine webhooks.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#F3F4F6] rounded-lg">
            <button
              type="button"
              onClick={() => {
                setTab('manual');
                setFeedback(null);
              }}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'manual'
                  ? 'bg-white text-[#111827] shadow-2xs'
                  : 'text-[#6B7280] hover:text-[#111827]'
              }`}
            >
              PCB Scan &amp; Entry
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('file');
                setFeedback(null);
              }}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'file'
                  ? 'bg-white text-[#111827] shadow-2xs'
                  : 'text-[#6B7280] hover:text-[#111827]'
              }`}
            >
              CSV / JSON Import
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('webhook');
                setFeedback(null);
              }}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'webhook'
                  ? 'bg-white text-[#111827] shadow-2xs'
                  : 'text-[#6B7280] hover:text-[#111827]'
              }`}
            >
              AOI Webhook Keys
            </button>
          </div>
        </div>

        {feedback && (
          <div
            className={`mt-4 rounded-lg border px-4 py-2.5 text-[12.5px] flex items-center gap-2 ${
              feedback.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {feedback.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{feedback.msg}</span>
          </div>
        )}
      </div>

      {tab === 'manual' && (
        <form
          onSubmit={handleManualSubmit}
          className="grid grid-cols-1 lg:grid-cols-12 gap-4"
        >
          <div className="lg:col-span-7 bg-white border border-[#EAECEF] rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold text-[#111827]">
                Board Inspection Payload
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] cursor-pointer text-[#374151]">
                  <Camera className="w-3.5 h-3.5" />
                  <span>{scanImageUrl ? 'Replace PCB Scan' : 'Upload Unit PCB Scan'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => handleScanImageUpload(e.target.files?.[0])}
                  />
                </label>

                {scanImageUrl && (
                  <button
                    type="button"
                    disabled={visionScanning}
                    onClick={handleAnalyzeScanWithAi}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg disabled:opacity-60"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{visionScanning ? 'Processing Scan...' : 'AI Optical Scan'}</span>
                  </button>
                )}
              </div>
            </div>

            {visionSummary && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3.5 py-2.5 text-[12px] text-blue-900">
                <span className="font-semibold">AI Optical Scan Result: </span>
                {visionSummary}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[11.5px] font-medium text-[#6B7280] mb-1">
                  Board Serial Number
                </label>
                <input
                  type="text"
                  required
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder="e.g. SSX-23-045901"
                  className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#229A45] font-mono-tabular"
                />
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-[#6B7280] mb-1">
                  Board Model
                </label>
                <select
                  value={boardModelCode}
                  onChange={(e) => {
                    const next = e.target.value;
                    setBoardModelCode(next);
                    onBoardModelChange?.(next);
                  }}
                  className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#229A45]"
                >
                  {boardModels.map((m) => (
                    <option key={m.id} value={m.code}>
                      {m.code} ({m.displayName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-[#6B7280] mb-1">
                  Batch Code
                </label>
                <input
                  type="text"
                  required
                  value={batchCode}
                  onChange={(e) => setBatchCode(e.target.value)}
                  placeholder="e.g. 1203"
                  className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#229A45]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11.5px] font-medium text-[#6B7280] mb-1">
                    Shift
                  </label>
                  <select
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                    className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg bg-white"
                  >
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11.5px] font-medium text-[#6B7280] mb-1">
                    Line
                  </label>
                  <input
                    type="text"
                    required
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                    placeholder="e.g. 3"
                    className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-[#6B7280] mb-1">
                  AOI Station ID
                </label>
                <input
                  type="text"
                  required
                  value={stationId}
                  onChange={(e) => setStationId(e.target.value)}
                  placeholder="e.g. AOI-03"
                  className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg"
                />
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-[#6B7280] mb-1">
                  Inspection Result
                </label>
                <select
                  value={status}
                  onChange={(e) => {
                    const next = e.target.value as 'FAIL' | 'PASS';
                    setStatus(next);
                    if (next === 'FAIL' && defects.length === 0) {
                      setDefects([
                        {
                          defectType: 'Missing Component',
                          componentRef: '',
                          severity: 'CRITICAL',
                          posX: 50,
                          posY: 50,
                          rootCause: '',
                          correctiveAction: '',
                        },
                      ]);
                      setActivePinIndex(0);
                    }
                  }}
                  className="w-full px-3 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg bg-white"
                >
                  <option value="FAIL">FAIL (Log Defects)</option>
                  <option value="PASS">PASS (Zero Defects)</option>
                </select>
              </div>
            </div>

            {status === 'FAIL' && (
              <div className="pt-3 border-t border-[#EAECEF] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[#111827]">
                    Defect Findings ({defects.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextIdx = defects.length;
                      setDefects((prev) => [
                        ...prev,
                        {
                          defectType: 'Solder Bridge',
                          componentRef: '',
                          severity: 'CRITICAL',
                          posX: 50,
                          posY: 50,
                          rootCause: '',
                          correctiveAction: '',
                        },
                      ]);
                      setActivePinIndex(nextIdx);
                    }}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-[#229A45] hover:text-[#1B7E38]"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Defect Pin
                  </button>
                </div>

                {defects.map((def, idx) => {
                  const isPinActive = safeActiveIdx === idx;
                  return (
                    <div
                      key={idx}
                      onClick={() => setActivePinIndex(idx)}
                      className={`border rounded-xl p-3.5 space-y-2.5 transition-colors cursor-pointer ${
                        isPinActive
                          ? 'border-[#229A45] bg-[#F7FBF8]'
                          : 'border-[#EAECEF] bg-[#FAFAFB]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-[#374151]">
                            Pin #{idx + 1} · ({def.posX.toFixed(1)}%, {def.posY.toFixed(1)}%)
                          </span>
                          <span
                            className={`text-[10.5px] font-medium px-2 py-0.5 rounded ${
                              isPinActive
                                ? 'bg-[#229A45] text-white'
                                : 'bg-[#E5E7EB] text-[#4B5563]'
                            }`}
                          >
                            {isPinActive ? 'Active on PCB' : 'Click to Place'}
                          </span>
                        </div>
                        {defects.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDefects((prev) => prev.filter((_, i) => i !== idx));
                              setActivePinIndex(0);
                            }}
                            className="text-[#9CA3AF] hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <select
                          value={def.defectType}
                          onChange={(e) => {
                            const val = e.target.value as DraftDefect['defectType'];
                            setDefects((prev) =>
                              prev.map((d, i) =>
                                i === idx ? { ...d, defectType: val } : d
                              )
                            );
                          }}
                          className="px-2.5 py-1.5 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
                        >
                          {DEFECT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>

                        <input
                          type="text"
                          required
                          value={def.componentRef}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDefects((prev) =>
                              prev.map((d, i) =>
                                i === idx ? { ...d, componentRef: val } : d
                              )
                            );
                          }}
                          placeholder="Ref e.g. C9"
                          className="px-2.5 py-1.5 text-[12px] border border-[#E5E7EB] rounded-lg bg-white font-mono-tabular"
                        />

                        <select
                          value={def.severity}
                          onChange={(e) => {
                            const val = e.target.value as 'CRITICAL' | 'WARNING';
                            setDefects((prev) =>
                              prev.map((d, i) => (i === idx ? { ...d, severity: val } : d))
                            );
                          }}
                          className="px-2.5 py-1.5 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
                        >
                          <option value="CRITICAL">CRITICAL</option>
                          <option value="WARNING">WARNING</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input
                          type="text"
                          required
                          value={def.rootCause}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDefects((prev) =>
                              prev.map((d, i) => (i === idx ? { ...d, rootCause: val } : d))
                            );
                          }}
                          placeholder="Root Cause"
                          className="px-2.5 py-1.5 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
                        />
                        <input
                          type="text"
                          required
                          value={def.correctiveAction}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDefects((prev) =>
                              prev.map((d, i) =>
                                i === idx ? { ...d, correctiveAction: val } : d
                              )
                            );
                          }}
                          placeholder="Corrective Action"
                          className="px-2.5 py-1.5 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-[#5AC16D] hover:bg-[#49B05C] disabled:opacity-60 text-white text-[12.5px] font-semibold rounded-lg transition-colors"
            >
              {submitting ? 'Persisting to PostgreSQL...' : 'Record Inspection'}
            </button>
          </div>

          {/* Interactive Coordinate Picker */}
          <div className="lg:col-span-5 bg-white border border-[#EAECEF] rounded-xl p-5 flex flex-col items-center justify-center">
            <p className="text-[12.5px] font-semibold text-[#111827] mb-1">
              {status === 'FAIL' && defects.length > 0
                ? `Click PCB Surface to Place Pin #${safeActiveIdx + 1}`
                : 'PCB Inspection Scan Preview'}
            </p>
            <p className="text-[11.5px] text-[#6B7280] mb-4 text-center">
              {scanImageUrl
                ? 'Showing uploaded unit optical capture. Exact X/Y pins save to PostgreSQL.'
                : 'Select any finding card on the left, then click PCB to place its X/Y pin.'}
            </p>
            <div
              onClick={(e) => {
                if (status !== 'FAIL' || defects.length === 0) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const posX = Number(
                  Math.min(96, Math.max(4, ((e.clientX - rect.left) / rect.width) * 100)).toFixed(1)
                );
                const posY = Number(
                  Math.min(96, Math.max(4, ((e.clientY - rect.top) / rect.height) * 100)).toFixed(1)
                );
                setDefects((prev) =>
                  prev.map((d, i) =>
                    i === safeActiveIdx ? { ...d, posX, posY } : d
                  )
                );
              }}
              className="relative w-[290px] sm:w-[320px] aspect-square rounded-[20px] overflow-hidden cursor-crosshair shadow-md bg-[#2F4A4E]"
            >
              <img
                src={
                  scanImageUrl ||
                  activeBoard?.pcbImageUrl ||
                  '/src/assets/images/pcb_board_topdown_1795410465435.jpg'
                }
                alt="PCB coordinate selector"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover select-none"
              />
              {status === 'FAIL' &&
                defects.map((def, idx) => (
                  <div
                    key={idx}
                    style={{ left: `${def.posX}%`, top: `${def.posY}%` }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/90 shadow flex items-center justify-center pointer-events-none ${
                      safeActiveIdx === idx ? 'ring-2 ring-[#229A45] scale-115' : ''
                    }`}
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        def.severity === 'CRITICAL' ? 'bg-[#EF4444]' : 'bg-[#FACC15]'
                      }`}
                    />
                  </div>
                ))}
            </div>
            {scanImageUrl && (
              <button
                type="button"
                onClick={() => {
                  setScanImageUrl(null);
                  setVisionSummary(null);
                }}
                className="mt-3 text-[11.5px] text-[#6B7280] hover:text-red-600 underline"
              >
                Clear uploaded unit photo
              </button>
            )}
          </div>
        </form>
      )}

      {tab === 'file' && (
        <form
          onSubmit={handleFileSubmit}
          className="bg-white border border-[#EAECEF] rounded-xl p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label className="text-[12.5px] font-medium text-[#374151]">
                Format:
              </label>
              <select
                value={fileKind}
                onChange={(e) => setFileKind(e.target.value as 'csv' | 'json')}
                className="px-3 py-1.5 text-[12px] border border-[#E5E7EB] rounded-lg bg-white"
              >
                <option value="csv">AOI CSV Export</option>
                <option value="json">Structured JSON Payload</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadCsvTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB]"
              >
                <Download className="w-3.5 h-3.5" /> Download CSV Template
              </button>

              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] cursor-pointer">
                <Upload className="w-3.5 h-3.5" /> Load File
                <input
                  type="file"
                  accept=".csv,.json,.txt"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const txt = await file.text();
                    setFileText(txt);
                    if (file.name.endsWith('.json')) setFileKind('json');
                    else setFileKind('csv');
                  }}
                />
              </label>
            </div>
          </div>

          <textarea
            rows={8}
            value={fileText}
            onChange={(e) => setFileText(e.target.value)}
            placeholder={
              fileKind === 'csv'
                ? 'serialNumber,boardModel,batchCode,shift,line,operator,stationId,status,defectType,componentRef,severity,posX,posY,rootCause,correctiveAction'
                : '{"records":[{"serialNumber":"SSX-23-045910","boardModelCode":"Model X12","batchCode":"1203","shift":"A","line":"3","status":"FAIL","defects":[...]}]}'
            }
            className="w-full p-3 text-[12px] font-mono-tabular border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#229A45]"
          />

          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 bg-[#5AC16D] hover:bg-[#49B05C] disabled:opacity-60 text-white text-[12.5px] font-semibold rounded-lg transition-colors"
          >
            {submitting ? 'Validating & Importing...' : 'Ingest Uploaded Data'}
          </button>
        </form>
      )}

      {tab === 'webhook' && (
        <div className="bg-white border border-[#EAECEF] rounded-xl p-5 space-y-5">
          <form onSubmit={handleCreateApiKey} className="flex flex-wrap gap-2.5">
            <input
              type="text"
              required
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Station Name (e.g. AOI-Line-3-KohYoung)"
              className="flex-1 min-w-[220px] px-3.5 py-2 text-[12.5px] border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#229A45]"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#5AC16D] hover:bg-[#49B05C] text-white text-[12.5px] font-semibold rounded-lg"
            >
              <KeyRound className="w-3.5 h-3.5" /> Generate Machine Key
            </button>
          </form>

          {revealedKey && (
            <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] text-emerald-900">
                <span className="font-semibold">Copy your X-API-Key now:</span>{' '}
                <code className="font-mono-tabular bg-white px-2 py-0.5 rounded border border-emerald-200">
                  {revealedKey}
                </code>
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(revealedKey)}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-800 hover:underline"
              >
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
            </div>
          )}

          <div className="border border-[#EAECEF] rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse text-[12px]">
              <thead className="bg-[#FAFAFB] border-b border-[#EAECEF] text-[#6B7280]">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Station Name</th>
                  <th className="py-2.5 px-3.5 font-medium">Key Prefix</th>
                  <th className="py-2.5 px-3.5 font-medium">Last Used</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F3F5]">
                {apiKeys.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-[#6B7280]">
                      No AOI station API keys created yet.
                    </td>
                  </tr>
                ) : (
                  apiKeys.map((k) => (
                    <tr key={k.id}>
                      <td className="py-2.5 px-3.5 font-medium text-[#111827]">
                        {k.name}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono-tabular text-[#4B5563]">
                        {k.keyPrefix}••••••••
                      </td>
                      <td className="py-2.5 px-3.5 text-[#6B7280]">
                        {k.lastUsedAt
                          ? new Date(k.lastUsedAt).toLocaleString()
                          : 'Never'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteApiKey(k.id)}
                          className="text-red-600 hover:text-red-700 font-medium"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-[#111827] text-neutral-100 rounded-xl p-4 text-[11.5px] font-mono-tabular overflow-x-auto">
            <div className="text-neutral-400 mb-1.5">
              # External AOI Scanner Webhook Endpoint
            </div>
            <pre>{`curl -X POST ${window.location.origin}/api/inspections/ingest \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <YOUR_STATION_KEY>" \\
  -d '{"serialNumber":"SSX-23-045912","boardModelCode":"Model X12","batchCode":"1203","shift":"A","line":"3","status":"FAIL","source":"AOI_WEBHOOK","defects":[{"defectType":"Missing Component","componentRef":"C9","severity":"CRITICAL","posX":20.5,"posY":26.8,"rootCause":"Feeder Jam","correctiveAction":"Inspect feeder"}]}'`}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
