/**
 * FacturationDZ — Non-régression de la couche de gestion (§64, §66).
 *
 * Chaque règle critique du cahier des charges est verrouillée ici :
 * immutabilité des documents validés (§20), annulation (§21), avoirs (§22),
 * paiements (§19), numérotation inviolable (§12), snapshots historiques (§38),
 * moteur fiscal historisé (§10, §74), validations (§48, §8), intégrité (§49),
 * sauvegarde/restauration (§30-32), migrations locales (§51), audit (§34).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { computeDocument } from "../core/invoiceCalculator";
import { uid } from "../core/ids";
import { fromNumber } from "../core/money";
import type { Customer, DocLine, InvoiceDoc } from "../core/types";
import {
  applyLocalMigrations,
  createMemoryStorage,
  createStore,
  SECURITY_BACKUP_KEY,
  STORAGE_KEY,
  type StorageLike,
} from "./store";

/* ---------------- Fabrique d'un environnement de test ---------------- */

const YEAR = new Date().getFullYear();

function makeStore(storage?: StorageLike) {
  const s = createStore(storage ?? createMemoryStorage());
  s.data.company = {
    ...s.data.company,
    raisonSociale: "SARL Test FacturationDZ",
    adresse: "1 rue de l'Indépendance",
    wilaya: "Alger",
    commune: "Alger-Centre",
    rc: "16/00-1111111B24",
    nif: "002116111111111",
    nis: "002116111111112",
    articleImposition: "11111111111",
  };
  s.data.initialized = true;
  return s;
}

