# Catalogue Vestimentaire — Société des régates Rennaises

**Version 2.0.0** — ajoute le module d'administration (catalogue d'achat, suivi des commandes, articles à commander) et un nouveau schéma YAML orienté marges.

Boutique en ligne statique permettant aux membres du club de commander leurs vêtements. Le site est généré par un script de build Python à partir d'un fichier YAML unique, puis servi par nginx dans une image Docker non-root.

## Fonctionnalités

### Côté public (`/`)

- Catalogue de produits organisé par catégorie.
- Filtres par public (**Hommes / Femmes / Mixtes / Enfants**) et par catégorie.
- Variantes par genre avec leur propre grille de tailles et un SKU fournisseur par couple (genre × couleur). Le prix affiché est le **prix de vente final** défini dans le YAML.
- Choix du modèle (genre), de la taille, de la couleur et de la quantité.
- Panier persistant pendant la session, drawer latéral.
- Génération d'un **bon de commande PDF** (téléchargé côté navigateur). En-tête sobre avec logo détaillé, sans bandeau coloré plein, pour une impression économe en encre.
- Enregistrement automatique de la commande dans un **Google Sheet** via un endpoint Google Apps Script.
- **Mode sombre / clair** automatique (préférence système) avec bouton de bascule persistant.
- **Catalogue PDF téléchargeable** depuis l'en-tête du site, régénéré à chaque build.
- Design responsive, couleurs du club (noir / rouge / blanc).

### Module d'administration (`/admin.html`)

