/**
 * ============================================================
 * Google Apps Script - Boutique SRR
 * Société des régates Rennaises - Catalogue Vestimentaire
 * ============================================================
 *
 * Ce script reçoit les requêtes de la boutique web et gère :
 *   - la création de commandes (depuis index.html)
 *   - la lecture / mise à jour des commandes (depuis admin.html)
 *
 * INSTALLATION :
 *
 * 1. Créer un Google Sheet (ex: "Commandes Boutique SRR")
 * 2. Dans le Sheet : menu Extensions > Apps Script
 * 3. Copier-coller ce code dans le fichier Code.gs
 * 4. Enregistrer (icône disquette)
 * 5. Exécuter une première fois la fonction `initialiserFeuilles`
 *    pour créer les feuilles et en-têtes (accepter les permissions)
 * 6. Déployer : menu Déployer > Nouveau déploiement
 *    - Type : Application Web
 *    - Description : "Boutique SRR"
 *    - Exécuter en tant que : Moi
 *    - Qui a accès : Tout le monde
 * 7. Copier l'URL de déploiement
 * 8. Coller cette URL dans `config/products.yaml` à la ligne
 *    `google_script_url: "..."` (ou via la variable d'env GOOGLE_SCRIPT_URL).
 *
 * Lors de chaque évolution du script : redéployer en choisissant
 * "Gérer les déploiements" > "Modifier" et incrémenter la version.
 * ============================================================
 */

// Noms des feuilles dans le Google Sheet
const FEUILLE_COMMANDES = 'Commandes';
const FEUILLE_DETAIL    = 'Détail articles';

// ============================================================
// Entrée HTTP
// ============================================================

/**
 * Point d'entrée POST — aiguille selon `action` :
 *   - absent   → création d'une commande (flux boutique public)
 *   - "list_orders" / "list_items"
 *   - "update_order_status"
 *   - "update_item_reception" / "update_item_distribution"
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (!action) {
      // Flux public : création d'une commande
      enregistrerCommande(payload);
      return jsonOut({ ok: true, numero: payload.numero });
    }

    switch (action) {
      case 'list_orders':
        return jsonOut({ ok: true, orders: listOrders() });
      case 'list_items':
        return jsonOut({ ok: true, items: listItems() });
      case 'update_order_status':
        updateOrderStatus(payload.numero, payload.statut);
        return jsonOut({ ok: true });
      case 'update_item_reception':
        updateItemFlag(payload, 'recu');
        return jsonOut({ ok: true });
      case 'update_item_distribution':
        updateItemFlag(payload, 'distribue');
        return jsonOut({ ok: true });
      default:
        return jsonOut({ ok: false, error: 'Action inconnue : ' + action });
    }
  } catch (err) {
    console.error('Erreur doPost:', err);
    return jsonOut({ ok: false, error: String(err) });
  }
}

/** Répond aux requêtes GET (utile pour tester le déploiement). */
function doGet() {
  return jsonOut({ ok: true, message: 'Endpoint boutique SRR actif.' });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// Initialisation des feuilles
// ============================================================

/**
 * Crée (ou récupère) les feuilles avec leurs en-têtes.
 * À exécuter une fois avant le premier déploiement.
 * Également idempotent : peut être ré-exécuté pour migrer les
 * feuilles vers le nouveau schéma (ajoute les colonnes Reçu/Distribué).
 */
function initialiserFeuilles() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Feuille Commandes ---
  let shCmd = ss.getSheetByName(FEUILLE_COMMANDES);
  if (!shCmd) shCmd = ss.insertSheet(FEUILLE_COMMANDES);
  if (shCmd.getLastRow() === 0) {
    shCmd.appendRow([
      'Date',
      'N° Commande',
      'Prénom',
      'Nom',
      'Email',
      'Téléphone',
      'Catégorie rameur',
      'Nb articles',
      'Total (€)',
      'Commentaire',
      'Statut',
    ]);
    shCmd.getRange(1, 1, 1, 11)
      .setFontWeight('bold')
      .setBackground('#0f0f10')
      .setFontColor('#ffffff');
    shCmd.setFrozenRows(1);
    shCmd.autoResizeColumns(1, 11);
  }

  // --- Feuille Détail articles ---
  let shDet = ss.getSheetByName(FEUILLE_DETAIL);
  if (!shDet) shDet = ss.insertSheet(FEUILLE_DETAIL);
  if (shDet.getLastRow() === 0) {
    shDet.appendRow([
      'Date',
      'N° Commande',
      'Nom client',
      'Référence',
      'Article',
      'Marque',
      'Taille',
      'Couleur',
      'Quantité',
      'Prix unitaire (€)',
      'Sous-total (€)',
      'Reçu',
      'Distribué',
    ]);
    shDet.getRange(1, 1, 1, 13)
      .setFontWeight('bold')
      .setBackground('#c8102e')
      .setFontColor('#ffffff');
    shDet.setFrozenRows(1);
    shDet.autoResizeColumns(1, 13);
  } else {
    // Migration : ajouter les colonnes Reçu / Distribué si elles n'existent pas.
    const headers = shDet.getRange(1, 1, 1, shDet.getLastColumn())
                         .getValues()[0].map(String);
    if (headers.indexOf('Reçu') === -1) {
      const col = shDet.getLastColumn() + 1;
      shDet.getRange(1, col).setValue('Reçu')
        .setFontWeight('bold').setBackground('#c8102e').setFontColor('#ffffff');
    }
    if (headers.indexOf('Distribué') === -1) {
      const col = shDet.getLastColumn() + 1;
      shDet.getRange(1, col).setValue('Distribué')
        .setFontWeight('bold').setBackground('#c8102e').setFontColor('#ffffff');
    }
  }

  SpreadsheetApp.getUi && SpreadsheetApp.getUi().alert(
    'Feuilles initialisées / mises à jour. Vous pouvez maintenant (re)déployer ce script.'
  );
}