function makeCustomer(s: ReturnType<typeof makeStore>, over: Partial<Customer> = {}): Customer {
  const c: Customer = {
    id: uid("cus"),
    type: "ENTREPRISE",
    denomination: "Client Test " + Math.random().toString(36).slice(2, 6),
    adresse: "Adresse du client, n° 1",
    wilaya: "Alger",
    commune: "Alger-Centre",
    nif: "002116999999999",
    nis: "002116999999998",
    rc: "16/00-9999999B24",
    contacts: [],
    actif: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
  s.data.customers.push(c);
  return c;
}

function makeLine(over: Partial<DocLine> = {}): DocLine {
  return {
    id: uid("ln"),
    nature: "VENTE",
    designation: "Prestation de test",
    qty: 10,
    unite: "unité",
    puHtCents: fromNumber(10_000), // 10 000 DA HT (§65)
    taxCode: "TVA19",
    taxRatePctSnapshot: 19,
    taxLibelleSnapshot: "TVA 19 %",
    ...over,
  };
}

/** Crée un brouillon avec lignes + totaux cohérents. */
/** Devis (DEV) en brouillon avec une ligne standard. */
function makeDevis(s: ReturnType<typeof makeStore>, customerId: string): InvoiceDoc {
  const doc = s.createDraft({ docType: "DEV", customerId });
  const lines = [makeLine()];
  const comp = computeDocument(lines);
  doc.lines = lines;
  doc.totalHtCents = comp.totalHtCents;
  doc.totalTvaCents = comp.totalTvaCents;
  doc.totalTtcCents = comp.totalTtcCents;
  doc.vatDetail = comp.vatDetail;
  doc.amountInWords = comp.amountInWords;
  s.updateDraft(doc);
  return s.data.docs.find((d) => d.id === doc.id)!;
}

function makeDraft(
  s: ReturnType<typeof makeStore>,
  customerId: string,
  lines: DocLine[],
  date?: string
): InvoiceDoc {
  const doc = s.createDraft({ docType: "FAC", customerId, ...(date ? { date } : {}) });
  const comp = computeDocument(lines);
  doc.lines = lines;
  doc.totalHtCents = comp.totalHtCents;
  doc.totalTvaCents = comp.totalTvaCents;
  doc.totalTtcCents = comp.totalTtcCents;
  doc.vatDetail = comp.vatDetail;
  doc.amountInWords = comp.amountInWords;
  s.updateDraft(doc);
  return s.data.docs.find((d) => d.id === doc.id)!;
}

/* ---------------- Tests ---------------- */

describe("cycle de vie d'une facture (§11, §20, §69)", () => {
  let s: ReturnType<typeof makeStore>;
  let cust: Customer;

  beforeEach(() => {
    s = makeStore();
    cust = makeCustomer(s);
  });

  it("validation = transaction complète : numéro + statut + totaux + lettres (§69)", () => {
    const doc = makeDraft(s, cust.id, [makeLine()]);
    expect(doc.status).toBe("BROUILLON");
    expect(doc.number).toBeNull();

    const validated = s.validateDocument(doc.id);
    expect(validated.number).toBe(`FAC-${YEAR}-000001`);
    expect(validated.status).toBe("VALIDEE");
    expect(validated.totalHtCents).toBe(10_000_000); // §65
    expect(validated.totalTvaCents).toBe(1_900_000);
    expect(validated.totalTtcCents).toBe(11_900_000);
    expect(validated.amountInWords).toBe(
      "CENT DIX-NEUF MILLE DINARS ALGÉRIENS ET ZÉRO CENTIME."
    );
  });

  it("un document validé est FIGÉ : modification et suppression interdites (§20, §47)", () => {
    const doc = makeDraft(s, cust.id, [makeLine()]);
    s.validateDocument(doc.id);
    const validated = s.data.docs.find((d) => d.id === doc.id)!;

    expect(() => s.updateDraft({ ...validated, observations: "piraté" })).toThrow(/figé/);
    expect(() => s.deleteDraft(validated.id)).toThrow(/interdite/);
    // Et il est toujours présent (jamais de suppression physique, §34).
    expect(s.data.docs.some((d) => d.id === doc.id)).toBe(true);
  });

  it("la validation échoue proprement sans laisser de numéro attribué (§48, §69)", () => {
    const doc = s.createDraft({ docType: "FAC", customerId: cust.id });
    // Aucune ligne → erreur ; le compteur ne doit PAS être consommé.
    expect(() => s.validateDocument(doc.id)).toThrow(/aucune ligne/);
    expect(s.data.sequences[`FAC-${YEAR}`] ?? 0).toBe(0);

    const doc2 = makeDraft(s, cust.id, [makeLine()]);
    expect(s.validateDocument(doc2.id).number).toBe(`FAC-${YEAR}-000001`);
  });

  it("totaux falsifiés détectés avant validation (§48)", () => {
    const doc = makeDraft(s, cust.id, [makeLine()]);
    doc.totalHtCents += 500; // falsification
    s.data.docs = s.data.docs.map((d) => (d.id === doc.id ? doc : d));
    expect(() => s.validateDocument(doc.id)).toThrow(/Incohérence de totaux/);
  });
});

describe("annulation (§21)", () => {
  it("motif obligatoire, document conservé, numéro jamais réutilisé", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const doc = makeDraft(s, cust.id, [makeLine()]);
    const { number } = s.validateDocument(doc.id);

    expect(() => s.cancelDocument(doc.id, "   ")).toThrow(/motif/i);

    s.cancelDocument(doc.id, "Erreur de prix");
    const cancelled = s.data.docs.find((d) => d.id === doc.id)!;
    expect(cancelled.status).toBe("ANNULEE");
    expect(cancelled.number).toBe(number); // numéro conservé
    expect(cancelled.cancellation?.motif).toBe("Erreur de prix");
    expect(cancelled.cancellation?.by).toBeTruthy();

    // Le numéro suivant ne réutilise JAMAIS le numéro annulé.
    const doc2 = makeDraft(s, cust.id, [makeLine()]);
    expect(s.validateDocument(doc2.id).number).toBe(`FAC-${YEAR}-000002`);

    // Double annulation impossible ; brouillon non annulable.
    expect(() => s.cancelDocument(doc.id, "bis")).toThrow(/déjà annulé/);
    const draft = s.createDraft({ docType: "FAC", customerId: cust.id });
    expect(() => s.cancelDocument(draft.id, "x")).toThrow(/brouillon/i);
  });

  it("aucun encaissement possible sur une facture annulée (§19)", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const doc = makeDraft(s, cust.id, [makeLine()]);
    s.validateDocument(doc.id);
    s.cancelDocument(doc.id, "Annulée pour test");
    expect(() =>
      s.addPayment({ invoiceId: doc.id, mode: "Espèces", date: "2026-10-08", amountCents: 1000 })
    ).toThrow(/annulée/);
    expect(s.paidCents(s.data.docs.find((d) => d.id === doc.id)!)).toBe(0);
  });
});

