import { describe, expect, it } from "vitest";
import { DEVISES, currencySymbol, isDevise } from "./currency";
import { formatDA } from "./money";
import { amountInWordsDZD } from "./numberToWordsFr";
import { pickDefaultTax, presetTaxRates } from "./taxEngine";

describe("monnaies (§42)", () => {
  it("propose exactement DZD, EUR, USD", () => {
    expect([...DEVISES]).toEqual(["DZD", "EUR", "USD"]);
  });

  it("symboles : DA, €, $", () => {
    expect(currencySymbol("DZD")).toBe("DA");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("USD")).toBe("$");
  });

  it("monnaie absente ou inconnue : DA", () => {
    expect(currencySymbol(undefined)).toBe("DA");
    expect(currencySymbol("GBP")).toBe("DA");
    expect(isDevise("GBP")).toBe(false);
  });

  it("formatage d'un montant avec la monnaie du document", () => {
    expect(formatDA(125000000, "DZD")).toBe("1 250 000,00 DA");
    expect(formatDA(12050, "EUR")).toBe("120,50 €");
    expect(formatDA(999, "USD")).toBe("9,99 $");
  });

  it("montant en lettres selon la monnaie", () => {
    expect(amountInWordsDZD(11900000, "DZD")).toBe("CENT DIX-NEUF MILLE DINARS ALGÉRIENS ET ZÉRO CENTIME.");
    expect(amountInWordsDZD(11901, "EUR")).toBe("CENT DIX-NEUF EUROS ET UN CENTIME.");
    expect(amountInWordsDZD(10000, "USD")).toBe("CENT DOLLARS AMÉRICAINS ET ZÉRO CENT.");
  });
});

describe("taux de TVA par défaut (§10, §73)", () => {
  const rates = presetTaxRates();

  it("retient le taux choisi par la société", () => {
    expect(pickDefaultTax(rates, "TVA9", "2026-10-10")?.code).toBe("TVA9");
  });

  it("taux société inconnu ou inactif : repli sur le premier taux de TVA actif", () => {
    expect(pickDefaultTax(rates, "INCONNU", "2026-10-10")?.code).toBe("TVA19");
    const sansTva19 = rates.map((t) => (t.code === "TVA19" ? { ...t, actif: false } : t));
    expect(pickDefaultTax(sansTva19, "TVA19", "2026-10-10")?.code).toBe("TVA9");
  });

  it("aucun code société : premier taux actif", () => {
    expect(pickDefaultTax(rates, undefined, "2026-10-10")?.code).toBe("TVA19");
  });
});
