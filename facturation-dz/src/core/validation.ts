/**
 * FacturationDZ — Contrôles avant validation (§48) et validation
 * configurable des identifiants fiscaux (§8).
 *
 * Principe §8 : ne JAMAIS bloquer arbitrairement l'utilisateur avec des
 * règles non officiellement confirmées. Chaque identifiant (NIF, NIS, RC,
 * Article d'imposition) a un mode configurable : OFF / WARN / BLOCK,
 * avec des motifs d'avertissement explicites.
 */

import { recomputeTotals } from "./invoiceCalculator";
import { parseAmountFr } from "./money";
import type {
  Company,
  Customer,
  InvoiceDoc,
  TaxRate,
  ValidationRulesConfig,
} from "./types";

export interface ValidationIssue {
  level: "ERROR" | "WARNING";
  message: string;
  field?: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  ok: boolean;
}

export const DEFAULT_VALIDATION_RULES: ValidationRulesConfig = {
  nif: "WARN",
  nis: "WARN",
  rc: "WARN",
  articleImposition: "WARN",
  // Motifs souples par défaut (non bloquants) — modifiables par l'admin.
  nifPattern: "^\\d{15}$",
  nisPattern: "^\\d{9,20}$",
  rcPattern: "^\\d{2}B?\\d{9,14}$|^[A-Z0-9/\\-]{6,}$",
  aiPattern: "^[A-Z0-9/\\-]{3,}$",
};

function checkIdentifier(
  rules: ValidationRulesConfig,
  field: "nif" | "nis" | "rc" | "articleImposition",
  label: string,
  value: string | undefined,
  requiredForCompany: boolean,
  issues: ValidationIssue[]
): void {
  const mode = rules[field];
  if (mode === "OFF") return;
  const pattern =
    field === "nif" ? rules.nifPattern
    : field === "nis" ? rules.nisPattern
    : field === "rc" ? rules.rcPattern
    : rules.aiPattern;

  if (!value || !value.trim()) {
    if (requiredForCompany) {
      issues.push({
        level: mode === "BLOCK" ? "ERROR" : "WARNING",
        message: `${label} absent(e). Vérifiez les mentions obligatoires avant impression.`,
        field,
      });
    }
    return;
  }
  try {
    const re = new RegExp(pattern);
    if (!re.test(value.trim())) {
      issues.push({
        level: mode === "BLOCK" ? "ERROR" : "WARNING",
        message: `${label} « ${value} » ne correspond pas au format attendu (${pattern}). Vous pouvez ajuster cette règle dans Paramètres.`,
        field,
      });
    }
  } catch {
    issues.push({
      level: "WARNING",
      message: `Règle de validation invalide pour ${label} (expression régulière incorrecte).`,
      field,
    });
  }
}

/** Validation des identifiants d'un tiers (§8). */
export function validateCustomerIdentifiers(
  customer: Customer,
  rules: ValidationRulesConfig
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (customer.type !== "ENTREPRISE") return issues;
  checkIdentifier(rules, "nif", "NIF", customer.nif, true, issues);
  checkIdentifier(rules, "nis", "NIS", customer.nis, true, issues);
  checkIdentifier(rules, "rc", "RC", customer.rc, true, issues);
  checkIdentifier(rules, "articleImposition", "Article d'imposition", customer.articleImposition, false, issues);
  return issues;
}

/** Contrôles complets avant validation d'une facture (§48). */
export function validateInvoiceBeforeValidation(
  doc: InvoiceDoc,
  ctx: {
    company: Company;
    customer: Customer | undefined;
    taxRates: TaxRate[];
    rules: ValidationRulesConfig;
    existingNumbers: Array<string | null>;
  }
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Date
  if (!doc.date || !/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) {
    errors.push({ level: "ERROR", message: "La date du document est manquante ou invalide.", field: "date" });
  }

  // Client
  if (!doc.customerId || !ctx.customer) {
    errors.push({ level: "ERROR", message: "Aucun client sélectionné.", field: "customer" });
  } else {
    if (!ctx.customer.adresse?.trim()) {
      errors.push({
        level: "ERROR",
        message: "L'adresse du client est vide. Complétez la fiche client avant validation.",
        field: "customerAddress",
      });
    }
    for (const i of validateCustomerIdentifiers(ctx.customer, ctx.rules)) {
      (i.level === "ERROR" ? errors : warnings).push(i);
    }
  }

  // Entreprise vendeuse
  if (!ctx.company.raisonSociale?.trim()) {
    errors.push({ level: "ERROR", message: "Raison sociale de l'entreprise absente (Paramètres > Mon entreprise).", field: "company" });
  }

  // Lignes
  if (doc.lines.length === 0) {
    errors.push({ level: "ERROR", message: "Le document ne contient aucune ligne.", field: "lines" });
  }
  doc.lines.forEach((l, idx) => {
    const n = idx + 1;
    if (!l.designation.trim()) {
      errors.push({ level: "ERROR", message: `Ligne ${n} : désignation vide.` });
    }
    if (!Number.isFinite(l.qty) || l.qty <= 0) {
      errors.push({ level: "ERROR", message: `Ligne ${n} : la quantité doit être supérieure à 0.` });
    }
    if (!Number.isFinite(l.puHtCents) || l.puHtCents < 0) {
      errors.push({ level: "ERROR", message: `Ligne ${n} : le prix unitaire HT doit être ≥ 0.` });
    }
    const knownTax = ctx.taxRates.some((t) => t.code === l.taxCode);
    if (!knownTax) {
      errors.push({ level: "ERROR", message: `Ligne ${n} : code TVA inconnu (${l.taxCode}).` });
    }
    if (l.taxRatePctSnapshot === 0 && !l.motifExoneration && l.taxCode !== "EXO") {
      warnings.push({
        level: "WARNING",
        message: `Ligne ${n} : taux 0 % appliqué sans motif d'exonération.`,
      });
    }
    if (l.remisePct !== undefined && (l.remisePct < 0 || l.remisePct > 100)) {
      errors.push({ level: "ERROR", message: `Ligne ${n} : remise hors bornes (0-100 %).` });
    }
  });

  // Cohérence des calculs (§48) — on recalcule et on compare.
  if (doc.lines.length > 0) {
    const totals = recomputeTotals(doc);
    if (
      totals.totalHtCents !== doc.totalHtCents ||
      totals.totalTvaCents !== doc.totalTvaCents ||
      totals.totalTtcCents !== doc.totalTtcCents
    ) {
      errors.push({
        level: "ERROR",
        message:
          "Incohérence de totaux détectée : les montants enregistrés ne correspondent pas au recalcul. Enregistrez à nouveau le document.",
      });
    }
  }

  // Unicité du numéro (si déjà attribué)
  if (doc.number) {
    const dup = ctx.existingNumbers.some((n) => n === doc.number);
    if (dup) {
      errors.push({
        level: "ERROR",
        message: `Le numéro ${doc.number} est déjà utilisé par un autre document.`,
      });
    }
  }

  return { errors, warnings, ok: errors.length === 0 };
}

/** Utilitaire : vérifie qu'une saisie de montant est bien formée. */
export function safeParseAmount(input: string): number | null {
  try {
    return parseAmountFr(input);
  } catch {
    return null;
  }
}
