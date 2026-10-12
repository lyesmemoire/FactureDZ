/**
 * Import des factures de vente historiques (phase 1, décision utilisateur) :
 * le numéro du fichier est conservé TEL QUEL. Aucune renumérotation.
 *
 * Format : une ligne par article, regroupées par « Numéro ».
 * Colonnes obligatoires : Numéro, Date, Client (ou NIF client), Désignation, Quantité, Prix unitaire HT.
 * Colonnes facultatives : NIF client, Référence, Code TVA, Remise %, Échéance, Total TTC (contrôle).
 */

import type { Customer, DocLine, InvoiceDoc, TaxRate } from "./types";
import type { ImportPreview, ImportRow } from "./importTable";
import { mapColumns, normalizeHeader } from "./importTable";
import { uid } from "./ids";
import { computeDocument, type InvoiceComputation } from "./invoiceCalculator";
import { parseAmountFr } from "./money";
import { pickDefaultTax } from "./taxEngine";

export const HISTORICAL_COLUMNS = {
  numero: ["numero", "numerofacture", "nfacture", "facture", "nodocument"],
  date: ["date", "datefacture"],
  client: ["client", "nomclient", "clientdenomination"],
  nifClient: ["nifclient", "nif"],
  echeance: ["echeance", "dateecheance", "datedechéance", "datedecheance"],
  reference: ["reference", "ref", "codearticle", "code"],
  designation: ["designation", "libelle", "article"],
  quantite: ["quantite", "qte", "qté", "qty"],
  puHt: ["puht", "prixunitaireht", "prixunitaire", "prixht", "pu"],
  codeTva: ["codetva", "tva", "taxcode", "taxe"],
  remise: ["remise", "remisepct", "remise%"],
  totalTtc: ["totalttc", "ttc", "totaltt"],
} as const;

