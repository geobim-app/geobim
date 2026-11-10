# Deployment geobim.app

## Ablauf

```
lokal ändern → bash qa-check.sh → Commit
  → git push origin HEAD:staging   → beta.geobim.app  (prüfen)
  → git push origin HEAD:main      → geobim.app       (live)
```

| Branch | Ziel | Server-Skript | Checkout |
|--------|------|---------------|----------|
| `staging` | beta.geobim.app | `/usr/local/bin/geobim-deploy-staging` | `/var/www/geobim-beta` |
| `main` | geobim.app | `/usr/local/bin/geobim-deploy` | `/var/www/christoflorenz.de` |

Bei jedem Push auf einen der beiden Branches verbindet sich die GitHub Action
`.github/workflows/deploy.yml` per SSH mit dem Server. Jede Umgebung hat einen
eigenen Deploy-Schlüssel, der per `command=` in `authorized_keys` nur ihr
Skript starten kann — keine Shell, keine Weiterleitungen. Der Staging-Schlüssel
kann also nie live deployen.

- **`main`** wird nur vorwärts bewegt (`git merge --ff-only`). Kein Force-Push.
- **`staging`** ist ein Zeiger zum Ausprobieren und darf jederzeit neu gesetzt
  werden (`--force-with-lease`), z. B. zurück auf `main`.
- Auf dem Server wird nie direkt etwas geändert.

### Alltag

```bash
# Stand auf beta zeigen (aktueller lokaler Branch)
git push --force-with-lease origin HEAD:staging

# passt → live
git push origin HEAD:main

# beta wieder auf den Live-Stand setzen
git push --force-with-lease origin origin/main:staging
```

Manuell auslösen: GitHub → Actions → **Deploy** → **Run workflow** → Branch
`main` oder `staging` wählen.

---

## Einrichtung (einmalig)

Platzhalter in `<...>` ersetzen.

### 1. Deploy-User festlegen (Server)

Der User, unter dem sich die Action anmeldet, muss in beiden Checkouts
`git fetch`, `git merge` und `git checkout` ausführen dürfen. Prüfen, wem sie
gehören:

```bash
stat -c '%U:%G' /var/www/christoflorenz.de /var/www/christoflorenz.de/.git /var/www/geobim-beta
git -C /var/www/christoflorenz.de remote -v
git -C /var/www/christoflorenz.de worktree list
```

- **Gehören sie einem normalen User** (nicht `root`): diesen User nehmen.
  Er heißt im Folgenden `<deploy-user>`.
- **Gehören sie `root`:** nicht `root` für die Action verwenden. Stattdessen
  einen eigenen User anlegen und ihm per sudo genau die beiden Skripte
  erlauben:

  ```bash
  sudo adduser --disabled-password --gecos "" deploy
  echo 'deploy ALL=(root) NOPASSWD: /usr/local/bin/geobim-deploy, /usr/local/bin/geobim-deploy-staging' | sudo tee /etc/sudoers.d/geobim-deploy
  sudo chmod 440 /etc/sudoers.d/geobim-deploy
  sudo visudo -c
  ```

  Dann ist `<deploy-user>` = `deploy`, und in Schritt 4 steht vor dem
  Skriptpfad jeweils `sudo ` (z. B. `command="sudo /usr/local/bin/geobim-deploy"`).

Der Remote muss ohne Passwortabfrage erreichbar sein (öffentliches Repo per
`https://github.com/geobim-app/geobim.git` reicht).

### 2. Staging-Skript und Branch anlegen

Das Live-Skript `/usr/local/bin/geobim-deploy` gibt es schon. Es sollte mit
`set -euo pipefail` beginnen, damit ein Fehler die Action rot macht.

Branch `staging` einmalig anlegen (vom PC):

```bash
git push origin origin/main:refs/heads/staging
```

Auf dem Server `/usr/local/bin/geobim-deploy-staging` anlegen:

```bash
#!/bin/bash
# beta.geobim.app: Checkout auf den Stand von origin/staging setzen
set -euo pipefail
cd /var/www/geobim-beta
git fetch origin staging
# Nie über lokale Änderungen hinweg deployen
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Lokale Änderungen in /var/www/geobim-beta — Abbruch" >&2
  git status --short >&2
  exit 1
fi
git checkout --detach origin/staging
git log -1 --oneline
```

```bash
sudo chmod 755 /usr/local/bin/geobim-deploy-staging
```

`checkout --detach` statt `merge --ff-only`, weil `staging` neu gesetzt werden
darf. Beta bleibt wie bisher detached, nur jetzt auf `origin/staging` statt
`origin/main`.

Test als `<deploy-user>`:

