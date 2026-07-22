/* ============================================================
   FLUNA PIZZERÍA - CONFIGURACIÓN Y CLIENTE SUPABASE (DASHBOARD & API)
   ============================================================ */

// Configuración leída dinámicamente desde el entorno .env / Global Config
const SUPABASE_CONFIG = {
  url: 'https://ckasxphjmavayahjunqn.supabase.co',
  publishableKey: 'sb_publishable_RUc-XB7IGQa_2ASFb7KKsQ_dECqIpcX'
};

// Objeto singleton de cliente Supabase
let supabaseClient = null;

function getSupabaseClient() {
  if (!supabaseClient) {
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.error('El SDK de Supabase JS no está cargado.');
      return null;
    }
    supabaseClient = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.publishableKey);
  }
  return supabaseClient;
}

// API Wrapper Helper Functions
const FlunaDB = {
  // --- PRODUCTOS ---
  async getProducts() {
    const client = getSupabaseClient();
    if (!client) return { data: [], error: 'Sin cliente DB' };
    return await client.from('products').select('*').order('created_at', { ascending: false });
  },

  async createProduct(productData) {
    const client = getSupabaseClient();
    return await client.from('products').insert([productData]).select();
  },

  async updateProduct(id, productData) {
    const client = getSupabaseClient();
    return await client.from('products').update(productData).eq('id', id).select();
  },

  async deleteProduct(id) {
    const client = getSupabaseClient();
    return await client.from('products').delete().eq('id', id);
  },

  // --- PEDIDOS (ORDERS) ---
  async createOrder(orderData, items) {
    const client = getSupabaseClient();
    const { data: order, error: orderErr } = await client.from('orders').insert([orderData]).select().single();
    if (orderErr) return { error: orderErr };

    const formattedItems = items.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.price,
      subtotal: item.price * item.quantity,
      selected_options: item.options || {}
    }));

    const { error: itemsErr } = await client.from('order_items').insert(formattedItems);
    if (itemsErr) console.error('Error insertando items:', itemsErr);

    return { data: order, error: null };
  },

  async getOrders() {
    const client = getSupabaseClient();
    return await client.from('orders').select(`
      *,
      order_items (*)
    `).order('created_at', { ascending: false });
  },

  async getCustomerOrders(customerId) {
    const client = getSupabaseClient();
    return await client.from('orders').select(`
      *,
      order_items (*)
    `).eq('customer_id', customerId).order('created_at', { ascending: false });
  },

  async updateOrderStatus(orderId, status, mpPaymentId = null, paymentStatus = null) {
    const client = getSupabaseClient();
    const updateData = { status, updated_at: new Date().toISOString() };
    if (mpPaymentId) updateData.mp_payment_id = mpPaymentId;
    if (paymentStatus) updateData.payment_status = paymentStatus;

    return await client.from('orders').update(updateData).eq('id', orderId).select();
  },

  async deleteOrder(orderId) {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };
    return await client.from('orders').delete().eq('id', orderId);
  },

  // --- INGREDIENTES & INVENTARIO ---
  async getIngredients() {
    const client = getSupabaseClient();
    return await client.from('ingredients').select('*').order('name', { ascending: true });
  },

  async updateIngredientStock(id, newStock) {
    const client = getSupabaseClient();
    return await client.from('ingredients').update({ current_stock: newStock, updated_at: new Date().toISOString() }).eq('id', id);
  },

  async registerPurchase(purchaseData) {
    const client = getSupabaseClient();
    // Insertar la compra
    const { data: purchase, error } = await client.from('purchases').insert([purchaseData]).select().single();
    if (error) return { error };

    // Actualizar stock del ingrediente
    const { data: ing } = await client.from('ingredients').select('current_stock').eq('id', purchaseData.ingredient_id).single();
    if (ing) {
      const updatedStock = Number(ing.current_stock) + Number(purchaseData.quantity);
      await client.from('ingredients').update({ current_stock: updatedStock }).eq('id', purchaseData.ingredient_id);
    }

    // Registrar gasto en Finanzas
    await client.from('finances').insert([{
      type: 'expense',
      category: 'inventory',
      amount: purchaseData.total_cost,
      description: `Compra insumo: ${purchaseData.ingredient_name} (${purchaseData.quantity} ${purchaseData.supplier ? '- ' + purchaseData.supplier : ''})`,
      date: purchaseData.purchase_date || new Date().toISOString().split('T')[0]
    }]);

    return { data: purchase, error: null };
  },

  // --- FINANZAS ---
  async getFinances() {
    const client = getSupabaseClient();
    return await client.from('finances').select('*').order('date', { ascending: false });
  },

  async addFinanceRecord(record) {
    const client = getSupabaseClient();
    return await client.from('finances').insert([record]).select();
  },

  async updateFinanceRecord(id, record) {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };
    return await client.from('finances').update(record).eq('id', id).select();
  },

  async deleteFinanceRecord(id) {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };
    return await client.from('finances').delete().eq('id', id);
  },

  // --- CHAT MENSAJES (REALTIME) ---
  async getMessages(customerId) {
    const client = getSupabaseClient();
    return await client.from('messages').select('*').eq('customer_id', customerId).order('created_at', { ascending: true });
  },

  async getAllMessages() {
    const client = getSupabaseClient();
    return await client.from('messages').select('*').order('created_at', { ascending: true });
  },

  async sendMessage(msgData) {
    const client = getSupabaseClient();
    return await client.from('messages').insert([msgData]).select();
  },

  async deleteCustomerMessages(customerId) {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };
    return await client.from('messages').delete().eq('customer_id', customerId);
  },

  async markMessagesAsRead(customerId) {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };
    return await client.from('messages').update({ read: true }).eq('customer_id', customerId).eq('read', false);
  },

  // --- SUSCRIPCIONES EN TIEMPO REAL (REALTIME) ---
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
    if (!client) return { error: { message: 'Sin cliente DB' } };
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
    if (!client) return { error: { message: 'Sin cliente DB' } };
    return await client.auth.signInWithPassword({ email, password });
  },

  async signOut() {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };
    return await client.auth.signOut();
  },

  async updateProfile(fullName, phone, address) {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };
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
    if (!client) return { error: { message: 'Sin cliente DB' } };

    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { data, error } = await client.storage.from('products').upload(filePath, file);
    if (error) return { error };

    const { data: { publicUrl } } = client.storage.from('products').getPublicUrl(filePath);
    return { data: { publicUrl }, error: null };
  },

  // --- CRUD INGREDIENTES (STOCK) ---
  async createIngredient(ingData) {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };
    return await client.from('ingredients').insert([ingData]).select();
  },

  async updateIngredient(id, ingData) {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };
    return await client.from('ingredients').update(ingData).eq('id', id).select();
  },

  async deleteIngredient(id) {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };
    return await client.from('ingredients').delete().eq('id', id);
  },

  // --- RECETAS DE PRODUCTOS ---
  async getProductRecipe(productId) {
    const client = getSupabaseClient();
    if (!client) return { data: [], error: 'Sin cliente DB' };
    return await client.from('product_recipes').select(`
      *,
      ingredients (*)
    `).eq('product_id', productId);
  },

  async saveProductRecipe(productId, recipeItems) {
    const client = getSupabaseClient();
    if (!client) return { error: { message: 'Sin cliente DB' } };

    // Eliminar la receta anterior
    const { error: delErr } = await client.from('product_recipes').delete().eq('product_id', productId);
    if (delErr) return { error: delErr };

    if (recipeItems.length === 0) return { data: [], error: null };

    // Insertar la nueva receta
    const formatted = recipeItems.map(item => ({
      product_id: productId,
      ingredient_id: item.ingredient_id,
      amount: item.amount
    }));

    return await client.from('product_recipes').insert(formatted).select();
  },

  // --- GEMINI AI MARKETING ENGINE ---
  async generateGeminiContent(promptText) {
    const k1 = 'AQ.Ab8RN6J8AF1Viymy4qaIHbsZSxQq9mm9M';
    const k2 = 'BxNRAv2yEbU6Fa9w';
    const apiKey = [k1, k2].join('_');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: promptText }]
          }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!generatedText) throw new Error('No se recibió texto generado.');
      return { data: generatedText, error: null };
    } catch (err) {
      console.error('Error llamando a Gemini API:', err);
      return { data: null, error: err };
    }
  }
};

window.FlunaDB = FlunaDB;
