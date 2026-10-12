/**
 * FacturationDZ — Couche de données.
 *
 * Deux modes d'exécution (§2, §70) :
 *  - DESKTOP (Tauri) : chaque action correspond à une commande IPC exécutée
 *    par le backend Rust sur SQLite (src-tauri). Les transactions, la
 *    contrainte UNIQUE des numéros et les snapshots y sont appliqués au
 *    niveau base de données.
 *  - DÉMONSTRATION / DÉVELOPPEMENT : le même contrat métier est appliqué
 *    ici, avec persistance locale (localStorage), afin que la logique de
 *    gestion (numérotation, validation, annulation, avoirs, paiements,
 *    audit, sauvegardes) soit strictement identique.
 *
 * Les données de démonstration (§77) sont marquées `demo: true` et ne sont
 * jamais mélangées aux données réelles.
 */

import { computeDocument } from "../core/invoiceCalculator";
import { uid } from "../core/ids";
import { nowISO, todayISO } from "../core/format";
import { invokeDesktop, isTauri } from "./desktop";
import { roleAllows, type Action, type Role } from "../core/permissions";
import {
  auditPayload,
  backupRecordPayload,
  companyPayload,
  customerPayload,
  purchaseOrderPayload,
  supplierPayload,
  datasetLooksConfigured,
  datasetToAppData,
  docPayload,
  mirrorDelete,
  mirrorUpsert,
  paymentPayload,
  productPayload,
  sequencePayload,
  setMirrorErrorHandler,
  settingsPairs,
  taxHistoryPayload,
  taxRatePayload,
  userPayload,
  mirrorUpsertAsync,
} from "./desktopSync";
import { fromNumber, type Cents } from "../core/money";
import {
  assertNumberAvailable,
  DEFAULT_SEQUENCE_CONFIGS,
  renderNumber,
  counterFromNumber,
  validateTemplate,
} from "../core/numbering";
import { presetTaxRates } from "../core/taxEngine";
import {
  canCancelPurchaseOrder,
  canDeletePurchaseOrder,
  canEditPurchaseOrder,
  computePurchaseTotals,
  renderPoNumber,
  statusAfterReception,
  validatePurchaseOrderBeforeSend,
  validateReception,
} from "../core/purchaseOrders";
import { historicalToDoc, type HistoricalInvoice } from "../core/historicalImport";
import { currencySymbol } from "../core/currency";
import {
  DEFAULT_VALIDATION_RULES,
  validateInvoiceBeforeValidation,
} from "../core/validation";
import type {
  AuditEntry,
  BackupRecord,
  Company,
  PartySnapshot,
  Customer,
  DocAttachment,
  DocType,
  InvoiceDoc,
  Payment,
  Product,
  PurchaseOrder,
  SequenceConfig,
  Supplier,
  TaxRate,
  TaxChangeRecord,
  UserAccount,
  ValidationRulesConfig,
} from "../core/types";

export const SCHEMA_VERSION = 1;
export const APP_VERSION = "1.0.0";
export const STORAGE_KEY = "facturationdz.data.v1";
export const SECURITY_BACKUP_KEY = "facturationdz.security-backup";

/* ------------------------------------------------------------------ */
/* Persistance injectable : navigateur (localStorage) ou mémoire (tests) */
/* ------------------------------------------------------------------ */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function browserStorage(): StorageLike {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* environnement sans DOM */
  }
  return createMemoryStorage();
}

/* ------------------------------------------------------------------ */
/* Shape des données                                                   */
/* ------------------------------------------------------------------ */

export interface Settings {
  autoBackupFrequency: "OFF" | "DAILY" | "WEEKLY" | "ON_CLOSE";
  autoBackupRetention: number;
  lockTimeoutMinutes: number; // §37
  validation: ValidationRulesConfig; // §8
}

export interface TechLog {
  ts: string;
  level: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  message: string;
}

export interface AppData {
  schemaVersion: number;
  appVersion: string;
  initialized: boolean;
  demoSeeded: boolean;
  currentUser: string;
  /** Langue de l'interface (§43) : français par défaut. */
  language: "fr" | "en" | "ar";
  company: Company;
  customers: Customer[];
  /** Fournisseurs (achats). */
  suppliers: Supplier[];
  /** Bons de commande fournisseurs (achats). */
  purchaseOrders: PurchaseOrder[];
  products: Product[];
  taxRates: TaxRate[];
  taxHistory: TaxChangeRecord[];
  docs: InvoiceDoc[];
  payments: Payment[];
  /** Compteur par série et par année — jamais décrémenté (§21). */
  sequences: Record<string, number>;
  sequenceConfigs: SequenceConfig[];
  audit: AuditEntry[];
  backupHistory: BackupRecord[];
  settings: Settings;
  techLogs: TechLog[];
  users: UserAccount[];
}

function defaultCompany(): Company {
  return {
    raisonSociale: "",
    afficherCachet: true,
    afficherSignature: true,
    afficherCoordonneesBancaires: true,
    devise: "DZD",
    taxCodeDefaut: "TVA19",
    conditionsPaiementDefautJours: 30,
    modePaiementDefaut: "Virement bancaire",
  };
}

function defaultData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    initialized: false,
    demoSeeded: false,
    currentUser: "Administrateur",
    language: "fr",
    company: defaultCompany(),
    customers: [],
    suppliers: [],
    purchaseOrders: [],
    products: [],
    taxRates: presetTaxRates(),
    taxHistory: [],
    docs: [],
    payments: [],
    sequences: {},
    sequenceConfigs: DEFAULT_SEQUENCE_CONFIGS.map((c) => ({ ...c })),
    audit: [],
    backupHistory: [],
    settings: {
      autoBackupFrequency: "DAILY",
      autoBackupRetention: 10,
      lockTimeoutMinutes: 15,
      validation: { ...DEFAULT_VALIDATION_RULES },
    },
    techLogs: [],
    users: [],
  };
}

