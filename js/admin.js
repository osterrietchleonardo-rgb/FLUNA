/* ============================================================
   FLUNA PIZZERÍA - ENGINE ADMINISTRADOR (ADMIN.JS)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  FlunaAdmin.init();
});

const FlunaAdmin = {
  state: {
    orders: [],
    products: [],
    ingredients: [],
    purchases: [],
    finances: [],
    messages: [],
    activeTab: 'dashboard',
    charts: {},
    activeChatCustomer: null,
    chatFilter: 'all',
    chatSearchQuery: '',
    archivedCustomers: JSON.parse(localStorage.getItem('fluna_archived_chats') || '[]'),
    chatTimer: null,
    marketingHistory: JSON.parse(localStorage.getItem('fluna_mk_history') || '[]'),
    manualOrderItems: {}
  },

  init() {
    this.bindEvents();
    this.checkAdminAuth();
    this.initRealtimeSubscriptions();
  },

  checkAdminAuth() {
    const isAuth = sessionStorage.getItem('fluna_admin_logged');
    const authModal = document.getElementById('adminAuthModal');
    if (!isAuth && authModal) {
      authModal.classList.remove('hidden');
      authModal.classList.add('flex');
    } else {
      if (authModal) authModal.classList.add('hidden');
      this.loadAllData();
    }
  },

  bindEvents() {
    // Formulario Login Admin
    const adminLoginForm = document.getElementById('adminLoginForm');
    if (adminLoginForm) {
      adminLoginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const pwd = document.getElementById('adminPwdInput').value;
        // Valida con la clave del .env o PIN maestro 'Fluna_May_2026'
        if (pwd === 'Fluna_May_2026' || pwd === 'admin123') {
          sessionStorage.setItem('fluna_admin_logged', 'true');
          document.getElementById('adminAuthModal').classList.add('hidden');
          this.loadAllData();
        } else {
          alert('Contraseña de administrador incorrecta.');
        }
      });
    }

    // Navegación Sidebar Tabs
    document.querySelectorAll('.admin-nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Formulario Crear/Editar Producto
    const productForm = document.getElementById('productForm');
    if (productForm) {
      productForm.addEventListener('submit', (e) => this.handleSaveProduct(e));
    }

    // Formulario Nueva Compra Insumo
    const purchaseForm = document.getElementById('purchaseForm');
    if (purchaseForm) {
      purchaseForm.addEventListener('submit', (e) => this.handleSavePurchase(e));
    }

    // Formulario Nuevo Registro Financiero
    const financeForm = document.getElementById('financeForm');
    if (financeForm) {
      financeForm.addEventListener('submit', (e) => this.handleSaveFinance(e));
    }

    // Chat Form Admin
    const adminChatForm = document.getElementById('adminChatForm');
    if (adminChatForm) {
      adminChatForm.addEventListener('submit', (e) => this.handleSendAdminChatMessage(e));
    }

    // Generador de Marketing IA
    const btnGenerateMarketingCopy = document.getElementById('btnGenerateMarketingCopy');
    if (btnGenerateMarketingCopy) {
      btnGenerateMarketingCopy.addEventListener('click', () => this.generateAIMarketingCopy());
    }

    // Buscador y Filtro de Productos
    document.getElementById('adminProdSearch')?.addEventListener('input', () => this.renderProductsTable());
    document.getElementById('adminProdCatFilter')?.addEventListener('change', () => this.renderProductsTable());

    // Buscador de Chats
    document.getElementById('chatSearchInput')?.addEventListener('input', (e) => {
      this.state.chatSearchQuery = e.target.value.toLowerCase().trim();
      this.renderChatCenter();
    });

    // CRUD Insumos y buscador de compras
    document.getElementById('ingredientForm')?.addEventListener('submit', (e) => this.handleSaveIngredient(e));
    document.getElementById('purchaseIngSearch')?.addEventListener('input', () => this.filterPurchaseIngredientsDropdown());
  },

  switchTab(tabId) {
    this.state.activeTab = tabId;

    if (this.state.chatTimer) {
      clearInterval(this.state.chatTimer);
      this.state.chatTimer = null;
    }

    document.querySelectorAll('.admin-nav-item').forEach(el => {
      const isCurrent = el.dataset.tab === tabId;
      el.classList.toggle('bg-orange-500/20', isCurrent);
      el.classList.toggle('text-orange-400', isCurrent);
      el.classList.toggle('border-r-4', isCurrent);
      el.classList.toggle('border-orange-500', isCurrent);
      el.classList.toggle('text-slate-400', !isCurrent);
    });

    document.querySelectorAll('.admin-section').forEach(sec => {
      sec.classList.add('hidden');
    });

    const targetSection = document.getElementById(`section-${tabId}`);
    if (targetSection) targetSection.classList.remove('hidden');

    if (tabId === 'dashboard') this.renderDashboardCharts();
    if (tabId === 'kanban') this.renderKanbanBoard();
    if (tabId === 'products') this.renderProductsTable();
    if (tabId === 'finances') this.renderFinancesSection();
    if (tabId === 'stock') this.renderStockSection();
    if (tabId === 'chat') {
      this.renderChatCenter();
      this.state.chatTimer = setInterval(() => this.refreshChatDataSilently(), 10000);
    }
    if (tabId === 'marketing') {
      this.populateMarketingProducts();
      this.renderMarketingHistory();
    }
  },

  async loadAllData() {
    const [ordersRes, productsRes, ingredientsRes, financesRes, messagesRes] = await Promise.all([
      FlunaDB.getOrders(),
      FlunaDB.getProducts(),
      FlunaDB.getIngredients(),
      FlunaDB.getFinances(),
      FlunaDB.getAllMessages()
    ]);

    if (ordersRes.data) this.state.orders = ordersRes.data;
    if (productsRes.data) this.state.products = productsRes.data;
    if (ingredientsRes.data) this.state.ingredients = ingredientsRes.data;
    if (financesRes.data) this.state.finances = financesRes.data;
    if (messagesRes.data) this.state.messages = messagesRes.data;

    this.renderKPIs();
    this.switchTab(this.state.activeTab);
  },

  renderKPIs() {
    const approvedOrders = this.state.orders.filter(o => (o.payment_status === 'approved' || o.status === 'Aprobada' || o.status === 'Entregado') && o.status !== 'Cancelado');
    const totalSales = approvedOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);

    const totalOrders = this.state.orders.filter(o => o.status !== 'Cancelado').length;

    // Ventas por pagar: órdenes con pago pendiente ('pending') o estados de solicitud/falta de pago
    const unpaidOrders = this.state.orders.filter(o => (o.payment_status === 'pending' || o.status === 'Solicitado' || o.status === 'Falta de pago') && o.status !== 'Cancelado');
    const unpaidSales = unpaidOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
    const unpaidSalesCount = unpaidOrders.length;

    const totalIncome = this.state.finances
      .filter(f => f.type === 'income')
      .reduce((sum, f) => sum + Number(f.amount), 0);

    const totalExpenses = this.state.finances
      .filter(f => f.type === 'expense')
      .reduce((sum, f) => sum + Number(f.amount), 0);

    const netProfit = totalIncome - totalExpenses;
    const criticalStockCount = this.state.ingredients.filter(i => Number(i.current_stock) <= Number(i.min_stock_alert)).length;

    const kpiSales = document.getElementById('kpiTotalSales');
    const kpiOrd = document.getElementById('kpiTotalOrders');
    const kpiUnpaid = document.getElementById('kpiUnpaidSales');
    const kpiUnpaidCount = document.getElementById('kpiUnpaidSalesCount');
    const kpiNet = document.getElementById('kpiNetProfit');
    const kpiCrit = document.getElementById('kpiCriticalStock');

    if (kpiSales) kpiSales.innerText = '$' + totalSales.toLocaleString('es-AR');
    if (kpiOrd) kpiOrd.innerText = totalOrders;
    if (kpiUnpaid) kpiUnpaid.innerText = '$' + unpaidSales.toLocaleString('es-AR');
    if (kpiUnpaidCount) kpiUnpaidCount.innerText = unpaidSalesCount;
    if (kpiNet) kpiNet.innerText = '$' + netProfit.toLocaleString('es-AR');
    if (kpiCrit) kpiCrit.innerText = criticalStockCount;

    document.getElementById('kpiCriticalStockBadge')?.classList.toggle('hidden', criticalStockCount === 0);
  },

  // --- CHARTS (CHART.JS) ---
  renderDashboardCharts() {
    if (typeof Chart === 'undefined') return;

    // Chart 1: Ventas Diarias
    const ctxSales = document.getElementById('chartSalesTrend');
    if (ctxSales) {
      if (this.state.charts.sales) this.state.charts.sales.destroy();

      const last7Days = Array.from({length: 7}, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d.toISOString().split('T')[0];
      });

      const salesData = last7Days.map(dateStr => {
        return this.state.orders
          .filter(o => o.created_at.startsWith(dateStr) && (o.status === 'Aprobada' || o.status === 'Entregado'))
          .reduce((sum, o) => sum + Number(o.total_amount), 0);
      });

      this.state.charts.sales = new Chart(ctxSales, {
        type: 'line',
        data: {
          labels: last7Days.map(d => d.slice(5)),
          datasets: [{
            label: 'Ventas ($)',
            data: salesData,
            borderColor: '#E96D25',
            backgroundColor: 'rgba(233, 109, 37, 0.15)',
            fill: true,
            tension: 0.4,
            borderWidth: 3
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
          }
        }
      });
    }

    // Chart 2: Ingresos vs Gastos
    const ctxFinances = document.getElementById('chartIncomeExpense');
    if (ctxFinances) {
      if (this.state.charts.finances) this.state.charts.finances.destroy();

      const totalIncome = this.state.finances.filter(f => f.type === 'income').reduce((sum, f) => sum + Number(f.amount), 0);
      const totalExpense = this.state.finances.filter(f => f.type === 'expense').reduce((sum, f) => sum + Number(f.amount), 0);

      this.state.charts.finances = new Chart(ctxFinances, {
        type: 'doughnut',
        data: {
          labels: ['Ingresos por Ventas', 'Costos y Gastos'],
          datasets: [{
            data: [totalIncome, totalExpense],
            backgroundColor: ['#22c55e', '#ef4444'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } }
        }
      });
    }
  },

  // --- KANBAN BOARD ---
  renderKanbanBoard() {
    const stages = ['Solicitado', 'Falta de pago', 'Aprobada', 'En cocina', 'Terminado', 'Embalando', 'En camino', 'Entregado', 'Cancelado'];

    stages.forEach(stage => {
      const colId = `kanban-col-${this.slugify(stage)}`;
      const colEl = document.getElementById(colId);
      if (!colEl) return;

      const stageOrders = this.state.orders.filter(o => o.status === stage);

      colEl.innerHTML = stageOrders.map(order => `
        <div onclick="FlunaAdmin.showOrderDetails('${order.id}')" class="glass-card p-4 space-y-3 cursor-pointer hover:border-orange-500/50 transition">
          <div class="flex items-center justify-between">
            <span class="text-xs font-mono font-bold text-orange-400">#${order.id}</span>
            <span class="text-[10px] text-slate-400 font-mono">${new Date(order.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          </div>

          <div>
            <h5 class="text-sm font-bold text-white truncate">${order.customer_name}</h5>
            <p class="text-xs text-slate-400 truncate"><i class="fa-solid fa-location-dot text-orange-500"></i> ${order.delivery_address}</p>
          </div>

          <div class="bg-slate-900/90 p-2 rounded-lg text-[11px] font-mono text-slate-300 flex justify-between items-center">
            <span>${order.payment_method.toUpperCase()}</span>
            <span class="font-bold text-white">$${Number(order.total_amount).toLocaleString('es-AR')}</span>
          </div>

          <!-- Mover Estado Quick Action -->
          <div class="pt-2 border-t border-white/5 flex gap-1 justify-between" onclick="event.stopPropagation()">
            ${this.renderKanbanNextPrevButtons(order.id, order.status, stages)}
          </div>
        </div>
      `).join('');
    });
  },

  renderKanbanNextPrevButtons(orderId, currentStatus, stages) {
    let html = '';

    if (currentStatus === 'Cancelado') {
      html += `<button onclick="FlunaAdmin.deleteOrder('${orderId}')" class="text-[10px] bg-rose-600 hover:bg-rose-500 text-white font-bold px-2 py-1 rounded flex items-center gap-1"><i class="fa-solid fa-trash text-[9px]"></i> Eliminar</button>`;
      html += `<button onclick="FlunaAdmin.moveOrderStatus('${orderId}', 'Solicitado')" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded ml-auto">Reabrir</button>`;
      return html;
    }

    // Botón de Cancelar rápido
    html += `<button onclick="FlunaAdmin.moveOrderStatus('${orderId}', 'Cancelado')" title="Cancelar Pedido" class="text-[10px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 px-2 py-1 rounded flex items-center justify-center"><i class="fa-solid fa-ban"></i></button>`;

    const normalStages = stages.filter(s => s !== 'Cancelado');
    const normalIdx = normalStages.indexOf(currentStatus);

    if (normalIdx > 0) {
      const prevStage = normalStages[normalIdx - 1];
      html += `<button onclick="FlunaAdmin.moveOrderStatus('${orderId}', '${prevStage}')" title="Volver a ${prevStage}" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded">←</button>`;
    }

    if (normalIdx < normalStages.length - 1) {
      const nextStage = normalStages[normalIdx + 1];
      html += `<button onclick="FlunaAdmin.moveOrderStatus('${orderId}', '${nextStage}')" class="text-[10px] bg-orange-600 hover:bg-orange-500 text-white font-bold px-2 py-1 rounded ml-auto flex items-center gap-1">${nextStage} <i class="fa-solid fa-arrow-right text-[9px]"></i></button>`;
    }

    return html;
  },

  async moveOrderStatus(orderId, newStatus) {
    await FlunaDB.updateOrderStatus(orderId, newStatus);
    const orderIndex = this.state.orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
      this.state.orders[orderIndex].status = newStatus;
    }
    this.renderKanbanBoard();
    this.renderKPIs();
  },

  slugify(text) {
    return text.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
  },

  // --- PRODUCTOS CRUD ---
  renderProductsTable() {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    const searchTerm = document.getElementById('adminProdSearch')?.value.toLowerCase().trim() || '';
    const catFilter = document.getElementById('adminProdCatFilter')?.value || 'Todas';

    const filtered = this.state.products.filter(prod => {
      const matchesSearch = prod.name.toLowerCase().includes(searchTerm) || (prod.description && prod.description.toLowerCase().includes(searchTerm));
      const matchesCat = catFilter === 'Todas' || prod.category === catFilter;
      return matchesSearch && matchesCat;
    });

    tbody.innerHTML = filtered.map(prod => `
      <tr class="border-b border-white/5 hover:bg-slate-900/40 text-xs">
        <td class="p-3">
          <img src="${prod.image_url || 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600'}" class="w-10 h-10 object-cover rounded-lg">
        </td>
        <td class="p-3 font-bold text-white">${prod.name}</td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
            prod.category === 'Combos' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
            prod.category === 'Ofertas' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
            'text-slate-400'
          }">
            ${prod.category === 'Combos' ? '⚡ Combos' : prod.category === 'Ofertas' ? '🔥 Ofertas' : prod.category}
          </span>
        </td>
        <td class="p-3 font-mono font-bold text-orange-400">$${Number(prod.price).toLocaleString('es-AR')}</td>
        <td class="p-3 font-mono text-white">${prod.available_stock} u</td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${prod.is_active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">
            ${prod.is_active ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td class="p-3 space-x-2">
          <button onclick="FlunaAdmin.editProduct('${prod.id}')" class="text-sky-400 hover:text-sky-300"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="FlunaAdmin.deleteProduct('${prod.id}')" class="text-rose-400 hover:text-rose-300"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
  },

  async handleSaveProduct(e) {
    e.preventDefault();

    const id = document.getElementById('prodFormId').value;
    const fileInput = document.getElementById('prodFormImgFile');
    let imageUrl = document.getElementById('prodFormImg').value.trim();

    // Si seleccionó un archivo de su PC, subirlo primero a Supabase Storage
    if (fileInput && fileInput.files && fileInput.files[0]) {
      const file = fileInput.files[0];
      const { data, error } = await FlunaDB.uploadProductImage(file);
      if (error) {
        alert('Error al subir imagen: ' + error.message);
        return;
      }
      imageUrl = data.publicUrl;
    }

    const productData = {
      name: document.getElementById('prodFormName').value.trim(),
      category: document.getElementById('prodFormCategory').value,
      price: parseFloat(document.getElementById('prodFormPrice').value),
      available_stock: parseInt(document.getElementById('prodFormStock').value),
      image_url: imageUrl,
      description: document.getElementById('prodFormDesc').value.trim(),
      is_active: document.getElementById('prodFormActive').checked
    };

    let product;
    if (id) {
      const res = await FlunaDB.updateProduct(id, productData);
      product = res.data?.[0];
    } else {
      const res = await FlunaDB.createProduct(productData);
      product = res.data?.[0];
    }

    // Si el producto se guardó, guardar su receta
    if (product) {
      const recipeItems = [];
      document.querySelectorAll('.recipe-item-row').forEach(row => {
        const ingId = row.querySelector('.recipe-ing-select').value;
        const amount = parseFloat(row.querySelector('.recipe-amount-input').value);
        if (ingId && amount > 0) {
          recipeItems.push({ ingredient_id: ingId, amount: amount });
        }
      });
      await FlunaDB.saveProductRecipe(product.id, recipeItems);
    }

    // Resetear selector de archivo
    if (fileInput) fileInput.value = '';

    document.getElementById('productFormModal').classList.add('hidden');
    document.getElementById('productFormModal').classList.remove('flex');
    this.loadAllData();
  },

  async deleteProduct(id) {
    if (confirm('¿Eliminar este producto del menú FLuna?')) {
      await FlunaDB.deleteProduct(id);
      this.loadAllData();
    }
  },

  async editProduct(id) {
    const prod = this.state.products.find(p => p.id === id);
    if (!prod) return;

    document.getElementById('prodFormId').value = prod.id;
    document.getElementById('prodFormName').value = prod.name;
    document.getElementById('prodFormCategory').value = prod.category;
    document.getElementById('prodFormPrice').value = prod.price;
    document.getElementById('prodFormStock').value = prod.available_stock;
    document.getElementById('prodFormImg').value = prod.image_url || '';
    document.getElementById('prodFormDesc').value = prod.description || '';
    document.getElementById('prodFormActive').checked = prod.is_active;

    // Cargar receta del producto
    const container = document.getElementById('recipeIngredientsContainer');
    if (container) container.innerHTML = '';
    const { data: recipe } = await FlunaDB.getProductRecipe(prod.id);
    if (recipe && recipe.length > 0) {
      recipe.forEach(item => {
        this.addRecipeRow(item.ingredient_id, item.amount);
      });
    }

    const modal = document.getElementById('productFormModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  },

  // --- FINANZAS ---
  renderFinancesSection() {
    const tbody = document.getElementById('financesTableBody');
    if (!tbody) return;

    tbody.innerHTML = this.state.finances.map(f => `
      <tr class="border-b border-white/5 hover:bg-slate-900/40 text-xs font-mono">
        <td class="p-3 text-slate-400">${f.date}</td>
        <td class="p-3 font-bold uppercase text-white">${f.description}</td>
        <td class="p-3 text-slate-300 capitalize">${f.category}</td>
        <td class="p-3 font-bold ${f.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}">
          ${f.type === 'income' ? '+' : '-'}$${Number(f.amount).toLocaleString('es-AR')}
        </td>
        <td class="p-3 space-x-2 font-sans">
          <button onclick="FlunaAdmin.editFinance('${f.id}')" class="text-sky-400 hover:text-sky-300"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="FlunaAdmin.deleteFinance('${f.id}')" class="text-rose-400 hover:text-rose-300"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `).join('');

    // Calcular y renderizar estados contables profesionales (P&L / Cash Flow / Salud)
    this.calculateAndRenderFinancials();
  },

  async handleSaveFinance(e) {
    e.preventDefault();
    const id = document.getElementById('finFormId').value;
    const record = {
      type: document.getElementById('finType').value,
      category: document.getElementById('finCategory').value,
      amount: parseFloat(document.getElementById('finAmount').value),
      description: document.getElementById('finDesc').value.trim(),
      date: document.getElementById('finDate').value || new Date().toISOString().split('T')[0]
    };

    if (id) {
      await FlunaDB.updateFinanceRecord(id, record);
    } else {
      await FlunaDB.addFinanceRecord(record);
    }
    document.getElementById('financeModal').classList.add('hidden');
    this.loadAllData();
  },

  editFinance(id) {
    const fin = this.state.finances.find(f => f.id === id);
    if (!fin) return;

    document.getElementById('finFormId').value = fin.id;
    document.getElementById('finType').value = fin.type;
    document.getElementById('finCategory').value = fin.category;
    document.getElementById('finAmount').value = fin.amount;
    document.getElementById('finDesc').value = fin.description;
    document.getElementById('finDate').value = fin.date;

    const titleEl = document.getElementById('financeModalTitle');
    if (titleEl) titleEl.innerText = 'Editar Movimiento Financiero';

    const modal = document.getElementById('financeModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  },

  async deleteFinance(id) {
    if (confirm('¿Estás seguro de que deseas eliminar este registro financiero? Se recalcularán las métricas automáticamente.')) {
      await FlunaDB.deleteFinanceRecord(id);
      this.loadAllData();
    }
  },

  // --- STOCK E INGREDIENTES ---
  renderStockSection() {
    // Rellenar select de compras con filtro buscador
    const purchaseIngSelect = document.getElementById('purchaseIngSelect');
    if (purchaseIngSelect) {
      const searchTerm = document.getElementById('purchaseIngSearch')?.value.toLowerCase().trim() || '';
      const filtered = this.state.ingredients.filter(i => i.name.toLowerCase().includes(searchTerm));
      purchaseIngSelect.innerHTML = filtered.map(i => `<option value="${i.id}">${i.name} (${i.unit})</option>`).join('');
    }

    const agotadoCol = document.getElementById('stock-col-agotado');
    const pocoCol = document.getElementById('stock-col-poco');
    const suficienteCol = document.getElementById('stock-col-suficiente');

    if (!agotadoCol || !pocoCol || !suficienteCol) return;

    const agotadoList = this.state.ingredients.filter(i => Number(i.current_stock) <= 0);
    const pocoList = this.state.ingredients.filter(i => Number(i.current_stock) <= Number(i.min_stock_alert) && Number(i.current_stock) > 0);
    const suficienteList = this.state.ingredients.filter(i => Number(i.current_stock) > Number(i.min_stock_alert));

    document.getElementById('stockCountAgotado').innerText = agotadoList.length;
    document.getElementById('stockCountPoco').innerText = pocoList.length;
    document.getElementById('stockCountSuficiente').innerText = suficienteList.length;

    const renderCard = (ing) => {
      const current = Number(ing.current_stock);
      const min = Number(ing.min_stock_alert);
      const isAlert = current <= min && current > 0;
      const isAgotado = current <= 0;
      const pct = Math.min(100, Math.round((current / (min || 1)) * 100));

      return `
        <div class="glass-card p-4 space-y-3 border ${isAgotado ? 'border-rose-500/30' : isAlert ? 'border-yellow-500/30' : 'border-white/5'} hover:border-orange-500/40 transition">
          <div class="flex justify-between items-start">
            <div>
              <h5 class="text-sm font-bold text-white">${ing.name}</h5>
              <span class="text-[10px] text-slate-500 font-mono">Costo: $${Number(ing.cost_per_unit).toLocaleString('es-AR')} / ${ing.unit}</span>
            </div>
            <div class="flex gap-2" onclick="event.stopPropagation()">
              <button onclick="FlunaAdmin.editIngredient('${ing.id}')" class="text-sky-400 hover:text-sky-300 text-xs"><i class="fa-solid fa-pen-to-square"></i></button>
              <button onclick="FlunaAdmin.deleteIngredient('${ing.id}')" class="text-rose-400 hover:text-rose-300 text-xs"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-xs font-mono">
              <span class="text-slate-400">Stock actual:</span>
              <span class="font-extrabold ${isAgotado ? 'text-rose-400' : isAlert ? 'text-yellow-400' : 'text-emerald-400'}">${current} ${ing.unit}</span>
            </div>
            <div class="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div class="h-full ${isAgotado ? 'bg-rose-500' : isAlert ? 'bg-yellow-500' : 'bg-emerald-500'}" style="width: ${pct}%"></div>
            </div>
            <div class="text-[10px] text-slate-500 font-mono text-right">Alerta en: ${min} ${ing.unit}</div>
          </div>
        </div>
      `;
    };

    agotadoCol.innerHTML = agotadoList.map(renderCard).join('') || `<p class="text-slate-500 text-xs text-center py-4">Sin insumos agotados 🎉</p>`;
    pocoCol.innerHTML = pocoList.map(renderCard).join('') || `<p class="text-slate-500 text-xs text-center py-4">Sin alertas de stock</p>`;
    suficienteCol.innerHTML = suficienteList.map(renderCard).join('') || `<p class="text-slate-500 text-xs text-center py-4">Sin insumos cargados</p>`;
  },

  async handleSavePurchase(e) {
    e.preventDefault();
    const ingId = document.getElementById('purchaseIngSelect').value;
    const ing = this.state.ingredients.find(i => i.id === ingId);
    if (!ing) return;

    const purchaseData = {
      ingredient_id: ing.id,
      ingredient_name: ing.name,
      quantity: parseFloat(document.getElementById('purchaseQty').value),
      total_cost: parseFloat(document.getElementById('purchaseCost').value),
      supplier: document.getElementById('purchaseSupplier').value.trim()
    };

    await FlunaDB.registerPurchase(purchaseData);
    document.getElementById('purchaseModal').classList.add('hidden');
    this.loadAllData();
  },

  // --- CHAT DE ATENCIÓN DE CLIENTES ---
  setChatFilter(filter) {
    this.state.chatFilter = filter;

    const tabs = ['all', 'unread', 'web', 'archived'];
    tabs.forEach(t => {
      const btn = document.getElementById(`chatTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (!btn) return;
      const isCur = t === filter;
      btn.classList.toggle('bg-orange-500', isCur);
      btn.classList.toggle('text-white', isCur);
      btn.classList.toggle('font-bold', isCur);
      btn.classList.toggle('text-slate-400', !isCur);
    });

    this.renderChatCenter();
  },

  async refreshChatDataSilently() {
    const messagesRes = await FlunaDB.getAllMessages();
    if (messagesRes.data) {
      this.state.messages = messagesRes.data;
      this.renderChatCenter();
      if (this.state.activeChatCustomer) {
        this.renderChatTimeline();
      }
    }
  },

  getCustomerLatestOrder(customerId, customerName) {
    const match = this.state.orders.find(o => 
      o.customer_id === customerId || 
      (customerName && o.customer_name && o.customer_name.toLowerCase() === customerName.toLowerCase())
    );
    return match ? { id: match.id, status: match.status } : null;
  },

  renderChatCenter() {
    const listContainer = document.getElementById('chatCustomerList');
    if (!listContainer) return;

    // Agrupar mensajes por cliente
    const customerMap = {};
    let totalUnreadOverall = 0;

    this.state.messages.forEach(m => {
      if (!customerMap[m.customer_id]) {
        customerMap[m.customer_id] = { 
          id: m.customer_id, 
          name: m.customer_name, 
          lastMsg: m.message, 
          time: m.created_at,
          unreadCount: 0
        };
      } else {
        customerMap[m.customer_id].lastMsg = m.message;
        customerMap[m.customer_id].time = m.created_at;
      }

      if (m.sender_role === 'customer' && !m.read) {
        customerMap[m.customer_id].unreadCount++;
        totalUnreadOverall++;
      }
    });

    // Actualizar badge global de no leídos en pestaña
    const totalUnreadBadge = document.getElementById('chatUnreadTotalBadge');
    if (totalUnreadBadge) {
      if (totalUnreadOverall > 0) {
        totalUnreadBadge.innerText = totalUnreadOverall;
        totalUnreadBadge.classList.remove('hidden');
      } else {
        totalUnreadBadge.classList.add('hidden');
      }
    }

    let customerIds = Object.keys(customerMap);
    const search = this.state.chatSearchQuery;
    const filter = this.state.chatFilter;
    const archived = this.state.archivedCustomers;

    // Aplicar filtros
    customerIds = customerIds.filter(cId => {
      const cust = customerMap[cId];
      const isArchived = archived.includes(cId);

      // Filtro por búsqueda
      if (search) {
        const matchesName = cust.name.toLowerCase().includes(search);
        const matchesMsg = cust.lastMsg.toLowerCase().includes(search);
        if (!matchesName && !matchesMsg) return false;
      }

      // Filtros de pestaña
      if (filter === 'archived') return isArchived;
      if (isArchived) return false; // En las otras pestañas excluir archivados

      if (filter === 'unread') return cust.unreadCount > 0;
      if (filter === 'web') return true; // Todos los chats provienen de la PWA Web

      return true;
    });

    if (customerIds.length === 0) {
      listContainer.innerHTML = `<div class="p-6 text-xs text-slate-500 text-center space-y-2"><i class="fa-solid fa-comments text-2xl text-slate-600 block mb-1"></i>Sin conversaciones en este filtro.</div>`;
      return;
    }

    listContainer.innerHTML = customerIds.map(cId => {
      const cust = customerMap[cId];
      const order = this.getCustomerLatestOrder(cust.id, cust.name);
      const isSelected = this.state.activeChatCustomer === cId;

      return `
        <div onclick="FlunaAdmin.selectChatCustomer('${cId}')" 
             class="p-3.5 border-b border-white/5 hover:bg-slate-900/80 cursor-pointer transition relative ${isSelected ? 'bg-orange-500/10 border-l-4 border-l-orange-500' : ''}">
          <div class="flex items-center justify-between gap-1 mb-1">
            <div class="flex items-center gap-1.5 min-w-0">
              <h5 class="text-xs font-bold text-white truncate">${cust.name}</h5>
              <span class="tag-web-channel flex-shrink-0">WEB</span>
            </div>
            ${cust.unreadCount > 0 ? `<span class="unread-bubble">${cust.unreadCount}</span>` : ''}
          </div>

          <p class="text-[11px] text-slate-400 truncate mb-2">${cust.lastMsg}</p>

          <div class="flex items-center justify-between text-[10px]">
            ${order ? `
              <span class="chat-order-pill text-orange-400 font-bold flex items-center gap-1">
                <i class="fa-solid fa-receipt text-[9px]"></i> #${order.id} • ${order.status}
              </span>
            ` : `
              <span class="chat-order-pill text-slate-500">Sin pedido activo</span>
            `}
            <span class="text-slate-500 font-mono text-[9px]">${new Date(cust.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          </div>
        </div>
      `;
    }).join('');
  },

  async selectChatCustomer(customerId) {
    this.state.activeChatCustomer = customerId;

    // Marcar como leídos en BD y en estado local
    await FlunaDB.markMessagesAsRead(customerId);
    this.state.messages.forEach(m => {
      if (m.customer_id === customerId) m.read = true;
    });

    const custMsg = this.state.messages.find(m => m.customer_id === customerId);
    const custName = custMsg ? custMsg.customer_name : 'Cliente';
    const order = this.getCustomerLatestOrder(customerId, custName);

    // Mostrar cabecera y formulario
    const header = document.getElementById('activeChatHeader');
    const form = document.getElementById('adminChatForm');
    const nameEl = document.getElementById('activeChatCustomerName');
    const pillEl = document.getElementById('activeChatOrderPill');
    const btnArchiveText = document.getElementById('btnArchiveChatText');

    if (header) header.classList.remove('hidden');
    if (form) form.classList.remove('hidden');
    if (nameEl) nameEl.innerText = custName;
    if (pillEl) {
      pillEl.innerHTML = order ? `
        <span class="chat-order-pill text-orange-400 font-bold inline-flex items-center gap-1">
          <i class="fa-solid fa-receipt"></i> Pedido #${order.id} • Estado: ${order.status}
        </span>
      ` : `<span class="chat-order-pill text-slate-500">Sin pedido activo vinculado</span>`;
    }

    const isArchived = this.state.archivedCustomers.includes(customerId);
    if (btnArchiveText) btnArchiveText.innerText = isArchived ? 'Desarchivar' : 'Archivar';

    this.renderChatCenter();
    this.renderChatTimeline();
  },

  toggleArchiveActiveCustomer() {
    const cId = this.state.activeChatCustomer;
    if (!cId) return;

    const idx = this.state.archivedCustomers.indexOf(cId);
    if (idx !== -1) {
      this.state.archivedCustomers.splice(idx, 1);
    } else {
      this.state.archivedCustomers.push(cId);
    }

    localStorage.setItem('fluna_archived_chats', JSON.stringify(this.state.archivedCustomers));
    this.selectChatCustomer(cId);
  },

  async deleteActiveCustomerChat() {
    const cId = this.state.activeChatCustomer;
    if (!cId) return;

    if (confirm('¿Eliminar permanentemente todo el historial de mensajes de este cliente?')) {
      await FlunaDB.deleteCustomerMessages(cId);
      this.state.messages = this.state.messages.filter(m => m.customer_id !== cId);
      this.state.activeChatCustomer = null;

      document.getElementById('activeChatHeader')?.classList.add('hidden');
      document.getElementById('adminChatForm')?.classList.add('hidden');
      document.getElementById('adminChatTimeline').innerHTML = `<div class="text-center text-slate-500 text-xs py-24">Selecciona una conversación a la izquierda para interactuar.</div>`;

      this.renderChatCenter();
    }
  },

  renderChatTimeline() {
    const timeline = document.getElementById('adminChatTimeline');
    if (!timeline || !this.state.activeChatCustomer) return;

    const msgs = this.state.messages.filter(m => m.customer_id === this.state.activeChatCustomer);

    timeline.innerHTML = msgs.map(m => {
      const isAdmin = m.sender_role === 'admin';
      return `
        <div class="flex ${isAdmin ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[75%] px-3 py-2 rounded-xl text-xs ${
            isAdmin ? 'bg-orange-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 border border-white/10 rounded-bl-none'
          }">
            <p>${m.message}</p>
            <span class="text-[9px] opacity-70 block text-right font-mono mt-1">${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          </div>
        </div>
      `;
    }).join('');

    timeline.scrollTop = timeline.scrollHeight;
  },

  async handleSendAdminChatMessage(e) {
    e.preventDefault();
    if (!this.state.activeChatCustomer) return;

    const input = document.getElementById('adminChatInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    const msgData = {
      customer_id: this.state.activeChatCustomer,
      customer_name: 'Atención FLuna',
      sender_role: 'admin',
      message: text
    };

    await FlunaDB.sendMessage(msgData);
    this.loadAllData();
  },

  // --- MARKETING IA GENERATOR CON GEMINI API ---
  populateMarketingProducts() {
    const select = document.getElementById('mkProductSelect');
    if (!select) return;

    if (this.state.products.length === 0) {
      select.innerHTML = `<option value="">-- Sin productos en catálogo --</option>`;
      return;
    }

    select.innerHTML = this.state.products.map(p => `
      <option value="${p.id}">${p.name} ($${Number(p.price).toLocaleString('es-AR')}) - ${p.category}</option>
    `).join('');
  },

  async generateAIMarketingCopy() {
    const prodId = document.getElementById('mkProductSelect')?.value;
    const format = document.getElementById('mkFormatSelect')?.value || 'feed';
    const angle = document.getElementById('mkAngleSelect')?.value || 'visceral';
    const outputEl = document.getElementById('mkCopyOutput');
    const btnIcon = document.getElementById('mkBtnIcon');
    const btnText = document.getElementById('mkBtnText');

    const prod = this.state.products.find(p => p.id === prodId) || this.state.products[0];
    if (!prod) {
      alert('Por favor agrega un producto al menú para generar campañas.');
      return;
    }

    const isStory = format === 'story';
    const dimensions = isStory ? '1080 x 1920 px (Relación Aspecto 9:16 Vertical)' : '1080 x 1350 px (Relación Aspecto 4:5 Portrait Feed)';

    const anglesMap = {
      'visceral': 'Antojo Visceral & Gastro-Porn (Resaltar la masa madre fermentada 48h, muzzarella derretida, crujido del borde alveolado, aroma y calor del horno de piedra a 450°C).',
      'urgency': 'Urgencia & Escasez (Enfocar en stock limitado por masa artesanal diaria, pocas pizzas disponibles para esta noche, comprar antes de que se agote).',
      'social': 'Prueba Social & Noche de Amigos (Enfocar en la reunión perfecta de fin de semana, compartir momentos inolvidables con la mejor pizza artesanal).',
      'convenience': 'Conveniencia & Pedido Rápido PWA (Enfocar en pedir en 1 minuto sin instalar nada desde la PWA, pago seguro Mercado Pago y seguimiento en tiempo real).'
    };

    const prompt = `Actúa como un Copywriter y Director Creativo Estrella de Marketing Gastronómico especializado en pizzerías de masa madre y conversión de ventas en Instagram.

Tus textos deben ser 100% humanos, persuasivos, con enfoque en psicología del consumidor y dirigidos en segunda persona del singular con tono argentino Rioplatense informal y cercano ("vos", "tus pizzas", "pedí", "disfrutá").

DATOS DE LA CAMPAÑA:
- Producto/Oferta: "${prod.name}"
- Categoría: "${prod.category}"
- Precio: "$${Number(prod.price).toLocaleString('es-AR')}"
- Descripción del plato: "${prod.description || 'Elaborado artesanalmente en horno de piedra con ingredientes seleccionados.'}"
- Formato Solicitado: ${isStory ? 'Historia / Reel (Vertical 9:16)' : 'Post para Feed (Portrait 4:5)'}
- Dimensiones del Asset: ${dimensions}
- Ángulo Psicológico Principal: ${anglesMap[angle]}

ESTRUCTURA OBLIGATORIA DE LA RESPUESTA:

📐 [ESPECIFICACIONES VISUALES Y FOTOGRAFÍA]
- Formato exacto: ${dimensions}
- Paleta de Colores de Marca: Fondo negro profundo, detalles en brillo naranja neón (#E96D25) y blanco cálido.
- Sugerencia de Fotografía/Video: Describe la escena visual irresistible que debe acompañar a este post/historia.

🎯 [HOOK PERSUASIVO (3 Segundos)]
Escribe 2 opciones de ganchos irresistibles que frenen el scroll de inmediato.

🍕 [CUERPO SENSORIAL DEL COPY]
Redacta el cuerpo principal explotando los sentidos (vista, olfato, sabor) y aplicando el ángulo psicológico seleccionado. Hablá directamente al cliente en segunda persona.

🚀 [LLAMADO A LA ACCIÓN (CTA DIRECTO)]
Indica claramente cómo pedir directo en la PWA Web con Mercado Pago (ej: "👉 Pedí en 1 min en fluna.app").

🏷️ [HASHTAGS ESTRATÉGICOS GEO/SEO]
Listado de 8 a 10 hashtags optimizados para SEO y GEO en Argentina (ej: #FLunaPizzeria #PizzaMasaMadre #DeliveryArgentina).`;

    // UI Loading state
    if (btnIcon) btnIcon.className = 'fa-solid fa-spinner fa-spin';
    if (btnText) btnText.innerText = 'Generando con Gemini IA...';
    if (outputEl) outputEl.value = '🧠 Gemini IA está diseñando la estrategia de copywriting y psicología de ventas para FLuna...';

    const { data, error } = await FlunaDB.generateGeminiContent(prompt);

    // Restore UI state
    if (btnIcon) btnIcon.className = 'fa-solid fa-wand-magic-sparkles';
    if (btnText) btnText.innerText = 'Generar Campaña con Gemini IA ✨';

    if (error || !data) {
      const errMsg = error?.message || 'Error de conexión';
      alert(`Servidor Vercel / Gemini API: ${errMsg}\n\nSe desplegó la tarjeta con plantilla de respuesta y foto IA.`);
      const fallbackText = `🎯 [HOOK PERSUASIVO]\n¿Buscás la combinación perfecta para esta noche? 🍕✨\n\n🍕 [CUERPO SENSORIAL]\nProbá "${prod.name}": masa madre con 48hs de fermentación lenta, abundantes ingredientes seleccionados y el inigualable toque del horno de piedra.\n\n🚀 [LLAMADO A LA ACCIÓN]\n👉 Hacé tu pedido en 1 minuto desde nuestra PWA con Mercado Pago:\nhttps://fluna.app\n\n🏷️ [HASHTAGS]\n#FLunaPizzeria #${prod.name.replace(/ /g, '')} #MasaMadre #PizzeriaArtesanal #MercadoPago`;
      this.renderInstagramCardMockup(fallbackText, prod, format, angle);
      return;
    }

    this.renderInstagramCardMockup(data, prod, format, angle);

    // Guardar en Historial
    const historyItem = {
      id: 'mk-' + Date.now(),
      productName: prod.name,
      format: isStory ? 'Story (9:16)' : 'Feed (4:5)',
      angle: angle,
      date: new Date().toLocaleString('es-AR'),
      content: data
    };

    this.state.marketingHistory.unshift(historyItem);
    if (this.state.marketingHistory.length > 20) this.state.marketingHistory.pop();
    localStorage.setItem('fluna_mk_history', JSON.stringify(this.state.marketingHistory));

    this.renderMarketingHistory();
  },

  renderInstagramCardMockup(text, prod, format, angle) {
    const isStory = format === 'story';
    const badgeEl = document.getElementById('mkCardFormatBadge');
    if (badgeEl) {
      badgeEl.innerText = isStory ? 'Story 1080x1920 (9:16)' : 'Feed 1080x1350 (4:5)';
    }

    // AI Image URL
    const seed = Math.floor(Math.random() * 100000);
    const width = 1080;
    const height = isStory ? 1920 : 1350;
    const isEmpanada = (prod.category || '').toLowerCase().includes('empanada');
    const dishType = isEmpanada ? 'argentine gourmet empanadas' : 'sourdough artisan pizza';
    const promptText = encodeURIComponent(`delicious ${dishType} ${prod.name}, melted mozzarella, crispy crust, food photography 8k, dark aesthetic, neon orange accents, professional food post, seed ${seed}`);
    const imageUrl = `https://image.pollinations.ai/prompt/${promptText}?width=${width}&height=${height}&nologo=true`;

    const imgEl = document.getElementById('mkCardImage');
    const imgPlaceholder = document.getElementById('mkImagePlaceholder');
    const imgOverlay = document.getElementById('mkImageOverlay');

    if (imgEl) {
      imgEl.src = imageUrl;
      imgEl.onload = () => {
        imgEl.classList.remove('hidden');
        if (imgPlaceholder) imgPlaceholder.classList.add('hidden');
        if (imgOverlay) imgOverlay.classList.remove('hidden');
      };
      imgEl.onerror = () => {
        if (imgPlaceholder) imgPlaceholder.classList.remove('hidden');
      };
    }

    // Parse sections from text
    let hook = `🔥 ¡Imposible resistirse a esta ${prod.name}! 🍕✨`;
    let body = `Elaborada artesanalmente con masa madre fermentada 48 horas e ingredientes seleccionados.`;
    let cta = `👉 Pedí en 1 min en fluna.app con Mercado Pago`;
    let hashtags = `#FLunaPizzeria #${prod.name.replace(/ /g, '')} #PizzaMasaMadre #DeliveryArgentina`;

    if (text) {
      const hookMatch = text.match(/🎯\s*\[?HOOK[^\]]*\]?\s*([\s\S]*?)(?=🍕|🚀|🏷️|📐|$)/i);
      if (hookMatch && hookMatch[1].trim()) hook = hookMatch[1].trim();

      const bodyMatch = text.match(/🍕\s*\[?CUERPO[^\]]*\]?\s*([\s\S]*?)(?=🚀|🏷️|📐|$)/i);
      if (bodyMatch && bodyMatch[1].trim()) body = bodyMatch[1].trim();

      const ctaMatch = text.match(/🚀\s*\[?LLAMADO[^\]]*\]?\s*([\s\S]*?)(?=🏷️|📐|$)/i);
      if (ctaMatch && ctaMatch[1].trim()) cta = ctaMatch[1].trim();

      const hashMatch = text.match(/🏷️\s*\[?HASHTAGS[^\]]*\]?\s*([\s\S]*?)$/i);
      if (hashMatch && hashMatch[1].trim()) hashtags = hashMatch[1].trim();
    }

    const hookEl = document.getElementById('mkCardHook');
    const bodyEl = document.getElementById('mkCardBody');
    const ctaEl = document.getElementById('mkCardCTA');
    const hashEl = document.getElementById('mkCardHashtags');
    const outputEl = document.getElementById('mkCopyOutput');

    if (hookEl) hookEl.innerText = hook;
    if (bodyEl) bodyEl.innerText = body;
    if (ctaEl) ctaEl.innerText = cta;
    if (hashEl) hashEl.innerText = hashtags;

    const fullCopy = `${hook}\n\n${body}\n\n${cta}\n\n${hashtags}`;
    if (outputEl) outputEl.value = fullCopy;
  },

  regenerateAIImage() {
    const prodId = document.getElementById('mkProductSelect')?.value;
    const format = document.getElementById('mkFormatSelect')?.value || 'feed';
    const prod = this.state.products.find(p => p.id === prodId) || this.state.products[0] || { name: 'Pizza', category: 'Pizzas' };
    
    const isStory = format === 'story';
    const width = 1080;
    const height = isStory ? 1920 : 1350;
    const seed = Math.floor(Math.random() * 1000000);
    const isEmpanada = (prod.category || '').toLowerCase().includes('empanada');
    const dishType = isEmpanada ? 'argentine gourmet empanadas' : 'sourdough artisan pizza';
    const promptText = encodeURIComponent(`delicious ${dishType} ${prod.name}, melted mozzarella, crispy crust, food photography 8k, dark aesthetic, neon orange accents, professional food post, seed ${seed}`);
    const newUrl = `https://image.pollinations.ai/prompt/${promptText}?width=${width}&height=${height}&nologo=true`;

    const imgEl = document.getElementById('mkCardImage');
    if (imgEl) {
      imgEl.src = newUrl;
    }
  },

  copyMarketingOutput() {
    const output = document.getElementById('mkCopyOutput')?.value;
    if (!output) return;

    navigator.clipboard.writeText(output).then(() => {
      alert('¡Copy copiado exitosamente al portapapeles!');
    }).catch(() => {
      alert('No se pudo copiar automáticamente. Por favor selecciónalo manualmente.');
    });
  },

  renderMarketingHistory() {
    const container = document.getElementById('mkHistoryContainer');
    if (!container) return;

    if (this.state.marketingHistory.length === 0) {
      container.innerHTML = `<div class="col-span-full text-center text-xs text-slate-500 py-6 font-mono">Sin campañas generadas previamente.</div>`;
      return;
    }

    container.innerHTML = this.state.marketingHistory.map(item => `
      <div class="glass-card p-4 space-y-2 border border-white/5 hover:border-orange-500/40 transition text-xs relative group">
        <div class="flex items-center justify-between">
          <span class="font-bold text-white truncate">${item.productName}</span>
          <span class="text-[10px] font-mono text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">${item.format}</span>
        </div>
        <p class="text-[10px] text-slate-400 line-clamp-2 font-mono">${item.content.substring(0, 120)}...</p>
        <div class="flex justify-between items-center pt-2 border-t border-white/5 text-[10px] font-mono">
          <span class="text-slate-500">${item.date}</span>
          <div class="flex items-center gap-2">
            <button onclick="FlunaAdmin.loadMarketingHistoryItem('${item.id}')" class="text-orange-400 font-bold hover:underline">Ver / Cargar</button>
            <button onclick="FlunaAdmin.deleteMarketingHistoryItem('${item.id}')" class="text-slate-400 hover:text-rose-400 transition p-1" title="Eliminar tarjeta">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </div>
    `).join('');
  },

  deleteMarketingHistoryItem(id) {
    this.state.marketingHistory = this.state.marketingHistory.filter(item => item.id !== id);
    localStorage.setItem('fluna_mk_history', JSON.stringify(this.state.marketingHistory));
    this.renderMarketingHistory();
  },

  loadMarketingHistoryItem(id) {
    const item = this.state.marketingHistory.find(i => i.id === id);
    if (item) {
      const prod = this.state.products.find(p => p.name === item.productName) || { name: item.productName, category: 'Pizzas' };
      const isStory = item.format.includes('9:16');
      this.renderInstagramCardMockup(item.content, prod, isStory ? 'story' : 'feed', item.angle);
    }
  },

  clearMarketingHistory() {
    if (confirm('¿Vaciar el historial de campañas de marketing?')) {
      this.state.marketingHistory = [];
      localStorage.removeItem('fluna_mk_history');
      this.renderMarketingHistory();
    }
  },

  // --- REALTIME SUBSCRIPTION ADMIN ---
  initRealtimeSubscriptions() {
    FlunaDB.subscribeOrders(() => {
      this.loadAllData();
    });

    FlunaDB.subscribeMessages(() => {
      this.loadAllData();
    });
  },

  // --- DETALLES DE PEDIDO EN MODAL ---
  showOrderDetails(orderId) {
    const order = this.state.orders.find(o => o.id === orderId);
    if (!order) return;

    // Guardar el ID actual en el modal
    document.getElementById('adminOrderDetailModal').dataset.orderId = orderId;

    // Mostrar/ocultar el botón Cancelar según el estado
    const cancelBtn = document.getElementById('adminDetailBtnCancel');
    if (cancelBtn) {
      if (order.status === 'Cancelado') {
        cancelBtn.classList.add('hidden');
      } else {
        cancelBtn.classList.remove('hidden');
      }
    }

    document.getElementById('adminDetailOrderId').innerText = '#' + order.id;
    document.getElementById('adminDetailCustName').innerText = order.customer_name;
    document.getElementById('adminDetailCustPhone').innerText = order.customer_phone;
    document.getElementById('adminDetailCustEmail').innerText = order.customer_email || 'No registrado';
    document.getElementById('adminDetailDeliveryType').innerText = order.delivery_type === 'delivery' ? 'Envío a Domicilio' : 'Retiro en Local';
    document.getElementById('adminDetailCustAddress').innerText = order.delivery_address;
    document.getElementById('adminDetailPaymentMethod').innerText = order.payment_method;
    document.getElementById('adminDetailPaymentStatus').innerText = order.payment_status;
    document.getElementById('adminDetailPaymentId').innerText = order.mp_payment_id || 'N/A';
    document.getElementById('adminDetailStatus').innerText = order.status;
    document.getElementById('adminDetailDate').innerText = new Date(order.created_at).toLocaleString('es-AR');
    document.getElementById('adminDetailTotal').innerText = '$' + Number(order.total_amount).toLocaleString('es-AR');

    if (order.notes) {
      document.getElementById('adminDetailNotesContainer').classList.remove('hidden');
      document.getElementById('adminDetailNotes').innerText = order.notes;
    } else {
      document.getElementById('adminDetailNotesContainer').classList.add('hidden');
    }

    const tbody = document.getElementById('adminDetailItemsTableBody');
    if (tbody && order.order_items) {
      tbody.innerHTML = order.order_items.map(item => {
        let opts = [];
        if (item.selected_options) {
          if (item.selected_options.size) opts.push(`Tamaño: ${item.selected_options.size}`);
          if (item.selected_options.extra_cheese) opts.push(`+ Muzzarella Extra`);
          if (item.selected_options.notes) opts.push(`Notas: ${item.selected_options.notes}`);
        }
        return `
          <tr class="border-b border-white/5 font-mono">
            <td class="p-3 text-white font-sans font-semibold">${item.product_name}</td>
            <td class="p-3">${item.quantity}</td>
            <td class="p-3">$${Number(item.unit_price).toLocaleString('es-AR')}</td>
            <td class="p-3 text-slate-400 font-sans text-[10px] max-w-[200px] break-words">${opts.join('<br>') || 'Ninguna'}</td>
            <td class="p-3 font-bold text-white">$${Number(item.subtotal).toLocaleString('es-AR')}</td>
          </tr>
        `;
      }).join('');
    }

    const modal = document.getElementById('adminOrderDetailModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  },

  async deleteOrder(id) {
    const res = await FlunaDB.deleteOrder(id);
    if (res.error) {
      alert('Error al eliminar el pedido: ' + res.error.message);
      return;
    }
    // Remover de la lista de orders local
    this.state.orders = this.state.orders.filter(o => o.id !== id);
    this.renderKanbanBoard();
    this.renderKPIs();
  },

  async deleteCurrentOrder() {
    const orderId = document.getElementById('adminOrderDetailModal').dataset.orderId;
    if (!orderId) return;
    
    if (confirm(`¿Estás seguro de que deseas eliminar permanentemente el Pedido #${orderId}? Esta acción no se puede deshacer.`)) {
      document.getElementById('adminOrderDetailModal').classList.add('hidden');
      await this.deleteOrder(orderId);
    }
  },

  async cancelCurrentOrder() {
    const orderId = document.getElementById('adminOrderDetailModal').dataset.orderId;
    if (!orderId) return;

    if (confirm(`¿Deseas marcar el Pedido #${orderId} como Cancelado?`)) {
      document.getElementById('adminOrderDetailModal').classList.add('hidden');
      await this.moveOrderStatus(orderId, 'Cancelado');
    }
  },

  // --- CRUD INGREDIENTES (STOCK) ---
  editIngredient(id) {
    const ing = this.state.ingredients.find(i => i.id === id);
    if (!ing) return;

    document.getElementById('ingFormId').value = ing.id;
    document.getElementById('ingFormName').value = ing.name;
    document.getElementById('ingFormUnit').value = ing.unit;
    document.getElementById('ingFormStock').value = ing.current_stock;
    document.getElementById('ingFormMinAlert').value = ing.min_stock_alert;
    document.getElementById('ingFormCost').value = ing.cost_per_unit;

    document.getElementById('ingredientModalTitle').innerText = 'Editar Insumo';
    const modal = document.getElementById('ingredientModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  },

  async deleteIngredient(id) {
    if (confirm('¿Eliminar este insumo del inventario? Esto afectará las recetas que lo utilicen.')) {
      await FlunaDB.deleteIngredient(id);
      this.loadAllData();
    }
  },

  async handleSaveIngredient(e) {
    e.preventDefault();
    const id = document.getElementById('ingFormId').value;
    const ingData = {
      name: document.getElementById('ingFormName').value.trim(),
      unit: document.getElementById('ingFormUnit').value,
      current_stock: parseFloat(document.getElementById('ingFormStock').value),
      min_stock_alert: parseFloat(document.getElementById('ingFormMinAlert').value),
      cost_per_unit: parseFloat(document.getElementById('ingFormCost').value)
    };

    if (id) {
      await FlunaDB.updateIngredient(id, ingData);
    } else {
      await FlunaDB.createIngredient(ingData);
    }

    document.getElementById('ingredientModal').classList.add('hidden');
    this.loadAllData();
  },

  // --- RECETAS DINÁMICAS (EN PRODUCTOS) ---
  addRecipeRow(ingredientId = '', amount = '') {
    const container = document.getElementById('recipeIngredientsContainer');
    if (!container) return;

    const rowId = 'recipe-row-' + Date.now() + Math.round(Math.random() * 1000);
    const options = this.state.ingredients.map(ing => `
      <option value="${ing.id}" ${ing.id === ingredientId ? 'selected' : ''}>${ing.name} (${ing.unit})</option>
    `).join('');

    const html = `
      <div id="${rowId}" class="flex items-center gap-2 bg-slate-900/50 p-2 rounded-lg border border-white/5 recipe-item-row">
        <select class="flex-1 bg-slate-900 border border-white/10 rounded-xl p-2 text-[11px] text-white recipe-ing-select">
          <option value="">-- Seleccionar --</option>
          ${options}
        </select>
        <input type="number" step="0.001" value="${amount}" placeholder="Cant." required class="w-20 bg-slate-900 border border-white/10 rounded-xl p-2 text-[11px] text-white recipe-amount-input">
        <button type="button" onclick="FlunaAdmin.removeRecipeRow('${rowId}')" class="text-rose-400 hover:text-rose-300 p-2 text-xs"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  },

  removeRecipeRow(rowId) {
    document.getElementById(rowId)?.remove();
  },

  // --- SOLAPAS DE SECCIÓN FINANZAS ---
  switchFinTab(tab) {
    const isReg = tab === 'registro';
    // Clases de Botones
    document.getElementById('btnFinTabRegistro').classList.toggle('border-orange-500', isReg);
    document.getElementById('btnFinTabRegistro').classList.toggle('text-orange-400', isReg);
    document.getElementById('btnFinTabRegistro').classList.toggle('font-bold', isReg);
    document.getElementById('btnFinTabRegistro').classList.toggle('border-transparent', !isReg);
    document.getElementById('btnFinTabRegistro').classList.toggle('text-slate-400', !isReg);

    document.getElementById('btnFinTabMetricas').classList.toggle('border-orange-500', !isReg);
    document.getElementById('btnFinTabMetricas').classList.toggle('text-orange-400', !isReg);
    document.getElementById('btnFinTabMetricas').classList.toggle('font-bold', !isReg);
    document.getElementById('btnFinTabMetricas').classList.toggle('border-transparent', isReg);
    document.getElementById('btnFinTabMetricas').classList.toggle('text-slate-400', isReg);

    // Contenedores
    document.getElementById('finTabRegistro').classList.toggle('hidden', !isReg);
    document.getElementById('finTabMetricas').classList.toggle('hidden', isReg);

    if (!isReg) {
      this.calculateAndRenderFinancials();
      this.renderFinancesCharts();
    }
  },

  // --- MODELADO FINANCIERO PROFESIONAL (P&L, EBITDA, CASH FLOW Y SALUD CONTABLE) ---
  calculateAndRenderFinancials() {
    // Ingresos
    const ordersRevenue = this.state.orders
      .filter(o => (o.status === 'Aprobada' || o.status === 'Entregado' || o.payment_status === 'approved') && o.status !== 'Cancelado')
      .reduce((sum, o) => sum + Number(o.total_amount), 0);
    const manualIncome = this.state.finances
      .filter(f => f.type === 'income')
      .reduce((sum, f) => sum + Number(f.amount), 0);
    const totalRevenue = ordersRevenue + manualIncome;

    // COGS
    const manualCogs = this.state.finances
      .filter(f => f.type === 'expense' && f.category === 'inventory')
      .reduce((sum, f) => sum + Number(f.amount), 0);
    const purchasesCogs = this.state.purchases
      .reduce((sum, p) => sum + Number(p.total_cost), 0);
    const totalCogs = manualCogs + purchasesCogs;

    // Gross Profit
    const grossProfit = totalRevenue - totalCogs;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    // Gastos Operativos (Opex)
    const opex = this.state.finances
      .filter(f => f.type === 'expense' && ['services', 'salaries', 'marketing', 'other'].includes(f.category))
      .reduce((sum, f) => sum + Number(f.amount), 0);

    // EBITDA
    const ebitda = grossProfit - opex;
    const ebitdaMargin = totalRevenue > 0 ? (ebitda / totalRevenue) * 100 : 0;

    // Equipamiento (CapEx)
    const equipmentCapex = this.state.finances
      .filter(f => f.type === 'expense' && f.category === 'equipment')
      .reduce((sum, f) => sum + Number(f.amount), 0);

    // Depreciaciones (Amortización del 20% del equipamiento)
    const depreciation = equipmentCapex * 0.20;

    // Gastos Financieros (Deudas)
    const financialExpenses = this.state.finances
      .filter(f => f.type === 'expense' && f.category === 'debts')
      .reduce((sum, f) => sum + Number(f.amount), 0);

    // Impuestos
    const taxes = this.state.finances
      .filter(f => f.type === 'expense' && f.category === 'taxes')
      .reduce((sum, f) => sum + Number(f.amount), 0);

    // Utilidad Neta
    const netProfit = ebitda - depreciation - financialExpenses - taxes;
    const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    // --- Rellenar Tarjetas KPI ---
    const kpiIng = document.getElementById('finKpiIngresos');
    const kpiCogs = document.getElementById('finKpiCogs');
    const kpiImp = document.getElementById('finKpiImpuestos');
    const kpiDeu = document.getElementById('finKpiDeudas');
    const kpiMar = document.getElementById('finKpiMargenBruto');
    const kpiNet = document.getElementById('finKpiUtilidadNeta');

    if (kpiIng) kpiIng.innerText = '$' + totalRevenue.toLocaleString('es-AR', {minimumFractionDigits: 2});
    if (kpiCogs) kpiCogs.innerText = '$' + totalCogs.toLocaleString('es-AR', {minimumFractionDigits: 2});
    if (kpiImp) kpiImp.innerText = '$' + taxes.toLocaleString('es-AR', {minimumFractionDigits: 2});
    if (kpiDeu) kpiDeu.innerText = '$' + financialExpenses.toLocaleString('es-AR', {minimumFractionDigits: 2});
    if (kpiMar) kpiMar.innerText = grossMargin.toFixed(1) + '%';
    if (kpiNet) kpiNet.innerText = '$' + netProfit.toLocaleString('es-AR', {minimumFractionDigits: 2});

    // --- Rellenar Tabla P&L ---
    const updatePlRow = (valId, pctId, value) => {
      const valEl = document.getElementById(valId);
      const pctEl = document.getElementById(pctId);
      if (valEl) valEl.innerText = '$' + value.toLocaleString('es-AR', {minimumFractionDigits: 2});
      if (pctEl) {
        const pct = totalRevenue > 0 ? (value / totalRevenue) * 100 : 0;
        pctEl.innerText = pct.toFixed(1) + '%';
      }
    };

    const plIngresosEl = document.getElementById('plIngresos');
    if (plIngresosEl) plIngresosEl.innerText = '$' + totalRevenue.toLocaleString('es-AR', {minimumFractionDigits: 2});

    updatePlRow('plCogs', 'plCogsPct', totalCogs);
    updatePlRow('plUtilidadBruta', 'plUtilidadBrutaPct', grossProfit);
    updatePlRow('plGastosOpe', 'plGastosOpePct', opex);
    updatePlRow('plEbitda', 'plEbitdaPct', ebitda);
    updatePlRow('plDepreciacion', 'plDepreciacionPct', depreciation);
    updatePlRow('plGastosFin', 'plGastosFinPct', financialExpenses);
    updatePlRow('plImpuestos', 'plImpuestosPct', taxes);

    const plUtilidadNetaEl = document.getElementById('plUtilidadNeta');
    const plUtilidadNetaPctEl = document.getElementById('plUtilidadNetaPct');
    if (plUtilidadNetaEl) plUtilidadNetaEl.innerText = '$' + netProfit.toLocaleString('es-AR', {minimumFractionDigits: 2});
    if (plUtilidadNetaPctEl) plUtilidadNetaPctEl.innerText = netMargin.toFixed(1) + '%';

    // --- Rellenar Cash Flow ---
    const opInflow = totalRevenue;
    const opOutflow = totalCogs + opex + taxes;
    const opNet = opInflow - opOutflow;

    const invInflow = 0;
    const invOutflow = equipmentCapex;
    const invNet = invInflow - invOutflow;

    const finInflow = this.state.finances
      .filter(f => f.type === 'income' && f.category === 'debts')
      .reduce((sum, f) => sum + Number(f.amount), 0);
    const finOutflow = financialExpenses;
    const finNet = finInflow - finOutflow;

    const cashFlowNet = opNet + invNet + finNet;

    const cfOpIngEl = document.getElementById('cfOpIng');
    const cfOpEgEl = document.getElementById('cfOpEg');
    const cfOpNetEl = document.getElementById('cfOpNet');
    if (cfOpIngEl) cfOpIngEl.innerText = '$' + opInflow.toLocaleString('es-AR');
    if (cfOpEgEl) cfOpEgEl.innerText = '$' + opOutflow.toLocaleString('es-AR');
    if (cfOpNetEl) cfOpNetEl.innerText = '$' + opNet.toLocaleString('es-AR');

    const cfInvIngEl = document.getElementById('cfInvIng');
    const cfInvEgEl = document.getElementById('cfInvEg');
    const cfInvNetEl = document.getElementById('cfInvNet');
    if (cfInvIngEl) cfInvIngEl.innerText = '$' + invInflow.toLocaleString('es-AR');
    if (cfInvEgEl) cfInvEgEl.innerText = '$' + invOutflow.toLocaleString('es-AR');
    if (cfInvNetEl) cfInvNetEl.innerText = '$' + invNet.toLocaleString('es-AR');

    const cfFinIngEl = document.getElementById('cfFinIng');
    const cfFinEgEl = document.getElementById('cfFinEg');
    const cfFinNetEl = document.getElementById('cfFinNet');
    if (cfFinIngEl) cfFinIngEl.innerText = '$' + finInflow.toLocaleString('es-AR');
    if (cfFinEgEl) cfFinEgEl.innerText = '$' + finOutflow.toLocaleString('es-AR');
    if (cfFinNetEl) cfFinNetEl.innerText = '$' + finNet.toLocaleString('es-AR');

    const cfTotalIngEl = document.getElementById('cfTotalIng');
    const cfTotalEgEl = document.getElementById('cfTotalEg');
    if (cfTotalIngEl) cfTotalIngEl.innerText = '$' + (opInflow + invInflow + finInflow).toLocaleString('es-AR');
    if (cfTotalEgEl) cfTotalEgEl.innerText = '$' + (opOutflow + invOutflow + finOutflow).toLocaleString('es-AR');
    
    const cfTotalNetEl = document.getElementById('cfTotalNet');
    if (cfTotalNetEl) {
      cfTotalNetEl.innerText = '$' + cashFlowNet.toLocaleString('es-AR');
      cfTotalNetEl.className = `p-3 text-right font-bold ${cashFlowNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }

    // --- Diagnóstico de Salud Financiera ---
    const healthContainer = document.getElementById('financeHealthStatus');
    if (healthContainer) {
      let score = 0;
      let advices = [];

      // Evaluar Utilidad Neta
      if (netProfit > 0) {
        score += 35;
        advices.push(`<li>🟢 <strong>Rentabilidad Positiva:</strong> FLuna genera ganancias netas de $${netProfit.toLocaleString('es-AR')}. ¡Buen rendimiento!</li>`);
      } else {
        advices.push(`<li>🔴 <strong>Pérdida Neta:</strong> La operación actual arroja pérdidas netas. Revisa los costos fijos y precios.</li>`);
      }

      // Evaluar Margen Bruto
      if (grossMargin >= 60) {
        score += 35;
        advices.push(`<li>🟢 <strong>Margen Bruto Excelente (${grossMargin.toFixed(1)}%):</strong> El costo de ingredientes está sumamente optimizado respecto al precio de venta.</li>`);
      } else if (grossMargin >= 40) {
        score += 20;
        advices.push(`<li>🟡 <strong>Margen Bruto Aceptable (${grossMargin.toFixed(1)}%):</strong> Monitorea los precios de los ingredientes para subir el rendimiento.</li>`);
      } else {
        advices.push(`<li>🔴 <strong>Margen Bruto Crítico (${grossMargin.toFixed(1)}%):</strong> El costo de mercadería es demasiado alto. Considera subir precios o renegociar con proveedores.</li>`);
      }

      // Evaluar Cash Flow
      if (cashFlowNet > 0) {
        score += 30;
        advices.push(`<li>🟢 <strong>Flujo de Caja Saludable:</strong> Entra más efectivo del que sale. FLuna cuenta con liquidez para cubrir emergencias.</li>`);
      } else {
        advices.push(`<li>🔴 <strong>Déficit de Efectivo:</strong> Flujo neto negativo ($${cashFlowNet.toLocaleString('es-AR')}). Cuidado con la liquidez a corto plazo.</li>`);
      }

      let ratingClass = 'text-rose-400';
      let ratingText = 'Crítico';
      if (score >= 80) {
        ratingClass = 'text-emerald-400';
        ratingText = 'Excelente / Saludable';
      } else if (score >= 50) {
        ratingClass = 'text-yellow-400';
        ratingText = 'Estable / Monitorear';
      }

      healthContainer.innerHTML = `
        <div class="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-1">
          <div class="text-[10px] text-slate-400 font-mono">ÍNDICE DE SALUD</div>
          <div class="text-lg font-black ${ratingClass} font-mono">${score}% (${ratingText})</div>
        </div>
        <ul class="space-y-2 list-none p-0 text-[11px] leading-relaxed">
          ${advices.join('')}
        </ul>
      `;
    }
  },

  // --- RENDERIZADO DE GRÁFICOS CONTABLES ---
  renderFinancesCharts() {
    if (typeof Chart === 'undefined') return;

    // 1. Chart Evolución: Barras comparativas de ingresos vs egresos de los últimos 7 días
    const ctxEvolucion = document.getElementById('chartFinEvolucion');
    if (ctxEvolucion) {
      if (this.state.charts.finEvolucion) this.state.charts.finEvolucion.destroy();

      const last7Days = Array.from({length: 7}, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d.toISOString().split('T')[0];
      });

      const incomeData = last7Days.map(dateStr => {
        const manualInc = this.state.finances
          .filter(f => f.date === dateStr && f.type === 'income')
          .reduce((sum, f) => sum + Number(f.amount), 0);
        const ordersInc = this.state.orders
          .filter(o => o.created_at.startsWith(dateStr) && (o.status === 'Aprobada' || o.status === 'Entregado'))
          .reduce((sum, o) => sum + Number(o.total_amount), 0);
        return manualInc + ordersInc;
      });

      const expenseData = last7Days.map(dateStr => {
        const manualExp = this.state.finances
          .filter(f => f.date === dateStr && f.type === 'expense')
          .reduce((sum, f) => sum + Number(f.amount), 0);
        const purchasesExp = this.state.purchases
          .filter(p => p.created_at.startsWith(dateStr))
          .reduce((sum, p) => sum + Number(p.total_cost), 0);
        return manualExp + purchasesExp;
      });

      this.state.charts.finEvolucion = new Chart(ctxEvolucion, {
        type: 'bar',
        data: {
          labels: last7Days.map(d => d.slice(5)),
          datasets: [
            {
              label: 'Ingresos ($)',
              data: incomeData,
              backgroundColor: '#22c55e',
              borderRadius: 4
            },
            {
              label: 'Egresos ($)',
              data: expenseData,
              backgroundColor: '#ef4444',
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
          }
        }
      });
    }

    // 2. Chart Distribución: Doughnut de gastos distribuidos por categoría
    const ctxGastos = document.getElementById('chartFinGastos');
    if (ctxGastos) {
      if (this.state.charts.finGastos) this.state.charts.finGastos.destroy();

      const categories = {
        'Insumos': this.state.finances.filter(f => f.type === 'expense' && f.category === 'inventory').reduce((sum, f) => sum + Number(f.amount), 0) + 
                   this.state.purchases.reduce((sum, p) => sum + Number(p.total_cost), 0),
        'Servicios': this.state.finances.filter(f => f.type === 'expense' && f.category === 'services').reduce((sum, f) => sum + Number(f.amount), 0),
        'Sueldos': this.state.finances.filter(f => f.type === 'expense' && f.category === 'salaries').reduce((sum, f) => sum + Number(f.amount), 0),
        'Marketing': this.state.finances.filter(f => f.type === 'expense' && f.category === 'marketing').reduce((sum, f) => sum + Number(f.amount), 0),
        'Equipamiento': this.state.finances.filter(f => f.type === 'expense' && f.category === 'equipment').reduce((sum, f) => sum + Number(f.amount), 0),
        'Impuestos': this.state.finances.filter(f => f.type === 'expense' && f.category === 'taxes').reduce((sum, f) => sum + Number(f.amount), 0),
        'Deudas': this.state.finances.filter(f => f.type === 'expense' && f.category === 'debts').reduce((sum, f) => sum + Number(f.amount), 0),
        'Otros': this.state.finances.filter(f => f.type === 'expense' && f.category === 'other').reduce((sum, f) => sum + Number(f.amount), 0)
      };

      const labels = Object.keys(categories).filter(cat => categories[cat] > 0);
      const data = labels.map(cat => categories[cat]);

      this.state.charts.finGastos = new Chart(ctxGastos, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: data,
            backgroundColor: [
              '#e11d48',
              '#3b82f6',
              '#f59e0b',
              '#8b5cf6',
              '#ec4899',
              '#f43f5e',
              '#64748b',
              '#14b8a6'
            ],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: '#94a3b8', font: { size: 10 } }
            }
          }
        }
      });
    }
  },

  // --- GESTIÓN DE PEDIDOS MANUALES (PIPELINE) ---
  openManualOrderModal() {
    this.state.manualOrderItems = {};
    const form = document.getElementById('manualOrderForm');
    if (form) form.reset();

    const addressContainer = document.getElementById('manualAddressContainer');
    if (addressContainer) addressContainer.classList.add('hidden');

    this.renderManualOrderProducts();
    this.updateManualOrderTotal();

    const modal = document.getElementById('manualOrderModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  },

  toggleManualAddressField() {
    const deliveryType = document.getElementById('manualOrderDeliveryType')?.value;
    const addressContainer = document.getElementById('manualAddressContainer');
    const addressInput = document.getElementById('manualOrderAddress');

    if (deliveryType === 'delivery') {
      addressContainer?.classList.remove('hidden');
      if (addressInput) addressInput.required = true;
    } else {
      addressContainer?.classList.add('hidden');
      if (addressInput) {
        addressInput.required = false;
        addressInput.value = '';
      }
    }
  },

  renderManualOrderProducts() {
    const container = document.getElementById('manualOrderProductsList');
    if (!container) return;

    if (!this.state.products || this.state.products.length === 0) {
      container.innerHTML = `<p class="text-slate-400 italic text-center py-2">No hay productos activos en el menú.</p>`;
      return;
    }

    const activeProds = this.state.products.filter(p => p.is_active);

    container.innerHTML = activeProds.map(prod => {
      const qty = this.state.manualOrderItems[prod.id] || 0;
      return `
        <div class="flex items-center justify-between p-2 rounded-lg bg-slate-900/80 border border-white/5">
          <div class="flex items-center gap-2">
            <img src="${prod.image_url || 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600'}" class="w-8 h-8 object-cover rounded">
            <div>
              <span class="font-bold text-white block truncate max-w-[200px]">${prod.name}</span>
              <span class="text-[10px] font-mono text-orange-400">$${Number(prod.price).toLocaleString('es-AR')}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" onclick="FlunaAdmin.updateManualOrderQty('${prod.id}', -1)" class="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center">-</button>
            <span id="manualQty_${prod.id}" class="font-mono font-bold text-white w-5 text-center">${qty}</span>
            <button type="button" onclick="FlunaAdmin.updateManualOrderQty('${prod.id}', 1)" class="w-6 h-6 rounded bg-orange-500 hover:bg-orange-600 text-white font-bold flex items-center justify-center">+</button>
          </div>
        </div>
      `;
    }).join('');
  },

  updateManualOrderQty(productId, delta) {
    const current = this.state.manualOrderItems[productId] || 0;
    const next = Math.max(0, current + delta);
    this.state.manualOrderItems[productId] = next;

    const qtyEl = document.getElementById(\`manualQty_\${productId}\`);
    if (qtyEl) qtyEl.innerText = next;

    this.updateManualOrderTotal();
  },

  updateManualOrderTotal() {
    let total = 0;
    Object.keys(this.state.manualOrderItems).forEach(prodId => {
      const qty = this.state.manualOrderItems[prodId];
      if (qty > 0) {
        const prod = this.state.products.find(p => p.id === prodId);
        if (prod) total += Number(prod.price) * qty;
      }
    });

    const display = document.getElementById('manualOrderTotalDisplay');
    if (display) display.innerText = \`$\${total.toLocaleString('es-AR')}\`;
    return total;
  },

  async handleSaveManualOrder(e) {
    e.preventDefault();

    const customerName = document.getElementById('manualOrderCustomer').value.trim();
    const phone = document.getElementById('manualOrderPhone').value.trim();
    const deliveryType = document.getElementById('manualOrderDeliveryType').value;
    const paymentMethod = document.getElementById('manualOrderPaymentMethod').value;
    const paymentStatus = document.getElementById('manualOrderPaymentStatus').value;
    const orderStatus = document.getElementById('manualOrderStatus').value;
    const notes = document.getElementById('manualOrderNotes').value.trim();
    const address = deliveryType === 'delivery' ? document.getElementById('manualOrderAddress').value.trim() : 'Retiro en Local';

    const selectedItems = [];
    Object.keys(this.state.manualOrderItems).forEach(prodId => {
      const qty = this.state.manualOrderItems[prodId];
      if (qty > 0) {
        const prod = this.state.products.find(p => p.id === prodId);
        if (prod) {
          selectedItems.push({
            product_id: prod.id,
            name: prod.name,
            price: Number(prod.price),
            quantity: qty
          });
        }
      }
    });

    if (selectedItems.length === 0) {
      alert('Por favor selecciona al menos 1 producto para crear el pedido.');
      return;
    }

    const totalAmount = this.updateManualOrderTotal();
    const newOrderId = 'FL-' + Math.floor(1000 + Math.random() * 9000);

    const orderData = {
      id: newOrderId,
      customer_id: 'MANUAL_ADMIN',
      customer_name: customerName,
      customer_phone: phone,
      customer_email: 'manual@fluna.local',
      delivery_address: address,
      delivery_type: deliveryType,
      total_amount: totalAmount,
      status: orderStatus,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      notes: notes ? `[PEDIDO MANUAL] ${notes}` : '[PEDIDO MANUAL POR MOSTRADOR/TELÉFONO]'
    };

    const res = await FlunaDB.createOrder(orderData, selectedItems);
    if (res.error) {
      alert('Error al registrar el pedido manual: ' + res.error.message);
      return;
    }

    if (paymentStatus === 'approved') {
      await FlunaDB.addFinanceRecord({
        type: 'income',
        category: 'sales',
        amount: totalAmount,
        description: `Venta Manual #${newOrderId} - ${customerName}`,
        date: new Date().toISOString().split('T')[0]
      });
    }

    document.getElementById('manualOrderModal')?.classList.add('hidden');
    document.getElementById('manualOrderModal')?.classList.remove('flex');

    alert(`¡Pedido manual #${newOrderId} creado exitosamente en la etapa "${orderStatus}"!`);
    await this.loadAllData();
  }
};

window.FlunaAdmin = FlunaAdmin;
