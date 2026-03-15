/* ════════════════════════════════════════════════════
   NOTRE CUISINE — app.js
   Modules : App · DB · Recipes · Planning · Shopping · RecipeForm · AI · Settings · Toast · Modal
════════════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────────────
   CATEGORIES & JOURS
──────────────────────────────────────────────────── */
const CATEGORIES = {
  entree:  { label: 'Entrée',   emoji: '🥗' },
  plat:    { label: 'Plat',     emoji: '🍽️' },
  dessert: { label: 'Dessert',  emoji: '🍰' },
  autre:   { label: 'Autre',    emoji: '🍴' },
};
const JOURS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const JOURS_KEYS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];

/* ════════════════════════════════════════════════════
   MODULE : SETTINGS (localStorage)
════════════════════════════════════════════════════ */
const Settings = {
  get(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem('nc_' + key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem('nc_' + key, JSON.stringify(val)); }
    catch {}
  },
  getFirebaseConfig() {
    return this.get('firebase', null);
  },
  getAnthropicKey() {
    return this.get('anthropic_key', '');
  },
  getUsername() {
    return this.get('username', '');
  },
  loadUI() {
    const fb = this.getFirebaseConfig() || {};
    document.getElementById('s-apiKey').value       = fb.apiKey        || '';
    document.getElementById('s-authDomain').value   = fb.authDomain    || '';
    document.getElementById('s-projectId').value    = fb.projectId     || '';
    document.getElementById('s-storageBucket').value= fb.storageBucket || '';
    document.getElementById('s-appId').value        = fb.appId         || '';
    document.getElementById('s-anthropicKey').value = this.getAnthropicKey();
    document.getElementById('s-username').value     = this.getUsername();
  },
  bindEvents() {
    document.getElementById('btn-save-firebase').onclick = () => {
      const cfg = {
        apiKey:        document.getElementById('s-apiKey').value.trim(),
        authDomain:    document.getElementById('s-authDomain').value.trim(),
        projectId:     document.getElementById('s-projectId').value.trim(),
        storageBucket: document.getElementById('s-storageBucket').value.trim(),
        appId:         document.getElementById('s-appId').value.trim(),
      };
      if (!cfg.apiKey || !cfg.projectId) { Toast.show('Renseignez au moins l\'API Key et le Project ID'); return; }
      this.set('firebase', cfg);
      Toast.show('✅ Firebase sauvegardé — rechargez l\'app');
      setTimeout(() => location.reload(), 1500);
    };
    document.getElementById('btn-save-anthropic').onclick = () => {
      const key = document.getElementById('s-anthropicKey').value.trim();
      this.set('anthropic_key', key);
      Toast.show('✅ Clé Anthropic sauvegardée');
    };
    document.getElementById('btn-save-profile').onclick = () => {
      const name = document.getElementById('s-username').value.trim();
      this.set('username', name);
      Toast.show('✅ Profil mis à jour');
    };
    document.getElementById('btn-clear-local').onclick = () => {
      if (confirm('Effacer toutes les données locales ?')) {
        localStorage.clear(); location.reload();
      }
    };
  }
};

