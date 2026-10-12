/**
 * Synchronisation desktop (§70, §32) : payloads de miroir et réhydratation
 * depuis SQLite. Ces fonctions sont pures — testables hors Tauri.
 */

import { describe, expect, it } from "vitest";
import { computeDocument } from "../core/invoiceCalculator";
import type { Customer, InvoiceDoc } from "../core/types";
import {
  auditPayload,
  backupRecordPayload,
  companyPayload,
  customerPayload,
  datasetLooksConfigured,
  datasetToAppData,
  docPayload,
  mirrorDelete,
  mirrorUpsert,
  paymentPayload,
  sequencePayload,
  settingsPairs,
  taxRatePayload,
} from "./desktopSync";
import { createStore, createMemoryStorage } from "./store";

function appData() {
  const s = createStore(createMemoryStorage());
  return s.data;
}

describe("Payloads de miroir (frontend → SQLite)", () => {
  it("entreprise : identifiants fiscaux DISTINCTS conservés (§6)", () => {
    const p = companyPayload({
      ...appData().company,
      raisonSociale: "SARL Atlas",
      nif: "002116123456789",
      nis: "002116123456798",
      rc: "16/00-1234567B21",
      articleImposition: "12345678901",
      tinLibelle: "TIN (libellé international du NIF)",
    });
    expect(p.nif).toBe("002116123456789");
    expect(p.nis).toBe("002116123456798");
    expect(p.rc).toBe("16/00-1234567B21");
    expect(p.article_imposition).toBe("12345678901");
    // Aucun champ fiscal générique (§6).
    expect(Object.keys(p)).not.toContain("fiscal_id");
    expect(p.devise).toBe("DZD");
  });

  it("client : contacts inclus, champs vides → null (pas de chaîne vide)", () => {
    const c: Customer = {
      id: "cus-1",
      type: "ENTREPRISE",
      denomination: "SARL Test",
      nif: "0021",
      contacts: [{ id: "k1", nom: "Ali", telephone: "0550" }],
      actif: true,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    const p = customerPayload(c);
    expect(p.contacts).toHaveLength(1);
    expect(p.contacts[0].nom).toBe("Ali");
    expect(p.adresse).toBeNull();
    expect(p.email).toBeNull();
  });

  it("taxe : le type TVA/AUTRE est transmis (§10)", () => {
    const p = taxRatePayload({
      id: "t1",
      code: "TIC",
      libelle: "Taxe intérieure",
      ratePct: 3,
      dateDebut: "2020-01-01",
      actif: true,
      kind: "AUTRE",
    });
    expect(p.kind).toBe("AUTRE");
  });

  it("document : lignes complètes, snapshots et annulation (§10, §20, §21)", () => {
    const doc: InvoiceDoc = {
      id: "doc-1",
      docType: "FAC",
      number: "FAC-2026-000001",
      status: "ANNULEE",
      date: "2026-10-08",
      customerId: "cus-1",
      sellerSnapshot: { displayName: "Vendeur", type: "ENTREPRISE_VENDEUR" },
      buyerSnapshot: { displayName: "Client", type: "ENTREPRISE" },
      lines: [
        {
          id: "ln1",
          nature: "VENTE",
          designation: "Article soumis à TIC",
          qty: 2,
          unite: "unité",
          puHtCents: 50000,
          taxCode: "TIC",
          taxRatePctSnapshot: 3,
          taxLibelleSnapshot: "Taxe intérieure",
          taxKindSnapshot: "AUTRE",
        },
      ],
      totalHtCents: 100000,
      totalTvaCents: 0,
      totalOtherTaxesCents: 3000,
      totalTtcCents: 103000,
      vatDetail: [],
      otherTaxDetail: [{ ratePct: 3, libelle: "Taxe intérieure", baseCents: 100000, amountCents: 3000 }],
      amountInWords: computeDocument([]).amountInWords,
      devise: "DZD",
      archived: false,
      cancellation: { at: "2026-10-09T10:00:00.000Z", by: "admin", motif: "Erreur de prix" },
      createdBy: "admin",
      createdAt: "2026-10-08",
      updatedAt: "2026-10-09",
    };
    const p = docPayload(doc, "admin");
    expect(p.customer_local_id).toBe("cus-1");
    expect(p.total_other_taxes_cents).toBe(3000);
    expect(p.items[0].tax_kind_snapshot).toBe("AUTRE");
    // Une ligne « autre taxe » ne produit AUCUNE TVA de ligne.
    expect(p.items[0].tva_cents).toBe(0);
    expect(p.items[0].ttc_cents).toBe(100000);
    expect(p.cancelled_at).toBe("2026-10-09T10:00:00.000Z");
    expect(p.cancel_motif).toBe("Erreur de prix");
    expect(p.created_by_username).toBe("admin");
  });

  it("paramètres : règles de validation et langue (§8, §43)", () => {
    const pairs = settingsPairs(appData().settings, "ar");
    expect(pairs.validation_nif).toBe("WARN");
    expect(pairs.language).toBe("ar");
    expect(pairs.auto_backup_frequency).toBe("DAILY");
  });

  it("séquence et sauvegarde : champs attendus par Rust", () => {
    expect(
      sequencePayload("FAC", 2026, 12, { docType: "FAC", template: "FAC-{YEAR}-{COUNTER}", padding: 6 })
    ).toEqual({ doc_type: "FAC", year: 2026, counter: 12, template: "FAC-{YEAR}-{COUNTER}", padding: 6 });

    const b = backupRecordPayload({
      id: "b1",
      ts: "2026-10-08T10:00:00.000Z",
      kind: "SECURITE_AVANT_RESTAURATION",
      label: "Sécurité",
      sizeBytes: 2048,
      counts: { factures: 3, clients: 2, produits: 1 },
      schemaVersion: 2,
    });
    expect(b.kind).toBe("SECURITE");
    expect(b.count_invoices).toBe(3);
    expect(b.schema_version).toBe(2);
  });

  it("audit : utilisateur et objet transmis (§34)", () => {
    const a = auditPayload({
      id: "aud1",
      ts: "2026-10-08T10:00:00.000Z",
      utilisateur: "admin",
      action: "VALIDATION_DOCUMENT",
      objectType: "document",
      objectId: "doc-1",
      details: "FAC-2026-000001",
    });
    expect(a.username).toBe("admin");
    expect(a.object_type).toBe("document");
  });

  it("paiement : montant en centimes entiers (§14)", () => {
    const p = paymentPayload(
      {
        id: "p1",
        invoiceId: "doc-1",
        invoiceNumber: "FAC-2026-000001",
        mode: "Espèces",
        date: "2026-10-09",
        amountCents: 119000,
        ts: "2026-10-09T10:00:00.000Z",
      },
      "admin"
    );
    expect(Number.isInteger(p.amount_cents)).toBe(true);
    expect(p.amount_cents).toBe(119000);
  });
});

describe("Hors desktop, le miroir est inerte", () => {
  it("mirrorUpsert / mirrorDelete ne lèvent rien et ne bloquent pas", async () => {
    expect(() => mirrorUpsert("customer", "c1", { denomination: "X" })).not.toThrow();
    expect(() => mirrorDelete("customer", "c1")).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("Réhydratation après restauration (§32)", () => {
  const dataset = {
    company: {
      id: 1,
      raison_sociale: "SARL Restaurée",
      nif: "002116999999999",
      rc: "16/00-9999999B21",
      devise: "DZD",
      conditions_paiement_defaut_jours: 45,
      mode_paiement_defaut: "Chèque",
      afficher_cachet: 1,
      afficher_signature: 1,
      afficher_banque: 0,
    },
    customers: [
      {
        id: 7,
        local_id: "cus-db-7",
        type: "ENTREPRISE",
        denomination: "Client Restauré",
        adresse: "2 rue de la Base",
        nif: "0021",
        actif: 1,
        created_at: "2024-01-01 10:00:00",
        updated_at: "2024-01-02 10:00:00",
      },
    ],
    customer_contacts: [{ id: 1, customer_id: 7, nom: "Contact DB", telephone: "0770" }],
    products: [],
    tax_rates: [
      {
        id: 1,
        code: "TVA19",
        libelle: "TVA 19 %",
        rate_pct: 19,
        date_debut: "2000-01-01",
        actif: 1,
        kind: "TVA",
      },
      { id: 2, code: "TIC", libelle: "Taxe TIC", rate_pct: 3, date_debut: "2020-01-01", actif: 1, kind: "AUTRE" },
    ],
    tax_history: [],
    users: [
      {
        id: 1,
        local_id: "usr-db-1",
        username: "admin",
        password_hash: "$argon2id$v=19$hash",
        role: "ADMIN",
        created_at: "2024-01-01",
      },
    ],
    documents: [
      {
        id: 42,
        local_id: "doc-db-42",
        doc_type: "FAC",
        number: "FAC-2026-000007",
        status: "VALIDEE",
        date: "2026-03-15",
        customer_id: 7,
        customer_local_id: "cus-db-7",
        total_ht_cents: 100000,
        total_tva_cents: 19000,
        total_ttc_cents: 119000,
        total_other_taxes_cents: 0,
        montant_lettres: "CENT DIX-NEUF MILLE DINARS ALGÉRIENS ET ZÉRO CENTIME.",
        vat_detail_json: '[{"ratePct":19,"libelle":"TVA 19 %","baseCents":100000,"amountCents":19000}]',
        other_tax_detail_json: "[]",
        seller_snapshot_json: '{"displayName":"SARL Restaurée","type":"ENTREPRISE_VENDEUR"}',
        buyer_snapshot_json: '{"displayName":"Client Restauré","type":"ENTREPRISE"}',
        remise_globale_kind: null,
        remise_globale_valeur_cents: null,
        archived: 0,
        demo: 0,
        created_by_name: "admin",
        created_at: "2026-03-15 09:00:00",
        updated_at: "2026-03-15 09:00:00",
        items: [
          {
            line_no: 1,
            nature: "VENTE",
            designation: "Prestation restaurée",
            qty: 1,
            unite: "forfait",
            pu_ht_cents: 100000,
            remise_pct: 0,
            tax_code: "TVA19",
            tax_rate_pct_snapshot: 19,
            tax_libelle_snapshot: "TVA 19 %",
            tax_kind_snapshot: "TVA",
            ht_cents: 100000,
            tva_cents: 19000,
            ttc_cents: 119000,
          },
        ],
      },
    ],
    payments: [
      {
        id: 3,
        local_id: "pay-db-3",
        invoice_id: 42,
        invoice_local_id: "doc-db-42",
        mode: "Chèque",
        date: "2026-03-20",
        amount_cents: 119000,
        ts: "2026-03-20 11:00:00",
      },
    ],
    audit: [
      {
        ts: "2026-03-15 09:00:00",
        username: "admin",
        action: "VALIDATION_DOCUMENT",
        object_type: "document",
        object_id: "doc-db-42",
      },
    ],
    backup_history: [
      {
        id: 1,
        ts: "2026-03-15 09:05:00",
        kind: "MANUELLE",
        label: "Manuelle",
        size_bytes: 4096,
        count_invoices: 1,
        count_customers: 1,
        count_products: 0,
        schema_version: 2,
      },
    ],
    settings: {
      auto_backup_frequency: "WEEKLY",
      auto_backup_retention: "5",
      lock_timeout_minutes: "30",
      validation_nif: "BLOCK",
      language: "en",
    },
    sequences: {
      counters: { "FAC-2026": 7 },
      configs: { FAC: { doc_type: "FAC", template: "FAC-{YEAR}-{COUNTER}", padding: 6 } },
    },
  };

  const data = datasetToAppData(dataset, appData());

  it("entreprise, devise et jours de paiement", () => {
    expect(data.company.raisonSociale).toBe("SARL Restaurée");
    expect(data.company.nif).toBe("002116999999999");
    expect(data.company.conditionsPaiementDefautJours).toBe(45);
    expect(data.company.afficherCoordonneesBancaires).toBe(false);
  });

  it("clients et contacts rattachés", () => {
    expect(data.customers).toHaveLength(1);
    expect(data.customers[0].id).toBe("cus-db-7");
    expect(data.customers[0].contacts[0].nom).toBe("Contact DB");
  });

  it("taxes : TVA et autres taxes distinctes (§10)", () => {
    expect(data.taxRates.find((t) => t.code === "TIC")?.kind).toBe("AUTRE");
  });

  it("documents : lignes, totaux, snapshots et pièces", () => {
    const doc = data.docs[0];
    expect(doc.number).toBe("FAC-2026-000007");
    expect(doc.customerId).toBe("cus-db-7");
    expect(doc.lines[0].designation).toBe("Prestation restaurée");
    expect(doc.lines[0].taxKindSnapshot).toBe("TVA");
    expect(doc.totalTtcCents).toBe(119000);
    expect(doc.vatDetail[0].amountCents).toBe(19000);
    expect(doc.sellerSnapshot.displayName).toBe("SARL Restaurée");
  });

  it("paiements : rattachement à la facture restaurée", () => {
    expect(data.payments[0].invoiceId).toBe("doc-db-42");
    expect(data.payments[0].invoiceNumber).toBe("FAC-2026-000007");
    expect(data.payments[0].amountCents).toBe(119000);
  });

  it("audit, sauvegardes, séquences et paramètres", () => {
    expect(data.audit[0].action).toBe("VALIDATION_DOCUMENT");
    expect(data.backupHistory[0].counts.factures).toBe(1);
    expect(data.sequences["FAC-2026"]).toBe(7);
    expect(data.sequenceConfigs.find((c) => c.docType === "FAC")?.template).toBe("FAC-{YEAR}-{COUNTER}");
    expect(data.settings.autoBackupFrequency).toBe("WEEKLY");
    expect(data.settings.validation.nif).toBe("BLOCK");
    expect(data.language).toBe("en");
  });

  it("les données restaurées restent exploitables et cohérentes (§49)", () => {
    const s = createStore(createMemoryStorage());
    s.data = datasetToAppData(dataset, appData());
    const findings = s.integrityCheck();
    expect(findings.every((f) => f.severity !== "ERROR")).toBe(true);
    // Le document restauré est payé intégralement → reste à payer nul.
    const doc = s.data.docs[0];
    expect(s.remainingCents(doc)).toBe(0);
  });
});

describe("amorçage desktop (§51, §52) — datasetLooksConfigured", () => {
  it("reconnaît une base configurée par son entreprise", () => {
    expect(datasetLooksConfigured({ company: { raison_sociale: "SARL X" }, users: [] })).toBe(true);
  });

  it("reconnaît une base configurée par ses utilisateurs (entreprise pas encore saisie)", () => {
    expect(datasetLooksConfigured({ company: null, users: [{ username: "admin" }] })).toBe(true);
  });

  it("refuse une base vide, incomplète ou invalide (l'assistant doit s'afficher)", () => {
    expect(datasetLooksConfigured(null)).toBe(false);
    expect(datasetLooksConfigured(undefined)).toBe(false);
    expect(datasetLooksConfigured({})).toBe(false);
    expect(datasetLooksConfigured({ company: { raison_sociale: "   " }, users: [] })).toBe(false);
    expect(datasetLooksConfigured({ company: null, users: [] })).toBe(false);
    expect(datasetLooksConfigured("texte")).toBe(false);
  });

  it("une base configurée reprise au démarrage reste exploitable (§49)", () => {
    const s = createStore(createMemoryStorage());
    const ds = { company: { raison_sociale: "SARL Reprise", adresse: "Alger" }, users: [{ username: "admin" }] };
    expect(datasetLooksConfigured(ds)).toBe(true);
    s.data = datasetToAppData(ds, appData());
    expect(s.data.initialized).toBe(true);
    expect(s.data.company.raisonSociale).toBe("SARL Reprise");
  });
});
