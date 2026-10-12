/** Paramètres (§6, §8, §10, §55, §74) : entreprise, numérotation, taxes,
 *  règles de validation, sécurité. */

import { useState } from "react";
import { uid } from "../core/ids";
import { todayISO } from "../core/format";
import { renderNumber } from "../core/numbering";
import { LANG_LABELS } from "../core/i18n";
import { MODES_PAIEMENT, ROLE_LABELS, type DocType, type TaxRate } from "../core/types";
import { store } from "../store/store";
import { Alert, Badge, Btn, Card, Field, Modal, readFileAsDataUrl, useApp } from "../ui/components";
import { DEVISES, currencyLabel, isDevise } from "../core/currency";

const TABS = [
  { key: "entreprise", label: "Mon entreprise (§6)" },
  { key: "numerotation", label: "Numérotation (§55)" },
  { key: "taxes", label: "Taxes & TVA (§10, §74)" },
  { key: "validation", label: "Règles de validation (§8)" },
  { key: "securite", label: "Sécurité & sauvegardes (§37)" },
];

export function SettingsScreen({ tab }: { tab?: string }) {
  const [active, setActive] = useState(tab ?? "entreprise");
  return (
    <>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${active === t.key ? "active" : ""}`} onClick={() => setActive(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {active === "entreprise" && <CompanyTab />}
      {active === "numerotation" && <NumberingTab />}
      {active === "taxes" && <TaxesTab />}
      {active === "validation" && <ValidationTab />}
      {active === "securite" && <SecurityTab />}
    </>
  );
}

/* ---------------- Mon entreprise (§6) ---------------- */

function CompanyTab() {
  const data = useApp();
  const [c, setC] = useState({ ...data.company });
  const [saved, setSaved] = useState(false);
  const set = (p: Partial<typeof c>) => setC((x) => ({ ...x, ...p }));

  const imgField = (label: string, key: "logoDataUrl" | "cachetDataUrl" | "signatureDataUrl") => (
    <Field label={label}>
      <div className="hrow">
        {c[key] && <img className="img-thumb" src={c[key]} alt={label} />}
        <input type="file" accept=".png,.jpg,.jpeg,.webp" style={{ width: "auto" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) set({ [key]: await readFileAsDataUrl(f) } as Partial<typeof c>);
          }} />
        {c[key] && <Btn small variant="ghost" onClick={() => set({ [key]: undefined } as Partial<typeof c>)}>Retirer</Btn>}
      </div>
    </Field>
  );

  return (
    <Card title="Mon entreprise (§6) — NIF, NIS, RC et Article d'imposition sont des champs distincts"
      actions={<Btn need="config.manage" variant="primary" onClick={() => { store.updateCompany(c); setSaved(true); setTimeout(() => setSaved(false), 2500); }}>Enregistrer</Btn>}>
      {saved && <Alert tone="success">Paramètres enregistrés. Les futurs documents utiliseront ces informations (les documents déjà validés conservent leur snapshot, §38).</Alert>}
      <div className="form-grid form-grid-3">
        <Field label="Raison sociale / dénomination" required><input value={c.raisonSociale} onChange={(e) => set({ raisonSociale: e.target.value })} /></Field>
        <Field label="Nom commercial"><input value={c.nomCommercial ?? ""} onChange={(e) => set({ nomCommercial: e.target.value })} /></Field>
        <Field label="Forme juridique">
          <select value={c.formeJuridique ?? ""} onChange={(e) => set({ formeJuridique: e.target.value })}>
            <option value="">— Choisir —</option>
            {["EURL", "SARL", "SPA", "SNC", "SCS", "Entreprise individuelle", "Auto-entrepreneur", "Autre"].map((f) => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Activité"><input value={c.activite ?? ""} onChange={(e) => set({ activite: e.target.value })} /></Field>
        <Field label="Adresse complète"><input value={c.adresse ?? ""} onChange={(e) => set({ adresse: e.target.value })} /></Field>
        <Field label="Wilaya"><input value={c.wilaya ?? ""} onChange={(e) => set({ wilaya: e.target.value })} /></Field>
        <Field label="Commune"><input value={c.commune ?? ""} onChange={(e) => set({ commune: e.target.value })} /></Field>
        <Field label="Téléphone"><input value={c.telephone ?? ""} onChange={(e) => set({ telephone: e.target.value })} /></Field>
        <Field label="Fax"><input value={c.fax ?? ""} onChange={(e) => set({ fax: e.target.value })} /></Field>
        <Field label="Email"><input value={c.email ?? ""} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Site web (facultatif)"><input value={c.siteWeb ?? ""} onChange={(e) => set({ siteWeb: e.target.value })} /></Field>
        <Field label="Capital social"><input value={c.capitalSocial ?? ""} onChange={(e) => set({ capitalSocial: e.target.value })} /></Field>
        <Field label="RC"><input value={c.rc ?? ""} onChange={(e) => set({ rc: e.target.value })} /></Field>
        <Field label="NIF"><input value={c.nif ?? ""} onChange={(e) => set({ nif: e.target.value })} /></Field>
        <Field label="NIS"><input value={c.nis ?? ""} onChange={(e) => set({ nis: e.target.value })} /></Field>
        <Field label="Article d'imposition (AI)"><input value={c.articleImposition ?? ""} onChange={(e) => set({ articleImposition: e.target.value })} /></Field>
        <Field label="TIN (libellé international du NIF)" hint="Le TIN n'est pas un identifiant algérien supplémentaire (§6).">
          <input value={c.tinLibelle ?? ""} onChange={(e) => set({ tinLibelle: e.target.value })} placeholder="Ex : NIF (Tax Identification Number)" />
        </Field>
        <Field label="Monnaie" hint="Monnaie par défaut de vos documents. Chaque document conserve la monnaie choisie à sa création.">
          <select value={c.devise} onChange={(e) => set({ devise: e.target.value })}>
            {DEVISES.map((d) => <option key={d} value={d}>{currencyLabel(d)}</option>)}
            {!isDevise(c.devise) && <option value={c.devise}>{c.devise}</option>}
          </select>
        </Field>
        <Field label="Taux de TVA par défaut" hint="Proposé automatiquement sur les nouvelles lignes ; modifiable ligne par ligne.">
          <select value={c.taxCodeDefaut ?? "TVA19"} onChange={(e) => set({ taxCodeDefaut: e.target.value })}>
            {data.taxRates
              .filter((t) => t.actif && t.kind !== "AUTRE")
              .map((t) => <option key={t.code} value={t.code}>{t.libelle}</option>)}
          </select>
        </Field>
        <Field label="Banque"><input value={c.banque ?? ""} onChange={(e) => set({ banque: e.target.value })} /></Field>
        <Field label="Agence"><input value={c.agence ?? ""} onChange={(e) => set({ agence: e.target.value })} /></Field>
        <Field label="RIB"><input value={c.rib ?? ""} onChange={(e) => set({ rib: e.target.value })} /></Field>
        <Field label="RIP / CCP"><input value={c.ripCcp ?? ""} onChange={(e) => set({ ripCcp: e.target.value })} /></Field>
        <Field label="Conditions de paiement par défaut (jours)">
          <input type="number" min={0} value={c.conditionsPaiementDefautJours} onChange={(e) => set({ conditionsPaiementDefautJours: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Mode de paiement par défaut">
          <select value={c.modePaiementDefaut} onChange={(e) => set({ modePaiementDefaut: e.target.value })}>
            {MODES_PAIEMENT.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <div className="span3">
          <div className="form-grid form-grid-3">
            {imgField("Logo (§24)", "logoDataUrl")}
            {imgField("Cachet (§24)", "cachetDataUrl")}
            {imgField("Signature (§24)", "signatureDataUrl")}
          </div>
        </div>
        <div className="span3">
          <b className="small">Affichage sur les documents (§24)</b>
          <div className="hrow" style={{ marginTop: 6 }}>
            <label className="hrow"><input type="checkbox" style={{ width: "auto" }} checked={c.afficherCachet} onChange={(e) => set({ afficherCachet: e.target.checked })} /> Afficher le cachet</label>
            <label className="hrow"><input type="checkbox" style={{ width: "auto" }} checked={c.afficherSignature} onChange={(e) => set({ afficherSignature: e.target.checked })} /> Afficher la signature</label>
            <label className="hrow"><input type="checkbox" style={{ width: "auto" }} checked={c.afficherCoordonneesBancaires} onChange={(e) => set({ afficherCoordonneesBancaires: e.target.checked })} /> Afficher les coordonnées bancaires</label>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Numérotation (§55) ---------------- */

function NumberingTab() {
  const data = useApp();
  const [drafts, setDrafts] = useState(
    data.sequenceConfigs.map((cfg) => ({ ...cfg, templateDraft: cfg.template, paddingDraft: cfg.padding }))
  );
  const [msg, setMsg] = useState("");

  return (
    <Card title="Séries et gabarits de numérotation (§12, §55, §56)">
      <Alert tone="warning">
        Un gabarit modifié ne s'applique qu'aux <b>futurs</b> numéros : les numéros déjà attribués ne sont jamais
        modifiés rétroactivement (§55). Les compteurs ne sont jamais décrémentés, même après annulation (§21).
      </Alert>
      {msg && <Alert tone="success">{msg}</Alert>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Série</th><th>Gabarit</th><th className="num">Chiffres compteur</th><th>Aperçu prochain n°</th><th className="num">Compteur actuel</th><th></th></tr>
          </thead>
          <tbody>
            {drafts.map((cfg) => {
              const year = new Date().getFullYear();
              const counterKey = `${cfg.docType}-${year}`;
              const current = data.sequences[counterKey] ?? 0;
              let preview = "(gabarit invalide)";
              try {
                preview = renderNumber({ docType: cfg.docType, template: cfg.templateDraft, padding: cfg.paddingDraft }, year, current + 1);
              } catch { /* gabarit invalide */ }
              return (
                <tr key={cfg.docType}>
                  <td><Badge tone="blue">{cfg.docType}</Badge></td>
                  <td><input className="mono" value={cfg.templateDraft} onChange={(e) => setDrafts((ds) => ds.map((d) => d.docType === cfg.docType ? { ...d, templateDraft: e.target.value } : d))} /></td>
                  <td className="num"><input type="number" min={3} max={10} style={{ width: 80 }} value={cfg.paddingDraft} onChange={(e) => setDrafts((ds) => ds.map((d) => d.docType === cfg.docType ? { ...d, paddingDraft: Number(e.target.value) || 6 } : d))} /></td>
                  <td className="mono">{preview}</td>
                  <td className="num">{current}</td>
                  <td className="right">
                    <Btn small onClick={() => {
                      try {
                        store.updateSequenceConfig(cfg.docType, cfg.templateDraft, cfg.paddingDraft);
                        setMsg(`Série ${cfg.docType} mise à jour.`);
                        setTimeout(() => setMsg(""), 3000);
                      } catch (e) {
                        setMsg(`⚠ ${(e as Error).message}`);
                        setTimeout(() => setMsg(""), 5000);
                      }
                    }}>Enregistrer</Btn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------------- Taxes (§10, §74) ---------------- */

function TaxesTab() {
  const data = useApp();
  const [editing, setEditing] = useState<TaxRate | null>(null);
  const [isNew, setIsNew] = useState(false);

  return (
    <>
      <Card
        title="Référentiel des taxes (§10) — aucune valeur codée en dur (§73)"
        actions={<Btn need="config.manage" variant="primary" onClick={() => {
          setIsNew(true);
          setEditing({ id: uid("tax"), code: "", libelle: "", ratePct: 0, dateDebut: todayISO(), actif: true, kind: "TVA" });
        }}>+ Nouveau taux</Btn>}
      >
        <Alert tone="info">
          Le taux appliqué à chaque document est <b>snapshoté</b> à la saisie (§10) : modifier un taux ici ne
          changera jamais une ancienne facture. Les modifications réglementaires sont historisées (§74).
          Le type <b>Autre taxe</b> permet les droits et contributions hors TVA (TIC, droits d'enregistrement…) :
          ils s'agrègent séparément dans les totaux (§10).
        </Alert>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Code</th><th>Libellé</th><th>Type</th><th className="num">Taux</th><th>Début</th><th>Fin</th><th>Réf. réglementaire</th><th>Statut</th><th className="right">Actions</th></tr>
            </thead>
            <tbody>
              {data.taxRates.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.code}</td>
                  <td>{t.libelle}</td>
                  <td>{t.kind === "AUTRE" ? <Badge tone="amber">Autre taxe</Badge> : <Badge tone="blue">TVA</Badge>}</td>
                  <td className="num">{t.ratePct} %</td>
                  <td>{t.dateDebut}</td>
                  <td>{t.dateFin ?? "—"}</td>
                  <td className="small">{t.referenceReglementaire ?? "—"}</td>
                  <td>{t.actif ? <Badge tone="green">Actif</Badge> : <Badge tone="gray">Inactif</Badge>}</td>
                  <td className="right"><Btn need="config.manage" small onClick={() => { setIsNew(false); setEditing({ ...t }); }}>Modifier (§74)</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Historique des modifications réglementaires (§74)">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Date</th><th>Taxe</th><th>Ancienne valeur</th><th>Nouvelle valeur</th><th>Date d'effet</th><th>Motif</th><th>Utilisateur</th></tr>
            </thead>
            <tbody>
              {data.taxHistory.map((h) => (
                <tr key={h.id}>
                  <td className="nowrap">{h.ts.slice(0, 10)}</td>
                  <td className="mono">{h.taxCode}</td>
                  <td>{h.oldValue.libelle} ({h.oldValue.ratePct} %)</td>
                  <td>{h.newValue.libelle} ({h.newValue.ratePct} %)</td>
                  <td>{h.dateEffet}</td>
                  <td>{h.motif ?? "—"}</td>
                  <td>{h.utilisateur}</td>
                </tr>
              ))}
              {data.taxHistory.length === 0 && <tr><td colSpan={7} className="empty-state">Aucune modification enregistrée.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && <TaxModal tax={editing} isNew={isNew} onClose={() => setEditing(null)} />}
    </>
  );
}

function TaxModal({ tax, isNew, onClose }: { tax: TaxRate; isNew: boolean; onClose: () => void }) {
  const [t, setT] = useState(tax);
  const [motif, setMotif] = useState("");
  const [dateEffet, setDateEffet] = useState(todayISO());
  const [error, setError] = useState("");
  const set = (p: Partial<TaxRate>) => setT((x) => ({ ...x, ...p }));

  function save() {
    try {
      if (!t.code.trim() || !t.libelle.trim()) throw new Error("Code et libellé sont obligatoires.");
      if (t.ratePct < 0 || t.ratePct > 100) throw new Error("Le taux doit être compris entre 0 et 100.");
      if (isNew) store.addTaxRate(t);
      else {
        if (!motif.trim()) throw new Error("Le motif de la modification réglementaire est obligatoire (§74).");
        store.updateTaxRate(t.id, t, motif, dateEffet);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title={isNew ? "Nouveau taux de taxe (§10)" : `Modification réglementaire — ${tax.code} (§74)`} onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Annuler</Btn><Btn need="config.manage" variant="primary" onClick={save}>Enregistrer</Btn></>}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="form-grid">
        <Field label="Code" required><input value={t.code} disabled={!isNew} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="Ex : TVA19" /></Field>
        <Field label="Libellé" required><input value={t.libelle} onChange={(e) => set({ libelle: e.target.value })} placeholder="Ex : TVA 19 %" /></Field>
        <Field label="Taux (%)" required><input type="number" min={0} max={100} step="0.01" value={t.ratePct} onChange={(e) => set({ ratePct: Number(e.target.value) })} /></Field>
        <Field label="Type de taxe (§10)">
          <select value={t.kind ?? "TVA"} onChange={(e) => set({ kind: e.target.value as TaxRate["kind"] })}>
            <option value="TVA">TVA</option>
            <option value="AUTRE">Autre taxe / droit / contribution</option>
          </select>
        </Field>
        <Field label="Date de début"><input type="date" value={t.dateDebut} onChange={(e) => set({ dateDebut: e.target.value })} /></Field>
        <Field label="Date de fin (éventuelle)"><input type="date" value={t.dateFin ?? ""} onChange={(e) => set({ dateFin: e.target.value || undefined })} /></Field>
        <Field label="Statut">
          <label className="hrow"><input type="checkbox" style={{ width: "auto" }} checked={t.actif} onChange={(e) => set({ actif: e.target.checked })} /> Actif</label>
        </Field>
        <div className="span2"><Field label="Référence réglementaire"><input value={t.referenceReglementaire ?? ""} onChange={(e) => set({ referenceReglementaire: e.target.value })} /></Field></div>
        <div className="span2"><Field label="Description / commentaire"><textarea value={t.description ?? ""} onChange={(e) => set({ description: e.target.value })} /></Field></div>
        {!isNew && (
          <>
            <Field label="Date d'effet (§74)" required><input type="date" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} /></Field>
            <Field label="Motif (§74)" required><input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex : loi de finances 2027" /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- Règles de validation (§8) ---------------- */

function ValidationTab() {
  const data = useApp();
  const [rules, setRules] = useState({ ...data.settings.validation });
  const [saved, setSaved] = useState(false);

  const row = (field: "nif" | "nis" | "rc" | "articleImposition", label: string, patternKey: "nifPattern" | "nisPattern" | "rcPattern" | "aiPattern") => (
    <tr>
      <td><b>{label}</b></td>
      <td>
        <select value={rules[field]} style={{ width: "auto" }}
          onChange={(e) => setRules((r) => ({ ...r, [field]: e.target.value as "OFF" | "WARN" | "BLOCK" }))}>
          <option value="OFF">Désactivée</option>
          <option value="WARN">Avertissement</option>
          <option value="BLOCK">Bloquante</option>
        </select>
      </td>
      <td><input className="mono" value={rules[patternKey]} onChange={(e) => setRules((r) => ({ ...r, [patternKey]: e.target.value }))} /></td>
    </tr>
  );

  return (
    <Card title="Validation des identifiants fiscaux (§8)"
      actions={<Btn need="config.manage" variant="primary" onClick={() => { store.updateSettings({ validation: rules }); setSaved(true); setTimeout(() => setSaved(false), 2500); }}>Enregistrer</Btn>}>
      {saved && <Alert tone="success">Règles enregistrées.</Alert>}
      <Alert tone="warning">
        Conformément au §8, aucune règle de longueur n'est imposée arbitrairement : chaque contrôle est
        configurable. Le mode par défaut est « Avertissement » — l'utilisateur reste décideur. L'historique des
        modifications est conservé dans le journal d'audit.
      </Alert>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Identifiant</th><th>Mode</th><th>Expression régulière (syntaxe)</th></tr></thead>
          <tbody>
            {row("nif", "NIF", "nifPattern")}
            {row("nis", "NIS", "nisPattern")}
            {row("rc", "RC", "rcPattern")}
            {row("articleImposition", "Article d'imposition", "aiPattern")}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------------- Sécurité (§37) + sauvegardes (§30) ---------------- */

function SecurityTab() {
  const data = useApp();
  return (
    <>
      <Card title="Verrouillage automatique (§37)">
        <Field label="Verrouiller l'application après inactivité">
          <select style={{ maxWidth: 260 }} value={data.settings.lockTimeoutMinutes}
            onChange={(e) => store.updateSettings({ lockTimeoutMinutes: Number(e.target.value) })}>
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={0}>Jamais</option>
          </select>
        </Field>
        <p className="muted small">Le déverrouillage exige le mot de passe d'un compte local (§36). Bouton 🔒 dans la barre latérale pour verrouiller immédiatement.</p>
      </Card>
      <Card title="Sauvegarde automatique (§30)">
        <div className="form-grid">
          <Field label="Fréquence">
            <select value={data.settings.autoBackupFrequency}
              onChange={(e) => store.updateSettings({ autoBackupFrequency: e.target.value as typeof data.settings.autoBackupFrequency })}>
              <option value="OFF">Désactivée</option>
              <option value="DAILY">Chaque jour</option>
              <option value="WEEKLY">Chaque semaine</option>
              <option value="ON_CLOSE">À la fermeture</option>
            </select>
          </Field>
          <Field label="Nombre de sauvegardes conservées (défaut : 10)">
            <input type="number" min={1} max={100} value={data.settings.autoBackupRetention}
              onChange={(e) => store.updateSettings({ autoBackupRetention: Number(e.target.value) || 10 })} />
          </Field>
        </div>
      </Card>
      <Card title="Rôles et permissions (§35)">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Rôle</th><th>Permissions</th></tr></thead>
            <tbody>
              {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((r) => (
                <tr key={r}><td><Badge tone="blue">{ROLE_LABELS[r]}</Badge></td><td className="small">{ROLE_PERMISSIONS_SHORT[r]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Langue de l'interface (§43)">
        <Field label="Langue">
          <select style={{ maxWidth: 260 }} value={data.language}
            onChange={(e) => store.setLanguage(e.target.value as typeof data.language)}>
            {(Object.keys(LANG_LABELS) as Array<keyof typeof LANG_LABELS>).map((l) => (
              <option key={l} value={l}>{LANG_LABELS[l]}</option>
            ))}
          </select>
        </Field>
        <p className="muted small">
          Français par défaut. La navigation et les actions communes sont traduites en anglais et
          en arabe (interface en RTL) ; la couverture complète des écrans est progressive.
        </p>
      </Card>
    </>
  );
}

import { ROLE_PERMISSIONS as ROLE_PERMISSIONS_SHORT } from "../core/types";
