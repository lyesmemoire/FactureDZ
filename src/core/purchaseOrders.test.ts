import { describe, expect, it } from "vitest";
import {
  canCancelPurchaseOrder,
  canEditPurchaseOrder,
  computePurchaseTotals,
  renderPoNumber,
  statusAfterReception,
  validatePurchaseOrderBeforeSend,
  validateReception,
} from "./purchaseOrders";
import type { PurchaseOrder, PurchaseOrderLine, Supplier } from "./types";

const ligne = (over: Partial<PurchaseOrderLine> = {}): PurchaseOrderLine => ({
  id: "l1",
  designation: "Ciment",
  unite: "sac",
  qty: 10,
  qtyRecue: 0,
  puHtCents: 10000,
  remisePct: 0,
  taxCode: "TVA19",
  taxRatePctSnapshot: 19,
  ...over,
});

const bc = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({
    id: "po1",
    number: null,
    status: "BROUILLON",
    supplierId: "s1",
    supplierSnapshot: { displayName: "Fournisseur", type: "ENTREPRISE" },
    date: "2026-10-11",
    devise: "DZD",
    lines: [ligne()],
    totalHtCents: 0,
    totalTvaCents: 0,
    totalTtcCents: 0,
    vatDetail: [],
    amountInWords: "",
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as PurchaseOrder;

const fournisseur = { id: "s1", denomination: "F", actif: true, createdAt: "", updatedAt: "" } as Supplier;

describe("numérotation des bons de commande", () => {
  it("rend BC-AAAA-000001 avec un compteur sur 6 chiffres", () => {
    expect(renderPoNumber(2026, 1)).toBe("BC-2026-000001");
    expect(renderPoNumber(2026, 123)).toBe("BC-2026-000123");
  });
  it("refuse un compteur invalide", () => {
    expect(() => renderPoNumber(2026, 0)).toThrow();
    expect(() => renderPoNumber(2026, 1.5)).toThrow();
  });
});

describe("totaux", () => {
  it("calcule HT, TVA et TTC avec remise par ligne", () => {
    const t = computePurchaseTotals([ligne({ qty: 10, puHtCents: 10000, remisePct: 10 })]);
    // 10 × 100,00 = 1 000,00 ; remise 10 % = 900,00 HT ; TVA 19 % = 171,00 ; TTC 1 071,00
    expect(t.totalHtCents).toBe(90000);
    expect(t.totalTvaCents).toBe(17100);
    expect(t.totalTtcCents).toBe(107100);
    expect(t.amountInWords.length).toBeGreaterThan(0);
  });
});

describe("réception et statut", () => {
  it("passe à RECU_PARTIEL puis RECU", () => {
    const partiel = [ligne({ qty: 10, qtyRecue: 4 })];
    expect(statusAfterReception(partiel, "ENVOYE")).toBe("RECU_PARTIEL");
    const complet = [ligne({ qty: 10, qtyRecue: 10 })];
    expect(statusAfterReception(complet, "RECU_PARTIEL")).toBe("RECU");
    expect(statusAfterReception([ligne({ qtyRecue: 0 })], "ENVOYE")).toBe("ENVOYE");
  });
  it("n'alter pas un brouillon ou un annulé", () => {
    expect(statusAfterReception([ligne({ qtyRecue: 10 })], "BROUILLON")).toBe("BROUILLON");
    expect(statusAfterReception([ligne({ qtyRecue: 10 })], "ANNULE")).toBe("ANNULE");
  });
  it("refuse une quantité reçue supérieure à la commande ou une diminution", () => {
    const lines = [ligne({ id: "a", qty: 10, qtyRecue: 4 })];
    expect(validateReception(lines, { a: 11 })).toHaveLength(1);
    expect(validateReception(lines, { a: 3 })).toHaveLength(1);
    expect(validateReception(lines, { a: 6 })).toEqual([]);
  });
});

describe("règles de cycle de vie", () => {
  it("contenu modifiable seulement en brouillon", () => {
    expect(canEditPurchaseOrder(bc())).toBe(true);
    expect(canEditPurchaseOrder(bc({ status: "ENVOYE" }))).toBe(false);
  });
  it("annulation seulement avant toute réception", () => {
    expect(canCancelPurchaseOrder(bc({ status: "ENVOYE" }))).toBe(true);
    expect(canCancelPurchaseOrder(bc({ status: "ENVOYE", lines: [ligne({ qtyRecue: 2 })] }))).toBe(false);
  });
  it("contrôle avant envoi : fournisseur et lignes", () => {
    expect(validatePurchaseOrderBeforeSend(bc(), undefined)).toContain("Choisissez un fournisseur.");
    expect(validatePurchaseOrderBeforeSend(bc({ lines: [] }), fournisseur)).toContain("Ajoutez au moins une ligne.");
    expect(validatePurchaseOrderBeforeSend(bc(), fournisseur)).toEqual([]);
  });
});
