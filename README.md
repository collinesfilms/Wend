# Collines Go

Raccourcisseur de liens auto-hébergé, pensé pour un seul geste : on ouvre
l'onglet, le lien est déjà dans la boîte, une tape le met dans le presse-papier.

L'usage principal est de distribuer des liens à des étudiants pendant un cours.
Les pages que voient les étudiants comptent donc autant que l'interface
d'administration : elles sont dessinées, en français, et ne contactent personne.

*Shortify est le nom du dépôt ; le produit s'appelle Collines Go.*

---

## Ce que ça fait

**Créer un lien.** L'interface tente de coller automatiquement à l'ouverture.
Là où le navigateur ne l'autorise pas — Safari, notamment — le grand bouton
« Coller un lien » fait la même chose en une tape. Dès qu'un lien est reconnu,
le bouton se divise en quatre :

| | |
|---|---|
| **Raccourcir** | crée le lien et le copie |
| **Slug** | choisir l'adresse plutôt qu'un code aléatoire |
| **Mot de passe** | le lien demande un mot de passe avant de s'ouvrir |
| **Expiration** | dans 1 heure, ce soir, 7 jours, 30 jours, ou une date |

Chaque option ouvre son propre écran, puis revient avec son icône allumée.
Rien n'est obligatoire : on peut aller directement sur « Raccourcir ».

**Après création**, le lien apparaît sur un ticket détachable, déjà copié. Trois
actions : copier de nouveau, afficher le code QR (plein écran pour un
vidéoprojecteur), ou ouvrir la fiche du lien.

**Le tableau de bord** s'ouvre depuis la pastille « Liens » en haut à gauche.
Il liste les liens avec leur destination, leur expiration et leur nombre
d'ouvertures. Un lien ouvre sa fiche : statistiques, destination, slug
additionnel, mot de passe, expiration, suppression.

