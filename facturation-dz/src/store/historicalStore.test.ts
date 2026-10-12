import { beforeEach, describe, expect, it } from "vitest";
import { store } from "./store";
import { renderNumber } from "../core/numbering";
import { presetTaxRates } from "../core/taxEngine";
import { buildHistoricalInvoiceImport } from "../core/historicalImport";
import { uid } from "../core/ids";
import type { Customer } from "../core/types";

function seedCustomer(): Customer {
  return store.saveCustomer(
    { id: uid("cus"), type: "ENTREPRISE", denomination: "SARL Historique", contacts: [], actif: true, conditionsPaiementJours: 30 } as unknown as Customer,
    true
  );
}

function importOne(number: string, date = "2024-03-15") {
  const cust = store.data.customers[0];
  const p = buildHistoricalInvoiceImport(
    [["Numéro", "Date", "Client", "Désignation", "Quantité", "Prix unitaire HT"], [number, date, cust.denomination!, "Article", "2", "1000"]],
    {
      customers: store.data.customers,
      taxRates: presetTaxRates(),
      companyTaxCode: "TVA19",
      devise: "DZD",
      existingNumbers: store.data.docs.map((d) => d.number),
      today: "2026-10-11",
    }
  );
  expect(p.rows[0].status).toBe("ok");
  return store.importHistoricalInvoice(p.rows[0].value!);
}

beforeEach(() => {
  store.resetForTests();
});

describe("import de factures historiques (store)", () => {
  it("enregistre la facture validée avec son numéro d'origine", () => {
    seedCustomer();
    const doc = importOne("FAC-2024-0012");
    expect(doc.number).toBe("FAC-2024-0012");
    expect(doc.status).toBe("VALIDEE");
    expect(doc.docType).toBe("FAC");
    expect(doc.date).toBe("2024-03-15");
    // 2 × 1 000 HT à 19 % = 2 380 TTC
    expect(doc.totalTtcCents).toBe(238000);
    expect(doc.amountInWords).toMatch(/DEUX MILLE TROIS CENT QUATRE-VINGTS/);
    expect(store.data.docs.some((d) => d.number === "FAC-2024-0012")).toBe(true);
  });

  it("fait avancer le compteur : la prochaine facture ne reprend pas le numéro importé", () => {
    seedCustomer();
    importOne("FAC-2024-0012");
    const cfg = store.getSequenceConfig("FAC");
    const next = store.allocateNumber("FAC", 2024);
    expect(next).toBe(renderNumber(cfg, 2024, 13));
  });

  it("n'altère pas le compteur pour un numéro qui ne suit pas le modèle", () => {
    seedCustomer();
    const cfg = store.getSequenceConfig("FAC");
    importOne("XYZ-77-ANCIEN");
    const next = store.allocateNumber("FAC", 2024);
    expect(next).toBe(renderNumber(cfg, 2024, 1));
  });

  it("refuse un second enregistrement du même numéro", () => {
    seedCustomer();
    importOne("FAC-2024-0005");
    expect(() => importOne("FAC-2024-0005")).toThrow();
  });

  it("journalise l'import", () => {
    seedCustomer();
    importOne("FAC-2024-0020");
    expect(store.data.audit.some((a) => a.action === "IMPORT_FACTURE_HISTORIQUE")).toBe(true);
  });
});