- **Protection par mot de passe** (variable d'environnement `ADMIN_PASSWORD`). Rappel : gate UX seulement, le mot de passe est servi en clair dans `runtime-config.js` — ne jamais réutiliser un mot de passe sensible.
- **Catalogue d'achat** : tableau de toutes les variantes avec prix d'achat, remise fournisseur, prix remisé, type de flocage, coût du flocage, prix margé (+20%), prix de vente final et marge effective. Recherche et filtres par genre / flocage. **Export Excel**.
- **Commandes en cours** : liste des commandes lues depuis Google Sheets, KPIs, recherche, filtre par statut, bascule du statut (`Nouvelle → En cours → Livrée → Distribuée → Terminée`) avec mise à jour du Sheet en temps réel. **Export Excel**.
- **Articles à commander** : agrégation par référence / taille / couleur (tous clients confondus). Marquage « reçu » / « distribué » à l'échelle de l'agrégat, propagé dans Google Sheets. **Export Excel**.

## Structure du projet

```
Boutique Aviron/
├── config/
│   └── products.yaml            ⭐ Template de config — PAS servi au public
├── build/
│   ├── build.py                 Script de build : YAML → site statique + PDF
│   └── requirements.txt         PyYAML, reportlab, pillow
├── assets/
│   ├── logo_simple.png          Logo pour l'en-tête du site
│   └── logo_detailles.jpg       Logo pour les PDF (bon de commande + catalogue)
├── images/produits/             Photos produits (noms référencés dans le YAML)
├── css/
│   ├── style.css                Feuille de style publique (mode clair/sombre)
│   └── admin.css                Styles spécifiques au module admin
├── js/
│   ├── app.js                   Logique de la boutique publique
│   ├── admin.js                 Logique du module d'administration
│   ├── products-data.js         Données publiques    (généré — ne pas éditer)
│   ├── admin-data.js            Catalogue d'achat    (généré — ne pas éditer)
│   └── runtime-config.js        Config runtime       (généré au démarrage Docker)
├── index.html                   Boutique publique
├── admin.html                   Module d'administration
├── nginx.conf                   Config du serveur
├── docker/
│   └── docker-entrypoint.sh     Injecte les variables d'env au démarrage
├── docker-compose.yml           Orchestration locale
├── Dockerfile                   Multi-stages (build Python + serve nginx)
├── google-apps-script/
│   └── Code.gs                  Endpoint Google Apps Script
└── README.md
```

## Principe de fonctionnement

1. **Template YAML** — tout le catalogue (produits, prix par genre, tailles par genre, SKU par couleur, catégories, coordonnées du club) vit dans `config/products.yaml`. Ce fichier n'est **jamais** servi au public.
2. **Build** — `build/build.py` lit le YAML, valide sa structure, puis génère :
   - `dist/js/products-data.js` (une variable globale `window.PRODUCTS_DATA` embarquée dans le HTML),
   - `dist/catalogue.pdf` (catalogue imprimable au format A4),
   - `dist/` contient également les fichiers statiques (HTML, CSS, JS, assets, images).
3. **Image Docker** — le Dockerfile exécute `build.py` dans un stage Python, puis copie `dist/` dans une image nginx-unprivileged. L'URL du script Apps Script est injectée au démarrage dans `js/runtime-config.js` par `docker-entrypoint.sh`.

## Structure d'un produit dans `products.yaml` (schéma v2)

Deux niveaux globaux s'ajoutent aux produits :

```yaml
# Tarifs de flocage appliqués par le catalogue d'achat
flocage:
  rien: 0.00
  coeur: 2.50
  dos: 6.00
  coeur_et_dos: 8.50
```

Puis chaque produit :

```yaml
- nom: "Tee-shirt technique SRR"
  categorie: tee_technique
  marque: "Kappa"
  collection: "Collection 2024"
  modele: "Kombat Veneto"
  images: ["tee-technique-srr.jpg"]
  description: "…"
  couleurs: ["Noir", "Rouge"]

  genres:                              # 1 à 4 variantes parmi hommes/femmes/mixtes/enfants
    hommes:
      prix_achat: 14.00                # prix fournisseur HT
      taux_reduction: 0.40             # remise fournisseur (0 à <1)
      type_flocage: "coeur"            # rien | coeur | dos | coeur_et_dos
      prix_vente_final: 28.00          # prix affiché au public
      tailles: ["S", "M", "L", "XL", "XXL"]
      sku:
        Noir:  "KAP-KOMB-H-NR"
        Rouge: "KAP-KOMB-H-RG"
```

Le **catalogue d'achat** (page admin) calcule automatiquement pour chaque
variante :

| Champ calculé     | Formule                                                  |
|-------------------|----------------------------------------------------------|
| `prix_reduit`     | `prix_achat * (1 - taux_reduction)`                      |
| `cout_flocage`    | valeur lue dans `flocage[type_flocage]`                  |
| `prix_marge`      | `(prix_reduit + cout_flocage) * 1.20`                    |
| `marge_effective` | `prix_vente_final - (prix_reduit + cout_flocage)`        |

Règles de validation (vérifiées par `build.py`) :

- Le bloc `flocage` doit exister et définir les 4 types (`rien`, `coeur`, `dos`, `coeur_et_dos`).
- Chaque genre doit faire partie de `hommes | femmes | mixtes | enfants`.
- Chaque variante doit avoir `prix_achat` (≥0), `taux_reduction` (∈[0, 1[), `type_flocage` (valeur valide), `prix_vente_final` (>0), `tailles` et `sku`.
- Chaque clé de `sku` doit figurer dans la liste `couleurs` du produit.
- Les SKU doivent être uniques **dans leur bucket** (`adultes` = hommes/femmes/mixtes, `enfants` = enfants). Un article adulte et un article enfant peuvent donc partager le même SKU fournisseur.

## Build local (sans Docker)

```bash
# Installer les dépendances
pip install -r build/requirements.txt

# Générer le site dans ./dist
python3 build/build.py --source . --output dist

# Tester en local
cd dist && python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

Le bon de commande sera généré mais l'enregistrement Google Sheets sera inactif (pas de `GOOGLE_SCRIPT_URL` défini). Pour tester l'enregistrement, modifier localement `dist/js/runtime-config.js` (qui n'existe qu'en environnement Docker) ou simplement ajouter une balise `<script>window.RUNTIME_CONFIG={googleScriptUrl:"…"};</script>` avant `app.js` dans `dist/index.html`.

## Docker

### Build et lancement

```bash
# Build (déclenche automatiquement le stage Python puis le stage nginx)
docker build -t boutique-srr .

# Lancement sans Google Sheets (PDF uniquement)
docker run --rm -p 8080:8080 boutique-srr

# Avec Google Sheets :
docker run --rm -p 8080:8080 \
  -e GOOGLE_SCRIPT_URL="https://script.google.com/macros/s/XXXX/exec" \
  -e CLUB_EMAIL="contact@mon-club.fr" \
  boutique-srr
```

Ouvrir [http://localhost:8080](http://localhost:8080).

### Variables d'environnement

| Variable            | Rôle                                                                          | Défaut                               |
|---------------------|-------------------------------------------------------------------------------|--------------------------------------|
| `GOOGLE_SCRIPT_URL` | URL de l'Apps Script (enregistrement + admin). Vide = PDF seul.               | *(vide)*                             |
| `CLUB_EMAIL`        | Surcharge l'email de contact affiché dans le PDF de commande.                 | valeur YAML `boutique.email_contact` |
| `CLUB_IBAN`         | Surcharge l'IBAN affiché dans le popup de confirmation et le PDF.             | valeur YAML `boutique.iban`          |
| `ADMIN_PASSWORD`    | Mot de passe d'accès à `/admin.html`. Vide = page admin verrouillée.          | *(vide)*                             |

> ⚠️ `ADMIN_PASSWORD` est injecté dans `runtime-config.js` **servi en clair** au navigateur. C'est donc un *gate UX*, pas un vrai contrôle d'accès — ne jamais réutiliser un mot de passe sensible. Si vous avez besoin d'un vrai contrôle d'accès, placez la boutique derrière une authentification nginx/basic-auth ou un proxy IAM.

### docker-compose

```bash
# Définir les variables dans un fichier .env ou directement dans l'environnement
export GOOGLE_SCRIPT_URL="https://script.google.com/macros/s/XXXX/exec"
export CLUB_EMAIL="contact@mon-club.fr"
export ADMIN_PASSWORD="mot-de-passe-court-non-sensible"

docker compose up -d --build   # build + démarrage
docker compose logs -f         # suivre les logs
docker compose down            # arrêter
```

Le `docker-compose.yml` lit `GOOGLE_SCRIPT_URL` et `CLUB_EMAIL` depuis l'environnement (ou le fichier `.env` à côté du `compose.yml`).

### Modifier le catalogue

Plus de volumes partagés : le YAML est un template **embarqué dans l'image au moment du build**. Pour publier une modification :

```bash
# 1. Éditer config/products.yaml
# 2. Rebuilder
docker compose build
# 3. Relancer
docker compose up -d
```

## Configurer le Google Sheet

1. Créer un nouveau Google Sheet (ex. `Commandes Boutique SRR`).
2. Ouvrir **Extensions → Apps Script**.
3. Coller le contenu de `google-apps-script/Code.gs` dans le fichier `Code.gs`.
4. Enregistrer (icône disquette).
5. Exécuter la fonction `initialiserFeuilles` une fois (accepter les permissions). Les feuilles `Commandes` et `Détail articles` sont créées avec leurs en-têtes (incluant les colonnes `Reçu` et `Distribué` pour le suivi admin).
6. **Déployer → Nouveau déploiement** → type *Application Web* → exécution *en tant que Moi* → accès *Tout le monde*.
7. Copier l'URL qui se termine par `/exec`.
8. La passer à Docker via la variable `GOOGLE_SCRIPT_URL` (cf. ci-dessus).

> Si `GOOGLE_SCRIPT_URL` est vide, la boutique génère uniquement le PDF et ne tente aucun envoi. Le module admin reste consultable pour le catalogue d'achat (statique) mais les onglets *Commandes* et *Articles à commander* seront vides.

> À chaque évolution de `Code.gs` il faut **redéployer** la web app : *Gérer les déploiements → Modifier → Nouvelle version*, puis l'URL `/exec` reste la même.

## Personnalisation rapide

- **Couleurs** : variables CSS dans `css/style.css` (section `:root` et `[data-theme="dark"]`).
- **Catégories de rameurs** : `<select id="categorie-rameur">` dans `index.html`.
- **Pied de page** : `<footer>` dans `index.html`.
- **En-tête PDF** : fonction `generatePDF` dans `js/app.js`.
- **Format du catalogue PDF** : fonctions `_build_product_cell` / `build_catalog_pdf` dans `build/build.py`.

## Dépannage

**Le catalogue ne se charge pas**
→ Vérifier que `products-data.js` a bien été généré (console navigateur : `window.PRODUCTS_DATA`).

**Les images produits ne s'affichent pas**
→ Vérifier les noms dans `config/products.yaml` vs les fichiers présents dans `images/produits/`.

**La page `/admin.html` refuse tous les mots de passe**
→ La variable `ADMIN_PASSWORD` est vide : positionnez-la (via `.env`, `-e`, ou le secret store de Netlify/Docker) et relancez le conteneur.

**Les onglets Commandes / Articles ne s'affichent pas dans l'admin**
→ `GOOGLE_SCRIPT_URL` n'est pas définie **ou** le script Apps Script n'a pas été redéployé après l'ajout des actions `list_orders`, `list_items`, `update_order_status`, `update_item_reception`, `update_item_distribution`. Redéployer la web app après avoir collé la dernière version de `Code.gs`.

**Erreur « Commande introuvable » au changement de statut**
→ Le numéro de commande a été modifié manuellement dans la colonne B de la feuille *Commandes*. Restaurer la valeur envoyée par la boutique.

---

## Changelog

### v2.0.0

- Module d'administration (`/admin.html`) avec gate par mot de passe.
- Onglet **Catalogue d'achat** : calcul automatique prix remisé, coût flocage, prix margé (+20%), marge effective. Export Excel.
- Onglet **Commandes en cours** : lecture Google Sheets, KPIs, bascule de statut (Nouvelle → En cours → Livrée → Distribuée → Terminée). Export Excel.
- Onglet **Articles à commander** : agrégation par référence/taille/couleur, marquage *Reçu* / *Distribué*. Export Excel.
- Nouveau schéma YAML : `prix_achat`, `taux_reduction`, `type_flocage`, `prix_vente_final`. Remplace l'ancien champ `prix`.
- Bloc global `flocage:` pour les tarifs de flocage (rien / cœur / dos / cœur+dos).
- Apps Script étendu avec les actions `list_orders`, `list_items`, `update_order_status`, `update_item_reception`, `update_item_distribution` et deux colonnes supplémentaires (`Reçu`, `Distribué`) dans la feuille *Détail articles*.
- Nouvelle variable d'env `ADMIN_PASSWORD`.
- Séparation des données : `products-data.js` (public, filtré) et `admin-data.js` (données d'achat + calculs).
- Correction nginx : suppression des `Types` en double au démarrage.
- Libellés : catégories rameur *Senior → Sénior*, *Vétéran → Master*.
- Les retours à la ligne dans les descriptions produit sont préservés à l'affichage.
- Message de confirmation mis à jour : "Votre bon de commande a été téléchargé et une copie nous a été transmise".

### v1.x

Cf. historique Git. Principales jalons : structure multi-genres, SKU partagé adulte/enfant, carrousel d'images manuel, catalogue PDF, mode sombre, extraction depuis le DOCX fournisseur.