/* ════════════════════════════════════════════════════
   MODULE : FIREBASE DB
════════════════════════════════════════════════════ */
const DB = {
  app: null, db: null, storage: null,
  _unsubscribers: [],

  async init() {
    const config = Settings.getFirebaseConfig();
    if (!config || !config.apiKey) {
      console.warn('⚠️ Firebase non configuré — mode démo local');
      return false;
    }
    try {
      const FB = window.__FB;
      if (!FB.getApps().length) {
        this.app = FB.initializeApp(config);
      } else {
        this.app = FB.getApps()[0];
      }
      this.db      = FB.getFirestore(this.app);
      this.storage = FB.getStorage(this.app);
      console.log('✅ Firebase connecté');
      return true;
    } catch (e) {
      console.error('Firebase init error:', e);
      return false;
    }
  },

  /* ─ Recettes ─ */
  async addRecipe(data) {
    if (!this.db) return this._localSave('recipes', data);
    const FB = window.__FB;
    const docRef = await FB.addDoc(FB.collection(this.db, 'recipes'), {
      ...data, createdAt: FB.serverTimestamp()
    });
    return docRef.id;
  },
  async updateRecipe(id, data) {
    if (!this.db) return this._localUpdate('recipes', id, data);
    const FB = window.__FB;
    await FB.updateDoc(FB.doc(this.db, 'recipes', id), data);
  },
  async deleteRecipe(id) {
    if (!this.db) return this._localDelete('recipes', id);
    const FB = window.__FB;
    await FB.deleteDoc(FB.doc(this.db, 'recipes', id));
  },
  watchRecipes(callback) {
    if (!this.db) {
      callback(this._localList('recipes'));
      return () => {};
    }
    const FB = window.__FB;
    const q = FB.query(FB.collection(this.db, 'recipes'), FB.orderBy('createdAt', 'desc'));
    const unsub = FB.onSnapshot(q, snap => {
      const recipes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(recipes);
    });
    this._unsubscribers.push(unsub);
    return unsub;
  },

  /* ─ Planning ─ */
  watchPlanning(weekId, callback) {
    if (!this.db) {
      callback(this._localGet('planning_' + weekId, {}));
      return () => {};
    }
    const FB = window.__FB;
    const docRef = FB.doc(this.db, 'meal_planning', weekId);
    const unsub = FB.onSnapshot(docRef, snap => {
      callback(snap.exists() ? snap.data() : {});
    });
    this._unsubscribers.push(unsub);
    return unsub;
  },
  async setPlanning(weekId, data) {
    if (!this.db) { this._localSet('planning_' + weekId, data); return; }
    const FB = window.__FB;
    await FB.setDoc(FB.doc(this.db, 'meal_planning', weekId), data);
  },

  /* ─ Liste de courses ─ */
  async setShoppingList(weekId, items) {
    if (!this.db) { this._localSet('shopping_' + weekId, items); return; }
    const FB = window.__FB;
    await FB.setDoc(FB.doc(this.db, 'shopping_lists', weekId), { items, updatedAt: FB.serverTimestamp() });
  },
  watchShoppingList(weekId, callback) {
    if (!this.db) {
      callback(this._localGet('shopping_' + weekId, []));
      return () => {};
    }
    const FB = window.__FB;
    const unsub = FB.onSnapshot(FB.doc(this.db, 'shopping_lists', weekId), snap => {
      callback(snap.exists() ? (snap.data().items || []) : []);
    });
    this._unsubscribers.push(unsub);
    return unsub;
  },

  /* ─ Upload image ─ */
  async uploadImage(file, path) {
    if (!this.storage) return null;
    const FB = window.__FB;
    const ref = FB.sRef(this.storage, path);
    // Compression basique via canvas
    const compressed = await this._compressImage(file, 800);
    const snapshot = await FB.uploadBytes(ref, compressed);
    return await FB.getDownloadURL(snapshot.ref);
  },
  async _compressImage(file, maxSize) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = height * maxSize / width; width = maxSize; }
          else { width = width * maxSize / height; height = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(resolve, 'image/jpeg', 0.80);
      };
      img.src = url;
    });
  },

  /* ─ Local fallback (mode démo sans Firebase) ─ */
  _localList(col) {
    return Settings.get(col, []);
  },
  _localSave(col, data) {
    const list = Settings.get(col, []);
    const id = 'local_' + Date.now();
    list.unshift({ id, ...data });
    Settings.set(col, list);
    return id;
  },
  _localUpdate(col, id, data) {
    const list = Settings.get(col, []);
    const idx = list.findIndex(x => x.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...data };
    Settings.set(col, list);
  },
  _localDelete(col, id) {
    const list = Settings.get(col, []).filter(x => x.id !== id);
    Settings.set(col, list);
  },
  _localGet(key, fallback) { return Settings.get(key, fallback); },
  _localSet(key, val) { Settings.set(key, val); },
};

/* ════════════════════════════════════════════════════
   MODULE : AI (Anthropic API)
════════════════════════════════════════════════════ */
const AI = {
  async call(messages, system = '', maxTokens = 1500) {
    const key = Settings.getAnthropicKey();
    if (!key) {
      Toast.show('⚠️ Ajoutez votre clé Anthropic dans les Réglages');
      throw new Error('No Anthropic key');
    }
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages,
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Anthropic API error ' + res.status);
    }
    const data = await res.json();
    return data.content.find(b => b.type === 'text')?.text || '';
  },

  /* Scan recette par image */
  async scanRecipe(imageBase64, mimeType = 'image/jpeg') {
    const system = `Tu es un assistant qui extrait des recettes depuis des photos.
Réponds UNIQUEMENT en JSON valide avec cette structure exacte :
{"title":"","category":"plat","prepTime":"","ingredients":[],"steps":[],"author":""}
- category : entree | plat | dessert | autre
- ingredients : tableau de strings, un ingrédient par item
- steps : tableau de strings, une étape par item
- author : chaîne vide si inconnu`;

    const text = await this.call([{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        { type: 'text', text: 'Extrais la recette de cette image.' }
      ]
    }], system, 1500);
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  },

  /* Suggestions semaine */
  async suggestWeek(existingRecipes) {
    const recipesList = existingRecipes.map(r =>
      `- ${r.title} (${r.category || 'plat'})`
    ).join('\n');
    const system = `Tu es un nutritionniste qui planifie des menus équilibrés.
Réponds UNIQUEMENT en JSON valide :
{"lundi":"","mardi":"","mercredi":"","jeudi":"","vendredi":"","samedi":"","dimanche":""}
Chaque valeur est le nom d'un repas ou d'une recette de la liste fournie.
Varie les catégories, équilibre les repas sur la semaine.`;
    const text = await this.call([{
      role: 'user',
      content: `Voici mes recettes disponibles :\n${recipesList || 'Aucune recette encore.'}\n\nPropose un planning de la semaine équilibré.`
    }], system, 800);
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  },
};

