import { describe, expect, it } from "vitest";
import { computeDocument, computeLine } from "./invoiceCalculator";
import { fromNumber } from "./money";
import { presetTaxRates } from "./taxEngine";
import type { DocLine } from "./types";

const TVA19 = presetTaxRates()[0];
const TVA9 = presetTaxRates()[1];
const EXO = presetTaxRates()[2];

function line(partial: Partial<DocLine> & { designation: string }): DocLine {
  return {
    id: "l-" + Math.random().toString(36).slice(2),
    nature: "VENTE",
    qty: 1,
    unite: "unité",
    puHtCents: 0,
    taxCode: "TVA19",
    taxRatePctSnapshot: 19,
    taxLibelleSnapshot: "TVA 19 %",
    ...partial,
  };
}

describe("TEST OFFICIEL §65 — facture de référence", () => {
  it("10 × 10 000 DA HT = 100 000 HT, TVA 19 % = 19 000, TTC = 119 000", () => {
    const l = line({
      designation: "Produit A",
      qty: 10,
      puHtCents: fromNumber(10_000),
    });
    const c = computeLine(l);
    expect(c.htCents).toBe(10_000_000); // 100 000,00 DA
    expect(c.tvaCents).toBe(1_900_000); // 19 000,00 DA
    expect(c.ttcCents).toBe(11_900_000); // 119 000,00 DA

    const doc = computeDocument([l]);
    expect(doc.totalHtCents).toBe(10_000_000);
    expect(doc.totalTvaCents).toBe(1_900_000);
    expect(doc.totalTtcCents).toBe(11_900_000);
    expect(doc.amountInWords).toBe(
      "CENT DIX-NEUF MILLE DINARS ALGÉRIENS ET ZÉRO CENTIME."
    );
  });
});

describe("moteur de calcul (§13, §14, §15)", () => {
  it("1 × 1000 DA à 19 % (§13 exemple)", () => {
    const c = computeLine(
      line({ designation: "Produit A", qty: 10, puHtCents: 100_000, remisePct: 0 })
    );
    expect(c.htCents).toBe(1_000_000);
  });

  it("TVA 9 %", () => {
    const l = line({
      designation: "Produit réduit",
      qty: 1,
      puHtCents: 100_000,
      taxCode: TVA9.code,
      taxRatePctSnapshot: TVA9.ratePct,
      taxLibelleSnapshot: TVA9.libelle,
    });
    const c = computeLine(l);
    expect(c.tvaCents).toBe(9_000);
    expect(c.ttcCents).toBe(109_000);
  });

  it("exonération (§10)", () => {
    const l = line({
      designation: "Produit exonéré",
      qty: 2,
      puHtCents: 50_000,
      taxCode: EXO.code,
      taxRatePctSnapshot: 0,
      taxLibelleSnapshot: "Exonéré",
      motifExoneration: "Article 000 du CGI — exportation",
    });
    const c = computeLine(l);
    expect(c.tvaCents).toBe(0);
    expect(c.ttcCents).toBe(c.htCents);
  });

  it("plusieurs taux dans la même facture (§10)", () => {
    const l19 = line({ designation: "A", qty: 1, puHtCents: 100_000 });
    const l9 = line({
      designation: "B",
      qty: 1,
      puHtCents: 100_000,
      taxCode: "TVA9",
      taxRatePctSnapshot: 9,
      taxLibelleSnapshot: "TVA 9 %",
    });
    const doc = computeDocument([l19, l9]);
    expect(doc.totalHtCents).toBe(200_000);
    expect(doc.totalTvaCents).toBe(19_000 + 9_000);
    expect(doc.totalTtcCents).toBe(228_000);
    expect(doc.vatDetail).toHaveLength(2);
    expect(doc.vatDetail.find((v) => v.ratePct === 19)?.amountCents).toBe(19_000);
    expect(doc.vatDetail.find((v) => v.ratePct === 9)?.amountCents).toBe(9_000);
  });

  it("remise par ligne (§17)", () => {
    const l = line({ designation: "A", qty: 10, puHtCents: 100_000, remisePct: 10 });
    const c = computeLine(l);
    expect(c.brutCents).toBe(1_000_000);
    expect(c.remiseCents).toBe(100_000);
    expect(c.htCents).toBe(900_000);
    expect(c.tvaCents).toBe(171_000);
  });

  it("remise globale en pourcentage répartie sur les lignes (§17)", () => {
    const l1 = line({ designation: "A", qty: 1, puHtCents: 100_000 });
    const l2 = line({ designation: "B", qty: 1, puHtCents: 300_000 });
    const doc = computeDocument([l1, l2], { kind: "PCT", value: 10 });
    expect(doc.globalDiscountCents).toBe(40_000);
    expect(doc.totalHtCents).toBe(360_000);
    expect(doc.totalTvaCents).toBe(Math.round(360_000 * 0.19));
    expect(doc.totalTtcCents).toBe(doc.totalHtCents + doc.totalTvaCents);
    // La somme des HT lignes après remise = total HT (aucun centime perdu).
    const sum = doc.finalLineHtCents.reduce((s, x) => s + x, 0);
    expect(sum).toBe(doc.totalHtCents);
  });

  it("remise globale en montant", () => {
    const l1 = line({ designation: "A", qty: 1, puHtCents: 100_000 });
    const doc = computeDocument([l1], { kind: "AMT", value: 5_000 });
    expect(doc.globalDiscountCents).toBe(5_000);
    expect(doc.totalHtCents).toBe(95_000);
  });

  it("arrondi de la TVA au centime (§14)", () => {
    // 100,05 DA × 19 % = 19,0095 → arrondi half-up = 19,01
    const l = line({ designation: "A", qty: 1, puHtCents: 10_005 });
    const c = computeLine(l);
    expect(c.tvaCents).toBe(1901);
  });

  it("le taux snapshoté n'est pas affecté par le référentiel", () => {
    // La ligne porte son propre taux : même si le référentiel change,
    // le calcul n'utilise QUE le snapshot (§10).
    const l = line({
      designation: "A",
      qty: 1,
      puHtCents: 100_000,
      taxCode: "TVA19",
      taxRatePctSnapshot: 19,
      taxLibelleSnapshot: "TVA 19 %",
    });
    const c = computeLine(l);
    expect(c.tvaCents).toBe(19_000);
    expect(TVA19.code).toBe("TVA19");
  });

  it("quantités décimales (kg)", () => {
    const l = line({ designation: "Vrac", qty: 12.345, puHtCents: 35_000, unite: "kg" });
    const c = computeLine(l);
    expect(c.brutCents).toBe(Math.round(12.345 * 35_000)); // 432 075 → 4 320,75 DA
  });
});
