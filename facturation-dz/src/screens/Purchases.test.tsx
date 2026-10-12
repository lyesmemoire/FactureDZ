// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PurchasesScreen } from "./Purchases";
import { store } from "../store/store";
import { uid } from "../core/ids";
import type { PurchaseOrder, Supplier } from "../core/types";

describe("Écran Achats", () => {
  it("affiche les bons de commande et ouvre l'onglet fournisseurs", () => {
    const f = store.saveSupplier({ id: uid("sup"), denomination: "Fournisseur Écran", actif: true, createdAt: "", updatedAt: "" } as Supplier, true);
    store.savePurchaseOrder({
      id: uid("po"), number: null, status: "BROUILLON", supplierId: f.id,
      supplierSnapshot: { displayName: "", type: "ENTREPRISE" }, date: "2026-10-11", devise: "DZD",
      lines: [{ id: uid("pol"), designation: "Gravier", unite: "m3", qty: 3, qtyRecue: 0, puHtCents: 500000, taxCode: "TVA19", taxRatePctSnapshot: 19 }],
      totalHtCents: 0, totalTvaCents: 0, totalTtcCents: 0, vatDetail: [], amountInWords: "", createdAt: "", updatedAt: "",
    } as PurchaseOrder, true);

    render(<PurchasesScreen />);
    expect(screen.getAllByText("Fournisseur Écran").length).toBeGreaterThan(0);
    expect(screen.getByText("(brouillon)")).toBeTruthy();
    fireEvent.click(screen.getByText(/Fournisseurs \(/));
    expect(screen.getByText("+ Nouveau fournisseur")).toBeTruthy();
  });
});
