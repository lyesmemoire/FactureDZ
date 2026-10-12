/**
 * FacturationDZ — Synchronisation desktop (write-through) vers SQLite.
 *
 * Le store TypeScript reste la source de vérité de l'UI ; en mode desktop
 * (Tauri), chaque mutation est mirrorée vers la base SQLite via les
 * commandes `sync_upsert` / `sync_delete` (src-tauri/src/sync.rs). La
 * table `desktop_ids` assure la correspondance identifiants chaîne ↔ INTEGER.
 *
 * Après une restauration de base (§32), `datasetToAppData` réhydrate
 * l'état frontend depuis le jeu de données renvoyé par `load_dataset`.
 */

import { computeDocument } from "../core/invoiceCalculator";
import { invokeDesktop } from "./desktop";
import type {
  AuditEntry,
  BackupRecord,
  Company,
  Customer,
  DocType,
  InvoiceDoc,
  PartySnapshot,
  Payment,
  PoStatus,
  Product,
  PurchaseOrder,
  SequenceConfig,
  Supplier,
  TaxChangeRecord,
  TaxRate,
  UserAccount,
} from "../core/types";
import type { AppData, Settings } from "./store";

/* ------------------------------------------------------------------ */
/* Journalisation des erreurs de miroir (jamais bloquantes pour l'UI)  */
/* ------------------------------------------------------------------ */

type ErrorHandler = (message: string) => void;
let errorHandler: ErrorHandler = (m) => console.error("[desktopSync]", m);

export function setMirrorErrorHandler(fn: ErrorHandler): void {
  errorHandler = fn;
}

export function mirrorUpsert(entity: string, localId: string, data: unknown): void {
  // Attention (§70) : Tauri v2 attend les paramètres Rust en camelCase
  // (`local_id` côté Rust → `localId` côté JS). Le contrat est vérifié par
  // src/store/ipcContract.test.ts (garde-fou F-18).
  void invokeDesktop("sync_upsert", { entity, localId, data }).catch((e: unknown) => {
    errorHandler(`Miroir « ${entity} » en échec : ${(e as Error)?.message ?? e}`);
  });
}

/** Variante awaitable : l'appelant peut dépendre de l'écriture (ex. compte créé avant login). */
export function mirrorUpsertAsync(entity: string, localId: string, data: unknown): Promise<void> {
  return invokeDesktop("sync_upsert", { entity, localId, data }).then(() => undefined);
}

export function mirrorDelete(entity: string, localId: string): void {
  void invokeDesktop("sync_delete", { entity, localId }).catch((e: unknown) => {
    errorHandler(`Suppression miroir « ${entity} » en échec : ${(e as Error)?.message ?? e}`);
  });
}

/* ------------------------------------------------------------------ */
/* Constructeurs de payloads (snake_case côté Rust)                    */
/* ------------------------------------------------------------------ */

const opt = (v: string | undefined | null): string | null =>
  v === undefined || v === null || v === "" ? null : v;

export function companyPayload(c: Company) {
  return {
    raison_sociale: c.raisonSociale,
    nom_commercial: opt(c.nomCommercial),
    forme_juridique: opt(c.formeJuridique),
    activite: opt(c.activite),
    adresse: opt(c.adresse),
    wilaya: opt(c.wilaya),
    commune: opt(c.commune),
    telephone: opt(c.telephone),
    fax: opt(c.fax),
    email: opt(c.email),
    site_web: opt(c.siteWeb),
    rc: opt(c.rc),
    nif: opt(c.nif),
    nis: opt(c.nis),
    article_imposition: opt(c.articleImposition),
    tin_libelle: opt(c.tinLibelle),
    capital_social: opt(c.capitalSocial),
    banque: opt(c.banque),
    agence: opt(c.agence),
    rib: opt(c.rib),
    rip_ccp: opt(c.ripCcp),
    // Images : data-URL stockées en base desktop (postes locaux uniquement).
    logo_path: opt(c.logoDataUrl),
    cachet_path: opt(c.cachetDataUrl),
    signature_path: opt(c.signatureDataUrl),
    afficher_cachet: c.afficherCachet,
    afficher_signature: c.afficherSignature,
    afficher_banque: c.afficherCoordonneesBancaires,
    devise: c.devise || "DZD",
    tax_code_defaut: c.taxCodeDefaut || "TVA19",
    conditions_paiement_defaut_jours: c.conditionsPaiementDefautJours ?? 30,
    mode_paiement_defaut: c.modePaiementDefaut || "Virement bancaire",
  };
}

