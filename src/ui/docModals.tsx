/** Modales partagées : encaissement (§19) et annulation (§21). */

import { useState } from "react";
import { formatDateFr, todayISO } from "../core/format";
import { parseAmountFr } from "../core/money";
import { currencySymbol } from "../core/currency";
import { MODES_PAIEMENT, type InvoiceDoc } from "../core/types";
import { formatCents, store } from "../store/store";
import { Alert, Btn, Field, Modal } from "./components";

export function PaymentModal({ doc, onClose }: { doc: InvoiceDoc; onClose: () => void }) {
  const remaining = store.remainingCents(doc);
  const [mode, setMode] = useState<string>("Virement bancaire");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState((remaining / 100).toFixed(2));
  const [reference, setReference] = useState("");
  const [banque, setBanque] = useState("");
  const [numeroCheque, setNumeroCheque] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const [error, setError] = useState("");

  function submit() {
    try {
      const cents = parseAmountFr(amount);
      store.addPayment({
        invoiceId: doc.id,
        mode,
        date,
        amountCents: cents,
        reference: reference || undefined,
        banque: banque || undefined,
        numeroCheque: numeroCheque || undefined,
        commentaire: commentaire || undefined,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal
      title={`Enregistrer un paiement — ${doc.number ?? "(brouillon)"}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
          <Btn variant="success" onClick={submit}>Enregistrer le paiement</Btn>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Alert tone="info">
        Total TTC : <b>{formatCents(doc.totalTtcCents, doc.devise)}</b> — déjà payé :{" "}
        <b>{formatCents(store.paidCents(doc), doc.devise)}</b> — reste à payer : <b>{formatCents(remaining, doc.devise)}</b>
      </Alert>
      <div className="form-grid">
        <Field label="Mode de paiement" required>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES_PAIEMENT.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Date de paiement" required>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={`Montant (${currencySymbol(store.data.company.devise)})`} required>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Référence du paiement">
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° de virement, quittance…" />
        </Field>
        <Field label="Banque">
          <input value={banque} onChange={(e) => setBanque(e.target.value)} />
        </Field>
        <Field label="Numéro de chèque">
          <input value={numeroCheque} onChange={(e) => setNumeroCheque(e.target.value)} />
        </Field>
        <Field label="Commentaire">
          <input value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function CancelModal({ doc, onClose }: { doc: InvoiceDoc; onClose: () => void }) {
  const [motif, setMotif] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");

  function submit() {
    try {
      if (!confirm) throw new Error("Veuillez confirmer que vous comprenez les conséquences de l'annulation.");
      store.cancelDocument(doc.id, motif);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal
      title={`Annuler ${doc.number ?? "ce document"} (§21)`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Retour</Btn>
          <Btn variant="danger" onClick={submit} disabled={!motif.trim()}>Annuler la facture</Btn>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Alert tone="warning">
        La facture <b>{doc.number}</b> ({formatDateFr(doc.date)}, {formatCents(doc.totalTtcCents, doc.devise)}) ne sera pas
        supprimée : elle sera conservée avec la mention « FACTURE ANNULÉE », son motif et son auteur. Son numéro
        ne sera jamais réutilisé. Si une correction est nécessaire, privilégiez un <b>avoir</b>.
      </Alert>
      <Field label="Motif d'annulation" required>
        <textarea value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex : erreur de prix, commande annulée par le client…" />
      </Field>
      <label className="hrow" style={{ marginTop: 10, cursor: "pointer" }}>
        <input type="checkbox" style={{ width: "auto" }} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        Je confirme l'annulation définitive de cette facture.
      </label>
    </Modal>
  );
}
