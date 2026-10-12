/** Paiements (§19) : encaissements et statuts automatiques. */

import { useMemo, useState } from "react";
import { formatDateFr } from "../core/format";
import type { InvoiceDoc } from "../core/types";
import { MODES_PAIEMENT } from "../core/types";
import { formatCents, isOverdue, store } from "../store/store";
import type { Route } from "../ui/App";
import { Btn, Card, EmptyState, StatusBadge, useApp } from "../ui/components";
import { PaymentModal } from "../ui/docModals";

export function PaymentsScreen({ go }: { go: (r: Route) => void }) {
  const data = useApp();
  const [payDoc, setPayDoc] = useState<InvoiceDoc | null>(null);

  const unpaid = useMemo(
    () =>
      data.docs.filter(
        (d) =>
          d.docType === "FAC" &&
          !["ANNULEE", "BROUILLON"].includes(d.status) &&
          store.remainingCents(d) > 0
      ),
    [data]
  );

  return (
    <>
      <Card title="Factures avec reste à payer (§19)">
        <div className="table-wrap card-body tight">
          <table className="data">
            <thead>
              <tr>
                <th>Numéro</th><th>Date</th><th>Client</th>
                <th className="num">TTC</th><th className="num">Payé</th>
                <th className="num">Reste à payer</th><th>Échéance</th><th>Statut</th><th className="right">Action</th>
              </tr>
            </thead>
            <tbody>
              {unpaid.map((d) => {
                const paid = store.paidCents(d);
                return (
                  <tr key={d.id}>
                    <td className="mono">{d.number}</td>
                    <td>{formatDateFr(d.date)}</td>
                    <td>{d.buyerSnapshot.displayName}</td>
                    <td className="num">{formatCents(d.totalTtcCents, d.devise)}</td>
                    <td className="num">{formatCents(paid, d.devise)}</td>
                    <td className="num"><b>{formatCents(store.remainingCents(d), d.devise)}</b></td>
                    <td>{formatDateFr(d.dateEcheance)}</td>
                    <td><StatusBadge status={d.status} overdue={isOverdue(d, paid)} /></td>
                    <td className="right">
                      <Btn need="payment.write" small variant="success" onClick={() => setPayDoc(d)}>Encaisser</Btn>
                    </td>
                  </tr>
                );
              })}
              {unpaid.length === 0 && (
                <tr><td colSpan={9}><EmptyState>Aucune facture impayée. Tout est encaissé ✓</EmptyState></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Historique des encaissements">
        <div className="table-wrap card-body tight">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th><th>Facture</th><th>Mode</th><th>Référence</th>
                <th>Banque / N° chèque</th><th className="num">Montant</th><th className="right">Facture</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDateFr(p.date)}</td>
                  <td className="mono">{p.invoiceNumber}</td>
                  <td>{p.mode}</td>
                  <td>{p.reference ?? "—"}</td>
                  <td>{[p.banque, p.numeroCheque].filter(Boolean).join(" — ") || "—"}</td>
                  <td className="num"><b>{formatCents(p.amountCents)}</b></td>
                  <td className="right">
                    <Btn small variant="ghost" onClick={() => {
                      const doc = data.docs.find((d) => d.id === p.invoiceId);
                      if (doc) go({ name: "editor", docType: doc.docType, docId: doc.id });
                    }}>
                      Voir
                    </Btn>
                  </td>
                </tr>
              ))}
              {data.payments.length === 0 && (
                <tr><td colSpan={7}><EmptyState>Aucun paiement enregistré.</EmptyState></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ padding: "10px 18px", margin: 0 }}>
          Modes pris en charge : {MODES_PAIEMENT.join(", ")}. Le statut de la facture (NON PAYÉE / PARTIELLEMENT
          PAYÉE / PAYÉE / EN RETARD) est recalculé automatiquement : Total TTC − total payé = reste à payer (§19).
        </p>
      </Card>

      {payDoc && <PaymentModal doc={payDoc} onClose={() => setPayDoc(null)} />}
    </>
  );
}