describe("avoirs / notes de crédit (§22)", () => {
  it("un avoir référence la facture d'origine sans jamais la modifier", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const fac = makeDraft(s, cust.id, [makeLine()]);
    const { number: facNumber } = s.validateDocument(fac.id);

    const avoir = s.createCreditNote(fac.id);
    expect(avoir.docType).toBe("AVOIR");
    expect(avoir.status).toBe("BROUILLON");
    expect(avoir.number).toBeNull();
    expect(avoir.originDocNumber).toBe(facNumber);
    expect(avoir.lines).toHaveLength(1);

    // Série AV distincte (§56).
    const validatedAvoir = s.validateDocument(avoir.id);
    expect(validatedAvoir.number).toBe(`AV-${YEAR}-000001`);

    // La facture d'origine est intacte.
    const src = s.data.docs.find((d) => d.id === fac.id)!;
    expect(src.number).toBe(facNumber);
    expect(src.status).toBe("VALIDEE");

    // Un avoir sur un brouillon ou un non-FAC est refusé.
    const draft = s.createDraft({ docType: "FAC", customerId: cust.id });
    expect(() => s.createCreditNote(draft.id)).toThrow(/pas validée/);
    expect(() => s.createCreditNote(avoir.id)).toThrow(/qu'une facture/);
  });
});

describe("duplication (§46) et conversions (§57-59)", () => {
  it("dupliquer crée un brouillon SANS numéro, jamais une copie du numéro", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const fac = makeDraft(s, cust.id, [makeLine()]);
    const { number } = s.validateDocument(fac.id);

    const copy = s.duplicateDocument(fac.id);
    expect(copy.number).toBeNull();
    expect(copy.status).toBe("BROUILLON");
    expect(copy.id).not.toBe(fac.id);
    expect(copy.lines).toHaveLength(1);
    expect(copy.originDocNumber).toBeUndefined();
    expect(s.data.docs.find((d) => d.id === fac.id)!.number).toBe(number);
  });

  it("devis → facture : nouveau document, nouveau numéro, devis intact (§58)", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const devis = s.createDraft({ docType: "DEV", customerId: cust.id });
    const comp = computeDocument([makeLine()]);
    devis.lines = [makeLine()];
    devis.totalHtCents = comp.totalHtCents;
    devis.totalTvaCents = comp.totalTvaCents;
    devis.totalTtcCents = comp.totalTtcCents;
    devis.vatDetail = comp.vatDetail;
    devis.amountInWords = comp.amountInWords;
    s.updateDraft(devis);
    const validatedDevis = s.validateDocument(devis.id);
    expect(validatedDevis.number).toBe(`DEV-${YEAR}-000001`);

    const fac = s.convertToInvoice(validatedDevis.id);
    expect(fac.docType).toBe("FAC");
    expect(fac.status).toBe("BROUILLON");
    expect(fac.refDevis).toBe(validatedDevis.number);
    expect(s.validateDocument(fac.id).number).toBe(`FAC-${YEAR}-000001`);

    // Conversion refusée pour une facture.
    expect(() => s.convertToInvoice(fac.id)).toThrow();
  });
});

