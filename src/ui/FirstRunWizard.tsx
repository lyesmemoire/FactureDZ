/**
 * Assistant de premier démarrage (§54).
 * Étapes : Bienvenue → Entreprise → Logo/cachet/signature → Facture →
 * Numérotation → TVA → Sauvegardes → Compte administrateur → Terminé.
 */

import { useMemo, useState } from "react";
import { renderNumber } from "../core/numbering";
import { presetTaxRates } from "../core/taxEngine";
import { MODES_PAIEMENT, WILAYAS, type Company } from "../core/types";
import { hashPassword, store } from "../store/store";
import { Alert, Btn, Field, readFileAsDataUrl } from "./components";
import { isTauri } from "../store/desktop";

const STEPS = [
  "Bienvenue",
  "Mon entreprise",
  "Logo / Cachet / Signature",
  "Configuration facture",
  "Numérotation",
  "TVA",
  "Sauvegardes",
  "Compte administrateur",
  "Terminé",
];

export function FirstRunWizard() {
  const [step, setStep] = useState(0);
  const [seedDemo, setSeedDemo] = useState(true);
  const [company, setCompany] = useState<Company>({ ...store.data.company });
  const [template, setTemplate] = useState("FAC-{YEAR}-{COUNTER}");
  const [padding, setPadding] = useState(6);
  const [autoFreq, setAutoFreq] = useState<"OFF" | "DAILY" | "WEEKLY" | "ON_CLOSE">("DAILY");
  const [retention, setRetention] = useState(10);
  const [adminName, setAdminName] = useState("admin");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");

  const preview = useMemo(() => {
    try {
      return renderNumber({ docType: "FAC", template, padding }, new Date().getFullYear(), 1);
    } catch {
      return "(gabarit invalide)";
    }
  }, [template, padding]);

  const set = (patch: Partial<Company>) => setCompany((c) => ({ ...c, ...patch }));

  async function finish() {
    try {
      if (!company.raisonSociale.trim()) throw new Error("La raison sociale est obligatoire.");
      if (pw1.length < 6) throw new Error("Le mot de passe administrateur doit contenir au moins 6 caractères.");
      if (pw1 !== pw2) throw new Error("Les deux mots de passe ne correspondent pas.");
      const admin = adminName || "admin";
      await store.addUser(admin, "ADMIN", pw1);
      // Desktop : ouvrir la session de l'administrateur dès sa création, pour que
      // la configuration écrite ensuite soit autorisée (§35, §36).
      if (isTauri()) {
        const ouverte = await store.verifyPassword(admin, pw1);
        if (!ouverte) throw new Error("Connexion administrateur impossible après la création du compte.");
      }
      store.updateSettings({ autoBackupFrequency: autoFreq, autoBackupRetention: retention });
      try {
        store.updateSequenceConfig("FAC", template, padding);
      } catch (e) {
        throw new Error("Gabarit de numérotation invalide : " + (e as Error).message);
      }
      store.completeFirstRun(company, seedDemo, adminName || "admin");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const imageField = (label: string, key: "logoDataUrl" | "cachetDataUrl" | "signatureDataUrl") => (
    <Field label={label}>
      <div className="hrow">
        {company[key] && <img className="img-thumb" src={company[key]} alt={label} />}
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          style={{ width: "auto" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) set({ [key]: await readFileAsDataUrl(f) } as Partial<Company>);
          }}
        />
        {company[key] && (
          <Btn small variant="ghost" onClick={() => set({ [key]: undefined } as Partial<Company>)}>
            Retirer
          </Btn>
        )}
      </div>
      <span className="field-hint">PNG (transparence gérée), JPG ou WEBP — stocké localement (§24).</span>
    </Field>
  );

  return (
    <div className="wizard-backdrop">
      <div className="wizard">
        <div className="wizard-head">
          <div className="hrow" style={{ justifyContent: "space-between" }}>
            <div>
              <b style={{ fontSize: 15 }}>FacturationDZ</b>{" "}
              <span className="muted small">— Assistant de configuration</span>
            </div>
            <span className="badge badge-blue">Étape {step + 1} / {STEPS.length} — {STEPS[step]}</span>
          </div>
          <div className="wizard-steps">
            {STEPS.map((s, i) => (
              <div key={s} className={`ws ${i <= step ? "on" : ""}`} />
            ))}
          </div>
        </div>

        <div className="wizard-body">
          {error && <Alert tone="error">{error}</Alert>}

          {step === 0 && (
            <>
              <h2>Bienvenue dans FacturationDZ</h2>
              <p className="lead">
                Logiciel de facturation professionnel conçu pour les entreprises algériennes : fonctionne
                <b> 100 % hors ligne</b>, données stockées <b>localement</b> sur votre PC, numérotation
                séquentielle sécurisée, TVA configurable, montants en lettres, PDF et impression.
              </p>
              <label className="hrow" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={seedDemo}
                  onChange={(e) => setSeedDemo(e.target.checked)}
                />
                <span>
                  Charger un <b>jeu de données de démonstration</b> (entreprise, clients, produits et factures
                  fictifs — §77). Ces données sont marquées « démo » et restent séparées de vos données réelles.
                </span>
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <h2>Votre entreprise (§6)</h2>
              <p className="lead">Ces informations figureront sur vos factures. NIF, NIS, RC et Article d'imposition sont des champs distincts.</p>
              <div className="form-grid">
                <Field label="Raison sociale / dénomination" required>
                  <input value={company.raisonSociale} onChange={(e) => set({ raisonSociale: e.target.value })} placeholder="Ex : SARL Atlas Distribution" />
                </Field>
                <Field label="Nom commercial">
                  <input value={company.nomCommercial ?? ""} onChange={(e) => set({ nomCommercial: e.target.value })} />
                </Field>
                <Field label="Forme juridique">
                  <select value={company.formeJuridique ?? ""} onChange={(e) => set({ formeJuridique: e.target.value })}>
                    <option value="">— Choisir —</option>
                    {["EURL", "SARL", "SPA", "SNC", "SCS", "Entreprise individuelle", "Auto-entrepreneur", "Autre"].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Activité">
                  <input value={company.activite ?? ""} onChange={(e) => set({ activite: e.target.value })} placeholder="Ex : Négoce de matériaux de construction" />
                </Field>
                <Field label="Adresse complète">
                  <input value={company.adresse ?? ""} onChange={(e) => set({ adresse: e.target.value })} />
                </Field>
                <Field label="Wilaya">
                  <select value={company.wilaya ?? ""} onChange={(e) => set({ wilaya: e.target.value })}>
                    <option value="">— Choisir —</option>
                    {WILAYAS.map((w) => (
                      <option key={w}>{w}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Commune">
                  <input value={company.commune ?? ""} onChange={(e) => set({ commune: e.target.value })} />
                </Field>
                <Field label="Téléphone">
                  <input value={company.telephone ?? ""} onChange={(e) => set({ telephone: e.target.value })} />
                </Field>
                <Field label="Email">
                  <input value={company.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
                </Field>
                <Field label="Capital social">
                  <input value={company.capitalSocial ?? ""} onChange={(e) => set({ capitalSocial: e.target.value })} placeholder="Ex : 1 000 000,00 DA" />
                </Field>
                <Field label="RC (Registre de commerce)">
                  <input value={company.rc ?? ""} onChange={(e) => set({ rc: e.target.value })} />
                </Field>
                <Field label="NIF (Numéro d'identification fiscale)">
                  <input value={company.nif ?? ""} onChange={(e) => set({ nif: e.target.value })} />
                </Field>
                <Field label="NIS (Numéro d'identification statistique)">
                  <input value={company.nis ?? ""} onChange={(e) => set({ nis: e.target.value })} />
                </Field>
                <Field label="Article d'imposition (AI)">
                  <input value={company.articleImposition ?? ""} onChange={(e) => set({ articleImposition: e.target.value })} />
                </Field>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2>Logo, cachet et signature (§24)</h2>
              <p className="lead">
                Formats acceptés : PNG (transparence gérée), JPG, WEBP. Ces images restent sur votre machine.
                Étape facultative — vous pourrez le faire plus tard dans Paramètres.
              </p>
              <div className="stack">
                {imageField("Logo de l'entreprise", "logoDataUrl")}
                {imageField("Cachet de l'entreprise", "cachetDataUrl")}
                {imageField("Signature", "signatureDataUrl")}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2>Configuration de la facture</h2>
              <div className="form-grid">
                <Field label="Conditions de paiement par défaut (jours)">
                  <input type="number" min={0} value={company.conditionsPaiementDefautJours} onChange={(e) => set({ conditionsPaiementDefautJours: Number(e.target.value) || 0 })} />
                </Field>
                <Field label="Mode de paiement par défaut">
                  <select value={company.modePaiementDefaut} onChange={(e) => set({ modePaiementDefaut: e.target.value })}>
                    {MODES_PAIEMENT.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Banque">
                  <input value={company.banque ?? ""} onChange={(e) => set({ banque: e.target.value })} placeholder="Ex : BEA — Agence Alger 12" />
                </Field>
                <Field label="RIB">
                  <input value={company.rib ?? ""} onChange={(e) => set({ rib: e.target.value })} />
                </Field>
                <Field label="RIP / CCP (si applicable)">
                  <input value={company.ripCcp ?? ""} onChange={(e) => set({ ripCcp: e.target.value })} />
                </Field>
                <Field label="Affichage sur le PDF">
                  <div className="stack" style={{ gap: 4 }}>
                    <label className="hrow"><input type="checkbox" style={{ width: "auto" }} checked={company.afficherCoordonneesBancaires} onChange={(e) => set({ afficherCoordonneesBancaires: e.target.checked })} /> Coordonnées bancaires</label>
                    <label className="hrow"><input type="checkbox" style={{ width: "auto" }} checked={company.afficherCachet} onChange={(e) => set({ afficherCachet: e.target.checked })} /> Cachet</label>
                    <label className="hrow"><input type="checkbox" style={{ width: "auto" }} checked={company.afficherSignature} onChange={(e) => set({ afficherSignature: e.target.checked })} /> Signature</label>
                  </div>
                </Field>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h2>Numérotation des factures (§12, §55)</h2>
              <p className="lead">
                Numéros uniques et séquentiels, attribués à la validation, jamais réutilisés. Exemples de
                gabarits : <code>FAC-{"{YEAR}"}-{"{COUNTER}"}</code>, <code>{"{YEAR}"}/FAC/{"{COUNTER}"}</code>,{" "}
                <code>F-{"{YEAR}"}-{"{COUNTER}"}</code>.
              </p>
              <div className="form-grid">
                <Field label="Gabarit (série FAC)">
                  <input value={template} onChange={(e) => setTemplate(e.target.value)} />
                </Field>
                <Field label="Nombre de chiffres du compteur">
                  <input type="number" min={3} max={10} value={padding} onChange={(e) => setPadding(Number(e.target.value) || 6)} />
                </Field>
              </div>
              <p className="lead" style={{ marginTop: 12 }}>
                Aperçu du premier numéro : <b className="mono">{preview}</b>
              </p>
            </>
          )}

          {step === 5 && (
            <>
              <h2>TVA et taxes (§10, §73)</h2>
              <p className="lead">
                Aucun taux n'est codé en dur : le référentiel est configurable (Paramètres → Taxes), avec
                date d'effet et historique des modifications réglementaires. Les documents conservent le taux
                appliqué (snapshot) : une modification future ne change jamais une ancienne facture.
              </p>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>Code</th><th>Libellé</th><th className="num">Taux</th><th>Statut</th></tr>
                  </thead>
                  <tbody>
                    {presetTaxRates().map((t) => (
                      <tr key={t.id}>
                        <td className="mono">{t.code}</td>
                        <td>{t.libelle}</td>
                        <td className="num">{t.ratePct} %</td>
                        <td><span className="badge badge-green">Préconfiguré</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {step === 6 && (
            <>
              <h2>Sauvegarde automatique (§30)</h2>
              <p className="lead">
                Fonction critique : vos données sont précieuses. Choisissez la fréquence des sauvegardes
                automatiques locales. Vous pourrez aussi sauvegarder manuellement sur clé USB, disque D: ou
                réseau local à tout moment.
              </p>
              <div className="form-grid">
                <Field label="Fréquence">
                  <select value={autoFreq} onChange={(e) => setAutoFreq(e.target.value as typeof autoFreq)}>
                    <option value="OFF">Désactivée</option>
                    <option value="DAILY">Chaque jour</option>
                    <option value="WEEKLY">Chaque semaine</option>
                    <option value="ON_CLOSE">À la fermeture</option>
                  </select>
                </Field>
                <Field label="Nombre de sauvegardes conservées">
                  <input type="number" min={1} max={100} value={retention} onChange={(e) => setRetention(Number(e.target.value) || 10)} />
                </Field>
              </div>
            </>
          )}

          {step === 7 && (
            <>
              <h2>Compte administrateur (§35, §36)</h2>
              <p className="lead">
                Le mot de passe n'est jamais stocké en clair (hash SHA-256 en démo, Argon2 dans le backend
                desktop). Il sert au verrouillage automatique de l'application.
              </p>
              <div className="form-grid">
                <Field label="Nom d'utilisateur" required>
                  <input value={adminName} onChange={(e) => setAdminName(e.target.value)} />
                </Field>
                <span />
                <Field label="Mot de passe" required>
                  <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} />
                </Field>
                <Field label="Confirmation du mot de passe" required>
                  <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                </Field>
              </div>
            </>
          )}

          {step === 8 && (
            <>
              <h2>Configuration terminée ✓</h2>
              <p className="lead">
                L'application est prête : vous pouvez créer vos clients, votre catalogue et établir votre
                première facture. Toutes vos données restent sur ce PC — aucune connexion Internet n'est
                requise. Pensez à vérifier la conformité de vos factures avec votre comptable (§72).
              </p>
            </>
          )}
        </div>

        <div className="wizard-foot">
          <Btn variant="ghost" disabled={step === 0} onClick={() => { setError(""); setStep((s) => s - 1); }}>
            ← Précédent
          </Btn>
          {step < STEPS.length - 1 ? (
            <Btn variant="primary" onClick={() => { setError(""); setStep((s) => s + 1); }}>
              Suivant →
            </Btn>
          ) : (
            <Btn variant="success" onClick={finish}>
              Commencer à utiliser FacturationDZ
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}
