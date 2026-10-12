import { beforeEach, describe, expect, it } from "vitest";
import { store } from "./store";
import { uid } from "../core/ids";
import type { PurchaseOrder, Supplier } from "../core/types";

function seedSupplier(): Supplier {
  return store.saveSupplier(
    { id: uid("sup"), denomination: "Cimenterie Test", actif: true, createdAt: "", updatedAt: "" } as Supplier,
    true
  );
}

function newPo(supplierId: string, qty = 10): PurchaseOrder {
  return {
    id: uid("po"),
    number: null,
    status: "BROUILLON",
    supplierId,
    supplierSnapshot: { displayName: "", type: "ENTREPRISE" },
    date: "2026-10-11",
    devise: "DZD",
    lines: [{
      id: uid("pol"), designation: "Ciment CPJ", unite: "sac", qty, qtyRecue: 0,
      puHtCents: 100000, remisePct: 0, taxCode: "TVA19", taxRatePctSnapshot: 19,
    }],
    totalHtCents: 0, totalTvaCents: 0, totalTtcCents: 0, vatDetail: [], amountInWords: "",
    createdAt: "", updatedAt: "",
  } as PurchaseOrder;
}

describe("store — achats", () => {
  beforeEach(() => {
    store.resetForTests?.();
  });

  it("numérote le BC à l'envoi, calcule les totaux et fige le contenu", () => {
    const f = seedSupplier();
    const po = store.savePurchaseOrder(newPo(f.id), true);
    expect(po.number).toBeNull();
    expect(po.totalHtCents).toBe(1000000);
    expect(po.totalTtcCents).toBe(1190000);

    expect(store.sendPurchaseOrder(po.id, "2026-10-11")).toEqual([]);
    const envoye = store.data.purchaseOrders.find((x) => x.id === po.id)!;
    expect(envoye.number).toBe("BC-2026-000001");
    expect(envoye.status).toBe("ENVOYE");
    expect(() => store.savePurchaseOrder({ ...envoye, observations: "modif" }, false)).toThrow();
  });

  it("réception partielle puis complète", () => {
    const f = seedSupplier();
    const po = store.savePurchaseOrder(newPo(f.id, 10), true);
    store.sendPurchaseOrder(po.id, "2026-10-11");
    const lineId = store.data.purchaseOrders.find((x) => x.id === po.id)!.lines[0].id;

    expect(store.receivePurchaseOrder(po.id, { [lineId]: 4 })).toEqual([]);
    expect(store.data.purchaseOrders.find((x) => x.id === po.id)!.status).toBe("RECU_PARTIEL");
    // Annulation refusée dès qu'une réception existe
    expect(store.cancelPurchaseOrder(po.id, "trop tard")).not.toEqual([]);

    expect(store.receivePurchaseOrder(po.id, { [lineId]: 10 })).toEqual([]);
    expect(store.data.purchaseOrders.find((x) => x.id === po.id)!.status).toBe("RECU");
  });

  it("refuse une réception supérieure à la commande", () => {
    const f = seedSupplier();
    const po = store.savePurchaseOrder(newPo(f.id, 2), true);
    store.sendPurchaseOrder(po.id, "2026-10-11");
    const lineId = store.data.purchaseOrders.find((x) => x.id === po.id)!.lines[0].id;
    expect(store.receivePurchaseOrder(po.id, { [lineId]: 3 })).not.toEqual([]);
  });

  it("annulation avec motif, puis suppression refusée pour un BC émis", () => {
    const f = seedSupplier();
    const po = store.savePurchaseOrder(newPo(f.id), true);
    store.sendPurchaseOrder(po.id, "2026-10-11");
    expect(store.cancelPurchaseOrder(po.id, "")).not.toEqual([]);
    expect(store.cancelPurchaseOrder(po.id, "Erreur de saisie")).toEqual([]);
    expect(store.data.purchaseOrders.find((x) => x.id === po.id)!.status).toBe("ANNULE");
    expect(() => store.deletePurchaseOrder(po.id)).toThrow();
  });

  it("supprime un brouillon, puis le fournisseur devient supprimable", () => {
    const f = seedSupplier();
    const brouillon = store.savePurchaseOrder(newPo(f.id), true);
    store.deletePurchaseOrder(brouillon.id);
    expect(store.data.purchaseOrders.some((x) => x.id === brouillon.id)).toBe(false);
    expect(() => store.deleteSupplier(f.id)).not.toThrow();
  });

  it("refuse la suppression d'un fournisseur rattaché à un bon de commande", () => {
    const f = seedSupplier();
    store.savePurchaseOrder(newPo(f.id), true);
    expect(() => store.deleteSupplier(f.id)).toThrow();
  });

  it("refuse l'envoi sans fournisseur ou sans ligne", () => {
    const po = store.savePurchaseOrder({ ...newPo("inconnu"), lines: [] }, true);
    expect(store.sendPurchaseOrder(po.id, "2026-10-11")).not.toEqual([]);
  });
});
