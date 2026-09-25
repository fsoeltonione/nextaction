import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { title, description, cta_label, cta_url, target_moments } = await request.json();

    if (!title || !cta_url || !target_moments?.length) {
      return NextResponse.json({ error: "title, cta_url, and target_moments are required" }, { status: 400 });
    }

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!workspace) return NextResponse.json({ error: "No workspace found" }, { status: 404 });

    const { data: offer, error } = await supabase
      .from('offers')
      .insert({
        workspace_id: workspace.id,
        title,
        description,
        cta_label: cta_label || 'Learn More',
        cta_url,
        target_moments,
        budget_cents: 2500, // $25 free credit
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, offer });
  } catch (err: any) {
    console.error("Error creating offer:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
