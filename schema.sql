-- Create workspaces table
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create products table
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create moments table
CREATE TABLE IF NOT EXISTS public.moments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    moment_key TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(product_id, moment_key)
);

-- Create offers table
CREATE TABLE IF NOT EXISTS public.offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    cta_label TEXT NOT NULL DEFAULT 'Learn More',
    cta_url TEXT NOT NULL,
    target_moments TEXT[] NOT NULL DEFAULT '{}',
    budget_cents INTEGER NOT NULL DEFAULT 2500,
    spent_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'exhausted')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

-- Policies for workspaces
CREATE POLICY "Users can view their own workspaces" ON public.workspaces FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own workspaces" ON public.workspaces FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policies for products
CREATE POLICY "Users can view products in their workspaces" ON public.products FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));
CREATE POLICY "Users can insert products in their workspaces" ON public.products FOR INSERT WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- Policies for moments
CREATE POLICY "Users can view moments in their products" ON public.moments FOR SELECT USING (product_id IN (SELECT p.id FROM public.products p JOIN public.workspaces w ON p.workspace_id = w.id WHERE w.user_id = auth.uid()));
CREATE POLICY "Users can insert moments in their products" ON public.moments FOR INSERT WITH CHECK (product_id IN (SELECT p.id FROM public.products p JOIN public.workspaces w ON p.workspace_id = w.id WHERE w.user_id = auth.uid()));

-- Policies for offers
CREATE POLICY "Users can view their own offers" ON public.offers FOR SELECT USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));
CREATE POLICY "Users can insert their own offers" ON public.offers FOR INSERT WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));
CREATE POLICY "Users can update their own offers" ON public.offers FOR UPDATE USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));
