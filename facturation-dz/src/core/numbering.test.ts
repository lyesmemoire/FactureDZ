import { describe, expect, it } from "vitest";
import {
  assertNumberAvailable,
  counterFromNumber,
  renderNumber,
  validateTemplate,
} from "./numbering";
import type { SequenceConfig } from "./types";

const FAC: SequenceConfig = { docType: "FAC", template: "FAC-{YEAR}-{COUNTER}", padding: 6 };

describe("numérotation (§12, §55, §56)", () => {
  it("génère des numéros séquentiels (§12)", () => {
    expect(renderNumber(FAC, 2026, 1)).toBe("FAC-2026-000001");
    expect(renderNumber(FAC, 2026, 2)).toBe("FAC-2026-000002");
    expect(renderNumber(FAC, 2026, 3)).toBe("FAC-2026-000003");
    expect(renderNumber(FAC, 2027, 42)).toBe("FAC-2027-000042");
  });

  it("gabarits alternatifs (§55)", () => {
    const alt: SequenceConfig = { docType: "FAC", template: "{YEAR}/FAC/{COUNTER}", padding: 6 };
    expect(renderNumber(alt, 2026, 7)).toBe("2026/FAC/000007");
    const f: SequenceConfig = { docType: "FAC", template: "F-{YEAR}-{COUNTER}", padding: 5 };
    expect(renderNumber(f, 2026, 123)).toBe("F-2026-00123");
  });

  it("séries séparées (§56)", () => {
    const avoir: SequenceConfig = { docType: "AVOIR", template: "AV-{YEAR}-{COUNTER}", padding: 6 };
    const devis: SequenceConfig = { docType: "DEV", template: "DEV-{YEAR}-{COUNTER}", padding: 6 };
    expect(renderNumber(avoir, 2026, 1)).toBe("AV-2026-000001");
    expect(renderNumber(devis, 2026, 1)).toBe("DEV-2026-000001");
  });

  it("refuse un numéro déjà attribué (§12)", () => {
    expect(() =>
      assertNumberAvailable("FAC-2026-000002", ["FAC-2026-000001", "FAC-2026-000002"])
    ).toThrow(/existe déjà/);
    expect(() =>
      assertNumberAvailable("FAC-2026-000003", ["FAC-2026-000001"])
    ).not.toThrow();
  });

  it("valide les gabarits", () => {
    expect(validateTemplate("FAC-{YEAR}-{COUNTER}")).toHaveLength(0);
    expect(validateTemplate("FAC-{YEAR}")).not.toHaveLength(0); // pas de compteur
    expect(validateTemplate("FAC-{TOTO}-{COUNTER}")).not.toHaveLength(0);
  });

  it("compteur invalide rejeté", () => {
    expect(() => renderNumber(FAC, 2026, 0)).toThrow();
    expect(() => renderNumber(FAC, 2026, -3)).toThrow();
  });
});

describe("counterFromNumber (import historique)", () => {
  const cfg = { docType: "FAC", template: "FAC-{YEAR}-{COUNTER}", padding: 6 } as const;
  it("lit le compteur quel que soit le remplissage", () => {
    expect(counterFromNumber(cfg as never, 2024, "FAC-2024-0012")).toBe(12);
    expect(counterFromNumber(cfg as never, 2024, "FAC-2024-000012")).toBe(12);
  });
  it("refuse un numéro qui ne suit pas le modèle ou une autre année", () => {
    expect(counterFromNumber(cfg as never, 2024, "XYZ-77")).toBeNull();
    expect(counterFromNumber(cfg as never, 2024, "FAC-2023-0012")).toBeNull();
    expect(counterFromNumber(cfg as never, 2024, "FAC-2024-0")).toBeNull();
  });
});
