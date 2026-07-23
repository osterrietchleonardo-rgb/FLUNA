/* ============================================================
   FLUNA PIZZERÍA - CONFIGURACIÓN Y CLIENTE SUPABASE (DASHBOARD & API)
   ============================================================ */

// Configuración pública de Supabase. Se puede sobrescribir desde el HTML
// definiendo window.FLUNA_CONFIG antes de cargar este script.
// La publishable key es pública por diseño: la seguridad real vive en las
// políticas RLS de la base, no en ocultar esta clave.
const SUPABASE_CONFIG = Object.assign({
  url: 'https://ckasxphjmavayahjunqn.supabase.co',
  publishableKey: 'sb_publishable_RUc-XB7IGQa_2ASFb7KKsQ_dECqIpcX'
}, window.FLUNA_CONFIG || {});

// Objeto singleton de cliente Supabase
let supabaseClient = null;

function getSupabaseClient() {
  if (!supabaseClient) {
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.error('El SDK de Supabase JS no está cargado.');
      return null;
    }
    try {
      supabaseClient = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.publishableKey);
    } catch (e) {
      console.error('No se pudo inicializar el cliente de Supabase:', e);
      return null;
    }
  }
  return supabaseClient;
}

// Respuesta uniforme cuando no hay cliente disponible (SDK caído, sin red, etc.)
const NO_CLIENT_ERROR = { message: 'Sin conexión con la base de datos de FLuna.' };
function noClient(emptyData = null) {
  return { data: emptyData, error: NO_CLIENT_ERROR };
}