export function customerPayload(c: Customer) {
  return {
    type: c.type,
    denomination: opt(c.denomination),
    nom_commercial: opt(c.nomCommercial),
    forme_juridique: opt(c.formeJuridique),
    activite: opt(c.activite),
    nom: opt(c.nom),
    prenom: opt(c.prenom),
    adresse: opt(c.adresse),
    wilaya: opt(c.wilaya),
    commune: opt(c.commune),
    telephone: opt(c.telephone),
    fax: opt(c.fax),
    email: opt(c.email),
    contact_principal: opt(c.contactPrincipal),
    rc: opt(c.rc),
    nif: opt(c.nif),
    nis: opt(c.nis),
    article_imposition: opt(c.articleImposition),
    tin_international: opt(c.tinInternational),
    conditions_paiement_jours: c.conditionsPaiementJours ?? null,
    plafond_credit_cents: c.creditLimitCents ?? null,
    observations: opt(c.observations),
    actif: c.actif,
    demo: c.demo ?? false,
    contacts: c.contacts.map((k) => ({
      nom: k.nom,
      fonction: opt(k.fonction),
      telephone: opt(k.telephone),
      email: opt(k.email),
    })),
  };
}

export function productPayload(p: Product) {
  return {
    kind: "PRODUIT",
    reference: p.reference,
    designation: p.designation,
    description: opt(p.description),
    unite: p.unite,
    pu_ht_cents: p.puHtCents,
    tax_code_defaut: p.taxCodeDefaut,
    categorie: opt(p.categorie),
    actif: p.actif,
    demo: p.demo ?? false,
  };
}

export function taxRatePayload(t: TaxRate) {
  return {
    code: t.code,
    libelle: t.libelle,
    rate_pct: t.ratePct,
    date_debut: t.dateDebut,
    date_fin: opt(t.dateFin),
    actif: t.actif,
    kind: t.kind ?? "TVA",
    description: opt(t.description),
    reference_reglementaire: opt(t.referenceReglementaire),
    commentaire: opt(t.commentaire),
  };
}

export function taxHistoryPayload(r: TaxChangeRecord) {
  return {
    tax_code: r.taxCode,
    old_value: JSON.stringify(r.oldValue),
    new_value: JSON.stringify(r.newValue),
    date_effet: r.dateEffet,
    motif: opt(r.motif),
    ts: r.ts,
  };
}

export function userPayload(u: UserAccount) {
  return { username: u.username, password_hash: u.passwordHash, role: u.role };
}

export function settingsPairs(s: Settings, language?: string): Record<string, string> {
  return {
    auto_backup_frequency: s.autoBackupFrequency,
    auto_backup_retention: String(s.autoBackupRetention),
    lock_timeout_minutes: String(s.lockTimeoutMinutes),
    validation_nif: s.validation.nif,
    validation_nis: s.validation.nis,
    validation_rc: s.validation.rc,
    validation_ai: s.validation.articleImposition,
    validation_nif_pattern: s.validation.nifPattern,
    validation_nis_pattern: s.validation.nisPattern,
    validation_rc_pattern: s.validation.rcPattern,
    validation_ai_pattern: s.validation.aiPattern,
    ...(language ? { language } : {}),
  };
}

export function sequencePayload(
  docType: DocType,
  year: number,
  counter: number,
  cfg: SequenceConfig
) {
  return {
    doc_type: docType,
    year,
    counter,
    template: cfg.template,
    padding: cfg.padding,
  };
}

