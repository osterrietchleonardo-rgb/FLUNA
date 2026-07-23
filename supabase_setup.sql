-- ============================================================================
-- FLUNA PIZZERÍA · SETUP COMPLETO DE SUPABASE
--
-- Pegá TODO este archivo en el SQL editor de Supabase y ejecutalo una vez.
-- Es idempotente: podés volver a correrlo sin romper nada.
--
-- Hace tres cosas:
--   1. Crea las tablas de la integración con Mercado Pago.
--   2. Cierra las políticas RLS (hoy cualquiera puede leer tus finanzas).
--   3. Deja el chat y los pedidos visibles solo para su dueño.
--
-- ✅ YA APLICADO el 2026-07-23 sobre el proyecto ckasxphjmavayahjunqn.
--     Se conserva como referencia y por si hay que recrear el entorno.

-- ============================================================================


-- ============================================================================
-- PASO 0.A — CREAR EL USUARIO ADMINISTRADOR
--
-- En el panel de Supabase: Authentication → Users → "Add user"
--   · Email: el que va a usar el local para entrar
--   · Password: la que quieran
--   · Marcá "Auto Confirm User" para que no tenga que validar el mail
--
-- PASO 0.B — DARLE EL ROL DE ADMIN
-- Cambiá el email de abajo por el que acabás de crear y ejecutá:
-- ============================================================================

UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
WHERE email = 'admin@fluna.com';

-- Verificación: esta consulta tiene que devolver tu usuario con role = admin.
-- Si devuelve 0 filas, el email no coincide y el panel no va a funcionar.
SELECT email, raw_app_meta_data->>'role' AS rol
FROM auth.users
WHERE raw_app_meta_data->>'role' = 'admin';

-- NOTA: el rol va en `raw_app_meta_data` (app_metadata) y no en
-- `raw_user_meta_data` (user_metadata) a propósito: el usuario puede editar
-- su propio user_metadata, así que ahí un rol no valdría nada.


-- ============================================================================
-- PASO 1 — TABLAS DE LA INTEGRACIÓN CON MERCADO PAGO
-- ============================================================================

-- Credenciales OAuth del local.
--
-- SEGURIDAD: RLS ACTIVO y NINGUNA POLÍTICA. En Postgres eso significa denegar
-- todo. Ni la publishable key del navegador ni un usuario logueado pueden
-- leerla: solo la `service_role`, que vive únicamente en Vercel.
-- NO le agregues políticas nunca. Si el panel necesita datos, que pasen por
-- /api/mp-status, que devuelve solo metadata.
CREATE TABLE IF NOT EXISTS public.mp_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mp_user_id TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    public_key TEXT,
    scope TEXT,
    live_mode BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Verificadores PKCE en tránsito (viven segundos, entre iniciar el OAuth y
-- volver del callback). También sin políticas.
CREATE TABLE IF NOT EXISTS public.mp_oauth_pending (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code_verifier TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mp_integrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mp_oauth_pending ENABLE ROW LEVEL SECURITY;

-- Si alguna corrida anterior dejó políticas en estas tablas, se eliminan.
DO $$
DECLARE pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname, tablename FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('mp_integrations', 'mp_oauth_pending')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_mp_payment ON public.orders(mp_payment_id)
    WHERE mp_payment_id IS NOT NULL;


-- ============================================================================
-- PASO 2 — RECETAS DE PRODUCTOS
-- La app ya usaba esta tabla pero el schema original no la creaba.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.product_recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
    amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_product_recipes_product ON public.product_recipes(product_id);


-- ============================================================================
-- PASO 3 — CERRAR LAS POLÍTICAS RLS
--
-- Antes de esto, todas las tablas tenían `USING (true)`: cualquiera con la
-- publishable key (que está en el JS público) podía leer las finanzas del
-- local, los domicilios y teléfonos de todos los clientes, y borrar pedidos.
-- ============================================================================

-- ¿El JWT que hace la consulta es de un administrador?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(
        current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role',
        ''
    ) = 'admin';
$$ LANGUAGE sql STABLE;

ALTER TABLE public.products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finances        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_recipes ENABLE ROW LEVEL SECURITY;

-- Borramos todas las políticas existentes de estas tablas, así el resultado
-- es el mismo se haya corrido antes lo que se haya corrido.
DO $$
DECLARE pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname, tablename FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('products','orders','order_items','ingredients',
                            'purchases','finances','messages','product_recipes')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- --- MENÚ: lo lee cualquiera, lo edita solo el local ---
CREATE POLICY "Menu publico" ON public.products
    FOR SELECT USING (true);
CREATE POLICY "Admin gestiona productos" ON public.products
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- --- PEDIDOS: el cliente crea y ve los suyos; solo el local los modifica ---
CREATE POLICY "Cliente crea su pedido" ON public.orders
    FOR INSERT WITH CHECK (customer_id = auth.uid()::text OR public.is_admin());
CREATE POLICY "Cliente ve sus pedidos" ON public.orders
    FOR SELECT USING (customer_id = auth.uid()::text OR public.is_admin());
CREATE POLICY "Admin actualiza pedidos" ON public.orders
    FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin borra pedidos" ON public.orders
    FOR DELETE USING (public.is_admin());

-- --- ITEMS: siguen la visibilidad del pedido padre ---
CREATE POLICY "Cliente crea items de su pedido" ON public.order_items
    FOR INSERT WITH CHECK (
        public.is_admin() OR EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND o.customer_id = auth.uid()::text
        )
    );
CREATE POLICY "Cliente ve items de sus pedidos" ON public.order_items
    FOR SELECT USING (
        public.is_admin() OR EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND o.customer_id = auth.uid()::text
        )
    );
CREATE POLICY "Admin actualiza items" ON public.order_items
    FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin borra items" ON public.order_items
    FOR DELETE USING (public.is_admin());

-- --- BACKOFFICE: los números del negocio son solo del local ---
CREATE POLICY "Solo admin insumos" ON public.ingredients
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Solo admin compras" ON public.purchases
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Solo admin finanzas" ON public.finances
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Solo admin recetas" ON public.product_recipes
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- --- CHAT: cada cliente ve solo su conversación ---
-- Requiere sesión iniciada: sin login no hay forma de probar qué conversación
-- es de quién. La app ya pide ingresar antes de abrir el chat.
CREATE POLICY "Cliente ve su chat" ON public.messages
    FOR SELECT USING (customer_id = auth.uid()::text OR public.is_admin());
CREATE POLICY "Cliente escribe en su chat" ON public.messages
    FOR INSERT WITH CHECK (
        (customer_id = auth.uid()::text AND sender_role = 'customer') OR public.is_admin()
    );
CREATE POLICY "Admin actualiza el chat" ON public.messages
    FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin borra el chat" ON public.messages
    FOR DELETE USING (public.is_admin());


-- ============================================================================
-- PASO 4 — VERIFICACIÓN FINAL
-- Todas las tablas deben aparecer con rls_activo = true.
-- mp_integrations y mp_oauth_pending deben tener politicas = 0.
-- ============================================================================

SELECT
    c.relname                AS tabla,
    c.relrowsecurity         AS rls_activo,
    COUNT(p.policyname)      AS politicas
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN ('products','orders','order_items','ingredients','purchases',
                    'finances','messages','product_recipes',
                    'mp_integrations','mp_oauth_pending')
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
