/**
 * Éditeur de document (§11 → §18, §25) :
 *  - gauche : formulaire (en-tête, lignes, remises, frais) ;
 *  - droite : aperçu A4 actualisé en temps réel.
 * Après validation, le document est figé (§20) : toute correction passe
 * par l'annulation (§21) ou un avoir (§22).
 */

import { useMemo, useState } from "react";
import { addDaysISO, formatDateFr, todayISO } from "../core/format";
import { computeDocument, computeLine } from "../core/invoiceCalculator";
import { uid } from "../core/ids";
import { formatMoney, fromNumber } from "../core/money";
import { findApplicableTax, pickDefaultTax } from "../core/taxEngine";
import { currencySymbol } from "../core/currency";
import {
  DOC_TYPE_LABELS, MODES_PAIEMENT, UNITES,
  type DocLine, type DocType, type InvoiceDoc,
} from "../core/types";
import { formatCents, store } from "../store/store";
import type { Route } from "../ui/App";
import { Alert, Btn, Card, Field, StatusBadge, useApp } from "../ui/components";
import { InvoiceA4 } from "../ui/InvoiceA4";
import { CancelModal, PaymentModal } from "../ui/docModals";

export function InvoiceEditor({
  docType,
  docId,
  go,
  print,
}: {
  docType: DocType;
  docId?: string;
  go: (r: Route) => void;
  print: (doc: InvoiceDoc, copy?: boolean) => void;
}) {
  const data = useApp();
  const existing = docId ? data.docs.find((d) => d.id === docId) : undefined;
  const [doc, setDoc] = useState<InvoiceDoc | null>(() =>
    existing ? (JSON.parse(JSON.stringify(existing)) as InvoiceDoc) : null
  );
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [showIntl, setShowIntl] = useState(false);
  /* Conditions de vente du devis : affichées sur demande (bouton), présentes si déjà renseignées. */
  const [showConditions, setShowConditions] = useState(() => Boolean(doc?.conditionsVente));

  // Modifier un brouillon exige document.write (§35) : sans ce droit, lecture seule.
  const editable = doc?.status === "BROUILLON" && store.can("document.write");

  const comp = useMemo(
    () => (doc ? computeDocument(doc.lines, doc.globalDiscount, doc.devise) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc?.lines, doc?.globalDiscount]
  );

  /* ---------------- Création d'un nouveau brouillon ---------------- */

  if (!doc || !comp) {
    return <NewDocumentForm docType={docType} go={go} />;
  }

  const patch = (p: Partial<InvoiceDoc>) => setDoc((d) => (d ? { ...d, ...p } : d));
  const patchLine = (id: string, p: Partial<DocLine>) =>
    setDoc((d) =>
      d ? { ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) } : d
    );
  const previewDoc: InvoiceDoc = {
    ...doc,
    totalHtCents: comp.totalHtCents,
    totalTvaCents: comp.totalTvaCents,
    totalOtherTaxesCents: comp.totalOtherTaxesCents,
    totalTtcCents: comp.totalTtcCents,
    vatDetail: comp.vatDetail,
    otherTaxDetail: comp.otherTaxDetail,
    amountInWords: comp.amountInWords,
  };

  function applyProduct(lineId: string, productId: string) {
    if (productId === "FREE") return;
    const p = data.products.find((x) => x.id === productId);
    if (!p) return;
    const tax = findApplicableTax(data.taxRates, p.taxCodeDefaut, doc!.date) ?? pickDefaultTax(data.taxRates, data.company.taxCodeDefaut, doc!.date)!;
    patchLine(lineId, {
      productRef: p.reference,
      designation: p.designation,
      description: p.description,
      unite: p.unite,
      puHtCents: p.puHtCents,
      taxCode: tax.code,
      taxRatePctSnapshot: tax.ratePct,
      taxLibelleSnapshot: tax.libelle,
      taxKindSnapshot: tax.kind ?? "TVA",
    });
  }

  function addLine(nature: DocLine["nature"]) {
    const tax = pickDefaultTax(data.taxRates, data.company.taxCodeDefaut, doc!.date)!;
    patch({
      lines: [
        ...doc!.lines,
        {
          id: uid("ln"),
          nature,
          designation: nature === "FRAIS" ? "Frais de transport" : "",
          qty: 1,
          unite: nature === "FRAIS" ? "forfait" : "unité",
          puHtCents: 0,
          taxCode: tax.code,
          taxRatePctSnapshot: tax.ratePct,
          taxLibelleSnapshot: tax.libelle,
          taxKindSnapshot: tax.kind ?? "TVA",
        },
      ],
    });
  }

  function saveAndResync(): InvoiceDoc {
    const c = comp!; // non-null garanti : fonctions créées après le garde-fou
    const next: InvoiceDoc = {
      ...doc!,
      totalHtCents: c.totalHtCents,
      totalTvaCents: c.totalTvaCents,
      totalOtherTaxesCents: c.totalOtherTaxesCents,
      totalTtcCents: c.totalTtcCents,
      vatDetail: c.vatDetail,
      otherTaxDetail: c.otherTaxDetail,
      amountInWords: c.amountInWords,
    };
    store.updateDraft(next);
    const resync = JSON.parse(
      JSON.stringify(store.data.docs.find((d) => d.id === doc!.id)!)
    ) as InvoiceDoc;
    setDoc(resync);
    return resync;
  }

  function save() {
    try {
      setError("");
      saveAndResync();
      setInfo("Brouillon enregistré.");
      setTimeout(() => setInfo(""), 3000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function validate() {
    try {
      setError("");
      saveAndResync();
      const validated = store.validateDocument(doc!.id);
      setDoc(JSON.parse(JSON.stringify(store.data.docs.find((d) => d.id === validated.id)!)));
      setInfo(`Document validé : numéro ${validated.number} attribué de façon définitive (§12). Le contenu est désormais figé (§20).`);
    } catch (e) {
      setError((e as Error).message);
      store.techLog("ERROR", "Échec de validation : " + (e as Error).message);
    }
  }

  // Devis : liens entre versions (révision d'origine, révisions validées, brouillon en cours).
  const isDevis = doc.docType === "DEV";
  const revisions = isDevis && doc.number ? store.revisionsOf(doc.number).filter((r) => r.id !== doc.id) : [];
  const openRevision = isDevis && doc.number ? store.findOpenRevision(doc.number) : undefined;
  const openRevisionOfThis = openRevision && openRevision.id !== doc.id ? openRevision : undefined;

  const readOnlyBanner = !editable && (doc.status === "BROUILLON" ? (
    <Alert tone="info">
      Brouillon en lecture seule : votre rôle ne permet pas de le modifier (§35).
    </Alert>
  ) : (
    <Alert tone="info">
      Document <b>{doc.number}</b> — statut « {doc.status} ». Le contenu est juridiquement figé (§20) :
      pour corriger, utilisez {doc.docType === "FAC"
        ? "l'annulation ou un avoir"
        : isDevis ? "le bouton « Réviser » (nouvelle version liée, numéro propre)" : "la duplication vers un nouveau document"}.
    </Alert>
  ));

  const revisionBanners = isDevis && (
    <>
      {editable && doc.originDocNumber && (
        <Alert tone="info">
          Révision du devis <b>{doc.originDocNumber}</b>. Le devis d'origine ne sera pas modifié ; celui-ci recevra un nouveau numéro à la validation.
        </Alert>
      )}
      {!editable && revisions.length > 0 && (
        <Alert tone="info">
          Révisions de ce devis : {revisions.map((r) => <b key={r.id} style={{ marginRight: 8 }}>{r.number}</b>)}
        </Alert>
      )}
      {openRevisionOfThis && (
        <Alert tone="warning">
          Une révision est en cours de préparation (brouillon).{" "}
          <Btn small variant="ghost" onClick={() => go({ name: "editor", docType, docId: openRevisionOfThis.id })}>
            Ouvrir le brouillon de révision
          </Btn>
        </Alert>
      )}
    </>
  );

  return (
    <div className="editor-layout">
      {/* ================= FORMULAIRE ================= */}
      <div className="editor-form">
        {error && <Alert tone="error">{error}</Alert>}
        {info && <Alert tone="success">{info}</Alert>}
        {readOnlyBanner}
        {revisionBanners}

        {/* Actions document */}
        <Card
          title={`${DOC_TYPE_LABELS[doc.docType]} — ${doc.number ?? "brouillon"}`}
          actions={<StatusBadge status={doc.status} />}
        >
          <div className="hrow">
            {editable && (
              <>
                <Btn need="document.write" onClick={save}>Enregistrer le brouillon</Btn>
                <Btn need="document.validate" variant="success" onClick={validate}>✔ Valider (attribuer un numéro)</Btn>
              </>
            )}
            <Btn onClick={() => print(previewDoc)}>PDF / Imprimer</Btn>
            <Btn variant="ghost" onClick={() => print(previewDoc, true)}>Imprimer copie</Btn>
            {isDevis && doc.number && doc.status !== "ANNULEE" && (
              <Btn
                need="document.write"
                variant="primary"
                title="Créer une nouvelle version du devis : l'original reste intact (§20)"
                onClick={() => {
                  try {
                    const r = openRevision ?? store.reviseDocument(doc.id);
                    go({ name: "editor", docType: doc.docType, docId: r.id });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {openRevision && openRevision.id === doc.id ? "Révision en cours" : "Réviser ce devis"}
              </Btn>
            )}
            {!editable && (
              <Btn
                need="document.write"
                variant="ghost"
                title="Dupliquer : nouveau brouillon, nouvelle date, nouveau numéro (§46)"
                onClick={() => {
                  const c = store.duplicateDocument(doc.id);
                  go({ name: "editor", docType: doc.docType, docId: c.id });
                }}
              >
                Dupliquer
              </Btn>
            )}
            {!editable && doc.docType === "FAC" && doc.status !== "ANNULEE" && (
              <>
                {store.remainingCents(doc) > 0 && <Btn need="payment.write" variant="ghost" onClick={() => setPayOpen(true)}>Encaisser un paiement</Btn>}
                {doc.status === "VALIDEE" && (
                  <>
                    <Btn need="document.cancel" variant="ghost" onClick={() => setCancelOpen(true)}>Annuler la facture</Btn>
                    <Btn
                      need="document.cancel"
                      variant="ghost"
                      onClick={() => {
                        const a = store.createCreditNote(doc.id);
                        go({ name: "editor", docType: "AVOIR", docId: a.id });
                      }}
                    >
                      Créer un avoir (§22)
                    </Btn>
                    <Btn need="document.write" variant="ghost" onClick={() => store.setDocStatus(doc.id, "ENVOYEE")}>Marquer envoyée</Btn>
                  </>
                )}
              </>
            )}
            {!editable && ["DEV", "PRO", "BL"].includes(doc.docType) && (
              <>
                <Btn
                  variant="primary"
                  onClick={() => {
                    const fac = store.convertToInvoice(doc.id);
                    go({ name: "editor", docType: "FAC", docId: fac.id });
                  }}
                >
                  Convertir en facture (§57-59)
                </Btn>
                {doc.docType === "DEV" && (
                  <>
                    <Btn need="document.write" variant="ghost" onClick={() => store.setDocStatus(doc.id, "ACCEPTE")}>Accepté</Btn>
                    <Btn need="document.write" variant="ghost" onClick={() => store.setDocStatus(doc.id, "REFUSE")}>Refusé</Btn>
                    <Btn need="document.write" variant="ghost" onClick={() => store.setDocStatus(doc.id, "EXPIRE")}>Expiré</Btn>
                  </>
                )}
              </>
            )}
          </div>
        </Card>

        {/* En-tête */}
        <Card title="En-tête du document (§11)">
          <div className="form-grid">
            <Field label="Client" required>
              <select
                value={doc.customerId}
                disabled={!editable}
                onChange={(e) => patch({ customerId: e.target.value })}
              >
                {data.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.type === "ENTREPRISE" ? c.denomination : `${c.prenom ?? ""} ${c.nom ?? ""}`}
                    {c.demo ? " (démo)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date" required>
              <input type="date" value={doc.date} disabled={!editable} onChange={(e) => patch({ date: e.target.value })} />
            </Field>
            <Field label="Date d'échéance">
              <div className="hrow">
                <input type="date" value={doc.dateEcheance ?? ""} disabled={!editable} onChange={(e) => patch({ dateEcheance: e.target.value || undefined })} />
                {editable && (
                  <Btn small variant="ghost" onClick={() => patch({ dateEcheance: addDaysISO(doc.date, data.company.conditionsPaiementDefautJours) })}>
                    +{data.company.conditionsPaiementDefautJours} j
                  </Btn>
                )}
              </div>
            </Field>
            <Field label="Mode de paiement">
              <select value={doc.modePaiement ?? ""} disabled={!editable} onChange={(e) => patch({ modePaiement: e.target.value })}>
                {MODES_PAIEMENT.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Conditions de paiement">
              <input value={doc.conditionsPaiement ?? ""} disabled={!editable} onChange={(e) => patch({ conditionsPaiement: e.target.value })} placeholder="Ex : 30 jours fin de mois" />
            </Field>
            <Field label="Réf. commande client">
              <input value={doc.refCommande ?? ""} disabled={!editable} onChange={(e) => patch({ refCommande: e.target.value })} />
            </Field>
            <Field label="Réf. devis">
              <input value={doc.refDevis ?? ""} disabled={!editable} onChange={(e) => patch({ refDevis: e.target.value })} />
            </Field>
            <Field label="Réf. bon de livraison">
              <input value={doc.refBonLivraison ?? ""} disabled={!editable} onChange={(e) => patch({ refBonLivraison: e.target.value })} />
            </Field>
            {doc.originDocNumber && (
              <div className="span2">
                <Alert tone="info">Référence le document d'origine <b>{doc.originDocNumber}</b> — celui-ci n'est jamais modifié (§22).</Alert>
              </div>
            )}
            <div className="span2">
              <Field label="Observations">
                <textarea value={doc.observations ?? ""} disabled={!editable} onChange={(e) => patch({ observations: e.target.value })} />
              </Field>
            </div>
            {doc.docType === "DEV" && (
              <div className="span2">
                {showConditions || doc.conditionsVente ? (
                  <Field label="Conditions de vente (facultatif, imprimées sur le devis)">
                    <textarea
                      value={doc.conditionsVente ?? ""}
                      disabled={!editable}
                      placeholder="Ex. : validité du devis 30 jours ; délai de livraison 15 jours ; garantie 12 mois…"
                      onChange={(e) => patch({ conditionsVente: e.target.value || undefined })}
                    />
                    {editable && (
                      <div style={{ marginTop: 6 }}>
                        <Btn small variant="ghost" onClick={() => { patch({ conditionsVente: undefined }); setShowConditions(false); }}>
                          Retirer les conditions de vente
                        </Btn>
                      </div>
                    )}
                  </Field>
                ) : (
                  editable && (
                    <Btn small variant="ghost" onClick={() => setShowConditions(true)}>
                      + Ajouter les conditions de vente
                    </Btn>
                  )
                )}
              </div>
            )}
          </div>
          <div style={{ marginTop: 8 }}>
            <Btn small variant="ghost" onClick={() => setShowIntl((v) => !v)}>
              {showIntl ? "▾" : "▸"} Commerce international — optionnel (§41)
            </Btn>
            {showIntl && (
              <div className="form-grid" style={{ marginTop: 8 }}>
                <Field label="Incoterm"><input value={doc.incoterm ?? ""} disabled={!editable} onChange={(e) => patch({ incoterm: e.target.value })} /></Field>
                <Field label="Pays d'origine"><input value={doc.paysOrigine ?? ""} disabled={!editable} onChange={(e) => patch({ paysOrigine: e.target.value })} /></Field>
                <Field label="Devise / taux de change"><input value={doc.tauxChange ?? ""} disabled={!editable} onChange={(e) => patch({ tauxChange: e.target.value })} placeholder="Ex : 1 EUR = 145,20 DZD" /></Field>
                <Field label="Référence douanière"><input value={doc.refDouaniere ?? ""} disabled={!editable} onChange={(e) => patch({ refDouaniere: e.target.value })} /></Field>
              </div>
            )}
          </div>
        </Card>

        {/* Lignes */}
        <Card
          title="Lignes du document (§13)"
          actions={
            editable && (
              <>
                <Btn small onClick={() => addLine("VENTE")}>+ Ligne</Btn>
                <Btn small variant="ghost" onClick={() => addLine("FRAIS")} title="Transport, emballage, frais divers (§18)">
                  + Ligne de frais
                </Btn>
              </>
            )
          }
        >
          {doc.lines.length === 0 && <div className="empty-state">Ajoutez au moins une ligne avant la validation (§48).</div>}
          {doc.lines.map((l, idx) => {
            const calc = computeLine(l);
            return (
              <div key={l.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 8, background: l.nature === "FRAIS" ? "#fafbfd" : "#fff" }}>
                <div className="hrow" style={{ justifyContent: "space-between" }}>
                  <b className="small muted">Ligne {idx + 1} {l.nature === "FRAIS" && <span className="badge badge-gray">FRAIS (§18)</span>}</b>
                  {editable && (
                    <Btn small variant="ghost" onClick={() => patch({ lines: doc.lines.filter((x) => x.id !== l.id) })}>
                      Retirer
                    </Btn>
                  )}
                </div>
                <div className="form-grid form-grid-3" style={{ marginTop: 6 }}>
                  <Field label="Produit du catalogue">
                    <select
                      value="FREE"
                      disabled={!editable}
                      onChange={(e) => applyProduct(l.id, e.target.value)}
                    >
                      <option value="FREE">— Ligne libre (§9) —</option>
                      {data.products.filter((p) => p.actif).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.reference} · {p.designation}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="span2">
                    <Field label="Désignation" required>
                      <input value={l.designation} disabled={!editable} onChange={(e) => patchLine(l.id, { designation: e.target.value })} />
                    </Field>
                  </div>
                  <div className="span3">
                    <Field label="Description (facultative)">
                      <input value={l.description ?? ""} disabled={!editable} onChange={(e) => patchLine(l.id, { description: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Quantité">
                    <input type="number" min={0} step="0.001" value={l.qty} disabled={!editable}
                      onChange={(e) => patchLine(l.id, { qty: Number(e.target.value) })} />
                  </Field>
                  <Field label="Unité">
                    <select value={l.unite} disabled={!editable} onChange={(e) => patchLine(l.id, { unite: e.target.value })}>
                      {UNITES.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`PU HT (${currencySymbol(doc.devise)})`}>
                    <input type="number" min={0} step="0.01" value={(l.puHtCents / 100).toFixed(2)} disabled={!editable}
                      onChange={(e) => patchLine(l.id, { puHtCents: fromNumber(Number(e.target.value) || 0) })} />
                  </Field>
                  <Field label="Remise %">
                    <input type="number" min={0} max={100} step="0.01" value={l.remisePct ?? 0} disabled={!editable}
                      onChange={(e) => patchLine(l.id, { remisePct: Number(e.target.value) || 0 })} />
                  </Field>
                  <Field label="Taxe (TVA / autre — §10)">
                    <select
                      value={l.taxCode}
                      disabled={!editable}
                      onChange={(e) => {
                        const tax = data.taxRates.find((t) => t.code === e.target.value);
                        if (tax) {
                          patchLine(l.id, {
                            taxCode: tax.code,
                            taxRatePctSnapshot: tax.ratePct, // snapshot §10
                            taxLibelleSnapshot: tax.libelle,
                            taxKindSnapshot: tax.kind ?? "TVA",
                          });
                        }
                      }}
                    >
                      {data.taxRates.filter((t) => t.actif).map((t) => (
                        <option key={t.id} value={t.code}>
                          {t.libelle}{t.kind === "AUTRE" ? " (autre taxe)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {l.taxRatePctSnapshot === 0 && (
                    <Field label="Motif d'exonération (§10)">
                      <input value={l.motifExoneration ?? ""} disabled={!editable}
                        onChange={(e) => patchLine(l.id, { motifExoneration: e.target.value })}
                        placeholder="Ex : art. 000 CGI — exportation" />
                    </Field>
                  )}
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  HT ligne : <b>{formatCents(calc.htCents, doc?.devise)}</b> — TVA ({l.taxRatePctSnapshot} %) :{" "}
                  <b>{formatCents(calc.tvaCents, doc?.devise)}</b> — TTC ligne : <b>{formatCents(calc.ttcCents, doc?.devise)}</b>
                  {calc.remiseCents > 0 && <> — remise : {formatCents(calc.remiseCents, doc?.devise)}</>}
                </div>
              </div>
            );
          })}
        </Card>

        {/* Remise globale + totaux */}
        <Card title="Remise globale et totaux (§15, §17)">
          {editable && (
            <div className="hrow" style={{ marginBottom: 10 }}>
              <span className="small muted">Remise globale :</span>
              <select
                value={doc.globalDiscount?.kind ?? "PCT"}
                style={{ width: "auto" }}
                onChange={(e) =>
                  patch({
                    globalDiscount: doc.globalDiscount
                      ? { ...doc.globalDiscount, kind: e.target.value as "PCT" | "AMT" }
                      : { kind: "PCT", value: 0 },
                  })
                }
              >
                <option value="PCT">%</option>
                <option value="AMT">{currencySymbol(doc.devise)}</option>
              </select>
              <input
                type="number" min={0} step="0.01" style={{ width: 120 }}
                value={doc.globalDiscount ? (doc.globalDiscount.kind === "AMT" ? doc.globalDiscount.value / 100 : doc.globalDiscount.value) : 0}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  patch({
                    globalDiscount: v > 0
                      ? { kind: doc.globalDiscount?.kind ?? "PCT", value: doc.globalDiscount?.kind === "AMT" ? fromNumber(v) : v }
                      : undefined,
                  });
                }}
              />
              <span className="small muted">— répartie proportionnellement sur les lignes.</span>
            </div>
          )}
          <div className="totals-panel">
            <div className="row"><span>Sous-total HT</span><b>{formatCents(comp.subtotalHtCents, doc?.devise)}</b></div>
            {comp.globalDiscountCents > 0 && (
              <div className="row"><span>Remise globale</span><b>− {formatCents(comp.globalDiscountCents, doc?.devise)}</b></div>
            )}
            <div className="row"><span>Total HT</span><b>{formatCents(comp.totalHtCents, doc?.devise)}</b></div>
            {comp.vatDetail.map((v) => (
              <div className="row" key={`tva-${v.ratePct}`}>
                <span>{v.ratePct === 0 ? "Exonéré" : v.libelle}</span>
                <b>{formatCents(v.amountCents, doc?.devise)}</b>
              </div>
            ))}
            {comp.otherTaxDetail.map((v) => (
              <div className="row" key={`autre-${v.ratePct}-${v.libelle}`}>
                <span>{v.libelle}</span>
                <b>{formatCents(v.amountCents, doc?.devise)}</b>
              </div>
            ))}
            <div className="row grand"><span>TOTAL TTC</span><span>{formatCents(comp.totalTtcCents, doc?.devise)}</span></div>
            <div className="words-line">
              Arrêté à la somme de : <b>{comp.amountInWords}</b> (calcul automatique, non modifiable — §16)
            </div>
          </div>
        </Card>

        {/* ================= PIÈCES JOINTES (§61) ================= */}
        <AttachmentsPanel doc={doc} onChanged={(next) => setDoc(next)} />
      </div>

      {/* ================= APERÇU TEMPS RÉEL (§25) ================= */}
      <div>
        <div className="a4-viewport" style={{ position: "sticky", top: 0 }}>
          <div className="hrow" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <b className="small muted">APERÇU EN TEMPS RÉEL — A4 portrait (§23, §25)</b>
            <Btn small onClick={() => print(previewDoc)}>Imprimer / PDF</Btn>
          </div>
          {/* Aperçu multi-pages : la feuille complète est déroulable (O-10) ;
              le PDF natif reste paginé automatiquement (§23). */}
          <div className="a4-scale-wrap" style={{ maxHeight: "72vh", overflowY: "auto", width: "100%" }}>
            <div style={{ zoom: 0.62, width: 794 }}>
              <InvoiceA4 doc={previewDoc} company={data.company} />
            </div>
          </div>
        </div>
      </div>

      {payOpen && <PaymentModal doc={doc} onClose={() => setPayOpen(false)} />}
      {cancelOpen && <CancelModal doc={doc} onClose={() => setCancelOpen(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pièces jointes (§61)                                                */
/* ------------------------------------------------------------------ */

const ATTACHMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

function AttachmentsPanel({
  doc,
  onChanged,
}: {
  doc: InvoiceDoc;
  onChanged: (next: InvoiceDoc) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attachments = doc.attachments ?? [];

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("Pièce jointe trop volumineuse (maximum : 20 Mo).");
      return;
    }
    if (!ATTACHMENT_TYPES.includes(file.type) && !/\.(pdf|png|jpe?g|webp|txt|csv|xlsx)$/i.test(file.name)) {
      setError("Type de fichier non autorisé (PDF, images, texte, CSV, XLSX).");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Lecture du fichier impossible."));
        r.readAsDataURL(file);
      });
      await store.addAttachment(doc.id, {
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type || undefined,
        dataUrl,
      });
      const fresh = store.data.docs.find((d) => d.id === doc.id);
      if (fresh) onChanged(JSON.parse(JSON.stringify(fresh)) as InvoiceDoc);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    setError("");
    await store.removeAttachment(doc.id, id);
    const fresh = store.data.docs.find((d) => d.id === doc.id);
    if (fresh) onChanged(JSON.parse(JSON.stringify(fresh)) as InvoiceDoc);
  }

  return (
    <Card title="Pièces jointes (§61)">
      {error && <Alert tone="error">{error}</Alert>}
      {doc.status === "ANNULEE" && (
        <Alert tone="warning">Document annulé : aucune pièce ne peut être ajoutée.</Alert>
      )}
      {attachments.length === 0 ? (
        <p className="muted small">Aucune pièce jointe.</p>
      ) : (
        <table className="table" style={{ marginBottom: 10 }}>
          <thead>
            <tr><th>Fichier</th><th>Taille</th><th>Ajoutée par</th><th /></tr>
          </thead>
          <tbody>
            {attachments.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{(a.sizeBytes / 1024).toFixed(0)} Ko</td>
                <td>{a.addedBy}</td>
                <td style={{ textAlign: "right" }}>
                  {a.dataUrl && (
                    <a href={a.dataUrl} download={a.name} className="btn btn-sm" style={{ marginRight: 6 }}>
                      Télécharger
                    </a>
                  )}
                  {doc.status !== "ANNULEE" && (
                    <Btn small variant="ghost" onClick={() => onRemove(a.id)}>Retirer</Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {doc.status !== "ANNULEE" && (
        <label className="btn btn-sm" style={{ cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Ajout en cours…" : "➕ Ajouter une pièce jointe"}
          <input type="file" hidden onChange={onPick} disabled={busy} />
        </label>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        Les fichiers sont stockés localement dans le dossier « Documents » de l'application ;
        la base de données n'en conserve que la référence.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function NewDocumentForm({ docType, go }: { docType: DocType; go: (r: Route) => void }) {
  const data = useApp();
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? "");
  const [error, setError] = useState("");

  function create() {
    try {
      if (!customerId) throw new Error("Créez d'abord un client (menu Clients).");
      const draft = store.createDraft({ docType, customerId });
      go({ name: "editor", docType, docId: draft.id });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card title={`Nouveau ${DOC_TYPE_LABELS[docType].toLowerCase()} — étape 1/2 : choisir le client`}>
      {error && <Alert tone="error">{error}</Alert>}
      {data.customers.length === 0 ? (
        <div className="empty-state">
          Aucun client. Créez d'abord votre premier client depuis le menu « Clients ».
        </div>
      ) : (
        <div className="form-grid" style={{ maxWidth: 520 }}>
          <Field label="Client" required>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.type === "ENTREPRISE" ? c.denomination : `${c.prenom ?? ""} ${c.nom ?? ""}`}
                </option>
              ))}
            </select>
          </Field>
          <div className="span2">
            <Btn need="document.write" variant="primary" onClick={create}>Créer le brouillon →</Btn>
          </div>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 12 }}>
        Le numéro sera attribué automatiquement à la validation, de façon séquentielle et non réutilisable (§12).
        Aujourd'hui : {formatDateFr(todayISO())}.
      </p>
    </Card>
  );
}
