/** Utilisateurs et rôles (§35, §36). */

import { useState } from "react";
import { formatDateTimeFr } from "../core/format";
import { ROLE_LABELS, ROLE_PERMISSIONS, type UserRole } from "../core/types";
import { store } from "../store/store";
import { Alert, Badge, Btn, Card, Field, Modal, useApp } from "../ui/components";

export function UsersScreen() {
  const data = useApp();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <Card
        title="Comptes locaux (§35) — monoposte aujourd'hui, multi-utilisateurs prêt pour la V2 (§75)"
        actions={<Btn need="users.manage" variant="primary" onClick={() => setAdding(true)}>+ Nouvel utilisateur</Btn>}
      >
        <Alert tone="info">
          Les mots de passe ne sont <b>jamais stockés en clair</b> (§36) : hash SHA-256 côté démonstration,
          Argon2 dans le backend desktop. Sessions locales, verrouillage automatique (§37), permissions par rôle.
        </Alert>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Utilisateur</th><th>Rôle</th><th>Créé le</th><th>Session</th></tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.username}</b></td>
                  <td><Badge tone="blue">{ROLE_LABELS[u.role]}</Badge></td>
                  <td>{formatDateTimeFr(u.createdAt)}</td>
                  <td>{u.username === data.currentUser ? <Badge tone="green">Session active</Badge> : ""}</td>
                </tr>
              ))}
              {data.users.length === 0 && <tr><td colSpan={4} className="empty-state">Aucun compte.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Permissions par rôle (§35)">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Rôle</th><th>Permissions</th></tr></thead>
            <tbody>
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                <tr key={r}>
                  <td><Badge tone="blue">{ROLE_LABELS[r]}</Badge></td>
                  <td>{ROLE_PERMISSIONS[r]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {adding && <AddUserModal onClose={() => setAdding(false)} />}
    </>
  );
}

function AddUserModal({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<UserRole>("VENDEUR");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");

  async function save() {
    try {
      await store.addUser(username, role, pw);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title="Nouvel utilisateur (§35)" onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Annuler</Btn><Btn need="users.manage" variant="primary" onClick={save}>Créer le compte</Btn></>}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="form-grid">
        <Field label="Nom d'utilisateur" required>
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Rôle">
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </Field>
        <div className="span2">
          <Field label="Mot de passe (min. 6 caractères)" required>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