describe("révision de devis (§20, §12)", () => {
  it("réviser un devis envoyé crée un brouillon lié, sans toucher l'original", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const dev = makeDevis(s, cust.id);
    const devNo = s.validateDocument(dev.id).number!;
    const before = JSON.stringify(s.data.docs.find((d) => d.id === dev.id));

    const rev = s.reviseDocument(dev.id);
    expect(rev.id).not.toBe(dev.id);
    expect(rev.docType).toBe("DEV");
    expect(rev.status).toBe("BROUILLON");
    expect(rev.number).toBeNull();
    expect(rev.originDocNumber).toBe(devNo);
    expect(rev.originDocId).toBe(dev.id);
    expect(rev.lines).toHaveLength(1);

    // Le devis d'origine est strictement inchangé (§20)
    expect(JSON.stringify(s.data.docs.find((d) => d.id === dev.id))).toBe(before);
    expect(s.findOpenRevision(devNo)?.id).toBe(rev.id);
    expect(s.revisionsOf(devNo)).toHaveLength(0); // pas encore validée
  });

  it("la révision reçoit un NOUVEAU numéro à la validation, l'original garde le sien", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const dev = makeDevis(s, cust.id);
    const devNo = s.validateDocument(dev.id).number!;
    const rev = s.reviseDocument(dev.id);
    const revNo = s.validateDocument(rev.id).number!;

    expect(revNo).not.toBe(devNo);
    expect(s.data.docs.find((d) => d.id === dev.id)!.number).toBe(devNo);
    expect(s.revisionsOf(devNo).map((d) => d.number)).toEqual([revNo]);
    expect(s.findOpenRevision(devNo)).toBeUndefined();
  });

  it("une seule révision en brouillon à la fois par devis", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const dev = makeDevis(s, cust.id);
    s.validateDocument(dev.id);
    s.reviseDocument(dev.id);
    expect(() => s.reviseDocument(dev.id)).toThrow(/déjà en brouillon/);
  });

  it("refuse : brouillon, facture, devis annulé", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const draft = makeDevis(s, cust.id);
    expect(() => s.reviseDocument(draft.id)).toThrow(/pas encore validé/);

    const fac = makeDraft(s, cust.id, [makeLine()]);
    s.validateDocument(fac.id);
    expect(() => s.reviseDocument(fac.id)).toThrow(/Seul un devis/);

    const dev = makeDevis(s, cust.id);
    s.validateDocument(dev.id);
    s.cancelDocument(dev.id, "Erreur de saisie");
    expect(() => s.reviseDocument(dev.id)).toThrow(/annulé/);
  });
});

describe("paiements (§19)", () => {
  it("partiel puis complet : statuts dérivés automatiquement", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const doc = makeDraft(s, cust.id, [makeLine()]); // TTC 119 000 DA
    s.validateDocument(doc.id);

    s.addPayment({ invoiceId: doc.id, mode: "Chèque", date: "2026-10-08", amountCents: 5_000_000 });
    let d = s.data.docs.find((x) => x.id === doc.id)!;
    expect(d.status).toBe("PARTIELLEMENT_PAYEE");
    expect(s.paidCents(d)).toBe(5_000_000);
    expect(s.remainingCents(d)).toBe(6_900_000);

    s.addPayment({ invoiceId: doc.id, mode: "Virement bancaire", date: "2026-10-09", amountCents: 6_900_000 });
    d = s.data.docs.find((x) => x.id === doc.id)!;
    expect(d.status).toBe("PAYEE");
    expect(s.remainingCents(d)).toBe(0);
  });

  it("garde-fous : trop-perçu, brouillon, montant nul", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const doc = makeDraft(s, cust.id, [makeLine()]);
    expect(() =>
      s.addPayment({ invoiceId: doc.id, mode: "Espèces", date: "2026-10-08", amountCents: 100 })
    ).toThrow(/brouillon/); // §20 : pas d'encaissement avant validation

    s.validateDocument(doc.id);
    expect(() =>
      s.addPayment({ invoiceId: doc.id, mode: "Espèces", date: "2026-10-08", amountCents: 99_999_999 })
    ).toThrow(/dépasse le reste à payer/);
    expect(() =>
      s.addPayment({ invoiceId: doc.id, mode: "Espèces", date: "2026-10-08", amountCents: 0 })
    ).toThrow(/supérieur à 0/);
  });
});

