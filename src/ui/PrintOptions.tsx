/**
 * Options d'impression A4 (§26) : nombre d'exemplaires et mention « COPIE ».
 * Le choix de l'imprimante (et recto/verso, qualité…) se fait ensuite dans la boîte
 * d'impression du système, qui liste toutes les imprimantes installées sur le poste.
 */
import { useState } from "react";
import { Btn, Field, Modal } from "./components";

export interface PrintOptionsResult {
  copies: number;
  copy: boolean;
}

export const MAX_COPIES = 10;

export function PrintOptionsModal({
  titre,
  copyDefault,
  onCancel,
  onPrint,
}: {
  titre: string;
  copyDefault?: boolean;
  onCancel: () => void;
  onPrint: (opts: PrintOptionsResult) => void;
}) {
  const [copies, setCopies] = useState(1);
  const [copy, setCopy] = useState(!!copyDefault);

  function valider() {
    const n = Math.min(MAX_COPIES, Math.max(1, Math.floor(Number(copies) || 1)));
    onPrint({ copies: n, copy });
  }

  return (
    <Modal
      title="Imprimer sur papier A4"
      onClose={onCancel}
      footer={
        <>
          <Btn variant="ghost" onClick={onCancel}>Annuler</Btn>
          <Btn variant="primary" onClick={valider}>Imprimer…</Btn>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        <b>{titre}</b>
      </p>
      <Field label="Nombre d'exemplaires" hint={`De 1 à ${MAX_COPIES}.`}>
        <input
          type="number"
          min={1}
          max={MAX_COPIES}
          step={1}
          value={copies}
          onChange={(e) => setCopies(Number(e.target.value))}
        />
      </Field>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        Marquer « COPIE » sur chaque exemplaire
      </label>
      <p style={{ color: "#374151", fontSize: 13, marginBottom: 0 }}>
        Format : A4 portrait. Après « Imprimer… », choisissez l'imprimante dans la boîte d'impression
        (liste des imprimantes du poste, qualité, recto/verso).
      </p>
    </Modal>
  );
}
