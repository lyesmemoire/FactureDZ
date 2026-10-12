import { describe, expect, it } from "vitest";
import {
  formatMoney,
  fromNumber,
  lineBrutCents,
  mulDivRound,
  parseAmountFr,
  pctOf,
  roundHalfUp,
  scaleDecimal,
} from "./money";
import { vatForLine } from "./taxEngine";

describe("arithmétique exacte sans flottant (§14) — non-régression", () => {
  // Cas où le produit flottant donnait le mauvais centime :
  //   1,005 × 100 = 100,5 exact → 101 ; en flottant 1.005*100 = 100.4999… → 100.
  it("quantité décimale × prix : 1,005 × 100 → 101 centimes (half-up exact)", () => {
    expect(lineBrutCents(1.005, 100)).toBe(101);
  });

  // 1000 × 1,15 % = 11,5 centimes exacts → 12 ; le taux 1,15 n'est pas exact en binaire.
  it("remise en pourcentage décimal : 1 000 × 1,15 % → 12 centimes", () => {
    expect(pctOf(1000, 1.15)).toBe(12);
  });

  it("TVA sur taux décimal : HT 1 000 × 9,5 % → 95", () => {
    expect(vatForLine(1000, 9.5)).toBe(95);
  });

  it("demi-centime : négatifs arrondis symétriquement, jamais de dérive", () => {
    expect(mulDivRound(-5n, 1n, 2n)).toBe(-3n); // -2,5 → -3
    expect(mulDivRound(5n, 1n, 2n)).toBe(3n);   //  2,5 →  3
    expect(scaleDecimal(0.1 + 0.2, 4)).toBe(3000n); // 0,30000000000000004 → 0,3000
  });

  it("ligne : qty 0,333 × 3 000 DA ne dérive pas (≈ 999 centimes)", () => {
    expect(lineBrutCents(0.333, 300000)).toBe(99900);
  });
});

describe("money — arithmétique entière (§14)", () => {
  it("convertit un nombre décimal en centimes sans dérive flottante", () => {
    expect(fromNumber(10000)).toBe(1_000_000); // 10 000,00 DA
    expect(fromNumber(0.1 + 0.2)).toBe(30); // le piège classique 0.30000000004
    expect(fromNumber(1250.5)).toBe(125_050);
  });

  it("arrondi half-up au centime", () => {
    expect(roundHalfUp(10.5)).toBe(11);
    expect(roundHalfUp(10.49)).toBe(10);
    expect(roundHalfUp(-10.5)).toBe(-11);
  });

  it("formate au format algérien FR (§43)", () => {
    expect(formatMoney(125_000_000)).toBe("1 250 000,00");
    expect(formatMoney(11_900_000)).toBe("119 000,00");
    expect(formatMoney(99)).toBe("0,99");
    expect(formatMoney(0)).toBe("0,00");
    expect(formatMoney(-11_900_000)).toBe("-119 000,00");
  });

  it("analyse une saisie française", () => {
    expect(parseAmountFr("1 250 000,00")).toBe(125_000_000);
    expect(parseAmountFr("10000")).toBe(1_000_000);
    expect(parseAmountFr("19,99")).toBe(1999);
  });

  it("pourcentage arrondi au centime", () => {
    expect(pctOf(10_000_000, 19)).toBe(1_900_000); // 19 % de 100 000 DA
    expect(pctOf(10_005, 19)).toBe(1901); // 100,05 × 19 % = 19,0095 → 19,01
  });
});
