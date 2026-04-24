/* ============================================================
   Administration - Boutique SRR
   Lit window.ADMIN_DATA et window.PRODUCTS_DATA (statique, build)
   + appels Apps Script (list/update) pour les commandes.
   ============================================================ */
(function () {
  'use strict';

  // ============= CONFIG =============
  const CFG       = window.RUNTIME_CONFIG || {};
  const CATALOG   = window.PRODUCTS_DATA   || {};
  const ADMIN     = window.ADMIN_DATA      || { variants: [], flocage: {}, marge_coeff: 1.2 };
  const GS_URL    = CFG.googleScriptUrl || '';
  const ADMIN_PW  = CFG.adminPassword   || '';
  const SESSION_KEY = 'srr_admin_unlocked';

  // ============= UTILS =============
  function $(id) { return document.getElementById(id); }

  function euros(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('fr-FR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }) + ' €';
  }

  function pct(n) {
    const v = Number(n) || 0;
    return (v * 100).toLocaleString('fr-FR', {
      minimumFractionDigits: 0, maximumFractionDigits: 1,
    }) + ' %';
  }

  function toast(msg, duration) {
    duration = duration || 3000;
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { t.classList.remove('show'); }, duration);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(d) {
    if (!d) return '';
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yy = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, '0');
    const mi = String(dt.getMinutes()).padStart(2, '0');
    return dd + '/' + mm + '/' + yy + ' ' + hh + ':' + mi;
  }

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  // ============= GATE =============
  function initGate() {
    const overlay = $('admin-gate-overlay');
    const form    = $('admin-gate-form');
    const input   = $('admin-password');
    const error   = $('admin-gate-error');

    // Si pas de mot de passe configuré côté serveur : on refuse l'accès.
    // (Sécurité UX — rappel : runtime-config.js est servi en clair.)
    const unlocked = sessionStorage.getItem(SESSION_KEY) === '1';
    if (unlocked) {
      overlay.style.display = 'none';
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        const value = input.value || '';
        if (!ADMIN_PW) {
          error.textContent = 'Aucun mot de passe configuré (variable ADMIN_PASSWORD). Contactez l\'administrateur.';
          return;
        }
        if (value === ADMIN_PW) {
          sessionStorage.setItem(SESSION_KEY, '1');
          overlay.style.display = 'none';
          resolve();
        } else {
          error.textContent = 'Mot de passe incorrect.';
          input.value = '';
          input.focus();
        }
      });
    });
  }

  function initLogout() {
    const btn = $('admin-logout');
    if (!btn) return;
    btn.addEventListener('click', function () {
      sessionStorage.removeItem(SESSION_KEY);
      location.reload();
    });
  }

  // ============= THÈME =============
  function initTheme() {
    const btn = $('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('srr_theme', next); } catch (e) {}
    });
  }

  // ============= TABS =============
  function initTabs() {
    const tabs = document.querySelectorAll('.admin-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        const target = tab.dataset.tab;
        tabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
        document.querySelectorAll('.admin-panel').forEach(function (p) {
          p.classList.toggle('active', p.id === 'panel-' + target);
        });
        if (target === 'commandes' && !state.ordersLoaded) loadOrders();
        if (target === 'articles'  && !state.itemsLoaded)  loadItems();
      });
    });
  }

  // ============= ÉTAT =============
  const state = {
    // Catalogue d'achat
    catalogueFilters: { search: '', genre: '', flocage: '' },
    // Commandes
    orders: [],
    ordersLoaded: false,
    ordersFilters: { search: '', statut: '' },
    // Articles
    items: [],
    itemsLoaded: false,
    itemsFilters: { search: '', reception: '', distribution: '' },
  };

  // ============= CATALOGUE D'ACHAT =============
  function renderCatalogue() {
    const tbody = $('catalogue-tbody');
    const search = normalize(state.catalogueFilters.search);
    const fg = state.catalogueFilters.genre;
    const ff = state.catalogueFilters.flocage;

    const rows = ADMIN.variants.filter(function (v) {
      if (fg && v.genre !== fg) return false;
      if (ff && v.type_flocage !== ff) return false;
      if (search) {
        const hay = normalize([v.produit, v.marque, v.collection, v.modele].join(' '));
        if (hay.indexOf(search) === -1) return false;
      }
      return true;
    });

    tbody.innerHTML = rows.map(function (v) {
      const genreLbl = v.genre_label || v.genre;
      const couleurs = Array.isArray(v.couleurs) ? v.couleurs.join(', ') : '';
      // Compat : si build ancien, retomber sur marge_effective / recalcul.
      const margeBrute = (v.marge_brute != null) ? v.marge_brute : v.marge_effective;
      const benefice = (v.benefice != null)
        ? v.benefice
        : (Number(v.prix_vente_final) - (Number(v.prix_reduit) + Number(v.cout_flocage)));
      const beneficeCls = Number(benefice) < 0 ? ' benefice-negatif' : '';
      return '<tr>'
        + '<td class="wrap">' + escapeHTML(v.produit) + '<div class="muted">' + escapeHTML(v.modele) + '</div></td>'
        + '<td>' + escapeHTML(v.marque) + '<div class="muted">' + escapeHTML(v.collection) + '</div></td>'
        + '<td>' + escapeHTML(genreLbl) + '</td>'
        + '<td class="wrap muted">' + escapeHTML(couleurs) + '</td>'
        + '<td class="numeric">' + euros(v.prix_achat) + '</td>'
        + '<td class="numeric">' + pct(v.taux_reduction) + '</td>'
        + '<td class="numeric">' + euros(v.prix_reduit) + '</td>'
        + '<td>' + escapeHTML(flocageLabel(v.type_flocage)) + '</td>'
        + '<td class="numeric">' + euros(v.cout_flocage) + '</td>'
        + '<td class="numeric muted">' + euros(v.prix_marge) + '</td>'
        + '<td class="numeric">' + euros(margeBrute) + '</td>'
        + '<td class="numeric"><strong>' + euros(v.prix_vente_final) + '</strong></td>'
        + '<td class="numeric' + beneficeCls + '"><strong>' + euros(benefice) + '</strong></td>'
        + '</tr>';
    }).join('');

    $('catalogue-count').textContent = rows.length + ' / ' + ADMIN.variants.length + ' variantes';
  }

  function flocageLabel(t) {
    switch (t) {
      case 'rien':         return 'Aucun';
      case 'coeur':        return 'Cœur';
      case 'dos':          return 'Dos';
      case 'coeur_et_dos': return 'Cœur + Dos';
      default:             return t || '';
    }
  }

  function initCataloguePanel() {
    $('catalogue-search').addEventListener('input', function (e) {
      state.catalogueFilters.search = e.target.value; renderCatalogue();
    });
    $('catalogue-filter-genre').addEventListener('change', function (e) {
      state.catalogueFilters.genre = e.target.value; renderCatalogue();
    });
    $('catalogue-filter-flocage').addEventListener('change', function (e) {
      state.catalogueFilters.flocage = e.target.value; renderCatalogue();
    });
    $('catalogue-export-xlsx').addEventListener('click', exportCatalogueXlsx);
    renderCatalogue();
  }

  function exportCatalogueXlsx() {
    if (!window.XLSX) { toast('Librairie Excel non chargée'); return; }
    const rows = ADMIN.variants.map(function (v) {
      const margeBrute = (v.marge_brute != null) ? v.marge_brute : v.marge_effective;
      const benefice = (v.benefice != null)
        ? v.benefice
        : (Number(v.prix_vente_final) - (Number(v.prix_reduit) + Number(v.cout_flocage)));
      const couleurs = Array.isArray(v.couleurs) ? v.couleurs.join(', ') : '';
      return {
        'Produit': v.produit,
        'Modèle': v.modele,
        'Marque': v.marque,
        'Collection': v.collection,
        'Genre': v.genre_label || v.genre,
        'Couleurs': couleurs,
        'Prix achat HT': v.prix_achat,
        'Taux remise': v.taux_reduction,
        'Prix remisé': v.prix_reduit,
        'Flocage': flocageLabel(v.type_flocage),
        'Coût flocage': v.cout_flocage,
        'Prix + marge x1.2': v.prix_marge,
        'Marge brute': margeBrute,
        'Prix vente final': v.prix_vente_final,
        'Bénéfice': benefice,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogue d\'achat');
    XLSX.writeFile(wb, 'catalogue-achat-srr.xlsx');
    toast('Export Excel téléchargé');
  }

  // ============= APPEL APPS SCRIPT =============
  // Envoi en text/plain pour contourner la preflight CORS (workaround standard).
  function callScript(action, payload) {
    if (!GS_URL) {
      return Promise.reject(new Error('URL Apps Script non configurée'));
    }
    const body = JSON.stringify(Object.assign({ action: action }, payload || {}));
    return fetch(GS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || j.ok !== true) throw new Error((j && j.error) || 'Réponse invalide');
      return j;
    });
  }

  // ============= COMMANDES =============
  function loadOrders() {
    const tbody = $('commandes-tbody');
    tbody.innerHTML = '<tr><td colspan="9" class="admin-empty">Chargement...</td></tr>';
    callScript('list_orders').then(function (res) {
      state.orders = res.orders || [];
      state.ordersLoaded = true;
      renderOrders();
    }).catch(function (err) {
      tbody.innerHTML = '<tr><td colspan="9" class="admin-empty">'
        + 'Erreur : ' + escapeHTML(err.message) + '</td></tr>';
    });
  }

  function renderOrders() {
    const tbody   = $('commandes-tbody');
    const empty   = $('commandes-empty');
    const search  = normalize(state.ordersFilters.search);
    const statut  = state.ordersFilters.statut;

    const rows = state.orders.filter(function (o) {
      if (statut && (o.statut || 'Nouvelle') !== statut) return false;
      if (search) {
        const hay = normalize([o.numero, o.prenom, o.nom, o.email, o.telephone].join(' '));
        if (hay.indexOf(search) === -1) return false;
      }
      return true;
    });

    // KPIs
    const kpis = computeOrdersKpis(state.orders);
    renderKpis($('commandes-kpis'), kpis);
    $('badge-commandes').textContent = state.orders.length;
    $('commandes-count').textContent = rows.length + ' / ' + state.orders.length + ' commandes';

    if (rows.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = rows.map(function (o) {
      const cur = o.statut || 'Nouvelle';
      const tel = o.telephone || '';
      const telCell = tel
        ? '<a href="tel:' + escapeHTML(tel.replace(/\s+/g, '')) + '">' + escapeHTML(tel) + '</a>'
        : '<span class="muted">—</span>';
      return '<tr>'
        + '<td>' + escapeHTML(fmtDate(o.date)) + '</td>'
        + '<td><strong>' + escapeHTML(o.numero) + '</strong></td>'
        + '<td>' + escapeHTML((o.prenom || '') + ' ' + (o.nom || '')) + '</td>'
        + '<td class="muted">' + escapeHTML(o.email || '') + '</td>'
        + '<td>' + telCell + '</td>'
        + '<td class="numeric">' + (o.nbArticles || 0) + '</td>'
        + '<td class="numeric">' + euros(o.total) + '</td>'
        + '<td>' + statutPill(cur) + '</td>'
        + '<td>' + statutSelect(o.numero, cur) + '</td>'
        + '</tr>';
    }).join('');

    tbody.querySelectorAll('select[data-numero]').forEach(function (sel) {
      sel.addEventListener('change', function (e) {
        const numero = e.target.dataset.numero;
        const newStatut = e.target.value;
        updateOrderStatus(numero, newStatut);
      });
    });
  }

  function statutPill(s) {
    const map = {
      'Nouvelle':   'pill-nouvelle',
      'En cours':   'pill-en-cours',
      'Livrée':     'pill-livree',
      'Distribuée': 'pill-distribuee',
      'Terminée':   'pill-terminee',
    };
    const cls = map[s] || 'pill-neutre';
    return '<span class="pill ' + cls + '">' + escapeHTML(s) + '</span>';
  }

  function statutSelect(numero, current) {
    const options = ['Nouvelle', 'En cours', 'Livrée', 'Distribuée', 'Terminée'];
    return '<select class="btn-mini" data-numero="' + escapeHTML(numero) + '">'
      + options.map(function (o) {
        return '<option value="' + escapeHTML(o) + '"' + (o === current ? ' selected' : '') + '>'
          + escapeHTML(o) + '</option>';
      }).join('')
      + '</select>';
  }

  function updateOrderStatus(numero, statut) {
    toast('Mise à jour...');
    callScript('update_order_status', { numero: numero, statut: statut }).then(function () {
      const o = state.orders.find(function (x) { return x.numero === numero; });
      if (o) o.statut = statut;
      renderOrders();
      toast('Statut mis à jour');
    }).catch(function (err) {
      toast('Erreur : ' + err.message);
    });
  }

  function computeOrdersKpis(orders) {
    const total = orders.length;
    const parStatut = {};
    orders.forEach(function (o) {
      const s = o.statut || 'Nouvelle';
      parStatut[s] = (parStatut[s] || 0) + 1;
    });
    const ca = orders.reduce(function (s, o) { return s + (Number(o.total) || 0); }, 0);
    return [
      { label: 'Total commandes', value: total },
      { label: 'Nouvelles',       value: parStatut['Nouvelle'] || 0 },
      { label: 'En cours',        value: parStatut['En cours'] || 0 },
      { label: 'Livrées',         value: parStatut['Livrée'] || 0 },
      { label: 'Chiffre d\'affaires', value: euros(ca) },
    ];
  }

  function renderKpis(container, kpis) {
    container.innerHTML = kpis.map(function (k) {
      return '<div class="kpi-card">'
        + '<div class="kpi-label">' + escapeHTML(k.label) + '</div>'
        + '<div class="kpi-value">' + escapeHTML(k.value) + '</div>'
        + '</div>';
    }).join('');
  }

  function initCommandesPanel() {
    $('commandes-search').addEventListener('input', function (e) {
      state.ordersFilters.search = e.target.value; renderOrders();
    });
    $('commandes-filter-statut').addEventListener('change', function (e) {
      state.ordersFilters.statut = e.target.value; renderOrders();
    });
    $('commandes-refresh').addEventListener('click', loadOrders);
    $('commandes-export-xlsx').addEventListener('click', exportOrdersXlsx);
  }

  function exportOrdersXlsx() {
    if (!window.XLSX) { toast('Librairie Excel non chargée'); return; }
    const rows = state.orders.map(function (o) {
      return {
        'Date': fmtDate(o.date),
        'N° commande': o.numero,
        'Prénom': o.prenom,
        'Nom': o.nom,
        'Email': o.email,
        'Téléphone': o.telephone,
        'Catégorie rameur': o.categorieRameur,
        'Articles': o.nbArticles,
        'Total': Number(o.total) || 0,
        'Commentaire': o.commentaire,
        'Statut': o.statut || 'Nouvelle',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Commandes');
    XLSX.writeFile(wb, 'commandes-srr.xlsx');
    toast('Export Excel téléchargé');
  }

  // ============= ARTICLES À COMMANDER =============
  function loadItems() {
    const tbody = $('articles-tbody');
    tbody.innerHTML = '<tr><td colspan="9" class="admin-empty">Chargement...</td></tr>';
    callScript('list_items').then(function (res) {
      state.items = res.items || [];
      state.itemsLoaded = true;
      renderItems();
    }).catch(function (err) {
      tbody.innerHTML = '<tr><td colspan="9" class="admin-empty">'
        + 'Erreur : ' + escapeHTML(err.message) + '</td></tr>';
    });
  }

  /**
   * Agrège les articles par (référence + taille + couleur).
   * Les lignes individuelles gardent leur statut "Reçu" / "Distribué",
   * mais l'affichage est groupé pour la commande fournisseur.
   */
  function aggregateItems(items) {
    const map = new Map();
    items.forEach(function (it) {
      const key = [it.reference || '', it.taille || '', it.couleur || ''].join('|');
      if (!map.has(key)) {
        map.set(key, {
          reference: it.reference,
          article:   it.article,
          marque:    it.marque,
          taille:    it.taille,
          couleur:   it.couleur,
          qty:       0,
          lines:     [],
          clients:   [],
        });
      }
      const agg = map.get(key);
      agg.qty += Number(it.qty) || 0;
      agg.lines.push(it);
      if (it.client && agg.clients.indexOf(it.client) === -1) agg.clients.push(it.client);
    });
    return Array.from(map.values()).sort(function (a, b) {
      return (a.reference || '').localeCompare(b.reference || '');
    });
  }

  function renderItems() {
    const empty = $('articles-empty');
    const aggs = aggregateItems(state.items);

    // Filtres
    const search = normalize(state.itemsFilters.search);
    const rec = state.itemsFilters.reception;
    const dis = state.itemsFilters.distribution;

    const filtered = aggs.filter(function (a) {
      if (search) {
        const hay = normalize([a.reference, a.article, a.marque].join(' '));
        if (hay.indexOf(search) === -1) return false;
      }
      const totalRecu = a.lines.reduce(function (s, l) { return s + (l.recu ? (Number(l.qty)||0) : 0); }, 0);
      const totalDis  = a.lines.reduce(function (s, l) { return s + (l.distribue ? (Number(l.qty)||0) : 0); }, 0);
      const etatRec = totalRecu >= a.qty ? 'Reçu' : 'À recevoir';
      const etatDis = totalDis  >= a.qty ? 'Distribué' : 'À distribuer';
      if (rec && etatRec !== rec) return false;
      if (dis && etatDis !== dis) return false;
      return true;
    });

    // KPIs
    const totalQty   = aggs.reduce(function (s, a) { return s + a.qty; }, 0);
    const totalRefs  = aggs.length;
    const aRecevoir  = aggs.filter(function (a) {
      return a.lines.reduce(function (s, l) { return s + (l.recu ? 1 : 0); }, 0) < a.lines.length;
    }).length;
    const aDistribuer = aggs.filter(function (a) {
      return a.lines.reduce(function (s, l) { return s + (l.distribue ? 1 : 0); }, 0) < a.lines.length;
    }).length;
    renderKpis($('articles-kpis'), [
      { label: 'Références distinctes', value: totalRefs },
      { label: 'Pièces au total',       value: totalQty },
      { label: 'À recevoir',            value: aRecevoir },
      { label: 'À distribuer',          value: aDistribuer },
    ]);
    $('badge-articles').textContent = aggs.length;
    $('articles-count').textContent = filtered.length + ' / ' + aggs.length + ' références';

    if (filtered.length === 0) {
      $('articles-tbody').innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    $('articles-tbody').innerHTML = filtered.map(function (a, idx) {
      const allRec = a.lines.every(function (l) { return !!l.recu; });
      const allDis = a.lines.every(function (l) { return !!l.distribue; });
      const clientsHtml = a.clients.length <= 3
        ? a.clients.join(', ')
        : a.clients.slice(0, 3).join(', ') + ' +' + (a.clients.length - 3);
      return '<tr data-idx="' + idx + '">'
        + '<td><strong>' + escapeHTML(a.reference || '') + '</strong></td>'
        + '<td class="wrap">' + escapeHTML(a.article || '') + '</td>'
        + '<td>' + escapeHTML(a.marque || '') + '</td>'
        + '<td>' + escapeHTML(a.taille || '') + '</td>'
        + '<td>' + escapeHTML(a.couleur || '') + '</td>'
        + '<td class="numeric"><strong>' + a.qty + '</strong></td>'
        + '<td class="muted">' + escapeHTML(clientsHtml) + '</td>'
        + '<td>' + receptionCell(idx, allRec) + '</td>'
        + '<td>' + distributionCell(idx, allDis) + '</td>'
        + '</tr>';
    }).join('');

    // Binding boutons
    $('articles-tbody').querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx  = Number(btn.closest('tr').dataset.idx);
        const agg  = filtered[idx];
        const act  = btn.dataset.action;
        const next = btn.dataset.next === 'true';
        toggleAggregate(agg, act, next);
      });
    });
  }

  function receptionCell(idx, allRec) {
    if (allRec) {
      return '<span class="pill pill-recu">Reçu</span> '
        + '<button class="btn-mini" data-action="reception" data-next="false">Annuler</button>';
    }
    return '<button class="btn-mini btn-danger" data-action="reception" data-next="true">Marquer reçu</button>';
  }

  function distributionCell(idx, allDis) {
    if (allDis) {
      return '<span class="pill pill-distribue">Distribué</span> '
        + '<button class="btn-mini" data-action="distribution" data-next="false">Annuler</button>';
    }
    return '<button class="btn-mini" data-action="distribution" data-next="true">Marquer distribué</button>';
  }

  /**
   * Met à jour toutes les lignes d'un agrégat (ref+taille+couleur) en
   * envoyant autant d'appels Apps Script qu'il y a de commandes concernées.
   */
  function toggleAggregate(agg, action, next) {
    toast('Mise à jour...');
    const calls = agg.lines.map(function (line) {
      const payload = {
        numero:    line.numero,
        reference: line.reference,
        taille:    line.taille,
        couleur:   line.couleur,
      };
      if (action === 'reception') payload.recu = next;
      if (action === 'distribution') payload.distribue = next;
      const apiAction = action === 'reception' ? 'update_item_reception' : 'update_item_distribution';
      return callScript(apiAction, payload);
    });
    Promise.all(calls).then(function () {
      agg.lines.forEach(function (line) {
        if (action === 'reception') line.recu = next;
        if (action === 'distribution') line.distribue = next;
      });
      renderItems();
      toast('Mise à jour enregistrée');
    }).catch(function (err) {
      toast('Erreur : ' + err.message);
    });
  }

  function initArticlesPanel() {
    $('articles-search').addEventListener('input', function (e) {
      state.itemsFilters.search = e.target.value; renderItems();
    });
    $('articles-filter-reception').addEventListener('change', function (e) {
      state.itemsFilters.reception = e.target.value; renderItems();
    });
    $('articles-filter-distribution').addEventListener('change', function (e) {
      state.itemsFilters.distribution = e.target.value; renderItems();
    });
    $('articles-refresh').addEventListener('click', loadItems);
    $('articles-export-xlsx').addEventListener('click', exportItemsXlsx);
  }

  function exportItemsXlsx() {
    if (!window.XLSX) { toast('Librairie Excel non chargée'); return; }
    const aggs = aggregateItems(state.items);
    const rows = aggs.map(function (a) {
      const allRec = a.lines.every(function (l) { return !!l.recu; });
      const allDis = a.lines.every(function (l) { return !!l.distribue; });
      return {
        'Référence': a.reference,
        'Article': a.article,
        'Marque': a.marque,
        'Taille': a.taille,
        'Couleur': a.couleur,
        'Quantité': a.qty,
        'Clients': a.clients.join(', '),
        'Réception': allRec ? 'Reçu' : 'À recevoir',
        'Distribution': allDis ? 'Distribué' : 'À distribuer',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Articles à commander');
    XLSX.writeFile(wb, 'articles-a-commander-srr.xlsx');
    toast('Export Excel téléchargé');
  }

  // ============= BOOT =============
  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initLogout();
    initTabs();
    initCataloguePanel();
    initCommandesPanel();
    initArticlesPanel();

    initGate().then(function () {
      // Une fois déverrouillé, on précharge les commandes.
      if (GS_URL) loadOrders();
    });
  });
})();