// API Wrapper Helper Functions
const FlunaDB = {
  // --- PRODUCTOS ---
  async getProducts() {
    const client = getSupabaseClient();
    if (!client) return noClient([]);
    return await client.from('products').select('*').order('created_at', { ascending: false });
  },

  async createProduct(productData) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('products').insert([productData]).select();
  },

  async updateProduct(id, productData) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('products').update(productData).eq('id', id).select();
  },

  async deleteProduct(id) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('products').delete().eq('id', id);
  },

  // --- PEDIDOS (ORDERS) ---
  /**
   * Crea un pedido con sus items.
   * `orders.id` es TEXT generado en el cliente (FL-XXXXXX), así que reintenta
   * con un ID nuevo si Postgres rechaza por clave primaria duplicada (23505).
   * Devuelve `itemsError` aparte: si el pedido se creó pero los items fallaron,
   * quien llama debe avisar en vez de dar el pedido por bueno.
   */
  async createOrder(orderData, items) {
    const client = getSupabaseClient();
    if (!client) return noClient();

    let order = null;
    let orderErr = null;
    let payload = Object.assign({}, orderData);

    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await client.from('orders').insert([payload]).select().single();
      if (!res.error) {
        order = res.data;
        orderErr = null;
        break;
      }

      orderErr = res.error;
      // 23505 = unique_violation. El ID ya existía: generamos otro y reintentamos.
      if (res.error.code !== '23505') break;
      payload = Object.assign({}, payload, { id: FlunaUtils.generateOrderId() });
    }

    if (!order) return { data: null, error: orderErr };

    const formattedItems = (items || []).map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.price,
      subtotal: item.price * item.quantity,
      selected_options: item.options || {}
    }));

    let itemsError = null;
    if (formattedItems.length > 0) {
      const { error: itemsErr } = await client.from('order_items').insert(formattedItems);
      if (itemsErr) {
        console.error('Error insertando items del pedido:', itemsErr);
        itemsError = itemsErr;
      }
    }

    return { data: order, error: null, itemsError };
  },

  async getOrders() {
    const client = getSupabaseClient();
    if (!client) return noClient([]);
    return await client.from('orders').select(`
      *,
      order_items (*)
    `).order('created_at', { ascending: false });
  },

  async getCustomerOrders(customerId) {
    const client = getSupabaseClient();
    if (!client) return noClient([]);
    if (!customerId) return { data: [], error: null };
    return await client.from('orders').select(`
      *,
      order_items (*)
    `).eq('customer_id', customerId).order('created_at', { ascending: false });
  },

  async updateOrderStatus(orderId, status, mpPaymentId = null, paymentStatus = null) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    const updateData = { status, updated_at: new Date().toISOString() };
    if (mpPaymentId) updateData.mp_payment_id = mpPaymentId;
    if (paymentStatus) updateData.payment_status = paymentStatus;

    return await client.from('orders').update(updateData).eq('id', orderId).select();
  },

  async deleteOrder(orderId) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('orders').delete().eq('id', orderId);
  },

  // --- INGREDIENTES & INVENTARIO ---
  async getIngredients() {
    const client = getSupabaseClient();
    if (!client) return noClient([]);
    return await client.from('ingredients').select('*').order('name', { ascending: true });
  },

  async updateIngredientStock(id, newStock) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('ingredients').update({ current_stock: newStock, updated_at: new Date().toISOString() }).eq('id', id);
  },

  async registerPurchase(purchaseData) {
    const client = getSupabaseClient();
    if (!client) return noClient();

    // Insertar la compra
    const { data: purchase, error } = await client.from('purchases').insert([purchaseData]).select().single();
    if (error) return { data: null, error };

    // Actualizar stock del ingrediente
    const { data: ing, error: ingErr } = await client
      .from('ingredients').select('current_stock').eq('id', purchaseData.ingredient_id).single();

    if (ingErr) {
      console.warn('No se pudo leer el stock actual del insumo:', ingErr);
    } else if (ing) {
      const updatedStock = FlunaUtils.toNumber(ing.current_stock) + FlunaUtils.toNumber(purchaseData.quantity);
      const { error: stockErr } = await client
        .from('ingredients').update({ current_stock: updatedStock }).eq('id', purchaseData.ingredient_id);
      if (stockErr) console.warn('No se pudo actualizar el stock del insumo:', stockErr);
    }

    // Registrar gasto en Finanzas
    const { error: finErr } = await client.from('finances').insert([{
      type: 'expense',
      category: 'inventory',
      amount: purchaseData.total_cost,
      description: `Compra insumo: ${purchaseData.ingredient_name} (${purchaseData.quantity} ${purchaseData.supplier ? '- ' + purchaseData.supplier : ''})`,
      date: purchaseData.purchase_date || new Date().toISOString().split('T')[0]
    }]);
    if (finErr) console.warn('No se pudo registrar el gasto de la compra:', finErr);

    return { data: purchase, error: null };
  },

  // --- FINANZAS ---
  async getFinances() {
    const client = getSupabaseClient();
    if (!client) return noClient([]);
    return await client.from('finances').select('*').order('date', { ascending: false });
  },

  async addFinanceRecord(record) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('finances').insert([record]).select();
  },

  async updateFinanceRecord(id, record) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('finances').update(record).eq('id', id).select();
  },

  async deleteFinanceRecord(id) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('finances').delete().eq('id', id);
  },

  // --- CHAT MENSAJES (REALTIME) ---
  async getMessages(customerId) {
    const client = getSupabaseClient();
    if (!client) return noClient([]);
    if (!customerId) return { data: [], error: null };
    return await client.from('messages').select('*').eq('customer_id', customerId).order('created_at', { ascending: true });
  },

  async getAllMessages() {
    const client = getSupabaseClient();
    if (!client) return noClient([]);
    return await client.from('messages').select('*').order('created_at', { ascending: true });
  },

  async sendMessage(msgData) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('messages').insert([msgData]).select();
  },

  async deleteCustomerMessages(customerId) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('messages').delete().eq('customer_id', customerId);
  },

  async markMessagesAsRead(customerId) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('messages').update({ read: true }).eq('customer_id', customerId).eq('read', false);
  },

  // --- SUSCRIPCIONES EN TIEMPO REAL (REALTIME) ---
  /**
   * Propaga el token de sesión al canal de realtime.
   *
   * Con RLS activo, realtime solo entrega las filas que el usuario podría leer
   * por SELECT. Si el canal se abrió antes del login sigue siendo anónimo y no
   * llega nada: por eso hay que fijar el token y volver a suscribirse.
   */
  setRealtimeAuth(accessToken) {
    const client = getSupabaseClient();
    if (client?.realtime?.setAuth) {
      try {
        client.realtime.setAuth(accessToken || null);
      } catch (e) {
        console.warn('No se pudo actualizar el token de realtime:', e);
      }
    }
  },

  /** Cierra todos los canales abiertos, para poder re-suscribir ya autenticado. */
  async removeAllChannels() {
    const client = getSupabaseClient();
    if (!client) return;
    try {
      await client.removeAllChannels();
    } catch (e) {
      console.warn('No se pudieron cerrar los canales de realtime:', e);
    }
  },

  subscribeOrders(onOrderChange) {
    const client = getSupabaseClient();
    if (!client) return null;
    return client
      .channel('public:orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
        onOrderChange(payload);
      })
      .subscribe();
  },

  subscribeMessages(onMessageReceived) {
    const client = getSupabaseClient();
    if (!client) return null;
    return client
      .channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        onMessageReceived(payload.new);
      })
      .subscribe();
  },

  subscribeProducts(onProductChange) {
    const client = getSupabaseClient();
    if (!client) return null;
    return client
      .channel('public:products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, payload => {
        onProductChange(payload);
      })
      .subscribe();
  },

  // --- AUTENTICACIÓN (SUPABASE AUTH) ---
  async signUp(email, password, fullName) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone: '',
          address: ''
        }
      }
    });
  },

  async signIn(email, password) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.auth.signInWithPassword({ email, password });
  },

  async signOut() {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.auth.signOut();
  },

  async updateProfile(fullName, phone, address) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.auth.updateUser({
      data: {
        full_name: fullName,
        phone: phone,
        address: address
      }
    });
  },

  // --- STORAGE (SUBIDA DE IMÁGENES) ---
  async uploadProductImage(file) {
    const client = getSupabaseClient();
    if (!client) return noClient();

    if (!file) return { data: null, error: { message: 'No se seleccionó ninguna imagen.' } };
    if (!/^image\//.test(file.type || '')) {
      return { data: null, error: { message: 'El archivo debe ser una imagen (JPG, PNG o WEBP).' } };
    }
    if (file.size > 5 * 1024 * 1024) {
      return { data: null, error: { message: 'La imagen supera los 5 MB. Reducila antes de subirla.' } };
    }

    const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error } = await client.storage.from('products').upload(filePath, file);
    if (error) return { data: null, error };

    const { data: { publicUrl } } = client.storage.from('products').getPublicUrl(filePath);
    return { data: { publicUrl }, error: null };
  },

  // --- CRUD INGREDIENTES (STOCK) ---
  async createIngredient(ingData) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('ingredients').insert([ingData]).select();
  },

  async updateIngredient(id, ingData) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('ingredients').update(ingData).eq('id', id).select();
  },

  async deleteIngredient(id) {
    const client = getSupabaseClient();
    if (!client) return noClient();
    return await client.from('ingredients').delete().eq('id', id);
  },

  // --- RECETAS DE PRODUCTOS ---
  async getProductRecipe(productId) {
    const client = getSupabaseClient();
    if (!client) return noClient([]);
    return await client.from('product_recipes').select(`
      *,
      ingredients (*)
    `).eq('product_id', productId);
  },

  async saveProductRecipe(productId, recipeItems) {
    const client = getSupabaseClient();
    if (!client) return noClient();

    // Eliminar la receta anterior
    const { error: delErr } = await client.from('product_recipes').delete().eq('product_id', productId);
    if (delErr) return { data: null, error: delErr };

    if (recipeItems.length === 0) return { data: [], error: null };

    // Insertar la nueva receta
    const formatted = recipeItems.map(item => ({
      product_id: productId,
      ingredient_id: item.ingredient_id,
      amount: item.amount
    }));

    return await client.from('product_recipes').insert(formatted).select();
  },

  // --- MOTOR DE MARKETING IA (VERCEL SERVERLESS FUNCTION) ---
  async generateGeminiContent(promptText) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);

      const response = await fetch('/api/generate-marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return { data: data.text, error: null };
    } catch (err) {
      const isTimeout = err.name === 'AbortError';
      console.error('Error llamando a la Serverless Function de Vercel:', err);
      return {
        data: null,
        error: { message: isTimeout ? 'La generación tardó demasiado. Probá de nuevo.' : FlunaUtils.errorMessage(err) }
      };
    }
  }
};

window.FlunaDB = FlunaDB;
window.getSupabaseClient = getSupabaseClient;