**Les réglages** (l'engrenage, en haut à droite) gèrent les domaines courts, la
longueur des codes générés, l'expiration par défaut et les deux comportements
de presse-papier.

---

## Installation

### Ce qu'il faut

- Un NAS avec Docker (Container Manager sur Synology, ou Arcane, ou Portainer)
- PocketID accessible en HTTPS
- Un enregistrement DNS `go.collines.co` pointant sur le NAS

### 1. Déclarer le client dans PocketID

Créez un client OAuth2 :

- **URL de redirection** : `https://go.collines.co/auth/callback`
- **Type** : confidentiel (avec secret)
- Autorisez les comptes qui doivent pouvoir créer des liens

Il n'y a pas de compte à créer dans Collines Go. Si PocketID accorde la
connexion, la personne entre ; si vous lui retirez l'accès dans PocketID, elle
n'entre plus. C'est le seul endroit où l'autorisation se gère.

### 2. Le `docker-compose.yml`

```yaml
services:
  collinesgo:
    image: ghcr.io/collinesfilms/shortify:latest
    container_name: collinesgo
    restart: unless-stopped
    ports:
      - "9018:8080"
    volumes:
      - ./data:/data
    env_file:
      - .env
```

### 3. Le `.env`, à côté

```env
CG_BASE_URL=https://go.collines.co
CG_SHORT_DOMAINS=go.collines.co

CG_OIDC_ISSUER=https://id.collines.co
CG_OIDC_CLIENT_ID=
CG_OIDC_CLIENT_SECRET=

CG_SESSION_KEY=

CG_TRUST_PROXY=true
TZ=Europe/Paris
```

| Variable | À quoi ça sert |
|---|---|
| `CG_BASE_URL` | Adresse publique de l'interface. Sert aussi de domaine court. |
| `CG_SHORT_DOMAINS` | Domaines courts, séparés par des virgules. Le premier est celui par défaut. |
| `CG_OIDC_ISSUER` | L'URL de PocketID. |
| `CG_OIDC_CLIENT_ID` / `_SECRET` | Le client créé à l'étape 1. |
| `CG_SESSION_KEY` | 32 caractères aléatoires : `openssl rand -hex 32`. S'il change, tout le monde est déconnecté — les liens, eux, ne bougent pas. |
| `CG_TRUST_PROXY` | `true` derrière le proxy de Synology. Sert à limiter les tentatives de mot de passe ; l'adresse n'est jamais enregistrée. |

Le serveur vérifie tout au démarrage et refuse de partir en listant ce qui
manque, plutôt que d'échouer à la première connexion.

### 4. Le proxy inverse de Synology

**Panneau de configuration → Portail de connexion → Proxy inverse → Créer**

| | |
|---|---|
| Source | `https://go.collines.co`, port `443`, HSTS activé |
| Destination | `http://localhost`, port `9018` |

Dans **En-têtes personnalisés**, ajoutez le jeu **WebSocket** (il pose
`Upgrade` et `Connection`, sans conséquence ici) — surtout, laissez Synology
transmettre `Host` et `X-Forwarded-For`, ce qu'il fait par défaut. L'en-tête
`Host` n'est pas décoratif : c'est lui qui indique sur quel domaine court le
slug doit être cherché.

Le certificat se gère dans **Panneau de configuration → Sécurité →
Certificat**, avec Let's Encrypt.

### 5. Démarrer

Le conteneur ne tourne pas en root : le dossier de données doit lui appartenir.

```sh
mkdir -p data && sudo chown -R 10001:10001 data
docker compose up -d
docker compose logs -f
```

Puis ouvrez `https://go.collines.co` et connectez-vous avec PocketID.

> **L'image est publiée sur GHCR.** Si le dépôt est privé, le paquet l'est
> aussi : rendez-le public dans **GitHub → Packages → shortify → Package
> settings**, ou connectez le NAS avec
> `docker login ghcr.io -u <utilisateur>` et un jeton personnel ayant la portée
> `read:packages`.

---

## Au quotidien

### Ajouter un domaine plus court

1. Faites pointer le DNS du nouveau domaine sur le NAS
2. Ajoutez une règle de proxy inverse vers le même port `9018`
3. Ajoutez le certificat
4. Dans **Réglages → Domaines**, ajoutez-le et marquez-le par défaut si besoin

Les liens déjà créés gardent le domaine sur lequel ils sont nés : rien ne casse.
Les nouveaux utilisent le domaine par défaut.

### Sauvegarder

Copiez `data/collinesgo.db` (et ses fichiers `-wal` et `-shm` s'ils existent).
C'est tout l'état de l'application : les liens, les statistiques, les sessions.

### Mettre à jour

```sh
docker compose pull && docker compose up -d
```

Le schéma de base est appliqué au démarrage. Aucune migration à lancer à la main.

---

## Comment c'est fait

Un seul binaire Go, une seule base SQLite, aucune autre dépendance. L'interface
compilée est embarquée dans le binaire : ce qui est déployé est un fichier.

Quelques décisions qui expliquent le comportement :

**Les redirections sont toujours des 302, jamais des 301.** Un 301 est mis en
cache définitivement par les navigateurs et les proxies. Réactiver un lien
expiré ou changer sa destination échouerait alors silencieusement, précisément
pour les gens qui l'avaient déjà ouvert.

**Un slug n'est jamais réattribué.** Supprimer un lien le retire du service mais
garde son slug occupé pour toujours. Sans ça, un lien distribué au trimestre
dernier enverrait un étudiant vers une destination inattendue.

**Les codes générés évitent les caractères qu'on recopie mal** — pas de `i`, `l`,
`o`, `0`, `1` — et la recherche est insensible à la casse : `go.collines.co/X7KQ2`
fonctionne aussi.

**Les liens protégés affichent une page à leur propre adresse**, pas ailleurs. Le
mot de passe est stocké haché (bcrypt) et les tentatives sont limitées, pour
qu'un lien protégé ne devienne pas un jeu de devinettes.

**Les statistiques ne suivent personne.** Le compteur d'ouvertures distingue les
visiteurs par une empreinte salée dont le sel change chaque jour et n'est jamais
conservé : impossible de la recalculer ou de suivre quelqu'un d'un jour sur
l'autre. Aucune adresse IP n'est enregistrée, aucun cookie n'est posé sur le
chemin de redirection.

**Les polices sont auto-hébergées.** Les pages d'erreur sont ce que chargent les
étudiants ; elles n'ont pas à contacter un service tiers pour annoncer qu'un lien
a expiré.

**Le service worker ne met en cache que l'interface.** Toute autre navigation
passe directement au réseau. Un cache qui répondrait à la place d'une redirection
casserait des liens déjà distribués, silencieusement, et seulement pour les gens
qui utilisent l'interface.

**Les codes QR sont générés sur place**, sans bibliothèque tierce, et vérifiés
module par module contre une implémentation de référence.

---

## Développement

Go 1.25 et Node 22.

```sh
npm --prefix web ci
npm --prefix web run build     # le binaire embarque web/dist
go run ./cmd/collinesgo
```

Pour travailler sur l'interface, `npm --prefix web run dev` sert le front avec
rechargement à chaud et redirige `/api` et `/auth` vers le `go run` sur :8080.

```sh
go test ./...                  # base de données et comportement HTTP
npm --prefix web run typecheck
```

```
cmd/collinesgo      point d'entrée, configuration, arrêt propre
internal/config     variables d'environnement, validées d'un bloc au démarrage
internal/store      SQLite : schéma, liens, slugs, ouvertures
internal/auth       connexion PocketID (OIDC + PKCE) et sessions
internal/httpx      API, chemin de redirection, pages visiteur
web/                interface React, embarquée dans le binaire
design/             le prototype ayant servi à valider l'interface
```

L'image est construite par GitHub Actions à chaque poussée sur `main` et
publiée sur `ghcr.io/collinesfilms/shortify` en amd64 et arm64.

---

## Dépannage

**« configuration: ... is required » au démarrage.** Une variable manque dans le
`.env`. Le message liste tout ce qui manque d'un coup.

**La connexion boucle ou renvoie une erreur.** Vérifiez que l'URL de redirection
déclarée dans PocketID est exactement `https://go.collines.co/auth/callback`, et
que `CG_BASE_URL` ne comporte pas de barre oblique finale.

**Un lien renvoie « Ce lien n'existe pas » alors qu'il existe.** Le proxy inverse
ne transmet probablement pas l'en-tête `Host` : c'est lui qui détermine le
domaine court sur lequel chercher le slug.

**L'interface s'affiche mais reste vide.** Le binaire a été construit sans
`web/dist`. La page le dit explicitement — les redirections, elles, fonctionnent
déjà.

**« impossible d'ouvrir la base ».** Le dossier `data/` n'appartient pas à
l'utilisateur du conteneur : `sudo chown -R 10001:10001 data`.

**Repartir de zéro.** Arrêtez le conteneur et supprimez `data/`. Tout est là.
