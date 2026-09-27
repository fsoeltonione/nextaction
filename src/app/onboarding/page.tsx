"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, Globe, Plus, RefreshCw, ShieldCheck, Target, Trash2, Zap } from "lucide-react";

type Capability = "make_money" | "reach_customers";
type ActivationStep = "url" | "product_understanding" | "intent" | "capability_setup" | "verification" | "ready";

type MomentDraft = { key: string; label: string; description: string };
type ProductDraft = { url: string; name: string; description: string; moments: MomentDraft[] };
type WorkspaceOption = { id: string; role: string };
type ActivationState = {
  step: ActivationStep;
  workspace: { id: string } | null;
  workspaces: WorkspaceOption[];
  workspace_selection_required: boolean;
  product: {
    id: string;
    name: string;
    description: string | null;
    canonical_url: string;
    domain: string;
    understanding_status: string;
    moments: Array<{ id: string; moment_key: string; label: string; description: string | null; status: string }>;
  } | null;
  capabilities: Capability[];
  setup: {
    make_money: { exists: boolean; verified: boolean; integration_id: string | null };
    reach_customers: { configured: boolean; offer_id: string | null };
  };
};

function slugifyMoment(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}
function isGenericMomentKey(key: string): boolean {
  return /^(moment|new_moment|new)_[0-9]+$/.test(key) || ["new", "temp", "thing", "foo"].includes(key);
}
function normalizeDraftMoment(moment: { key?: string; id?: string; label?: string; description?: string }): MomentDraft {
  const label = typeof moment.label === "string" ? moment.label.trim() : "";
  const providedKey = typeof moment.key === "string" ? moment.key.trim() : typeof moment.id === "string" ? moment.id.trim() : "";
  const key = isGenericMomentKey(providedKey) ? slugifyMoment(label) : providedKey;
  return { key, label, description: typeof moment.description === "string" ? moment.description : "" };
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  return response.json().then((body) => {
    if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "message" in body.error && typeof body.error.message === "string") return body.error.message;
    return fallback;
  }).catch(() => fallback);
}