/** Fournisseur (achats) — même convention que customerPayload. */
export function supplierPayload(f: Supplier) {
  return {
    denomination: f.denomination,
    nom_commercial: opt(f.nomCommercial),
    adresse: opt(f.adresse),
    wilaya: opt(f.wilaya),
    commune: opt(f.commune),
    telephone: opt(f.telephone),
    email: opt(f.email),
    contact_principal: opt(f.contactPrincipal),
    rc: opt(f.rc),
    nif: opt(f.nif),
    nis: opt(f.nis),
    article_imposition: opt(f.articleImposition),
    conditions_paiement_jours: f.conditionsPaiementJours ?? null,
    observations: opt(f.observations),
    actif: f.actif,
    demo: f.demo ?? false,
  };
}

/** Bon de commande : en-tête + lignes. Une fois émis, seules réception et statut sont envoyés utilement. */
export function purchaseOrderPayload(po: PurchaseOrder, createdByUsername: string) {
  return {
    supplier_local_id: po.supplierId,
    number: po.number,
    status: po.status,
    date: po.date,
    date_livraison: opt(po.dateLivraison),
    devise: po.devise || "DZD",
    mode_paiement: opt(po.modePaiement),
    conditions_paiement: opt(po.conditionsPaiement),
    lieu_livraison: opt(po.lieuLivraison),
    observations: opt(po.observations),
    supplier_snapshot: po.supplierSnapshot,
    total_ht_cents: po.totalHtCents,
    total_tva_cents: po.totalTvaCents,
    total_ttc_cents: po.totalTtcCents,
    montant_lettres: po.amountInWords,
    vat_detail: po.vatDetail,
    sent_at: opt(po.sentAt),
    cancelled_at: opt(po.cancelledAt),
    cancel_motif: opt(po.cancelMotif),
    created_by_username: createdByUsername,
    lines: po.lines.map((l) => ({
      product_ref: opt(l.productRef),
      designation: l.designation,
      unite: l.unite,
      qty: l.qty,
      qty_recue: l.qtyRecue,
      pu_ht_cents: l.puHtCents,
      remise_pct: l.remisePct ?? 0,
      tax_code: l.taxCode,
      tax_rate_pct_snapshot: l.taxRatePctSnapshot,
    })),
  };
}

export function docPayload(d: InvoiceDoc, createdByUsername: string) {
  const comp = computeDocument(d.lines, d.globalDiscount, d.devise);
  return {
    doc_type: d.docType,
    number: d.number,
    status: d.status,
    date: d.date,
    date_echeance: opt(d.dateEcheance),
    customer_local_id: d.customerId,
    mode_paiement: opt(d.modePaiement),
    conditions_paiement: opt(d.conditionsPaiement),
    ref_commande: opt(d.refCommande),
    ref_devis: opt(d.refDevis),
    origin_doc_number: opt(d.originDocNumber),
    ref_bon_livraison: opt(d.refBonLivraison),
    observations: opt(d.observations),
    conditions_vente: opt(d.conditionsVente),
    devise: d.devise,
    remise_globale_kind: d.globalDiscount?.kind ?? null,
    remise_globale_valeur_cents: d.globalDiscount?.value ?? null,
    total_ht_cents: d.totalHtCents,
    total_tva_cents: d.totalTvaCents,
    total_ttc_cents: d.totalTtcCents,
    total_other_taxes_cents: d.totalOtherTaxesCents ?? 0,
    montant_lettres: d.amountInWords,
    vat_detail: d.vatDetail,
    other_tax_detail: d.otherTaxDetail ?? [],
    seller_snapshot: d.sellerSnapshot,
    buyer_snapshot: d.buyerSnapshot,
    incoterm: opt(d.incoterm),
    pays_origine: opt(d.paysOrigine),
    taux_change: opt(d.tauxChange),
    ref_douaniere: opt(d.refDouaniere),
    cancelled_at: d.cancellation?.at ?? null,
    cancel_motif: d.cancellation?.motif ?? null,
    archived: d.archived,
    demo: d.demo ?? false,
    created_by_username: createdByUsername,
    items: d.lines.map((l, i) => ({
      nature: l.nature,
      product_ref: opt(l.productRef),
      designation: l.designation,
      description: opt(l.description),
      qty: l.qty,
      unite: l.unite,
      pu_ht_cents: l.puHtCents,
      remise_pct: l.remisePct ?? 0,
      tax_code: l.taxCode,
      tax_rate_pct_snapshot: l.taxRatePctSnapshot,
      tax_libelle_snapshot: l.taxLibelleSnapshot,
      tax_kind_snapshot: l.taxKindSnapshot ?? "TVA",
      motif_exoneration: opt(l.motifExoneration),
      ht_cents: comp.finalLineHtCents[i] ?? 0,
      tva_cents: (l.taxKindSnapshot ?? "TVA") === "TVA" ? comp.tvaPerLine[i] ?? 0 : 0,
      ttc_cents: (comp.finalLineHtCents[i] ?? 0) + (comp.tvaPerLine[i] ?? 0),
    })),
  };
}

