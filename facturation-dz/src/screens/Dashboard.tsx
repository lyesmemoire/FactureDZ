/** Tableau de bord (§28) — statistiques calculées depuis la base locale. */

import { useMemo } from "react";
import { formatDateFr, shortMonthLabel } from "../core/format";
import { formatMoney } from "../core/money";
import { currencySymbol } from "../core/currency";
import type { InvoiceDoc } from "../core/types";
import { formatCents, isOverdue, store } from "../store/store";
import type { Route } from "../ui/App";
import { Btn, Card, StatCard, StatusBadge, useApp } from "../ui/components";

export function Dashboard({ go, print }: { go: (r: Route) => void; print: (doc: InvoiceDoc, copy?: boolean) => void }) {
  const data = useApp();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const stats = useMemo(() => {
    const facs = data.docs.filter((d) => d.docType === "FAC" && d.status !== "ANNULEE");
    const facMonth = facs.filter((d) => {
      const dt = new Date(d.date);
      return dt.getFullYear() === year && dt.getMonth() === month;
    });
    const facYear = facs.filter((d) => new Date(d.date).getFullYear() === year);
    const caHtMonth = facMonth.reduce((s, d) => s + d.totalHtCents, 0);
    const caHtYear = facYear.reduce((s, d) => s + d.totalHtCents, 0);
    const tvaMonth = facMonth.reduce((s, d) => s + d.totalTvaCents, 0);
    const caTtcYear = facYear.reduce((s, d) => s + d.totalTtcCents, 0);

    const unpaid = facs.filter((d) => ["VALIDEE", "ENVOYEE", "PARTIELLEMENT_PAYEE"].includes(d.status) && store.remainingCents(d) > 0);
    const unpaidAmount = unpaid.reduce((s, d) => s + store.remainingCents(d), 0);
    const overdue = unpaid.filter((d) => isOverdue(d, store.paidCents(d)));
    const cancelled = data.docs.filter((d) => d.docType === "FAC" && d.status === "ANNULEE");

    const monthly: number[] = Array(12).fill(0);
    facYear.forEach((d) => {
      monthly[new Date(d.date).getMonth()] += d.totalHtCents;
    });

    return { facMonth, caHtMonth, caHtYear, tvaMonth, caTtcYear, unpaid, unpaidAmount, overdue, cancelled, monthly };
  }, [data, year, month]);

  const recent = data.docs.filter((d) => d.docType === "FAC").slice(0, 8);
  const maxMonthly = Math.max(...stats.monthly, 1);

  return (
    <>
      <div className="toolbar">
        <Btn variant="primary" onClick={() => go({ name: "editor", docType: "FAC" })}>+ Nouvelle facture</Btn>
        <Btn onClick={() => go({ name: "customers" })}>+ Nouveau client</Btn>
        <Btn onClick={() => go({ name: "products" })}>+ Nouveau produit</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" onClick={() => go({ name: "reports" })}>Voir les rapports →</Btn>
      </div>

      <div className="stats-grid">
        <StatCard label="CA HT du mois" value={`${formatMoney(stats.caHtMonth)} ${currencySymbol(store.data.company.devise)}`} sub={`${stats.facMonth.length} facture(s)`} tone="blue" />
        <StatCard label="TVA collectée (mois)" value={`${formatMoney(stats.tvaMonth)} ${currencySymbol(store.data.company.devise)}`} />
        <StatCard label="CA HT de l'année" value={`${formatMoney(stats.caHtYear)} ${currencySymbol(store.data.company.devise)}`} />
        <StatCard label="CA TTC de l'année" value={`${formatMoney(stats.caTtcYear)} ${currencySymbol(store.data.company.devise)}`} tone="green" />
        <StatCard label="Impayés" value={formatCents(stats.unpaidAmount)} sub={`${stats.unpaid.length} facture(s) concernée(s)`} tone={stats.unpaidAmount > 0 ? "amber" : "default"} />
        <StatCard label="Factures en retard" value={stats.overdue.length} tone={stats.overdue.length > 0 ? "red" : "default"} />
        <StatCard label="Factures annulées" value={stats.cancelled.length} />
        <StatCard label="Clients" value={data.customers.length} />
        <StatCard label="Produits / services" value={data.products.length} />
      </div>

      <Card title={`Chiffre d'affaires HT mensuel — ${year}`}>
        <div className="chart-wrap">
          <svg viewBox="0 0 760 230" style={{ width: "100%", maxWidth: 900 }}>
            {stats.monthly.map((v, i) => {
              const h = Math.round((v / maxMonthly) * 170);
              const x = 30 + i * 60;
              const y = 195 - h;
              return (
                <g key={i}>
                  <rect x={x} y={y} width={38} height={h} rx={4} fill={i === month ? "#1d4ed8" : "#93b4f5"} />
                  {v > 0 && (
                    <text x={x + 19} y={y - 6} textAnchor="middle" fontSize="9.5" fill="#5a6a7e">
                      {formatMoney(v)}
                    </text>
                  )}
                  <text x={x + 19} y={212} textAnchor="middle" fontSize="10" fill="#5a6a7e">
                    {shortMonthLabel(i)}
                  </text>
                </g>
              );
            })}
            <line x1="24" y1="195" x2="752" y2="195" stroke="#dde4ee" />
          </svg>
        </div>
      </Card>

      <Card title="Dernières factures" actions={<Btn small onClick={() => go({ name: "documents", docType: "FAC" })}>Tout voir</Btn>}>
        <div className="table-wrap card-body tight" style={{ border: "none" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Numéro</th><th>Date</th><th>Client</th>
                <th className="num">TTC</th><th className="num">Reste</th><th>Statut</th><th></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.number ?? "(brouillon)"}</td>
                  <td>{formatDateFr(d.date)}</td>
                  <td>{d.buyerSnapshot.displayName}</td>
                  <td className="num">{formatCents(d.totalTtcCents)}</td>
                  <td className="num">{formatCents(store.remainingCents(d))}</td>
                  <td><StatusBadge status={d.status} overdue={isOverdue(d, store.paidCents(d))} /></td>
                  <td className="right">
                    <div className="row-actions">
                      <Btn small onClick={() => go({ name: "editor", docType: "FAC", docId: d.id })}>Voir</Btn>
                      <Btn small variant="ghost" onClick={() => print(d)}>PDF</Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr><td colSpan={7} className="empty-state">Aucune facture pour l'instant — créez la première !</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
