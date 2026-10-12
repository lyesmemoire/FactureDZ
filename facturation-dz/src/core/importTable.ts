/**
 * Import de clients et de produits depuis un tableau (Excel / CSV) — phase 1.
 *
 * Fonctions pures : aucune écriture ici. L'interface affiche l'aperçu ligne par ligne,
 * puis enregistre uniquement les lignes « ok » via le store (journal d'audit, sync).
 */

import type { Customer, Product, TaxRate, ValidationRulesConfig } from "./types";
import { uid } from "./ids";
import { nowISO } from "./format";
import { parseAmountFr } from "./money";
import { validateCustomerIdentifiers } from "./validation";

export type RowStatus = "ok" | "doublon" | "erreur";

export interface ImportRow<T> {
  /** Numéro de ligne dans le fichier (en-tête = ligne 1). */
  line: number;
  status: RowStatus;
  messages: string[];
  value?: T;
}

export interface ImportPreview<T> {
  /** Colonnes obligatoires absentes : aucune ligne ne peut être importée. */
  missingColumns: string[];
  rows: ImportRow<T>[];
  counts: Record<RowStatus, number>;
}

/* ---------------- Colonnes reconnues ---------------- */

/** Libellés acceptés pour chaque champ, par ordre de priorité. */
export const CUSTOMER_COLUMNS = {
  type: ["type", "typeclient", "nature"],
  denomination: ["denomination", "raisonsociale", "nomentreprise", "entreprise", "societe"],
  nom: ["nom", "nomfamille"],
  prenom: ["prenom"],
  nif: ["nif"],
  rc: ["rc", "registredecommerce", "registrecommerce"],
  nis: ["nis"],
  adresse: ["adresse"],
  wilaya: ["wilaya"],
  commune: ["commune"],
  telephone: ["telephone", "tel", "phone", "mobile"],
  email: ["email", "courriel", "mail"],
  conditionsPaiementJours: ["conditionspaiementjours", "delaipaiementjours", "delaipaiement", "delai", "conditionspaiement", "echeance"],
} as const;

export const PRODUCT_COLUMNS = {
  reference: ["reference", "ref", "codearticle", "code"],
  designation: ["designation", "libelle", "article", "nom"],
  description: ["description"],
  unite: ["unite", "unit", "uom"],
  puHt: ["puht", "prixunitaireht", "prixunitaire", "prixht", "pu", "prix"],
  taxCode: ["taxcode", "codetva", "tva", "taxe", "codetaxe"],
  categorie: ["categorie", "famille"],
} as const;

/** Forme normalisée d'un libellé d'en-tête : minuscules, sans accents, sans ponctuation. */
export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Associe chaque champ à l'index de sa colonne (undefined si absente). */
export function mapColumns<K extends string>(
  headers: string[],
  aliases: Record<K, readonly string[]>
): Record<K, number | undefined> {
  const norm = headers.map(normalizeHeader);
  const out = {} as Record<K, number | undefined>;
  for (const key of Object.keys(aliases) as K[]) {
    let found: number | undefined;
    for (const alias of aliases[key]) {
      const idx = norm.indexOf(alias);
      if (idx >= 0) {
        found = idx;
        break;
      }
    }
    out[key] = found;
  }
  return out;
}

function cell(row: string[], idx: number | undefined): string {
  if (idx === undefined) return "";
  return (row[idx] ?? "").trim();
}

function emptyPreview<T>(missingColumns: string[]): ImportPreview<T> {
  return { missingColumns, rows: [], counts: { ok: 0, doublon: 0, erreur: 0 } };
}

function finalize<T>(missingColumns: string[], rows: ImportRow<T>[]): ImportPreview<T> {
  const counts: Record<RowStatus, number> = { ok: 0, doublon: 0, erreur: 0 };
  for (const r of rows) counts[r.status]++;
  return { missingColumns, rows, counts };
}

