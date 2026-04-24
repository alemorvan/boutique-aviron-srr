/* ============================================================
   CATALOGUE VESTIMENTAIRE - Société des régates Rennaises
   app.js : catalogue, panier, PDF bon de commande, thème
   Lit ses données depuis window.PRODUCTS_DATA (généré au build).

   Modèle de données (par produit) :
     {
       nom, categorie, marque, collection, modele, description?,
       images: [...],
       couleurs: ["Noir", "Rouge", ...],
       genres: {
         hommes|femmes|mixtes|enfants: {
           prix: 28.0,
           tailles: ["S","M","L",...],
           sku: { "Noir": "KAP-KOMB-H-NR", ... }
         }
       }
     }
   ============================================================ */

(() => {
  'use strict';

  // ===== ÉTAT GLOBAL =====
  const state = {
    config: null,
    produits: [],
    categories: [],
    filtreGenre: 'tous',
    filtreCategorie: 'toutes',
    panier: [],
  };

  const RUNTIME = (window.RUNTIME_CONFIG || {});
  const CATALOG = (window.PRODUCTS_DATA || {});

  const GENRE_ORDER = ['hommes', 'femmes', 'mixtes', 'enfants'];
  const GENRE_LABELS = {
    hommes: 'HOMMES',
    femmes: 'FEMMES',
    mixtes: 'MIXTES',
    enfants: 'ENFANTS',
  };
  const GENRE_LABELS_SHORT = {
    hommes: 'Hommes',
    femmes: 'Femmes',
    mixtes: 'Mixtes',
    enfants: 'Enfants',
  };

  // ===== UTILITAIRES =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const euros = (n) => Number(n).toFixed(2).replace('.', ',') + ' €';

  const showToast = (msg) => {
    const toast = $('#toast');
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('visible'), 2500);
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function genresOf(produit) {
    const g = produit.genres || {};
    return GENRE_ORDER.filter(k => g[k]);
  }

  // ===== CARROUSEL D'IMAGES =====
  function buildCarouselHtml(images, alt) {
    if (!images || images.length === 0) {
      return '<span class="product-image-fallback">👕</span>';
    }
    if (images.length === 1) {
      const src = 'images/produits/' + images[0];
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"
           onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'product-image-fallback',textContent:'👕'}));">`;
    }
    const slides = images.map((img, i) =>
      `<img src="${escapeHtml('images/produits/' + img)}" alt="${escapeHtml(alt)}"
            class="carousel-img${i === 0 ? ' active' : ''}"
            data-index="${i}"
            onerror="this.classList.add('carousel-img-error');">`
    ).join('');
    const dots = images.map((_, i) =>
      `<button type="button" class="carousel-dot${i === 0 ? ' active' : ''}"
               data-index="${i}" aria-label="Image ${i + 1}"></button>`
    ).join('');
    return `
      <div class="product-carousel" data-index="0">
        ${slides}
        <button type="button" class="carousel-btn carousel-prev" aria-label="Image précédente">&#8249;</button>
        <button type="button" class="carousel-btn carousel-next" aria-label="Image suivante">&#8250;</button>
        <div class="carousel-counter"><span class="carousel-current">1</span>/${images.length}</div>
        <div class="carousel-dots">${dots}</div>
      </div>
    `;
  }

  function wireCarousel(card) {
    const carousel = card.querySelector('.product-carousel');
    if (!carousel) return;
    const imgs = carousel.querySelectorAll('.carousel-img');
    const dots = carousel.querySelectorAll('.carousel-dot');
    const counter = carousel.querySelector('.carousel-current');
    const total = imgs.length;

    const show = (idx) => {
      const i = ((idx % total) + total) % total;
      carousel.dataset.index = String(i);
      imgs.forEach((im, k) => im.classList.toggle('active', k === i));
      dots.forEach((d, k) => d.classList.toggle('active', k === i));
      if (counter) counter.textContent = String(i + 1);
    };

    const prev = carousel.querySelector('.carousel-prev');
    const next = carousel.querySelector('.carousel-next');
    if (prev) prev.addEventListener('click', (e) => {
      e.preventDefault();
      show(parseInt(carousel.dataset.index, 10) - 1);
    });
    if (next) next.addEventListener('click', (e) => {
      e.preventDefault();
      show(parseInt(carousel.dataset.index, 10) + 1);
    });
    dots.forEach((d) => {
      d.addEventListener('click', (e) => {
        e.preventDefault();
        show(parseInt(d.dataset.index, 10));
      });
    });
  }

  // ===== GESTION DU THÈME =====
  function initTheme() {
    const btn = $('#theme-toggle');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('srr_theme', next); } catch (e) { /* ignore */ }
    });

    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener && mq.addEventListener('change', (e) => {
        if (localStorage.getItem('srr_theme')) return;
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      });
    } catch (e) { /* ignore */ }
  }

  // ===== INITIALISATION DU CATALOGUE =====
  function initCatalogue() {
    if (!CATALOG || !CATALOG.produits) {
      $('#loading-state').innerHTML =
        '<p style="color:var(--rouge);">Catalogue non trouvé. ' +
        'Vérifiez que <code>products-data.js</code> a bien été généré par le build.</p>';
      return;
    }

    state.config = Object.assign({}, CATALOG.boutique || {});
    // Surcharge runtime de l'email de contact (variable Docker CLUB_EMAIL)
    if (RUNTIME.clubEmailOverride && RUNTIME.clubEmailOverride.trim()) {
      state.config.email_contact = RUNTIME.clubEmailOverride.trim();
    }
    // Surcharge runtime de l'IBAN (variable Docker CLUB_IBAN)
    if (RUNTIME.clubIbanOverride && RUNTIME.clubIbanOverride.trim()) {
      state.config.iban = RUNTIME.clubIbanOverride.trim();
    }
    state.categories = CATALOG.categories || [];
    state.produits = CATALOG.produits || [];

    if (state.config.nom_club) $('#club-name').textContent = state.config.nom_club;
    if (state.config.nom_boutique) $('#shop-name').textContent = state.config.nom_boutique;
    document.title = `${state.config.nom_boutique || 'Catalogue'} - ${state.config.nom_club || ''}`;

    loadCartFromStorage();
    buildCategoryFilters();
    renderCatalogue();
    $('#loading-state').style.display = 'none';
  }

  // ===== FILTRES =====
  function buildCategoryFilters() {
    const container = $('#filter-categories');
    state.categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.dataset.categorie = cat.id;
      btn.textContent = cat.nom;
      container.appendChild(btn);
    });

    $('#filter-genres').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      $$('#filter-genres .chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      state.filtreGenre = btn.dataset.genre;
      renderCatalogue();
    });

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      $$('#filter-categories .chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      state.filtreCategorie = btn.dataset.categorie;
      renderCatalogue();
    });
  }

  // ===== AFFICHAGE DU CATALOGUE =====
  function renderCatalogue() {
    const container = $('#products-container');
    container.innerHTML = '';

    const produitsFiltres = state.produits.filter(p => {
      const genresProd = genresOf(p);
      const okGenre = state.filtreGenre === 'tous' ||
                      genresProd.includes(state.filtreGenre);
      const okCat = state.filtreCategorie === 'toutes' ||
                    p.categorie === state.filtreCategorie;
      return okGenre && okCat && genresProd.length > 0;
    });

    if (produitsFiltres.length === 0) {
      $('#empty-state').style.display = 'block';
      return;
    }
    $('#empty-state').style.display = 'none';

    state.categories.forEach(cat => {
      const prods = produitsFiltres.filter(p => p.categorie === cat.id);
      if (prods.length === 0) return;

      const section = document.createElement('section');
      section.className = 'category-section';
      section.innerHTML = `
        <div class="category-header">
          <span class="category-icon">${cat.icone || ''}</span>
          <h2>${escapeHtml(cat.nom)}</h2>
        </div>
        <div class="products-grid"></div>
      `;
      const grid = section.querySelector('.products-grid');
      prods.forEach(p => grid.appendChild(buildProductCard(p)));
      container.appendChild(section);
    });
  }

  // ===== CARTE PRODUIT =====
  function buildProductCard(p) {
    const card = document.createElement('article');
    card.className = 'product-card';

    const imageHtml = buildCarouselHtml(p.images || [], p.nom);

    const couleurs = p.couleurs || [];
    const genresAvail = genresOf(p);

    let initialGenre = genresAvail[0];
    if (state.filtreGenre !== 'tous' && genresAvail.includes(state.filtreGenre)) {
      initialGenre = state.filtreGenre;
    }

    const existeEn = couleurs.length
      ? `<div class="product-colors">Existe en ${couleurs.map(escapeHtml).join(', ')}</div>`
      : '';

    const brandBits = [p.marque, p.collection].filter(Boolean).map(escapeHtml);
    const brandLine = brandBits.length
      ? `<div class="product-brand">${brandBits.join(' — ')}</div>`
      : '';

    let genrePicker;
    if (genresAvail.length === 1) {
      const g = genresAvail[0];
      genrePicker = `
        <div class="option-row">
          <label class="option-label">Modèle</label>
          <div class="genre-single">${escapeHtml(GENRE_LABELS[g] || g)}</div>
          <input type="hidden" class="sel-genre" value="${escapeHtml(g)}">
        </div>`;
    } else {
      const opts = genresAvail.map(g =>
        `<option value="${escapeHtml(g)}"${g === initialGenre ? ' selected' : ''}>Modèle ${escapeHtml(GENRE_LABELS[g] || g)}</option>`
      ).join('');
      genrePicker = `
        <div class="option-row">
          <label class="option-label">Modèle</label>
          <select class="sel-genre">${opts}</select>
        </div>`;
    }

    const colorOptions = couleurs.map(c =>
      `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
    ).join('');

    const descHtml = p.description
      ? `<div class="product-description">${escapeHtml(p.description)}</div>`
      : '';

    card.innerHTML = `
      <div class="product-image">${imageHtml}</div>
      <div class="product-body">
        ${brandLine}
        <div class="product-name">${escapeHtml(p.nom)}</div>
        ${existeEn}
        ${descHtml}
        <div class="product-variants" data-role="variants"></div>
        ${genrePicker}
        <div class="option-row">
          <label class="option-label">Taille</label>
          <select class="sel-taille"></select>
        </div>
        <div class="option-row">
          <label class="option-label">Couleur</label>
          <select class="sel-couleur">${colorOptions}</select>
        </div>
        <div class="option-row option-row-inline">
          <label class="option-label">Quantité</label>
          <div class="quantity-control">
            <button type="button" class="qty-btn qty-minus" aria-label="Diminuer">−</button>
            <span class="qty-value">1</span>
            <button type="button" class="qty-btn qty-plus" aria-label="Augmenter">+</button>
          </div>
        </div>
        <div class="product-price" data-role="price"></div>
        <div class="product-actions">
          <button type="button" class="btn-add">Ajouter au panier</button>
        </div>
      </div>
    `;

    const variantsEl = card.querySelector('[data-role="variants"]');
    const tailleSel = card.querySelector('.sel-taille');
    const priceEl = card.querySelector('[data-role="price"]');

    function renderVariants() {
      variantsEl.innerHTML = genresAvail.map(g => {
        const v = p.genres[g];
        const tailles = (v.tailles || []).map(escapeHtml).join(', ');
        const isAdulte = g !== 'enfants';
        const label = isAdulte ? `Tailles Adulte (${GENRE_LABELS_SHORT[g]})` : 'Tailles Enfant';
        return `
          <div class="variant-line">
            <span class="variant-label">${escapeHtml(label)}</span>
            <span class="variant-sizes">${tailles}</span>
            <span class="variant-price">${euros(v.prix)} TTC</span>
          </div>`;
      }).join('');
    }

    function refreshPourGenre() {
      const genreEl = card.querySelector('.sel-genre');
      const genre = genreEl.value;
      const variant = p.genres[genre] || {};
      const tailles = variant.tailles || [];
      tailleSel.innerHTML = tailles
        .map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
        .join('');
      priceEl.textContent = euros(variant.prix || 0);
    }

    renderVariants();
    refreshPourGenre();
    wireCarousel(card);

    card.querySelector('.sel-genre').addEventListener('change', refreshPourGenre);

    const qtyVal = card.querySelector('.qty-value');
    card.querySelector('.qty-minus').addEventListener('click', () => {
      qtyVal.textContent = Math.max(1, parseInt(qtyVal.textContent) - 1);
    });
    card.querySelector('.qty-plus').addEventListener('click', () => {
      qtyVal.textContent = Math.min(99, parseInt(qtyVal.textContent) + 1);
    });

    card.querySelector('.btn-add').addEventListener('click', () => {
      const genre = card.querySelector('.sel-genre').value;
      const taille = tailleSel.value;
      const couleur = card.querySelector('.sel-couleur').value;
      const qty = parseInt(qtyVal.textContent) || 1;
      const variant = p.genres[genre];
      if (!variant) return;
      const sku = (variant.sku && variant.sku[couleur]) || '';
      if (!sku) {
        showToast(`Référence ${couleur}/${genre} indisponible`);
        return;
      }
      addToCart(p, { genre, taille, couleur, sku, prix: variant.prix, qty });
    });

    return card;
  }

  // ===== PANIER =====
  function addToCart(produit, opts) {
    const item = {
      nom: produit.nom,
      marque: produit.marque || '',
      categorie: produit.categorie,
      genre: opts.genre,
      genreLabel: GENRE_LABELS_SHORT[opts.genre] || opts.genre,
      taille: opts.taille || '',
      couleur: opts.couleur || '',
      sku: opts.sku,
      prix: Number(opts.prix),
      qty: opts.qty || 1,
      image: (produit.images && produit.images[0]) || '',
    };

    // Dédup par (sku, genre, taille) : un même SKU peut être partagé
    // entre une variante adulte et une variante enfant — ils doivent
    // rester des lignes de commande distinctes dans le panier.
    const existing = state.panier.find(i =>
      i.sku === item.sku &&
      i.genre === item.genre &&
      i.taille === item.taille
    );
    if (existing) existing.qty += item.qty;
    else state.panier.push(item);

    saveCartToStorage();
    updateCartUI();
    showToast(`"${produit.nom}" ajouté au panier`);
  }

  function updateCartUI() {
    const count = state.panier.reduce((sum, i) => sum + i.qty, 0);
    const total = state.panier.reduce((sum, i) => sum + i.qty * i.prix, 0);

    $('#cart-count').textContent = count;
    $('#cart-total').textContent = euros(total);
    $('#checkout-btn').disabled = state.panier.length === 0;

    const itemsContainer = $('#cart-items');
    if (state.panier.length === 0) {
      itemsContainer.innerHTML = '<p class="cart-empty">Votre panier est vide.</p>';
      return;
    }

    itemsContainer.innerHTML = '';
    state.panier.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'cart-item';
      const meta = [item.marque, item.genreLabel, item.taille, item.couleur]
        .filter(Boolean).join(' · ');
      el.innerHTML = `
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.nom)}</div>
          <div class="cart-item-meta">${escapeHtml(meta)}</div>
          <div class="cart-item-ref">Réf. ${escapeHtml(item.sku)}</div>
          <div class="cart-item-price">${euros(item.prix * item.qty)}</div>
        </div>
        <div class="cart-item-controls">
          <div class="cart-item-qty">
            <button type="button" data-act="dec" data-idx="${idx}">−</button>
            <span>${item.qty}</span>
            <button type="button" data-act="inc" data-idx="${idx}">+</button>
          </div>
          <button type="button" class="cart-item-remove" data-act="rm" data-idx="${idx}">Retirer</button>
        </div>
      `;
      itemsContainer.appendChild(el);
    });

    itemsContainer.onclick = (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx);
      const act = btn.dataset.act;
      if (act === 'inc') state.panier[idx].qty++;
      else if (act === 'dec') {
        state.panier[idx].qty--;
        if (state.panier[idx].qty <= 0) state.panier.splice(idx, 1);
      }
      else if (act === 'rm') state.panier.splice(idx, 1);
      saveCartToStorage();
      updateCartUI();
    };
  }

  function saveCartToStorage() {
    try { sessionStorage.setItem('srr_cart', JSON.stringify(state.panier)); }
    catch (e) { window._srr_cart = state.panier; }
  }
  function loadCartFromStorage() {
    try {
      const raw = sessionStorage.getItem('srr_cart');
      if (raw) state.panier = JSON.parse(raw);
    } catch (e) {
      if (window._srr_cart) state.panier = window._srr_cart;
    }
    updateCartUI();
  }

  // ===== DRAWER PANIER =====
  function openCart()  { $('#cart-drawer').classList.add('open'); $('#cart-overlay').classList.add('open'); }
  function closeCart() { $('#cart-drawer').classList.remove('open'); $('#cart-overlay').classList.remove('open'); }

  $('#cart-button').addEventListener('click', openCart);
  $('#cart-close').addEventListener('click', closeCart);
  $('#cart-overlay').addEventListener('click', closeCart);

  // ===== CHECKOUT =====
  $('#checkout-btn').addEventListener('click', () => {
    if (state.panier.length === 0) return;
    closeCart();
    openCheckoutModal();
  });

  function openCheckoutModal() {
    const summary = $('#checkout-summary');
    summary.innerHTML = '';
    state.panier.forEach(i => {
      const line = document.createElement('div');
      line.className = 'summary-line';
      const meta = [i.genreLabel, i.taille, i.couleur].filter(Boolean).join(' · ');
      line.innerHTML = `
        <span>${i.qty} × ${escapeHtml(i.nom)}${meta ? ' (' + escapeHtml(meta) + ')' : ''}</span>
        <span>${euros(i.qty * i.prix)}</span>
      `;
      summary.appendChild(line);
    });
    const total = state.panier.reduce((s, i) => s + i.qty * i.prix, 0);
    const tot = document.createElement('div');
    tot.className = 'summary-total';
    tot.innerHTML = `<span>Total</span><span>${euros(total)}</span>`;
    summary.appendChild(tot);

    $('#checkout-modal-overlay').style.display = 'flex';
  }

  function closeCheckoutModal() { $('#checkout-modal-overlay').style.display = 'none'; }

  $('#checkout-close').addEventListener('click', closeCheckoutModal);
  $('#checkout-cancel').addEventListener('click', closeCheckoutModal);

  $('#checkout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Génération en cours...';

    const fd = new FormData(e.target);
    const client = {
      prenom: fd.get('prenom').trim(),
      nom: fd.get('nom').trim(),
      email: fd.get('email').trim(),
      telephone: fd.get('telephone').trim(),
      categorieRameur: fd.get('categorie-rameur'),
      commentaire: (fd.get('commentaire') || '').trim(),
    };

    const total = state.panier.reduce((s, i) => s + i.qty * i.prix, 0);
    const commande = {
      numero: generateOrderNumber(),
      date: new Date().toISOString(),
      client,
      items: [...state.panier],
      total,
    };

    try { await generatePDF(commande); }
    catch (err) {
      console.error('Erreur PDF:', err);
      showToast('Erreur lors de la génération du PDF');
    }

    let sheetsOk = false;
    const sheetsUrl = RUNTIME.googleScriptUrl || '';
    if (sheetsUrl) {
      try {
        await sendToGoogleSheets(commande, sheetsUrl);
        sheetsOk = true;
      } catch (err) { console.warn('Erreur Google Sheets:', err); }
    }

    closeCheckoutModal();
    const msg = sheetsOk
      ? "Votre bon de commande a été téléchargé et une copie nous a été transmise. Vous n'avez pas besoin de le transmettre au club."
      : (sheetsUrl
          ? "Votre bon de commande a été téléchargé. L'envoi automatique au club a échoué — merci de le transmettre par email."
          : "Votre bon de commande a été téléchargé et une copie nous a été transmise. Vous n'avez pas besoin de le transmettre au club.");
    $('#confirm-message').textContent = msg;
    $('#confirm-next-steps').innerHTML = buildNextStepsHtml();
    $('#confirm-modal-overlay').style.display = 'flex';

    state.panier = [];
    saveCartToStorage();
    updateCartUI();
    e.target.reset();

    submitBtn.disabled = false;
    submitBtn.textContent = 'Valider et générer le bon de commande';
  });

  $('#confirm-close').addEventListener('click', () => {
    $('#confirm-modal-overlay').style.display = 'none';
  });

  function generateOrderNumber() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const rand = Math.floor(Math.random() * 9000 + 1000);
    return `SRR-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${rand}`;
  }

  // ===== INFOS POST-COMMANDE (popup + PDF) =====
  function getPaymentInfo() {
    return {
      iban: (state.config && state.config.iban) ? state.config.iban : '',
      ordreCheque: (state.config && state.config.ordre_cheque)
        ? state.config.ordre_cheque
        : (state.config && state.config.nom_club) || 'Société des Régates Rennaises',
    };
  }

  function buildNextStepsHtml() {
    const pay = getPaymentInfo();
    const ibanLine = pay.iban
      ? `<div class="pay-row"><span class="pay-label">Virement SEPA :</span>
           <code class="pay-iban">${escapeHtml(pay.iban)}</code></div>`
      : '';
    return `
      <div class="next-steps-block">
        <h3>Prochaines étapes</h3>
        <ul class="next-steps-list">
          <li><strong>Prévenez le club</strong> en laissant un message sur le groupe
              WhatsApp <em>« Boutique »</em> pour signaler votre commande.</li>
          <li><strong>Réglez votre commande</strong> au choix :
            <div class="pay-options">
              <div class="pay-row">
                <span class="pay-label">Par chèque :</span>
                à l'ordre de <strong>${escapeHtml(pay.ordreCheque)}</strong>,
                à déposer dans la boîte aux lettres devant le bureau de l'entraîneur.
              </div>
              ${ibanLine}
            </div>
          </li>
        </ul>
      </div>
    `;
  }

  // ===== GÉNÉRATION PDF (bon de commande) =====
  async function generatePDF(commande) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const pageWidth = doc.internal.pageSize.getWidth();
    const marge = 15;
    let y = marge;

    const logoUrl = 'assets/' + (state.config.logo_detaille || 'logo_detailles.jpg');
    let logoHeight = 0;
    try {
      const dataUrl = await loadImageAsDataURL(logoUrl);
      if (dataUrl) {
        const imgProps = doc.getImageProperties(dataUrl);
        const maxWidth = 60;
        const ratio = imgProps.height / imgProps.width;
        logoHeight = Math.min(25, maxWidth * ratio);
        const logoWidth = logoHeight / ratio;
        doc.addImage(dataUrl, 'JPEG', marge, y, logoWidth, logoHeight);
      }
    } catch (err) { console.info('Logo PDF non chargé'); }

    doc.setTextColor(15, 15, 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('BON DE COMMANDE', pageWidth - marge, y + 6, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(107, 107, 112);
    doc.text(`N° ${commande.numero}`, pageWidth - marge, y + 13, { align: 'right' });
    const dateStr = new Date(commande.date).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
    doc.text(dateStr, pageWidth - marge, y + 19, { align: 'right' });

    y += Math.max(logoHeight, 25) + 6;

    doc.setDrawColor(200, 16, 46);
    doc.setLineWidth(0.8);
    doc.line(marge, y, pageWidth - marge, y);
    y += 8;

    doc.setTextColor(15, 15, 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(state.config.nom_club || 'Société des régates Rennaises', marge, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Informations du client', marge, y);
    y += 2;
    doc.setDrawColor(200, 16, 46);
    doc.setLineWidth(0.3);
    doc.line(marge, y, pageWidth - marge, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const c = commande.client;
    const infos = [
      ['Nom complet', `${c.prenom} ${c.nom}`],
      ['Email', c.email],
      ['Téléphone', c.telephone],
      ['Catégorie', c.categorieRameur],
    ];
    infos.forEach(([label, val]) => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${label} :`, marge, y);
      doc.setFont('helvetica', 'normal');
      doc.text(val || '-', marge + 35, y);
      y += 6;
    });

    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Articles commandés', marge, y);
    y += 2;
    doc.line(marge, y, pageWidth - marge, y);
    y += 4;

    const rows = commande.items.map(i => [
      i.sku || '',
      i.nom + (i.marque ? `\n(${i.marque})` : ''),
      i.genreLabel || '-',
      i.taille || '-',
      i.couleur || '-',
      String(i.qty),
      euros(i.prix),
      euros(i.prix * i.qty),
    ]);

    doc.autoTable({
      startY: y,
      head: [['Réf.', 'Article', 'Modèle', 'Taille', 'Couleur', 'Qté', 'PU', 'Total']],
      body: rows,
      theme: 'plain',
      headStyles: {
        fillColor: false,
        textColor: [15, 15, 16],
        fontStyle: 'bold',
        fontSize: 9,
        lineWidth: 0.3,
        lineColor: [15, 15, 16],
      },
      bodyStyles: {
        fontSize: 8.5,
        lineWidth: 0.1,
        lineColor: [180, 180, 180],
      },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 16, halign: 'center' },
        4: { cellWidth: 20, halign: 'center' },
        5: { cellWidth: 10, halign: 'center' },
        6: { cellWidth: 18, halign: 'right' },
        7: { cellWidth: 22, halign: 'right' },
      },
      margin: { left: marge, right: marge },
    });

    let finalY = doc.lastAutoTable.finalY + 6;

    doc.setDrawColor(200, 16, 46);
    doc.setLineWidth(0.8);
    doc.line(pageWidth - marge - 70, finalY, pageWidth - marge, finalY);
    finalY += 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 15, 16);
    doc.text('TOTAL :', pageWidth - marge - 65, finalY);
    doc.setTextColor(200, 16, 46);
    doc.text(euros(commande.total), pageWidth - marge - 3, finalY, { align: 'right' });

    finalY += 10;

    if (c.commentaire) {
      doc.setTextColor(15, 15, 16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Commentaire :', marge, finalY);
      finalY += 5;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(c.commentaire, pageWidth - 2 * marge);
      doc.text(lines, marge, finalY);
      finalY += lines.length * 5;
    }

    // ===== Bloc "Prochaines étapes" (paiement + WhatsApp) =====
    finalY += 6;
    const pageH = doc.internal.pageSize.getHeight();
    // Estimation de hauteur du bloc pour éviter les coupes disgracieuses
    const blocHeight = 46;
    if (finalY + blocHeight > pageH - 28) {
      doc.addPage();
      finalY = marge;
    }

    doc.setTextColor(15, 15, 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Prochaines étapes', marge, finalY);
    finalY += 2;
    doc.setDrawColor(200, 16, 46);
    doc.setLineWidth(0.3);
    doc.line(marge, finalY, pageWidth - marge, finalY);
    finalY += 5;

    const pay = getPaymentInfo();

    // 1. WhatsApp
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('1.', marge, finalY);
    doc.text('Prévenir le club de votre commande', marge + 5, finalY);
    finalY += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const waLines = doc.splitTextToSize(
      'Laissez un message sur le groupe WhatsApp « Boutique » pour signaler votre commande.',
      pageWidth - 2 * marge - 5);
    doc.text(waLines, marge + 5, finalY);
    finalY += waLines.length * 4.2 + 2;

    // 2. Règlement
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('2.', marge, finalY);
    doc.text('Règlement de la commande', marge + 5, finalY);
    finalY += 4.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const chqText = `• Par chèque à l'ordre de « ${pay.ordreCheque} », à déposer dans la boîte aux lettres devant le bureau de notre entraîneur.`;
    const chqLines = doc.splitTextToSize(chqText, pageWidth - 2 * marge - 5);
    doc.text(chqLines, marge + 5, finalY);
    finalY += chqLines.length * 4.2;

    if (pay.iban) {
      const virText = `• Par virement SEPA à l'IBAN suivant :`;
      doc.text(virText, marge + 5, finalY);
      finalY += 4.2;
      doc.setFont('courier', 'bold');
      doc.setFontSize(10);
      doc.text(pay.iban, marge + 9, finalY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      finalY += 4.5;
    }

    const pieY = doc.internal.pageSize.getHeight() - 20;
    doc.setDrawColor(200, 16, 46);
    doc.setLineWidth(0.3);
    doc.line(marge, pieY, pageWidth - marge, pieY);
    doc.setFontSize(8);
    doc.setTextColor(107, 107, 112);
    doc.setFont('helvetica', 'italic');
    const contact = state.config.email_contact || '';
    doc.text(
      `Bon de commande généré le ${dateStr}${contact ? ' · ' + contact : ''}`,
      pageWidth / 2, pieY + 6, { align: 'center' });
    doc.text('Merci de transmettre ce bon au club pour validation et paiement.',
      pageWidth / 2, pieY + 11, { align: 'center' });

    doc.save(`bon-commande-${commande.numero}.pdf`);
  }

  function loadImageAsDataURL(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('Image non trouvée: ' + url));
      img.src = url;
    });
  }

  async function sendToGoogleSheets(commande, url) {
    const payload = {
      numero: commande.numero,
      date: commande.date,
      client: commande.client,
      items: commande.items,
      total: commande.total,
    };
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initCatalogue();
  });

})();
