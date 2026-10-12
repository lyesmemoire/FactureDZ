import { describe, expect, it } from "vitest";
import {
  buildCustomerImport,
  buildProductImport,
  importTemplate,
  mapColumns,
  normalizeHeader,
  CUSTOMER_COLUMNS,
} from "./importTable";
import { DEFAULT_VALIDATION_RULES } from "./validation";
import type { Customer, Product, TaxRate } from "./types";

const RULES = { ...DEFAULT_VALIDATION_RULES };
const OPTS = { rules: RULES, conditionsPaiementDefautJours: 30 };

const TAX_RATES: TaxRate[] = [
  { id: "t1", code: "TVA19", libelle: "TVA 19 %", ratePct: 19, dateDebut: "2020-01-01", actif: true },
  { id: "t2", code: "TVA9", libelle: "TVA 9 %", ratePct: 9, dateDebut: "2020-01-01", actif: true },
  { id: "t3", code: "OLD", libelle: "Ancien", ratePct: 7, dateDebut: "2000-01-01", actif: false },
] as TaxRate[];

describe("en-têtes", () => {
  it("normalise accents, casse et ponctuation", () => {
    expect(normalizeHeader("Dénomination ")).toBe("denomination");
    expect(normalizeHeader("Délai de paiement (jours)")).toBe("delaidepaiementjours");
  });

  it("associe les colonnes par alias, quel que soit l'ordre", () => {
    const m = mapColumns(["Courriel", "Raison sociale", "NIF"], CUSTOMER_COLUMNS);
    expect(m.email).toBe(0);
    expect(m.denomination).toBe(1);
    expect(m.nif).toBe(2);
    expect(m.wilaya).toBeUndefined();
  });
});

describe("clients", () => {
  it("accepte une entreprise valide", () => {
    const p = buildCustomerImport(
      [["Type", "Dénomination", "NIF", "Courriel"], ["Entreprise", "SARL Benali", "123456789012345", "a@b.dz"]],
      [],
      OPTS
    );
    expect(p.counts).toEqual({ ok: 1, doublon: 0, erreur: 0 });
    const c = p.rows[0].value as Customer;
    expect(c.type).toBe("ENTREPRISE");
    expect(c.denomination).toBe("SARL Benali");
    expect(c.conditionsPaiementJours).toBe(30);
    expect(c.id).toMatch(/^cus-/);
  });

  it("déduit le type à partir de la présence de la dénomination", () => {
    const p = buildCustomerImport(
      [["Dénomination", "Nom", "Prénom"], ["", "Amrani", "Karim"]],
      [],
      OPTS
    );
    expect(p.rows[0].status).toBe("ok");
    expect((p.rows[0].value as Customer).type).toBe("PARTICULIER");
  });

  it("refuse une entreprise sans dénomination et un type inconnu", () => {
    const p = buildCustomerImport(
      [["Type", "Dénomination"], ["Entreprise", ""], ["Association", "X"]],
      [],
      OPTS
    );
    expect(p.rows[0].status).toBe("erreur");
    expect(p.rows[0].messages[0]).toMatch(/Dénomination obligatoire/);
    expect(p.rows[1].status).toBe("erreur");
    expect(p.rows[1].messages[0]).toMatch(/Type inconnu/);
  });

  it("détecte un NIF déjà présent (base ou fichier) comme doublon", () => {
    const existing = [{ id: "c0", type: "ENTREPRISE", denomination: "Déjà", nif: "123456789012345" } as Customer];
    const p = buildCustomerImport(
      [
        ["Dénomination", "NIF"],
        ["Autre", "123456789012345"],
        ["Nouvelle", "999999999999999"],
        ["Nouvelle bis", "999999999999999"],
      ],
      existing,
      OPTS
    );
    expect(p.rows.map((r) => r.status)).toEqual(["doublon", "ok", "doublon"]);
  });

  it("applique les règles NIF : format invalide bloque si la règle est BLOCK", () => {
    const p = buildCustomerImport(
      [["Dénomination", "NIF"], ["X", "12"]],
      [],
      { ...OPTS, rules: { ...RULES, nif: "BLOCK" } }
    );
    expect(p.rows[0].status).toBe("erreur");
  });

  it("une règle WARN ne bloque pas la ligne", () => {
    const p = buildCustomerImport(
      [["Dénomination", "NIF"], ["X", "12"]],
      [],
      { ...OPTS, rules: { ...RULES, nif: "WARN" } }
    );
    expect(p.rows[0].status).toBe("ok");
    expect(p.rows[0].messages.some((m) => m.startsWith("Avertissement"))).toBe(true);
  });

  it("refuse un courriel invalide et un délai négatif", () => {
    const p = buildCustomerImport(
      [["Type", "Dénomination", "Courriel", "Délai"], ["Particulier", "X", "pas-un-mail", "-3"]],
      [],
      OPTS
    );
    expect(p.rows[0].status).toBe("erreur");
    expect(p.rows[0].messages.join(" | ")).toMatch(/Courriel invalide/);
    expect(p.rows[0].messages.join(" | ")).toMatch(/Délai de paiement invalide/);
  });

  it("signale les colonnes obligatoires absentes", () => {
    const p = buildCustomerImport([["Adresse"], ["Rue 1"]], [], OPTS);
    expect(p.missingColumns).toEqual(["Dénomination ou Nom"]);
    expect(p.rows).toHaveLength(0);
  });

  it("ignore les lignes vides et conserve les numéros de ligne du fichier", () => {
    const p = buildCustomerImport([["Dénomination"], ["A"], ["B"]], [], OPTS);
    expect(p.rows.map((r) => r.line)).toEqual([2, 3]);
  });
});

