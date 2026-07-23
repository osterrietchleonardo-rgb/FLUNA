-- ============================================================
-- FLUNA PIZZERÍA - SCHEMA COMPLETO DE BASE DE DATOS (SUPABASE)
-- ============================================================

-- Habilitar extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- 1. TABLA DE PRODUCTOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    category TEXT NOT NULL DEFAULT 'Pizzas', -- 'Pizzas', 'Empanadas', 'Bebidas', 'Postres', 'Combos'
    image_url TEXT,
    available_stock INT NOT NULL DEFAULT 50 CHECK (available_stock >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. TABLA DE PEDIDOS (ORDERS)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY, -- Formato ej: FL-1001
    customer_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    delivery_address TEXT NOT NULL,
    delivery_type TEXT NOT NULL DEFAULT 'delivery', -- 'delivery' | 'pickup'
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    status TEXT NOT NULL DEFAULT 'Solicitado', 
    -- Estados permitidos: 'Solicitado', 'Falta de pago', 'Aprobada', 'En cocina', 'Terminado', 'Embalando', 'En camino', 'Entregado', 'Cancelado'
    mp_payment_id TEXT,
    payment_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'in_process'
    payment_method TEXT NOT NULL DEFAULT 'mercadopago', -- 'mercadopago', 'cash', 'transfer'
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3. TABLA DE ITEMS DEL PEDIDO (ORDER_ITEMS)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    subtotal NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
    selected_options JSONB DEFAULT '{}'::jsonb, -- e.g. {"size": "Familiar", "extra_cheese": true}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 4. TABLA DE INGREDIENTES (INVENTARIO MATERIA PRIMA)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    unit TEXT NOT NULL DEFAULT 'kg', -- 'kg', 'g', 'u', 'litros'
    current_stock NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    min_stock_alert NUMERIC(10, 2) NOT NULL DEFAULT 5 CHECK (min_stock_alert >= 0),
    cost_per_unit NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (cost_per_unit >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 5. TABLA DE COMPRAS DE INSUMOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ingredient_id UUID REFERENCES public.ingredients(id) ON DELETE CASCADE,
    ingredient_name TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    total_cost NUMERIC(10, 2) NOT NULL CHECK (total_cost >= 0),
    supplier TEXT DEFAULT 'Proveedor General',
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 6. TABLA DE FINANZAS (ESTADO DE RESULTADOS & FLUJO DE CAJA)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'investment', 'debt')),
    category TEXT NOT NULL, -- 'sales', 'inventory', 'services', 'salaries', 'marketing', 'equipment', 'other'
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    description TEXT NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    related_order_id TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 7. TABLA DE MENSAJES (CHAT REALTIME CON CLIENTES)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    sender_role TEXT NOT NULL DEFAULT 'customer', -- 'customer' | 'admin'
    message TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- INDICES PARA OPTIMIZACIÓN DE BÚSQUEDAS
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_finances_date ON public.finances(date DESC);
CREATE INDEX IF NOT EXISTS idx_messages_customer ON public.messages(customer_id, created_at ASC);

