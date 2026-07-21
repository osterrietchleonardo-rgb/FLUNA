/* ============================================================
   FLUNA PIZZERÍA - CLIENT SIDE PWA ENGINE (APP.JS)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  FlunaApp.init();
});

const FlunaApp = {
  // Estado local de la aplicación cliente
  state: {
    products: [],
    categories: ['Todas', 'Pizzas', 'Empanadas', 'Bebidas', 'Postres', 'Combos'],
    selectedCategory: 'Todas',
    cart: [],
    selectedProductForModal: null,
    customer: {
      id: '',
      name: '',
      phone: '',
      address: '',
      email: ''
    },
    activeOrder: null,
    customerOrders: [],
    messages: [],
    authMode: 'login' // 'login' | 'register'
  },

  init() {
    // Cargar carrito persistido de la sesión anterior
    const savedCart = localStorage.getItem('fluna_cart');
    if (savedCart) {
      try {
        this.state.cart = JSON.parse(savedCart);
      } catch (e) {
        this.state.cart = [];
      }
    }

    // Inicializar pasarela de pagos
    if (window.FlunaPayments) FlunaPayments.init();

    // Cargar productos desde Supabase
    this.loadProducts();

    // Inicializar listeners de UI
    this.bindEvents();

    // Inicializar autenticación y sesión
    this.initAuth();

    // Iniciar suscripciones en tiempo real
    this.initRealtimeSubscriptions();

    // Inicializar PWA service worker y prompt
    this.initPWA();
  },

  bindEvents() {
    // Categorías
    document.querySelectorAll('.cat-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.cat-btn').forEach(b => {
          b.classList.remove('bg-orange-500', 'text-white', 'shadow-lg');
          b.classList.add('bg-slate-900/60', 'text-slate-300');
        });
        e.currentTarget.classList.remove('bg-slate-900/60', 'text-slate-300');
        e.currentTarget.classList.add('bg-orange-500', 'text-white', 'shadow-lg');

        this.state.selectedCategory = e.currentTarget.dataset.category;
        this.renderCatalog();
      });
    });

    // Carrito Drawer Toggle
    const cartBtn = document.getElementById('cartBtn');
    const cartDrawer = document.getElementById('cartDrawer');
    const closeCartBtn = document.getElementById('closeCartBtn');

    if (cartBtn && cartDrawer) {
      cartBtn.addEventListener('click', () => cartDrawer.classList.remove('translate-x-full'));
    }
    if (closeCartBtn && cartDrawer) {
      closeCartBtn.addEventListener('click', () => cartDrawer.classList.add('translate-x-full'));
    }

    // Modal de producto (Agregar con personalización)
    const closeProductModal = document.getElementById('closeProductModal');
    if (closeProductModal) {
      closeProductModal.addEventListener('click', () => {
        document.getElementById('productModal').classList.add('hidden');
      });
    }

    const btnAddToCartFromModal = document.getElementById('btnAddToCartFromModal');
    if (btnAddToCartFromModal) {
      btnAddToCartFromModal.addEventListener('click', () => this.addCurrentModalItemToCart());
    }

    // Formulario de Checkout
    const btnCheckout = document.getElementById('btnCheckout');
    const checkoutModal = document.getElementById('checkoutModal');
    const closeCheckoutModal = document.getElementById('closeCheckoutModal');

    if (btnCheckout && checkoutModal) {
      btnCheckout.addEventListener('click', () => {
        if (this.state.cart.length === 0) {
          alert('Tu carrito está vacío. Agrega una deliciosa pizza para continuar.');
          return;
        }
        cartDrawer.classList.add('translate-x-full');

        // --- CONTROL DE LOGIN OBLIGATORIO ---
        if (!this.state.customer.id) {
          // Guardar estado del carrito pendiente
          localStorage.setItem('fluna_pending_cart', JSON.stringify(this.state.cart));
          localStorage.setItem('fluna_pending_checkout', 'true');

          // Mostrar mensaje de aviso
          const authNotice = document.getElementById('authNotice');
          if (authNotice) {
            authNotice.innerText = '¡Casi listo! Registrate o iniciá sesión para completar tu pedido de FLuna 🍕';
            authNotice.classList.remove('hidden');
          }

          // Abrir modal de Login
          this.toggleAuthMode('login');
          document.getElementById('authModal').classList.remove('hidden');
          document.getElementById('authModal').classList.add('flex');
          return;
        }

        checkoutModal.classList.remove('hidden');
        checkoutModal.classList.add('flex');
        this.fillCheckoutFormFields();
      });
    }

    if (closeCheckoutModal && checkoutModal) {
      closeCheckoutModal.addEventListener('click', () => {
        checkoutModal.classList.add('hidden');
        checkoutModal.classList.remove('flex');
      });
    }

    // Submit Pedido
    const checkoutForm = document.getElementById('checkoutForm');
    if (checkoutForm) {
      checkoutForm.addEventListener('submit', (e) => this.handleOrderSubmit(e));
    }

    // Botón Rastrear / Mi Cuenta
    const accountBtn = document.getElementById('accountBtn');
    const trackerModal = document.getElementById('trackerModal');
    const closeTrackerModal = document.getElementById('closeTrackerModal');

    if (accountBtn && trackerModal) {
      accountBtn.addEventListener('click', () => {
        trackerModal.classList.remove('hidden');
        trackerModal.classList.add('flex');
        this.loadCustomerOrders();
      });
    }

    if (closeTrackerModal && trackerModal) {
      closeTrackerModal.addEventListener('click', () => {
        trackerModal.classList.add('hidden');
        trackerModal.classList.remove('flex');
      });
    }

    // Chat Flotante Soporte
    const chatToggleBtn = document.getElementById('chatToggleBtn');
    const chatWidget = document.getElementById('chatWidget');
    const closeChatWidget = document.getElementById('closeChatWidget');
    const chatSendForm = document.getElementById('chatSendForm');

    if (chatToggleBtn && chatWidget) {
      chatToggleBtn.addEventListener('click', () => {
        chatWidget.classList.toggle('hidden');
        this.loadChatMessages();
      });
    }

    if (closeChatWidget && chatWidget) {
      closeChatWidget.addEventListener('click', () => chatWidget.classList.add('hidden'));
    }

    if (chatSendForm) {
      chatSendForm.addEventListener('submit', (e) => this.handleSendChatMessage(e));
    }

    // --- LISTENERS DE AUTENTICACIÓN Y PERFIL ---
    const authBtn = document.getElementById('authBtn');
    if (authBtn) {
      authBtn.addEventListener('click', () => {
        if (this.state.customer.id) {
          // Si está logueado, abrir perfil
          document.getElementById('profileModal').classList.remove('hidden');
          document.getElementById('profileModal').classList.add('flex');
          this.switchProfileTab('profile');
          this.fillProfileFormFields();
        } else {
          // Si no, abrir login/registro
          this.toggleAuthMode('login');
          document.getElementById('authModal').classList.remove('hidden');
          document.getElementById('authModal').classList.add('flex');
        }
      });
    }

    document.getElementById('closeAuthModal')?.addEventListener('click', () => {
      document.getElementById('authModal').classList.add('hidden');
    });

    document.getElementById('closeProfileModal')?.addEventListener('click', () => {
      document.getElementById('profileModal').classList.add('hidden');
    });

    document.getElementById('authToggleBtn')?.addEventListener('click', () => {
      this.toggleAuthMode(this.state.authMode === 'login' ? 'register' : 'login');
    });

    document.getElementById('authForm')?.addEventListener('submit', (e) => this.handleAuthSubmit(e));
    document.getElementById('profileForm')?.addEventListener('submit', (e) => this.handleProfileUpdate(e));
    document.getElementById('btnLogout')?.addEventListener('click', () => this.handleLogout());

    document.getElementById('tabProfileBtn')?.addEventListener('click', () => this.switchProfileTab('profile'));
    document.getElementById('tabOrdersBtn')?.addEventListener('click', () => this.switchProfileTab('orders'));
  },

  async loadProducts() {
    const catalogContainer = document.getElementById('catalogGrid');
    if (!catalogContainer) return;

    catalogContainer.innerHTML = `
      <div class="col-span-full text-center py-16 text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-3xl text-orange-500 mb-3"></i>
        <p>Cargando menú de FLuna...</p>
      </div>
    `;

    const { data, error } = await FlunaDB.getProducts();

    if (error || !data) {
      catalogContainer.innerHTML = `
        <div class="col-span-full text-center py-16 text-rose-400">
          <i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i>
          <p>No se pudo conectar con Supabase. Verifica tus credenciales .env</p>
        </div>
      `;
      return;
    }

    this.state.products = data;
    this.renderCatalog();
  },

  renderCatalog() {
    const catalogContainer = document.getElementById('catalogGrid');
    if (!catalogContainer) return;

    const filtered = this.state.selectedCategory === 'Todas'
      ? this.state.products.filter(p => p.is_active)
      : this.state.products.filter(p => p.is_active && p.category === this.state.selectedCategory);

    if (filtered.length === 0) {
      catalogContainer.innerHTML = `
        <div class="col-span-full text-center py-12 text-slate-400">
          <i class="fa-solid fa-pizza-slice text-4xl mb-3 text-slate-600"></i>
          <p class="text-base font-semibold">No hay productos disponibles en esta categoría.</p>
        </div>
      `;
      return;
    }

    catalogContainer.innerHTML = filtered.map(product => `
      <div class="glass-card overflow-hidden flex flex-col justify-between group">
        <div class="relative overflow-hidden h-48 bg-slate-900">
          <img src="${product.image_url || 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600'}" 
               alt="${product.name}" 
               class="w-full h-full object-cover group-hover:scale-105 transition duration-500">
          <div class="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1 rounded-full text-xs font-mono font-bold text-orange-400 border border-orange-500/30">
            ${product.category}
          </div>
          ${product.available_stock <= 5 ? `
            <div class="absolute top-3 right-3 bg-rose-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
              ¡Últimas ${product.available_stock} unidades!
            </div>
          ` : ''}
        </div>

        <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
          <div>
            <h3 class="text-lg font-bold text-white group-hover:text-orange-400 transition">${product.name}</h3>
            <p class="text-xs text-slate-400 line-clamp-2 mt-1">${product.description || ''}</p>
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-white/5">
            <div>
              <span class="text-xs text-slate-500 font-mono block">Precio</span>
              <span class="text-xl font-extrabold font-mono text-white">$${Number(product.price).toLocaleString('es-AR')}</span>
            </div>

            <button onclick="FlunaApp.openProductModal('${product.id}')" 
                    class="btn-fluna py-2 px-4 text-xs font-bold flex items-center gap-2">
              <i class="fa-solid fa-plus"></i> Armar a mi gusto 🍕
            </button>
          </div>
        </div>
      </div>
    `).join('');
  },

  openProductModal(productId) {
    const product = this.state.products.find(p => p.id === productId);
    if (!product) return;

    this.state.selectedProductForModal = product;

    const modal = document.getElementById('productModal');
    document.getElementById('modalProdTitle').innerText = product.name;
    document.getElementById('modalProdDesc').innerText = product.description || '';
    document.getElementById('modalProdPrice').innerText = '$' + Number(product.price).toLocaleString('es-AR');
    document.getElementById('modalProdImg').src = product.image_url || 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  },

  addCurrentModalItemToCart() {
    const product = this.state.selectedProductForModal;
    if (!product) return;

    const sizeOpt = document.querySelector('input[name="prodSize"]:checked')?.value || 'Mediana';
    const extraCheese = document.getElementById('optExtraCheese')?.checked || false;
    const specialNotes = document.getElementById('modalSpecialNotes')?.value || '';

    let extraPrice = 0;
    if (sizeOpt === 'Familiar (8 Porciones)') extraPrice += 2500;
    if (extraCheese) extraPrice += 1200;

    const finalUnitPrice = Number(product.price) + extraPrice;

    const cartItem = {
      cart_id: 'ITEM-' + Date.now() + Math.random(),
      product_id: product.id,
      name: `${product.name} (${sizeOpt})`,
      price: finalUnitPrice,
      quantity: 1,
      options: {
        size: sizeOpt,
        extra_cheese: extraCheese,
        notes: specialNotes
      }
    };

    this.state.cart.push(cartItem);
    this.updateCartUI();

    document.getElementById('productModal').classList.add('hidden');
    document.getElementById('cartDrawer').classList.remove('translate-x-full');
  },

  updateCartUI() {
    // Guardar en almacenamiento local
    localStorage.setItem('fluna_cart', JSON.stringify(this.state.cart));

    const cartBadge = document.getElementById('cartBadge');
    const cartItemsContainer = document.getElementById('cartItems');
    const cartTotalEl = document.getElementById('cartTotal');

    const totalItems = this.state.cart.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = this.state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (cartBadge) {
      cartBadge.innerText = totalItems;
      cartBadge.classList.toggle('hidden', totalItems === 0);
    }

    if (cartTotalEl) {
      cartTotalEl.innerText = '$' + totalPrice.toLocaleString('es-AR');
    }

    if (!cartItemsContainer) return;

    if (this.state.cart.length === 0) {
      cartItemsContainer.innerHTML = `
        <div class="text-center py-16 text-slate-500">
          <i class="fa-solid fa-basket-shopping text-4xl mb-3"></i>
          <p class="text-sm">Tu carrito está vacío.</p>
        </div>
      `;
      return;
    }

    cartItemsContainer.innerHTML = this.state.cart.map((item, idx) => `
      <div class="glass-card p-4 flex items-center justify-between gap-3">
        <div class="flex-1">
          <h4 class="text-sm font-bold text-white">${item.name}</h4>
          ${item.options?.extra_cheese ? '<span class="text-[10px] text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded font-mono">+ Queso Extra</span>' : ''}
          <div class="text-xs text-orange-400 font-mono font-semibold mt-1">
            $${Number(item.price).toLocaleString('es-AR')}
          </div>
        </div>

        <div class="flex items-center gap-2 bg-slate-900/80 px-2 py-1 rounded-lg border border-white/10">
          <button onclick="FlunaApp.changeItemQuantity(${idx}, -1)" class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white">-</button>
          <span class="text-xs font-bold text-white font-mono px-1">${item.quantity}</span>
          <button onclick="FlunaApp.changeItemQuantity(${idx}, 1)" class="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white">+</button>
        </div>

        <button onclick="FlunaApp.removeFromCart(${idx})" class="text-slate-500 hover:text-rose-400 text-sm p-1">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `).join('');
  },

  changeItemQuantity(index, delta) {
    if (!this.state.cart[index]) return;
    this.state.cart[index].quantity += delta;
    if (this.state.cart[index].quantity <= 0) {
      this.state.cart.splice(index, 1);
    }
    this.updateCartUI();
  },

  removeFromCart(index) {
    this.state.cart.splice(index, 1);
    this.updateCartUI();
  },

  fillCheckoutFormFields() {
    if (this.state.customer.name) document.getElementById('custName').value = this.state.customer.name;
    if (this.state.customer.phone) document.getElementById('custPhone').value = this.state.customer.phone;
    if (this.state.customer.address) document.getElementById('custAddress').value = this.state.customer.address;
  },

  async handleOrderSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('custName').value.trim();
    const phone = document.getElementById('custPhone').value.trim();
    const address = document.getElementById('custAddress').value.trim();
    const deliveryType = document.getElementById('deliveryType').value;
    const paymentMethod = document.getElementById('paymentMethod').value;
    const notes = document.getElementById('orderNotes').value.trim();

    if (!name || !phone || !address) {
      alert('Por favor completa tu nombre, teléfono y dirección de entrega.');
      return;
    }

    // Persistir datos del cliente
    this.state.customer.name = name;
    this.state.customer.phone = phone;
    this.state.customer.address = address;

    localStorage.setItem('fluna_customer_name', name);
    localStorage.setItem('fluna_customer_phone', phone);
    localStorage.setItem('fluna_customer_address', address);

    const totalAmount = this.state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const newOrderId = 'FL-' + Math.floor(1000 + Math.random() * 9000);

    const orderData = {
      id: newOrderId,
      customer_id: this.state.customer.id,
      customer_name: name,
      customer_phone: phone,
      delivery_address: address,
      delivery_type: deliveryType,
      total_amount: totalAmount,
      status: paymentMethod === 'mercadopago' ? 'Solicitado' : 'Solicitado',
      payment_method: paymentMethod,
      payment_status: 'pending',
      notes: notes
    };

    // Crear orden en Supabase
    const { data: createdOrder, error } = await FlunaDB.createOrder(orderData, this.state.cart);

    if (error) {
      alert('Ocurrió un error al registrar el pedido: ' + error.message);
      return;
    }

    this.state.activeOrder = createdOrder;
    this.state.cart = [];
    this.updateCartUI();

    document.getElementById('checkoutModal').classList.add('hidden');

    // Iniciar pasarela Mercado Pago si aplica
    if (paymentMethod === 'mercadopago') {
      FlunaPayments.processPayment(createdOrder, (res) => {
        alert('¡Pago procesado con éxito en Mercado Pago! Tu pedido ha ingresado a la cocina de FLuna.');
        this.openOrderTrackerModal(createdOrder.id);
      });
    } else {
      alert(`¡Pedido #${newOrderId} recibido con éxito! Pago en ${paymentMethod === 'cash' ? 'Efectivo al recibir' : 'Transferencia'}.`);
      this.openOrderTrackerModal(createdOrder.id);
    }
  },

  async loadCustomerOrders() {
    const { data } = await FlunaDB.getCustomerOrders(this.state.customer.id);
    if (data) {
      this.state.customerOrders = data;
      this.renderTrackerView();
    }
  },

  openOrderTrackerModal(orderId = null) {
    const trackerModal = document.getElementById('trackerModal');
    trackerModal.classList.remove('hidden');
    trackerModal.classList.add('flex');

    this.loadCustomerOrders();
  },

  renderTrackerView() {
    const trackerContent = document.getElementById('trackerContent');
    if (!trackerContent) return;

    if (this.state.customerOrders.length === 0) {
      trackerContent.innerHTML = `
        <div class="text-center py-12 text-slate-400 space-y-3">
          <i class="fa-solid fa-clock-rotate-left text-4xl text-slate-600"></i>
          <p class="font-medium">No tienes pedidos activos recientemente.</p>
        </div>
      `;
      return;
    }

    const latestOrder = this.state.customerOrders[0];
    const isCancelled = latestOrder.status === 'Cancelado';
    const stages = ['Solicitado', 'Aprobada', 'En cocina', 'Terminado', 'Embalando', 'En camino', 'Entregado'];
    const currentIdx = stages.indexOf(latestOrder.status);

    trackerContent.innerHTML = `
      <div class="glass-panel p-6 space-y-6">
        <div class="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <span class="text-xs text-orange-400 font-mono font-bold">PEDIDO EN TIEMPO REAL</span>
            <h3 class="text-2xl font-black text-white font-mono">#${latestOrder.id}</h3>
          </div>
          <span class="badge-status badge-${this.getStatusBadgeClass(latestOrder.status)}">
            ${latestOrder.status}
          </span>
        </div>

        ${isCancelled ? `
          <div class="bg-rose-500/10 border border-rose-500/20 rounded-xl p-6 text-center space-y-3">
            <i class="fa-solid fa-circle-xmark text-4xl text-rose-500 animate-pulse"></i>
            <h4 class="text-base font-extrabold text-white">Pedido Cancelado</h4>
            <p class="text-xs text-slate-400 max-w-sm mx-auto">Este pedido fue cancelado. Si tenés alguna duda o consulta sobre tu orden, podés escribirnos en vivo desde el chat flotante de soporte.</p>
          </div>
        ` : `
          <!-- Pipeline Stepper -->
          <div class="relative py-4">
            <div class="grid grid-cols-7 gap-1 text-center relative z-10">
              ${stages.map((stage, idx) => {
                const isActive = idx <= currentIdx;
                const isCurrent = idx === currentIdx;
                return `
                  <div class="flex flex-col items-center space-y-2">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold font-mono transition-all duration-500
                      ${isCurrent ? 'bg-orange-500 text-white animate-pulse-glow scale-110' : isActive ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500'}">
                      ${isActive ? '<i class="fa-solid fa-check"></i>' : (idx + 1)}
                    </div>
                    <span class="text-[10px] font-medium leading-tight ${isActive ? 'text-white' : 'text-slate-500'}">${stage}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `}

        <!-- Detalle de la Orden -->
        <div class="bg-slate-950/80 p-4 rounded-xl space-y-3 text-xs border border-white/5">
          <div class="flex justify-between text-slate-400">
            <span>Cliente: <strong class="text-white">${latestOrder.customer_name}</strong></span>
            <span>Dirección: <strong class="text-white">${latestOrder.delivery_address}</strong></span>
          </div>
          <div class="flex justify-between text-slate-400">
            <span>Método de Pago: <strong class="text-orange-400 uppercase">${latestOrder.payment_method} (${latestOrder.payment_status})</strong></span>
            <span>Total: <strong class="text-white font-mono text-sm">$${Number(latestOrder.total_amount).toLocaleString('es-AR')}</strong></span>
          </div>
        </div>
      </div>
    `;
  },

  getStatusBadgeClass(status) {
    switch (status) {
      case 'Solicitado': return 'solicitado';
      case 'Falta de pago': return 'falta-pago';
      case 'Aprobada': return 'aprobada';
      case 'En cocina': return 'cocina';
      case 'Terminado': return 'terminado';
      case 'Embalando': return 'embalando';
      case 'En camino': return 'camino';
      case 'Entregado': return 'entregado';
      case 'Cancelado': return 'cancelado';
      default: return 'solicitado';
    }
  },

  // --- CHAT EN TIEMPO REAL ---
  async loadChatMessages() {
    const chatContainer = document.getElementById('chatMessages');
    if (!chatContainer) return;

    const { data } = await FlunaDB.getMessages(this.state.customer.id);
    if (data) {
      this.state.messages = data;
      this.renderChatMessages();
    }
  },

  renderChatMessages() {
    const chatContainer = document.getElementById('chatMessages');
    if (!chatContainer) return;

    if (this.state.messages.length === 0) {
      chatContainer.innerHTML = `
        <div class="text-center text-xs text-slate-500 py-8">
          ¡Hola! Escribe un mensaje a la cocina de FLuna para consultar sobre tu pedido.
        </div>
      `;
      return;
    }

    chatContainer.innerHTML = this.state.messages.map(msg => {
      const isCustomer = msg.sender_role === 'customer';
      return `
        <div class="flex ${isCustomer ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[80%] rounded-2xl px-4 py-2 text-xs shadow-md ${
            isCustomer ? 'bg-orange-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 border border-white/10 rounded-bl-none'
          }">
            <div class="font-bold text-[10px] text-orange-200 mb-0.5">${msg.sender_role === 'admin' ? 'Pizzería FLuna' : 'Tú'}</div>
            <p>${msg.message}</p>
            <span class="text-[9px] opacity-70 block text-right mt-1 font-mono">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
          </div>
        </div>
      `;
    }).join('');

    chatContainer.scrollTop = chatContainer.scrollHeight;
  },

  async handleSendChatMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    const msgObj = {
      customer_id: this.state.customer.id,
      customer_name: this.state.customer.name || 'Cliente FLuna',
      sender_role: 'customer',
      message: text
    };

    await FlunaDB.sendMessage(msgObj);
    this.loadChatMessages();
  },

  // --- SUSCRIPCIONES REALTIME ---
  initRealtimeSubscriptions() {
    // Escuchar cambios de estado en pedidos
    FlunaDB.subscribeOrders((payload) => {
      if (payload.new && payload.new.customer_id === this.state.customer.id) {
        console.log('Actualización Realtime de pedido:', payload.new);
        this.loadCustomerOrders();
      }
    });

    // Escuchar mensajes de chat
    FlunaDB.subscribeMessages((newMsg) => {
      if (newMsg.customer_id === this.state.customer.id) {
        this.state.messages.push(newMsg);
        this.renderChatMessages();
      }
    });

    // Escuchar cambios en la base de productos
    FlunaDB.subscribeProducts(() => {
      this.loadProducts();
    });
  },

  // --- PWA INSTALACIÓN ---
  initPWA() {
    let deferredPrompt = null;
    const pwaInstallBtn = document.getElementById('pwaInstallBtn');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (pwaInstallBtn) pwaInstallBtn.classList.remove('hidden');
    });

    if (pwaInstallBtn) {
      pwaInstallBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          console.log('PWA instalada por el usuario.');
        }
        deferredPrompt = null;
        pwaInstallBtn.classList.add('hidden');
      });
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Service Worker registrado:', reg.scope))
        .catch(err => console.warn('Error registrando Service Worker:', err));
    }
  },

  // --- MÉTODOS AUXILIARES DE AUTH Y PERFIL ---
  async initAuth() {
    const client = getSupabaseClient();
    if (!client) return;

    // Escuchar cambios de sesión
    client.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const user = session.user;
        this.state.customer = {
          id: user.id,
          name: user.user_metadata.full_name || '',
          phone: user.user_metadata.phone || '',
          address: user.user_metadata.address || '',
          email: user.email
        };
        this.updateAuthUI(true);
        this.loadCustomerOrders();
        this.loadChatMessages();

        // Ocultar aviso de autenticación si existe
        document.getElementById('authNotice')?.classList.add('hidden');

        // --- RESTAURACIÓN DE COMPRA PENDIENTE ---
        if (localStorage.getItem('fluna_pending_checkout') === 'true') {
          const pendingCart = localStorage.getItem('fluna_pending_cart');
          if (pendingCart) {
            this.state.cart = JSON.parse(pendingCart);
            this.updateCartUI();
          }
          localStorage.removeItem('fluna_pending_checkout');
          localStorage.removeItem('fluna_pending_cart');

          setTimeout(() => {
            const checkoutModal = document.getElementById('checkoutModal');
            if (checkoutModal) {
              checkoutModal.classList.remove('hidden');
              checkoutModal.classList.add('flex');
              this.fillCheckoutFormFields();
            }
          }, 400);
        }
      } else {
        this.state.customer = { id: '', name: '', phone: '', address: '', email: '' };
        this.updateAuthUI(false);
      }
    });

    // Cargar sesión inicial
    const { data: { session } } = await client.auth.getSession();
    if (session) {
      const user = session.user;
      this.state.customer = {
        id: user.id,
        name: user.user_metadata.full_name || '',
        phone: user.user_metadata.phone || '',
        address: user.user_metadata.address || '',
        email: user.email
      };
      this.updateAuthUI(true);
      this.loadCustomerOrders();
      this.loadChatMessages();
    }
  },

  updateAuthUI(isLoggedIn) {
    const authBtnText = document.getElementById('authBtnText');
    if (authBtnText) {
      authBtnText.innerText = isLoggedIn ? (this.state.customer.name || 'Mi Perfil') : 'Ingresar';
    }
  },

  toggleAuthMode(mode) {
    this.state.authMode = mode;
    const title = document.getElementById('authModalTitle');
    const submitBtn = document.getElementById('authSubmitBtn');
    const toggleBtnText = document.getElementById('authToggleText');
    const toggleBtn = document.getElementById('authToggleBtn');
    const nameField = document.getElementById('authRegisterNameField');

    if (mode === 'login') {
      if (title) title.innerText = 'Iniciar Sesión';
      if (submitBtn) submitBtn.innerText = 'Ingresar';
      if (toggleBtnText) toggleBtnText.innerText = '¿No tenés cuenta?';
      if (toggleBtn) toggleBtn.innerText = 'Registrate aquí';
      nameField?.classList.add('hidden');
      document.getElementById('authName').required = false;
    } else {
      if (title) title.innerText = 'Crear Cuenta';
      if (submitBtn) submitBtn.innerText = 'Registrarse';
      if (toggleBtnText) toggleBtnText.innerText = '¿Ya tenés cuenta?';
      if (toggleBtn) toggleBtn.innerText = 'Iniciá sesión';
      nameField?.classList.remove('hidden');
      document.getElementById('authName').required = true;
    }
  },

  async handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const name = document.getElementById('authName').value.trim();

    if (this.state.authMode === 'login') {
      const { error } = await FlunaDB.signIn(email, password);
      if (error) {
        alert('Error al iniciar sesión: ' + error.message);
      } else {
        document.getElementById('authModal').classList.add('hidden');
      }
    } else {
      const { error } = await FlunaDB.signUp(email, password, name);
      if (error) {
        alert('Error al registrarse: ' + error.message);
      } else {
        alert('¡Registro exitoso! Ya puedes iniciar sesión con tu cuenta.');
        this.toggleAuthMode('login');
      }
    }
  },

  fillProfileFormFields() {
    if (document.getElementById('profileName')) document.getElementById('profileName').value = this.state.customer.name;
    if (document.getElementById('profilePhone')) document.getElementById('profilePhone').value = this.state.customer.phone;
    if (document.getElementById('profileAddress')) document.getElementById('profileAddress').value = this.state.customer.address;
  },

  async handleProfileUpdate(e) {
    e.preventDefault();
    const name = document.getElementById('profileName').value.trim();
    const phone = document.getElementById('profilePhone').value.trim();
    const address = document.getElementById('profileAddress').value.trim();

    const { error } = await FlunaDB.updateProfile(name, phone, address);
    if (error) {
      alert('Error al actualizar perfil: ' + error.message);
    } else {
      alert('¡Perfil actualizado con éxito!');
      this.state.customer.name = name;
      this.state.customer.phone = phone;
      this.state.customer.address = address;
      this.updateAuthUI(true);
      document.getElementById('profileModal').classList.add('hidden');
    }
  },

  async handleLogout() {
    if (confirm('¿Cerrar sesión en FLuna?')) {
      await FlunaDB.signOut();
      document.getElementById('profileModal').classList.add('hidden');
      window.location.reload();
    }
  },

  switchProfileTab(tab) {
    const dataSection = document.getElementById('profileDataSection');
    const ordersSection = document.getElementById('profileOrdersSection');
    const tabProfileBtn = document.getElementById('tabProfileBtn');
    const tabOrdersBtn = document.getElementById('tabOrdersBtn');

    if (tab === 'profile') {
      dataSection?.classList.remove('hidden');
      ordersSection?.classList.add('hidden');
      tabProfileBtn?.classList.add('text-orange-400', 'border-b-2', 'border-orange-500');
      tabProfileBtn?.classList.remove('text-slate-400');
      tabOrdersBtn?.classList.remove('text-orange-400', 'border-b-2', 'border-orange-500');
      tabOrdersBtn?.classList.add('text-slate-400');
    } else {
      dataSection?.classList.add('hidden');
      ordersSection?.classList.remove('hidden');
      tabOrdersBtn?.classList.add('text-orange-400', 'border-b-2', 'border-orange-500');
      tabOrdersBtn?.classList.remove('text-slate-400');
      tabProfileBtn?.classList.remove('text-orange-400', 'border-b-2', 'border-orange-500');
      tabProfileBtn?.classList.add('text-slate-400');
      this.renderProfileOrders();
    }
  },

  renderProfileOrders() {
    const listContainer = document.getElementById('profileOrdersList');
    if (!listContainer) return;

    if (this.state.customerOrders.length === 0) {
      listContainer.innerHTML = `<div class="text-center text-xs text-slate-500 py-8">No realizaste pedidos todavía.</div>`;
      return;
    }

    listContainer.innerHTML = this.state.customerOrders.map(order => `
      <div class="glass-card p-4 space-y-2 border border-white/5">
        <div class="flex justify-between items-center">
          <span class="font-bold text-orange-400 font-mono text-xs">#${order.id}</span>
          <span class="text-[10px] text-slate-400">${new Date(order.created_at).toLocaleDateString('es-AR')}</span>
        </div>
        <div class="text-xs text-slate-300">
          ${order.order_items.map(i => `${i.quantity}x ${i.product_name}`).join(', ')}
        </div>
        <div class="flex justify-between items-center text-xs pt-1 border-t border-white/5 font-mono">
          <span class="text-slate-400">Total: $${Number(order.total_amount).toLocaleString('es-AR')}</span>
          <span class="badge-status badge-${this.getStatusBadgeClass(order.status)} text-[9px] px-2 py-0.5">${order.status}</span>
        </div>
      </div>
    `).join('');
  }
};

window.FlunaApp = FlunaApp;
