import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: string;
  accent?: 'copper' | 'amber' | 'emerald' | 'slate';
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accent = 'copper',
  onClick
}) => {
  const accentStyles = {
    copper: 'text-amber-500 border-amber-500/20 bg-amber-500/10',
    amber: 'text-amber-400 border-amber-400/20 bg-amber-400/10',
    emerald: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/10',
    slate: 'text-slate-400 border-slate-700/40 bg-slate-800/40'
  }[accent];

  const clickable = !!onClick;

  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={e => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) onClick?.();
      }}
      className={`p-3.5 sm:p-5 rounded-xl bg-[#14171d] border border-[#222631] hover:border-[#323847] active:bg-[#181b23] transition-all flex flex-col justify-between min-w-0 ${
        clickable ? 'cursor-pointer hover:bg-[#181b23]' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-slate-400 tracking-wider uppercase leading-tight">
            {title}
          </p>
          <p className="mt-1.5 sm:mt-2 text-xl sm:text-2xl lg:text-3xl font-bold text-white tracking-tight font-sans truncate">
            {value}
          </p>
        </div>

        <div className={`p-2 sm:p-2.5 rounded-lg border shrink-0 ${accentStyles}`}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
      </div>

      {(subtitle || trend) && (
        <div className="mt-3 sm:mt-4 pt-2.5 sm:pt-3 border-t border-[#1d212b] flex items-center justify-between gap-2 text-[11px] sm:text-xs text-slate-400">
          <span className="min-w-0">{subtitle}</span>
          {trend && <span className="font-medium text-amber-400/90 shrink-0">{trend}</span>}
        </div>
      )}
    </div>
  );
};
