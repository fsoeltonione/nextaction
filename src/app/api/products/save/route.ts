import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (!user) {
      console.error("Auth Error in save route:", userError);
      return NextResponse.json({ error: "Unauthorized", details: userError }, { status: 401 });
    }

    const { domain, name, description, moments, intent } = await request.json();

    if (!domain || !name || !moments || !Array.isArray(moments)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // 1. Get or create a workspace for the user
    let { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!workspace) {
      const { data: newWorkspace, error: wsError } = await supabase
        .from('workspaces')
        .insert({ name: 'My Workspace', user_id: user.id })
        .select('id')
        .single();
      
      if (wsError) throw wsError;
      workspace = newWorkspace;
    }

    // 2. Check if product already exists
    let { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('workspace_id', workspace.id)
      .eq('domain', domain)
      .single();

    if (!product) {
      const { data: newProduct, error: productError } = await supabase
        .from('products')
        .insert({
          workspace_id: workspace.id,
          domain,
          name,
          description
        })
        .select('id')
        .single();
      
      if (productError) throw productError;
      product = newProduct;
    }

    // 3. Insert moments (upserting based on product_id and moment_key)
    const momentsToInsert = moments.map((m: any) => ({
      product_id: product.id,
      moment_key: m.id,
      label: m.label
    }));

    const { error: momentsError } = await supabase
      .from('moments')
      .upsert(momentsToInsert, { onConflict: 'product_id, moment_key' });

    if (momentsError) throw momentsError;

    return NextResponse.json({ success: true, product_id: product.id });
  } catch (error: any) {
    console.error("Error saving product:", error);
    return NextResponse.json({ error: error.message || "Failed to save product" }, { status: 500 });
  }
}
