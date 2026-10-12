/** Sauvegardes (§30-33), restauration (§32), export complet (§33),
 *  contrôle d'intégrité (§49). */

import { useState } from "react";
import { formatDateTimeFr } from "../core/format";
import { invokeDesktop, isTauri } from "../store/desktop";
import { store } from "../store/store";
import { Alert, Badge, Btn, Card, Modal, readFileAsText, useApp } from "../ui/components";

export function BackupsScreen() {
  const data = useApp();
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<{ json: string; name: string; sizeBytes: number } | null>(null);
  const [findings, setFindings] = useState<ReturnType<typeof store.integrityCheck> | null>(null);

  function manualBackup() {
    try {
      const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-").replace("T", "_");
      const json = store.exportBackup("MANUELLE", `Sauvegarde manuelle ${stamp}`);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      a.download = `facturation_${stamp}.backup.json`;
      a.click();
      setMsg({ tone: "success", text: "Sauvegarde créée. Choisissez l'emplacement (clé USB, disque D:, disque externe, dossier réseau…) dans la fenêtre de téléchargement de votre navigateur (§31)." });
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    }
  }

  async function pickRestore(file: File) {
    try {
      const json = await readFileAsText(file);
      JSON.parse(json); // pré-validation
      setRestoreCandidate({ json, name: file.name, sizeBytes: file.size });
    } catch {
      setMsg({ tone: "error", text: "Ce fichier n'est pas une sauvegarde FacturationDZ lisible." });
    }
  }

  function doRestore() {
    try {
      const r = store.restoreFromBackup(restoreCandidate!.json);
      setRestoreCandidate(null);
      setMsg({ tone: "success", text: r.message });
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    }
  }

  /* ---------------- Actions desktop (SQLite, §30-33) ---------------- */

  async function desktopBackupNow() {
    try {
      const info = await invokeDesktop<{ file_path: string }>("backup_now", {
        label: `Manuelle ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      });
      store.exportBackup("MANUELLE", "Sauvegarde desktop (SQLite)");
      setMsg({ tone: "success", text: `Sauvegarde créée : ${info?.file_path ?? "dossier Backups"}.` });
    } catch (e) {
      setMsg({ tone: "error", text: `Sauvegarde desktop impossible : ${(e as Error)?.message ?? e}` });
    }
  }

  async function desktopRestore() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        multiple: false,
        filters: [{ name: "Base FacturationDZ", extensions: ["sqlite", "db"] }],
        title: "Choisir la sauvegarde à restaurer (§32)",
      });
      if (!path || typeof path !== "string") return;
      if (!window.confirm(
        "Restaurer cette base remplacera les données actuelles.\n" +
        "Une sauvegarde de sécurité de l'état actuel sera conservée (§32).\n\nContinuer ?"
      )) return;
      const message = await invokeDesktop<string>("restore_backup", { source: path });
      const ok = await store.hydrateFromDesktop();
      setMsg({
        tone: "success",
        text: `${message ?? "Restauration terminée."}${ok ? " L'application a été resynchronisée depuis la base restaurée." : ""}`,
      });
    } catch (e) {
      setMsg({ tone: "error", text: `Restauration impossible : ${(e as Error)?.message ?? e}` });
    }
  }

  async function desktopResync() {
    try {
      const { pushed } = await store.syncAllToDesktop();
      setMsg({ tone: "success", text: `Synchronisation terminée : ${pushed} éléments poussés vers la base locale.` });
    } catch (e) {
      setMsg({ tone: "error", text: `Synchronisation impossible : ${(e as Error)?.message ?? e}` });
    }
  }

  return (
    <>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <Card title="Actions (§30, §31, §32, §33)">
        <div className="hrow">
          <Btn need="backup.create" variant="primary" onClick={manualBackup}>💾 SAUVEGARDER MES DONNÉES</Btn>
          {store.can("backup.restore") && (
            <label className="btn">
              📂 RESTAURER UNE SAUVEGARDE
              <input type="file" accept=".json,.backup" hidden onChange={(e) => e.target.files?.[0] && pickRestore(e.target.files[0])} />
            </label>
          )}
          <Btn need="export.data" onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([store.exportAllJson()], { type: "application/json" }));
            a.download = `facturationdz_export_complet_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            store.audit("EXPORT_COMPLET", "backup", undefined, "Export de toutes les données (§33)");
          }}>
            ⬇ EXPORTER TOUTES LES DONNÉES (JSON — §33)
          </Btn>
          <Btn variant="ghost" onClick={() => setFindings(store.integrityCheck())}>✓ VÉRIFIER L'INTÉGRITÉ DES DONNÉES (§49)</Btn>
        </div>
        {isTauri() && (
          <div className="hrow" style={{ marginTop: 10 }}>
            <Btn need="backup.create" onClick={desktopBackupNow}>🗄 SAUVEGARDE SQLITE MAINTENANT</Btn>
            <Btn need="backup.restore" variant="ghost" onClick={desktopRestore}>♻ RESTAURER LA BASE SQLITE (§32)</Btn>
            <Btn need="config.manage" variant="ghost" onClick={desktopResync}>⇅ RESYNCHRONISER VERS LA BASE</Btn>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>
          Règle absolue (§81) : une mise à jour, une erreur ou une désinstallation ne supprime jamais vos données.
          Sur le poste Windows, les sauvegardes sont stockées dans <code>C:\ProgramData\FacturationDZ\Backups\</code>,
          séparées du programme.
        </p>
      </Card>

      {findings && (
        <Card title="Résultat du contrôle d'intégrité (§49)">
          {findings.map((f, i) => (
            <Alert key={i} tone={f.severity === "ERROR" ? "error" : f.severity === "OK" ? "success" : "warning"}>
              {f.message}
            </Alert>
          ))}
        </Card>
      )}

      <Card title="Historique des sauvegardes">
        <div className="table-wrap card-body tight">
          <table className="data">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Libellé</th><th className="num">Taille</th><th className="num">Factures</th><th className="num">Clients</th><th className="num">Produits</th><th>Version</th></tr>
            </thead>
            <tbody>
              {data.backupHistory.map((b) => (
                <tr key={b.id}>
                  <td className="nowrap">{formatDateTimeFr(b.ts)}</td>
                  <td>{b.kind === "AUTO" ? <Badge tone="blue">Auto</Badge> : b.kind === "MANUELLE" ? <Badge tone="green">Manuelle</Badge> : <Badge tone="amber">{b.kind}</Badge>}</td>
                  <td>{b.label}</td>
                  <td className="num">{(b.sizeBytes / 1024).toFixed(1)} Ko</td>
                  <td className="num">{b.counts.factures}</td>
                  <td className="num">{b.counts.clients}</td>
                  <td className="num">{b.counts.produits}</td>
                  <td>v{b.schemaVersion}</td>
                </tr>
              ))}
              {data.backupHistory.length === 0 && <tr><td colSpan={8} className="empty-state">Aucune sauvegarde pour l'instant.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {restoreCandidate && (
        <Modal
          title="Confirmer la restauration (§32)"
          onClose={() => setRestoreCandidate(null)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setRestoreCandidate(null)}>Annuler</Btn>
              <Btn need="backup.restore" variant="danger" onClick={doRestore}>Restaurer cette sauvegarde</Btn>
            </>
          }
        >
          <Alert tone="warning">
            Avant la restauration, une <b>sauvegarde de sécurité</b> de l'état actuel est automatiquement créée (§32).
            Les données actuelles seront ensuite remplacées par celles du fichier.
          </Alert>
          <div className="kv">
            <dt>Fichier</dt><dd>{restoreCandidate.name}</dd>
            <dt>Taille</dt><dd>{(restoreCandidate.sizeBytes / 1024).toFixed(1)} Ko</dd>
            <dt>Contenu détecté</dt>
            <dd>
              {(() => {
                try {
                  const p = JSON.parse(restoreCandidate.json);
                  return `${p.docs?.length ?? 0} document(s), ${p.customers?.length ?? 0} client(s), ${p.products?.length ?? 0} produit(s)`;
                } catch {
                  return "—";
                }
              })()}
            </dd>
          </div>
        </Modal>
      )}
    </>
  );
}
