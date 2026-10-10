"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, Copy, Globe, Plus, RefreshCw, ShieldCheck, Target, Trash2, Zap } from "lucide-react";
import { normalizeProductUrl } from "@/lib/url";

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
  const initialWorkspaceId = searchParams.get("workspace_id");
  const isAddProductMode = searchParams.get("mode") === "add_product";
  const restored = useMemo(() => restorePending(), []);
  const initialFlowUrl = isAddProductMode ? initialQueryUrl : initialQueryUrl || restored.url;
  const initialFlowDraft = isAddProductMode ? null : restored.draft;
  const [urlInput, setUrlInput] = useState(initialFlowUrl);
  const [hostname, setHostname] = useState(() => {
    try { return normalizeProductUrl(initialFlowUrl).hostname; } catch { return ""; }
  });
  const [isValidUrl, setIsValidUrl] = useState(() => {
    try { normalizeProductUrl(initialFlowUrl); return Boolean(initialFlowUrl); } catch { return false; }
  });
  const [draft, setDraft] = useState<ProductDraft | null>(initialFlowDraft);
  const [state, setState] = useState<ActivationState | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);
  const [capabilitySelection, setCapabilitySelection] = useState<Capability[]>([]);
  const [integrationToken, setIntegrationToken] = useState<string | null>(null);
  const [offerForm, setOfferForm] = useState({ title: "", description: "", cta_label: "Learn More", destination_url: "", moment_ids: [] as string[] });
  const [loading, setLoading] = useState(true);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingConnection, setRefreshingConnection] = useState(false);
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoAnalysisUrlRef = useRef<string | null>(null);
  const initialAutoAnalysisUrlRef = useRef(initialFlowUrl);
  const loadStateRequestRef = useRef(0);

  const applyState = useCallback((nextState: ActivationState) => {
    setState(nextState);
    setWorkspaceOptions(nextState.workspaces ?? []);
    setSelectedWorkspaceId(nextState.workspace?.id ?? null);
    setCapabilitySelection(nextState.capabilities ?? []);
    setDraft((currentDraft) => {
      if (isAddProductMode) return currentDraft;
      if (currentDraft && (!nextState.product || currentDraft.url !== nextState.product.canonical_url)) {
        return currentDraft;
      }
      if (!nextState.product) return currentDraft;
      if (nextState.step !== "product_understanding") return null;
      return {
        url: nextState.product.canonical_url,
        name: nextState.product.name,
        description: nextState.product.description ?? "",
        moments: nextState.product.moments.map((moment) => ({
          key: moment.moment_key,
          label: moment.label,
          description: moment.description ?? "",
        })),
      };
    });
    setOfferForm((current) => ({ ...current, moment_ids: current.moment_ids.filter((id) => nextState.product?.moments.some((moment) => moment.id === id)) }));
  }, [isAddProductMode]);

  const loadState = useCallback(async (workspaceId?: string | null): Promise<ActivationState | null> => {
    const requestSequence = ++loadStateRequestRef.current;
    const query = workspaceId ? "?workspace_id=" + encodeURIComponent(workspaceId) : "";
    const response = await fetch("/api/onboarding/state" + query, { method: "GET", cache: "no-store" });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(await readApiError(response, "Unable to load activation state."));
    const payload = await response.json();
    if (requestSequence !== loadStateRequestRef.current) return null;
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
      const nextPath = "/onboarding?url=" + encodeURIComponent(nextDraft.url) + (selectedWorkspaceId ? "&workspace_id=" + encodeURIComponent(selectedWorkspaceId) : "") + (isAddProductMode ? "&mode=add_product" : "");
      router.replace(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Product analysis failed.");
      setDraft(null);
      savePending(targetUrl, null);
    } finally { setAnalysisRunning(false); }
  }, [draft, isAddProductMode, router, selectedWorkspaceId]);

  useEffect(() => {
    let active = true;
    // This effect synchronizes initial client state with the authenticated server state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadState(initialWorkspaceId).catch((err) => { if (active) setError(err instanceof Error ? err.message : "Unable to load activation state."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [initialWorkspaceId, loadState]);

  useEffect(() => {
    if (loading || !urlInput || draft || analysisRunning || autoAnalysisUrlRef.current === urlInput) return;
    // Only auto-analyze a URL that was seeded when this onboarding view mounted.
    // Manual typing from the URL field must wait for the explicit Analyze action.
    if (urlInput !== initialAutoAnalysisUrlRef.current) return;
    if (state?.product?.canonical_url === urlInput) return;

    autoAnalysisUrlRef.current = urlInput;
    // Defer the async action until after the current effect completes so React does not
    // treat the effect as synchronously cascading into local state updates.
    const timer = window.setTimeout(() => {
      void runAnalysis(urlInput);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [analysisRunning, draft, loading, runAnalysis, state?.product?.canonical_url, urlInput]);

  function handleUrlChange(value: string) {
    setUrlInput(value);
    try {
      const normalized = normalizeProductUrl(value);
      setHostname(normalized.hostname);
      setIsValidUrl(true);
    } catch {
      setHostname("");
      setIsValidUrl(false);
    }
  }

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
      if (response.status === 401) {
        const loginPath = "/login?url=" + encodeURIComponent(draft.url) + (selectedWorkspaceId ? "&workspace_id=" + encodeURIComponent(selectedWorkspaceId) : "") + (isAddProductMode ? "&mode=add_product" : "");
        router.push(loginPath);
        return;
      }
      if (!response.ok) throw new Error(await readApiError(response, "Unable to confirm the product."));
      autoAnalysisUrlRef.current = draft.url;
      if (isAddProductMode) {
        clearPending();
        setDraft(null);
        router.replace("/dashboard?workspace_id=" + encodeURIComponent(selectedWorkspaceId ?? ""));
        return;
      }
      const nextState = await loadState(selectedWorkspaceId);
      if (!nextState) throw new Error("Unable to load activation state after confirming the product.");
      clearPending();
      setDraft(null);
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
    setSaving(true); setError(null); setIntegrationToken(null); setIntegrationNotice(null);
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

  async function copyIntegrationCredential() {
    if (!integrationToken) return;
    try {
      await navigator.clipboard.writeText(integrationToken);
      setError(null);
      setIntegrationNotice("Credential copied. Store it in your SaaS backend environment; never commit it or expose it in browser code.");
    } catch {
      setError("Clipboard access was blocked. Select and copy the credential manually.");
    }
  }

  const connectionSnippet = `export async function verifyNextActionConnection() {
  const baseUrl = process.env.NEXTACTION_API_BASE_URL;
  const token = process.env.NEXTACTION_INTEGRATION_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("Set NEXTACTION_API_BASE_URL and NEXTACTION_INTEGRATION_TOKEN on your server.");
  }

  const response = await fetch(new URL("/v1/connection/verify", baseUrl), {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
  });
  const payload = await response.json();

  if (!response.ok || payload?.verified !== true) {
    throw new Error(payload?.error?.message ?? "NextAction connection verification failed.");
  }

  return payload;
};
  async function copyConnectionSnippet() {
    try {
      await navigator.clipboard.writeText(connectionSnippet);
      setError(null);
      setIntegrationNotice("Server-side code copied. Configure both environment variables before running it.");
    } catch {
      setError("Clipboard access was blocked. Select and copy the server code manually.");
    }
  }

  async function refreshConnectionStatus() {
    if (!selectedWorkspaceId || refreshingConnection) return;
    setRefreshingConnection(true);
    setError(null);
    setIntegrationNotice(null);
    try {
      const nextState = await loadState(selectedWorkspaceId);
      if (!nextState) throw new Error("Unable to refresh connection status.");
      if (nextState.setup.make_money.verified) {
        setIntegrationToken(null);
        setIntegrationNotice("Connection verified: NextAction received an authenticated request from your runtime.");
      } else {
        setIntegrationNotice("No successful server-side verification request has been received yet.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh connection status.");
    } finally {
      setRefreshingConnection(false);
    }
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

  const hasPendingProposal =
    draft != null && (!state?.product || draft.url !== state.product.canonical_url);
  const currentStep = hasPendingProposal ? "product_understanding" : isAddProductMode ? "url" : state?.step ?? "url";
  const moments = state?.product?.moments ?? [];

  const connectionInstructions = (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
        <div className="mb-2 text-sm font-medium text-neutral-200">Server credential</div>
        {integrationToken ? (
          <>
            <div className="mb-3 break-all rounded-lg bg-black p-3 font-mono text-xs text-neutral-200">{integrationToken}</div>
            <button onClick={() => void copyIntegrationCredential()} className="btn-secondary">
              <Copy className="h-4 w-4" />Copy credential
            </button>
          </>
        ) : (
          <p className="text-sm text-neutral-400">The credential is only shown when issued. If you did not save it, issue a replacement credential below.</p>
        )}
        <p className="mt-3 text-xs text-amber-200">Keep this secret on your server. Never put it in a client component, public JavaScript, HTML, or a public repository.</p>
      </div>

      <div className="rounded-xl border border-neutral-800 p-4">
        <div className="mb-2 text-sm font-medium text-neutral-200">1. Add backend environment variables</div>
        <pre className="overflow-x-auto rounded-lg bg-black p-3 text-xs text-neutral-300">{'NEXTACTION_API_BASE_URL=YOUR_NEXTACTION_DEPLOYMENT_URL\nNEXTACTION_INTEGRATION_TOKEN=YOUR_SECRET_TOKEN'}</pre>
        <p className="mt-2 text-xs text-neutral-500">Use the HTTPS URL of the NextAction deployment you are connecting to. Set the real credential as a server-only secret.</p>
      </div>

      <div className="rounded-xl border border-neutral-800 p-4">
        <div className="mb-2 text-sm font-medium text-neutral-200">2. Verify from your backend</div>
        <p className="mb-3 text-sm text-neutral-400">Run this server-side code from your application backend, not from a browser or client component.</p>
        <pre className="max-h-72 overflow-x-auto rounded-lg bg-black p-3 text-xs text-neutral-300">{connectionSnippet}</pre>
        <button onClick={() => void copyConnectionSnippet()} className="btn-secondary mt-3">
          <Copy className="h-4 w-4" />Copy server code
        </button>
      </div>

      {integrationNotice && <p className="text-sm text-emerald-300">{integrationNotice}</p>}

      <div className="flex flex-wrap gap-2">
        <button disabled={saving || !selectedWorkspaceId} onClick={() => void createIntegration()} className="btn-secondary">
          Issue new credential
        </button>
        <button disabled={refreshingConnection || !selectedWorkspaceId} onClick={() => void refreshConnectionStatus()} className="btn">
          <RefreshCw className="h-4 w-4" />{refreshingConnection ? "Checking..." : "Refresh connection status"}
        </button>
      </div>
    </div>
  );

  return (
    <Shell>
      <div className="w-full max-w-4xl mx-auto px-4 py-10">
        <header className="flex items-center justify-between mb-8"><Link href="/" className="font-bold text-xl text-white">NextAction</Link><div className="text-xs text-neutral-500 uppercase tracking-widest">Activation</div></header>
        {workspaceOptions.length > 1 && <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-4"><label className="block text-sm font-medium text-neutral-300 mb-2">Workspace</label><select value={selectedWorkspaceId ?? ""} onChange={(event) => { const id = event.target.value || null; setSelectedWorkspaceId(id); if (id) void loadState(id); }} className="w-full rounded-xl bg-neutral-950 border border-neutral-700 px-4 py-3 text-white"><option value="">Select a workspace</option>{workspaceOptions.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.id} · {workspace.role}</option>)}</select></div>}
        {error && <div className="mb-6 rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>}
        <div className="mb-8 flex items-center gap-2 text-xs text-neutral-500">{["url", "product_understanding", "intent", "capability_setup", "verification", "ready"].map((step, index) => <div key={step} className={currentStep === step ? "text-white" : ""}>{index + 1}. {step.replaceAll("_", " ")}</div>)}</div>
        {currentStep === "url" && <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-8"><div className="mb-6 flex items-center gap-3"><Globe className="h-5 w-5" /><h1 className="text-2xl font-semibold text-white">Connect your SaaS</h1></div><p className="mb-6 text-neutral-400">Paste your SaaS URL. NextAction will understand the product before asking you to configure activation.</p><div className="flex gap-3"><div className="relative flex flex-1 items-center">{hostname ? (<img src={"https://s2.googleusercontent.com/s2/favicons?domain=" + hostname + "&sz=64"} alt="" className="pointer-events-none absolute left-4 h-5 w-5 rounded-sm" />) : (<Globe className="pointer-events-none absolute left-4 h-5 w-5 text-neutral-500" />)}<input value={urlInput} onChange={(event) => handleUrlChange(event.target.value)} disabled={analysisRunning} placeholder="https://your-saas.com" className={"w-full rounded-2xl border bg-neutral-900 py-4 pl-12 pr-4 text-neutral-100 placeholder:text-neutral-600 outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 disabled:opacity-50 " + (urlInput.length > 3 && !isValidUrl ? "border-red-500/70" : "border-neutral-800")} /></div><button disabled={!isValidUrl || analysisRunning} onClick={() => { if (isValidUrl) void runAnalysis(urlInput); }} className="btn">{analysisRunning ? "Analyzing..." : "Analyze"}<ArrowRight className="h-4 w-4" /></button></div>{urlInput.length > 3 && !isValidUrl && <p className="mt-2 text-sm text-red-400">Enter a public HTTP or HTTPS SaaS URL.</p>}</section>}
        {currentStep === "product_understanding" && draft && <section className="space-y-6"><div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-8"><div className="mb-6 flex items-center gap-3"><ShieldCheck className="h-5 w-5" /><h1 className="text-2xl font-semibold text-white">Confirm product understanding</h1></div><Field label="Product name"><input value={draft.name} onChange={(event) => updateProduct({ name: event.target.value })} className="input" /></Field><Field label="Description"><textarea value={draft.description} onChange={(event) => updateProduct({ description: event.target.value })} className="input min-h-24" /></Field><div className="mt-6 space-y-4">{draft.moments.map((moment, index) => <div key={`${index}-${moment.key}`} className="rounded-2xl border border-neutral-800 p-4"><div className="grid gap-4 md:grid-cols-3"><Field label="Moment key"><input value={moment.key} onChange={(event) => updateMoment(index, { key: event.target.value })} className="input" /></Field><Field label="Label"><input value={moment.label} onChange={(event) => updateMoment(index, { label: event.target.value })} className="input" /></Field><Field label="Description"><input value={moment.description} onChange={(event) => updateMoment(index, { description: event.target.value })} className="input" /></Field></div><button onClick={() => removeMoment(index)} className="mt-3 text-sm text-neutral-400"><Trash2 className="inline h-4 w-4 mr-1" />Remove</button></div>)}</div><div className="mt-6 flex items-center justify-between"><button onClick={addMoment} className="btn-secondary"><Plus className="h-4 w-4" />Add Moment</button><button disabled={saving} onClick={() => void confirmProduct()} className="btn">{saving ? "Saving..." : "Confirm product"}<ArrowRight className="h-4 w-4" /></button></div></div></section>}
        {currentStep === "intent" && <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-8"><div className="mb-6 flex items-center gap-3"><Target className="h-5 w-5" /><h1 className="text-2xl font-semibold text-white">Choose your goal</h1></div><p className="mb-6 text-neutral-400">Choose how this workspace will use NextAction.</p><div className="grid gap-4 md:grid-cols-3">{(["make_money", "reach_customers"] as Capability[]).map((capability) => <button key={capability} onClick={() => setCapabilitySelection((current) => current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability])} className={capabilitySelection.includes(capability) ? "rounded-2xl border border-white bg-white/10 p-5 text-left" : "rounded-2xl border border-neutral-800 p-5 text-left"}><div className="font-medium text-white">{capability === "make_money" ? "Make money" : "Reach customers"}</div><div className="mt-2 text-sm text-neutral-400">{capability === "make_money" ? "Connect your product so NextAction can recognize moments." : "Prepare starter offers for relevant moments."}</div></button>)}<button onClick={() => setCapabilitySelection((current) => current.length === 2 ? [] : ["make_money", "reach_customers"])} className={capabilitySelection.length === 2 ? "rounded-2xl border border-white bg-white/10 p-5 text-left" : "rounded-2xl border border-neutral-800 p-5 text-left"}><div className="font-medium text-white">Both</div><div className="mt-2 text-sm text-neutral-400">Enable both capabilities.</div></button></div><button disabled={saving || capabilitySelection.length < 1} onClick={() => void saveCapabilities()} className="btn mt-6">Save goal<ArrowRight className="h-4 w-4" /></button></section>}
        {currentStep === "capability_setup" && state && (
          <section className="grid gap-6 md:grid-cols-2">
            {state.capabilities.includes("make_money") && (
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-8">
                <div className="mb-4 flex items-center gap-3">
                  <Zap className="h-5 w-5" />
                  <h2 className="text-xl font-semibold text-white">Make Money</h2>
                </div>
                <p className="mb-5 text-sm text-neutral-400">Install the server integration and verify a real authenticated runtime request.</p>
                {!state.setup.make_money.exists && (
                  <button disabled={saving || !selectedWorkspaceId} onClick={() => void createIntegration()} className="btn">
                    Create connection
                  </button>
                )}
                {state.setup.make_money.exists && !state.setup.make_money.verified && connectionInstructions}
                {state.setup.make_money.verified && (
                  <div className="text-sm text-green-300 flex items-center gap-2">
                    <Check className="h-4 w-4" />Verified
                  </div>
                )}
              </div>
            )}

            {state.capabilities.includes("reach_customers") && (
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-8">
                <div className="mb-4 flex items-center gap-3">
                  <Target className="h-5 w-5" />
                  <h2 className="text-xl font-semibold text-white">Reach Customers</h2>
                </div>
                <p className="mb-5 text-sm text-neutral-400">Create a starter offer for the product moments. This is activation setup, not final network targeting.</p>
                {!state.setup.reach_customers.configured ? (
                  <div className="space-y-3">
                    <input value={offerForm.title} onChange={(event) => setOfferForm({ ...offerForm, title: event.target.value })} placeholder="Offer title" className="input" />
                    <textarea value={offerForm.description} onChange={(event) => setOfferForm({ ...offerForm, description: event.target.value })} placeholder="Offer description" className="input min-h-24" />
                    <input value={offerForm.destination_url} onChange={(event) => setOfferForm({ ...offerForm, destination_url: event.target.value })} placeholder="https://..." className="input" />
                    <div className="space-y-2">
                      {moments.map((moment) => (
                        <label key={moment.id} className="flex items-center gap-2 text-sm text-neutral-300">
                          <input
                            type="checkbox"
                            checked={offerForm.moment_ids.includes(moment.id)}
                            onChange={() =>
                              setOfferForm((current) => ({
                                ...current,
                                moment_ids: current.moment_ids.includes(moment.id)
                                  ? current.moment_ids.filter((id) => id !== moment.id)
                                  : [...current.moment_ids, moment.id],
                              }))
                            }
                          />
                          {moment.label}
                        </label>
                      ))}
                    </div>
                    <button disabled={saving || !selectedWorkspaceId} onClick={() => void createOffer()} className="btn">
                      Create starter offer
                    </button>
                  </div>
                ) : (
                  <div className="text-sm text-green-300 flex items-center gap-2">
                    <Check className="h-4 w-4" />Starter offer configured
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {currentStep === "verification" && state && <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-8"><div className="mb-6 flex items-center gap-3"><RefreshCw className="h-5 w-5" /><h1 className="text-2xl font-semibold text-white">Verify your server connection</h1></div><p className="mb-6 text-neutral-400">Install the credential on your SaaS backend and execute the verification request there. NextAction will show success only after it receives the authenticated runtime request.</p>{connectionInstructions}</section>}
        {currentStep === "ready" && <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-8"><div className="mb-6 flex items-center gap-3"><Check className="h-5 w-5" /><h1 className="text-2xl font-semibold text-white">You are ready</h1></div><p className="mb-6 text-neutral-400">Your activation is complete.</p><button onClick={() => router.push("/dashboard?workspace_id=" + encodeURIComponent(selectedWorkspaceId ?? ""))} className="btn">Open dashboard<ArrowRight className="h-4 w-4" /></button></section>}
      </div>
    </Shell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-sm text-neutral-400">{label}</span>{children}</label>; }
function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-black text-white">{children}</main>; }
function Spinner() { return <div className="min-h-screen grid place-items-center text-neutral-400">Loading...</div>; }

export default function OnboardingPage() { return <Suspense fallback={<Shell><Spinner /></Shell>}><OnboardingContent /></Suspense>; }
