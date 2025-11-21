// src/pages/SalesDashboard.tsx
import React, { useMemo, useRef, useState } from "react";
import { useAppState, type Category, type DrinkSubKey, type UIItem } from "../context/AppState";
import PosButton from "../components/PosButton.jsx";
import { upsertProduct, deleteProduct, changeBeanPackSizeSafe } from "../services/inventory";

import iconSimplePay from "../assets/payments/SimplePay.jpg";
import iconCash from "../assets/payments/Cash.png";
import iconMacauPass from "../assets/payments/MacauPass.png";

// --------- 可判別聯合 CartItem 型別 ---------
type DrinkCartItem = UIItem & {
  category: "drinks";
  subKey: DrinkSubKey;
  usagePerCup: number; // 每杯耗豆(kg)
  grams?: null;
  qty: number;
  deductKg?: number;
};

type BeanCartItem = UIItem & {
  category: "HandDrip";
  subKey?: null;
  grams: number; // 包裝克數
  qty: number;
  deductKg?: number;
};

type CartItem = DrinkCartItem | BeanCartItem;
// ------------------------------------------------

const fmt = (n: number) => {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const genSku = () =>
  (crypto?.randomUUID?.() ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10));

export default function SalesDashboard() {
  const { inventory, setInventory, createOrder, reloadInventory } = useAppState();

  const [activeTab, setActiveTab] = useState<Category>("drinks");
  const [drinkSubTab, setDrinkSubTab] = useState<DrinkSubKey>("espresso");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [migratingSku, setMigratingSku] = useState<string | null>(null); // Beans 變更克數時避免重複操作

  const PAYMENT_OPTIONS = [
    { key: "SimplePay", label: "SimplePay", icon: iconSimplePay },
    { key: "Cash", label: "Cash", icon: iconCash },
    { key: "MacauPass", label: "MacauPass", icon: iconMacauPass },
  ] as const;

  // 依目前 tab 取得商品清單
  const drinks = inventory?.store?.drinks || { espresso: [], singleOrigin: [] } as any;
  const products: any[] =
    activeTab === "drinks"
      ? ((drinks as any)[drinkSubTab] || [])
      : (inventory?.store?.HandDrip || []);

  // Beans 分組（同品名不同克數）
  const beanGroups = useMemo(() => {
    if (activeTab === "drinks") return [] as Array<[string, any[]]>;
    const map = new Map<string, any[]>();
    for (const it of products) {
      const key = (it.name || "").trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).map(([name, variants]) => [
      name,
      (variants as any[])
        .filter((v) => Number.isFinite(Number((v as any).grams)))
        .sort((a: any, b: any) => (a.grams || 0) - (b.grams || 0)),
    ]) as Array<[string, any[]]>;
  }, [activeTab, products]);

  const addGuardRef = useRef(new Set<string>());
  const nameInputCls =
    "w-full border border-[#dc2626] rounded px-3 py-2 h-11 leading-6 text-base text-left";
  const cellInputCls =
    "w-full sm:max-w-[110px] mx-auto border border-[#dc2626] rounded px-3 py-2 h-11 leading-6 text-base text-left md:text-center";

  // 新增商品用
  const [newProduct, setNewProduct] = useState<any>({
    name: "",
    price: 0,
    usagePerCup: 0.02, // drinks 用
    grams: 250,        // beans 用
  });

  // ========= 編輯模式：本地先改，RPC 持久化 =========

  /** 共用：本地同步 UI（不落 DB；僅讓使用者編輯時不跳回） */
  const patchLocalItem = (
    category: Category,
    subKey: DrinkSubKey | null,
    id: string,
    partial: Record<string, any>
  ) => {
    setInventory((prev) => {
      const next = structuredClone(prev);
      if (category === "drinks" && subKey) {
        next.store.drinks[subKey] = (next.store.drinks[subKey] || []).map((it: any) =>
          it.id === id ? { ...it, ...partial } : it
        );
      } else {
        next.store.HandDrip = (next.store.HandDrip || []).map((it: any) =>
          it.id === id ? { ...it, ...partial } : it
        );
      }
      return next;
    });
  };

  /** Drinks：變更 price / usagePerCup / name → upsert_product */
  const saveDrinkField = async (it: any, subKey: DrinkSubKey, field: "price" | "usagePerCup" | "name", raw: string) => {
    const value = field === "name" ? raw : parseFloat(raw) || 0;
    // 先本地更新
    patchLocalItem("drinks", subKey, it.id, { [field]: value });
    // 再 RPC 持久化
    await upsertProduct({
      sku: it.id, // id 即 sku
      name: field === "name" ? String(value) : it.name,
      category: "drinks",
      sub_key: subKey,
      usage_per_cup: field === "usagePerCup" ? Number(value) : Number(it.usagePerCup ?? 0.02),
      price: field === "price" ? Number(value) : Number(it.price ?? 0),
    });
    // 與 DB 對齊
    await reloadInventory();
  };

  /** Beans：變更 price / name（grams 透過安全流程改） */
  const saveBeanField = async (it: any, field: "price" | "name", raw: string) => {
    const value = field === "name" ? raw : parseFloat(raw) || 0;
    patchLocalItem("HandDrip", null, it.id, { [field]: value });
    await upsertProduct({
      sku: it.id,
      name: field === "name" ? String(value) : it.name,
      category: "HandDrip",
      grams: Number(it.grams || 0),
      price: field === "price" ? Number(value) : Number(it.price ?? 0),
    });
    await reloadInventory();
  };

  /** 刪除商品（變體） */
  const handleDelete = async (category: Category, subKey: DrinkSubKey | null, id: string) => {
    await deleteProduct(id); // id 即 sku
    await reloadInventory();
  };

  /** 新增商品：建立新 SKU → upsert_product → reload */
  const handleAddProduct = async (e?: React.SyntheticEvent) => {
    e?.preventDefault?.();
    const name = (newProduct.name || "").trim();
    if (!name) return alert("請輸入商品名稱");

    // 防連點
    const uniqKey =
      activeTab === "drinks"
        ? `d|${drinkSubTab}|${name.toLowerCase()}`
        : `b|${name.toLowerCase()}|${Number(newProduct.grams || 0)}`;
    if (addGuardRef.current.has(uniqKey)) return;
    addGuardRef.current.add(uniqKey);
    setTimeout(() => addGuardRef.current.delete(uniqKey), 800);

    if (activeTab === "drinks") {
      const sku = `${genSku()}-${drinkSubTab}`;
      await upsertProduct({
        sku,
        name,
        category: "drinks",
        sub_key: drinkSubTab,
        usage_per_cup: Number(newProduct.usagePerCup) || 0.02,
        price: Number(newProduct.price) || 0,
      });
    } else {
      const gramsVal = Number(newProduct.grams || 0);
      if (!gramsVal) return alert("請選擇克數");
      const sku = `${genSku()}-${gramsVal}g`;
      await upsertProduct({
        sku,
        name,
        category: "HandDrip",
        grams: gramsVal,
        price: Number(newProduct.price) || 0,
      });
    }

    await reloadInventory();
    setNewProduct({ name: "", price: 0, usagePerCup: 0.02, grams: 250 });
  };

  /** Beans：下拉選擇新克數 → 安全變更（新 SKU、搬庫存、刪舊 SKU） */
  const handleChangeBeanGramsSelect = async (item: any, newGrams: number) => {
    const oldGrams = Number(item.grams) || 0;
    if (!Number.isFinite(newGrams) || newGrams <= 0 || newGrams === oldGrams) return;

    const ok = window.confirm(`將「${item.name}」由 ${oldGrams}g → ${newGrams}g？\n（會建立新 SKU、搬移庫存、刪舊 SKU）`);
    if (!ok) return;

    try {
      setMigratingSku(item.id); // id 即 sku
      const newSku = await changeBeanPackSizeSafe({
        oldSku: item.id,
        oldStockKg: Number(item.stock) || 0,
        name: item.name,
        price: Number(item.price) || 0,
        newGrams,
      });
      await reloadInventory();
      alert(`✅ 已變更為 ${newGrams}g（新 SKU：${newSku}）`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "變更克數失敗");
    } finally {
      setMigratingSku(null);
    }
  };

  // ========= 購物車 / 下單 =========

  const addToCart = (item: any, qty: number, grams: number | null = null) => {
    const parsed = Number(qty);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    const isDrink = activeTab === "drinks";
    const g = isDrink ? 0 : Number(grams ?? item.grams ?? 0);
    const usage = isDrink ? Number(item.usagePerCup ?? 0.02) : 0;
    const deductKg = isDrink ? parsed * usage : (g * parsed) / 1000;

    setCart((prev: CartItem[]) => {
      const key = `${isDrink ? "drinks" : "HandDrip"}|${isDrink ? drinkSubTab : ""}|${item.id}|${g}`;
      const existed = prev.find(
        (p) => `${p.category}|${p.subKey || ""}|${p.id}|${(p as BeanCartItem).grams || 0}` === key
      );
      if (existed) {
        return prev.map((p: CartItem) =>
          `${p.category}|${p.subKey || ""}|${p.id}|${(p as BeanCartItem).grams || 0}` === key
            ? { ...p, qty: p.qty + parsed, deductKg: (p.deductKg || 0) + deductKg }
            : p
        );
      }

      const patch: CartItem = isDrink
        ? {
            ...(item as UIItem),
            category: "drinks",
            subKey: drinkSubTab,
            usagePerCup: usage,
            grams: null,
            qty: parsed,
            deductKg,
          }
        : {
            ...(item as UIItem),
            category: "HandDrip",
            subKey: null,
            grams: g,
            qty: parsed,
            deductKg,
          };

      return [...prev, patch];
    });
  };

  const totalAmount = cart.reduce((s, i) => s + i.qty * (i.price || 30), 0);

  const changeCartQty = (key: string, delta: number) => {
    setCart((prev: CartItem[]) =>
      prev
        .map((p: CartItem) => {
          const k = `${p.category}|${p.subKey || ""}|${p.id}|${(p as BeanCartItem).grams || 0}`;
          if (k !== key) return p;
          const newQty = p.qty + delta;
          if (newQty <= 0) return null as unknown as CartItem;

          const per = p.category === "drinks"
            ? (p as DrinkCartItem).usagePerCup
            : ((p as BeanCartItem).grams / 1000);

          return { ...p, qty: newQty, deductKg: per * newQty };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const handleCheckout = async () => {
    if (!paymentMethod) return alert("請先選擇支付方式（SimplePay / Cash / MacauPass）");
    const id = await createOrder(cart, totalAmount, { paymentMethod });
    if (!id) return;
    alert(`✅ Order Completed（付款方式：${paymentMethod}）`);
    setCart([]);
    setPaymentMethod("");
  };

  // ========= UI =========
  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* 編輯模式切換 */}
      <div className="flex justify-end items-center mb-6">
        <PosButton variant="tab" selected={editMode} onClick={() => setEditMode(!editMode)} aria-pressed={editMode}>
          ✏️
        </PosButton>
      </div>

      {/* Tabs */}
      <div className="flex gap-3 mb-6">
        <PosButton variant="tab" selected={activeTab === "HandDrip"} onClick={() => setActiveTab("HandDrip")}>
          Coffee Beans
        </PosButton>
        <PosButton
          variant="tab"
          selected={activeTab === "drinks" && drinkSubTab === "espresso"}
          onClick={() => {
            setActiveTab("drinks");
            setDrinkSubTab("espresso");
          }}
        >
          Espresso
        </PosButton>
        <PosButton
          variant="tab"
          selected={activeTab === "drinks" && drinkSubTab === "singleOrigin"}
          onClick={() => {
            setActiveTab("drinks");
            setDrinkSubTab("singleOrigin");
          }}
        >
          Single Origin
        </PosButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左側清單 */}
        <div className="lg:col-span-5 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col">
            <h2 className="text-xl font-extrabold text-black mb-3">
              {activeTab === "drinks"
                ? drinkSubTab === "espresso"
                  ? "Espresso Menu"
                  : "Single Origin Menu"
                : "Coffee Beans Menu"}
            </h2>

            {!editMode ? (
              <div className="rounded-lg border border-gray-200 flex-1 overflow-x-auto">
                <table className="w-full text-sm text-gray-900">
                  <thead className="bg-black text-white uppercase text-xs font-bold">
                    <tr>
                      <th className="px-4 py-3 text-left">Product</th>
                      {activeTab !== "drinks" && <th className="px-4 py-3 text-right">Pack</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {activeTab === "drinks"
                      ? (products as any[]).map((item: any) => (
                          <tr
                            key={item.id}
                            className="border-t border-gray-200 hover:bg-red-50 cursor-pointer"
                            onClick={() => addToCart(item, 1)}
                          >
                            <td className="px-4 py-3">
                              <div className="font-semibold break-words">{item.name}</div>
                              <div className="text-xs text-gray-500 mt-1">{fmt(item.price)}</div>
                            </td>
                          </tr>
                        ))
                      : beanGroups.map(([name, variants]) => (
                          <tr key={name} className="border-t border-gray-200">
                            <td className="px-4 py-3 align-top">
                              <div className="font-semibold break-words">{name}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2 justify-end">
                                {variants.map((v: any) => (
                                  <PosButton
                                    key={`${name}-${v.grams}`}
                                    variant="red"
                                    className="px-2 py-1 text-xs"
                                    onClick={() => addToCart(v, 1, v.grams)}
                                    title={`${v.grams}g • ${fmt(v.price)}`}
                                  >
                                    {v.grams}g • {fmt(v.price)}
                                  </PosButton>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full table-auto md:table-fixed text-sm text-gray-900">
                  <colgroup>
                    <col style={{ width: "40%" }} />
                    <col style={{ width: "20%" }} />
                    <col style={{ width: "20%" }} />
                    <col style={{ width: "20%" }} />
                  </colgroup>
                  <thead className="bg-black text-white uppercase text-xs font-bold">
                    <tr>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-center">Price</th>
                      <th className="px-3 py-2 text-center">{activeTab === "drinks" ? "Usage" : "Grams"}</th>
                      <th className="px-3 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(products as any[]).map((item: any) => (
                      <tr key={item.id} className="border-t border-gray-200">
                        {/* 名稱 */}
                        <td className="px-3 py-2 font-semibold truncate" title={item.name}>
                          <input
                            type="text"
                            defaultValue={item.name}
                            onBlur={(e) =>
                              activeTab === "drinks"
                                ? saveDrinkField(item, drinkSubTab, "name", e.target.value)
                                : saveBeanField(item, "name", e.target.value)
                            }
                            className={nameInputCls}
                          />
                        </td>

                        {/* 價格 */}
                        <td className="px-3 py-2 text-center">
                          <input
                            type="number"
                            step="1"
                            defaultValue={item.price}
                            onBlur={(e) =>
                              activeTab === "drinks"
                                ? saveDrinkField(item, drinkSubTab, "price", e.target.value)
                                : saveBeanField(item, "price", e.target.value)
                            }
                            className={cellInputCls}
                          />
                        </td>

                        {/* Usage / Grams */}
                        <td className="px-3 py-2 text-center">
                          {activeTab === "drinks" ? (
                            <input
                              type="number"
                              step="0.001"
                              defaultValue={item.usagePerCup || 0.02}
                              onBlur={(e) =>
                                saveDrinkField(item, drinkSubTab, "usagePerCup", e.target.value)
                              }
                              className={cellInputCls}
                            />
                          ) : (
                            <select
                              value={item.grams || 0}
                              disabled={migratingSku === item.id}
                              onChange={(e) =>
                                handleChangeBeanGramsSelect(item, parseInt(e.target.value, 10))
                              }
                              className={cellInputCls}
                              title="選擇新的包裝克數（會建立新 SKU、搬移庫存、刪除舊 SKU）"
                            >
                              {[100, 250, 500, 1000].map((g) => (
                                <option key={g} value={g}>
                                  {g}g
                                </option>
                              ))}
                            </select>
                          )}
                        </td>

                        {/* 刪除 */}
                        <td className="px-3 py-2 text-center">
                          <PosButton
                            variant="black"
                            className="w-full sm:max-w-[110px] mx-auto h-11"
                            onClick={() => handleDelete(activeTab, activeTab === "drinks" ? drinkSubTab : null, item.id)}
                            title="Delete variant"
                            disabled={migratingSku === item.id}
                          >
                            -
                          </PosButton>
                        </td>
                      </tr>
                    ))}

                    {/* 新增列 */}
                    <tr className="border-t bg-gray-50">
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          placeholder="Name"
                          value={newProduct.name}
                          onChange={(e) => setNewProduct((p: any) => ({ ...p, name: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && handleAddProduct(e)}
                          className={nameInputCls}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="number"
                          step="1"
                          placeholder="Price"
                          value={newProduct.price}
                          onChange={(e) =>
                            setNewProduct((p: any) => ({ ...p, price: parseFloat(e.target.value) || 0 }))
                          }
                          onKeyDown={(e) => e.key === "Enter" && handleAddProduct(e)}
                          className={cellInputCls}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {activeTab === "drinks" ? (
                          <input
                            type="number"
                            step="0.001"
                            placeholder="Usage (kg)"
                            value={newProduct.usagePerCup}
                            onChange={(e) =>
                              setNewProduct((p: any) => ({ ...p, usagePerCup: parseFloat(e.target.value) || 0 }))
                            }
                            onKeyDown={(e) => e.key === "Enter" && handleAddProduct(e)}
                            className={cellInputCls}
                          />
                        ) : (
                          <select
                            value={newProduct.grams}
                            onChange={(e) =>
                              setNewProduct((p: any) => ({ ...p, grams: parseInt(e.target.value, 10) }))
                            }
                            className={cellInputCls}
                          >
                            <option value={100}>100g</option>
                            <option value={250}>250g</option>
                            <option value={500}>500g</option>
                            <option value={1000}>1kg</option>
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <PosButton variant="red" className="w-full sm:max-w-[110px] mx-auto h-11" onClick={handleAddProduct}>
                          ➕ Add
                        </PosButton>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* 右側訂單摘要 */}
        <div className="lg:col-span-7 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col">
            <h2 className="text-xl font-extrabold text黑 mb-3">Order Summary</h2>

            {cart.length === 0 ? (
              <p className="text-gray-400 text-center py-6 flex-1">No items added.</p>
            ) : (
              <div className="rounded-lg border border-gray-200">
                <table className="w-full table-fixed text-sm text-gray-900">
                  <colgroup>
                    <col style={{ width: "60%" }} />
                    <col style={{ width: "20%" }} />
                    <col style={{ width: "20%" }} />
                  </colgroup>
                  <thead className="bg黑 text-white uppercase text-xs font-bold">
                    <tr>
                      <th className="px-4 py-3 text-left">Product</th>
                      <th className="px-4 py-3 text-center">Qty</th>
                      <th className="px-4 py-3 text-center">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item: CartItem) => {
                      const key = `${item.category}|${item.subKey || ""}|${item.id}|${(item as BeanCartItem).grams || 0}`;
                      return (
                        <tr key={key} className="border-t border-gray-200 hover:bg-red-50">
                          <td className="px-4 py-3 font-semibold">
                            {item.name}
                            {item.category === "drinks" && item.subKey
                              ? ` (${item.subKey === "espresso" ? "Espresso" : "Single Origin"})`
                              : (item as BeanCartItem).grams
                              ? ` ${(item as BeanCartItem).grams}g`
                              : ""}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="inline-flex items-center gap-2 justify-center">
                              <PosButton
                                variant="black"
                                className="px-2 py-1 text-xs !text-black hover:!text-black focus:!text-black"
                                onClick={() => changeCartQty(key, -1)}
                              >
                                −
                              </PosButton>
                              <span className="inline-block min-w-[2rem] text-center">{item.qty}</span>
                              <PosButton
                                variant="black"
                                className="px-2 py-1 text-xs !text-black hover:!text-black focus:!text-black"
                                onClick={() => changeCartQty(key, +1)}
                              >
                                ＋
                              </PosButton>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center text-[#dc2626] font-extrabold whitespace-nowrap">
                            $ {fmt(item.qty * (item.price || 30))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 付款方式 + 結帳 */}
            <div className="mt-6 border-top pt-4">
              <div className="mb-3">
                <div className="mb-2 text-sm font-semibold text-gray-700">Payment</div>
                <div className="flex flex-wrap gap-3">
                  {PAYMENT_OPTIONS.map((opt) => {
                    const selected = paymentMethod === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPaymentMethod(opt.key)}
                        aria-pressed={selected}
                        className={[
                          "h-12 w-24 rounded-lg bg-white border flex items-center justify-center",
                          "shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                          selected ? "border-red-500 ring-2 ring-red-500" : "border-neutral-300 hover:border-neutral-400",
                        ].join(" ")}
                        style={{ colorScheme: "light" }}
                      >
                        <img src={opt.icon} alt={opt.label} className="h-6 object-contain pointer-events-none" />
                        <span className="sr-only">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-gray-900 font-semibold">
                  Total: <span className="text-[#dc2626] font-extrabold text-lg">$ {fmt(totalAmount)}</span>
                </p>
                <PosButton
                  variant="confirm"
                  className="!bg-white !text-black !border !border-gray-300 shadow-md hover:!bg-gray-100 active:!bg-gray-200 focus:!ring-2 focus:!ring-black"
                  style={{ colorScheme: "light" }}
                  onClick={handleCheckout}
                  disabled={cart.length === 0 || !paymentMethod}
                  title={paymentMethod ? `Pay by ${paymentMethod}` : "Please choose payment first"}
                >
                  ✅ Confirm Order
                </PosButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