// ============================================================
// Écriture d'une commande
// ============================================================

function enregistrerCommande(cmd) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shCmd = ss.getSheetByName(FEUILLE_COMMANDES) || ss.insertSheet(FEUILLE_COMMANDES);
  const shDet = ss.getSheetByName(FEUILLE_DETAIL)    || ss.insertSheet(FEUILLE_DETAIL);

  if (shCmd.getLastRow() === 0) initialiserFeuilles();

  const date  = new Date(cmd.date || Date.now());
  const c     = cmd.client || {};
  const items = cmd.items  || [];
  const nbArticles = items.reduce(function (s, i) { return s + (i.qty || 0); }, 0);

  // Ligne récapitulative
  shCmd.appendRow([
    date,
    cmd.numero,
    c.prenom || '',
    c.nom || '',
    c.email || '',
    c.telephone || '',
    c.categorieRameur || '',
    nbArticles,
    Number(cmd.total || 0).toFixed(2),
    c.commentaire || '',
    'Nouvelle',
  ]);

  // Une ligne par article (Reçu / Distribué initialisés à faux)
  const nomComplet = (c.prenom || '') + ' ' + (c.nom || '');
  items.forEach(function (i) {
    shDet.appendRow([
      date,
      cmd.numero,
      nomComplet.trim(),
      i.sku || i.reference || '',
      i.nom || '',
      i.marque || '',
      i.taille || '',
      i.couleur || '',
      i.qty || 0,
      Number(i.prix || 0).toFixed(2),
      (Number(i.prix || 0) * Number(i.qty || 0)).toFixed(2),
      false,
      false,
    ]);
  });
}

// ============================================================
// Lecture (admin)
// ============================================================

function listOrders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(FEUILLE_COMMANDES);
  if (!sh || sh.getLastRow() < 2) return [];
  const range = sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues();
  return range.map(function (row) {
    return {
      date:            row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ''),
      numero:          String(row[1] || ''),
      prenom:          String(row[2] || ''),
      nom:             String(row[3] || ''),
      email:           String(row[4] || ''),
      telephone:       String(row[5] || ''),
      categorieRameur: String(row[6] || ''),
      nbArticles:      Number(row[7]) || 0,
      total:           Number(row[8]) || 0,
      commentaire:     String(row[9] || ''),
      statut:          String(row[10] || 'Nouvelle'),
    };
  }).filter(function (o) { return o.numero; });
}

