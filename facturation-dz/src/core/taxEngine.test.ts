import { describe, expect, it } from "vitest";
import { findApplicableTax, isTaxApplicable, presetTaxRates, vatForLine } from "./taxEngine";

describe("moteur fiscal (§10, §73)", () => {
  const rates = presetTaxRates();

  it("préconfigure TVA 19 %, TVA 9 % et Exonéré (§10)", () => {
    expect(rates.map((r) => r.code)).toEqual(["TVA19", "TVA9", "EXO"]);
    expect(rates[0].ratePct).toBe(19);
    expect(rates[1].ratePct).toBe(9);
    expect(rates[2].ratePct).toBe(0);
  });

  it("TVA ligne = HT × taux / 100 arrondi au centime (§14)", () => {
    expect(vatForLine(10_000_000, 19)).toBe(1_900_000); // §65
    expect(vatForLine(100_000, 9)).toBe(9_000);
    expect(vatForLine(10_005, 19)).toBe(1_901); // 19,0095 → 19,01
    expect(vatForLine(1_000_000, 0)).toBe(0);
  });

  it("fenêtre de validité d'un taux (date début / fin)", () => {
    const t = { ...rates[0], dateDebut: "2026-01-01", dateFin: "2026-12-31" };
    expect(isTaxApplicable(t, "2026-06-15")).toBe(true);
    expect(isTaxApplicable(t, "2025-12-31")).toBe(false);
    expect(isTaxApplicable(t, "2027-01-01")).toBe(false);
    expect(isTaxApplicable({ ...t, actif: false }, "2026-06-15")).toBe(false);
  });

  it("recherche d'un taux applicable à la date du document (§74)", () => {
    expect(findApplicableTax(rates, "TVA19", "2026-10-08")?.ratePct).toBe(19);
    expect(findApplicableTax(rates, "INCONNU", "2026-10-08")).toBeUndefined();
  });
});
