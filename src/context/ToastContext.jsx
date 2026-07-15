import { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle, XCircle, AlertTriangle, X } from "lucide-react";

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

/* ─── Visual config per type ─────────────────────────────── */

const TYPE_CFG = {
  success: {
    Icon: CheckCircle,
    bar:  "bg-green-500",
    icon: "text-green-400",
    bg:   "bg-gray-900",
    border: "border-green-900/60",
  },
  error: {
    Icon: XCircle,
    bar:  "bg-red-500",
    icon: "text-red-400",
    bg:   "bg-gray-900",
    border: "border-red-900/60",
  },
  warning: {
    Icon: AlertTriangle,
    bar:  "bg-yellow-400",
    icon: "text-yellow-400",
    bg:   "bg-gray-900",
    border: "border-yellow-900/60",
  },
};

/* ─── Single Toast ───────────────────────────────────────── */

function ToastItem({ toast, onRemove }) {
  const cfg = TYPE_CFG[toast.type] ?? TYPE_CFG.success;
  const { Icon } = cfg;

  return (
    <div
      className={`relative flex items-start gap-3 pl-4 pr-3 py-3 rounded-xl shadow-lg border
        ${cfg.bg} ${cfg.border} min-w-[280px] max-w-[360px] overflow-hidden
        animate-[slideInRight_0.2s_ease-out]`}
    >
      {/* Left colour bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${cfg.bar}`} />

      <Icon size={17} className={`${cfg.icon} shrink-0 mt-0.5`} />

      <p className="text-sm text-gray-200 font-medium flex-1 leading-snug">
        {toast.message}
      </p>

      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors ml-1"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ─── Provider ───────────────────────────────────────────── */

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "success") => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}

      {/* Toast container — bottom-right */}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
