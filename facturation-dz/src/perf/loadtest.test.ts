/**
 * Test de charge (§50) : volumétrie 100 000 documents.
 *
 * Exécution explicite (hors CI standard) :
 *   LOADTEST=1 npx vitest run src/perf/loadtest.test.ts
 * Le test est ignoré par défaut pour ne pas alourdir la suite de
 * non-régression (§66).
 */

import { describe, expect, it } from "vitest";
import { computeDocument } from "../core/invoiceCalculator";
import { uid } from "../core/ids";
import { assertNumberAvailable, renderNumber } from "../core/numbering";
import { store as storeSingleton, createStore, createMemoryStorage } from "../store/store";
import type { DocLine, InvoiceDoc } from "../core/types";

const RUN = process.env.LOADTEST === "1";
const N = Number(process.env.LOADTEST_N ?? 100_000);

function buildLine(i: number): DocLine {
  return {
    id: uid("ln"),
    nature: "VENTE",
    designation: `Article de test ${i % 500}`,
    qty: 1 + (i % 7),
    unite: "unité",
    puHtCents: 1000 + (i % 9_999),
    taxCode: i % 5 === 0 ? "TVA9" : "TVA19",
    taxRatePctSnapshot: i % 5 === 0 ? 9 : 19,
    taxLibelleSnapshot: i % 5 === 0 ? "TVA 9 %" : "TVA 19 %",
    taxKindSnapshot: "TVA",
  };
}

function buildDoc(i: number, customerId: string): InvoiceDoc {
  const year = 2020 + (i % 7);
  const lines = [buildLine(i)];
  const comp = computeDocument(lines);
  return {
    id: uid("doc"),
    docType: i % 20 === 0 ? "AVOIR" : "FAC",
    number: `${i % 20 === 0 ? "AV-2026" : `FAC-${year}`}-${String(i).padStart(6, "0")}`,
    status: i % 11 === 0 ? "PAYEE" : i % 7 === 0 ? "ANNULEE" : "VALIDEE",
    date: `${year}-${String(1 + (i % 12)).padStart(2, "0")}-15`,
    customerId,
    sellerSnapshot: { displayName: "Charge SARL", type: "ENTREPRISE_VENDEUR" },
    buyerSnapshot: { displayName: `Client ${i % 5000}`, type: "ENTREPRISE" },
    lines,
    totalHtCents: comp.totalHtCents,
    totalTvaCents: comp.totalTvaCents,
    totalOtherTaxesCents: comp.totalOtherTaxesCents,
    totalTtcCents: comp.totalTtcCents,
    vatDetail: comp.vatDetail,
    otherTaxDetail: comp.otherTaxDetail,
    amountInWords: comp.amountInWords,
    devise: "DZD",
    archived: false,
    createdBy: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe.skipIf(!RUN)(`Charge §50 — ${N} documents`, () => {
  it(`génère ${N} documents, mesure recherche, intégrité et numérotation`, () => {
    const s = createStore(createMemoryStorage());
    const t0 = Date.now();

    // 5 000 clients et 100 000 documents (1 ligne chacun).
    s.data.customers = Array.from({ length: 5000 }, (_, i) => ({
      id: `cus-${i}`,
      type: "ENTREPRISE" as const,
      denomination: `Client ${i} SARL`,
      nif: `0021${String(i).padStart(10, "0")}`,
      contacts: [],
      actif: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    const docs: InvoiceDoc[] = new Array(N);
    for (let i = 0; i < N; i++) docs[i] = buildDoc(i, `cus-${i % 5000}`);
    s.data.docs = docs;

    const genMs = Date.now() - t0;

    // --- Recherche (§27) : même logique que l'écran Documents ---
    const haystack = (d: InvoiceDoc) =>
      [d.number, d.buyerSnapshot.displayName, d.status, d.docType, `${d.totalTtcCents}`]
        .join(" ")
        .toLowerCase();

    const t1 = Date.now();
    const hitsNumber = docs.filter((d) => haystack(d).includes("client 1234"));
    const searchMs = Date.now() - t1;

    const t2 = Date.now();
    const page = docs.slice(0, 25); // pagination de l'écran
    const pageMs = Date.now() - t2;

    // --- Rapport : agrégation par mois sur tout l'historique ---
    const t3 = Date.now();
    const byMonth = new Map<string, number>();
    for (const d of docs) {
      if (d.status === "ANNULEE") continue;
      const key = d.date.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + d.totalTtcCents);
    }
    const reportMs = Date.now() - t3;

    // --- Intégrité (§49) : contrôle des doublons de numéros ---
    const t4 = Date.now();
    const seen = new Set<string>();
    let dup = 0;
    for (const d of docs) {
      if (!d.number) continue;
      if (seen.has(d.number)) dup++;
      seen.add(d.number);
    }
    const integrityMs = Date.now() - t4;

    // --- Numérotation (§12) : attribution du prochain numéro ---
    const t5 = Date.now();
    const numbers = docs.map((d) => d.number);
    const next = renderNumber({ docType: "FAC", template: "FAC-{YEAR}-{COUNTER}", padding: 6 }, 2026, N + 1);
    assertNumberAvailable(next, numbers);
    const numberingMs = Date.now() - t5;

    console.log(
      [
        "",
        `=== CHARGE §50 — ${N.toLocaleString("fr-FR")} documents ===`,
        `Génération (avec calculs monétaires) : ${genMs} ms`,
        `Recherche plein texte (1 requête)     : ${searchMs} ms`,
        `Pagination (25 lignes)                : ${pageMs} ms`,
        `Rapport agrégé (84 mois)              : ${reportMs} ms`,
        `Contrôle d'intégrité (numéros)        : ${integrityMs} ms`,
        `Attribution d'un numéro (§12)         : ${numberingMs} ms`,
        `Doublons détectés : ${dup} — résultat recherche : ${hitsNumber.length}`,
        "",
      ].join("\n")
    );

    expect(s.data.docs).toHaveLength(N);
    expect(dup).toBe(0);
    expect(hitsNumber.length).toBeGreaterThan(0);
    expect(searchMs).toBeLessThan(3000);
    expect(integrityMs).toBeLessThan(5000);
    expect(numberingMs).toBeLessThan(3000);
    expect(storeSingleton.getVersion()).toBeGreaterThanOrEqual(0);
  }, 300_000);
});