/* ════════════════════════════════════════════════════
   MODULE : TOAST
════════════════════════════════════════════════════ */
const Toast = {
  _timer: null,
  show(msg, duration = 2800) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden', 'out');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.classList.add('hidden'), 300);
    }, duration);
  }
};

/* ════════════════════════════════════════════════════
   MODULE : ROUTER / APP
════════════════════════════════════════════════════ */
const App = {
  _currentView: 'recipes',
  _history: [],
  _allRecipes: [],
  _planningUnsub: null,
  _shoppingUnsub: null,

  async init() {
    // Masquer le splash QUOI QU'IL ARRIVE apres 1.5s
    setTimeout(() => this._hideSplash(), 1500);
    try { await DB.init(); }        catch(e) { console.warn('DB:', e); }
    try { Settings.loadUI(); Settings.bindEvents(); } catch(e) { console.warn('Settings:', e); }
    try { this._bindNavigation(); this._bindSearch(); } catch(e) { console.warn('Nav:', e); }
    try { Recipes.init(); }         catch(e) { console.warn('Recipes:', e); }
    try { Planning.init(); }        catch(e) { console.warn('Planning:', e); }
    try { Shopping.init(); }        catch(e) { console.warn('Shopping:', e); }
    try { RecipeForm.init(); }      catch(e) { console.warn('RecipeForm:', e); }
  },

  _hideSplash() {
    const splash = document.getElementById('splash');
    const app    = document.getElementById('app');
    if (!splash || !app) return;
    splash.classList.add('out');
    setTimeout(() => {
      splash.style.display = 'none';
      app.classList.remove('hidden');
    }, 500);
  },

  navigate(target, pushHistory = true) {
    if (target === this._currentView && target !== 'add') return;
    if (pushHistory && target !== 'recipes') this._history.push(this._currentView);

    // Masquer toutes les vues
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const viewMap = {
      recipes:      'view-recipes',
      planning:     'view-planning',
      shopping:     'view-shopping',
      add:          'view-add',
      settings:     'view-settings',
      detail:       'view-detail',
      'planning-day': 'view-planning-day',
    };

    const viewId = viewMap[target];
    if (!viewId) return;

    const view = document.getElementById(viewId);
    if (view) view.classList.add('active');

    // Header title
    const title = view?.dataset.title || 'Notre Cuisine';
    document.getElementById('header-title').textContent = title;

    // Nav actif
    const navBtn = document.querySelector(`.nav-btn[data-target="${target}"]`);
    if (navBtn) navBtn.classList.add('active');

    // Bouton retour
    const backBtn = document.getElementById('btn-back');
    const brandEl = document.getElementById('header-brand');
    const isMain = ['recipes','planning','shopping','add','settings'].includes(target);
    backBtn.classList.toggle('hidden', isMain);
    brandEl.style.visibility = isMain ? 'visible' : 'hidden';

    // Bouton recherche visible seulement sur recettes
    document.getElementById('btn-search').style.visibility = target === 'recipes' ? 'visible' : 'hidden';

    // Réinitialiser vue ajout
    if (target === 'add') {
      document.getElementById('add-options-panel').classList.remove('hidden');
      document.getElementById('recipe-form-panel').classList.add('hidden');
      document.getElementById('scan-panel').classList.add('hidden');
      document.getElementById('f-edit-id').value = '';
      document.getElementById('header-title').textContent = 'Ajouter';
    }

    this._currentView = target;
    // Cache search bar
    document.getElementById('search-bar').classList.add('hidden');
  },

  goBack() {
    const prev = this._history.pop() || 'recipes';
    this.navigate(prev, false);
  },

  _bindNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        if (target) this.navigate(target);
      });
    });
    document.getElementById('btn-back').addEventListener('click', () => this.goBack());
  },

  _bindSearch() {
    const searchBtn = document.getElementById('btn-search');
    const searchBar = document.getElementById('search-bar');
    const searchInput = document.getElementById('search-input');
    const closeBtn = document.getElementById('btn-close-search');

    searchBtn.addEventListener('click', () => {
      searchBar.classList.toggle('hidden');
      if (!searchBar.classList.contains('hidden')) searchInput.focus();
    });
    closeBtn.addEventListener('click', () => {
      searchBar.classList.add('hidden');
      searchInput.value = '';
      Recipes.render(App._allRecipes);
    });
    searchInput.addEventListener('input', () => {
      Recipes.search(searchInput.value);
    });
  },
};