/** Normalise une valeur pour comparer les doublons (insensible à la casse et aux espaces). */
function key(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/* ---------------- Clients ---------------- */

const CUSTOMER_TYPES: Record<string, Customer["type"]> = {
  entreprise: "ENTREPRISE",
  societe: "ENTREPRISE",
  e: "ENTREPRISE",
  particulier: "PARTICULIER",
  p: "PARTICULIER",
};

export function buildCustomerImport(
  table: string[][],
  existing: Customer[],
  opts: { rules: ValidationRulesConfig; conditionsPaiementDefautJours: number }
): ImportPreview<Customer> {
  if (table.length === 0) return emptyPreview([]);
  const headers = table[0];
  const map = mapColumns(headers, CUSTOMER_COLUMNS);

  const missing: string[] = [];
  if (map.denomination === undefined && map.nom === undefined) missing.push("Dénomination ou Nom");
  if (missing.length) return emptyPreview(missing);

  // Clés déjà connues : NIF, puis nom
  const knownNif = new Set(existing.map((c) => c.nif?.replace(/\s/g, "")).filter(Boolean) as string[]);
  const knownNames = new Set(existing.map(customerKey));

  const rows: ImportRow<Customer>[] = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const line = i + 1;
    const messages: string[] = [];

    const rawType = key(cell(r, map.type));
    let type: Customer["type"] | undefined;
    const denomination = cell(r, map.denomination);
    const nom = cell(r, map.nom);
    const prenom = cell(r, map.prenom);

    if (rawType) {
      type = CUSTOMER_TYPES[rawType];
      if (!type) {
        rows.push({ line, status: "erreur", messages: [`Type inconnu : « ${rawType} » (Entreprise ou Particulier)`] });
        continue;
      }
    } else {
      type = denomination ? "ENTREPRISE" : "PARTICULIER";
    }

    if (type === "ENTREPRISE" && !denomination) messages.push("Dénomination obligatoire pour une entreprise.");
    if (type === "PARTICULIER" && !nom && !prenom) messages.push("Nom ou prénom obligatoire pour un particulier.");

    const email = cell(r, map.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) messages.push(`Courriel invalide : ${email}`);

    const jours = cell(r, map.conditionsPaiementJours);
    let conditionsPaiementJours = opts.conditionsPaiementDefautJours;
    if (jours) {
      const n = Number(jours);
      if (!Number.isInteger(n) || n < 0) messages.push(`Délai de paiement invalide : ${jours}`);
      else conditionsPaiementJours = n;
    }

    const customer: Customer = {
      id: uid("cus"),
      type,
      denomination: denomination || undefined,
      nom: nom || undefined,
      prenom: prenom || undefined,
      nif: cell(r, map.nif).replace(/\s/g, "") || undefined,
      rc: cell(r, map.rc) || undefined,
      nis: cell(r, map.nis) || undefined,
      adresse: cell(r, map.adresse) || undefined,
      wilaya: cell(r, map.wilaya) || undefined,
      commune: cell(r, map.commune) || undefined,
      telephone: cell(r, map.telephone) || undefined,
      email: email || undefined,
      contacts: [],
      actif: true,
      conditionsPaiementJours,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    } as Customer;

    // Contrôles d'identifiants : mêmes règles que la fiche client (§8)
    const issues = validateCustomerIdentifiers(customer, opts.rules);
    for (const issue of issues) {
      if (issue.level === "ERROR") messages.push(issue.message);
      else messages.push(`Avertissement : ${issue.message}`);
    }
    const blocking = messages.some((m) => !m.startsWith("Avertissement"));
    if (blocking) {
      rows.push({ line, status: "erreur", messages });
      continue;
    }

    // Doublons : NIF d'abord, sinon nom identique
    const nifKey = customer.nif;
    const dupNif = nifKey && knownNif.has(nifKey);
    const dupName = !nifKey && knownNames.has(customerKey(customer));
    if (dupNif || dupName) {
      rows.push({ line, status: "doublon", messages: [dupNif ? `NIF déjà présent : ${nifKey}` : "Client de même nom déjà présent"] });
      continue;
    }
    if (nifKey) knownNif.add(nifKey);
    knownNames.add(customerKey(customer));

    rows.push({ line, status: "ok", messages, value: customer });
  }
  return finalize([], rows);
}