```bash
sudo -u <deploy-user> /usr/local/bin/geobim-deploy
sudo -u <deploy-user> /usr/local/bin/geobim-deploy-staging
```

Erwartet: `Already up to date.` bzw. die Zeile des aktuellen Commits. Meldet
git `dubious ownership`, läuft das Skript unter einem anderen User als dem
Eigentümer — dann Schritt 1 nochmal prüfen.

### 3. Zwei Deploy-Schlüssel erzeugen (dein PC, PowerShell)

Je ein eigener Schlüssel nur für die Action, ohne Passphrase (die Action kann
keine eingeben — bei der Frage zweimal Enter):

```powershell
ssh-keygen -t ed25519 -C "github-actions geobim deploy production" -f $HOME\.ssh\geobim_deploy
ssh-keygen -t ed25519 -C "github-actions geobim deploy staging" -f $HOME\.ssh\geobim_deploy_staging
```

Ergebnis: jeweils eine private Datei (kommt nach GitHub) und eine `.pub`
(kommt auf den Server).

### 4. Öffentliche Schlüssel auf dem Server eintragen

Verzeichnis und Datei anlegen:

```bash
sudo -u <deploy-user> mkdir -p ~<deploy-user>/.ssh
sudo -u <deploy-user> touch ~<deploy-user>/.ssh/authorized_keys
sudo chmod 700 ~<deploy-user>/.ssh
sudo chmod 600 ~<deploy-user>/.ssh/authorized_keys
```

Inhalt der beiden `.pub`-Dateien anzeigen
(`Get-Content $HOME\.ssh\geobim_deploy.pub` bzw. `…_staging.pub`) und
**je als eine Zeile** an `~<deploy-user>/.ssh/authorized_keys` anhängen
(z. B. mit `sudo nano`):

```text
command="/usr/local/bin/geobim-deploy",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA...PRODUCTION... github-actions geobim deploy production
command="/usr/local/bin/geobim-deploy-staging",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA...STAGING... github-actions geobim deploy staging
```

Wichtig: Der Produktions-Schlüssel gehört zu `geobim-deploy`, der
Staging-Schlüssel zu `geobim-deploy-staging` — nicht vertauschen.

Prüfen, dass `sshd` den User zulässt (`AllowUsers`/`AllowGroups` in
`/etc/ssh/sshd_config` bzw. `/etc/ssh/sshd_config.d/`, falls gesetzt).

### 5. known_hosts-Zeile bestimmen (Server)

Die Action prüft den Host-Schlüssel des Servers fest
(`StrictHostKeyChecking=yes`). Die Zeile direkt aus dem Host-Schlüssel auf dem
Server bauen — dann ist sie garantiert echt:

```bash
echo "<host> $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
```

`<host>` muss genau dem Wert von `DEPLOY_HOST` entsprechen, z. B.
`168.119.232.12` oder `geobim.app`. Läuft SSH nicht auf Port 22, lautet der
Anfang `[<host>]:<port>`.

### 6. Secrets in GitHub anlegen

GitHub → `geobim-app/geobim` → Settings → Secrets and variables → Actions →
**New repository secret**:

| Secret | Inhalt |
|--------|--------|
| `DEPLOY_HOST` | `168.119.232.12` (oder `geobim.app`, passend zu Schritt 5) |
| `DEPLOY_USER` | `<deploy-user>` |
| `DEPLOY_KNOWN_HOSTS` | die Zeile aus Schritt 5 |
| `DEPLOY_KEY` | gesamter Inhalt von `geobim_deploy` (privat, **Produktion**), inkl. `-----BEGIN…`/`-----END…`-Zeilen |
| `DEPLOY_STAGING_KEY` | gesamter Inhalt von `geobim_deploy_staging` (privat, **Staging**) |
| `DEPLOY_PORT` | nur falls nicht 22 |

Alternativ mit der GitHub-CLI vom PC aus (`gh secret set NAME` ohne Eingabe
fragt den Wert interaktiv ab):

```powershell
gh secret set DEPLOY_HOST --repo geobim-app/geobim
gh secret set DEPLOY_USER --repo geobim-app/geobim
gh secret set DEPLOY_KNOWN_HOSTS --repo geobim-app/geobim
Get-Content $HOME\.ssh\geobim_deploy -Raw | gh secret set DEPLOY_KEY --repo geobim-app/geobim
Get-Content $HOME\.ssh\geobim_deploy_staging -Raw | gh secret set DEPLOY_STAGING_KEY --repo geobim-app/geobim
```

Nach dem ersten Lauf legt GitHub die Environments `production` und `staging`
an (Settings → Environments). Empfohlen: bei `production` unter
„Deployment branches and tags“ nur `main` zulassen, bei `staging` nur
`staging`.

