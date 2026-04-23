# Catalogue Vestimentaire — Société des régates Rennaises

Boutique en ligne statique permettant aux membres du club de commander leurs vêtements. Le site est généré par un script de build Python à partir d'un fichier YAML unique, puis servi par nginx dans une image Docker non-root.

## Fonctionnalités

- Catalogue de produits organisé par catégorie (6 catégories fournies par défaut).
- Filtres par public (**Hommes / Femmes / Mixtes / Enfants**) et par catégorie.
- Variantes par genre avec leur propre prix, leur propre grille de tailles et un SKU fournisseur par couple (genre × couleur).
- Choix du modèle (genre), de la taille, de la couleur et de la quantité.
- Panier persistant pendant la session, drawer latéral.
- Génération d'un **bon de commande PDF** (téléchargé côté navigateur). En-tête sobre avec logo détaillé, sans bandeau coloré plein, pour une impression économe en encre.
- Enregistrement automatique de la commande dans un **Google Sheet** via un endpoint Google Apps Script. L'URL n'est PAS dans le YAML : elle est injectée au démarrage du conteneur via une variable d'environnement.
- **Mode sombre / clair** automatique (préférence système) avec bouton de bascule persistant.
- **Catalogue PDF téléchargeable** depuis l'en-tête du site, régénéré à chaque build.
- Design responsive, couleurs du club (noir / rouge / blanc).

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
├── css/style.css                Feuille de style (mode clair/sombre)
├── js/
│   ├── app.js                   Logique de la boutique (catalogue, panier, PDF)
│   ├── products-data.js         (généré au build — ne pas éditer)
│   └── runtime-config.js        (généré au démarrage par l'entrypoint Docker)
├── index.html                   Coquille HTML (chargée telle quelle par nginx)
├── nginx.conf                   Config du serveur
├── docker/
│   └── docker-entrypoint.sh     Injecte GOOGLE_SCRIPT_URL au démarrage
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

## Structure d'un produit dans `products.yaml`

```yaml
- nom: "Tee-shirt technique SRR"
  categorie: tee_technique           # doit correspondre à un id de catégories
  marque: "Kappa"
  collection: "Collection 2024"
  modele: "Kombat Veneto"
  images: ["tee-technique-srr.jpg"]
  description: "…"                   # facultatif
  couleurs: ["Noir", "Rouge"]        # liste des couleurs dispo pour ce modèle

  genres:                            # 1 à 4 variantes parmi hommes/femmes/mixtes/enfants
    hommes:
      prix: 28.00                    # prix €/unité pour la variante
      tailles: ["S", "M", "L", "XL", "XXL"]
      sku:                           # 1 SKU par couleur disponible pour ce genre
        Noir:  "KAP-KOMB-H-NR"
        Rouge: "KAP-KOMB-H-RG"
    femmes:
      prix: 28.00
      tailles: ["XS", "S", "M", "L", "XL"]
      sku:
        Noir:  "KAP-KOMB-F-NR"
        Rouge: "KAP-KOMB-F-RG"
```

Règles de validation (vérifiées par `build.py`) :

- Chaque genre doit faire partie de `hommes | femmes | mixtes | enfants`.
- Chaque variante de genre doit avoir `prix`, `tailles` (liste non vide) et `sku` (dict non vide).
- Chaque clé de `sku` doit figurer dans la liste `couleurs` du produit.
- Les références SKU doivent être globalement uniques dans tout le catalogue.

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

| Variable            | Rôle                                                                 | Défaut                            |
|---------------------|----------------------------------------------------------------------|-----------------------------------|
| `GOOGLE_SCRIPT_URL` | URL de l'Apps Script (enregistrement Google Sheets). Vide = PDF seul. | *(vide)*                          |
| `CLUB_EMAIL`        | Surcharge l'email de contact affiché dans le PDF de commande.         | valeur YAML `boutique.email_contact` |
| `CLUB_IBAN`         | Surcharge l'IBAN affiché dans le popup de confirmation et le PDF.     | valeur YAML `boutique.iban`       |

### docker-compose

```bash
# Définir les variables dans un fichier .env ou directement dans l'environnement
export GOOGLE_SCRIPT_URL="https://script.google.com/macros/s/XXXX/exec"
export CLUB_EMAIL="contact@mon-club.fr"

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
5. Exécuter la fonction `initialiserFeuilles` une fois (accepter les permissions). Les feuilles `Commandes` et `Détail articles` sont créées avec leurs en-têtes.
6. **Déployer → Nouveau déploiement** → type *Application Web* → exécution *en tant que Moi* → accès *Tout le monde*.
7. Copier l'URL qui se termine par `/exec`.
8. La passer à Docker via la variable `GOOGLE_SCRIPT_URL` (cf. ci-dessus).

> Si `GOOGLE_SCRIPT_URL` est vide, la boutique génère uniquement le PDF et ne tente aucun envoi.

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
→ Vérifier les noms dans `config/products.yaml` vs les fichie