describe("produits", () => {
  it("convertit le prix saisi au format français et résout le code TVA", () => {
    const p = buildProductImport(
      [
        ["Référence", "Désignation", "Prix unitaire HT", "Code TVA"],
        ["REF-1", "Papier", "1 250,50", "TVA9"],
        ["REF-2", "Encre", "300", "19"],
      ],
      [],
      { taxRates: TAX_RATES, defaultTaxCode: "TVA19" }
    );
    expect(p.counts.ok).toBe(2);
    const a = p.rows[0].value as Product;
    expect(a.puHtCents).toBe(125050);
    expect(a.taxCodeDefaut).toBe("TVA9");
    expect((p.rows[1].value as Product).taxCodeDefaut).toBe("TVA19");
  });

  it("refuse un prix illisible, un code TVA inconnu ou inactif", () => {
    const p = buildProductImport(
      [
        ["Référence", "Désignation", "Prix", "TVA"],
        ["A", "X", "abc", "TVA19"],
        ["B", "Y", "10", "OLD"],
        ["C", "Z", "10", "TVA99"],
      ],
      [],
      { taxRates: TAX_RATES, defaultTaxCode: "TVA19" }
    );
    expect(p.rows.map((r) => r.status)).toEqual(["erreur", "erreur", "erreur"]);
  });

  it("détecte les références en double, y compris dans le fichier", () => {
    const existing = [{ id: "p0", reference: "ref-1", designation: "X" } as Product];
    const p = buildProductImport(
      [
        ["Référence", "Désignation", "Prix"],
        ["REF-1", "Doublon base", "10"],
        ["REF-2", "Nouveau", "10"],
        ["ref-2", "Doublon fichier", "10"],
      ],
      existing,
      { taxRates: TAX_RATES, defaultTaxCode: "TVA19" }
    );
    expect(p.rows.map((r) => r.status)).toEqual(["doublon", "ok", "doublon"]);
  });

  it("signale les colonnes obligatoires absentes", () => {
    const p = buildProductImport([["Référence", "Prix"]], [], { taxRates: TAX_RATES, defaultTaxCode: "TVA19" });
    expect(p.missingColumns).toEqual(["Désignation"]);
  });
});

describe("modèles", () => {
  it("le modèle clients est relu sans colonne manquante", () => {
    const table = importTemplate("customers").replace(/^\uFEFF/, "").trim().split("\r\n").map((l) => l.split(";"));
    const p = buildCustomerImport(table, [], OPTS);
    expect(p.missingColumns).toEqual([]);
    expect(p.rows[0].status).toBe("ok");
    expect((p.rows[0].value as Customer).conditionsPaiementJours).toBe(30);
  });

  it("le modèle produits est relu sans colonne manquante", () => {
    const table = importTemplate("products").replace(/^\uFEFF/, "").trim().split("\r\n").map((l) => l.split(";"));
    const p = buildProductImport(table, [], { taxRates: TAX_RATES, defaultTaxCode: "TVA19" });
    expect(p.missingColumns).toEqual([]);
    expect(p.rows[0].status).toBe("ok");
    expect((p.rows[0].value as Product).puHtCents).toBe(85000);
  });

  it("fournit un modèle CSV avec BOM et séparateur point-virgule", () => {
    const t = importTemplate("products");
    expect(t.charCodeAt(0)).toBe(0xfeff);
    expect(t.split("\r\n")[0]).toContain("Référence;Désignation");
  });
});
