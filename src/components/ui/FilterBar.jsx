import { useState, useRef, useEffect } from "react";
import { ChevronDown, X } from "lucide-react";

const INPUT_CLS = `h-9 rounded-lg bg-gray-800 border border-gray-700 px-3 text-sm text-gray-200
  placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-colors`;

function SelectFilter({ filter, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{filter.label}</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={`${INPUT_CLS} cursor-pointer`}
      >
        <option value="">Todos</option>
        {filter.options.map((opt) => (
          <option key={opt.value ?? opt} value={opt.value ?? opt}>
            {opt.label ?? opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeFilter({ filter, value = {}, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{filter.label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          placeholder="Min"
          value={value.min ?? ""}
          onChange={(e) => onChange({ ...value, min: e.target.value || undefined })}
          className={`${INPUT_CLS} w-20`}
        />
        <span className="text-gray-600 text-sm">–</span>
        <input
          type="number"
          placeholder="Max"
          value={value.max ?? ""}
          onChange={(e) => onChange({ ...value, max: e.target.value || undefined })}
          className={`${INPUT_CLS} w-20`}
        />
      </div>
    </div>
  );
}

function DateRangeFilter({ filter, value = {}, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{filter.label}</label>
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={value.from ?? ""}
          onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
          className={INPUT_CLS}
        />
        <span className="text-gray-600 text-sm">–</span>
        <input
          type="date"
          value={value.to ?? ""}
          onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
          className={INPUT_CLS}
        />
      </div>
    </div>
  );
}

function MultiSelectFilter({ filter, value = [], onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggle(opt) {
    const v = opt.value ?? opt;
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    onChange(next.length ? next : undefined);
  }

  const selected = value.length;

  return (
    <div className="flex flex-col gap-1" ref={ref}>
      <label className="text-xs font-medium text-gray-500">{filter.label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`${INPUT_CLS} flex items-center justify-between gap-2 min-w-[140px] px-3 cursor-pointer`}
        >
          <span className="text-gray-300">
            {selected ? `${selected} selecionado${selected > 1 ? "s" : ""}` : "Todos"}
          </span>
          <ChevronDown size={14} className={`text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[160px]">
            {filter.options.map((opt) => {
              const v = opt.value ?? opt;
              const l = opt.label ?? opt;
              const checked = value.includes(v);
              return (
                <label
                  key={v}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/60 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt)}
                    className="rounded border-gray-600 text-accent focus:ring-accent/40"
                  />
                  {l}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FilterBar({ filters = [], values = {}, onChange, onClear }) {
  function handleChange(key, val) {
    onChange?.({ ...values, [key]: val });
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="flex flex-wrap items-end gap-4">
        {filters.map((filter) => {
          const val = values[filter.key];

          if (filter.type === "select") return (
            <SelectFilter key={filter.key} filter={filter} value={val}
              onChange={(v) => handleChange(filter.key, v)} />
          );
          if (filter.type === "range") return (
            <RangeFilter key={filter.key} filter={filter} value={val}
              onChange={(v) => handleChange(filter.key, v)} />
          );
          if (filter.type === "daterange") return (
            <DateRangeFilter key={filter.key} filter={filter} value={val}
              onChange={(v) => handleChange(filter.key, v)} />
          );
          if (filter.type === "multiselect") return (
            <MultiSelectFilter key={filter.key} filter={filter} value={val ?? []}
              onChange={(v) => handleChange(filter.key, v)} />
          );
          return null;
        })}

        <button
          type="button"
          onClick={onClear}
          className="ml-auto flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors"
        >
          <X size={14} />
          Limpar filtros
        </button>
      </div>
    </div>
  );
}