Nach dem Test (Schritt 7.1) die privaten Dateien vom PC löschen oder sicher
verwahren — gebraucht werden sie nur noch in GitHub. Bei Verlust neu erzeugen
und Schritt 3, 4 und 6 wiederholen.

### 7. Ersten Lauf testen

1. **Vom PC, vor dem Löschen der Schlüssel:**

   ```powershell
   ssh -i $HOME\.ssh\geobim_deploy_staging -o IdentitiesOnly=yes <deploy-user>@<host> whoami
   ssh -i $HOME\.ssh\geobim_deploy -o IdentitiesOnly=yes <deploy-user>@<host> whoami
   ```

   Erwartet: jeweils die Ausgabe des passenden Skripts (Staging: Commit-Zeile
   von beta; Produktion: `Already up to date.`), **nicht** der User-Name —
   das zeigt, dass die Schlüssel nur ihr Skript starten dürfen.

2. **Staging:** eine kleine Änderung (z. B. CHANGELOG) committen und
   `git push --force-with-lease origin HEAD:staging`. Lauf in Actions
   abwarten, beta.geobim.app prüfen, auf dem Server:

   ```bash
   git -C /var/www/geobim-beta log -1 --oneline
   ```

3. **Live:** `git push origin HEAD:main`, Lauf abwarten, prüfen:

   ```bash
   git -C /var/www/christoflorenz.de log -1 --oneline
   ```

   Muss jeweils dem gepushten Commit entsprechen.

### Typische Fehler

| Meldung im Log | Ursache |
|----------------|---------|
| `Deploy key for … not set` | Secret `DEPLOY_KEY` bzw. `DEPLOY_STAGING_KEY` fehlt (Schritt 6) |
| `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` passt nicht zu `DEPLOY_HOST`/Port (Schritt 5) |
| `Permission denied (publickey)` | Schlüssel nicht/falsch in `authorized_keys`, Rechte, `AllowUsers` (Schritt 4) |
| `Not possible to fast-forward` (live) | auf dem Server liegt ein lokaler Commit, oder `main` wurde neu geschrieben — mit einer Server-Session nur **diagnostizieren**, Ursache im Repo beheben |
| `Lokale Änderungen … Abbruch` (beta) | jemand hat in `/var/www/geobim-beta` Dateien geändert — diagnostizieren, nicht dort weiterarbeiten |
| `dubious ownership` | Skript läuft nicht als Eigentümer des Checkouts (Schritt 1) |

## Schlüssel tauschen oder sperren

Zeile in `authorized_keys` löschen = Deploy dieser Umgebung sofort gesperrt.
Neuer Schlüssel: Schritt 3, 4 und das passende Secret in Schritt 6 wiederholen.

## Share-Links für Szenen: Firestore-Regeln (einmalig)

Die Kommentare der Kunden zu einem Share-Link (`share-view.js`) liegen in
Firestore unter `share_comments/<token>/comments`. Den Status des Links
(`revoked`, `expiresAt`) spiegelt der Browser des Owners beim Erstellen und
Widerrufen nach `share_comments/<token>` (`scenes-share.js`). Die Regeln
stehen nicht im Repo: in der Firebase-Konsole (Projekt `publictwin-ad6c7`,
Firestore → Regeln) **ergänzen**, nicht ersetzen. Eine Anmeldung brauchen
Kunden nicht (anonyme Anmeldung ist im Projekt aus, wie bei den
Demo-Kommentaren): wer den 22-stelligen Token kennt, darf lesen und anlegen,
solange der Link gilt.

```
// innerhalb von: match /databases/{database}/documents { ... }
function isGeobimOwner() {
  return request.auth != null && request.auth.token.email == 'christof2304@gmail.com';
}
function shareOpen(token) {
  let p = /databases/$(database)/documents/share_comments/$(token);
  return exists(p) && get(p).data.revoked == false
    && (get(p).data.expiresAt == null || request.time < get(p).data.expiresAt);
}
match /share_comments/{token} {
  allow read, write: if isGeobimOwner();
  match /comments/{commentId} {
    allow read: if isGeobimOwner() || shareOpen(token);
    allow create: if shareOpen(token)
      && request.resource.data.size() <= 30
      && request.resource.data.title is string && request.resource.data.title.size() <= 300
      && request.resource.data.text is string && request.resource.data.text.size() <= 5000;
    allow update, delete: if isGeobimOwner();
  }
}
```

Die Links selbst liegen pro Site in `model/.shares/<token>.json` (nicht im
Repo, nie ausgeliefert). Ein Link von beta gilt nur auf beta.
