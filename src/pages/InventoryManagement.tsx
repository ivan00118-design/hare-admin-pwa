import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useAppState, type DrinkSubKey, type DrinkProduct, type BeanProduct, type Inventory } from "../context/AppState";
import PosButton from "../components/PosButton.jsx";

const DEFAULT_REORDER_KG = 1;
type AggregatedRow = { name: string; total: number; specText: string; sourceText: string; ids: string[] };

export default function InventoryManagement() {
  const { inventory, setInventory, repairInventory } = useAppState();

  const rows = useMemo<AggregatedRow[]>(() => {
    const map = new Map<string, { name: string; total: number; specs: Set<string>; sources: Set<string>; ids: string[] }>();
    const add = (name?: string, spec?: string, stock?: number, source?: string, id?: string) => {
      const key = (name || "").trim().toLowerCase();
      if (!key) return;
      const rec = map.get(key) || { name: name!.trim(), total: 0, specs: new Set<string>(), sources: new Set<string>(), ids: [] as string[] };
      rec.total += Number(stock) || 0;
      if (spec) rec.specs.add(spec);
      if (source) rec.sources.add(source);
      if (id) rec.ids.push(id);
      map.set(key, rec);
    };
    const espresso: DrinkProduct[] = inventory?.store?.drinks?.espresso || [];
    const single: DrinkProduct[]   = inventory?.store?.drinks?.singleOrigin || [];
    const beans:   BeanProduct[]   = inventory?.store?.HandDrip || [];
    espresso.forEach((p) => add(p.name, "per cup", p.stock, "Espresso", p.id));
    single.forEach((p)  => add(p.name, "per cup", p.stock, "Single Origin", p.id));
    beans.forEach((p)   => add(p.name, `${p.grams}g`, p.stock, "Coffee Beans", p.id));
    return Array.from(map.values()).map((r) => ({
      name: r.name,
      total: +(Number(r.total || 0).toFixed(3)),
      specText: Array.from(r.specs).join(" / "),
      sourceText: Array.from(r.sources).join(" / "),
      ids: r.ids,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory]);

  const [reorderMap, setReorderMap] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("pos_reorder_levels") || "{}"); } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("pos_reorder_levels", JSON.stringify(reorderMap)); } catch {} }, [reorderMap]);

  const thresholdOf = (name?: string) => Number(reorderMap[name?.toLowerCase?.() || ""] ?? DEFAULT_REORDER_KG);
  const setThreshold = (name: string, v: string | number) => {
    const key = name.toLowerCase();
    setReorderMap((prev) => ({ ...prev, [key]: Math.max(0, Number(v) || 0) }));
  };

  const writeTotal = useCallback((name: string, nextKg: string | number) => {
    const target = (name || "").trim().toLowerCase();
    const total = Math.max(0, Number(nextKg) || 0);
    setInventory((prev: Inventory) => {
      const clone: Inventory = typeof structuredClone === "function" ? structuredClone(prev) : JSON.parse(JSON.stringify(prev));
      const lists: Array<["drinks" | "HandDrip", DrinkSubKey | null, (DrinkProduct | BeanProduct)[]]> = [
        ["drinks", "espresso",     clone.store?.drinks?.espresso     || []],
        ["drinks", "singleOrigin", clone.store?.drinks?.singleOrigin || []],
        ["HandDrip", null,         clone.store?.HandDrip             || []],
      ];
      let current = 0;
      const targets: Array<DrinkProduct | BeanProduct> = [];
      for (const [, , list] of lists) {
        for (const p of list) {
          if ((p.name || "").trim().toLowerCase() === target) { current += Number(p.stock) || 0; targets.push(p); }
        }
      }
      if (!targets.length) return prev;
      const delta = total - current;
      targets[0].stock = Math.max(0, (Number(targets[0].stock) || 0) + delta);
      return clone;
    });
  }, [setInventory]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex items-center mb-4 gap-3">
        <h1 className="text-3xl font-extrabold">Inventory Management</h1>
        <PosButton variant="tab" className="ml-auto" onClick={repairInventory} title="Remove duplicate items">🧹 Remove Duplicates</PosButton>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-black text-white text-xs font-bold uppercase">
            <tr><th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-left">Spec</th><th className="px-3 py-2 text-center">Total Stock (kg)</th><th className="px-3 py-2 text-center">Alert</th><th className="px-3 py-2 text-center">Manage</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No data.</td></tr>
            ) : rows.map((r) => {
              const th = thresholdOf(r.name); const low = r.total <= th;
              return (
                <tr key={r.name} className="border-t">
                  <td className="px-3 py-2 font-semibold">{r.name}</td>
                  <td className="px-3 py-2 text-gray-600">{r.specText || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <input type="number" step="0.01" value={r.total} onChange={(e) => writeTotal(r.name, e.target.value)} className="w-28 text-center border rounded px-2 py-1" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className={["inline-flex items-center px-2 py-1 rounded border text-xs", low ? "bg-red-100 text-red-700 border-red-300" : "bg-green-100 text-green-700 border-green-300"].join(" ")}>{low ? "⚠️ Restock" : "OK"}</span>
                      <input type="number" step="0.1" min={0} value={th} onChange={(e) => setThreshold(r.name, e.target.value)} className="w-16 text-center border rounded px-1 py-0.5" title="Reorder level (kg)" />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-gray-500">{r.sourceText || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
