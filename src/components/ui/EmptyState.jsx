export default function EmptyState({
  icon: Icon,
  title = "Nenhum resultado encontrado",
  description = "Tente ajustar os filtros ou adicione novos itens.",
  actionLabel,
  onAction,
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {Icon && (
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-800 border border-gray-700 mb-4">
          <Icon size={32} className="text-gray-600" />
        </div>
      )}

      <p className="text-sm font-semibold text-gray-300 mb-1">{title}</p>
      <p className="text-sm text-gray-600 max-w-xs">{description}</p>

      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-black hover:bg-accent-hover transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