describe("numérotation (§12, §21, §55)", () => {
  it("séquentielle, par année, sans collision possible", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const n1 = s.validateDocument(makeDraft(s, cust.id, [makeLine()]).id).number;
    const n2 = s.validateDocument(makeDraft(s, cust.id, [makeLine()]).id).number;
    expect(n1).toBe(`FAC-${YEAR}-000001`);
    expect(n2).toBe(`FAC-${YEAR}-000002`);

    // Un document daté d'une autre année a son propre compteur.
    const prevYear = YEAR - 1;
    const nPrev = s.validateDocument(
      makeDraft(s, cust.id, [makeLine()], `${prevYear}-06-15`).id
    ).number;
    expect(nPrev).toBe(`FAC-${prevYear}-000001`);

    // Toutes les valeurs restent distinctes (§12).
    const all = s.data.docs.map((d) => d.number).filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
  });

  it("changer le gabarit n'affecte que les FUTURS numéros (§55)", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const before = s.validateDocument(makeDraft(s, cust.id, [makeLine()]).id).number;
    expect(before).toBe(`FAC-${YEAR}-000001`);

    s.updateSequenceConfig("FAC", "F{YEAR}-{COUNTER}", 5);
    const after = s.validateDocument(makeDraft(s, cust.id, [makeLine()]).id).number;
    expect(after).toBe(`F${YEAR}-00002`);
    // Le numéro déjà attribué n'est pas réécrit (§55).
    expect(s.data.docs.find((d) => d.number === before)).toBeTruthy();
  });
});

describe("snapshots historiques (§38)", () => {
  it("modifier une fiche après validation ne change PAS les anciennes factures", () => {
    const s = makeStore();
    const cust = makeCustomer(s, { nif: "002116000000001", adresse: "Ancienne adresse" });
    const doc = makeDraft(s, cust.id, [makeLine()]);
    const validated = s.validateDocument(doc.id);
    const oldSellerName = validated.sellerSnapshot.displayName;

    // Le client déménage et change de NIF ; l'entreprise change de raison sociale.
    s.saveCustomer({ ...cust, nif: "002116555555555", adresse: "Nouvelle adresse" }, false);
    s.updateCompany({ raisonSociale: "Autre Nom SARL" });

    const reloaded = s.data.docs.find((d) => d.id === doc.id)!;
    expect(reloaded.buyerSnapshot.nif).toBe("002116000000001");
    expect(reloaded.buyerSnapshot.adresse).toBe("Ancienne adresse");
    expect(reloaded.sellerSnapshot.displayName).toBe(oldSellerName);
  });
});

describe("moteur fiscal historisé (§10, §74)", () => {
  it("changer un taux ne modifie jamais les documents existants", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const doc = makeDraft(s, cust.id, [makeLine()]); // snapshot 19 %
    const validated = s.validateDocument(doc.id);
    expect(validated.lines[0].taxRatePctSnapshot).toBe(19);

    const tva19 = s.data.taxRates.find((t) => t.code === "TVA19")!;
    s.updateTaxRate(tva19.id, { ratePct: 21, libelle: "TVA 21 %" }, "Loi de finances", "2027-01-01");

    const reloaded = s.data.docs.find((d) => d.id === doc.id)!;
    expect(reloaded.lines[0].taxRatePctSnapshot).toBe(19); // inchangé
    expect(reloaded.totalTtcCents).toBe(11_900_000); // inchangé

    // Historique réglementaire complet (§74).
    const h = s.data.taxHistory[0];
    expect(h.taxCode).toBe("TVA19");
    expect(h.oldValue.ratePct).toBe(19);
    expect(h.newValue.ratePct).toBe(21);
    expect(h.dateEffet).toBe("2027-01-01");
    expect(h.motif).toBe("Loi de finances");

    // Une NOUVELLE facture prend le taux en vigueur au moment de la saisie.
    const newLine = makeLine();
    const tax = s.data.taxRates.find((t) => t.code === "TVA19")!;
    newLine.taxRatePctSnapshot = tax.ratePct;
    newLine.taxLibelleSnapshot = tax.libelle;
    const doc2 = makeDraft(s, cust.id, [newLine]);
    const v2 = s.validateDocument(doc2.id);
    expect(v2.lines[0].taxRatePctSnapshot).toBe(21);
    expect(v2.totalTvaCents).toBe(2_100_000);
  });

  it("refuse un code de taxe dupliqué (§10)", () => {
    const s = makeStore();
    expect(() =>
      s.addTaxRate({
        id: uid("tax"), code: "TVA19", libelle: "Doublon", ratePct: 5,
        dateDebut: "2026-01-01", actif: true,
      })
    ).toThrow(/existe déjà/);
  });
});