export function paymentPayload(p: Payment, createdByUsername: string) {
  return {
    invoice_local_id: p.invoiceId,
    mode: p.mode,
    date: p.date,
    amount_cents: p.amountCents,
    reference: opt(p.reference),
    banque: opt(p.banque),
    numero_cheque: opt(p.numeroCheque),
    commentaire: opt(p.commentaire),
    created_by_username: createdByUsername,
  };
}

export function auditPayload(a: AuditEntry) {
  return {
    ts: a.ts,
    username: a.utilisateur,
    action: a.action,
    object_type: a.objectType,
    object_id: opt(a.objectId),
    details: opt(a.details),
    old_value: opt(a.oldValue),
    new_value: opt(a.newValue),
  };
}

export function backupRecordPayload(b: BackupRecord) {
  return {
    ts: b.ts,
    kind: b.kind === "SECURITE_AVANT_RESTAURATION" ? "SECURITE" : b.kind,
    label: b.label,
    size_bytes: b.sizeBytes,
    count_invoices: b.counts.factures,
    count_customers: b.counts.clients,
    count_products: b.counts.produits,
    schema_version: b.schemaVersion,
  };
}

/* ------------------------------------------------------------------ */
/* Réhydratation depuis SQLite (après restauration §32)                */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function asBool(v: unknown): boolean {
  return v === 1 || v === true || v === "1";
}

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Détecte si la base SQLite contient déjà une configuration exploitable
 *  (entreprise renseignée ou compte utilisateur). Sert de garde-fou à
 *  l'amorçage : on ne remplace JAMAIS un profil vide par un dataset vide,
 *  et on ne réaffiche jamais l'assistant sur des données existantes (§51, §52). */
export function datasetLooksConfigured(ds: unknown): boolean {
  if (!ds || typeof ds !== "object") return false;
  const d = ds as Row;
  const company = d.company as { raison_sociale?: string } | null | undefined;
  if (company && String(company.raison_sociale ?? "").trim().length > 0) return true;
  const users = d.users;
  if (Array.isArray(users) && users.length > 0) return true;
  return false;
}

