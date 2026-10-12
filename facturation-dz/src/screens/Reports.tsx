/** Rapports (§29) : calculés depuis la base locale, export CSV/Excel/impression. */

import { useMemo, useState } from "react";
import { formatDateFr } from "../core/format";
import { formatMoney } from "../core/money";
import { formatCents, store } from "../store/store";
import { Alert, Btn, Card, Field, useApp } from "../ui/components";

type ReportKey =
  | "CA" | "TVA" | "FACTURES" | "IMPAYES" | "PAIEMENTS"
  | "VENTES_PRODUIT" | "VENTES_CLIENT" | "MENSUEL" | "ANNUEL";

const REPORTS: Array<{ key: ReportKey; label: string }> = [
  { key: "CA", label: "Chiffre d'affaires" },
  { key: "TVA", label: "TVA collectée par taux" },
  { key: "FACTURES", label: "Liste des factures" },
  { key: "IMPAYES", label: "Impayés" },
  { key: "PAIEMENTS", label: "Paiements" },
  { key: "VENTES_PRODUIT", label: "Ventes par produit" },
  { key: "VENTES_CLIENT", label: "Ventes par client" },
  { key: "MENSUEL", label: "Rapport mensuel (par année)" },
  { key: "ANNUEL", label: "Rapport annuel" },
];

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  return "\uFEFF" + [headers, ...rows].map((r) => r.map(csvEscape).join(";")).join("\r\n");
}