function listItems() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(FEUILLE_DETAIL);
  if (!sh || sh.getLastRow() < 2) return [];
  const colCount = Math.max(sh.getLastColumn(), 13);
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, colCount).getValues();
  return rows.map(function (row) {
    return {
      date:      row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ''),
      numero:    String(row[1] || ''),
      client:    String(row[2] || ''),
      reference: String(row[3] || ''),
      article:   String(row[4] || ''),
      marque:    String(row[5] || ''),
      taille:    String(row[6] || ''),
      couleur:   String(row[7] || ''),
      qty:       Number(row[8]) || 0,
      prix:      Number(row[9]) || 0,
      soustotal: Number(row[10]) || 0,
      recu:      row[11] === true || String(row[11]).toLowerCase() === 'vrai',
      distribue: row[12] === true || String(row[12]).toLowerCase() === 'vrai',
    };
  }).filter(function (it) { return it.numero; });
}

// ============================================================
// Mise à jour (admin)
// ============================================================

/**
 * Met à jour la colonne "Statut" (col 11) d'une commande.
 */
function updateOrderStatus(numero, statut) {
  if (!numero || !statut) throw new Error('numero et statut requis');
  const VALIDES = ['Nouvelle', 'En cours', 'Livrée', 'Distribuée', 'Terminée'];
  if (VALIDES.indexOf(statut) === -1) {
    throw new Error('Statut invalide : ' + statut);
  }
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_COMMANDES);
  if (!sh) throw new Error('Feuille Commandes introuvable');
  const numCol = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < numCol.length; i++) {
    if (String(numCol[i][0]) === String(numero)) {
      sh.getRange(i + 2, 11).setValue(statut);
      return;
    }
  }
  throw new Error('Commande introuvable : ' + numero);
}

/**
 * Met à jour les colonnes Reçu (col 12) ou Distribué (col 13) dans la
 * feuille détail, pour toutes les lignes correspondant à (numero,
 * reference, taille, couleur).
 *
 * flag : 'recu' | 'distribue'
 */
function updateItemFlag(payload, flag) {
  const numero    = payload.numero;
  const reference = payload.reference;
  const taille    = payload.taille;
  const couleur   = payload.couleur;
  const value     = (flag === 'recu') ? !!payload.recu : !!payload.distribue;
  const col       = (flag === 'recu') ? 12 : 13;

  if (!numero || !reference) {
    throw new Error('numero et reference requis');
  }

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEUILLE_DETAIL);
  if (!sh) throw new Error('Feuille Détail articles introuvable');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const data = sh.getRange(2, 1, lastRow - 1, 8).getValues();
  let updated = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (String(row[1]) === String(numero)
     && String(row[3]) === String(reference)
     && String(row[6]) === String(taille)
     && String(row[7]) === String(couleur)) {
      sh.getRange(i + 2, col).setValue(value);
      updated++;
    }
  }
  if (!updated) throw new Error('Aucune ligne correspondante trouvée');
}

// ============================================================
// Tests
// ============================================================

function testerEnregistrement() {
  const exemple = {
    numero: 'SRR-TEST-0001',
    date: new Date().toISOString(),
    client: {
      prenom: 'Jean',
      nom: 'Testeur',
      email: 'jean.testeur@example.com',
      telephone: '06 00 00 00 00',
      categorieRameur: 'Sénior',
      commentaire: 'Commande de test',
    },
    items: [
      {
        reference: 'TT-001',
        nom: 'Tee-shirt technique SRR',
        marque: 'Kappa',
        taille: 'M',
        couleur: 'Rouge',
        qty: 2,
        prix: 28.0,
      },
    ],
    total: 56.0,
  };
  enregistrerCommande(exemple);
  Logger.log('Commande test enregistrée.');
}

function testerListOrders() {
  Logger.log(JSON.stringify(listOrders(), null, 2));
}

function testerListItems() {
  Logger.log(JSON.stringify(listItems(), null, 2));
}
