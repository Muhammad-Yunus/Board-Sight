import { useEffect, useRef, useState } from 'react';
import { Plus, Minus, RotateCcw } from 'lucide-react';
import type { DefectCluster } from '../types/boardsight.ts';

interface PcbDefectMapProps {
  pcbImageUrl: string;
  boardDisplayName: string;
  clusters: DefectCluster[];
  selectedCluster: DefectCluster | null;
  onSelectCluster: (cluster: DefectCluster) => void;
  tall?: boolean;
}

export function PcbDefectMap({
  pcbImageUrl,
  boardDisplayName,
  clusters,
  selectedCluster,
  onSelectCluster,
  tall = false,
}: PcbDefectMapProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [imgError, setImgError] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null
  );

  useEffect(() => {
    setImgError(false);
  }, [pcbImageUrl]);

  const active = selectedCluster || clusters[0] || null;

  function handleZoomIn() {
    setZoom((z) => Math.min(2.4, Number((z + 0.25).toFixed(2))));
  }

  function handleZoomOut() {
    setZoom((z) => {
      const next = Math.max(0.85, Number((z - 0.25).toFixed(2)));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function handleResetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  // Position tooltip neatly next to pin without clipping outside right/bottom edges
  const tooltipOnLeft = active ? active.posX > 60 : false;
  const tooltipAbove = active ? active.posY > 68 : false;

  return (
    <div
      className={`bg-white border border-[#EAECEF] rounded-xl p-4 sm:p-5 relative flex items-center justify-center overflow-hidden select-none ${
        tall ? 'min-h-[540px]' : 'min-h-[430px] h-full'
      }`}
    >
      {/* Interactive Pan/Zoom Stage */}
      <div
        className={`relative flex items-center justify-center w-full h-full ${
          zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        }`}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          if ((e.target as HTMLElement).closest('button')) return;
          setIsDragging(true);
          dragStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            panX: pan.x,
            panY: pan.y,
          };
        }}
        onPointerMove={(e) => {
          if (!isDragging || !dragStartRef.current) return;
          setPan({
            x: dragStartRef.current.panX + (e.clientX - dragStartRef.current.x),
            y: dragStartRef.current.panY + (e.clientY - dragStartRef.current.y),
          });
        }}
        onPointerUp={() => {
          setIsDragging(false);
          dragStartRef.current = null;
        }}
        onPointerLeave={() => {
          setIsDragging(false);
          dragStartRef.current = null;
        }}
      >
        <div
          className="relative w-[290px] sm:w-[345px] md:w-[365px] aspect-square rounded-[22px] overflow-visible transition-transform duration-150 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <div className="w-full h-full rounded-[22px] overflow-hidden shadow-[0_6px_20px_rgba(15,23,42,0.12)] bg-[#2F4A4E] relative">
            {pcbImageUrl && !imgError ? (
              <img
                src={pcbImageUrl}
                alt={`${boardDisplayName} optical PCB top-down scan`}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                draggable={false}
                className="w-full h-full object-cover pointer-events-none"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#2B4347] to-[#1D3135] flex items-center justify-center text-white/75 text-xs font-mono-tabular">
                {boardDisplayName ? `${boardDisplayName} PCB Scan` : 'Loading PCB Scan...'}
              </div>
            )}
          </div>

          {/* Defect Hotspot Pins */}
          {clusters.map((cluster) => {
            const isSelected =
              active?.componentRef === cluster.componentRef &&
              active?.defectType === cluster.defectType;
            const isCritical =
              cluster.severity === 'CRITICAL' ||
              cluster.defectType === 'Solder Bridge' ||
              cluster.defectType === 'Short Circuit';

            return (
              <button
                key={`${cluster.componentRef}-${cluster.defectType}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectCluster(cluster);
                }}
                style={{
                  left: `${cluster.posX}%`,
                  top: `${cluster.posY}%`,
                }}
                aria-label={`Defect ${cluster.index}: ${cluster.defectType} on ${cluster.componentRef}`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-transform duration-150 focus:outline-none ${
                  isSelected ? 'scale-125 z-20' : 'hover:scale-115 z-10'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-[1px] ${
                    isSelected
                      ? 'bg-white/90 ring-2 ring-[#111827]/20 shadow-[0_0_12px_rgba(255,255,255,0.95)]'
                      : 'bg-white/75 shadow-[0_0_8px_rgba(255,255,255,0.8)]'
                  }`}
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isCritical ? 'bg-[#EF4444]' : 'bg-[#FACC15]'
                    }`}
                  />
                </span>
              </button>
            );
          })}

          {/* Floating Callout Card matching mockup */}
          {active && (
            <div
              style={{
                left: `${active.posX}%`,
                top: `${active.posY}%`,
                transform: `translate(${tooltipOnLeft ? 'calc(-100% - 14px)' : '14px'}, ${
                  tooltipAbove ? 'calc(-100% - 10px)' : '-50%'
                })`,
              }}
              className="absolute z-30 bg-white border border-[#EAECEF] rounded-xl shadow-[0_10px_28px_rgba(17,24,39,0.14)] px-4 py-3 min-w-[225px] max-w-[265px] pointer-events-auto"
            >
              <div className="text-[12px] leading-snug">
                <span className="font-medium text-[#111827]">
                  Defect #{active.index}:{' '}
                </span>
                <span className="font-semibold text-[#EF4444]">
                  {active.defectType} – {active.componentRef}
                </span>
              </div>
              <div className="mt-1.5 text-[12px] text-[#4B5563]">
                Count:{' '}
                <span className="font-semibold text-[#111827] tabular-nums">
                  {active.count}
                </span>
              </div>
              <div className="mt-1 text-[12px] text-[#4B5563]">
                Last Seen:{' '}
                <span className="font-semibold text-[#111827] tabular-nums">
                  {active.lastSeen}
                </span>
              </div>
              <div className="mt-1 pt-1 border-t border-[#F1F3F5] text-[11px] text-[#6B7280] leading-snug">
                Cause: <span className="text-[#374151] font-medium">{active.rootCause}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Empty State if filter removes all defects */}
      {pcbImageUrl && clusters.length === 0 && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex flex-col items-center justify-center p-6 text-center z-20">
          <p className="text-[13.5px] font-semibold text-[#111827]">
            Zero defects mapped for current filter
          </p>
          <p className="text-[12px] text-[#6B7280] mt-1">
            All boards in this selection passed optical inspection.
          </p>
        </div>
      )}

      {/* Bottom-Left Zoom Controls matching mockup */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 z-30">
        <button
          type="button"
          onClick={handleZoomIn}
          title="Zoom in PCB scan"
          aria-label="Zoom in PCB scan"
          className="w-8 h-8 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[#374151] flex items-center justify-center shadow-2xs transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          title="Zoom out PCB scan"
          aria-label="Zoom out PCB scan"
          className="w-8 h-8 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[#374151] flex items-center justify-center shadow-2xs transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
          <button
            type="button"
            onClick={handleResetView}
            title="Reset zoom and pan"
            aria-label="Reset zoom and pan"
            className="w-8 h-8 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[#374151] flex items-center justify-center shadow-2xs transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