export function ReportsScreen() {
  const data = useApp();
  const [report, setReport] = useState<ReportKey>("CA");
  const year = new Date().getFullYear();
  const [yearFrom, setYearFrom] = useState(year);
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);

  const { headers, rows } = useMemo(() => {
    const inRange = (iso: string) => iso >= from && iso <= to;
    const facs = data.docs.filter((d) => d.docType === "FAC" && d.status !== "ANNULEE" && inRange(d.date));
    const all = data.docs.filter((d) => d.docType === "FAC" && inRange(d.date));

    switch (report) {
      case "CA":
      case "FACTURES":
        return {
          headers: ["Numéro", "Date", "Client", "NIF client", "HT", "TVA", "TTC", "Statut"],
          rows: all.map((d) => [
            d.number ?? "(brouillon)", formatDateFr(d.date), d.buyerSnapshot.displayName,
            d.buyerSnapshot.nif ?? "", formatMoney(d.totalHtCents), formatMoney(d.totalTvaCents),
            formatMoney(d.totalTtcCents), d.status,
          ]),
        };
      case "TVA": {
        const byRate = new Map<number, { base: number; amount: number; count: number }>();
        facs.forEach((d) =>
          d.vatDetail.forEach((v) => {
            const cur = byRate.get(v.ratePct) ?? { base: 0, amount: 0, count: 0 };
            cur.base += v.baseCents;
            cur.amount += v.amountCents;
            cur.count++;
            byRate.set(v.ratePct, cur);
          })
        );
        return {
          headers: ["Taux", "Base HT", "TVA collectée", "Documents"],
          rows: [...byRate.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([rate, v]) => [rate === 0 ? "Exonéré (0 %)" : `${rate} %`, formatMoney(v.base), formatMoney(v.amount), v.count]),
        };
      }
      case "IMPAYES":
        return {
          headers: ["Numéro", "Date", "Client", "Échéance", "TTC", "Payé", "Reste"],
          rows: facs
            .filter((d) => store.remainingCents(d) > 0)
            .map((d) => [
              d.number ?? "", formatDateFr(d.date), d.buyerSnapshot.displayName,
              formatDateFr(d.dateEcheance), formatMoney(d.totalTtcCents),
              formatMoney(store.paidCents(d)), formatMoney(store.remainingCents(d)),
            ]),
        };
      case "PAIEMENTS":
        return {
          headers: ["Date", "Facture", "Mode", "Référence", "Montant"],
          rows: data.payments
            .filter((p) => inRange(p.date))
            .map((p) => [formatDateFr(p.date), p.invoiceNumber, p.mode, p.reference ?? "", formatMoney(p.amountCents)]),
        };
      case "VENTES_PRODUIT": {
        const agg = new Map<string, { designation: string; qty: number; ht: number }>();
        facs.forEach((d) =>
          d.lines.forEach((l) => {
            const key = l.productRef ?? l.designation;
            const cur = agg.get(key) ?? { designation: l.designation, qty: 0, ht: 0 };
            cur.qty += l.qty;
            cur.ht += Math.round(l.qty * l.puHtCents);
            agg.set(key, cur);
          })
        );
        return {
          headers: ["Référence / Désignation", "Quantité vendue", "CA HT"],
          rows: [...agg.values()].sort((a, b) => b.ht - a.ht).map((v) => [v.designation, v.qty, formatMoney(v.ht)]),
        };
      }
      case "VENTES_CLIENT": {
        const agg = new Map<string, { name: string; count: number; ht: number; ttc: number }>();
        facs.forEach((d) => {
          const cur = agg.get(d.customerId) ?? { name: d.buyerSnapshot.displayName, count: 0, ht: 0, ttc: 0 };
          cur.count++;
          cur.ht += d.totalHtCents;
          cur.ttc += d.totalTtcCents;
          agg.set(d.customerId, cur);
        });
        return {
          headers: ["Client", "Factures", "CA HT", "CA TTC"],
          rows: [...agg.values()].sort((a, b) => b.ttc - a.ttc).map((v) => [v.name, v.count, formatMoney(v.ht), formatMoney(v.ttc)]),
        };
      }
      case "MENSUEL": {
        const months = Array.from({ length: 12 }, () => ({ count: 0, ht: 0, tva: 0, ttc: 0 }));
        facs.forEach((d) => {
          const m = months[new Date(d.date).getMonth()];
          m.count++;
          m.ht += d.totalHtCents;
          m.tva += d.totalTvaCents;
          m.ttc += d.totalTtcCents;
        });
        return {
          headers: ["Mois", "Factures", "CA HT", "TVA", "CA TTC"],
          rows: months.map((m, i) => [
            `${String(i + 1).padStart(2, "0")}/${yearFrom}`, m.count, formatMoney(m.ht), formatMoney(m.tva), formatMoney(m.ttc),
          ]),
        };
      }
      case "ANNUEL": {
        const byYear = new Map<number, { count: number; ht: number; tva: number; ttc: number }>();
        data.docs
          .filter((d) => d.docType === "FAC" && d.status !== "ANNULEE")
          .forEach((d) => {
            const y = Number(d.date.slice(0, 4));
            const cur = byYear.get(y) ?? { count: 0, ht: 0, tva: 0, ttc: 0 };
            cur.count++;
            cur.ht += d.totalHtCents;
            cur.tva += d.totalTvaCents;
            cur.ttc += d.totalTtcCents;
            byYear.set(y, cur);
          });
        return {
          headers: ["Année", "Factures", "CA HT", "TVA", "CA TTC"],
          rows: [...byYear.entries()].sort((a, b) => a[0] - b[0])
            .map(([y, v]) => [y, v.count, formatMoney(v.ht), formatMoney(v.tva), formatMoney(v.ttc)]),
        };
      }
    }
  }, [data, report, from, to, yearFrom]);

  function exportCsv() {
    const label = REPORTS.find((r) => r.key === report)?.label.replaceAll(" ", "_") ?? "rapport";
    const blob = toCsv(headers, rows);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([blob], { type: "text/csv;charset=utf-8" }));
    a.download = `FacturationDZ_${label}_${from}_${to}.csv`;
    a.click();
    store.audit("EXPORT_RAPPORT", "report", undefined, `${label} (${rows.length} lignes) du ${from} au ${to}`);
  }

  return (
    <>
      <div className="toolbar">
        <select value={report} onChange={(e) => setReport(e.target.value as ReportKey)} style={{ width: 280 }}>
          {REPORTS.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
        <Field label="Du">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Au">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div style={{ flex: 1 }} />
        <Btn onClick={exportCsv}>⬇ Export CSV / Excel (§29)</Btn>
        <Btn variant="ghost" onClick={() => window.print()}>Imprimer</Btn>
      </div>

      <Alert tone="info">
        Toutes les statistiques sont calculées depuis la base de données locale — aucune connexion requise (§28, §29).
        L'export CSV (séparateur « ; ») s'ouvre directement dans Excel.
      </Alert>

      <Card title={`${REPORTS.find((r) => r.key === report)?.label} — du ${formatDateFr(from)} au ${formatDateFr(to)}`}>
        <div className="table-wrap card-body tight">
          <table className="data">
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={j > 0 && typeof c === "string" && /^-?[\d\s]+,\d{2}$/.test(c) ? "num" : ""}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={headers.length} className="empty-state">Aucune donnée sur cette période.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {report === "CA" || report === "FACTURES" ? (
          <p className="muted small" style={{ padding: "10px 18px", margin: 0 }}>
            Totaux période : HT <b>{formatCents(rows.reduce((s, r) => s + Math.round(parseFloat(String(r[4]).replace(/\s/g, "").replace(",", ".")) * 100), 0))}</b>{" "}
            — TTC <b>{formatCents(rows.reduce((s, r) => s + Math.round(parseFloat(String(r[6]).replace(/\s/g, "").replace(",", ".")) * 100), 0))}</b>
          </p>
        ) : null}
      </Card>
    </>
  );
}