function customerKey(c: Pick<Customer, "type" | "denomination" | "nom" | "prenom">): string {
  return key(c.type === "ENTREPRISE" ? c.denomination ?? "" : `${c.nom ?? ""} ${c.prenom ?? ""}`);
}

/* ---------------- Produits ---------------- */

export function buildProductImport(
  table: string[][],
  existing: Product[],
  opts: { taxRates: TaxRate[]; defaultTaxCode: string }
): ImportPreview<Product> {
  if (table.length === 0) return emptyPreview([]);
  const headers = table[0];
  const map = mapColumns(headers, PRODUCT_COLUMNS);

  const missing: string[] = [];
  if (map.reference === undefined) missing.push("Référence");
  if (map.designation === undefined) missing.push("Désignation");
  if (map.puHt === undefined) missing.push("Prix unitaire HT");
  if (missing.length) return emptyPreview(missing);

  const activeRates = opts.taxRates.filter((t) => t.actif);
  const knownRefs = new Set(existing.map((p) => key(p.reference)));

  const rows: ImportRow<Product>[] = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const line = i + 1;
    const messages: string[] = [];

    const reference = cell(r, map.reference);
    const designation = cell(r, map.designation);
    if (!reference) messages.push("Référence obligatoire.");
    if (!designation) messages.push("Désignation obligatoire.");

    let puHtCents = 0;
    try {
      puHtCents = parseAmountFr(cell(r, map.puHt));
      if (puHtCents < 0) messages.push("Le prix unitaire HT doit être positif.");
    } catch {
      messages.push(`Prix unitaire illisible : « ${cell(r, map.puHt)} »`);
    }

    // Code TVA : accepte le code (TVA19) ou le taux (19)
    const rawTax = cell(r, map.taxCode);
    let taxCodeDefaut = opts.defaultTaxCode;
    if (rawTax) {
      const byCode = activeRates.find((t) => key(t.code) === key(rawTax));
      const pct = Number(rawTax.replace(",", ".").replace("%", ""));
      const byRate = Number.isFinite(pct) ? activeRates.find((t) => t.ratePct === pct) : undefined;
      const match = byCode ?? byRate;
      if (match) taxCodeDefaut = match.code;
      else messages.push(`Code TVA inconnu : « ${rawTax} »`);
    }

    if (messages.length) {
      rows.push({ line, status: "erreur", messages });
      continue;
    }

    if (knownRefs.has(key(reference))) {
      rows.push({ line, status: "doublon", messages: [`Référence déjà présente : ${reference}`] });
      continue;
    }
    knownRefs.add(key(reference));

    const product: Product = {
      id: uid("prd"),
      reference,
      designation,
      description: cell(r, map.description) || undefined,
      unite: cell(r, map.unite) || "unité",
      puHtCents,
      taxCodeDefaut,
      categorie: cell(r, map.categorie) || undefined,
      actif: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    rows.push({ line, status: "ok", messages: [], value: product });
  }
  return finalize([], rows);
}

/* ---------------- Modèles à télécharger ---------------- */

/** Modèle CSV (séparateur « ; », BOM pour Excel). */
export function importTemplate(kind: "customers" | "products"): string {
  const lines =
    kind === "customers"
      ? [
          "Type;Dénomination;Nom;Prénom;NIF;RC;NIS;Adresse;Wilaya;Commune;Téléphone;Courriel;Délai de paiement (jours)",
          "Entreprise;SARL Exemple;;;123456789012345;16/00-0000000 B 00;;Rue 1 Novembre;Alger;Alger Centre;0550000000;contact@exemple.dz;30",
        ]
      : [
          "Référence;Désignation;Description;Unité;Prix unitaire HT;Code TVA;Catégorie",
          "REF-001;Ramette papier A4;Paquet de 500 feuilles;unité;850;TVA19;Papeterie",
        ];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