/* ════════════════════════════════════════════════════
   MODULE : RECIPES
════════════════════════════════════════════════════ */
const Recipes = {
  _filter: 'all',
  _allData: [],

  init() {
    this._bindFilters();
    DB.watchRecipes(data => {
      this._allData = data;
      App._allRecipes = data;
      this.render(this._applyFilter(data, this._filter));
    });
  },

  _bindFilters() {
    document.querySelectorAll('#filter-strip .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#filter-strip .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this._filter = chip.dataset.filter;
        this.render(this._applyFilter(this._allData, this._filter));
      });
    });
  },

  _applyFilter(data, filter) {
    if (filter === 'all') return data;
    return data.filter(r => r.category === filter);
  },

  search(query) {
    if (!query.trim()) { this.render(this._applyFilter(this._allData, this._filter)); return; }
    const q = query.toLowerCase();
    const filtered = this._allData.filter(r =>
      r.title?.toLowerCase().includes(q) ||
      r.ingredients?.join(' ').toLowerCase().includes(q)
    );
    this.render(filtered);
  },

  render(recipes) {
    const grid = document.getElementById('recipes-grid');
    const loading = document.getElementById('recipes-loading');
    if (loading) loading.remove();

    if (!recipes || recipes.length === 0) {
      grid.innerHTML = `<div class="state-block" style="grid-column:1/-1">
        <div style="font-size:48px;margin-bottom:12px">🍳</div>
        <p style="font-weight:600;color:var(--night-m);margin-bottom:4px">Aucune recette</p>
        <p style="font-size:13px">Appuyez sur <strong>+</strong> pour créer votre première recette !</p>
      </div>`;
      return;
    }

    grid.innerHTML = recipes.map((r, i) => this._cardHTML(r, i)).join('');
    grid.querySelectorAll('.recipe-card').forEach((card, i) => {
      card.style.animationDelay = (i * 0.04) + 's';
      card.addEventListener('click', () => this.showDetail(recipes[i].id));
    });
  },

  _cardHTML(r, i) {
    const catObj = CATEGORIES[r.category] || CATEGORIES.autre;
    const imgHTML = r.photoUrl
      ? `<img class="recipe-card-img" src="${r.photoUrl}" alt="${r.title}" loading="lazy">`
      : `<div class="recipe-card-img-placeholder">${catObj.emoji}</div>`;
    return `<div class="recipe-card">
      ${imgHTML}
      <div class="recipe-card-body">
        <div class="recipe-card-title">${r.title}</div>
        <div class="recipe-card-meta">
          <span class="recipe-card-cat">${catObj.label}</span>
          ${r.prepTime ? `<span>⏱ ${r.prepTime}</span>` : ''}
        </div>
      </div>
    </div>`;
  },

  showDetail(id) {
    const recipe = this._allData.find(r => r.id === id);
    if (!recipe) return;
    const container = document.getElementById('recipe-detail-content');
    const cat = CATEGORIES[recipe.category] || CATEGORIES.autre;

    const heroHTML = recipe.photoUrl
      ? `<div class="detail-hero"><img src="${recipe.photoUrl}" alt="${recipe.title}">
         <span class="detail-hero-badge">${cat.label}</span></div>`
      : `<div class="detail-hero"><div class="detail-hero-placeholder">${cat.emoji}</div>
         <span class="detail-hero-badge">${cat.label}</span></div>`;

    const ingredients = (recipe.ingredients || []).map(ing =>
      `<div class="detail-ingredient">${ing}</div>`).join('');

    const steps = (recipe.steps || []).map((s, i) =>
      `<div class="detail-step">
        <div class="detail-step-num">${i+1}</div>
        <div class="detail-step-text">${s}</div>
      </div>`).join('');

    container.innerHTML = `
      ${heroHTML}
      <div class="detail-body">
        <h1 class="detail-title">${recipe.title}</h1>
        <div class="detail-meta">
          ${recipe.prepTime ? `<span class="detail-meta-item">⏱ ${recipe.prepTime}</span>` : ''}
          ${recipe.author ? `<span class="detail-meta-item">👤 ${recipe.author}</span>` : ''}
        </div>
        ${ingredients ? `<div class="detail-section-title">Ingrédients</div>${ingredients}` : ''}
        ${steps ? `<div class="detail-section-title" style="margin-top:20px">Préparation</div>${steps}` : ''}
        <div class="detail-actions">
          <button class="btn-outline" onclick="Recipes.editFromDetail('${id}')">✏️ Modifier</button>
          <button class="btn-danger" onclick="Recipes.deleteFromDetail('${id}')">🗑️ Supprimer</button>
        </div>
      </div>`;

    App.navigate('detail');
  },

  editFromDetail(id) {
    const recipe = this._allData.find(r => r.id === id);
    if (recipe) RecipeForm.prefill(recipe);
  },

  async deleteFromDetail(id) {
    if (!confirm('Supprimer cette recette ?')) return;
    try {
      await DB.deleteRecipe(id);
      Toast.show('✅ Recette supprimée');
      App.navigate('recipes');
    } catch(e) {
      Toast.show('❌ Erreur : ' + e.message);
    }
  },

  getAll() { return this._allData; }
};

