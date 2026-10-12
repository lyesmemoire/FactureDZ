import { describe, expect, it } from "vitest";
import { amountInWordsDZD, intToWordsFr } from "./numberToWordsFr";

describe("montants en lettres français (§16)", () => {
  it("cas de base et zéro", () => {
    expect(intToWordsFr(0)).toBe("zéro");
    expect(intToWordsFr(1)).toBe("un");
    expect(intToWordsFr(16)).toBe("seize");
    expect(intToWordsFr(17)).toBe("dix-sept");
  });

  it("dizaines, 70/80/90 et « et un »", () => {
    expect(intToWordsFr(21)).toBe("vingt et un");
    expect(intToWordsFr(70)).toBe("soixante-dix");
    expect(intToWordsFr(71)).toBe("soixante et onze");
    expect(intToWordsFr(80)).toBe("quatre-vingts");
    expect(intToWordsFr(81)).toBe("quatre-vingt-un");
    expect(intToWordsFr(90)).toBe("quatre-vingt-dix");
    expect(intToWordsFr(99)).toBe("quatre-vingt-dix-neuf");
  });

  it("accords de cent et de vingt", () => {
    expect(intToWordsFr(100)).toBe("cent");
    expect(intToWordsFr(200)).toBe("deux cents");
    expect(intToWordsFr(201)).toBe("deux cent un");
    expect(intToWordsFr(80000)).toBe("quatre-vingt mille"); // pas de s devant mille
    expect(intToWordsFr(200000)).toBe("deux cent mille"); // pas de s devant mille
    expect(intToWordsFr(200_000_000)).toBe("deux cents millions"); // s conservé devant un nom
  });

  it("mille invariable, millions, milliards", () => {
    expect(intToWordsFr(1000)).toBe("mille");
    expect(intToWordsFr(119_000)).toBe("cent dix-neuf mille");
    expect(intToWordsFr(1_000_000)).toBe("un million");
    expect(intToWordsFr(2_000_000)).toBe("deux millions");
    expect(intToWordsFr(1_000_001)).toBe("un million un");
    expect(intToWordsFr(1_800_000)).toBe("un million huit cent mille");
    expect(intToWordsFr(2_000_000_000)).toBe("deux milliards");
  });

  it("TEST OFFICIEL §65 — 119 000,00 DA", () => {
    expect(amountInWordsDZD(11_900_000)).toBe(
      "CENT DIX-NEUF MILLE DINARS ALGÉRIENS ET ZÉRO CENTIME."
    );
  });

  it("centimes et singulier", () => {
    expect(amountInWordsDZD(100)).toBe("UN DINAR ALGÉRIEN ET ZÉRO CENTIME.");
    expect(amountInWordsDZD(150)).toBe("UN DINAR ALGÉRIEN ET CINQUANTE CENTIMES.");
    expect(amountInWordsDZD(12_345_67)).toBe(
      "DOUZE MILLE TROIS CENT QUARANTE-CINQ DINARS ALGÉRIENS ET SOIXANTE-SEPT CENTIMES.");
    expect(amountInWordsDZD(101)).toBe("UN DINAR ALGÉRIEN ET UN CENTIME.");
  });
});
