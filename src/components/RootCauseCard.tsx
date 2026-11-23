import { ChevronDown, MoreHorizontal } from 'lucide-react';
import type { RootCauseItem } from '../types/boardsight.ts';

interface RootCauseCardProps {
  data: RootCauseItem[];
  sortBy: 'frequency' | 'severity' | 'recent';
  onChangeSort: (sort: 'frequency' | 'severity' | 'recent') => void;
}

export function RootCauseCard({
  data,
  sortBy,
  onChangeSort,
}: RootCauseCardProps) {
  return (
    <div className="bg-white border border-[#EAECEF] rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-[15.5px] font-semibold text-[#111827] tracking-[-0.01em]">
          Root Cause Breakdown
        </h2>

        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) =>
                onChangeSort(e.target.value as 'frequency' | 'severity' | 'recent')
              }
              aria-label="Sort root causes"
              className="appearance-none bg-white border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-lg pl-3 pr-7 py-1.5 text-[12px] font-medium text-[#374151] focus:outline-none focus:border-[#229A45] cursor-pointer"
            >
              <option value="frequency">Sort by: Frequency</option>
              <option value="severity">Sort by: Severity</option>
              <option value="recent">Sort by: Most Recent</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <button
            type="button"
            onClick={() => onChangeSort('frequency')}
            title="Reset sort order"
            aria-label="Root cause options"
            className="w-8 h-8 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] flex items-center justify-center text-[#374151] transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="py-8 text-center text-[12.5px] text-[#6B7280]">
          No root causes recorded for the active filter selection.
        </div>
      ) : (
        <div className="divide-y divide-[#F1F3F5]">
          {data.slice(0, 5).map((item) => (
            <div key={item.rootCause} className="py-3 first:pt-1 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-[#111827]">
                      {item.rootCause}
                    </span>
                    <span className="text-[11.5px] text-[#6B7280]">
                      · {item.primaryDefectType} ·{' '}
                      <span className="font-mono-tabular text-[#374151]">
                        {item.affectedComponents.join(', ')}
                      </span>
                    </span>
                  </div>
                  <p className="text-[12px] text-[#6B7280] mt-0.5 leading-relaxed">
                    {item.correctiveAction}
                  </p>
                </div>

                <div className="text-right shrink-0 tabular-nums">
                  <div className="text-[13px] font-semibold text-[#111827]">
                    {item.sharePct.toFixed(1)}%
                  </div>
                  <div className="text-[11px] text-[#6B7280]">
                    {item.count} events
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