/* ════════════════════════════════════════════════════
   MODULE : RECIPE FORM
════════════════════════════════════════════════════ */
const RecipeForm = {
  _photoFile: null,
  _photoPreviewUrl: null,

  init() {
    document.getElementById('btn-manual').addEventListener('click', () => this.show());
    document.getElementById('btn-scan').addEventListener('click', () => this.showScan());
    document.getElementById('btn-cancel-form').addEventListener('click', () => this.cancel());
    document.getElementById('btn-cancel-scan').addEventListener('click', () => this.cancelScan());
    document.getElementById('btn-save-recipe').addEventListener('click', () => this.save());

    document.getElementById('form-photo-preview').addEventListener('click', () => {
      document.getElementById('photo-input').click();
    });
    document.getElementById('photo-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this._handlePhotoPreview(e.target.files[0]);
    });

    // Scan
    document.getElementById('scan-zone').addEventListener('click', () => {
      document.getElementById('scan-input').click();
    });
    document.getElementById('scan-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this._handleScanPreview(e.target.files[0]);
    });
    document.getElementById('btn-analyze-scan').addEventListener('click', () => this.analyzesScan());
  },

  show(prefillData = null) {
    document.getElementById('add-options-panel').classList.add('hidden');
    document.getElementById('scan-panel').classList.add('hidden');
    document.getElementById('recipe-form-panel').classList.remove('hidden');
    document.getElementById('header-title').textContent = prefillData ? 'Modifier' : 'Nouvelle recette';

    if (prefillData) {
      document.getElementById('f-title').value       = prefillData.title || '';
      document.getElementById('f-category').value    = prefillData.category || 'plat';
      document.getElementById('f-time').value        = prefillData.prepTime || '';
      document.getElementById('f-ingredients').value = (prefillData.ingredients||[]).join('\n');
      document.getElementById('f-steps').value       = (prefillData.steps||[]).join('\n');
      document.getElementById('f-author').value      = prefillData.author || '';
      document.getElementById('f-photo-url').value   = prefillData.photoUrl || '';
      if (prefillData.photoUrl) {
        const wrap = document.getElementById('form-photo-preview');
        wrap.innerHTML = `<img src="${prefillData.photoUrl}" alt="Photo">`;
      }
    } else {
      this._resetForm();
    }
  },

  prefill(recipe) {
    App.navigate('add');
    document.getElementById('f-edit-id').value = recipe.id;
    setTimeout(() => this.show(recipe), 100);
  },

  showScan() {
    document.getElementById('add-options-panel').classList.add('hidden');
    document.getElementById('recipe-form-panel').classList.add('hidden');
    document.getElementById('scan-panel').classList.remove('hidden');
    document.getElementById('scan-preview-wrap').classList.add('hidden');
    document.getElementById('scan-loading').classList.add('hidden');
    document.getElementById('header-title').textContent = 'Scanner';
  },

  _resetForm() {
    this._photoFile = null;
    this._photoPreviewUrl = null;
    ['f-title','f-time','f-ingredients','f-steps','f-author','f-edit-id','f-photo-url'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('f-category').value = 'plat';
    const wrap = document.getElementById('form-photo-preview');
    wrap.innerHTML = '<span class="form-photo-label">📷 Ajouter une photo</span>';
    document.getElementById('photo-input').value = '';
  },

  _handlePhotoPreview(file) {
    this._photoFile = file;
    const url = URL.createObjectURL(file);
    const wrap = document.getElementById('form-photo-preview');
    wrap.innerHTML = `<img src="${url}" alt="Aperçu" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`;
  },

  _handleScanPreview(file) {
    this._scanFile = file;
    const url = URL.createObjectURL(file);
    document.getElementById('scan-preview-img').src = url;
    document.getElementById('scan-preview-wrap').classList.remove('hidden');
  },

  async analyzesScan() {
    if (!this._scanFile) return;
    document.getElementById('scan-preview-wrap').classList.add('hidden');
    document.getElementById('scan-loading').classList.remove('hidden');
    try {
      // Convertir en base64
      const base64 = await this._fileToBase64(this._scanFile);
      const mimeType = this._scanFile.type || 'image/jpeg';
      const data = await AI.scanRecipe(base64, mimeType);

      // Pré-remplir le formulaire
      document.getElementById('f-title').value       = data.title || '';
      document.getElementById('f-category').value    = data.category || 'plat';
      document.getElementById('f-time').value        = data.prepTime || '';
      document.getElementById('f-ingredients').value = (data.ingredients||[]).join('\n');
      document.getElementById('f-steps').value       = (data.steps||[]).join('\n');
      document.getElementById('f-author').value      = data.author || '';

      Toast.show('✅ Recette extraite ! Vérifiez et sauvegardez.');
      this.show();
    } catch(e) {
      Toast.show('❌ ' + (e.message || 'Erreur analyse IA'));
      document.getElementById('scan-loading').classList.add('hidden');
      document.getElementById('scan-preview-wrap').classList.remove('hidden');
    }
  },

  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  async save() {
    const title = document.getElementById('f-title').value.trim();
    if (!title) { Toast.show('Le titre est obligatoire'); return; }

    const ingredients = document.getElementById('f-ingredients').value
      .split('\n').map(s => s.trim()).filter(Boolean);
    const steps = document.getElementById('f-steps').value
      .split('\n').map(s => s.trim()).filter(Boolean);

    if (ingredients.length === 0) { Toast.show('Ajoutez au moins un ingrédient'); return; }

    const editId   = document.getElementById('f-edit-id').value;
    const existUrl = document.getElementById('f-photo-url').value;

    const btn = document.getElementById('btn-save-recipe');
    btn.textContent = '⏳ Sauvegarde…';
    btn.disabled = true;

    try {
      let photoUrl = existUrl;
      if (this._photoFile) {
        const path = `recipes/${Date.now()}_${this._photoFile.name}`;
        photoUrl = await DB.uploadImage(this._photoFile, path) || null;
      }

      const data = {
        title,
        category:    document.getElementById('f-category').value,
        prepTime:    document.getElementById('f-time').value.trim(),
        ingredients, steps,
        author:      document.getElementById('f-author').value.trim() || Settings.getUsername(),
        photoUrl:    photoUrl || null,
      };

      if (editId) {
        await DB.updateRecipe(editId, data);
        Toast.show('✅ Recette mise à jour !');
      } else {
        await DB.addRecipe(data);
        Toast.show('✅ Recette ajoutée !');
      }
      App.navigate('recipes');
    } catch(e) {
      Toast.show('❌ Erreur : ' + e.message);
    } finally {
      btn.textContent = '💾 Sauvegarder';
      btn.disabled = false;
    }
  },

  cancel() {
    this._resetForm();
    App.navigate('add');
  },

  cancelScan() {
    this._scanFile = null;
    App.navigate('add');
  },
};