export function datasetToAppData(ds: Row, base: AppData): AppData {
  const data: AppData = JSON.parse(JSON.stringify(base));

  // Entreprise.
  if (ds.company && typeof ds.company === "object") {
    const c = ds.company as Row;
    data.company = {
      ...data.company,
      raisonSociale: String(c.raison_sociale ?? ""),
      nomCommercial: c.nom_commercial || undefined,
      formeJuridique: c.forme_juridique || undefined,
      activite: c.activite || undefined,
      adresse: c.adresse || undefined,
      wilaya: c.wilaya || undefined,
      commune: c.commune || undefined,
      telephone: c.telephone || undefined,
      fax: c.fax || undefined,
      email: c.email || undefined,
      siteWeb: c.site_web || undefined,
      rc: c.rc || undefined,
      nif: c.nif || undefined,
      nis: c.nis || undefined,
      articleImposition: c.article_imposition || undefined,
      tinLibelle: c.tin_libelle || undefined,
      capitalSocial: c.capital_social || undefined,
      banque: c.banque || undefined,
      agence: c.agence || undefined,
      rib: c.rib || undefined,
      ripCcp: c.rip_ccp || undefined,
      logoDataUrl: c.logo_path || undefined,
      cachetDataUrl: c.cachet_path || undefined,
      signatureDataUrl: c.signature_path || undefined,
      afficherCachet: asBool(c.afficher_cachet ?? true),
      afficherSignature: asBool(c.afficher_signature ?? true),
      afficherCoordonneesBancaires: asBool(c.afficher_banque ?? true),
      devise: String(c.devise ?? "DZD"),
      taxCodeDefaut: String(c.tax_code_defaut ?? "TVA19"),
      conditionsPaiementDefautJours: Number(c.conditions_paiement_defaut_jours ?? 30),
      modePaiementDefaut: String(c.mode_paiement_defaut ?? "Virement bancaire"),
    };
  }

  // Clients (+ contacts rattachés par customer_id).
  const contactsByCustomer = new Map<number, Row[]>();
  for (const k of (ds.customer_contacts ?? []) as Row[]) {
    const cid = Number(k.customer_id);
    if (!contactsByCustomer.has(cid)) contactsByCustomer.set(cid, []);
    contactsByCustomer.get(cid)!.push(k);
  }
  data.customers = ((ds.customers ?? []) as Row[]).map((c) => ({
    id: String(c.local_id),
    type: c.type === "PARTICULIER" ? "PARTICULIER" : "ENTREPRISE",
    denomination: c.denomination || undefined,
    nomCommercial: c.nom_commercial || undefined,
    formeJuridique: c.forme_juridique || undefined,
    activite: c.activite || undefined,
    nom: c.nom || undefined,
    prenom: c.prenom || undefined,
    adresse: c.adresse || undefined,
    wilaya: c.wilaya || undefined,
    commune: c.commune || undefined,
    telephone: c.telephone || undefined,
    fax: c.fax || undefined,
    email: c.email || undefined,
    contactPrincipal: c.contact_principal || undefined,
    rc: c.rc || undefined,
    nif: c.nif || undefined,
    nis: c.nis || undefined,
    articleImposition: c.article_imposition || undefined,
    tinInternational: c.tin_international || undefined,
    conditionsPaiementJours: c.conditions_paiement_jours == null ? undefined : Number(c.conditions_paiement_jours),
    creditLimitCents: c.plafond_credit_cents == null ? undefined : Number(c.plafond_credit_cents),
    observations: c.observations || undefined,
    contacts: (contactsByCustomer.get(Number(c.id)) ?? []).map((k, i) => ({
      id: `${c.local_id}-contact-${i}`,
      nom: String(k.nom ?? ""),
      fonction: k.fonction || undefined,
      telephone: k.telephone || undefined,
      email: k.email || undefined,
    })),
    actif: asBool(c.actif ?? true),
    demo: asBool(c.demo),
    createdAt: String(c.created_at ?? new Date().toISOString()),
    updatedAt: String(c.updated_at ?? new Date().toISOString()),
  }));

  // Produits.
  data.products = ((ds.products ?? []) as Row[]).map((p) => ({
    id: String(p.local_id),
    reference: String(p.reference ?? ""),
    designation: String(p.designation ?? ""),
    description: p.description || undefined,
    unite: String(p.unite ?? "unité"),
    puHtCents: Number(p.pu_ht_cents ?? 0),
    taxCodeDefaut: String(p.tax_code_defaut ?? "TVA19"),
    categorie: p.categorie || undefined,
    actif: asBool(p.actif ?? true),
    demo: asBool(p.demo),
    createdAt: String(p.created_at ?? new Date().toISOString()),
    updatedAt: String(p.updated_at ?? new Date().toISOString()),
  }));

  // Taxes (§10).
  data.taxRates = ((ds.tax_rates ?? []) as Row[]).map((t) => ({
    id: `tax-${t.code}`,
    code: String(t.code),
    libelle: String(t.libelle ?? ""),
    ratePct: Number(t.rate_pct ?? 0),
    dateDebut: String(t.date_debut ?? "2000-01-01"),
    dateFin: t.date_fin || undefined,
    actif: asBool(t.actif ?? true),
    kind: t.kind === "AUTRE" ? "AUTRE" : "TVA",
    description: t.description || undefined,
    referenceReglementaire: t.reference_reglementaire || undefined,
    commentaire: t.commentaire || undefined,
  }));

  // Historique réglementaire (§74).
  data.taxHistory = ((ds.tax_history ?? []) as Row[]).map((h, i) => ({
    id: `taxchg-db-${h.id ?? i}`,
    taxCode: String(h.tax_code ?? ""),
    oldValue: parseJsonSafe(h.old_json, {}),
    newValue: parseJsonSafe(h.new_json, {}),
    dateEffet: String(h.date_effet ?? ""),
    motif: h.motif || undefined,
    utilisateur: String(h.username ?? "Système"),
    ts: String(h.ts ?? new Date().toISOString()),
  }));

  // Utilisateurs (le hash restauré peut être Argon2 — la vérification
  // passe par le backend desktop en mode Tauri).
  data.users = ((ds.users ?? []) as Row[]).map((u) => ({
    id: String(u.local_id),
    username: String(u.username ?? ""),
    role: u.role ?? "VENDEUR",
    passwordHash: String(u.password_hash ?? ""),
    createdAt: String(u.created_at ?? new Date().toISOString()),
  }));

  // Documents + lignes.
  const seqConfigs = new Map<string, SequenceConfig>();
  const seqRaw = (ds.sequences ?? {}) as Row;
  for (const cfg of Object.values((seqRaw.configs ?? {}) as Record<string, Row>)) {
    seqConfigs.set(String(cfg.doc_type), {
      docType: cfg.doc_type as DocType,
      template: String(cfg.template ?? ""),
      padding: Number(cfg.padding ?? 6),
    });
  }

  data.docs = ((ds.documents ?? []) as Row[]).map((d) => {
    const cancelledAt = d.cancelled_at ? String(d.cancelled_at) : null;
    const doc: InvoiceDoc = {
      id: String(d.local_id),
      docType: d.doc_type as DocType,
      number: d.number || null,
      status: d.status,
      date: String(d.date ?? ""),
      dateEcheance: d.date_echeance || undefined,
      customerId: String(d.customer_local_id ?? ""),
      sellerSnapshot: parseJsonSafe(d.seller_snapshot_json, { displayName: "" } as any),
      buyerSnapshot: parseJsonSafe(d.buyer_snapshot_json, { displayName: "" } as any),
      lines: ((d.items ?? []) as Row[]).map((it, i) => ({
        id: `${d.local_id}-line-${i}`,
        nature: it.nature ?? "VENTE",
        productRef: it.product_ref || undefined,
        designation: String(it.designation ?? ""),
        description: it.description || undefined,
        qty: Number(it.qty ?? 0),
        unite: String(it.unite ?? "unité"),
        puHtCents: Number(it.pu_ht_cents ?? 0),
        remisePct: Number(it.remise_pct ?? 0) || undefined,
        taxCode: String(it.tax_code ?? "TVA19"),
        taxRatePctSnapshot: Number(it.tax_rate_pct_snapshot ?? 0),
        taxLibelleSnapshot: String(it.tax_libelle_snapshot ?? ""),
        taxKindSnapshot: it.tax_kind_snapshot === "AUTRE" ? "AUTRE" : "TVA",
        motifExoneration: it.motif_exoneration || undefined,
      })),
      globalDiscount:
        d.remise_globale_kind && d.remise_globale_valeur_cents != null
          ? { kind: d.remise_globale_kind, value: Number(d.remise_globale_valeur_cents) }
          : undefined,
      totalHtCents: Number(d.total_ht_cents ?? 0),
      totalTvaCents: Number(d.total_tva_cents ?? 0),
      totalOtherTaxesCents: Number(d.total_other_taxes_cents ?? 0),
      totalTtcCents: Number(d.total_ttc_cents ?? 0),
      vatDetail: parseJsonSafe(d.vat_detail_json, []),
      otherTaxDetail: parseJsonSafe(d.other_tax_detail_json, []),
      amountInWords: String(d.montant_lettres ?? ""),
      modePaiement: d.mode_paiement || undefined,
      conditionsPaiement: d.conditions_paiement || undefined,
      refCommande: d.ref_commande || undefined,
      refDevis: d.ref_devis || undefined,
      originDocNumber: d.origin_doc_number || undefined,
      refBonLivraison: d.ref_bon_livraison || undefined,
      observations: d.observations || undefined,
      conditionsVente: d.conditions_vente || undefined,
      incoterm: d.incoterm || undefined,
      paysOrigine: d.pays_origine || undefined,
      tauxChange: d.taux_change || undefined,
      refDouaniere: d.ref_douaniere || undefined,
      devise: String(d.devise ?? "DZD"),
      archived: asBool(d.archived),
      demo: asBool(d.demo),
      cancellation: cancelledAt
        ? { at: cancelledAt, by: String(d.cancelled_by_name ?? ""), motif: String(d.cancel_motif ?? "") }
        : undefined,
      createdBy: String(d.created_by_name ?? ""),
      createdAt: String(d.created_at ?? new Date().toISOString()),
      updatedAt: String(d.updated_at ?? new Date().toISOString()),
    };
    return doc;
  });

  // Paiements.
  data.payments = ((ds.payments ?? []) as Row[]).map((p) => ({
    id: String(p.local_id),
    invoiceId: String(p.invoice_local_id ?? ""),
    invoiceNumber: "",
    mode: String(p.mode ?? ""),
    date: String(p.date ?? ""),
    amountCents: Number(p.amount_cents ?? 0),
    reference: p.reference || undefined,
    banque: p.banque || undefined,
    numeroCheque: p.numero_cheque || undefined,
    commentaire: p.commentaire || undefined,
    ts: String(p.ts ?? new Date().toISOString()),
  }));
  // Numéro de facture pour affichage.
  const numberById = new Map(data.docs.map((d) => [d.id, d.number ?? "(brouillon)"]));
  data.payments.forEach((p) => {
    p.invoiceNumber = numberById.get(p.invoiceId) ?? "";
  });

  // Audit.
  data.audit = ((ds.audit ?? []) as Row[]).map((a, i) => ({
    id: `aud-db-${i}-${a.ts ?? ""}`,
    ts: String(a.ts ?? ""),
    utilisateur: String(a.username ?? ""),
    action: String(a.action ?? ""),
    objectType: String(a.object_type ?? ""),
    objectId: a.object_id || undefined,
    details: a.details || undefined,
    oldValue: a.old_value || undefined,
    newValue: a.new_value || undefined,
  }));

  // Historique des sauvegardes.
  data.backupHistory = ((ds.backup_history ?? []) as Row[]).map((b, i) => ({
    id: `bkp-db-${b.id ?? i}`,
    ts: String(b.ts ?? ""),
    kind: (b.kind === "SECURITE" ? "SECURITE_AVANT_RESTAURATION" : b.kind) as BackupRecord["kind"],
    label: String(b.label ?? ""),
    sizeBytes: Number(b.size_bytes ?? 0),
    counts: {
      factures: Number(b.count_invoices ?? 0),
      clients: Number(b.count_customers ?? 0),
      produits: Number(b.count_products ?? 0),
    },
    schemaVersion: Number(b.schema_version ?? 1),
  }));

  // Séquences : compteurs + modèles.
  const counters = (seqRaw.counters ?? {}) as Record<string, number>;
  data.sequences = { ...counters };

  // Achats : fournisseurs et bons de commande (migration 0006).
  data.suppliers = ((ds.suppliers ?? []) as Row[]).map((f) => ({
    id: String(f.local_id),
    denomination: String(f.denomination ?? ""),
    nomCommercial: f.nom_commercial || undefined,
    adresse: f.adresse || undefined,
    wilaya: f.wilaya || undefined,
    commune: f.commune || undefined,
    telephone: f.telephone || undefined,
    email: f.email || undefined,
    contactPrincipal: f.contact_principal || undefined,
    rc: f.rc || undefined,
    nif: f.nif || undefined,
    nis: f.nis || undefined,
    articleImposition: f.article_imposition || undefined,
    conditionsPaiementJours: f.conditions_paiement_jours == null ? undefined : Number(f.conditions_paiement_jours),
    observations: f.observations || undefined,
    actif: asBool(f.actif ?? true),
    demo: asBool(f.demo),
    createdAt: String(f.created_at ?? new Date().toISOString()),
    updatedAt: String(f.updated_at ?? new Date().toISOString()),
  }));

  data.purchaseOrders = ((ds.purchase_orders ?? []) as Row[]).map((po) => ({
    id: String(po.local_id),
    number: po.number ? String(po.number) : null,
    status: po.status as PoStatus,
    supplierId: String(po.supplier_local_id ?? ""),
    supplierSnapshot: parseJsonSafe(po.supplier_snapshot_json, { displayName: "", type: "ENTREPRISE" } as PartySnapshot),
    date: String(po.date ?? ""),
    dateLivraison: po.date_livraison || undefined,
    devise: String(po.devise || "DZD"),
    modePaiement: po.mode_paiement || undefined,
    conditionsPaiement: po.conditions_paiement || undefined,
    lieuLivraison: po.lieu_livraison || undefined,
    observations: po.observations || undefined,
    lines: ((po.lines ?? []) as Row[]).map((l) => ({
      id: `${po.local_id}-l${l.line_no}`,
      productRef: l.product_ref || undefined,
      designation: String(l.designation ?? ""),
      unite: String(l.unite ?? ""),
      qty: Number(l.qty ?? 0),
      qtyRecue: Number(l.qty_recue ?? 0),
      puHtCents: Number(l.pu_ht_cents ?? 0),
      remisePct: Number(l.remise_pct ?? 0),
      taxCode: String(l.tax_code ?? ""),
      taxRatePctSnapshot: Number(l.tax_rate_pct_snapshot ?? 0),
    })),
    totalHtCents: Number(po.total_ht_cents ?? 0),
    totalTvaCents: Number(po.total_tva_cents ?? 0),
    totalTtcCents: Number(po.total_ttc_cents ?? 0),
    vatDetail: parseJsonSafe(po.vat_detail_json, []),
    amountInWords: String(po.montant_lettres ?? ""),
    sentAt: po.sent_at || undefined,
    cancelledAt: po.cancelled_at || undefined,
    cancelMotif: po.cancel_motif || undefined,
    createdByUsername: po.created_by_name ? String(po.created_by_name) : undefined,
    createdAt: String(po.created_at ?? new Date().toISOString()),
    updatedAt: String(po.updated_at ?? new Date().toISOString()),
  }));
  const configs: SequenceConfig[] = [...data.sequenceConfigs];
  seqConfigs.forEach((cfg, docType) => {
    const idx = configs.findIndex((c) => c.docType === docType);
    if (idx >= 0) configs[idx] = cfg;
    else configs.push(cfg);
  });
  data.sequenceConfigs = configs;

  // Paramètres.
  const s = (ds.settings ?? {}) as Record<string, string>;
  if (Object.keys(s).length) {
    data.settings = {
      ...data.settings,
      autoBackupFrequency: (["OFF", "DAILY", "WEEKLY", "ON_CLOSE"].includes(s.auto_backup_frequency)
        ? s.auto_backup_frequency
        : data.settings.autoBackupFrequency) as Settings["autoBackupFrequency"],
      autoBackupRetention: Number(s.auto_backup_retention ?? data.settings.autoBackupRetention),
      lockTimeoutMinutes: Number(s.lock_timeout_minutes ?? data.settings.lockTimeoutMinutes),
      validation: {
        ...data.settings.validation,
        nif: (["OFF", "WARN", "BLOCK"].includes(s.validation_nif) ? s.validation_nif : "WARN") as "OFF" | "WARN" | "BLOCK",
        nis: (["OFF", "WARN", "BLOCK"].includes(s.validation_nis) ? s.validation_nis : "WARN") as "OFF" | "WARN" | "BLOCK",
        rc: (["OFF", "WARN", "BLOCK"].includes(s.validation_rc) ? s.validation_rc : "WARN") as "OFF" | "WARN" | "BLOCK",
        articleImposition: (["OFF", "WARN", "BLOCK"].includes(s.validation_ai) ? s.validation_ai : "WARN") as "OFF" | "WARN" | "BLOCK",
        nifPattern: s.validation_nif_pattern ?? data.settings.validation.nifPattern,
        nisPattern: s.validation_nis_pattern ?? data.settings.validation.nisPattern,
        rcPattern: s.validation_rc_pattern ?? data.settings.validation.rcPattern,
        aiPattern: s.validation_ai_pattern ?? data.settings.validation.aiPattern,
      },
    };
    if (s.language) data.language = s.language as AppData["language"];
  }

  data.initialized = true;
  return data;
}
