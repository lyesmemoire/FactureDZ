/**
 * Rendu A4 du document (§23) — portrait, 100 % hors ligne.
 * Sert à : l'aperçu temps réel (§25), l'impression (§26), la copie PDF.
 * Sur le poste Windows, le backend Rust régénère ce même document en PDF
 * natif (genpdf) avec le positionnement du cachet et de la signature.
 */

import { computeDocument } from "../core/invoiceCalculator";
import { formatDateFr } from "../core/format";
import { formatDA } from "../core/money";
import { DOC_TYPE_LABELS, type Company, type InvoiceDoc } from "../core/types";

function docTitle(doc: InvoiceDoc): string {
  if (doc.docType === "FAC") return doc.status === "ANNULEE" ? "FACTURE" : "FACTURE";
  if (doc.docType === "AVOIR") return "AVOIR (NOTE DE CRÉDIT)";
  if (doc.docType === "PRO") return "FACTURE PROFORMA";
  if (doc.docType === "DEV") return "DEVIS";
  return "BON DE LIVRAISON";
}

export function InvoiceA4({
  doc,
  company,
  copy,
}: {
  doc: InvoiceDoc;
  company: Company;
  copy?: boolean;
}) {
  const comp = computeDocument(doc.lines, doc.globalDiscount, doc.devise);
  const cancelled = doc.status === "ANNULEE";
  const isProforma = doc.docType === "PRO";

  return (
    <div className="a4-sheet">
      {cancelled && (
        <div className="watermark">
          <span>Facture annulée</span>
        </div>
      )}
      {copy && !cancelled && (
        <div className="watermark copy">
          <span>Copie</span>
        </div>
      )}

      {/* ---------------- VENDEUR (gauche) / TITRE + ACHETEUR (droite) ---------------- */}
      <div className="doc-header">
        <div style={{ flex: 1 }}>
          {company.logoDataUrl && <img className="logo" src={company.logoDataUrl} alt="Logo" />}
          <div className="seller-name">{doc.sellerSnapshot.displayName || "(entreprise non configurée)"}</div>
          <div className="seller-meta">
            {doc.sellerSnapshot.formeJuridique && <>{doc.sellerSnapshot.formeJuridique}</>}
            {doc.sellerSnapshot.formeJuridique && doc.sellerSnapshot.capitalSocial && <> — Capital : {doc.sellerSnapshot.capitalSocial}</>}
            {doc.sellerSnapshot.activite && <><br />Activité : {doc.sellerSnapshot.activite}</>}
            {doc.sellerSnapshot.adresse && (
              <>
                <br />
                {doc.sellerSnapshot.adresse}
                {doc.sellerSnapshot.commune && <>, {doc.sellerSnapshot.commune}</>}
                {doc.sellerSnapshot.wilaya && <> — {doc.sellerSnapshot.wilaya}</>}
              </>
            )}
            {doc.sellerSnapshot.telephone && <>Tél : {doc.sellerSnapshot.telephone}</>}
            {doc.sellerSnapshot.fax && <> — Fax : {doc.sellerSnapshot.fax}</>}
            {doc.sellerSnapshot.email && <><br />Email : {doc.sellerSnapshot.email}</>}
            <br />
            {doc.sellerSnapshot.rc && <>RC : {doc.sellerSnapshot.rc} — </>}
            {doc.sellerSnapshot.nif && <>NIF : {doc.sellerSnapshot.nif} — </>}
            {doc.sellerSnapshot.nis && <>NIS : {doc.sellerSnapshot.nis}</>}
            {doc.sellerSnapshot.articleImposition && (
              <>
                <br />Article d'imposition : {doc.sellerSnapshot.articleImposition}
              </>
            )}
          </div>
        </div>
        <div className="doc-title-box">
          <h1>{docTitle(doc)}</h1>
          <div className="meta">
            <b>N° :</b> {doc.number ?? "(brouillon)"}
            <br />
            <b>Date :</b> {formatDateFr(doc.date)}
            {doc.dateEcheance && (
              <>
                <br />
                <b>Échéance :</b> {formatDateFr(doc.dateEcheance)}
              </>
            )}
            {doc.originDocNumber && (
              <>
                <br />
                <b>{doc.docType === "DEV" ? "Révision du devis :" : "Réf. facture d'origine :"}</b> {doc.originDocNumber}
              </>
            )}
            {doc.refCommande && (
              <>
                <br />
                <b>Réf. commande :</b> {doc.refCommande}
              </>
            )}
          </div>
        </div>
        <div className="party-box" style={{ marginTop: 10, textAlign: "left" }}>
          <div className="party-tag">{doc.buyerSnapshot.type === "PARTICULIER" ? "Client (consommateur)" : "Client"}</div>
          <div className="p-name">{doc.buyerSnapshot.displayName}</div>
          <div className="p-meta">
            {doc.buyerSnapshot.formeJuridique && <>{doc.buyerSnapshot.formeJuridique}<br /></>}
            {doc.buyerSnapshot.activite && <>Activité : {doc.buyerSnapshot.activite}<br /></>}
            {doc.buyerSnapshot.adresse && (
              <>
                {doc.buyerSnapshot.adresse}
                {doc.buyerSnapshot.commune && <>, {doc.buyerSnapshot.commune}</>}
                <br />
              </>
            )}
            {doc.buyerSnapshot.telephone && <>Tél : {doc.buyerSnapshot.telephone}<br /></>}
            {doc.buyerSnapshot.email && <>Email : {doc.buyerSnapshot.email}<br /></>}
            {doc.buyerSnapshot.rc && <>RC : {doc.buyerSnapshot.rc}<br /></>}
            {doc.buyerSnapshot.nif && <>NIF : {doc.buyerSnapshot.nif}<br /></>}
            {doc.buyerSnapshot.nis && <>NIS : {doc.buyerSnapshot.nis}<br /></>}
            {doc.buyerSnapshot.articleImposition && <>AI : {doc.buyerSnapshot.articleImposition}</>}
          </div>
        </div>
      </div>

      {cancelled && doc.cancellation && (
        <div className="cancel-note">
          <b>FACTURE ANNULÉE</b> le {formatDateFr(doc.cancellation.at)} par {doc.cancellation.by}. Motif :{" "}
          {doc.cancellation.motif}. Ce numéro ne sera jamais réutilisé.
        </div>
      )}
      {isProforma && (
        <div className="cancel-note" style={{ background: "#eff6ff", borderColor: "#c9dbf8", color: "#1e3a8a" }}>
          Document proforma : ne constitue pas une facture définitive et n'ouvre pas droit à déduction.
        </div>
      )}

      {/* ---------------- LIGNES (zone centrée verticalement entre en-tête et totaux) ---------------- */}
      <div className="lines-zone">
        <table className="invoice-lines">
          <thead>
            <tr>
              <th style={{ width: 26 }}>N°</th>
              <th style={{ width: 80 }}>Référence</th>
              <th>Désignation</th>
              <th className="num" style={{ width: 52 }}>Qté</th>
              <th style={{ width: 52 }}>Unité</th>
              <th className="num" style={{ width: 86 }}>PU HT</th>
              <th className="num" style={{ width: 56 }}>Remise</th>
              <th className="num" style={{ width: 56 }}>TVA</th>
              <th className="num" style={{ width: 90 }}>Total HT</th>
            </tr>
          </thead>
          <tbody>
            {comp.lines.map((l, i) => (
              <tr key={l.id} className={l.nature === "FRAIS" ? "fee-line" : undefined}>
                <td>{i + 1}</td>
                <td className="mono">{l.productRef ?? "—"}</td>
                <td>
                  <b>{l.designation}</b>
                  {l.description && (
                    <>
                      <br />
                      <span style={{ color: "#6b7280" }}>{l.description}</span>
                    </>
                  )}
                  {l.taxRatePctSnapshot === 0 && l.motifExoneration && (
                    <>
                      <br />
                      <span style={{ color: "#6b7280" }}>Exonération : {l.motifExoneration}</span>
                    </>
                  )}
                </td>
                <td className="num">{l.qty}</td>
                <td>{l.unite}</td>
                <td className="num">{formatDA(l.puHtCents, doc.devise)}</td>
                <td className="num">{l.remisePct ? `${l.remisePct} %` : "—"}</td>
                <td className="num">{l.taxRatePctSnapshot} %</td>
                <td className="num">{formatDA(comp.finalLineHtCents[i], doc.devise)}</td>
              </tr>
            ))}
            {comp.lines.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "#9ca3af", padding: 18 }}>
                  Aucune ligne
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------- TOTAUX ---------------- */}
      <div className="totals-zone">
        <table className="totals-table">
          <tbody>
            <tr>
              <td>TOTAL HT</td>
              <td>
                {comp.globalDiscountCents > 0 ? (
                  <>
                    <span style={{ textDecoration: "line-through", color: "#9ca3af", marginRight: 8 }}>
                      {formatDA(comp.subtotalHtCents, doc.devise)}
                    </span>
                    {formatDA(comp.totalHtCents, doc.devise)}
                  </>
                ) : (
                  formatDA(comp.totalHtCents, doc.devise)
                )}
              </td>
            </tr>
            {comp.globalDiscountCents > 0 && (
              <tr>
                <td>Remise globale</td>
                <td>− {formatDA(comp.globalDiscountCents, doc.devise)}</td>
              </tr>
            )}
            {comp.vatDetail.map((v) => (
              <tr key={`tva-${v.ratePct}`}>
                <td>
                  {v.ratePct === 0 ? "Exonéré (TVA 0 %)" : `TVA ${v.ratePct} % (base ${formatDA(v.baseCents, doc.devise)})`}
                </td>
                <td>{formatDA(v.amountCents, doc.devise)}</td>
              </tr>
            ))}
            {comp.otherTaxDetail.map((v) => (
              <tr key={`autre-${v.ratePct}-${v.libelle}`}>
                <td>{`${v.libelle} (base ${formatDA(v.baseCents, doc.devise)})`}</td>
                <td>{formatDA(v.amountCents, doc.devise)}</td>
              </tr>
            ))}
            <tr className="grand">
              <td>TOTAL TTC</td>
              <td>{formatDA(comp.totalTtcCents, doc.devise)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---------------- MONTANT EN LETTRES (§16) ---------------- */}
      <div className="amount-words">
        Arrêté {doc.docType === "AVOIR" ? "le présent avoir" : "la présente facture"} à la somme de :
        <br />
        <b>{comp.amountInWords}</b>
      </div>

      {/* ---------------- PIED : CONDITIONS, BANQUE, CACHET ---------------- */}
      <div className="doc-footer-info">
        <div className="block">
          {doc.conditionsPaiement && (
            <>
              <h4>Conditions de paiement</h4>
              <div>
                {doc.conditionsPaiement}
                {doc.modePaiement && <> — {doc.modePaiement}</>}
                {doc.dateEcheance && <> — Échéance : {formatDateFr(doc.dateEcheance)}</>}
              </div>
            </>
          )}
          {company.afficherCoordonneesBancaires && (company.banque || company.rib) && (
            <>
              <h4 style={{ marginTop: 8 }}>Coordonnées bancaires</h4>
              <div>
                {company.banque && <>{company.banque}{company.agence ? ` — ${company.agence}` : ""}<br /></>}
                {company.rib && <>RIB : {company.rib}<br /></>}
                {company.ripCcp && <>RIP/CCP : {company.ripCcp}</>}
              </div>
            </>
          )}
          {doc.conditionsVente && (
            <>
              <h4 style={{ marginTop: 8 }}>Conditions de vente</h4>
              <div style={{ whiteSpace: "pre-line" }}>{doc.conditionsVente}</div>
            </>
          )}
          {doc.observations && (
            <>
              <h4 style={{ marginTop: 8 }}>Observations</h4>
              <div>{doc.observations}</div>
            </>
          )}
        </div>
        <div className="block">
          <h4>Informations complémentaires</h4>
          {doc.refDevis && <div>Réf. devis : {doc.refDevis}</div>}
          {doc.refBonLivraison && <div>Réf. bon de livraison : {doc.refBonLivraison}</div>}
          {doc.incoterm && <div>Incoterm : {doc.incoterm}</div>}
          {doc.paysOrigine && <div>Pays d'origine : {doc.paysOrigine}</div>}
          <div>Devise : {doc.devise}</div>
        </div>
      </div>

      <div className="stamp-zone">
        {(company.afficherSignature || !company.signatureDataUrl) && (
          <div className="stamp-slot">
            {company.afficherSignature && company.signatureDataUrl ? (
              <img src={company.signatureDataUrl} alt="Signature" />
            ) : (
              <div style={{ height: 56 }} />
            )}
            <div className="slot-label">Signature</div>
          </div>
        )}
        {(company.afficherCachet || !company.cachetDataUrl) && (
          <div className="stamp-slot">
            {company.afficherCachet && company.cachetDataUrl ? (
              <img src={company.cachetDataUrl} alt="Cachet" />
            ) : (
              <div style={{ height: 56 }} />
            )}
            <div className="slot-label">Cachet de l'entreprise</div>
          </div>
        )}
      </div>

      <div className="a4-legal-footer">
        {doc.sellerSnapshot.displayName}
        {doc.sellerSnapshot.rc && <> — RC : {doc.sellerSnapshot.rc}</>}
        {doc.sellerSnapshot.nif && <> — NIF : {doc.sellerSnapshot.nif}</>}
        {doc.sellerSnapshot.nis && <> — NIS : {doc.sellerSnapshot.nis}</>}
        {doc.sellerSnapshot.articleImposition && <> — AI : {doc.sellerSnapshot.articleImposition}</>}
        <br />
        Document établi conformément au décret exécutif n° 05-468 du 10 décembre 2005 fixant les conditions et modalités
        d'établissement de la facture. {DOC_TYPE_LABELS[doc.docType]} {doc.number ?? ""} — FacturationDZ.
      </div>
    </div>
  );
}