/** Hash SHA-256 (démo navigateur). Le backend desktop utilise Argon2 (§36). */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`facturationdz::${salt}::${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Migrations locales versionnées (§51).
 * Chaque fonction fait passer un payload d'une version N à N+1, sans jamais
 * détruire de données. Toute sauvegarde ou état antérieur restauré passe ici.
 */
export function applyLocalMigrations(raw: unknown): AppData {
  const base = defaultData();
  if (!raw || typeof raw !== "object") return base;
  const parsed = raw as Partial<AppData>;

  let data: AppData = {
    ...base,
    ...parsed,
    settings: { ...base.settings, ...(parsed.settings ?? {}) },
    company: { ...base.company, ...(parsed.company ?? {}) },
    sequences: parsed.sequences ?? {},
    sequenceConfigs: parsed.sequenceConfigs?.length
      ? parsed.sequenceConfigs
      : base.sequenceConfigs,
    taxRates: parsed.taxRates?.length ? parsed.taxRates : base.taxRates,
    users: parsed.users ?? [],
    docs: parsed.docs ?? [],
    payments: parsed.payments ?? [],
    customers: parsed.customers ?? [],
    products: parsed.products ?? [],
    audit: parsed.audit ?? [],
    backupHistory: parsed.backupHistory ?? [],
    techLogs: parsed.techLogs ?? [],
    taxHistory: parsed.taxHistory ?? [],
  };

  // --- Migration v0 → v1 : exemple de point d'extension (§51, docs/MIGRATIONS.md).
  // Les payloads antérieurs à la v1 n'avaient pas `users` ni `taxHistory`.
  if ((parsed.schemaVersion ?? 0) < 1) {
    data.schemaVersion = 1;
  }

  return data;
}

/* ------------------------------------------------------------------ */
/* Store réactif                                                       */
/* ------------------------------------------------------------------ */

type Listener = () => void;

class Store {
  data: AppData;
  private listeners = new Set<Listener>();
  version = 0;
  readonly storage: StorageLike;

  constructor(storage: StorageLike = browserStorage()) {
    this.storage = storage;
    // `data` doit exister AVANT load() : le chemin « stockage corrompu »
    // journalise techniquement pendant le chargement (§67).
    this.data = defaultData();
    this.data = this.load();
    // Les échecs de miroir desktop sont journalisés, jamais bloquants (§67).
    setMirrorErrorHandler((m) => this.techLog("ERROR", m));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getVersion = (): number => this.version;

  private notify(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  private load(): AppData {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      return applyLocalMigrations(JSON.parse(raw));
    } catch {
      this.techLog("ERROR", "Données locales illisibles — initialisation d'une base neuve.");
      return defaultData();
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      this.techLog("CRITICAL", "Échec de la persistance locale (quota dépassé ?).");
    }
    this.notify();
  }

  /** Passerelle IPC (§70) : notifie le backend desktop quand Tauri est présent. */
  private desktopNotify(command: string, args: Record<string, unknown>): void {
    void invokeDesktop(command, args).catch((e: unknown) => {
      this.techLog("ERROR", `Commande desktop « ${command} » en échec : ${(e as Error)?.message ?? e}`);
    });
  }

  /* ---------------- Miroir desktop write-through (§70) ---------------- */

  private mirrorDoc(d: InvoiceDoc): void {
    if (!isTauri()) return;
    mirrorUpsert("document", d.id, docPayload(d, this.data.currentUser));
  }

  private mirrorSequence(docType: DocType): void {
    if (!isTauri()) return;
    const cfg = this.getSequenceConfig(docType);
    const prefix = `${docType}-`;
    Object.keys(this.data.sequences)
      .filter((k) => k.startsWith(prefix))
      .forEach((k) => {
        const year = Number(k.slice(prefix.length));
        mirrorUpsert("sequence", k, sequencePayload(docType, year, this.data.sequences[k], cfg));
      });
  }

  /* ---------------- Journal technique (§67) ---------------- */

  techLog(level: TechLog["level"], message: string): void {
    const logs = [...(this.data.techLogs ?? []), { ts: nowISO(), level, message }];
    // F-15 : nouvelles références (jamais de mutation sur place) — les
    // composants React comparent les identités (useMemo/useSyncExternalStore).
    this.data.techLogs = logs.length > 500 ? logs.slice(logs.length - 500) : logs;
  }

  /* ---------------- Journal d'audit (§34) ---------------- */

  audit(
    action: string,
    objectType: string,
    objectId?: string,
    details?: string,
    oldValue?: string,
    newValue?: string
  ): void {
    const entry: AuditEntry = {
      id: uid("aud"),
      ts: nowISO(),
      utilisateur: this.data.currentUser,
      action,
      objectType,
      objectId,
      details,
      oldValue,
      newValue,
    };
    this.data.audit = [entry, ...this.data.audit].slice(0, 5000);
    // Miroir du journal d'audit vers SQLite (§34, desktop).
    if (isTauri()) mirrorUpsert("audit", entry.id, auditPayload(entry));
  }

  /* ---------------- Initialisation / assistant (§54) ---------------- */

  completeFirstRun(company: Company, seedDemo: boolean, adminName: string): void {
    this.data.company = company;
    this.data.currentUser = adminName || "Administrateur";
    this.data.initialized = true;
    this.audit("CONFIGURATION_INITIALE", "settings", undefined, "Assistant de premier démarrage terminé.");
    if (seedDemo && !this.data.demoSeeded) {
      seedDemoData(this.data);
      this.data.demoSeeded = true;
      this.audit("DONNEES_DEMO_GENEREES", "demo", undefined, "Jeu de données de démonstration créé.");
    }
    if (isTauri()) {
      mirrorUpsert("company", "company", companyPayload(this.data.company));
      mirrorUpsert("settings", "settings", {
        pairs: settingsPairs(this.data.settings, this.data.language),
      });
    }
    this.persist();
  }

  updateCompany(patch: Partial<Company>): void {
    const old = JSON.stringify({
      raisonSociale: this.data.company.raisonSociale,
      nif: this.data.company.nif,
      rc: this.data.company.rc,
    });
    this.data.company = { ...this.data.company, ...patch };
    this.audit("MODIFICATION_ENTREPRISE", "company", undefined, "Paramètres entreprise mis à jour.", old,
      JSON.stringify({ raisonSociale: this.data.company.raisonSociale, nif: this.data.company.nif, rc: this.data.company.rc }));
    if (isTauri()) mirrorUpsert("company", "company", companyPayload(this.data.company));
    this.persist();
  }

  updateSettings(patch: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...patch };
    this.audit("MODIFICATION_PARAMETRES", "settings", undefined, Object.keys(patch).join(", "));
    if (isTauri()) {
      mirrorUpsert("settings", "settings", {
        pairs: settingsPairs(this.data.settings, this.data.language),
      });
    }
    this.persist();
  }

  /** Change la langue de l'interface (§43). */
  setLanguage(lang: AppData["language"]): void {
    this.data.language = lang;
    if (isTauri()) {
      mirrorUpsert("settings", "settings", {
        pairs: settingsPairs(this.data.settings, lang),
      });
    }
    this.persist();
  }

  /* ---------------- Utilisateurs (§35, §36) ---------------- */

  async addUser(username: string, role: UserAccount["role"], password: string): Promise<void> {
    if (!username.trim()) throw new Error("Le nom d'utilisateur est obligatoire.");
    if (this.data.users.some((u) => u.username.toLowerCase() === username.trim().toLowerCase())) {
      throw new Error("Ce nom d'utilisateur existe déjà.");
    }
    if (password.length < 6) throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
    const user: UserAccount = {
      id: uid("usr"),
      username: username.trim(),
      role,
      passwordHash: await hashPassword(password, username.trim().toLowerCase()),
      createdAt: nowISO(),
    };
    // Desktop : le compte doit exister en base AVANT toute connexion (§36).
    if (isTauri()) await mirrorUpsertAsync("user", user.id, userPayload(user));
    this.data.users = [...this.data.users, user];
    this.audit("CREATION_UTILISATEUR", "user", user.id, `${username} (${role})`);
    this.persist();
  }

  /** Rôle de l'utilisateur courant (§35) ; undefined si inconnu. */
  currentRole(): Role | undefined {
    const name = this.data.currentUser.toLowerCase();
    return this.data.users.find((u) => u.username.toLowerCase() === name)?.role;
  }

  /**
   * Droit d'agir (§35). Sans aucun compte configuré (premier lancement) :
   * autorisé, pour que l'assistant puisse s'exécuter.
   */
  can(action: Action): boolean {
    if (this.data.users.length === 0) return true;
    return roleAllows(this.currentRole(), action);
  }

  setCurrentUser(username: string): void {
    this.data.currentUser = username;
    this.audit("CONNEXION", "user", undefined, `Session ouverte : ${username}`);
    this.persist();
  }

  /** Garde-fou (O-16) : base restaurée sans aucun compte → relancer
   *  l'assistant de premier démarrage pour recréer un administrateur.
   *  Les données métier sont conservées. */
  resetToFirstRun(): void {
    this.data.initialized = false;
    this.techLog("WARNING", "Assistant relancé : aucun compte utilisateur présent.");
    this.persist();
  }

  /** Réinitialisation complète — RÉSERVÉ AUX TESTS AUTOMATISÉS (§66). */
  resetForTests(): void {
    this.data = defaultData();
    this.persist();
  }

  async verifyPassword(username: string, password: string): Promise<boolean> {
    // Desktop (§36) : le backend Rust est la SEULE source de vérité.
    // Argon2id ; un hash hérité (démo SHA-256) est migré au premier login réussi.
    // AUCUN repli sur la copie locale : elle contournerait un compte désactivé
    // ou un changement de mot de passe côté base. Erreur (ex. compte désactivé)
    // remontée telle quelle à l'écran.
    if (isTauri()) {
      const res = await invokeDesktop<{ username: string; role: string } | null>(
        "auth_login",
        { username, password }
      );
      return res !== null;
    }
    const user = this.data.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );
    if (!user) return false;
    const hash = await hashPassword(password, user.username.toLowerCase());
    return hash === user.passwordHash;
  }

  /* ---------------- Clients (§7) ---------------- */

  saveCustomer(c: Customer, isNew: boolean): Customer {
    c.updatedAt = nowISO();
    if (isNew) {
      c.createdAt = c.createdAt || nowISO();
      this.data.customers = [c, ...this.data.customers];
      this.audit("CREATION_CLIENT", "customer", c.id, customerName(c));
    } else {
      const idx = this.data.customers.findIndex((x) => x.id === c.id);
      const old = idx >= 0 ? JSON.stringify(this.data.customers[idx]) : undefined;
      this.data.customers =
        idx >= 0
          ? this.data.customers.map((x) => (x.id === c.id ? c : x))
          : [c, ...this.data.customers];
      this.audit("MODIFICATION_CLIENT", "customer", c.id, customerName(c), old, JSON.stringify(c));
    }
    if (isTauri()) mirrorUpsert("customer", c.id, customerPayload(c));
    this.persist();
    return c;
  }

  deleteCustomer(id: string): void {
    const used = this.data.docs.some((d) => d.customerId === id);
    if (used) {
      throw new Error("Impossible de supprimer ce client : des documents lui sont rattachés.");
    }
    const c = this.data.customers.find((x) => x.id === id);
    this.data.customers = this.data.customers.filter((x) => x.id !== id);
    this.audit("SUPPRESSION_CLIENT", "customer", id, c ? customerName(c) : id);
    if (isTauri()) mirrorDelete("customer", id);
    this.persist();
  }


  /* ---------------- Achats : fournisseurs ---------------- */

  saveSupplier(f: Supplier, isNew: boolean): Supplier {
    f.updatedAt = nowISO();
    if (isNew) {
      f.createdAt = f.createdAt || nowISO();
      this.data.suppliers = [f, ...this.data.suppliers];
      this.audit("CREATION_FOURNISSEUR", "supplier", f.id, f.denomination);
    } else {
      const old = this.data.suppliers.find((x) => x.id === f.id);
      this.data.suppliers = this.data.suppliers.map((x) => (x.id === f.id ? f : x));
      this.audit("MODIFICATION_FOURNISSEUR", "supplier", f.id, f.denomination,
        old ? JSON.stringify(old) : undefined, JSON.stringify(f));
    }
    if (isTauri()) mirrorUpsert("supplier", f.id, supplierPayload(f));
    this.persist();
    return f;
  }

  deleteSupplier(id: string): void {
    if (this.data.purchaseOrders.some((po) => po.supplierId === id)) {
      throw new Error("Impossible de supprimer ce fournisseur : des bons de commande lui sont rattachés.");
    }
    const f = this.data.suppliers.find((x) => x.id === id);
    this.data.suppliers = this.data.suppliers.filter((x) => x.id !== id);
    this.audit("SUPPRESSION_FOURNISSEUR", "supplier", id, f?.denomination ?? id);
    if (isTauri()) mirrorDelete("supplier", id);
    this.persist();
  }

  /* ---------------- Achats : bons de commande ---------------- */

  /** Numéro attribué à l'envoi (BC-AAAA-000001), compteur monotone comme les factures (§21). */
  allocatePoNumber(year: number): string {
    const key = `BC-${year}`;
    const next = (this.data.sequences[key] ?? 0) + 1;
    const number = renderPoNumber(year, next);
    this.data.sequences[key] = next;
    if (isTauri()) {
      mirrorUpsert("sequence", key, { doc_type: "BC", year, counter: next, template: "BC-{YEAR}-{COUNTER}", padding: 6 });
    }
    return number;
  }

  private supplierSnapshotOf(f: Supplier): PartySnapshot {
    return {
      displayName: f.denomination,
      type: "ENTREPRISE",
      adresse: f.adresse,
      wilaya: f.wilaya,
      commune: f.commune,
      telephone: f.telephone,
      email: f.email,
      rc: f.rc,
      nif: f.nif,
      nis: f.nis,
      articleImposition: f.articleImposition,
    };
  }

  /** Enregistre un brouillon de BC. Totaux recalculés ; contenu figé après envoi. */
  savePurchaseOrder(po: PurchaseOrder, isNew: boolean): PurchaseOrder {
    const current = this.data.purchaseOrders.find((x) => x.id === po.id);
    if (!isNew && current && !canEditPurchaseOrder(current)) {
      throw new Error("Ce bon de commande n'est plus modifiable (il a été émis).");
    }
    const supplier = this.data.suppliers.find((f) => f.id === po.supplierId);
    const t = computePurchaseTotals(po.lines, po.devise);
    po.totalHtCents = t.totalHtCents;
    po.totalTvaCents = t.totalTvaCents;
    po.totalTtcCents = t.totalTtcCents;
    po.vatDetail = t.vatDetail;
    po.amountInWords = t.amountInWords;
    po.supplierSnapshot = supplier ? this.supplierSnapshotOf(supplier) : po.supplierSnapshot;
    po.createdByUsername = po.createdByUsername || this.data.currentUser;
    po.updatedAt = nowISO();
    if (isNew) {
      po.createdAt = po.createdAt || nowISO();
      this.data.purchaseOrders = [po, ...this.data.purchaseOrders];
      this.audit("CREATION_BON_COMMANDE", "purchase_order", po.id, "Brouillon BC");
    } else {
      this.data.purchaseOrders = this.data.purchaseOrders.map((x) => (x.id === po.id ? po : x));
      this.audit("MODIFICATION_BON_COMMANDE", "purchase_order", po.id, po.number ?? "Brouillon BC");
    }
    if (isTauri()) mirrorUpsert("purchase_order", po.id, purchaseOrderPayload(po, this.data.currentUser));
    this.persist();
    return po;
  }

  /** Envoi : contrôle, numérotation, figement. Retourne les erreurs (vide si OK). */
  sendPurchaseOrder(id: string, date = todayISO()): string[] {
    const po = this.data.purchaseOrders.find((x) => x.id === id);
    if (!po) return ["Bon de commande introuvable."];
    if (po.status !== "BROUILLON") return ["Ce bon de commande a déjà été émis."];
    const supplier = this.data.suppliers.find((f) => f.id === po.supplierId);
    const errors = validatePurchaseOrderBeforeSend(po, supplier);
    if (errors.length) return errors;
    po.number = this.allocatePoNumber(Number(date.slice(0, 4)));
    po.status = "ENVOYE";
    po.sentAt = nowISO();
    po.supplierSnapshot = this.supplierSnapshotOf(supplier!);
    po.updatedAt = nowISO();
    this.audit("ENVOI_BON_COMMANDE", "purchase_order", po.id, po.number);
    if (isTauri()) mirrorUpsert("purchase_order", po.id, purchaseOrderPayload(po, this.data.currentUser));
    this.persist();
    return [];
  }

  /** Réception : quantité totale reçue à ce jour par ligne (lineId → quantité). */
  receivePurchaseOrder(id: string, recues: Record<string, number>): string[] {
    const po = this.data.purchaseOrders.find((x) => x.id === id);
    if (!po) return ["Bon de commande introuvable."];
    const errors = validateReception(po.lines, recues);
    if (errors.length) return errors;
    po.lines = po.lines.map((l) => (recues[l.id] === undefined ? l : { ...l, qtyRecue: recues[l.id] }));
    po.status = statusAfterReception(po.lines, po.status);
    po.updatedAt = nowISO();
    this.audit("RECEPTION_BON_COMMANDE", "purchase_order", po.id, po.number ?? "BC", undefined, po.status);
    if (isTauri()) mirrorUpsert("purchase_order", po.id, purchaseOrderPayload(po, this.data.currentUser));
    this.persist();
    return [];
  }

  /** Annulation : uniquement avant toute réception. */
  cancelPurchaseOrder(id: string, motif: string): string[] {
    const po = this.data.purchaseOrders.find((x) => x.id === id);
    if (!po) return ["Bon de commande introuvable."];
    if (!canCancelPurchaseOrder(po)) {
      return ["Annulation impossible : le bon doit être envoyé et ne rien avoir reçu."];
    }
    if (!motif.trim()) return ["Indiquez le motif d'annulation."];
    po.status = "ANNULE";
    po.cancelledAt = nowISO();
    po.cancelMotif = motif.trim();
    po.updatedAt = nowISO();
    this.audit("ANNULATION_BON_COMMANDE", "purchase_order", po.id, po.number ?? "BC", undefined, motif);
    if (isTauri()) mirrorUpsert("purchase_order", po.id, purchaseOrderPayload(po, this.data.currentUser));
    this.persist();
    return [];
  }

  deletePurchaseOrder(id: string): void {
    const po = this.data.purchaseOrders.find((x) => x.id === id);
    if (po && !canDeletePurchaseOrder(po)) {
      throw new Error("Un bon de commande émis ne peut pas être supprimé : annulez-le.");
    }
    this.data.purchaseOrders = this.data.purchaseOrders.filter((x) => x.id !== id);
    this.audit("SUPPRESSION_BON_COMMANDE", "purchase_order", id, po?.number ?? "Brouillon BC");
    if (isTauri()) mirrorDelete("purchase_order", id);
    this.persist();
  }

  /* ---------------- Produits (§9) ---------------- */

  saveProduct(p: Product, isNew: boolean): void {
    p.updatedAt = nowISO();
    if (isNew) {
      p.createdAt = p.createdAt || nowISO();
      this.data.products = [p, ...this.data.products];
      this.audit("CREATION_PRODUIT", "product", p.id, `${p.reference} — ${p.designation}`);
    } else {
      const idx = this.data.products.findIndex((x) => x.id === p.id);
      if (idx >= 0) this.data.products = this.data.products.map((x) => (x.id === p.id ? p : x));
      this.audit("MODIFICATION_PRODUIT", "product", p.id, `${p.reference} — ${p.designation}`);
    }
    if (isTauri()) mirrorUpsert("product", p.id, productPayload(p));
    this.persist();
  }

  deleteProduct(id: string): void {
    const used = this.data.docs.some((d) => d.lines.some((l) => l.productRef && this.data.products.find((p) => p.id === id && p.reference === l.productRef)));
    if (used) {
      throw new Error("Impossible de supprimer ce produit : il est utilisé dans des documents.");
    }
    this.data.products = this.data.products.filter((x) => x.id !== id);
    this.audit("SUPPRESSION_PRODUIT", "product", id);
    if (isTauri()) mirrorDelete("product", id);
    this.persist();
  }

  /* ---------------- Taxes (§10, §74) ---------------- */

  addTaxRate(t: TaxRate): void {
    if (this.data.taxRates.some((x) => x.code === t.code)) {
      throw new Error(`Le code « ${t.code} » existe déjà dans le référentiel des taxes.`);
    }
    this.data.taxRates = [...this.data.taxRates, t];
    this.audit("CREATION_TAXE", "tax_rate", t.id, `${t.libelle} (${t.ratePct} %)`);
    if (isTauri()) mirrorUpsert("tax_rate", t.code, taxRatePayload(t));
    this.persist();
  }

  updateTaxRate(id: string, patch: Partial<TaxRate>, motif: string, dateEffet: string): void {
    const idx = this.data.taxRates.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error("Taxe introuvable.");
    const old = this.data.taxRates[idx];
    const updated = { ...old, ...patch };
    this.data.taxRates = this.data.taxRates.map((x) => (x.id === id ? updated : x));
    const record: TaxChangeRecord = {
      id: uid("taxchg"),
      taxCode: updated.code,
      oldValue: old,
      newValue: updated,
      dateEffet,
      motif,
      utilisateur: this.data.currentUser,
      ts: nowISO(),
    };
    this.data.taxHistory = [record, ...this.data.taxHistory];
    // §74 : ancienne valeur / nouvelle valeur / date d'effet / motif / utilisateur.
    this.audit("MODIFICATION_REGLEMENTAIRE", "tax_rate", id,
      `${old.libelle} → ${updated.libelle} (effet ${dateEffet}) : ${motif}`,
      JSON.stringify(old), JSON.stringify(updated));
    if (isTauri()) {
      mirrorUpsert("tax_rate", updated.code, taxRatePayload(updated));
      mirrorUpsert("tax_history", record.id, taxHistoryPayload(record));
    }
    this.persist();
  }

  /* ---------------- Numérotation (§12, §55, §56) ---------------- */

  private seqKey(docType: DocType, year: number): string {
    return `${docType}-${year}`;
  }

  getSequenceConfig(docType: DocType): SequenceConfig {
    return (
      this.data.sequenceConfigs.find((c) => c.docType === docType) ??
      DEFAULT_SEQUENCE_CONFIGS.find((c) => c.docType === docType)!
    );
  }

  updateSequenceConfig(docType: DocType, template: string, padding: number): void {
    const errors = validateTemplate(template);
    if (errors.length) throw new Error(errors.join(" "));
    const idx = this.data.sequenceConfigs.findIndex((c) => c.docType === docType);
    const old = idx >= 0 ? this.data.sequenceConfigs[idx] : null;
    const cfg: SequenceConfig = { docType, template, padding };
    this.data.sequenceConfigs =
      idx >= 0
        ? this.data.sequenceConfigs.map((x) => (x.docType === docType ? cfg : x))
        : [...this.data.sequenceConfigs, cfg];
    this.audit("MODIFICATION_NUMEROTATION", "sequence", docType,
      `Les numéros déjà attribués ne sont pas modifiés (§55).`,
      old ? JSON.stringify(old) : undefined, JSON.stringify(cfg));
    this.mirrorSequence(docType);
    this.persist();
  }

  /** Attribue le prochain numéro — compteur monotonique, jamais réutilisé (§21). */
  allocateNumber(docType: DocType, year: number): string {
    const cfg = this.getSequenceConfig(docType);
    const key = this.seqKey(docType, year);
    const next = (this.data.sequences[key] ?? 0) + 1;
    const number = renderNumber(cfg, year, next);
    assertNumberAvailable(number, this.data.docs.map((d) => d.number));
    this.data.sequences[key] = next;
    if (isTauri()) {
      mirrorUpsert("sequence", key, sequencePayload(docType, year, next, cfg));
    }
    return number;
  }

  /* ---------------- Snapshots (§38) ---------------- */

  sellerSnapshot() {
    const c = this.data.company;
    return {
      displayName: c.raisonSociale,
      type: "ENTREPRISE_VENDEUR" as const,
      formeJuridique: c.formeJuridique,
      activite: c.activite,
      adresse: c.adresse,
      wilaya: c.wilaya,
      commune: c.commune,
      telephone: c.telephone,
      fax: c.fax,
      email: c.email,
      rc: c.rc,
      nif: c.nif,
      nis: c.nis,
      articleImposition: c.articleImposition,
      capitalSocial: c.capitalSocial,
    };
  }

  buyerSnapshot(c: Customer) {
    return {
      displayName: customerName(c),
      type: c.type,
      formeJuridique: c.formeJuridique,
      activite: c.activite,
      adresse: c.adresse,
      wilaya: c.wilaya,
      commune: c.commune,
      telephone: c.telephone,
      fax: c.fax,
      email: c.email,
      rc: c.rc,
      nif: c.nif,
      nis: c.nis,
      articleImposition: c.articleImposition,
    };
  }

  /* ---------------- Documents (§11 → §22, §57 → §59) ---------------- */

  createDraft(partial: Partial<InvoiceDoc> & { docType: DocType; customerId: string }): InvoiceDoc {
    const customer = this.data.customers.find((c) => c.id === partial.customerId);
    if (!customer) throw new Error("Client introuvable.");
    const { docType, customerId, ...rest } = partial;
    const doc: InvoiceDoc = {
      id: uid("doc"),
      docType,
      number: null,
      status: "BROUILLON",
      date: todayISO(),
      customerId,
      sellerSnapshot: this.sellerSnapshot(),
      buyerSnapshot: this.buyerSnapshot(customer),
      lines: [],
      totalHtCents: 0,
      totalTvaCents: 0,
      totalTtcCents: 0,
      vatDetail: [],
      amountInWords: "",
      modePaiement: this.data.company.modePaiementDefaut,
      conditionsPaiement: `${customer.conditionsPaiementJours ?? this.data.company.conditionsPaiementDefautJours} jours`,
      devise: this.data.company.devise,
      archived: false,
      demo: customer.demo,
      createdBy: this.data.currentUser,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      ...rest,
    };
    this.data.docs = [doc, ...this.data.docs];
    this.audit("CREATION_BROUILLON", "document", doc.id, `${doc.docType} pour ${customerName(customer)}`);
    this.mirrorDoc(doc);
    this.persist();
    return doc;
  }

  /**
   * Import historique (phase 1) : le numéro du fichier est conservé TEL QUEL.
   * Le compteur de séquence avance seulement si le numéro suit le modèle de numérotation,
   * pour que les nouvelles factures ne reprennent pas un numéro existant.
   */
  importHistoricalInvoice(inv: HistoricalInvoice): InvoiceDoc {
    const customer = this.data.customers.find((c) => c.id === inv.customerId);
    if (!customer) throw new Error("Client introuvable.");
    if (this.data.docs.some((d) => d.number === inv.number)) {
      throw new Error(`Le numéro ${inv.number} existe déjà.`);
    }
    const doc = historicalToDoc(inv, {
      sellerSnapshot: this.sellerSnapshot(),
      buyerSnapshot: this.buyerSnapshot(customer),
      devise: this.data.company.devise,
      modePaiement: this.data.company.modePaiementDefaut,
      createdBy: this.data.currentUser,
    });
    this.advanceCounterFromNumber("FAC", Number(doc.date.slice(0, 4)), inv.number);
    this.data.docs = [doc, ...this.data.docs];
    this.audit("IMPORT_FACTURE_HISTORIQUE", "document", doc.id, `${inv.number} (${doc.date}) — ${customerName(customer)}`);
    this.mirrorDoc(doc);
    this.persist();
    return doc;
  }

  /** Avance le compteur jusqu'au plus grand nombre du numéro importé qui suit le modèle. */
  private advanceCounterFromNumber(docType: DocType, year: number, number: string): void {
    const cfg = this.getSequenceConfig(docType);
    const key = this.seqKey(docType, year);
    const n = counterFromNumber(cfg, year, number);
    const best = Math.max(this.data.sequences[key] ?? 0, n ?? 0);
    if (best !== (this.data.sequences[key] ?? 0)) {
      this.data.sequences[key] = best;
      this.mirrorSequence(docType);
    }
  }

  updateDraft(doc: InvoiceDoc): void {
    // §20 : TOUT document non-brouillon est figé — factures, avoirs, mais aussi
    // devis/proforma/BL dès qu'ils ont quitté le statut BROUILLON.
    if (doc.status !== "BROUILLON") {
      throw new Error("Ce document est figé : seul un brouillon peut être modifié (§20).");
    }
    // Refresh du snapshot acheteur tant que non validé.
    const customer = this.data.customers.find((c) => c.id === doc.customerId);
    if (customer) doc.buyerSnapshot = this.buyerSnapshot(customer);
    doc.sellerSnapshot = this.sellerSnapshot();
    doc.updatedAt = nowISO();
    const idx = this.data.docs.findIndex((d) => d.id === doc.id);
    this.data.docs =
      idx >= 0 ? this.data.docs.map((x) => (x.id === doc.id ? doc : x)) : [doc, ...this.data.docs];
    this.mirrorDoc(doc);
    this.persist();
  }

  /** Validation : transaction atomique (§69) — tout réussit ou rien. */
  validateDocument(id: string): InvoiceDoc {
    const doc = this.data.docs.find((d) => d.id === id);
    if (!doc) throw new Error("Document introuvable.");
    if (doc.status !== "BROUILLON") {
      throw new Error("Seul un document au statut BROUILLON peut être validé.");
    }
    const customer = this.data.customers.find((c) => c.id === doc.customerId);
    const result = validateInvoiceBeforeValidation(doc, {
      company: this.data.company,
      customer,
      taxRates: this.data.taxRates,
      rules: this.data.settings.validation,
      existingNumbers: this.data.docs.filter((d) => d.id !== doc.id).map((d) => d.number),
    });
    if (!result.ok) {
      throw new Error(result.errors.map((e) => "• " + e.message).join("\n"));
    }
    // Transaction (§69) : totaux recalculés côté store + numéro + statut +
    // snapshots + montant en lettres + audit, ENSEMBLE.
    const comp = computeDocument(doc.lines, doc.globalDiscount, doc.devise);
    doc.totalHtCents = comp.totalHtCents;
    doc.totalTvaCents = comp.totalTvaCents;
    doc.totalOtherTaxesCents = comp.totalOtherTaxesCents;
    doc.totalTtcCents = comp.totalTtcCents;
    doc.vatDetail = comp.vatDetail;
    doc.otherTaxDetail = comp.otherTaxDetail;
    doc.amountInWords = comp.amountInWords; // §16 : jamais saisi manuellement
    const year = Number(doc.date.slice(0, 4));
    const number = this.allocateNumber(doc.docType, year);
    doc.number = number;
    doc.status = doc.docType === "FAC" || doc.docType === "AVOIR" ? "VALIDEE" : "ENVOYE";
    doc.sellerSnapshot = this.sellerSnapshot();
    doc.buyerSnapshot = customer ? this.buyerSnapshot(customer) : doc.buyerSnapshot;
    doc.updatedAt = nowISO();
    this.data.docs = this.data.docs.map((x) => (x.id === doc.id ? { ...doc } : x)); // référence neuve (F-15)
    this.audit("VALIDATION_DOCUMENT", "document", doc.id, `${number} (${doc.docType})`, undefined, number);
    this.techLog("INFO", `Document validé ${number}`);
    // Le miroir transporte numéro + statut + totaux : SQLite applique ses
    // propres garde-fous (UNIQUE number, triggers §20) côté backend.
    this.mirrorDoc(doc);
    this.persist();
    return doc;
  }

  /** Annulation (§21) : jamais de suppression physique, numéro conservé. */
  cancelDocument(id: string, motif: string): void {
    const doc = this.data.docs.find((d) => d.id === id);
    if (!doc) throw new Error("Document introuvable.");
    if (doc.status === "ANNULEE") throw new Error("Ce document est déjà annulé.");
    if (doc.status === "BROUILLON") {
      throw new Error("Un brouillon ne s'annule pas : supprimez-le.");
    }
    if (!motif.trim()) throw new Error("Le motif d'annulation est obligatoire (§21).");
    doc.status = "ANNULEE";
    doc.cancellation = { at: nowISO(), by: this.data.currentUser, motif: motif.trim() };
    doc.updatedAt = nowISO();
    this.data.docs = this.data.docs.map((x) => (x.id === doc.id ? { ...doc } : x)); // référence neuve (F-15)
    this.audit("ANNULATION_DOCUMENT", "document", doc.id, `${doc.number} — motif : ${motif.trim()}`);
    this.mirrorDoc(doc);
    this.persist();
  }

  /** Suppression : BROUILLONS uniquement (§47), journalisée (§34). */
  deleteDraft(id: string): void {
    const doc = this.data.docs.find((d) => d.id === id);
    if (!doc) return;
    if (doc.status !== "BROUILLON") {
      throw new Error("La suppression d'un document validé est interdite (§47). Utilisez l'annulation ou un avoir.");
    }
    this.data.docs = this.data.docs.filter((d) => d.id !== id);
    this.audit("SUPPRESSION_BROUILLON", "document", id, `${doc.docType} brouillon supprimé`);
    if (isTauri()) mirrorDelete("document", id);
    this.persist();
  }

  /** Duplication (§46) : nouveau brouillon, jamais le même numéro. */
  duplicateDocument(id: string): InvoiceDoc {
    const src = this.data.docs.find((d) => d.id === id);
    if (!src) throw new Error("Document introuvable.");
    const copy: InvoiceDoc = {
      ...JSON.parse(JSON.stringify(src)),
      id: uid("doc"),
      number: null, // §46 : jamais le numéro original
      status: "BROUILLON",
      date: todayISO(),
      cancellation: undefined,
      originDocNumber: undefined, // la traçabilité passe par le journal d'audit
      originDocId: undefined,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      createdBy: this.data.currentUser,
    };
    this.data.docs = [copy, ...this.data.docs];
    this.audit("DUPLICATION_DOCUMENT", "document", copy.id, `Copie de ${src.number ?? "brouillon"} en nouveau brouillon`);
    this.mirrorDoc(copy);
    this.persist();
    return copy;
  }

  /**
   * Révision d'un devis validé (envoyé, accepté, refusé ou expiré).
   * Le devis d'origine n'est JAMAIS modifié (§20) : on crée un brouillon lié,
   * qui recevra son propre numéro à la validation (§12 : pas de réutilisation).
   */
  reviseDocument(id: string): InvoiceDoc {
    const src = this.data.docs.find((d) => d.id === id);
    if (!src) throw new Error("Document introuvable.");
    if (src.docType !== "DEV") throw new Error("Seul un devis peut être révisé.");
    if (!src.number || src.status === "BROUILLON") {
      throw new Error("Ce devis n'est pas encore validé : modifiez le brouillon directement.");
    }
    if (src.status === "ANNULEE") throw new Error("Un devis annulé ne peut pas être révisé.");
    const open = this.findOpenRevision(src.number);
    if (open) {
      throw new Error("Une révision de ce devis est déjà en brouillon : modifiez-la ou supprimez-la avant d'en créer une autre.");
    }
    const rev: InvoiceDoc = {
      ...JSON.parse(JSON.stringify(src)),
      id: uid("doc"),
      number: null, // nouveau numéro uniquement à la validation
      status: "BROUILLON",
      date: todayISO(),
      originDocNumber: src.number, // lien vers le devis d'origine (persisté en base)
      originDocId: src.id,
      cancellation: undefined,
      archived: false,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      createdBy: this.data.currentUser,
    };
    this.data.docs = [rev, ...this.data.docs];
    this.audit("REVISION_DEVIS", "document", rev.id, `Révision en préparation de ${src.number}`);
    this.mirrorDoc(rev);
    this.persist();
    return rev;
  }

  /** Brouillon de révision en cours pour ce devis, s'il existe. */
  findOpenRevision(devisNumber: string): InvoiceDoc | undefined {
    return this.data.docs.find(
      (d) => d.docType === "DEV" && d.status === "BROUILLON" && d.originDocNumber === devisNumber
    );
  }

  /** Toutes les révisions déjà validées d'un devis (historique visible, §20). */
  revisionsOf(devisNumber: string): InvoiceDoc[] {
    return this.data.docs.filter(
      (d) => d.docType === "DEV" && d.status !== "BROUILLON" && d.originDocNumber === devisNumber
    );
  }

  /** Avoir (§22) : référence la facture d'origine, jamais de modification rétroactive. */
  createCreditNote(invoiceId: string): InvoiceDoc {
    const src = this.data.docs.find((d) => d.id === invoiceId);
    if (!src || src.docType !== "FAC") throw new Error("Un avoir ne peut référencer qu'une facture.");
    if (!src.number) throw new Error("La facture d'origine n'est pas validée.");
    const avoir: InvoiceDoc = {
      ...JSON.parse(JSON.stringify(src)),
      id: uid("doc"),
      docType: "AVOIR",
      number: null,
      status: "BROUILLON",
      date: todayISO(),
      originDocNumber: src.number,
      originDocId: src.id,
      cancellation: undefined,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      createdBy: this.data.currentUser,
    };
    this.data.docs = [avoir, ...this.data.docs];
    this.audit("CREATION_AVOIR", "document", avoir.id, `Avoir en préparation sur ${src.number}`);
    this.mirrorDoc(avoir);
    this.persist();
    return avoir;
  }

  /** Conversion Devis/Proforma/BL → Facture (§57, §58, §59) :
   *  nouvelle facture brouillon, nouveau numéro, l'original n'est pas modifié. */
  convertToInvoice(id: string): InvoiceDoc {
    const src = this.data.docs.find((d) => d.id === id);
    if (!src || !["DEV", "PRO", "BL"].includes(src.docType)) {
      throw new Error("Seuls un devis, une proforma ou un bon de livraison peuvent être convertis en facture.");
    }
    const draft: InvoiceDoc = {
      ...JSON.parse(JSON.stringify(src)),
      id: uid("doc"),
      docType: "FAC",
      number: null,
      status: "BROUILLON",
      date: todayISO(),
      refDevis: src.docType === "DEV" ? src.number ?? undefined : src.refDevis,
      refBonLivraison: src.docType === "BL" ? src.number ?? undefined : src.refBonLivraison,
      originDocNumber: src.number ?? undefined,
      originDocId: src.id,
      cancellation: undefined,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      createdBy: this.data.currentUser,
    };
    this.data.docs = [draft, ...this.data.docs];
    this.audit("CONVERSION_FACTURE", "document", draft.id, `${src.docType} ${src.number ?? "(brouillon)"} → nouveau brouillon de facture`);
    this.mirrorDoc(draft);
    this.persist();
    return draft;
  }

  setDocStatus(id: string, status: InvoiceDoc["status"]): void {
    const doc = this.data.docs.find((d) => d.id === id);
    if (!doc) throw new Error("Document introuvable.");
    const old = doc.status;
    doc.status = status;
    doc.updatedAt = nowISO();
    this.data.docs = this.data.docs.map((x) => (x.id === doc.id ? { ...doc } : x)); // référence neuve (F-15)
    this.audit("CHANGEMENT_STATUT", "document", id, `${old} → ${status} (${doc.number ?? "brouillon"})`);
    this.mirrorDoc(doc);
    this.persist();
  }

  toggleArchive(id: string): void {
    const doc = this.data.docs.find((d) => d.id === id);
    if (!doc) return;
    doc.archived = !doc.archived;
    this.data.docs = this.data.docs.map((x) => (x.id === doc.id ? { ...doc } : x)); // référence neuve (F-15)
    this.audit(doc.archived ? "ARCHIVAGE" : "DESARCHIVAGE", "document", id, doc.number ?? "(brouillon)");
    this.mirrorDoc(doc);
    this.persist();
  }

  /* ---------------- Paiements (§19) ---------------- */

  paymentsFor(docId: string): Payment[] {
    return this.data.payments.filter((p) => p.invoiceId === docId);
  }

  paidCents(doc: InvoiceDoc): Cents {
    if (doc.status === "ANNULEE") return 0;
    return this.paymentsFor(doc.id).reduce((s, p) => s + p.amountCents, 0);
  }

  remainingCents(doc: InvoiceDoc): Cents {
    return Math.max(doc.totalTtcCents - this.paidCents(doc), 0);
  }

  addPayment(input: Omit<Payment, "id" | "ts" | "invoiceNumber">): Payment {
    const doc = this.data.docs.find((d) => d.id === input.invoiceId);
    if (!doc) throw new Error("Facture introuvable.");
    if (doc.status === "ANNULEE") throw new Error("Impossible d'encaisser une facture annulée.");
    if (doc.status === "BROUILLON") {
      throw new Error("Encaissement impossible sur un brouillon : validez d'abord la facture (§20).");
    }
    if (input.amountCents <= 0) throw new Error("Le montant du paiement doit être supérieur à 0.");
    const remaining = this.remainingCents(doc);
    if (input.amountCents > remaining) {
      throw new Error(
        `Le paiement (${formatCents(input.amountCents)}) dépasse le reste à payer (${formatCents(remaining)}).`
      );
    }
    const payment: Payment = {
      ...input,
      id: uid("pay"),
      invoiceNumber: doc.number ?? "(brouillon)",
      ts: nowISO(),
    };
    this.data.payments = [payment, ...this.data.payments];
    // Statut dérivé automatiquement (§19).
    const newPaid = this.paidCents(doc);
    doc.status = newPaid >= doc.totalTtcCents ? "PAYEE" : "PARTIELLEMENT_PAYEE";
    doc.updatedAt = nowISO();
    this.data.docs = this.data.docs.map((x) => (x.id === doc.id ? { ...doc } : x)); // référence neuve (F-15)
    this.audit("ENCAISSEMENT", "payment", payment.id,
      `${formatCents(payment.amountCents)} sur ${doc.number} (${payment.mode}) — statut : ${doc.status}`);
    if (isTauri()) {
      // Ordre garanti : le document (avec son nouveau statut) AVANT le paiement.
      this.mirrorDoc(doc);
      mirrorUpsert("payment", payment.id, paymentPayload(payment, this.data.currentUser));
    }
    this.persist();
    return payment;
  }

  /* ---------------- Sauvegardes (§30, §31, §32) ---------------- */

  exportBackup(kind: BackupRecord["kind"], label: string): string {
    const json = JSON.stringify(this.data, null, 0);
    // Taille réelle en OCTETS (pas en caractères) — les accents comptent double.
    const sizeBytes = typeof Blob !== "undefined" ? new Blob([json]).size : json.length;
    const record: BackupRecord = {
      id: uid("bkp"),
      ts: nowISO(),
      kind,
      label,
      sizeBytes,
      counts: {
        factures: this.data.docs.filter((d) => d.docType === "FAC").length,
        clients: this.data.customers.length,
        produits: this.data.products.length,
      },
      schemaVersion: this.data.schemaVersion,
    };
    this.data.backupHistory = [record, ...this.data.backupHistory];
    this.audit("SAUVEGARDE", "backup", record.id, `${label} (${record.sizeBytes} octets)`);
    if (isTauri()) mirrorUpsert("backup_record", record.id, backupRecordPayload(record));
    this.persist();
    return json;
  }

  restoreFromBackup(json: string): { message: string } {
    let parsed: AppData;
    try {
      parsed = JSON.parse(json) as AppData;
    } catch {
      throw new Error("Fichier de sauvegarde illisible (JSON invalide).");
    }
    if (!parsed || !Array.isArray(parsed.docs) || !parsed.company) {
      throw new Error("Ce fichier n'est pas une sauvegarde FacturationDZ valide.");
    }
    // §32 : sauvegarde de sécurité AVANT la restauration.
    const safety = JSON.stringify(this.data);
    try {
      this.storage.setItem(SECURITY_BACKUP_KEY, safety);
    } catch {
      /* quota : la restauration reste possible */
    }
    this.audit("RESTAURATION", "backup", undefined,
      `Restauration effectuée (sauvegarde de sécurité conservée).`, safety.slice(0, 80), "(nouvel état)");
    this.data = applyLocalMigrations(parsed);
    this.data.initialized = true;
    this.techLog("WARNING", "Base restaurée depuis une sauvegarde.");
    // En desktop, la restauration du fichier SQLite se fait via
    // desktopActions.restoreDatabase() puis hydrateFromDesktop() (§32).
    this.persist();
    return { message: "Restauration terminée. Une sauvegarde de sécurité de l'état précédent a été conservée." };
  }

  /* ---------------- Desktop : réhydratation et synchronisation -------- */

  /** Amorçage desktop au démarrage (§51, §52) : si le profil local est vide
   *  (première ouverture d'un profil WebView neuf, réinstallation, copie du
   *  dossier `ProgramData\FacturationDZ` sur un autre poste) mais que la base
   *  SQLite contient déjà une configuration, on la REPREND au lieu de
   *  réafficher l'assistant — les données de l'utilisateur ne disparaissent
   *  jamais de son écran.
   *
   *  Renvoie `true` si l'état a été repris depuis SQLite. */
  async bootstrapDesktop(): Promise<boolean> {
    if (!isTauri()) return false;
    if (this.data.initialized) return false; // profil local déjà configuré
    try {
      const ds = await invokeDesktop<Record<string, unknown>>("load_dataset");
      if (!ds || !datasetLooksConfigured(ds)) return false; // base vide → assistant normal
      const previousUser = this.data.currentUser;
      this.data = datasetToAppData(ds, defaultData());
      this.data.currentUser = previousUser || this.data.currentUser || "admin";
      this.persist();
      this.techLog(
        "INFO",
        "Configuration existante reprise depuis la base SQLite (profil local vide) — §51/§52."
      );
      return true;
    } catch (e) {
      this.techLog("ERROR", `Amorçage desktop impossible : ${(e as Error)?.message ?? e}`);
      return false;
    }
  }

  /** Réhydrate l'état frontend depuis la base SQLite desktop (§32).
   *  Appelé après une restauration de base réussie. */
  async hydrateFromDesktop(): Promise<boolean> {
    if (!isTauri()) return false;
    try {
      const ds = await invokeDesktop<Record<string, unknown>>("load_dataset");
      if (!ds) return false;
      this.data = datasetToAppData(ds, defaultData());
      this.data.currentUser =
        this.data.users.length === 1 ? this.data.users[0].username : this.data.currentUser;
      this.persist();
      this.techLog("INFO", "État réhydraté depuis la base SQLite desktop.");
      return true;
    } catch (e) {
      this.techLog("ERROR", `Réhydratation impossible : ${(e as Error)?.message ?? e}`);
      return false;
    }
  }

  /** Pousse l'intégralité de l'état local vers SQLite (installation neuve,
   *  ou re-synchronisation manuelle depuis le diagnostic). */
  async syncAllToDesktop(): Promise<{ pushed: number }> {
    if (!isTauri()) return { pushed: 0 };
    let pushed = 0;
    const push = (entity: string, localId: string, data: unknown) => {
      mirrorUpsert(entity, localId, data);
      pushed++;
    };
    push("company", "company", companyPayload(this.data.company));
    push("settings", "settings", { pairs: settingsPairs(this.data.settings, this.data.language) });
    this.data.users.forEach((u) => push("user", u.id, userPayload(u)));
    this.data.taxRates.forEach((t) => push("tax_rate", t.code, taxRatePayload(t)));
    this.data.taxHistory.forEach((h) => push("tax_history", h.id, taxHistoryPayload(h)));
    this.data.customers.forEach((c) => push("customer", c.id, customerPayload(c)));
    this.data.products.forEach((p) => push("product", p.id, productPayload(p)));
    // Séquences (compteurs + modèles).
    Object.entries(this.data.sequences).forEach(([key, counter]) => {
      const [docType, yearStr] = [key.slice(0, key.lastIndexOf("-")) as DocType, key.slice(key.lastIndexOf("-") + 1)];
      push("sequence", key, sequencePayload(docType, Number(yearStr), counter, this.getSequenceConfig(docType)));
    });
    // Documents du plus ancien au plus récent, puis paiements.
    [...this.data.docs].reverse().forEach((d) => push("document", d.id, docPayload(d, d.createdBy)));
    [...this.data.payments].reverse().forEach((p) =>
      push("payment", p.id, paymentPayload(p, this.data.currentUser))
    );
    this.data.backupHistory.forEach((b) => push("backup_record", b.id, backupRecordPayload(b)));
    this.data.audit.forEach((a) => push("audit", a.id, auditPayload(a)));
    return { pushed };
  }

  /* ---------------- Pièces jointes (§61) ---------------- */

  /** Ajoute une pièce jointe à un document.
   *  Démo : contenu stocké en data-URL (limité à 2 Mo — quota navigateur).
   *  Desktop : fichier écrit dans Documents/ par le backend (20 Mo). */
  async addAttachment(
    docId: string,
    file: { name: string; sizeBytes: number; mimeType?: string; dataUrl: string }
  ): Promise<DocAttachment> {
    const doc = this.data.docs.find((d) => d.id === docId);
    if (!doc) throw new Error("Document introuvable.");
    if (doc.status === "ANNULEE") {
      throw new Error("Impossible d'ajouter une pièce à un document annulé.");
    }
    if (isTauri()) {
      const b64 = file.dataUrl.includes(",") ? file.dataUrl.split(",")[1] : file.dataUrl;
      const info = await invokeDesktop<{ file_name: string; file_path: string; size_bytes: number }>(
        "save_attachment",
        { invoiceLocalId: docId, name: file.name, dataB64: b64, mime: file.mimeType ?? null }
      );
      if (!info) throw new Error("Enregistrement de la pièce jointe impossible.");
      const att: DocAttachment = {
        id: uid("att"),
        name: info.file_name,
        sizeBytes: info.size_bytes,
        mimeType: file.mimeType,
        desktopPath: info.file_path,
        addedBy: this.data.currentUser,
        addedAt: nowISO(),
      };
      doc.attachments = [...(doc.attachments ?? []), att];
      doc.updatedAt = nowISO();
      this.data.docs = this.data.docs.map((x) => (x.id === doc.id ? { ...doc } : x));
      this.audit("AJOUT_PIECE_JOINTE", "document", doc.id, `${file.name} (${info.size_bytes} octets)`);
      this.persist();
      return att;
    }
    // Mode démo : limite raisonnable compte tenu du quota localStorage.
    if (file.sizeBytes > 2 * 1024 * 1024) {
      throw new Error("En mode démonstration, les pièces jointes sont limitées à 2 Mo.");
    }
    const att: DocAttachment = {
      id: uid("att"),
      name: file.name,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      dataUrl: file.dataUrl,
      addedBy: this.data.currentUser,
      addedAt: nowISO(),
    };
    doc.attachments = [...(doc.attachments ?? []), att];
    doc.updatedAt = nowISO();
    this.data.docs = this.data.docs.map((x) => (x.id === doc.id ? { ...doc } : x));
    this.audit("AJOUT_PIECE_JOINTE", "document", doc.id, `${file.name} (${file.sizeBytes} octets)`);
    this.persist();
    return att;
  }

  /** Retire une pièce jointe (fichier supprimé du disque en mode desktop). */
  async removeAttachment(docId: string, attachmentId: string): Promise<void> {
    const doc = this.data.docs.find((d) => d.id === docId);
    if (!doc) return;
    const att = (doc.attachments ?? []).find((a) => a.id === attachmentId);
    if (!att) return;
    if (isTauri() && att.name) {
      await invokeDesktop("delete_attachment", { invoiceLocalId: docId, fileName: att.name }).catch(
        (e: unknown) => this.techLog("ERROR", `Suppression pièce jointe : ${(e as Error)?.message ?? e}`)
      );
    }
    doc.attachments = (doc.attachments ?? []).filter((a) => a.id !== attachmentId);
    doc.updatedAt = nowISO();
    this.data.docs = this.data.docs.map((x) => (x.id === doc.id ? { ...doc } : x));
    this.audit("SUPPRESSION_PIECE_JOINTE", "document", doc.id, att.name);
    this.persist();
  }

  /** Sauvegarde automatique (§30) — exécutée au démarrage selon la fréquence. */
  maybeAutoBackup(): void {
    const freq = this.data.settings.autoBackupFrequency;
    if (freq === "OFF") return;
    const last = this.data.backupHistory.find((b) => b.kind === "AUTO");
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;
    const needBackup =
      !last ||
      (freq === "DAILY" && now - new Date(last.ts).getTime() > dayMs) ||
      (freq === "WEEKLY" && now - new Date(last.ts).getTime() > 7 * dayMs);
    if (!needBackup) return;
    const stamp = todayISO();
    const json = this.exportBackup("AUTO", `Sauvegarde automatique ${stamp}`);
    const record = this.data.backupHistory[0];
    try {
      this.storage.setItem(`facturationdz.autobackup.${record.id}`, json);
    } catch {
      this.techLog("WARNING", "Sauvegarde automatique non persistée (quota).");
    }
    // Rétention (§30) : conserver les N dernières.
    const retention = Math.max(1, this.data.settings.autoBackupRetention);
    const autos = this.data.backupHistory.filter((b) => b.kind === "AUTO");
    if (autos.length > retention) {
      const toRemove = autos.slice(retention);
      this.data.backupHistory = this.data.backupHistory.filter((b) => !toRemove.includes(b));
      toRemove.forEach((b) => this.storage.removeItem(`facturationdz.autobackup.${b.id}`));
    }
    this.persist();
  }

  /* ---------------- Intégrité (§49) ---------------- */

  integrityCheck(): { severity: "OK" | "WARNING" | "ERROR"; message: string }[] {
    const findings: { severity: "OK" | "WARNING" | "ERROR"; message: string }[] = [];
    const customerIds = new Set(this.data.customers.map((c) => c.id));

    const orphans = this.data.docs.filter((d) => !customerIds.has(d.customerId));
    if (orphans.length) {
      findings.push({ severity: "ERROR", message: `${orphans.length} document(s) rattaché(s) à un client inexistant.` });
    }

    const seen = new Map<string, number>();
    this.data.docs.forEach((d) => {
      if (!d.number) return;
      seen.set(d.number, (seen.get(d.number) ?? 0) + 1);
    });
    const dups = [...seen.entries()].filter(([, n]) => n > 1);
    if (dups.length) {
      findings.push({ severity: "ERROR", message: `Numéros dupliqués : ${dups.map(([n]) => n).join(", ")}` });
    }

    let mismatch = 0;
    this.data.docs.forEach((d) => {
      if (d.status === "BROUILLON" || d.lines.length === 0) return;
      const t = computeDocument(d.lines, d.globalDiscount, d.devise);
      if (t.totalHtCents !== d.totalHtCents || t.totalTtcCents !== d.totalTtcCents) mismatch++;
    });
    if (mismatch) {
      findings.push({ severity: "ERROR", message: `${mismatch} document(s) avec des totaux incohérents.` });
    }

    let payIssue = 0;
    this.data.payments.forEach((p) => {
      const doc = this.data.docs.find((d) => d.id === p.invoiceId);
      if (!doc) payIssue++;
      else if (this.paidCents(doc) > doc.totalTtcCents) payIssue++;
    });
    if (payIssue) {
      findings.push({ severity: "ERROR", message: `${payIssue} paiement(s) incohérent(s) (facture absente ou trop-perçu).` });
    }

    if (findings.length === 0) {
      findings.push({ severity: "OK", message: "Aucune anomalie détectée : pas de doublons, pas d'orphelins, totaux cohérents, paiements cohérents." });
    }
    return findings;
  }

  /* ---------------- Export complet (§33) ---------------- */

  exportAllJson(): string {
    return JSON.stringify(
      {
        exportedAt: nowISO(),
        app: "FacturationDZ",
        version: APP_VERSION,
        company: this.data.company,
        customers: this.data.customers,
        products: this.data.products,
        docs: this.data.docs,
        payments: this.data.payments,
        taxRates: this.data.taxRates,
        settings: this.data.settings,
      },
      null,
      2
    );
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function customerName(c: Customer): string {
  return c.type === "ENTREPRISE"
    ? c.denomination || c.nomCommercial || "(entreprise sans dénomination)"
    : `${c.nom ?? ""} ${c.prenom ?? ""}`.trim() || "(particulier)";
}

export function isOverdue(doc: InvoiceDoc, paidCents: number): boolean {
  if (doc.status === "PAYEE" || doc.status === "ANNULEE") return false;
  if (!doc.dateEcheance) return false;
  return doc.dateEcheance < todayISO() && paidCents < doc.totalTtcCents;
}

/** Montant formaté avec le symbole de la monnaie : celle du document, sinon celle de la société. */
export function formatCents(c: number, devise?: string | null): string {
  const abs = Math.abs(Math.trunc(c));
  const intPart = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const dec = (abs % 100).toString().padStart(2, "0");
  const symbole = currencySymbol(devise ?? store.data.company.devise);
  return `${c < 0 ? "-" : ""}${intPart},${dec} ${symbole}`;
}

/* ------------------------------------------------------------------ */
/* Jeu de données de démonstration (§77)                               */
/* ------------------------------------------------------------------ */

function monthsAgoISO(months: number, day: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

function seedDemoData(data: AppData): void {
  const now = nowISO();
  const mkCustomer = (c: Partial<Customer>): Customer => ({
    id: uid("cus"),
    type: "ENTREPRISE",
    contacts: [],
    actif: true,
    demo: true,
    createdAt: now,
    updatedAt: now,
    ...c,
  });

  const c1 = mkCustomer({
    denomination: "SARL Bâtiment El Aurassi",
    nomCommercial: "El Aurassi",
    formeJuridique: "SARL",
    activite: "Construction et travaux publics",
    adresse: "Zone industrielle Oued Smar, lot 12",
    wilaya: "Alger",
    commune: "Oued Smar",
    telephone: "023 50 60 70",
    email: "contact@elaurassi.dz",
    rc: "16/00-0123456B21",
    nif: "002116123456789",
    nis: "002116123456798",
    articleImposition: "12345678901",
    conditionsPaiementJours: 30,
  });
  const c2 = mkCustomer({
    denomination: "EURL Pharma Santé Distribution",
    formeJuridique: "EURL",
    activite: "Distribution pharmaceutique",
    adresse: "Cité 1er Novembre, bât B",
    wilaya: "Oran",
    commune: "Oran",
    telephone: "041 20 30 40",
    email: "info@pharmasante.dz",
    rc: "31/00-0654321B20",
    nif: "002131654321789",
    nis: "002131654321798",
    articleImposition: "98765432101",
    conditionsPaiementJours: 60,
  });
  const c3 = mkCustomer({
    denomination: "SARL Agro Alimentaire Mitidja",
    formeJuridique: "SARL",
    activite: "Transformation agroalimentaire",
    adresse: "Route nationale 1, km 8",
    wilaya: "Blida",
    commune: "Ouled Yaïch",
    telephone: "025 43 21 09",
    rc: "09/00-0789123B19",
    nif: "002109078912345",
    nis: "002109078912354",
    conditionsPaiementJours: 15,
  });
  const c4 = mkCustomer({
    denomination: "SPA Équipement Industriel Numidie",
    formeJuridique: "SPA",
    activite: "Négoce d'équipements industriels",
    adresse: "Boulevard de l'ALN, n° 45",
    wilaya: "Constantine",
    commune: "Constantine",
    telephone: "031 92 81 70",
    email: "achats@numidie-equip.dz",
    rc: "25/00-0456789B22",
    nif: "002125045678912",
    nis: "002125045678921",
    articleImposition: "45678912301",
    conditionsPaiementJours: 45,
  });
  const c5 = mkCustomer({
    type: "PARTICULIER",
    nom: "Benali",
    prenom: "Karim",
    adresse: "12 rue Didouche Mourad",
    wilaya: "Alger",
    commune: "Alger-Centre",
    telephone: "0550 12 34 56",
  });
  data.customers.push(c1, c2, c3, c4, c5);

  const mkProduct = (p: Partial<Product>): Product => ({
    id: uid("prd"),
    unite: "unité",
    taxCodeDefaut: "TVA19",
    actif: true,
    demo: true,
    createdAt: now,
    updatedAt: now,
    ...p,
  }) as Product;

  data.products.push(
    mkProduct({ reference: "CIM-50", designation: "Ciment gris CPA 50 kg", unite: "unité", puHtCents: fromNumber(950), categorie: "Matériaux" }),
    mkProduct({ reference: "FER-12", designation: "Rond à béton Ø12 mm (barre 12 m)", unite: "pièce", puHtCents: fromNumber(1450), categorie: "Matériaux" }),
    mkProduct({ reference: "PEINT-B", designation: "Peinture bâtiment blanche 25 kg", unite: "unité", puHtCents: fromNumber(6800), categorie: "Finitions" }),
    mkProduct({ reference: "SERV-ETUDE", designation: "Étude technique — prestation", unite: "forfait", puHtCents: fromNumber(85000), categorie: "Services" }),
    mkProduct({ reference: "TRANS-ALG", designation: "Transport Alger — livraison chantier", unite: "forfait", puHtCents: fromNumber(12000), taxCodeDefaut: "TVA19", categorie: "Transport" }),
    mkProduct({ reference: "EQUIP-POMP", designation: "Pompe hydraulique 2CV", unite: "unité", puHtCents: fromNumber(42000), categorie: "Équipements", taxCodeDefaut: "TVA9" }),
    mkProduct({ reference: "LOC-GRUE", designation: "Location grue mobile (jour)", unite: "jour", puHtCents: fromNumber(35000), categorie: "Location" })
  );

  // Factures de démonstration : validées via le même chemin que les réelles.
  const store = new StoreProxy(data);
  const samples: Array<{
    customer: Customer; monthsAgo: number; day: number; dueDays: number;
    lines: Array<{ ref?: string; designation: string; qty: number; pu: number; tax: string; unite?: string }>;
    paid?: "FULL" | "HALF"; cancel?: string;
  }> = [
    {
      customer: c1, monthsAgo: 5, day: 9, dueDays: 30, paid: "FULL",
      lines: [
        { ref: "CIM-50", designation: "Ciment gris CPA 50 kg", qty: 120, pu: 950, tax: "TVA19" },
        { ref: "FER-12", designation: "Rond à béton Ø12 mm (barre 12 m)", qty: 60, pu: 1450, tax: "TVA19" },
      ],
    },
    {
      customer: c2, monthsAgo: 4, day: 14, dueDays: 60, paid: "HALF",
      lines: [{ ref: "EQUIP-POMP", designation: "Pompe hydraulique 2CV", qty: 4, pu: 42000, tax: "TVA9" }],
    },
    {
      customer: c3, monthsAgo: 3, day: 6, dueDays: 15,
      lines: [
        { ref: "PEINT-B", designation: "Peinture bâtiment blanche 25 kg", qty: 15, pu: 6800, tax: "TVA19" },
        { designation: "Livraison — frais de transport", qty: 1, pu: 8000, tax: "TVA19" },
      ],
    },
    {
      customer: c4, monthsAgo: 2, day: 21, dueDays: 45, paid: "FULL",
      lines: [
        { ref: "SERV-ETUDE", designation: "Étude technique — prestation", qty: 1, pu: 85000, tax: "TVA19" },
        { ref: "LOC-GRUE", designation: "Location grue mobile (jour)", qty: 3, pu: 35000, tax: "TVA19" },
      ],
    },
    {
      customer: c1, monthsAgo: 1, day: 11, dueDays: 30,
      lines: [
        { ref: "CIM-50", designation: "Ciment gris CPA 50 kg", qty: 200, pu: 950, tax: "TVA19" },
        { ref: "TRANS-ALG", designation: "Transport Alger — livraison chantier", qty: 2, pu: 12000, tax: "TVA19" },
      ],
    },
    {
      customer: c5, monthsAgo: 0, day: 3, dueDays: 0, paid: "FULL",
      lines: [{ ref: "PEINT-B", designation: "Peinture bâtiment blanche 25 kg", qty: 2, pu: 6800, tax: "TVA19" }],
    },
  ];

  samples.forEach((s) => {
    const date = monthsAgoISO(s.monthsAgo, s.day);
    const doc: InvoiceDoc = {
      id: uid("doc"),
      docType: "FAC",
      number: null,
      status: "BROUILLON",
      date,
      dateEcheance: addDays(date, s.dueDays),
      customerId: s.customer.id,
      sellerSnapshot: sellerSnapshotOf(data),
      buyerSnapshot: buyerSnapshotOf(s.customer),
      lines: s.lines.map((l) => {
        const tax = data.taxRates.find((t) => t.code === l.tax) ?? data.taxRates[0];
        return {
          id: uid("ln"),
          nature: "VENTE",
          productRef: l.ref,
          designation: l.designation,
          qty: l.qty,
          unite: l.unite ?? "unité",
          puHtCents: fromNumber(l.pu),
          taxCode: tax.code,
          taxRatePctSnapshot: tax.ratePct,
          taxLibelleSnapshot: tax.libelle,
        };
      }),
      totalHtCents: 0,
      totalTvaCents: 0,
      totalTtcCents: 0,
      vatDetail: [],
      amountInWords: "",
      modePaiement: "Virement bancaire",
      conditionsPaiement: `${s.dueDays} jours`,
      devise: "DZD",
      archived: false,
      demo: true,
      createdBy: "Administrateur",
      createdAt: now,
      updatedAt: now,
    };
    const comp = computeDocument(doc.lines, doc.globalDiscount, doc.devise);
    doc.totalHtCents = comp.totalHtCents;
    doc.totalTvaCents = comp.totalTvaCents;
    doc.totalTtcCents = comp.totalTtcCents;
    doc.vatDetail = comp.vatDetail;
    doc.amountInWords = comp.amountInWords;
    data.docs.unshift(doc);
    store.validate(doc.id);
    const validated = data.docs.find((d) => d.id === doc.id)!;

    if (s.paid === "FULL" || s.paid === "HALF") {
      const amount = s.paid === "FULL" ? validated.totalTtcCents : Math.floor(validated.totalTtcCents / 2);
      data.payments.unshift({
        id: uid("pay"),
        invoiceId: validated.id,
        invoiceNumber: validated.number ?? "",
        mode: s.paid === "FULL" ? "Virement bancaire" : "Chèque",
        date: addDays(date, 5),
        amountCents: amount,
        reference: s.paid === "FULL" ? "VIR-2026-0148" : "CHQ 0004512",
        banque: "BEA — Agence Alger 12",
        ts: now,
      });
      validated.status = s.paid === "FULL" ? "PAYEE" : "PARTIELLEMENT_PAYEE";
    }
  });

  // Une facture annulée (démontre le marquage §21) + un avoir (§22).
  const cancelledSrc = data.docs.find((d) => d.docType === "FAC" && d.status === "VALIDEE");
  if (cancelledSrc) {
    cancelledSrc.status = "ANNULEE";
    cancelledSrc.cancellation = {
      at: now,
      by: "Administrateur",
      motif: "Erreur de référence client — facture remplacée.",
    };
    data.audit.unshift({
      id: uid("aud"), ts: now, utilisateur: "Administrateur", action: "ANNULATION_DOCUMENT",
      objectType: "document", objectId: cancelledSrc.id,
      details: `${cancelledSrc.number} — motif : ${cancelledSrc.cancellation.motif}`,
    });
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Proxy minimal pour valider pendant le seed sans persistance intermédiaire. */
class StoreProxy {
  constructor(private d: AppData) {}
  validate(id: string): void {
    const doc = this.d.docs.find((x) => x.id === id);
    if (!doc) return;
    const year = Number(doc.date.slice(0, 4));
    const key = `${doc.docType}-${year}`;
    const cfg = this.d.sequenceConfigs.find((c) => c.docType === doc.docType)!;
    const next = (this.d.sequences[key] ?? 0) + 1;
    doc.number = renderNumber(cfg, year, next);
    doc.status = "VALIDEE";
    this.d.sequences[key] = next;
  }
}

function sellerSnapshotOf(data: AppData) {
  const c = data.company;
  return {
    displayName: c.raisonSociale,
    type: "ENTREPRISE_VENDEUR" as const,
    formeJuridique: c.formeJuridique,
    activite: c.activite,
    adresse: c.adresse, wilaya: c.wilaya, commune: c.commune,
    telephone: c.telephone, fax: c.fax, email: c.email,
    rc: c.rc, nif: c.nif, nis: c.nis, articleImposition: c.articleImposition,
    capitalSocial: c.capitalSocial,
  };
}

function buyerSnapshotOf(c: Customer) {
  return {
    displayName: customerName(c),
    type: c.type,
    formeJuridique: c.formeJuridique,
    activite: c.activite,
    adresse: c.adresse, wilaya: c.wilaya, commune: c.commune,
    telephone: c.telephone, fax: c.fax, email: c.email,
    rc: c.rc, nif: c.nif, nis: c.nis, articleImposition: c.articleImposition,
  };
}

/** Factory pour tests et injection de dépendances ; l'app utilise le singleton. */
export function createStore(storage?: StorageLike): Store {
  return new Store(storage);
}

export const store = createStore();
