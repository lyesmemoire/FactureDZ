/**
 * FacturationDZ — Internationalisation (§43).
 *
 * Le français est la langue par défaut et complète. L'architecture permet
 * l'anglais et l'arabe : dictionnaires centralisés ici, langue stockée dans
 * les paramètres, formats de dates/montants déjà centralisés (format.ts,
 * money.ts). Les écrans basculent leurs libellés via `t(key)`.
 */

export type Lang = "fr" | "en" | "ar";

export const LANG_LABELS: Record<Lang, string> = {
  fr: "Français",
  en: "English",
  ar: "العربية",
};

type Dict = Record<string, string>;

const fr: Dict = {
  "nav.dashboard": "Tableau de bord",
  "nav.documents": "Documents",
  "nav.payments": "Paiements",
  "nav.customers": "Clients",
  "nav.products": "Produits & services",
  "nav.reports": "Rapports",
  "nav.backups": "Sauvegardes",
  "nav.audit": "Journal d'audit",
  "nav.users": "Utilisateurs",
  "nav.settings": "Paramètres",
  "nav.diagnostic": "Diagnostic",
  "action.add": "Ajouter",
  "action.save": "Enregistrer",
  "action.cancel": "Annuler",
  "action.delete": "Supprimer",
  "action.search": "Rechercher",
  "action.print": "Imprimer",
  "action.validate": "Valider",
  "action.close": "Fermer",
  "action.confirm": "Confirmer",
  "common.loading": "Chargement…",
  "common.demoMode": "Mode démonstration",
  "common.offline": "100 % hors ligne — aucune donnée ne quitte cet ordinateur",
};

const en: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.documents": "Documents",
  "nav.payments": "Payments",
  "nav.customers": "Customers",
  "nav.products": "Products & services",
  "nav.reports": "Reports",
  "nav.backups": "Backups",
  "nav.audit": "Audit log",
  "nav.users": "Users",
  "nav.settings": "Settings",
  "nav.diagnostic": "Diagnostics",
  "action.add": "Add",
  "action.save": "Save",
  "action.cancel": "Cancel",
  "action.delete": "Delete",
  "action.search": "Search",
  "action.print": "Print",
  "action.validate": "Validate",
  "action.close": "Close",
  "action.confirm": "Confirm",
  "common.loading": "Loading…",
  "common.demoMode": "Demo mode",
  "common.offline": "100% offline — no data ever leaves this computer",
};

const ar: Dict = {
  "nav.dashboard": "لوحة القيادة",
  "nav.documents": "المستندات",
  "nav.payments": "المدفوعات",
  "nav.customers": "العملاء",
  "nav.products": "المنتجات والخدمات",
  "nav.reports": "التقارير",
  "nav.backups": "النسخ الاحتياطية",
  "nav.audit": "سجل التدقيق",
  "nav.users": "المستخدمون",
  "nav.settings": "الإعدادات",
  "nav.diagnostic": "التشخيص",
  "action.add": "إضافة",
  "action.save": "حفظ",
  "action.cancel": "إلغاء",
  "action.delete": "حذف",
  "action.search": "بحث",
  "action.print": "طباعة",
  "action.validate": "اعتماد",
  "action.close": "إغلاق",
  "action.confirm": "تأكيد",
  "common.loading": "جارٍ التحميل…",
  "common.demoMode": "وضع العرض",
  "common.offline": "بدون إنترنت 100٪ — لا تغادر أي بيانات هذا الحاسوب",
};

const DICTS: Record<Lang, Dict> = { fr, en, ar };

let current: Lang = "fr";

export function setLanguage(lang: Lang): void {
  current = lang;
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }
}

export function getLanguage(): Lang {
  return current;
}

/** Traduction d'une clé ; retombe sur le français puis sur la clé elle-même. */
export function t(key: string): string {
  return DICTS[current][key] ?? fr[key] ?? key;
}
