# lab. · lab.marill.dev

Le carnet de manips de Damien Marill : la page d'accueil liste automatiquement
tous mes dépôts publics qui ont une page GitHub Pages.

## Comment ça marche

Le workflow `.github/workflows/lab.yml` lance `scripts/build.mjs` :

- à chaque push sur `main` ;
- toutes les 6 heures (un nouveau dépôt avec Pages apparaît donc tout seul) ;
- à la main : onglet **Actions → Labo → Run workflow**.

Le script :

1. récupère les dépôts du compte via l'API GitHub et garde ceux qui ont Pages (hors forks) ;
2. sonde chaque page publiée : statut, URL finale (domaines perso compris), `<title>`, meta description ;
3. photographie chaque page avec Chrome, et génère l'image de partage (`og.jpg`) ;
4. génère `dist/` (HTML statique, CSS, `projects.json`) et le publie sur Pages.

La source Pages du dépôt doit être réglée sur **GitHub Actions** (Settings → Pages).

## Remplir une fiche de manip

Tout se règle depuis le panneau **About** de chaque dépôt :

| Champ GitHub | Effet sur la fiche |
| --- | --- |
| Description | Texte de la fiche (sinon : meta description de la page) |
| Website | Lien utilisé si le projet vit sur un autre domaine |
| Topics | Étiquettes `#topic` affichées sur la fiche |
| Topic `lab-hidden` | Retire le dépôt du carnet |
| Topic `lab-pin` | Épingle le dépôt en haut de page |

Sans toucher au dépôt concerné, `lab.config.json` accepte des surcharges par nom
de dépôt : `title`, `description`, `language`, `cover`, `pin`, `hidden`.

Le tampon est calculé automatiquement : **en cours** (modifiée il y a moins de 30 jours),
**stable** (moins d'un an), **en sommeil** (plus d'un an), **archivée**, ou **hors ligne**
si la page ne répond plus.

## Identité

« Carnet de manip », dérivé de la charte Marill.dev : on garde la palette
(blouge, sakura, peach, sky, deep-night), Bricolage Grotesque + Lato, le point du logo
et les petites inclinaisons ; on ajoute le papier quadrillé, la marge rose, le scotch,
les tampons et JetBrains Mono pour les annotations. Mode sombre « carnet à la lampe »
automatique. Les jetons de la charte sont dans `src/ds/`, l'identité du labo dans `src/lab.css`.

## En local

```bash
npm install
npm run build            # données réelles (GITHUB_TOKEN conseillé)
npm run build:offline    # données de fixtures/repos.json, sans réseau ni photos
npm run serve
```

## Bon à savoir

GitHub désactive les workflows planifiés d'un dépôt public après 60 jours sans activité.
Si le carnet ne bouge pas pendant deux mois, réactiver le workflow dans l'onglet Actions
(ou le déclencher de l'extérieur via l'API `workflow_dispatch`).
