import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { DefectFrequencyItem } from '../types/boardsight.ts';

interface DefectFrequencyChartProps {
  data: DefectFrequencyItem[];
  activeDefectType: string;
  onSelectDefectType: (defectType: string) => void;
}

export function DefectFrequencyChart({
  data,
  activeDefectType,
  onSelectDefectType,
}: DefectFrequencyChartProps) {
  const [hoveredType, setHoveredType] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const maxCount = Math.max(...data.map((d) => d.count), 6);
  // Compute clean nice axis step (6 ticks: 0, 1*step, ... 6*step)
  const rawStep = Math.ceil(maxCount / 6);
  const step = rawStep <= 1 ? 1 : rawStep <= 2 ? 2 : rawStep <= 5 ? 5 : Math.ceil(rawStep / 5) * 5;
  const axisMax = step * 6;
  const ticks = [0, step, step * 2, step * 3, step * 4, step * 5, axisMax];

  return (
    <div className="bg-white border border-[#EAECEF] rounded-xl p-5 relative">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15.5px] font-semibold text-[#111827] tracking-[-0.01em]">
          Defect Type Frequency
        </h2>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Defect frequency options"
            className="w-8 h-8 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] flex items-center justify-center text-[#374151] transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1.5 w-44 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1 z-30 text-[12px]">
              <button
                type="button"
                onClick={() => {
                  onSelectDefectType('ALL');
                  setMenuOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#F3F4F6] text-[#111827]"
              >
                Show All Defect Types
              </button>
              {data.map((item) => (
                <button
                  key={item.defectType}
                  type="button"
                  onClick={() => {
                    onSelectDefectType(item.defectType);
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#F3F4F6] text-[#4B5563] flex items-center justify-between"
                >
                  <span>{item.defectType}</span>
                  <span className="font-semibold text-[#111827] tabular-nums">
                    {item.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Inner bordered chart container matching mockup */}
      <div className="mt-4 border border-[#F1F3F5] rounded-xl px-3 sm:px-5 pt-4 pb-3">
        <div className="space-y-3">
          {data.map((item) => {
            const widthPct = axisMax > 0 ? Math.max((item.count / axisMax) * 100, item.count > 0 ? 4 : 0) : 0;
            const isDimmed =
              activeDefectType !== 'ALL' && activeDefectType !== item.defectType;
            const isHovered = hoveredType === item.defectType;

            return (
              <div
                key={item.defectType}
                className={`grid grid-cols-[120px_1fr] sm:grid-cols-[135px_1fr] items-center gap-3 transition-opacity duration-150 ${
                  isDimmed ? 'opacity-40' : 'opacity-100'
                }`}
                onMouseEnter={() => setHoveredType(item.defectType)}
                onMouseLeave={() => setHoveredType(null)}
              >
                <span className="text-[12px] text-[#9CA3AF] truncate pr-1">
                  {item.defectType}
                </span>

                <div className="relative h-[24px] flex items-center border-l border-[#E5E7EB]">
                  <button
                    type="button"
                    onClick={() =>
                      onSelectDefectType(
                        activeDefectType === item.defectType ? 'ALL' : item.defectType
                      )
                    }
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: item.color,
                    }}
                    title={`${item.defectType}: ${item.count} defects (Click to filter)`}
                    className={`h-[22px] rounded-r-[4px] transition-all duration-200 cursor-pointer relative ${
                      isHovered ? 'brightness-95' : ''
                    }`}
                  >
                    {isHovered && (
                      <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-[#111827] text-white text-[11px] font-medium px-2 py-0.5 rounded whitespace-nowrap z-20 tabular-nums">
                        {item.count} defects
                      </span>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom X-axis ticks */}
        <div className="grid grid-cols-[120px_1fr] sm:grid-cols-[135px_1fr] gap-3 mt-2.5 pt-1.5">
          <div />
          <div className="border-t border-[#EAECEF] pt-1.5 flex items-center justify-between text-[11px] text-[#9CA3AF] tabular-nums relative pr-10 sm:pr-12">
            {ticks.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
            <span className="absolute right-0 text-[11px] text-[#9CA3AF]">
              Defects
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