describe("contrôles avant validation (§48) et identifiants (§8)", () => {
  it("erreurs bloquantes : quantité, adresse, taux inconnu", () => {
    const s = makeStore();
    const cust = makeCustomer(s);

    const qty0 = makeDraft(s, cust.id, [makeLine({ qty: 0 })]);
    expect(() => s.validateDocument(qty0.id)).toThrow(/quantité/i);

    const noAddress = makeCustomer(s, { adresse: "" });
    const docNoAddr = makeDraft(s, noAddress.id, [makeLine()]);
    expect(() => s.validateDocument(docNoAddr.id)).toThrow(/adresse/i);

    const badTax = makeDraft(s, cust.id, [makeLine({ taxCode: "INCONNU" })]);
    expect(() => s.validateDocument(badTax.id)).toThrow(/code TVA inconnu/);
  });

  it("NIF : OFF / WARN / BLOCK configurables, jamais arbitraire (§8)", () => {
    const s = makeStore();
    const cust = makeCustomer(s, { nif: "PAS-UN-NIF" });

    // WARN (défaut) : la validation passe avec avertissement.
    const doc1 = makeDraft(s, cust.id, [makeLine()]);
    expect(s.validateDocument(doc1.id).status).toBe("VALIDEE");

    // BLOCK : la même saisie est refusée.
    s.updateSettings({
      validation: { ...s.data.settings.validation, nif: "BLOCK" },
    });
    const doc2 = makeDraft(s, cust.id, [makeLine()]);
    expect(() => s.validateDocument(doc2.id)).toThrow(/NIF/);

    // OFF : plus aucun contrôle.
    s.updateSettings({
      validation: { ...s.data.settings.validation, nif: "OFF" },
    });
    const doc3 = makeDraft(s, cust.id, [makeLine()]);
    expect(s.validateDocument(doc3.id).status).toBe("VALIDEE");
  });
});

describe("intégrité des données (§49)", () => {
  it("état sain → OK ; anomalies injectées → détectées", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    makeDraft(s, cust.id, [makeLine()]);
    expect(s.integrityCheck().every((f) => f.severity === "OK")).toBe(true);

    // Doublon de numéro.
    const a = makeDraft(s, cust.id, [makeLine()]);
    const b = makeDraft(s, cust.id, [makeLine()]);
    s.validateDocument(a.id);
    s.validateDocument(b.id);
    const [d1, d2] = [a, b].map((x) => s.data.docs.find((d) => d.id === x.id)!);
    d2.number = d1.number; // corruption simulée
    expect(s.integrityCheck().some((f) => /dupliqués/.test(f.message))).toBe(true);
    d2.number = null;

    // Orphelin.
    s.data.customers = s.data.customers.filter((c) => c.id !== cust.id);
    expect(s.integrityCheck().some((f) => /client inexistant/.test(f.message))).toBe(true);
  });
});

