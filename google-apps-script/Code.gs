/**
 * ============================================================
 * Google Apps Script - Réception des commandes
 * Société des régates Rennaises - Catalogue Vestimentaire
 * ============================================================
 *
 * Ce script reçoit les commandes envoyées par la boutique web
 * et les enregistre dans un Google Sheet.
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
 *    `google_script_url: "..."`
 * ============================================================
 */

// Noms des feuilles dans le Google Sheet
const FEUILLE_COMMANDES = 'Commandes';
const FEUILLE_DETAIL = 'Détail articles';

/**
 * Fonction principale appelée par POST depuis la boutique.
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    enregistrerCommande(payload);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, numero: payload.numero }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error('Erreur doPost:', err);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Répond aux requêtes GET (utile pour tester que le déploiement fonctionne).
 */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      message: 'Endpoint boutique SRR actif.',
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Crée (ou récupère) les feuilles avec les en-têtes.
 * À exécuter une fois avant le premier déploiement.
 */
function initialiserFeuilles() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Feuille Commandes
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

  // Feuille Détail articles
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
    ]);
    shDet.getRange(1, 1, 1, 11)
      .setFontWeight('bold')
      .setBackground('#c8102e')
      .setFontColor('#ffffff');
    shDet.setFrozenRows(1);
    shDet.autoResizeColumns(1, 11);
  }

  SpreadsheetApp.getUi && SpreadsheetApp.getUi().alert(
    'Feuilles initialisées. Vous pouvez maintenant déployer ce script en application web.'
  );
}

/**
 * Enregistre une commande dans les deux feuilles.
 */
function enregistrerCommande(cmd) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shCmd = ss.getSheetByName(FEUILLE_COMMANDES) || ss.insertSheet(FEUILLE_COMMANDES);
  const shDet = ss.getSheetByName(FEUILLE_DETAIL) || ss.insertSheet(FEUILLE_DETAIL);

  // Si les feuilles sont vides, initialiser les en-têtes
  if (shCmd.getLastRow() === 0) initialiserFeuilles();

  const date = new Date(cmd.date || Date.now());
  const c = cmd.client || {};
  const items = cmd.items || [];
  const nbArticles = items.reduce((s, i) => s + (i.qty || 0), 0);

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

  // Une ligne par article
  const nomComplet = `${c.prenom || ''} ${c.nom || ''}`.trim();
  items.forEach(i => {
    shDet.appendRow([
      date,
      cmd.numero,
      nomComplet,
      i.reference || '',
      i.nom || '',
      i.marque || '',
      i.taille || '',
      i.couleur || '',
      i.qty || 0,
      Number(i.prix || 0).toFixed(2),
      (Number(i.prix || 0) * Number(i.qty || 0)).toFixed(2),
    ]);
  });
}

/**
 * Fonction de test — à exécuter manuellement pour vérifier
 * que l'enregistrement fonctionne (insère une commande fictive).
 */
function testerEnregistrement() {
  const exemple = {
    numero: 'SRR-TEST-0001',
    date: new Date().toISOString(),
    client: {
      prenom: 'Jean',
      nom: 'Testeur',
      email: 'jean.testeur@example.com',
      telephone: '06 00 00 00 00',
      categorieRameur: 'Senior',
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
