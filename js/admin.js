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
        <div class="glass-card p-4 space-y-3 cursor-grab hover:border-orange-500/50 transition">
          <div class="flex items-center justify-between">
            <span class="text-xs font-mono font-bold text-orange-400">#${order.id}</span>
            <span class="text-[10px] text-slate-400 font-mono">${new Date(order.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          </div>

          <div>
            <h5 class="text-sm font-bold text-white">${order.customer_name}</h5>
            <p class="text-xs text-slate-400 truncate"><i class="fa-solid fa-location-dot text-orange-500"></i> ${order.delivery_address}</p>
          </div>

          <div class="bg-slate-900/90 p-2 rounded-lg text-[11px] font-mono text-slate-300 flex justify-between items-center">
            <span>${order.payment_method.toUpperCase()}</span>
            <span class="font-bold text-white">$${Number(order.total_amount).toLocaleString('es-AR')}</span>
          </div>

          <!-- Mover Estado Quick Action -->
          <div class="pt-2 border-t border-white/5 flex gap-1 justify-between">
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

    tbody.innerHTML = this.state.products.map(prod => `
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
    const productData = {
      name: document.getElementById('prodFormName').value.trim(),
      category: document.getElementById('prodFormCategory').value,
      price: parseFloat(document.getElementById('prodFormPrice').value),
      available_stock: parseInt(document.getElementById('prodFormStock').value),
      image_url: document.getElementById('prodFormImg').value.trim(),
      description: document.getElementById('prodFormDesc').value.trim(),
      is_active: document.getElementById('prodFormActive').checked
    };

    if (id) {
      await FlunaDB.updateProduct(id, productData);
    } else {
      await FlunaDB.createProduct(productData);
    }

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

  editProduct(id) {
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
    const stockContainer = document.getElementById('stockGrid');
    if (!stockContainer) return;

    stockContainer.innerHTML = this.state.ingredients.map(ing => {
      const current = Number(ing.current_stock);
      const min = Number(ing.min_stock_alert);
      const isAlert = current <= min;
      const pct = Math.min(100, Math.round((current / (min * 3)) * 100));

      return `
        <div class="glass-card p-5 space-y-4 ${isAlert ? 'border-rose-500/50 shadow-lg shadow-rose-500/10' : ''}">
          <div class="flex justify-between items-start">
            <div>
              <h4 class="text-base font-bold text-white">${ing.name}</h4>
              <span class="text-xs text-slate-400 font-mono">Costo u: $${Number(ing.cost_per_unit).toLocaleString('es-AR')} / ${ing.unit}</span>
            </div>
            ${isAlert ? '<span class="bg-rose-500/20 text-rose-400 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase animate-pulse">¡Stock Mínimo!</span>' : ''}
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-xs font-mono">
              <span class="text-slate-400">Stock Actual</span>
              <span class="font-bold text-white">${current} ${ing.unit}</span>
            </div>
            <div class="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
              <div class="h-full ${isAlert ? 'bg-rose-500' : 'bg-orange-500'}" style="width: ${pct}%"></div>
            </div>
            <div class="text-[10px] text-slate-500 font-mono text-right">Alerta en: ${min} ${ing.unit}</div>
          </div>
        </div>
      `;
    }).join('');

    // Rellenar select de compras
    const purchaseIngSelect = document.getElementById('purchaseIngSelect');
    if (purchaseIngSelect) {
      purchaseIngSelect.innerHTML = this.state.ingredients.map(i => `<option value="${i.id}">${i.name} (${i.unit})</option>`).join('');
    }
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
  }
};

window.FlunaAdmin = FlunaAdmin;
