# Deployment geobim.app

**Ablauf:** lokal ändern → Commit → Push auf `main` → GitHub Action
`.github/workflows/deploy.yml` verbindet sich per SSH mit dem Server → dort
läuft `/usr/local/bin/geobim-deploy` (`git fetch origin main` +
`git merge --ff-only origin/main` in `/var/www/christoflorenz.de`).

Auf dem Server wird nie direkt etwas geändert. Der Deploy-Schlüssel kann nur
dieses eine Skript starten (`command=` in `authorized_keys`), keine Shell,
keine Weiterleitungen.

Die Einrichtung unten ist einmalig. Platzhalter in `<...>` ersetzen.

---

## 1. Deploy-User festlegen (Server)

Der User, unter dem sich die Action anmeldet, muss im Checkout `git fetch` und
`git merge` ausführen dürfen. Prüfen, wem der Checkout gehört:

```bash
stat -c '%U:%G' /var/www/christoflorenz.de /var/www/christoflorenz.de/.git
git -C /var/www/christoflorenz.de remote -v
```

- **Gehört er einem normalen User** (nicht `root`): diesen User nehmen.
  Er heißt im Folgenden `<deploy-user>`.
- **Gehört er `root`:** nicht `root` für die Action verwenden. Stattdessen
  einen eigenen User anlegen und ihm per sudo genau dieses eine Skript
  erlauben:

  ```bash
  sudo adduser --disabled-password --gecos "" deploy
  echo 'deploy ALL=(root) NOPASSWD: /usr/local/bin/geobim-deploy' | sudo tee /etc/sudoers.d/geobim-deploy
  sudo chmod 440 /etc/sudoers.d/geobim-deploy
  sudo visudo -c
  ```

  Dann ist `<deploy-user>` = `deploy`, und in Schritt 3 lautet das
  Kommando `command="sudo /usr/local/bin/geobim-deploy"`.

Der Remote muss ohne Passwortabfrage erreichbar sein (öffentliches Repo per
`https://github.com/geobim-app/geobim.git` reicht). Kurzer Test als
`<deploy-user>`:

```bash
sudo -u <deploy-user> /usr/local/bin/geobim-deploy
```

Erwartet: `Already up to date.` (oder ein Fast-Forward). Meldet git
`dubious ownership`, läuft das Skript unter einem anderen User als dem
Eigentümer — dann Schritt 1 nochmal prüfen.

Das Skript sollte mit `set -euo pipefail` beginnen, damit ein Fehler (z. B.
kein Fast-Forward möglich) die Action rot macht.

## 2. Deploy-Schlüssel erzeugen (dein PC, PowerShell)

Eigener Schlüssel nur für die Action, ohne Passphrase (die Action kann keine
eingeben):

```powershell
ssh-keygen -t ed25519 -C "github-actions geobim deploy" -f $HOME\.ssh\geobim_deploy
```

Bei der Frage nach der Passphrase zweimal Enter drücken.

Ergebnis: `geobim_deploy` (privat, kommt nach GitHub) und
`geobim_deploy.pub` (öffentlich, kommt auf den Server).

## 3. Öffentlichen Schlüssel auf dem Server eintragen

Auf dem Server Verzeichnis und Datei anlegen:

```bash
sudo -u <deploy-user> mkdir -p ~<deploy-user>/.ssh
sudo -u <deploy-user> touch ~<deploy-user>/.ssh/authorized_keys
sudo chmod 700 ~<deploy-user>/.ssh
sudo chmod 600 ~<deploy-user>/.ssh/authorized_keys
```

Inhalt von `geobim_deploy.pub` anzeigen (`Get-Content $HOME\.ssh\geobim_deploy.pub`)
und **als eine Zeile** an `~<deploy-user>/.ssh/authorized_keys` anhängen
(z. B. mit `sudo nano`):

```text
command="/usr/local/bin/geobim-deploy",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA...REST-DES-SCHLÜSSELS... github-actions geobim deploy
```

(Bei der sudo-Variante aus Schritt 1: `command="sudo /usr/local/bin/geobim-deploy"`.)

