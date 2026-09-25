"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Sparkles, Code2, LogOut, Plus, X, Zap, Target, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Tables } from "@/lib/database.types";

type Product = Tables<"products">;
type Moment = Tables<"moments">;
type Offer = Tables<"offers">;
type ProductWithMoments = Product & { moments: Moment[] };
type OfferWithTargets = Offer & { target_moment_ids: string[] };

export default function Dashboard() {
  const searchParams = useSearchParams();
  const initialActiveTab = searchParams.get("intent") === "advertise" ? "advertise" : "monetize";
  const [products, setProducts] = useState<ProductWithMoments[]>([]);
  const [offers, setOffers] = useState<OfferWithTargets[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'monetize' | 'advertise'>(initialActiveTab);

  // Create Offer modal state
  const [showCreateOffer, setShowCreateOffer] = useState(false);
  const [offerForm, setOfferForm] = useState({
    title: '',
    description: '',
    cta_label: 'Learn More',
    destination_url: '',
    moment_ids: [] as string[],
  });
  const [savingOffer, setSavingOffer] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: membership, error: membershipError } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        setLoading(false);
        return;
      }

      if (!membership) { setLoading(false); return; }

      const currentWorkspaceId = membership.workspace_id;
      const [productsResult, offersResult, offerMomentLinksResult] = await Promise.all([
        supabase
          .from('products')
          .select('*, moments(*)')
          .eq('workspace_id', currentWorkspaceId)
          .order('created_at', { ascending: false }),
        supabase
          .from('offers')
          .select('*')
          .eq('workspace_id', currentWorkspaceId)
          .order('created_at', { ascending: false }),
        supabase
          .from('offer_moments')
          .select('offer_id, moment_id'),
      ]);

      const targetIdsByOffer = new Map<string, string[]>();
      for (const link of offerMomentLinksResult.data || []) {
        const current = targetIdsByOffer.get(link.offer_id) || [];
        current.push(link.moment_id);
        targetIdsByOffer.set(link.offer_id, current);
      }

      const offersWithTargets = (offersResult.data || []).map((offer) => ({
        ...offer,
        target_moment_ids: targetIdsByOffer.get(offer.id) || [],
      }));

      setProducts((productsResult.data || []) as ProductWithMoments[]);
      setOffers(offersWithTargets as OfferWithTargets[]);
      setLoading(false);
    }
    loadData();
  }, [router, supabase]);

  // Gather all moments from all products for the offer targeting
  const allMoments = products.flatMap((product) => product.moments);
  const momentById = new Map<string, Moment>(allMoments.map((moment) => [moment.id, moment]));

  const handleCreateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingOffer(true);
    try {
      const res = await fetch('/api/offers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offerForm),
      });
      if (res.ok) {
        const { offer } = (await res.json()) as { offer: Offer };
        setOffers(prev => [
          { ...offer, target_moment_ids: offer.target_moments ?? [] },
          ...prev,
        ]);
        setShowCreateOffer(false);
        setOfferForm({ title: '', description: '', cta_label: 'Learn More', destination_url: '', moment_ids: [] });
      }
    } finally {
      setSavingOffer(false);
    }
  };

  const toggleMoment = (momentId: string) => {
    setOfferForm(prev => ({
      ...prev,
      moment_ids: prev.moment_ids.includes(momentId)
        ? prev.moment_ids.filter(id => id !== momentId)
        : [...prev.moment_ids, momentId]
    }));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  if (loading) return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 selection:bg-indigo-500/30">
      {/* Navbar */}
      <nav className="border-b border-neutral-900 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center justify-between px-8 py-4 max-w-7xl mx-auto">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            NextAction
          </Link>
          <button onClick={handleLogout} className="text-sm text-neutral-400 hover:text-white transition-colors flex items-center gap-2">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-8 py-12">
        {/* Tabs */}
        <div className="flex items-center gap-2 mb-10 border-b border-neutral-800">
          <button
            onClick={() => setActiveTab('monetize')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'monetize' ? 'border-indigo-500 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
          >
            <Zap className="w-4 h-4" /> Monetize
          </button>
          <button
            onClick={() => setActiveTab('advertise')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'advertise' ? 'border-indigo-500 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
          >
            <Target className="w-4 h-4" /> Reach Customers
          </button>
        </div>

        {/* ===== MONETIZE TAB ===== */}
        {activeTab === 'monetize' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-white mb-1">Your Products</h1>
                <p className="text-neutral-400 text-sm">Install the tracking snippet to start monetizing moments.</p>
              </div>
              <Link href="/onboarding" className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold transition-colors">
                <Plus className="w-4 h-4" /> Add Product
              </Link>
            </div>

            {products.length === 0 ? (
              <div className="text-center py-24 border border-dashed border-neutral-800 rounded-3xl">
                <p className="text-neutral-500 mb-4">No products yet.</p>
                <Link href="/" className="text-indigo-400 hover:underline text-sm">← Analyze a product to get started</Link>
              </div>
            ) : (
              <div className="grid gap-6">
                {products.map(product => (
                  <div key={product.id} className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8">
                    <div className="flex items-center gap-3 mb-6">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`https://s2.googleusercontent.com/s2/favicons?domain=${product.domain}&sz=64`} alt="" className="w-6 h-6 rounded" />
                      <h2 className="text-2xl font-bold text-white">{product.name}</h2>
                      <span className="px-2 py-0.5 text-xs font-mono text-neutral-400 bg-neutral-950 border border-neutral-800 rounded">{product.domain}</span>
                    </div>
                    <p className="text-neutral-400 text-sm mb-6">{product.description}</p>

                    <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-4">Registered Moments</h3>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {product.moments.map((m) => (
                        <div key={m.id} className="bg-neutral-950 border border-neutral-800/50 rounded-xl p-4 hover:border-indigo-500/30 transition-colors group">
                          <div className="flex items-center gap-2 mb-3">
                            <Code2 className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="font-medium text-neutral-200 text-sm">{m.label}</span>
                          </div>
                          <div className="bg-black/50 p-2.5 rounded-lg overflow-x-auto">
                            <code className="text-xs font-mono text-emerald-400 whitespace-nowrap">
                              {"nextaction.track('" + m.moment_key + "', uid)"}
                            </code>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== ADVERTISE TAB ===== */}
        {activeTab === 'advertise' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
              <div>
                <h1 className="text-3xl font-bold text-white mb-1">Campaigns</h1>
                <p className="text-neutral-400 text-sm">Create offers to reach users at key moments across our network.</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="px-4 py-2 bg-neutral-900 border border-neutral-800 rounded-xl text-sm">
                  Balance: <span className="text-emerald-400 font-semibold">$25.00</span>
                </div>
                <button
                  onClick={() => setShowCreateOffer(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-neutral-200 text-neutral-900 rounded-xl text-sm font-bold transition-colors"
                >
                  <Plus className="w-4 h-4" /> Create Offer
                </button>
              </div>
            </div>

            {offers.length === 0 ? (
              <div className="text-center py-24 border border-dashed border-neutral-800 rounded-3xl bg-neutral-900/30">
                <div className="w-14 h-14 bg-neutral-900 border border-neutral-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Target className="w-7 h-7 text-neutral-600" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">No active campaigns</h3>
                <p className="text-neutral-500 text-sm max-w-xs mx-auto mb-6">Create your first offer to start reaching users at commercial moments inside other SaaS products.</p>
                <button
                  onClick={() => setShowCreateOffer(true)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  Create your first Offer
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {offers.map(offer => (
                  <div key={offer.id} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-white">{offer.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${offer.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-neutral-700 text-neutral-400'}`}>{offer.status}</span>
                      </div>
                      <p className="text-sm text-neutral-400 mb-3">{offer.description}</p>
                      <div className="flex flex-wrap gap-2">
                        {offer.target_moment_ids?.map((momentId: string) => {
                          const moment = momentById.get(momentId);
                          return (
                            <span key={momentId} className="text-xs font-mono px-2 py-1 bg-neutral-950 border border-neutral-700 rounded text-indigo-300">
                              {moment?.moment_key || momentId}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-neutral-500 mb-1">Budget</p>
                      <p className="font-bold text-white">${(offer.budget_cents / 100).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ===== CREATE OFFER MODAL ===== */}
      {showCreateOffer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-3xl p-8 relative shadow-2xl animate-in zoom-in-95 duration-200">
            <button onClick={() => setShowCreateOffer(false)} className="absolute top-4 right-4 p-2 text-neutral-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-white mb-6">Create New Offer</h2>

            <form onSubmit={handleCreateOffer} className="space-y-5">
              <div>
                <label className="block text-xs text-neutral-400 font-medium mb-1.5">Offer Title</label>
                <input
                  required
                  placeholder="e.g. Try our invoice automation tool"
                  value={offerForm.title}
                  onChange={e => setOfferForm(p => ({ ...p, title: e.target.value }))}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-neutral-100 text-sm placeholder:text-neutral-600 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 font-medium mb-1.5">Description <span className="text-neutral-600">(optional)</span></label>
                <textarea
                  rows={2}
                  placeholder="Short tagline or value proposition..."
                  value={offerForm.description}
                  onChange={e => setOfferForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-neutral-100 text-sm placeholder:text-neutral-600 outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-neutral-400 font-medium mb-1.5">CTA Label</label>
                  <input
                    placeholder="Learn More"
                    value={offerForm.cta_label}
                    onChange={e => setOfferForm(p => ({ ...p, cta_label: e.target.value }))}
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-neutral-100 text-sm placeholder:text-neutral-600 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 font-medium mb-1.5">CTA URL</label>
                  <input
                    required
                    placeholder="https://yourproduct.com"
                    value={offerForm.destination_url}
                    onChange={e => setOfferForm(p => ({ ...p, destination_url: e.target.value }))}
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-neutral-100 text-sm placeholder:text-neutral-600 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-neutral-400 font-medium mb-2">
                  Target Moments <span className="text-neutral-600">(select which moments trigger this offer)</span>
                </label>
                {allMoments.length === 0 ? (
                  <p className="text-xs text-neutral-500 italic">No moments found. Add a product under the Monetize tab first.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allMoments.map((m) => (
                      <button
                        type="button"
                        key={m.moment_key}
                        onClick={() => toggleMoment(m.id)}
                        className={`text-xs font-mono px-3 py-1.5 rounded-lg border transition-all ${offerForm.moment_ids.includes(m.id) ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-neutral-950 border-neutral-700 text-neutral-400 hover:border-neutral-500'}`}
                      >
                        {m.moment_key}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={savingOffer || offerForm.moment_ids.length === 0}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-3 font-semibold text-sm transition-all disabled:opacity-50"
                >
                  {savingOffer ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <><ChevronRight className="w-4 h-4" /> Launch Offer</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