describe("sauvegarde / restauration (§30-32) et migrations (§51)", () => {
  it("export → restauration d'un état antérieur + sauvegarde de sécurité", () => {
    const storage = createMemoryStorage();
    const s = makeStore(storage);
    const cust = makeCustomer(s);
    const backup = s.exportBackup("MANUELLE", "Test");
    expect(JSON.parse(backup).customers).toHaveLength(1);

    // Vie des données APRÈS la sauvegarde…
    s.validateDocument(makeDraft(s, cust.id, [makeLine()]).id);
    expect(s.data.docs.filter((d) => d.number)).toHaveLength(1);

    // …puis restauration de l'état antérieur.
    const res = s.restoreFromBackup(backup);
    expect(res.message).toMatch(/sauvegarde de sécurité/i);
    expect(s.data.docs.filter((d) => d.number)).toHaveLength(0);
    expect(storage.getItem(SECURITY_BACKUP_KEY)).toBeTruthy(); // §32

    // Fichier invalide refusé proprement (§68).
    expect(() => s.restoreFromBackup("{ pas du json")).toThrow(/illisible/);
    expect(() => s.restoreFromBackup(JSON.stringify({ foo: 1 }))).toThrow(/pas une sauvegarde/);
  });

  it("migration douce : payload ancien ou incomplet complété sans perte (§51)", () => {
    const legacy = {
      schemaVersion: 0,
      initialized: true,
      company: { raisonSociale: "Ancienne SARL" },
      customers: [],
      docs: [],
    };
    const migrated = applyLocalMigrations(legacy);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.company.raisonSociale).toBe("Ancienne SARL");
    expect(migrated.users).toEqual([]); // champ apparu plus tard
    expect(migrated.taxRates.length).toBeGreaterThan(0); // référentiel réinjecté
    expect(migrated.sequenceConfigs.length).toBe(5); // FAC/DEV/PRO/BL/AVOIR
    expect(migrated.settings.validation.nif).toBe("WARN");

    // Données corrompues → base neuve, jamais d'exception (§81 : pas de crash).
    const fresh = applyLocalMigrations(JSON.parse("{}"));
    expect(fresh.schemaVersion).toBe(1);
  });

  it("le store survit à un localStorage corrompu", () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, "%%% corrompu %%%");
    const s = createStore(storage);
    expect(s.data.initialized).toBe(false); // base neuve, pas de crash
  });
});

describe("journal d'audit (§34) et sécurité (§36)", () => {
  it("chaque action sensible laisse une trace horodatée", () => {
    const s = makeStore();
    const cust = makeCustomer(s);
    const doc = makeDraft(s, cust.id, [makeLine()]);
    s.validateDocument(doc.id);
    s.addPayment({ invoiceId: doc.id, mode: "Espèces", date: "2026-10-08", amountCents: 1_000 });
    s.cancelDocument(doc.id, "Erreur");

    const actions = s.data.audit.map((a) => a.action);
    expect(actions).toContain("CREATION_BROUILLON");
    expect(actions).toContain("VALIDATION_DOCUMENT");
    expect(actions).toContain("ENCAISSEMENT");
    expect(actions).toContain("ANNULATION_DOCUMENT");
    expect(s.data.audit.every((a) => a.ts && a.utilisateur)).toBe(true);
  });

  it("mots de passe : jamais en clair, vérification fiable (§36)", async () => {
    const s = makeStore();
    await s.addUser("comptable", "COMPTABLE", "secret123");
    const u = s.data.users[0];
    expect(u.passwordHash).not.toContain("secret123");
    expect(u.passwordHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex

    expect(await s.verifyPassword("comptable", "secret123")).toBe(true);
    expect(await s.verifyPassword("comptable", "mauvais")).toBe(false);
    expect(await s.verifyPassword("inconnu", "secret123")).toBe(false);

    await expect(s.addUser("comptable", "VENDEUR", "autre456")).rejects.toThrow(/existe déjà/);
    await expect(s.addUser("vendeuse", "VENDEUR", "123")).rejects.toThrow(/6 caractères/);
  });
});

describe("isolation des données de démonstration (§77)", () => {
  it("les données démo sont marquées et distinguables des réelles", () => {
    const s = makeStore();
    s.completeFirstRun(s.data.company, true, "admin");
    expect(s.data.demoSeeded).toBe(true);
    expect(s.data.customers.length).toBeGreaterThan(0);
    expect(s.data.customers.every((c) => c.demo === true)).toBe(true);
    expect(s.data.docs.filter((d) => d.docType === "FAC").length).toBeGreaterThan(0);

    // Une création réelle n'est pas marquée démo.
    const real = s.saveCustomer(
      {
        id: uid("cus"), type: "ENTREPRISE", denomination: "Vrai Client SARL",
        adresse: "Adresse réelle", contacts: [], actif: true,
        createdAt: "", updatedAt: "",
      } as Customer,
      true
    );
    expect(real.demo).toBeFalsy();
  });
});
