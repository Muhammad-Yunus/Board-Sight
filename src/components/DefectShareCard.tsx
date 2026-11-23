import { MoreHorizontal } from 'lucide-react';
import type { DefectShareItem } from '../types/boardsight.ts';

interface DefectShareCardProps {
  data: DefectShareItem[];
  totalDefects: number;
  onSelectDefectType: (defectType: string) => void;
}

export function DefectShareCard({
  data,
  totalDefects,
  onSelectDefectType,
}: DefectShareCardProps) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let cumulativeOffset = 0;

  return (
    <div className="bg-white border border-[#EAECEF] rounded-xl p-5 flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-[15.5px] font-semibold text-[#111827] tracking-[-0.01em]">
          Defect Share by Type
        </h2>
        <button
          type="button"
          onClick={() => onSelectDefectType('ALL')}
          title="Reset defect filter"
          aria-label="Reset defect share filter"
          className="w-8 h-8 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] flex items-center justify-center text-[#374151] transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-5 items-center">
        {/* Clean SVG Donut Chart */}
        <div className="relative w-[124px] h-[124px] mx-auto sm:mx-0 shrink-0">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke="#F3F4F6"
              strokeWidth="14"
            />
            {totalDefects > 0 &&
              data.map((item) => {
                const segmentLen = (item.count / totalDefects) * circumference;
                const offset = cumulativeOffset;
                cumulativeOffset += segmentLen;
                if (item.count === 0) return null;
                return (
                  <circle
                    key={item.defectType}
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="14"
                    strokeDasharray={`${segmentLen} ${circumference}`}
                    strokeDashoffset={-offset}
                    className="cursor-pointer transition-opacity hover:opacity-80"
                    onClick={() => onSelectDefectType(item.defectType)}
                  />
                );
              })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[18px] font-semibold text-[#111827] tabular-nums leading-none">
              {totalDefects}
            </span>
            <span className="text-[10.5px] text-[#6B7280] mt-1">Defects</span>
          </div>
        </div>

        {/* Tabular Share Breakdown */}
        <div className="space-y-2.5">
          {data.map((item) => (
            <button
              key={item.defectType}
              type="button"
              onClick={() => onSelectDefectType(item.defectType)}
              className="w-full flex items-center justify-between text-left py-1 px-2 -mx-2 rounded-lg hover:bg-[#F9FAFB] transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-xs shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-[12.5px] text-[#374151] truncate">
                  {item.defectType}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0 tabular-nums">
                <span className="text-[12px] text-[#6B7280]">{item.count}</span>
                <span className="text-[12.5px] font-semibold text-[#111827] w-11 text-right">
                  {item.sharePct.toFixed(1)}%
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
