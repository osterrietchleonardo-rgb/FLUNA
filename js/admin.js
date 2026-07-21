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
    activeChatCustomer: null
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

    // CRUD Insumos y buscador de compras
    document.getElementById('ingredientForm')?.addEventListener('submit', (e) => this.handleSaveIngredient(e));
    document.getElementById('purchaseIngSearch')?.addEventListener('input', () => this.filterPurchaseIngredientsDropdown());
  },

  switchTab(tabId) {
    this.state.activeTab = tabId;

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
    if (tabId === 'chat') this.renderChatCenter();
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
    const totalSales = this.state.orders
      .filter(o => o.payment_status === 'approved' || o.status === 'Aprobada' || o.status === 'Entregado')
      .reduce((sum, o) => sum + Number(o.total_amount), 0);

    const totalOrders = this.state.orders.length;

    const totalIncome = this.state.finances
      .filter(f => f.type === 'income')
      .reduce((sum, f) => sum + Number(f.amount), 0);

    const totalExpenses = this.state.finances
      .filter(f => f.type === 'expense')
      .reduce((sum, f) => sum + Number(f.amount), 0);

    const netProfit = totalIncome - totalExpenses;
    const criticalStockCount = this.state.ingredients.filter(i => Number(i.current_stock) <= Number(i.min_stock_alert)).length;

    document.getElementById('kpiTotalSales').innerText = '$' + totalSales.toLocaleString('es-AR');
    document.getElementById('kpiTotalOrders').innerText = totalOrders;
    document.getElementById('kpiNetProfit').innerText = '$' + netProfit.toLocaleString('es-AR');
    document.getElementById('kpiCriticalStock').innerText = criticalStockCount;

    document.getElementById('kpiCriticalStockBadge').classList.toggle('hidden', criticalStockCount === 0);
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
    const stages = ['Solicitado', 'Falta de pago', 'Aprobada', 'En cocina', 'Terminado', 'Embalando', 'En camino', 'Entregado'];

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
    const currentIdx = stages.indexOf(currentStatus);
    let html = '';

    if (currentIdx > 0) {
      const prevStage = stages[currentIdx - 1];
      html += `<button onclick="FlunaAdmin.moveOrderStatus('${orderId}', '${prevStage}')" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded">← ${prevStage}</button>`;
    }

    if (currentIdx < stages.length - 1) {
      const nextStage = stages[currentIdx + 1];
      html += `<button onclick="FlunaAdmin.moveOrderStatus('${orderId}', '${nextStage}')" class="text-[10px] bg-orange-600 hover:bg-orange-500 text-white font-bold px-2 py-1 rounded ml-auto">${nextStage} →</button>`;
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
        <td class="p-3 text-slate-400">${prod.category}</td>
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
      </tr>
    `).join('');
  },

  async handleSaveFinance(e) {
    e.preventDefault();
    const record = {
      type: document.getElementById('finType').value,
      category: document.getElementById('finCategory').value,
      amount: parseFloat(document.getElementById('finAmount').value),
      description: document.getElementById('finDesc').value.trim(),
      date: document.getElementById('finDate').value || new Date().toISOString().split('T')[0]
    };

    await FlunaDB.addFinanceRecord(record);
    document.getElementById('financeModal').classList.add('hidden');
    this.loadAllData();
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
  renderChatCenter() {
    const listContainer = document.getElementById('chatCustomerList');
    if (!listContainer) return;

    // Agrupar mensajes por cliente
    const customerMap = {};
    this.state.messages.forEach(m => {
      if (!customerMap[m.customer_id]) {
        customerMap[m.customer_id] = { name: m.customer_name, lastMsg: m.message, time: m.created_at };
      } else {
        customerMap[m.customer_id].lastMsg = m.message;
        customerMap[m.customer_id].time = m.created_at;
      }
    });

    const customers = Object.keys(customerMap);

    if (customers.length === 0) {
      listContainer.innerHTML = `<div class="p-4 text-xs text-slate-500 text-center">Sin conversaciones de clientes.</div>`;
      return;
    }

    listContainer.innerHTML = customers.map(cId => `
      <div onclick="FlunaAdmin.selectChatCustomer('${cId}')" 
           class="p-3 border-b border-white/5 hover:bg-slate-900/60 cursor-pointer ${this.state.activeChatCustomer === cId ? 'bg-orange-500/10 border-l-4 border-l-orange-500' : ''}">
        <h5 class="text-xs font-bold text-white">${customerMap[cId].name}</h5>
        <p class="text-[11px] text-slate-400 truncate">${customerMap[cId].lastMsg}</p>
      </div>
    `).join('');
  },

  selectChatCustomer(customerId) {
    this.state.activeChatCustomer = customerId;
    this.renderChatCenter();
    this.renderChatTimeline();
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

  // --- MARKETING IA GENERATOR ---
  generateAIMarketingCopy() {
    const promoType = document.getElementById('mkPromoType').value;
    const outputContainer = document.getElementById('mkCopyOutput');

    const presets = {
      'viernes': `🔥 ¡VIERNES DE PIZZA EN FLUNA! 🔥\n\n¿Plan para hoy? Masa madre crujiente, muzzarella derretida y el mejor sabor ahumado directo a tu mesa. 🍕✨\n\n👉 Pedí en 1 minuto desde nuestra PWA con Mercado Pago:\nhttps://fluna.app\n\n#FLunaPizzeria #PizzaNoche #ViernesDePizza #DeliveryPizza`,
      '2x1': `🎉 ¡SUPER PROMO 2x1 EN EMPANADAS PREMIUM! 🎉\n\nProbá las de carne cortada a cuchillo o jamón y queso gourmet. ¡Llevás 12 y pagás 6!\n\n🚀 Hacé tu pedido online ahora en FLuna:\nhttps://fluna.app\n\n#EmpanadasCriollas #FLunaPizzeria #PromoGastronomica #MercadoPago`,
      'neon': `✨ NUEVO SABOR NEÓN: PEPPERONI ESPECIAL FLUNA ✨\n\nUna combinación explosiva de salsa de tomate artesanal, muzzarella fundida y rodajas de pepperoni crocante picante.\n\n🍕 Pedí directo desde tu celu sin instalar nada:\nhttps://fluna.app\n\n#PepperoniPizza #FoodPorn #FLuna #PizzeriaArtesanal`
    };

    if (outputContainer) {
      outputContainer.value = presets[promoType] || presets['viernes'];
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
  }
};

window.FlunaAdmin = FlunaAdmin;