/* ════════════════════════════════════════════════════
   MODULE : PLANNING
════════════════════════════════════════════════════ */
const Planning = {
  _currentWeekStart: null,
  _planningData: {},
  _unsub: null,

  init() {
    this._currentWeekStart = this._getWeekStart(new Date());
    this._bindWeekNav();
    this._bindAISuggest();
    this._loadWeek();
  },

  _getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=dim, 1=lun...
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0,0,0,0);
    return d;
  },

  _weekId(date) {
    return 'week-' + date.toISOString().slice(0,10);
  },

  _weekLabel(date) {
    const end = new Date(date);
    end.setDate(end.getDate() + 6);
    const opts = { day: 'numeric', month: 'long' };
    const now = this._getWeekStart(new Date());
    if (date.getTime() === now.getTime()) return 'Cette semaine';
    return `${date.toLocaleDateString('fr-FR', opts)} – ${end.toLocaleDateString('fr-FR', opts)}`;
  },

  _bindWeekNav() {
    document.getElementById('week-prev').addEventListener('click', () => {
      this._currentWeekStart.setDate(this._currentWeekStart.getDate() - 7);
      this._loadWeek();
    });
    document.getElementById('week-next').addEventListener('click', () => {
      this._currentWeekStart.setDate(this._currentWeekStart.getDate() + 7);
      this._loadWeek();
    });
  },

  _bindAISuggest() {
    document.getElementById('btn-ai-suggest').addEventListener('click', () => {
      this.suggestWithAI();
    });
  },

  _loadWeek() {
    document.getElementById('week-label').textContent = this._weekLabel(this._currentWeekStart);
    const weekId = this._weekId(this._currentWeekStart);

    if (this._unsub) this._unsub();
    this._unsub = DB.watchPlanning(weekId, data => {
      this._planningData = data;
      this._renderDays();
    });
  },

  _renderDays() {
    const container = document.getElementById('planning-days');
    container.innerHTML = JOURS.map((jour, i) => {
      const key = JOURS_KEYS[i];
      const meal = this._planningData[key];
      const mealText = meal?.text || (meal?.recipeId ? this._getRecipeName(meal.recipeId) : null);
      return `<div class="planning-day-card" data-day="${key}">
        <div class="planning-day-label">${jour}</div>
        <div class="planning-day-meal ${mealText ? 'set' : ''}">
          ${mealText || '<em>Aucun repas</em>'}
        </div>
        <div class="planning-day-arrow">›</div>
      </div>`;
    }).join('');

    container.querySelectorAll('.planning-day-card').forEach(card => {
      card.addEventListener('click', () => this.openDayModal(card.dataset.day));
    });
  },

  _getRecipeName(id) {
    const r = App._allRecipes.find(r => r.id === id);
    return r ? r.title : '—';
  },

  openDayModal(dayKey) {
    const dayLabel = JOURS[JOURS_KEYS.indexOf(dayKey)];
    const current = this._planningData[dayKey] || {};
    const recipes = App._allRecipes;

    const recipesHTML = recipes.length
      ? recipes.map(r => {
          const selected = current.recipeId === r.id ? 'selected' : '';
          const img = r.photoUrl
            ? `<div class="recipe-picker-thumb"><img src="${r.photoUrl}" alt=""></div>`
            : `<div class="recipe-picker-thumb">${CATEGORIES[r.category]?.emoji || '🍽️'}</div>`;
          return `<div class="recipe-picker-item ${selected}" data-recipe-id="${r.id}">
            ${img}
            <div class="recipe-picker-name">${r.title}</div>
          </div>`;
        }).join('')
      : '<p class="muted-text">Aucune recette disponible</p>';

    const body = document.getElementById('planning-day-body');
    body.innerHTML = `
      <div class="planning-day-form">
        <h2>${dayLabel}</h2>
        <div class="section-label">Choisir une recette</div>
        <div class="recipes-picker" id="recipes-picker">${recipesHTML}</div>
        <div class="planning-or">— ou saisir librement —</div>
        <div class="form-group">
          <input type="text" id="meal-text-input" class="form-input"
            placeholder="Ex : Pizza maison, Restaurant…"
            value="${current.text || ''}">
        </div>
        <div class="planning-day-actions">
          <button class="btn-danger" id="btn-clear-day">🗑️ Vider</button>
          <button class="btn-primary" id="btn-save-day">✅ Valider</button>
        </div>
      </div>`;

    // Sélection recette
    let selectedRecipeId = current.recipeId || null;
    body.querySelectorAll('.recipe-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        body.querySelectorAll('.recipe-picker-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedRecipeId = item.dataset.recipeId;
        document.getElementById('meal-text-input').value = '';
      });
    });

    document.getElementById('btn-save-day').addEventListener('click', async () => {
      const text = document.getElementById('meal-text-input').value.trim();
      const weekId = this._weekId(this._currentWeekStart);
      const newData = { ...this._planningData };
      newData[dayKey] = { recipeId: selectedRecipeId || null, text: text || null };
      try {
        await DB.setPlanning(weekId, newData);
        Toast.show('✅ Repas enregistré');
        App.goBack();
      } catch(e) { Toast.show('❌ ' + e.message); }
    });

    document.getElementById('btn-clear-day').addEventListener('click', async () => {
      const weekId = this._weekId(this._currentWeekStart);
      const newData = { ...this._planningData };
      delete newData[dayKey];
      try {
        await DB.setPlanning(weekId, newData);
        Toast.show('Repas supprimé');
        App.goBack();
      } catch(e) { Toast.show('❌ ' + e.message); }
    });

    App.navigate('planning-day');
  },

  async suggestWithAI() {
    const recipes = App._allRecipes;
    const overlay = document.createElement('div');
    overlay.className = 'ai-overlay';
    overlay.innerHTML = '<div class="spinner" style="border-color:rgba(255,255,255,.2);border-top-color:#fff"></div><p>✨ L\'IA compose votre menu…</p>';
    document.body.appendChild(overlay);

    try {
      const suggestions = await AI.suggestWeek(recipes);
      const weekId = this._weekId(this._currentWeekStart);

      // Construire le planning depuis les suggestions
      const newData = {};
      for (const [day, mealName] of Object.entries(suggestions)) {
        if (!JOURS_KEYS.includes(day)) continue;
        // Chercher une recette correspondante
        const match = recipes.find(r => r.title.toLowerCase() === mealName.toLowerCase());
        newData[day] = { recipeId: match?.id || null, text: match ? null : mealName };
      }
      await DB.setPlanning(weekId, newData);
      Toast.show('✅ Planning IA généré !');
    } catch(e) {
      if (e.message !== 'No Anthropic key') Toast.show('❌ ' + e.message);
    } finally {
      overlay.remove();
    }
  },

  getCurrentWeekStart() { return this._currentWeekStart; },
  getPlanningData()    { return this._planningData; },
};