function savePending(url: string, draft: ProductDraft | null) {
  try {
    if (url) sessionStorage.setItem("nextaction.pending_url", url);
    if (draft) sessionStorage.setItem("nextaction.pending_draft", JSON.stringify(draft));
    else sessionStorage.removeItem("nextaction.pending_draft");
  } catch {}
}
function restorePending(): { url: string; draft: ProductDraft | null } {
  try {
    const url = sessionStorage.getItem("nextaction.pending_url") ?? "";
    const raw = sessionStorage.getItem("nextaction.pending_draft");
    const draft = raw ? JSON.parse(raw) as ProductDraft : null;
    return { url, draft };
  } catch { return { url: "", draft: null }; }
}
function clearPending() {
  try { sessionStorage.removeItem("nextaction.pending_url"); sessionStorage.removeItem("nextaction.pending_draft"); } catch {}
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQueryUrl = searchParams.get("url") ?? "";
  const restored = useMemo(() => restorePending(), []);
  const [urlInput, setUrlInput] = useState(initialQueryUrl || restored.url);
  const [draft, setDraft] = useState<ProductDraft | null>(restored.draft);
  const [state, setState] = useState<ActivationState | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);
  const [capabilitySelection, setCapabilitySelection] = useState<Capability[]>([]);
  const [integrationToken, setIntegrationToken] = useState<string | null>(null);
  const [offerForm, setOfferForm] = useState({ title: "", description: "", cta_label: "Learn More", destination_url: "", moment_ids: [] as string[] });
  const [loading, setLoading] = useState(true);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoAnalysisUrlRef = useRef<string | null>(null);

  const applyState = useCallback((nextState: ActivationState) => {
    setState(nextState);
    setWorkspaceOptions(nextState.workspaces ?? []);
    setSelectedWorkspaceId(nextState.workspace?.id ?? null);
    setCapabilitySelection(nextState.capabilities ?? []);
    if (nextState.product) {
      const nextDraft = { url: nextState.product.canonical_url, name: nextState.product.name, description: nextState.product.description ?? "", moments: nextState.product.moments.map((moment) => ({ key: moment.moment_key, label: moment.label, description: moment.description ?? "" })) };
      setDraft(nextDraft);
    }
    setOfferForm((current) => ({ ...current, moment_ids: current.moment_ids.filter((id) => nextState.product?.moments.some((moment) => moment.id === id)) }));
  }, []);

  const loadState = useCallback(async (workspaceId?: string | null): Promise<ActivationState | null> => {
    const query = workspaceId ? "?workspace_id=" + encodeURIComponent(workspaceId) : "";
    const response = await fetch("/api/onboarding/state" + query, { method: "GET", cache: "no-store" });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(await readApiError(response, "Unable to load activation state."));
    const payload = await response.json();
    const nextState = payload.state as ActivationState;
    applyState(nextState);
    return nextState;
  }, [applyState]);

  const runAnalysis = useCallback(async (targetUrl: string) => {
    setAnalysisRunning(true);
    setError(null);
    savePending(targetUrl, draft);
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: targetUrl }) });
      if (!response.ok) throw new Error(await readApiError(response, "Product analysis is temporarily unavailable."));
      const payload = await response.json();
      const analysis = payload.analysis;
      if (!analysis || !Array.isArray(analysis.moments)) throw new Error("The product analysis returned an invalid result.");
      const nextDraft: ProductDraft = { url: typeof analysis.url === "string" && analysis.url ? analysis.url : targetUrl, name: typeof analysis.name === "string" ? analysis.name : "", description: typeof analysis.description === "string" ? analysis.description : "", moments: analysis.moments.map(normalizeDraftMoment) };
      setDraft(nextDraft);
      setUrlInput(nextDraft.url);
      savePending(nextDraft.url, nextDraft);
      router.replace("/onboarding?url=" + encodeURIComponent(nextDraft.url));
      setState((current) => current ? { ...current, step: "product_understanding" } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Product analysis failed.");
      setDraft(null);
      savePending(targetUrl, null);
    } finally { setAnalysisRunning(false); }
  }, [draft, router]);

  useEffect(() => {
    let active = true;
    // This effect synchronizes initial client state with the authenticated server state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadState().catch((err) => { if (active) setError(err instanceof Error ? err.message : "Unable to load activation state."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadState]);

  useEffect(() => {
    if (!urlInput || draft || analysisRunning || autoAnalysisUrlRef.current === urlInput) return;
    autoAnalysisUrlRef.current = urlInput;
    // This effect intentionally starts an async URL-driven analysis; the handler owns the UI state transition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runAnalysis(urlInput);
  }, [analysisRunning, draft, runAnalysis, urlInput]);

  function updateMoment(index: number, patch: Partial<MomentDraft>) {
    setDraft((current) => {
      if (!current) return current;
      const moments = current.moments.slice();
      moments[index] = { ...moments[index], ...patch };
      if (patch.label !== undefined && (!moments[index].key || isGenericMomentKey(moments[index].key))) moments[index].key = slugifyMoment(patch.label);
      const next = { ...current, moments };
      savePending(next.url, next);
      return next;
    });
  }
  function addMoment() {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, moments: [...current.moments, { key: "", label: "", description: "" }] };
      savePending(next.url, next);
      return next;
    });
  }
  function removeMoment(index: number) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, moments: current.moments.filter((_, i) => i !== index) };
      savePending(next.url, next);
      return next;
    });
  }
  function updateProduct(patch: Partial<Pick<ProductDraft, "name" | "description">>) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      savePending(next.url, next);
      return next;
    });
  }

  async function confirmProduct() {
    if (!draft || saving) return;
    const keys = draft.moments.map((moment) => moment.key.trim());
    const invalid = !draft.name.trim() || draft.moments.length < 1 || draft.moments.length > 20 || draft.moments.some((moment) => !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(moment.key.trim()) || !moment.label.trim()) || new Set(keys).size !== keys.length;
    if (invalid) { setError("Every Moment needs a meaningful lower_snake_case key and a label. Duplicate keys are not allowed."); return; }
    setSaving(true); setError(null); savePending(draft.url, draft);
    try {
      const response = await fetch("/api/products/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: selectedWorkspaceId, url: draft.url, name: draft.name, description: draft.description, moments: draft.moments.map((moment) => ({ key: moment.key.trim(), label: moment.label.trim(), description: moment.description.trim() })) }) });
      if (response.status === 401) { router.push("/login?url=" + encodeURIComponent(draft.url)); return; }
      if (!response.ok) throw new Error(await readApiError(response, "Unable to confirm the product."));
      clearPending();
      await loadState(selectedWorkspaceId);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to confirm the product."); }
    finally { setSaving(false); }
  }

  async function saveCapabilities() {
    if (saving || capabilitySelection.length < 1 || !selectedWorkspaceId) { if (!selectedWorkspaceId) setError("Select a workspace before choosing your activation goal."); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/workspaces/capabilities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: selectedWorkspaceId, capabilities: capabilitySelection }) });
      if (!response.ok) throw new Error(await readApiError(response, "Unable to save the activation goal."));
      await loadState(selectedWorkspaceId);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save the activation goal."); }
    finally { setSaving(false); }
  }

  async function createIntegration() {
    if (!state?.product || saving || !selectedWorkspaceId) return;
    setSaving(true); setError(null); setIntegrationToken(null);
    try {
      const response = await fetch("/api/integrations/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: selectedWorkspaceId, product_id: state.product.id }) });
      if (!response.ok) throw new Error(await readApiError(response, "Unable to create the product connection."));
      const payload = await response.json();
      if (typeof payload.credential?.token !== "string") throw new Error("The connection credential was not returned.");
      setIntegrationToken(payload.credential.token);
      await loadState(selectedWorkspaceId);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to create the product connection."); }
    finally { setSaving(false); }
  }

  async function verifyIntegration() {
    if (!integrationToken || verifying || !selectedWorkspaceId) return;
    setVerifying(true); setError(null);
    try {
      const response = await fetch("/api/integrations/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: selectedWorkspaceId, token: integrationToken }) });
      if (!response.ok) throw new Error(await readApiError(response, "Unable to verify the connection credential."));
      setIntegrationToken(null);
      await loadState(selectedWorkspaceId);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to verify the connection credential."); }
    finally { setVerifying(false); }
  }

  async function createOffer() {
    if (!state?.product || saving || !selectedWorkspaceId) return;
    if (!offerForm.title.trim() || !offerForm.destination_url.trim() || offerForm.moment_ids.length < 1) { setError("Add an offer title, destination URL, and at least one Moment."); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/offers/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: selectedWorkspaceId, title: offerForm.title, description: offerForm.description, cta_label: offerForm.cta_label, destination_url: offerForm.destination_url, moment_ids: offerForm.moment_ids }) });
      if (!response.ok) throw new Error(await readApiError(response, "Unable to create the starter offer."));
      await loadState(selectedWorkspaceId);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to create the starter offer."); }
    finally { setSaving(false); }
  }

  if (loading) return <Shell><Spinner /></Shell>;

  const currentStep = state?.step ?? (draft ? "product_understanding" : "url");
  const moments = state?.product?.moments ?? [];
  const isAnonymous = !state;

  return (
    <Shell>
      <div className="w-full max-w-4xl mx-auto px-4 py-10">
        <header className="flex items-center justify-between mb-8"><Link href="/" className="font-bold text-xl text-white">NextAction</Link><div className="text-xs text-neutral-500 uppercase tracking-widest">Activation</div></header>
        {workspaceOptions.length > 1 && <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-4"><label className="block text-sm font-medium text-neutral-300 mb-2">Workspace</label><select value={selectedWorkspaceId ?? ""} onChange={(event) => { const id = event.target.value || null; setSelectedWorkspaceId(id); if (id) void loadState(id); }} className="w-full rounded-xl bg-neutral-950 border border-neutral-700 px-4 py-3 text-white"><option value="">Select a workspace</option>{workspaceOptions.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.id} ({workspace.role})</option>)}</select><p className="text-xs text-neutral-500 mt-2">Workspace membership is checked server-side for every activation mutation.</p></div>}
        {error && <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
        {currentStep === "url" && !draft && <Card icon={<Globe className="w-5 h-5" />} title="Understand your SaaS"><p className="text-neutral-400 mb-5">Enter your public SaaS URL. We analyze it before asking you to sign in.</p><div className="flex gap-2"><input value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="https://your-saas.com" className="flex-1 rounded-xl bg-neutral-950 border border-neutral-700 px-4 py-3 text-white" /><button disabled={!urlInput || analysisRunning} onClick={() => void runAnalysis(urlInput)} className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white disabled:opacity-50">{analysisRunning ? "Analyzing..." : "Analyze"}</button></div></Card>}
        {currentStep === "product_understanding" && draft && <Card icon={<Zap className="w-5 h-5" />} title="Product Understanding"><p className="text-neutral-400 mb-6">Review the proposal. Nothing is persisted until you confirm it.</p><div className="space-y-4"><Field label="Product name"><input value={draft.name} onChange={(event) => updateProduct({ name: event.target.value })} className="input" /></Field><Field label="Description"><textarea value={draft.description} onChange={(event) => updateProduct({ description: event.target.value })} className="input min-h-24" /></Field><div><div className="flex items-center justify-between mb-3"><label className="text-sm font-medium text-neutral-300">Moments</label><button onClick={addMoment} className="text-sm text-indigo-400 flex items-center gap-1"><Plus className="w-4 h-4" /> Add Moment</button></div><div className="space-y-3">{draft.moments.map((moment, index) => <div key={index} className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-2"><div className="flex gap-2"><input value={moment.label} onChange={(event) => updateMoment(index, { label: event.target.value })} placeholder="Moment label" className="input" /><button onClick={() => removeMoment(index)} className="px-3 text-neutral-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button></div><input value={moment.key} onChange={(event) => updateMoment(index, { key: event.target.value })} placeholder="moment_key (lower_snake_case)" className="input font-mono text-sm" /><textarea value={moment.description} onChange={(event) => updateMoment(index, { description: event.target.value })} placeholder="What does this Moment mean?" className="input min-h-16 text-sm" /></div>)}</div></div><div className="flex gap-3 pt-2"><button onClick={() => void runAnalysis(urlInput)} disabled={analysisRunning} className="button-secondary"><RefreshCw className="w-4 h-4" /> Re-analyze</button><button onClick={() => void confirmProduct()} disabled={saving} className="button-primary">{saving ? "Saving..." : isAnonymous ? "Sign in & save" : "Confirm product"}<ArrowRight className="w-4 h-4" /></button></div>{isAnonymous && <p className="text-xs text-neutral-500">Sign-in is required only now because this action persists your Product and Moments.</p>}</div></Card>}
        {currentStep === "intent" && <Card icon={<Target className="w-5 h-5" />} title="What do you want to do?"><p className="text-neutral-400 mb-5">Choose one or both capabilities for this workspace.</p><div className="grid md:grid-cols-2 gap-3 mb-5"><CapabilityButton active={capabilitySelection.includes("make_money")} onClick={() => setCapabilitySelection((current) => current.includes("make_money") ? current.filter((item) => item !== "make_money") : [...current, "make_money"])} title="Make Money" description="Connect moments in your SaaS to commercial opportunities." /><CapabilityButton active={capabilitySelection.includes("reach_customers")} onClick={() => setCapabilitySelection((current) => current.includes("reach_customers") ? current.filter((item) => item !== "reach_customers") : [...current, "reach_customers"])} title="Reach Customers" description="Prepare offers to reach relevant Moments." /></div><button onClick={() => void saveCapabilities()} disabled={saving || capabilitySelection.length < 1} className="button-primary">{saving ? "Saving..." : "Continue"}<ArrowRight className="w-4 h-4" /></button></Card>}
        {currentStep === "capability_setup" && <div className="space-y-5">{capabilitySelection.includes("make_money") && !state?.setup.make_money.exists && <Card icon={<Zap className="w-5 h-5" />} title="Make Money setup"><p className="text-neutral-400 mb-5">Create the NextAction Runtime connection for this Product.</p><button onClick={() => void createIntegration()} disabled={saving} className="button-primary">{saving ? "Creating..." : "Create connection"}<ArrowRight className="w-4 h-4" /></button></Card>}{capabilitySelection.includes("make_money") && state?.setup.make_money.exists && !state.setup.make_money.verified && <Card icon={<ShieldCheck className="w-5 h-5" />} title="Verify connection"><p className="text-neutral-400 mb-4">Paste the credential into your integration, then verify it here.</p>{integrationToken && <div className="rounded-xl bg-neutral-950 border border-neutral-800 p-3 mb-4 font-mono text-xs break-all text-neutral-300">{integrationToken}</div>}<button onClick={() => void verifyIntegration()} disabled={!integrationToken || verifying} className="button-primary">{verifying ? "Verifying..." : "Verify connection"}<Check className="w-4 h-4" /></button></Card>}{capabilitySelection.includes("reach_customers") && !state?.setup.reach_customers.configured && <Card icon={<Target className="w-5 h-5" />} title="Reach Customers setup"><p className="text-neutral-400 mb-5">Create a starter activation offer. This is setup readiness, not final cross-workspace targeting.</p><div className="space-y-3"><Field label="Offer title"><input value={offerForm.title} onChange={(event) => setOfferForm({ ...offerForm, title: event.target.value })} className="input" /></Field><Field label="Destination URL"><input value={offerForm.destination_url} onChange={(event) => setOfferForm({ ...offerForm, destination_url: event.target.value })} className="input" /></Field><Field label="Description"><textarea value={offerForm.description} onChange={(event) => setOfferForm({ ...offerForm, description: event.target.value })} className="input min-h-20" /></Field><div><p className="text-sm text-neutral-400 mb-2">Starter Moments</p><div className="space-y-2">{moments.map((moment) => <label key={moment.id} className="flex items-center gap-2 text-sm text-neutral-300"><input type="checkbox" checked={offerForm.moment_ids.includes(moment.id)} onChange={() => setOfferForm((current) => ({ ...current, moment_ids: current.moment_ids.includes(moment.id) ? current.moment_ids.filter((id) => id !== moment.id) : [...current.moment_ids, moment.id] }))} />{moment.label} <span className="text-neutral-600 font-mono">{moment.moment_key}</span></label>)}</div></div><button onClick={() => void createOffer()} disabled={saving} className="button-primary">{saving ? "Saving..." : "Save starter setup"}<ArrowRight className="w-4 h-4" /></button></div></Card>}</div>}
        {currentStep === "verification" && <Card icon={<ShieldCheck className="w-5 h-5" />} title="Verification"><p className="text-neutral-400 mb-5">The selected Make Money integration exists but has not been verified.</p>{integrationToken && <div className="rounded-xl bg-neutral-950 border border-neutral-800 p-3 mb-4 font-mono text-xs break-all text-neutral-300">{integrationToken}</div>}<button onClick={() => void verifyIntegration()} disabled={!integrationToken || verifying} className="button-primary">{verifying ? "Verifying..." : "Verify connection"}<Check className="w-4 h-4" /></button></Card>}
        {currentStep === "ready" && <Card icon={<Check className="w-5 h-5" />} title="You're ready"><p className="text-neutral-400 mb-5">Activation is complete according to server-derived state.</p><button onClick={() => router.push("/dashboard")} className="button-primary">Go to dashboard<ArrowRight className="w-4 h-4" /></button></Card>}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-neutral-950 text-neutral-50">{children}</main>; }
function Spinner() { return <div className="min-h-screen flex items-center justify-center"><div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>; }
function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) { return <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-6 md:p-8"><div className="flex items-center gap-3 mb-3"><div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">{icon}</div><h1 className="text-2xl font-bold">{title}</h1></div>{children}</section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="block text-sm text-neutral-400 mb-2">{label}</span>{children}</label>; }
function CapabilityButton({ active, onClick, title, description }: { active: boolean; onClick: () => void; title: string; description: string }) { return <button onClick={onClick} className={"text-left rounded-2xl border p-5 transition-colors " + (active ? "border-indigo-500 bg-indigo-500/10" : "border-neutral-800 bg-neutral-950 hover:border-neutral-700")}><div className="font-semibold mb-1">{title}</div><div className="text-sm text-neutral-500">{description}</div></button>; }

export default function OnboardingPage() {
  return <Suspense fallback={<Shell><Spinner /></Shell>}><OnboardingContent /></Suspense>;
}
