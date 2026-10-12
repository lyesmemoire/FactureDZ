import { describe, expect, it } from "vitest";
import {
  buildHistoricalInvoiceImport,
  historicalTemplate,
  parseImportDate,
  type HistoricalContext,
} from "./historicalImport";
import { presetTaxRates } from "./taxEngine";
import type { Customer } from "./types";

const CUSTOMERS = [
  { id: "cus-1", type: "ENTREPRISE", denomination: "SARL Benali", nif: "123456789012345", contacts: [], actif: true } as unknown as Customer,
  { id: "cus-2", type: "PARTICULIER", nom: "Amrani", prenom: "Karim", contacts: [], actif: true } as unknown as Customer,
];

function ctx(over: Partial<HistoricalContext> = {}): HistoricalContext {
  return {
    customers: CUSTOMERS,
    taxRates: presetTaxRates(),
    companyTaxCode: "TVA19",
    devise: "DZD",
    existingNumbers: [],
    today: "2026-10-11",
    ...over,
  };
}

const HEADER = "Numéro;Date;Client;NIF client;Désignation;Quantité;Prix unitaire HT;Code TVA;Total TTC";

describe("dates", () => {
  it("accepte ISO et JJ/MM/AAAA, rejette les dates impossibles", () => {
    expect(parseImportDate("2024-03-15")).toBe("2024-03-15");
    expect(parseImportDate("15/03/2024")).toBe("2024-03-15");
    expect(parseImportDate("15.3.2024")).toBe("2024-03-15");
    expect(parseImportDate("31/02/2024")).toBeNull();
    expect(parseImportDate("pas une date")).toBeNull();
  });
});

describe("factures historiques", () => {
  it("conserve le numéro tel quel et regroupe les lignes d'une même facture", () => {
    const p = buildHistoricalInvoiceImport(
      [
        HEADER.split(";"),
        ["FAC-2024-0007", "2024-03-15", "SARL Benali", "", "Papier", "10", "850", "TVA19", ""],
        ["FAC-2024-0007", "2024-03-15", "SARL Benali", "", "Transport", "1", "1000", "TVA9", ""],
        ["AB/99 spécial", "15/03/2024", "Amrani Karim", "", "Conseil", "2", "5000", "TVA19", ""],
      ],
      ctx()
    );
    expect(p.missingColumns).toEqual([]);
    expect(p.rows).toHaveLength(2);
    const a = p.rows[0].value!;
    expect(a.number).toBe("FAC-2024-0007");
    expect(a.lines).toHaveLength(2);
    expect(a.customerId).toBe("cus-1");
    // 10 × 850 = 8 500 HT à 19 % + 1 000 HT à 9 % = 9 000 HT
    expect(a.computed.totalHtCents).toBe(950000);
    expect(p.rows[1].value!.number).toBe("AB/99 spécial");
    expect(p.rows[1].value!.customerId).toBe("cus-2");
  });

  it("identifie le client par NIF quand la colonne est fournie", () => {
    const p = buildHistoricalInvoiceImport(
      [
        ["Numéro", "Date", "NIF client", "Désignation", "Quantité", "Prix unitaire HT"],
        ["F1", "2024-01-02", "123 456 789 012 345", "Article", "1", "100"],
      ],
      ctx()
    );
    expect(p.rows[0].status).toBe("ok");
    expect(p.rows[0].value!.customerId).toBe("cus-1");
  });

  it("signale un client introuvable", () => {
    const p = buildHistoricalInvoiceImport(
      [["Numéro", "Date", "Client", "Désignation", "Quantité", "Prix unitaire HT"], ["F1", "2024-01-02", "Inconnu SARL", "X", "1", "100"]],
      ctx()
    );
    expect(p.rows[0].status).toBe("erreur");
    expect(p.rows[0].messages[0]).toMatch(/Client introuvable/);
  });

  it("refuse un numéro déjà présent dans l'application (doublon)", () => {
    const p = buildHistoricalInvoiceImport(
      [["Numéro", "Date", "Client", "Désignation", "Quantité", "Prix unitaire HT"], ["FAC-1", "2024-01-02", "SARL Benali", "X", "1", "100"]],
      ctx({ existingNumbers: ["FAC-1"] })
    );
    expect(p.rows[0].status).toBe("doublon");
  });

  it("refuse une date future et des dates incohérentes au sein d'une même facture", () => {
    const p = buildHistoricalInvoiceImport(
      [
        ["Numéro", "Date", "Client", "Désignation", "Quantité", "Prix unitaire HT"],
        ["F1", "2030-01-01", "SARL Benali", "X", "1", "100"],
        ["F2", "2024-01-01", "SARL Benali", "X", "1", "100"],
        ["F2", "2024-01-05", "SARL Benali", "Y", "1", "100"],
      ],
      ctx()
    );
    expect(p.rows[0].messages.join()).toMatch(/Date future/);
    expect(p.rows[1].messages.join()).toMatch(/Date différente/);
  });

  it("détecte un total TTC du fichier différent du calcul", () => {
    const p = buildHistoricalInvoiceImport(
      [
        ["Numéro", "Date", "Client", "Désignation", "Quantité", "Prix unitaire HT", "Code TVA", "Total TTC"],
        ["F1", "2024-01-02", "SARL Benali", "X", "1", "1000", "TVA19", "1 190,00"],
        ["F2", "2024-01-02", "SARL Benali", "X", "1", "1000", "TVA19", "1 000,00"],
      ],
      ctx()
    );
    expect(p.rows[0].status).toBe("ok");
    expect(p.rows[1].status).toBe("erreur");
    expect(p.rows[1].messages.join()).toMatch(/Total TTC du fichier/);
  });

  it("applique le taux par défaut à la date de la facture si la colonne est vide", () => {
    const p = buildHistoricalInvoiceImport(
      [["Numéro", "Date", "Client", "Désignation", "Quantité", "Prix unitaire HT"], ["F1", "2024-01-02", "SARL Benali", "X", "1", "1000"]],
      ctx({ companyTaxCode: "TVA19" })
    );
    expect(p.rows[0].value!.lines[0].taxCode).toBe("TVA19");
    expect(p.rows[0].value!.computed.totalTtcCents).toBe(119000);
  });

  it("refuse une quantité nulle et un code TVA inconnu", () => {
    const p = buildHistoricalInvoiceImport(
      [
        ["Numéro", "Date", "Client", "Désignation", "Quantité", "Prix unitaire HT", "Code TVA"],
        ["F1", "2024-01-02", "SARL Benali", "X", "0", "100", "TVA19"],
        ["F2", "2024-01-02", "SARL Benali", "X", "1", "100", "TVA99"],
      ],
      ctx()
    );
    expect(p.rows.map((r) => r.status)).toEqual(["erreur", "erreur"]);
  });

  it("signale les colonnes obligatoires absentes", () => {
    const p = buildHistoricalInvoiceImport([["Date", "Client"], ["2024-01-01", "X"]], ctx());
    expect(p.missingColumns).toEqual(["Numéro", "Désignation", "Quantité", "Prix unitaire HT"]);
  });

  it("le modèle fourni est relu sans erreur", () => {
    const table = historicalTemplate().replace(/^\uFEFF/, "").trim().split("\r\n").map((l) => l.split(";"));
    const p = buildHistoricalInvoiceImport(table, ctx({ today: "2030-01-01" }));
    expect(p.missingColumns).toEqual([]);
    expect(p.counts.erreur).toBe(0);
    expect(p.rows[0].value!.lines).toHaveLength(2);
  });
});
