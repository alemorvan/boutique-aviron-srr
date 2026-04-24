# Boutique en ligne de la société des Régates Rennaises

Je voudrais créer une page web de boutique en ligne pour mon club d'aviron avec la possibilité de passer une commande

Le club s'appelle "Société des régates Rennaises"

Je veux que cette page s'appelle "Catalogue Vestimentaire".

Les couleurs du club sont :

- Noir, 
- Rouge 
- et Blanc.

Le logo du club est dans le dossier assets

- le fichier "logo_simple.png" est une version allégée du logo
- le fichier "logo_detailles.jpg" est une version plus complète, avec du texte, à destination des en-têtes de documents pdf
 
J'ai plusieurs catégorie de Vêtements : 

- tee shirts techniques
- tee shirts en coton
- tee shirts en polyestère
- vestes d'entrainements
- pantalon
- accessoires (casquettes, chaussettes)

## Fonctionnalités

Je voudrais qu'un utilisateur puisse ajouter à son panier les vêtements qui l'intéressent et que cela lui génère un bon de commande en PDF.

Le prix des articles sera affiché.

Un article peut être proposé ou non dans une ou plusieurs catégories de genre : 

- hommes
- femmes
- mixtes
- enfants

Chaque couple Article/Genre dispose de sa propre liste de tailles quelque soit la couleur de l'article.

Chaque article peut être proposé dans une ou plusieurs couleurs.
Chaque couple article/genre/couleur dispose de son numéro d'identification fournisseur.

L'utilisateur devra choisir parmi une liste de tailles (S, M, L, XL, etc.).

Un filtre par public (hommes/femmes/enfants) et par catégorie sera disponible

L'utilisateur devra sélectionner la taille + couleur + quantité

Panier latéral persistant

Je voudrais aussi qu'un fichier google sheet accessible en lecture/écriture soit automatiquement renseigné.
Script Google Apps Script prêt à déployer — crée deux feuilles (Commandes + Détail articles) et enregistre chaque commande automatiquement.

Je voudrais qu'un catalogue téléchargeable en PDF, généré lors du build, soit téléchargeable.
Pour chaque article, nous aurons un affichage semblable à celui-ci : 

```
Nom de l'article
Marque - Collection XXXX
Existe en COULEUR1, COULEUR2, ...
Modèle HOMMES/FEMMES/ENFANTS
Tailles Adulte : S, M, L, XL, 2XL – XX€ TTC (prix du modèle et du genre)
Tailles Enfant : 3XS, 2XS, XS – XX€ TTC (prix du modèle et du genre)

Pour finaliser la commande, l'utilisateur devra fournir :

- son nom
- son prénom
- email
- numéro de téléphone
- sa catégorie de rameur

L'en tête du document PDF contiendra le logo détaillé des régates, sans fond coloré pour limiter les couts d'impression. 
Génération d'un bon de commande PDF professionnel avec logo texte, tableau d'articles et total

Design responsive (mobile / desktop) avec switch couleurs sombres/claires (persistance du choix de thème sur le localstorage).

Lors de la validation de la commande, je voudrais ajouter des informations dans le popup mais également dans le PDF : 

```
Laisser un message sur le groupe « Boutique » de notre WhatsApp pour prévenir de votre commande

Règlement de la commande :
Par chèque, à l’ordre de : « Société des Régates Rennaises » et à déposer dans la boîte aux lettres devant le bureau de notre entraîneur.
Par virement SEPA à l’IBAN suivant : FRXX XXXX XXXXX XXXX XXXX XXXX XXX
```

Le numéro IBAN doit être lui aussi variabilisé.

## Configuration du site

La configuration de la boutique se fait dans un fichier yaml.

La première partie de ce fichier sert à la configuration de la boutique :

- le nom du club
- le nom interne de la boutique
- l'adresse mail de contact
- la devise '€'
- le chemin vers les logos (relatif au dossier assets)
  - logo_simple = en-tête du site
  - logo_detaille = en-tête des PDF
- les catégories de vetements disponibles

Les articles de la boutique pourront être gérés via ce fichier de configuration en yaml contenant une liste d'articles : 

- le nom de l'article
- la catégorie de vêtement (technique, coton, polyestere, etc.)
- la marque
- la collection fournisseur
- le modèle fournisseur
- une description
- les genres disponibles hommes, femmes, mixtes, ou enfants
- les couleurs
- la référence fournisseur (non visible des utilisateurs). Il y a une référence par couple modèle/couleur/genre (homme, femme, mixte, enfant). Un article homme ou mixte et un article enfant doivent pouvoir avoir le même sku mais être gérés séparéments.
- le nom d'une ou plusieurs images que je stockerai dans le dossier image du projet. Les images pourront défilées dans la fiche article manuellement (carroussel).
- la liste des tailles pour chaque couple modèle/genre
- la liste des couleurs disponibles pour chaque modèle

Le yaml ne doit service que pour la génération des pages statiques. Il ne doit pas êter incorporé au site web final.

Ce fichier de configuration sera fourni sous forme de template.

L'URL du google sheet devra être fourni en variable dans le docker-compose.yml ou sous forme de variable d'environnement.

## Page d'administration

Un module d'administration viendra compléter la boutique dans une page séparée /admin.html.

- Protection par mot de passe (défini dans les variables d'environnements). Le mot de passe est géré côté client.
- Liste des commandes en cours issue du document google sheet (avec export excel possible),
- liste des articles à commander issue du document google sheet (avec export excel possible)
- Possibilité de passer les commandes à en cours, livrée, distributée, terminée (avec mise à jour du document google sheet)
- Possibilité de marquer les articles commandés à reçu, distribués (avec mise à jour du document google sheet)

Un catalogue d'achat avec pour chaque article/genre.
Affichage sous forme tabulaire avec possibilité d'export excel.

Il faudra ajouter dans le fichier products.yaml : 

- le prix d'achat
- le taux de réduction (par défaut 40%)
- le type de flocage (rien, coeur, dos, coeur et dos)
- le prix de vente final

Il faudra calculer automatiquement et ajouter dans la page catalogue d'achat :

- le prix réduit
- le coût du flocage 
- le prix margé ( (prix réduit + coût flocage) +20%)
- la marge effective (prix margé - (prix réduit + couût flocage) )

Pour calculer le cout du flocage, il va falloir ajouter des variables dans le fichier products.yaml : 

- 0€ pour "rien"
- 2,5€ pour le flocage coeur
- 6€ pour le flocage dos

## Livrables

Le site sera livré sous le format docker.
Un script python permettra de générer les fichiers statiques depuis les templates et le fichier de configuration yaml.

Il sera composé d'une page statique + Google Apps Script






