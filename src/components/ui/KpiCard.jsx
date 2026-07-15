export default function KpiCard({ title, value, subtitle, icon: Icon, color = "#C8FF00" }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-400 leading-tight">{title}</p>
        {Icon && (
          <div
            className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
            style={{ backgroundColor: `${color}1A` }}
          >
            <Icon size={18} style={{ color }} />
          </div>
        )}
      </div>

      <p className="text-2xl font-bold text-white leading-none">{value}</p>

      {subtitle && (
        <p className="text-xs text-gray-500 leading-tight">{subtitle}</p>
      )}
    </div>
  );
}
