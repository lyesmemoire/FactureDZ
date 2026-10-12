/** Diagnostic (§63) + journal technique (§67). */

import { useState } from "react";
import { formatDateTimeFr } from "../core/format";
import { APP_VERSION, SCHEMA_VERSION, store } from "../store/store";
import { Alert, Badge, Btn, Card, useApp } from "../ui/components";
import { tryNativeIntegrity } from "../ui/desktopActions";

export function DiagnosticScreen() {
  const data = useApp();
  const [findings, setFindings] = useState<ReturnType<typeof store.integrityCheck> | null>(null);
  const [native, setNative] = useState<Awaited<ReturnType<typeof tryNativeIntegrity>>>(null);

  async function runCheck() {
    setFindings(store.integrityCheck());
    setNative(await tryNativeIntegrity());
  }

  const dbSize = new Blob([JSON.stringify(data)]).size;
  const lastBackup = data.backupHistory[0];

  return (
    <>
      <Card title="État du système (§63)">
        <div className="kv">
          <dt>Version de l'application</dt><dd>{APP_VERSION}</dd>
          <dt>Version du schéma de base</dt><dd>v{SCHEMA_VERSION}</dd>
          <dt>Moteur de stockage</dt>
          <dd>
            Démonstration : adaptateur local (navigateur) — Desktop : <b>SQLite</b> (WAL, clés étrangères,
            transactions, index) dans <code>C:\ProgramData\FacturationDZ\Data\facturation.db</code>
          </dd>
          <dt>Nombre de clients</dt><dd>{data.customers.length}</dd>
          <dt>Nombre de produits / services</dt><dd>{data.products.length}</dd>
          <dt>Nombre de documents</dt><dd>{data.docs.length} (dont {data.docs.filter((d) => d.docType === "FAC").length} factures)</dd>
          <dt>Taille des données</dt><dd>{(dbSize / 1024).toFixed(1)} Ko</dd>
          <dt>Dernière sauvegarde</dt>
          <dd>{lastBackup ? `${formatDateTimeFr(lastBackup.ts)} — ${lastBackup.label}` : "Aucune"}</dd>
          <dt>Connexion Internet</dt><dd>{navigator.onLine ? "Présente mais INUTILE (§4)" : "Aucune — l'application fonctionne normalement (§4)"}</dd>
          <dt>Télémétrie / collecte</dt><dd>Aucune (§62) — toutes les données restent sur ce PC.</dd>
        </div>
        <div style={{ marginTop: 12 }}>
          <Btn variant="primary" onClick={runCheck}>
            ✓ Vérifier l'intégrité des données (§49)
          </Btn>
        </div>
      </Card>

      {findings && (
        <Card title="Contrôle d'intégrité (logique de gestion)">
          {findings.map((f, i) => (
            <Alert key={i} tone={f.severity === "ERROR" ? "error" : f.severity === "OK" ? "success" : "warning"}>
              {f.message}
            </Alert>
          ))}
        </Card>
      )}

      {native && (
        <Card title="Intégrité SQLite native (backend desktop, §49)">
          <div className="kv">
            <dt>PRAGMA integrity_check</dt><dd><Badge tone={native.sqlite === "ok" ? "green" : "red"}>{native.sqlite}</Badge></dd>
            <dt>Documents orphelins</dt><dd>{native.orphan_invoices}</dd>
            <dt>Numéros dupliqués</dt><dd>{native.duplicate_numbers}</dd>
          </div>
        </Card>
      )}

      <Card title="Journal technique (§67) — séparé du journal d'audit">
        <div className="table-wrap card-body tight">
          <table className="data">
            <thead><tr><th>Date</th><th>Niveau</th><th>Message</th></tr></thead>
            <tbody>
              {[...(data.techLogs ?? [])].reverse().map((l, i) => (
                <tr key={i}>
                  <td className="mono nowrap">{formatDateTimeFr(l.ts)}</td>
                  <td>
                    <Badge tone={l.level === "ERROR" || l.level === "CRITICAL" ? "red" : l.level === "WARNING" ? "amber" : "gray"}>
                      {l.level}
                    </Badge>
                  </td>
                  <td className="small">{l.message}</td>
                </tr>
              ))}
              {(data.techLogs ?? []).length === 0 && <tr><td colSpan={3} className="empty-state">Aucun événement technique.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ padding: "10px 18px", margin: 0 }}>
          Les messages d'erreur destinés à l'utilisateur sont reformulés en langage clair (§68). Les mots de passe
          ne sont jamais journalisés (§67).
        </p>
      </Card>
    </>
  );
}