export interface HistoricalInvoice {
  number: string;
  date: string;
  dateEcheance?: string;
  customerId: string;
  customerLabel: string;
  lines: DocLine[];
  computed: InvoiceComputation;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/** Accepte AAAA-MM-JJ (export Excel) ou JJ/MM/AAAA. Retourne ISO ou null. */
export function parseImportDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = DATE_RE.exec(s);
  const dmy = DMY_RE.exec(s);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmy) {
    [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function cell(row: string[], idx: number | undefined): string {
  if (idx === undefined) return "";
  return (row[idx] ?? "").trim();
}

function keyOf(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function customerNameKey(c: Customer): string {
  return keyOf(c.type === "ENTREPRISE" ? c.denomination ?? "" : `${c.nom ?? ""} ${c.prenom ?? ""}`);
}

export interface HistoricalContext {
  customers: Customer[];
  taxRates: TaxRate[];
  companyTaxCode: string;
  devise: string;
  /** Numéros déjà présents dans l'application (tous documents confondus). */
  existingNumbers: Array<string | null>;
  /** Date du jour ISO : une facture ne peut pas être datée dans le futur. */
  today: string;
}

/**
 * Lit le tableau et regroupe les lignes par numéro de facture.
 * Chaque résultat « ok » porte une facture complète, prête à être enregistrée.
 */
export function buildHistoricalInvoiceImport(
  table: string[][],
  ctx: HistoricalContext
): ImportPreview<HistoricalInvoice> {
  if (table.length === 0) return { missingColumns: [], rows: [], counts: { ok: 0, doublon: 0, erreur: 0 } };
  const map = mapColumns(table[0], HISTORICAL_COLUMNS);

  const missing: string[] = [];
  if (map.numero === undefined) missing.push("Numéro");
  if (map.date === undefined) missing.push("Date");
  if (map.client === undefined && map.nifClient === undefined) missing.push("Client ou NIF client");
  if (map.designation === undefined) missing.push("Désignation");
  if (map.quantite === undefined) missing.push("Quantité");
  if (map.puHt === undefined) missing.push("Prix unitaire HT");
  if (missing.length) return { missingColumns: missing, rows: [], counts: { ok: 0, doublon: 0, erreur: 0 } };

  // Regroupement par numéro, dans l'ordre du fichier
  type Group = { number: string; firstLine: number; rows: Array<{ line: number; cells: string[] }> };
  const groups = new Map<string, Group>();
  const orphanRows: ImportRow<HistoricalInvoice>[] = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const number = cell(r, map.numero);
    if (!number) {
      orphanRows.push({ line: i + 1, status: "erreur", messages: ["Numéro de facture obligatoire."] });
      continue;
    }
    const g = groups.get(number) ?? { number, firstLine: i + 1, rows: [] };
    g.rows.push({ line: i + 1, cells: r });
    groups.set(number, g);
  }

  const existingNumbers = new Set(ctx.existingNumbers.filter(Boolean) as string[]);
  const rows: ImportRow<HistoricalInvoice>[] = [...orphanRows];

  for (const g of groups.values()) {
    const messages: string[] = [];
    const first = g.rows[0].cells;
    const date = parseImportDate(cell(first, map.date));
    if (!date) messages.push(`Date illisible : « ${cell(first, map.date)} » (AAAA-MM-JJ ou JJ/MM/AAAA).`);
    else if (date > ctx.today) messages.push(`Date future : ${date}.`);

    // Date, client et échéance doivent être identiques sur toutes les lignes d'une facture
    for (const other of g.rows.slice(1)) {
      if (parseImportDate(cell(other.cells, map.date)) !== date) messages.push(`Date différente à la ligne ${other.line}.`);
      if (cell(other.cells, map.client) !== cell(first, map.client) || cell(other.cells, map.nifClient) !== cell(first, map.nifClient)) {
        messages.push(`Client différent à la ligne ${other.line}.`);
      }
    }

    // Client : NIF d'abord, sinon nom
    const nif = cell(first, map.nifClient).replace(/\s/g, "");
    const clientName = cell(first, map.client);
    let customer: Customer | undefined;
    if (nif) customer = ctx.customers.find((c) => c.nif?.replace(/\s/g, "") === nif);
    if (!customer && clientName) customer = ctx.customers.find((c) => customerNameKey(c) === keyOf(clientName));
    if (!customer) messages.push(`Client introuvable : « ${clientName || nif} ». Importez d'abord les clients.`);

    // Lignes
    const lines: DocLine[] = [];
    for (const row of g.rows) {
      const c = row.cells;
      const designation = cell(c, map.designation);
      if (!designation) {
        messages.push(`Ligne ${row.line} : désignation obligatoire.`);
        continue;
      }
      const qtyRaw = cell(c, map.quantite).replace(",", ".");
      const qty = Number(qtyRaw);
      if (!Number.isFinite(qty) || qty <= 0) {
        messages.push(`Ligne ${row.line} : quantité invalide « ${cell(c, map.quantite)} ».`);
        continue;
      }
      let puHtCents = 0;
      try {
        puHtCents = parseAmountFr(cell(c, map.puHt));
      } catch {
        messages.push(`Ligne ${row.line} : prix unitaire illisible.`);
        continue;
      }
      const remiseRaw = cell(c, map.remise).replace(",", ".").replace("%", "");
      const remisePct = remiseRaw ? Number(remiseRaw) : 0;
      if (!Number.isFinite(remisePct) || remisePct < 0 || remisePct > 100) {
        messages.push(`Ligne ${row.line} : remise invalide.`);
        continue;
      }

      // Taux : code ou pourcentage du fichier, sinon taux par défaut à la date de la facture
      const rawTax = cell(c, map.codeTva);
      let tax: TaxRate | undefined;
      if (rawTax) {
        const pct = Number(rawTax.replace(",", ".").replace("%", ""));
        tax = ctx.taxRates.find((t) => t.actif && (keyOf(t.code) === keyOf(rawTax) || (Number.isFinite(pct) && t.ratePct === pct)));
        if (!tax) messages.push(`Ligne ${row.line} : code TVA inconnu « ${rawTax} ».`);
      } else if (date) {
        tax = pickDefaultTax(ctx.taxRates, ctx.companyTaxCode, date);
      }
      if (!tax) {
        if (!rawTax) messages.push(`Ligne ${row.line} : aucun taux de TVA applicable à la date.`);
        continue;
      }

      lines.push({
        id: uid("ln"),
        nature: "VENTE",
        productRef: cell(c, map.reference) || undefined,
        designation,
        qty,
        unite: "unité",
        puHtCents,
        remisePct: remisePct || undefined,
        taxCode: tax.code,
        taxRatePctSnapshot: tax.ratePct,
        taxLibelleSnapshot: tax.libelle,
        taxKindSnapshot: tax.kind ?? "TVA",
      });
    }
    if (lines.length === 0 && messages.length === 0) messages.push("Aucune ligne d'article.");

    // Doublon de numéro : la facture existe déjà dans l'application
    if (messages.length === 0 && existingNumbers.has(g.number)) {
      rows.push({ line: g.firstLine, status: "doublon", messages: [`Numéro déjà présent : ${g.number}`] });
      continue;
    }

    const computed = computeDocument(lines, undefined, ctx.devise);

    // Total TTC du fichier (facultatif) : contrôle de cohérence avec le calcul
    const ttcRaw = cell(first, map.totalTtc);
    if (ttcRaw && lines.length > 0) {
      try {
        const ttcFile = parseAmountFr(ttcRaw);
        if (ttcFile !== computed.totalTtcCents) {
          messages.push(`Total TTC du fichier (${ttcRaw}) différent du calcul (${(computed.totalTtcCents / 100).toFixed(2)}).`);
        }
      } catch {
        messages.push(`Total TTC illisible : « ${ttcRaw} ».`);
      }
    }

    const echeance = cell(first, map.echeance);
    const dateEcheance = echeance ? parseImportDate(echeance) ?? undefined : undefined;
    if (echeance && !dateEcheance) messages.push(`Échéance illisible : « ${echeance} ».`);

    if (messages.length > 0 || !customer || !date) {
      rows.push({ line: g.firstLine, status: "erreur", messages });
      continue;
    }

    existingNumbers.add(g.number);
    rows.push({
      line: g.firstLine,
      status: "ok",
      messages: [`${lines.length} ligne(s)`],
      value: {
        number: g.number,
        date,
        dateEcheance,
        customerId: customer.id,
        customerLabel: customer.type === "ENTREPRISE" ? customer.denomination ?? "" : `${customer.prenom ?? ""} ${customer.nom ?? ""}`.trim(),
        lines,
        computed,
      },
    });
  }

  const counts = { ok: 0, doublon: 0, erreur: 0 };
  for (const r of rows) counts[r.status]++;
  return { missingColumns: [], rows, counts };
}

/** Construit le document complet (non encore enregistré). */
export function historicalToDoc(
  inv: HistoricalInvoice,
  parts: { sellerSnapshot: InvoiceDoc["sellerSnapshot"]; buyerSnapshot: InvoiceDoc["buyerSnapshot"]; devise: string; modePaiement?: string; createdBy: string }
): InvoiceDoc {
  const c = inv.computed;
  const now = new Date().toISOString();
  return {
    id: uid("doc"),
    docType: "FAC",
    number: inv.number,
    status: "VALIDEE",
    date: inv.date,
    dateEcheance: inv.dateEcheance,
    customerId: inv.customerId,
    sellerSnapshot: parts.sellerSnapshot,
    buyerSnapshot: parts.buyerSnapshot,
    lines: inv.lines.map((l) => ({ ...l })),
    totalHtCents: c.totalHtCents,
    totalTvaCents: c.totalTvaCents,
    totalOtherTaxesCents: c.totalOtherTaxesCents,
    totalTtcCents: c.totalTtcCents,
    vatDetail: c.vatDetail,
    otherTaxDetail: c.otherTaxDetail,
    amountInWords: c.amountInWords,
    modePaiement: parts.modePaiement,
    devise: parts.devise,
    archived: false,
    demo: false,
    createdBy: parts.createdBy,
    createdAt: now,
    updatedAt: now,
  } as InvoiceDoc;
}

/** Modèle CSV : une facture de deux lignes (séparateur « ; », BOM pour Excel). */
export function historicalTemplate(): string {
  const lines = [
    "Numéro;Date;Client;NIF client;Échéance;Référence;Désignation;Quantité;Prix unitaire HT;Code TVA;Remise %;Total TTC",
    "FAC-2024-0001;2024-03-15;SARL Exemple;123456789012345;2024-04-15;REF-001;Ramette papier A4;10;850;TVA19;0;;",
    "FAC-2024-0001;2024-03-15;SARL Exemple;123456789012345;2024-04-15;;Transport;1;1000;TVA9;0;11781,50",
  ];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