/* ════════════════════════════════════════════════════
   MODULE : SHOPPING
════════════════════════════════════════════════════ */
const Shopping = {
  _items: [],
  _unsub: null,

  init() {
    document.getElementById('btn-regen-shopping').addEventListener('click', () => this.generate());
    document.getElementById('btn-share-shopping').addEventListener('click', () => this.share());
    document.getElementById('btn-add-manual-item').addEventListener('click', () => this.addManual());

    const genBtn = document.getElementById('btn-gen-shopping');
    if (genBtn) genBtn.addEventListener('click', () => this.generate());

    // Observer le planning courant
    this._watchCurrentWeek();
  },

  _watchCurrentWeek() {
    const ws = Planning._currentWeekStart || Planning._getWeekStart(new Date());
    const weekId = 'week-' + ws.toISOString().slice(0,10);
    if (this._unsub) this._unsub();
    this._unsub = DB.watchShoppingList(weekId, items => {
      this._items = items || [];
      this._render();
    });
  },

  async generate() {
    const planning = Planning.getPlanningData();
    const recipes  = App._allRecipes;
    const allIngredients = [];

    for (const [day, meal] of Object.entries(planning)) {
      if (!meal) continue;
      const recipe = meal.recipeId ? recipes.find(r => r.id === meal.recipeId) : null;
      if (recipe && recipe.ingredients) {
        allIngredients.push(...recipe.ingredients);
      }
    }

    if (allIngredients.length === 0) {
      Toast.show('Aucun ingrédient trouvé dans le planning');
      return;
    }

    // Fusion et déduplification simple
    const merged = this._mergeIngredients(allIngredients);
    const items = merged.map(text => ({ text, done: false, id: Date.now() + Math.random() }));

    const ws = Planning._currentWeekStart || Planning._getWeekStart(new Date());
    const weekId = 'week-' + ws.toISOString().slice(0,10);
    try {
      await DB.setShoppingList(weekId, items);
      Toast.show(`✅ ${items.length} articles générés`);
    } catch(e) { Toast.show('❌ ' + e.message); }
  },

  _mergeIngredients(list) {
    // Nettoyer et grouper les doublons simples
    const seen = new Map();
    list.forEach(ing => {
      const clean = ing.trim().toLowerCase();
      if (!seen.has(clean)) seen.set(clean, ing.trim());
    });
    return Array.from(seen.values());
  },

  async toggleItem(index) {
    this._items[index].done = !this._items[index].done;
    const ws = Planning._currentWeekStart || Planning._getWeekStart(new Date());
    const weekId = 'week-' + ws.toISOString().slice(0,10);
    await DB.setShoppingList(weekId, this._items);
  },

  addManual() {
    const name = prompt('Article à ajouter :');
    if (!name?.trim()) return;
    const ws = Planning._currentWeekStart || Planning._getWeekStart(new Date());
    const weekId = 'week-' + ws.toISOString().slice(0,10);
    this._items.push({ text: name.trim(), done: false, id: Date.now() });
    DB.setShoppingList(weekId, this._items);
  },

  share() {
    const pending = this._items.filter(i => !i.done).map(i => '• ' + i.text).join('\n');
    const text = `🛒 Liste de courses — Notre Cuisine\n\n${pending || 'Rien à acheter !'}`;
    if (navigator.share) {
      navigator.share({ title: 'Liste de courses', text });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      Toast.show('📋 Copié dans le presse-papiers');
    }
  },

  _render() {
    const container = document.getElementById('shopping-list-container');
    if (this._items.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <p>Aucune liste générée</p>
        <button class="btn-primary sm" onclick="Shopping.generate()">Générer depuis le planning</button>
      </div>`;
      return;
    }

    const pending = this._items.filter(i => !i.done);
    const done    = this._items.filter(i =>  i.done);

    let html = '';
    if (pending.length) {
      html += `<div class="shopping-category">À acheter (${pending.length})</div>`;
      html += this._items.map((item, idx) =>
        item.done ? '' : this._itemHTML(item, idx)
      ).join('');
    }
    if (done.length) {
      html += `<div class="shopping-category">Dans le panier (${done.length})</div>`;
      html += this._items.map((item, idx) =>
        !item.done ? '' : this._itemHTML(item, idx)
      ).join('');
    }
    container.innerHTML = html;

    container.querySelectorAll('.shopping-item').forEach((el, i) => {
      const realIdx = parseInt(el.dataset.idx);
      el.addEventListener('click', () => this.toggleItem(realIdx));
    });
  },

  _itemHTML(item, idx) {
    const done = item.done;
    return `<div class="shopping-item ${done ? 'done' : ''}" data-idx="${idx}">
      <div class="shopping-check">${done ? '✓' : ''}</div>
      <div class="shopping-item-text">${item.text}</div>
    </div>`;
  },
};

/* ════════════════════════════════════════════════════
   DÉMARRAGE
════════════════════════════════════════════════════ */
// App.init() est appelé depuis index.html via s.onload