-- ------------------------------------------------------------
-- TRIGGER: AUTO-REGISTRO DE INGRESO FINANCIERO AL APROBAR PEDIDO
-- ------------------------------------------------------------
-- Este trigger es la ÚNICA fuente del ingreso por venta en `finances`.
-- No insertar el ingreso también desde el frontend: se contaría dos veces.
CREATE OR REPLACE FUNCTION public.fn_sync_order_finance()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.payment_status = 'approved' OR NEW.status = 'Aprobada') AND (OLD.payment_status IS DISTINCT FROM 'approved' AND OLD.status IS DISTINCT FROM 'Aprobada') THEN
        INSERT INTO public.finances (type, category, amount, description, date, related_order_id)
        VALUES (
            'income',
            'sales',
            NEW.total_amount,
            CONCAT('Venta automática Pedido #', NEW.id, ' - ', NEW.customer_name),
            CURRENT_DATE,
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_order_finance ON public.orders;
CREATE TRIGGER trg_sync_order_finance
    AFTER INSERT OR UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_sync_order_finance();

-- ------------------------------------------------------------
-- 8. RECETAS DE PRODUCTOS (PRODUCT_RECIPES)
-- Qué insumos y en qué cantidad consume cada producto del menú.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
    amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_product_recipes_product ON public.product_recipes(product_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
--
-- ATENCIÓN: estas políticas son completamente abiertas (USING true).
-- Cualquiera con la publishable key puede leer y escribir todas las tablas,
-- incluidas finanzas y pedidos de otros clientes. Es lo que la app necesita
-- hoy porque el panel de admin opera desde el navegador con la misma clave
-- anónima que el sitio público.
-- Para cerrarlo de verdad, ver `schema_hardening.sql`.
-- ------------------------------------------------------------
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_recipes ENABLE ROW LEVEL SECURITY;

-- Se recrean para que este archivo sea re-ejecutable sin errores.
DROP POLICY IF EXISTS "Public Products Read" ON public.products;
DROP POLICY IF EXISTS "Public Products Insert" ON public.products;
DROP POLICY IF EXISTS "Public Products Update" ON public.products;
DROP POLICY IF EXISTS "Public Products Delete" ON public.products;
DROP POLICY IF EXISTS "Public Orders All" ON public.orders;
DROP POLICY IF EXISTS "Public Order Items All" ON public.order_items;
DROP POLICY IF EXISTS "Public Ingredients All" ON public.ingredients;
DROP POLICY IF EXISTS "Public Purchases All" ON public.purchases;
DROP POLICY IF EXISTS "Public Finances All" ON public.finances;
DROP POLICY IF EXISTS "Public Messages All" ON public.messages;
DROP POLICY IF EXISTS "Public Product Recipes All" ON public.product_recipes;

-- Políticas de lectura pública para Productos
CREATE POLICY "Public Products Read" ON public.products FOR SELECT USING (true);
CREATE POLICY "Public Products Insert" ON public.products FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Products Update" ON public.products FOR UPDATE USING (true);
CREATE POLICY "Public Products Delete" ON public.products FOR DELETE USING (true);

-- Políticas para Pedidos y Items (Acceso público permitido para crear y consultar sus órdenes)
CREATE POLICY "Public Orders All" ON public.orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Order Items All" ON public.order_items FOR ALL USING (true) WITH CHECK (true);

-- Políticas para Ingredientes, Compras, Finanzas y Recetas
CREATE POLICY "Public Ingredients All" ON public.ingredients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Purchases All" ON public.purchases FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Finances All" ON public.finances FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Messages All" ON public.messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Product Recipes All" ON public.product_recipes FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- HABILITAR REALTIME EN TABLAS CLAVE
-- ------------------------------------------------------------
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- DATOS SEMILLA (SEED DATA)
-- ------------------------------------------------------------

-- Productos iniciales de FLuna
INSERT INTO public.products (name, description, price, category, image_url, available_stock) VALUES
('Pizza Muzzarella FLuna', 'Salsa de tomate artesanal, abundante muzzarella, aceitunas negras y orégano fresco.', 9500.00, 'Pizzas', 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80', 40),
('Pizza Napolitana Premium', 'Muzzarella, rodajas de tomate fresco, ajo confitado, pesto de albahaca y aceite de oliva extra virgen.', 11200.00, 'Pizzas', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=600&auto=format&fit=crop&q=80', 35),
('Pizza Fugazzeta Rellena', 'Doble capa de masa, rellena de muzzarella derretida, cubierta con abundante cebolla caramelizada y orégano.', 12500.00, 'Pizzas', 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=600&auto=format&fit=crop&q=80', 25),
('Pizza Pepperoni Neón', 'Muzzarella fundida, salsa de tomates italianos y generosas rodajas de pepperoni crocante ahumado.', 13400.00, 'Pizzas', 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=600&auto=format&fit=crop&q=80', 30),
('Empanada Carne Cortada a Cuchillo', 'Relleno jugoso de carne vacuna, cebolla, huevo duro y especias criollas.', 1500.00, 'Empanadas', 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=600&auto=format&fit=crop&q=80', 100),
('Empanada Jamón y Queso Premium', 'Queso muzzarella suave y jamón cocido seleccionado de primera calidad.', 1400.00, 'Empanadas', 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600&auto=format&fit=crop&q=80', 100),
('Coca-Cola Original 1.5L', 'Gaseosa refrescante botella 1.5 Litros.', 3200.00, 'Bebidas', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80', 60),
('Cerveza Artesanal IPA 500ml', 'Cerveza tirada frascada de sabor intenso y amargor lupulado equilibrado.', 4100.00, 'Bebidas', 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=600&auto=format&fit=crop&q=80', 45),
('Tiramisú de la Casa FLuna', 'Postre tradicional italiano con café espresso, queso mascarpone y cacao amargo.', 3800.00, 'Postres', 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=600&auto=format&fit=crop&q=80', 20),
('Combo Familiar FLuna', '2 Pizzas Muzzarella + 6 Empanadas a elección + 1 Coca-Cola 1.5L.', 24900.00, 'Combos', 'https://images.unsplash.com/photo-1544982503-9f984c14501a?w=600&auto=format&fit=crop&q=80', 15)
ON CONFLICT DO NOTHING;

-- Ingredientes iniciales de materia prima
INSERT INTO public.ingredients (name, unit, current_stock, min_stock_alert, cost_per_unit) VALUES
('Harina 0000', 'kg', 85.00, 20.00, 850.00),
('Queso Muzzarella', 'kg', 42.50, 15.00, 5200.00),
('Salsa de Tomate Triturado', 'litros', 30.00, 10.00, 1800.00),
('Pepperoni Ahumado', 'kg', 8.00, 3.00, 9500.00),
('Cebolla', 'kg', 25.00, 8.00, 700.00),
('Aceitunas Negras', 'kg', 6.00, 2.00, 4100.00),
('Jamón Cocido', 'kg', 12.00, 4.00, 4800.00)
ON CONFLICT (name) DO NOTHING;

-- Finanzas iniciales (registro base)
INSERT INTO public.finances (type, category, amount, description, date) VALUES
('expense', 'inventory', 85000.00, 'Compra inicial de Harina y Muzzarella para la semana', CURRENT_DATE - INTERVAL '3 days'),
('expense', 'services', 32000.00, 'Pago servicio de gas y energía eléctrica', CURRENT_DATE - INTERVAL '5 days'),
('income', 'sales', 145000.00, 'Ventas del fin de semana anterior', CURRENT_DATE - INTERVAL '2 days'),
('investment', 'equipment', 120000.00, 'Adquisición de pala de horno de piedra profesional', CURRENT_DATE - INTERVAL '10 days')
ON CONFLICT DO NOTHING;