Prüfen, dass `sshd` den User zulässt (`AllowUsers`/`AllowGroups` in
`/etc/ssh/sshd_config` bzw. `/etc/ssh/sshd_config.d/`, falls gesetzt).

## 4. known_hosts-Zeile bestimmen (Server)

Die Action prüft den Host-Schlüssel des Servers fest
(`StrictHostKeyChecking=yes`). Die Zeile direkt aus dem Host-Schlüssel auf dem
Server bauen — dann ist sie garantiert echt:

```bash
echo "<host> $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
```

`<host>` muss genau dem Wert von `DEPLOY_HOST` entsprechen, z. B.
`168.119.232.12` oder `geobim.app`. Läuft SSH nicht auf Port 22, lautet der
Anfang `[<host>]:<port>`.

## 5. Secrets in GitHub anlegen

GitHub → `geobim-app/geobim` → Settings → Secrets and variables → Actions →
**New repository secret**:

| Secret | Inhalt |
|--------|--------|
| `DEPLOY_HOST` | `168.119.232.12` (oder `geobim.app`, passend zu Schritt 4) |
| `DEPLOY_USER` | `<deploy-user>` |
| `DEPLOY_KEY` | gesamter Inhalt von `geobim_deploy` (privat), inkl. `-----BEGIN…`/`-----END…`-Zeilen |
| `DEPLOY_KNOWN_HOSTS` | die Zeile aus Schritt 4 |
| `DEPLOY_PORT` | nur falls nicht 22 |

Alternativ mit der GitHub-CLI vom PC aus:

```powershell
gh secret set DEPLOY_HOST --repo geobim-app/geobim
gh secret set DEPLOY_USER --repo geobim-app/geobim
Get-Content $HOME\.ssh\geobim_deploy -Raw | gh secret set DEPLOY_KEY --repo geobim-app/geobim
gh secret set DEPLOY_KNOWN_HOSTS --repo geobim-app/geobim
```

(`gh secret set NAME` ohne Eingabe fragt den Wert interaktiv ab.)

Danach die private Datei `geobim_deploy` vom PC löschen oder sicher
verwahren — gebraucht wird sie nur noch in GitHub. Bei Verlust einfach neu
erzeugen und Schritt 3 + 5 wiederholen.

## 6. Ersten Lauf testen

1. **Vom PC, vor dem Löschen des Schlüssels:**

   ```powershell
   ssh -i $HOME\.ssh\geobim_deploy -o IdentitiesOnly=yes <deploy-user>@<host> whoami
   ```

   Erwartet: Ausgabe von `geobim-deploy` (`Already up to date.`), **nicht**
   der User-Name — das zeigt, dass der Schlüssel nur das Skript starten darf.
   Ein `ssh -i … <deploy-user>@<host>` ohne Kommando darf keine Shell öffnen.

2. **Manuell in GitHub** (sobald `deploy.yml` auf `main` liegt): Actions →
   **Deploy** → **Run workflow** → Branch `main`. Im Log von
   „Run geobim-deploy on the server“ steht die Ausgabe des Skripts.

3. **Echter Push:** eine kleine Änderung (z. B. CHANGELOG) auf `main`
   pushen, Lauf in Actions abwarten, auf dem Server prüfen:

   ```bash
   git -C /var/www/christoflorenz.de log -1 --oneline
   ```

   Muss dem letzten Commit auf GitHub entsprechen.

### Typische Fehler

| Meldung im Log | Ursache |
|----------------|---------|
| `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` passt nicht zu `DEPLOY_HOST`/Port (Schritt 4) |
| `Permission denied (publickey)` | Schlüssel nicht/falsch in `authorized_keys`, Rechte, `AllowUsers` (Schritt 3) |
| `Not possible to fast-forward` | auf dem Server liegt ein lokaler Commit oder eine Änderung — mit einer Server-Session nur **diagnostizieren**, Ursache im Repo beheben |
| `dubious ownership` | Skript läuft nicht als Eigentümer des Checkouts (Schritt 1) |

## Schlüssel tauschen oder sperren

Zeile in `authorized_keys` löschen = Deploy sofort gesperrt. Neuer Schlüssel:
Schritt 2, 3 und `DEPLOY_KEY` in Schritt 5 wiederholen.
