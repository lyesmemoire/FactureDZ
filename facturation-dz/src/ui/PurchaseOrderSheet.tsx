/**
 * Feuille A4 d'un bon de commande (impression et aperçu).
 * Le vendeur figure en en-tête uniquement ; le fournisseur est le destinataire.
 */
import { formatDateFr } from "../core/format";
import { computePurchaseTotals } from "../core/purchaseOrders";
import { PO_STATUS_LABELS, type Company, type PurchaseOrder } from "../core/types";
import { formatCents } from "../store/store";

export function PurchaseOrderSheet({ po, company }: { po: PurchaseOrder; company: Company }) {
  const t = computePurchaseTotals(po.lines, po.devise);
  const fournisseur = po.supplierSnapshot;
  const adresse = (x: { adresse?: string; commune?: string; wilaya?: string }) =>
    [x.adresse, x.commune, x.wilaya].filter(Boolean).join(", ");
  return (
    <div className="a4-sheet purchase-sheet" style={{ fontSize: 12 }}>
      <div className="doc-header" style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{company.raisonSociale}</div>
          <div>{adresse(company)}</div>
          <div>
            {company.nif ? `NIF : ${company.nif}` : ""} {company.rc ? `· RC : ${company.rc}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>BON DE COMMANDE</div>
          <div>N° {po.number ?? "(brouillon)"}</div>
          <div>Date : {formatDateFr(po.date)}</div>
          {po.dateLivraison && <div>Livraison souhaitée : {formatDateFr(po.dateLivraison)}</div>}
        </div>
      </div>

      <div style={{ border: "1px solid #999", padding: 8, margin: "10px 0", minHeight: 60 }}>
        <div style={{ fontWeight: 700 }}>Fournisseur</div>
        <div style={{ fontWeight: 600 }}>{fournisseur.displayName}</div>
        <div>{adresse(fournisseur)}</div>
        <div>
          {fournisseur.nif ? `NIF : ${fournisseur.nif}` : ""} {fournisseur.rc ? `· RC : ${fournisseur.rc}` : ""}
        </div>
      </div>

      <table className="invoice-lines" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Réf.</th>
            <th style={{ textAlign: "left" }}>Désignation</th>
            <th>Qté</th>
            <th>Unité</th>
            <th style={{ textAlign: "right" }}>P.U. HT</th>
            <th>Remise</th>
            <th>TVA</th>
            <th style={{ textAlign: "right" }}>Total HT</th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((l, i) => (
            <tr key={l.id}>
              <td>{l.productRef ?? ""}</td>
              <td>{l.designation}</td>
              <td style={{ textAlign: "center" }}>{l.qty}</td>
              <td style={{ textAlign: "center" }}>{l.unite}</td>
              <td style={{ textAlign: "right" }}>{formatCents(l.puHtCents, po.devise)}</td>
              <td style={{ textAlign: "center" }}>{l.remisePct ? `${l.remisePct} %` : ""}</td>
              <td style={{ textAlign: "center" }}>{l.taxRatePctSnapshot} %</td>
              <td style={{ textAlign: "right" }}>{formatCents(t.lineHtCents[i], po.devise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, gap: 16 }}>
        <div style={{ flex: 1 }}>
          {po.conditionsPaiement && <div>Conditions de paiement : {po.conditionsPaiement}</div>}
          {po.modePaiement && <div>Mode de paiement : {po.modePaiement}</div>}
          {po.lieuLivraison && <div>Lieu de livraison : {po.lieuLivraison}</div>}
          {po.observations && <div style={{ whiteSpace: "pre-line" }}>Observations : {po.observations}</div>}
          <div style={{ marginTop: 6, fontStyle: "italic" }}>{t.amountInWords}</div>
        </div>
        <table style={{ borderCollapse: "collapse", minWidth: 240 }}>
          <tbody>
            <tr><td>Total HT</td><td style={{ textAlign: "right" }}>{formatCents(t.totalHtCents, po.devise)}</td></tr>
            <tr><td>TVA</td><td style={{ textAlign: "right" }}>{formatCents(t.totalTvaCents, po.devise)}</td></tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Total TTC</td>
              <td style={{ textAlign: "right" }}>{formatCents(t.totalTtcCents, po.devise)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40 }}>
        <div>Statut : {PO_STATUS_LABELS[po.status]}</div>
        <div style={{ textAlign: "center", width: 220 }}>
          <div>Pour {company.raisonSociale}</div>
          <div style={{ height: 56 }} />
          <div>Signature et cachet</div>
        </div>
      </div>
    </div>
  );
}
