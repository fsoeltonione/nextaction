"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Globe,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

const CAPABILITIES = ["make_money", "reach_customers"] as const;
type Capability = (typeof CAPABILITIES)[number];

type ActivationStep =
  | "url"
  | "product_understanding"
  | "intent"
  | "capability_setup"
  | "verification"
  | "ready";

type MomentDraft = {
  key: string;
  label: string;
  description: string;
};

type ProductDraft = {
  url: string;
  name: string;
  description: string;
  moments: MomentDraft[];
};

type ActivationState = {
  step: ActivationStep;
  workspace: { id: string } | null;
  product:
    | {
        id: string;
        name: string;
        description: string | null;
        canonical_url: string;
        domain: string;
        understanding_status: string;
        moments: Array<{
          id: string;
          moment_key: string;
          label: string;
          description: string | null;
          status: string;
        }>;
      }
    | null;
  capabilities: Capability[];
  setup: {
    make_money: {
      exists: boolean;
      verified: boolean;
      integration_id: string | null;
    };
    reach_customers: {
      configured: boolean;
      offer_id: string | null;
    };
  };
};

type ProductState = NonNullable<ActivationState["product"]>;

function toMomentDrafts(moments: ProductState["moments"]): MomentDraft[] {
  return moments.map((moment) => ({
    key: moment.moment_key,
    label: moment.label,
    description: moment.description ?? "",
  }));
}

function slugifyMoment(label: string, fallback: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return slug || fallback;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  return response
    .json()
    .then((body) => {
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        body.error &&
        typeof body.error === "object" &&
        "message" in body.error &&
        typeof body.error.message === "string"
      ) {
        return body.error.message;
      }
      return fallback;
    })
    .catch(() => fallback);
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const initialUrl = searchParams.get("url") ?? "";

  const [state, setState] = useState<ActivationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [capabilitySelection, setCapabilitySelection] = useState<Capability[]>([]);
  const [integrationToken, setIntegrationToken] = useState<string | null>(null);
  const [offerForm, setOfferForm] = useState({
    title: "",
    description: "",
    cta_label: "Learn More",
    destination_url: "",
    moment_ids: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const analysisStarted = useRef(false);

  const loadState = useCallback(async () => {
    const response = await fetch("/api/onboarding/state", {
      method: "GET",
      cache: "no-store",
    });

    if (response.status === 401) {
      const suffix = initialUrl ? "?url=" + encodeURIComponent(initialUrl) : "";
      router.replace("/login" + suffix);
      return null;
    }

    if (!response.ok) {
      throw new Error(
        await readApiError(response, "Unable to load activation state."),
      );
    }

    const payload = await response.json();
    const nextState = payload.state as ActivationState;

    setState(nextState);
    setCapabilitySelection(nextState.capabilities);

    if (nextState.product) {
      setDraft({
        url: nextState.product.canonical_url,
        name: nextState.product.name,
        description: nextState.product.description ?? "",
        moments: toMomentDrafts(nextState.product.moments),
      });
    }

    setOfferForm((current) => {
      const availableMomentIds =
        nextState.product?.moments.map((moment) => moment.id) ?? [];
      const kept = current.moment_ids.filter((id) =>
        availableMomentIds.includes(id),
      );

      return {
        ...current,
        moment_ids:
          kept.length > 0
            ? kept
            : availableMomentIds.length > 0
              ? [availableMomentIds[0]]
              : [],
      };
    });

    return nextState;
  }, [initialUrl, router]);

  useEffect(() => {
    let active = true;

    loadState()
      .catch((err) => {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load activation state.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadState]);

  const runAnalysis = useCallback(async (targetUrl: string) => {
    setAnalysisRunning(true);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            "Product analysis is temporarily unavailable.",
          ),
        );
      }

      const payload = await response.json();
      const analysis = payload.analysis;

      if (!analysis || !Array.isArray(analysis.moments)) {
        throw new Error("The product analysis returned an invalid result.");
      }

      setDraft({
        url: analysis.url || targetUrl,
        name: typeof analysis.name === "string" ? analysis.name : "",
        description:
          typeof analysis.description === "string" ? analysis.description : "",
        moments: analysis.moments.map(
          (moment: {
            key?: string;
            id?: string;
            label?: string;
            description?: string;
          }) => ({
            key: moment.key || moment.id || "",
            label: moment.label || "",
            description: moment.description || "",
          }),
        ),
      });

      setState((current) =>
        current
          ? {
              ...current,
              step: "product_understanding",
            }
          : current,
      );
    } catch (err) {
      setDraft(null);
      setUrlInput(targetUrl);
      setState((current) =>
        current
          ? { ...current, step: "url" }
          : current,
      );
      setError(err instanceof Error ? err.message : "Product analysis failed.");
    } finally {
      setAnalysisRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!state || !initialUrl || analysisStarted.current) {
      return;
    }

    const hasDifferentProduct =
      !state.product || state.product.canonical_url !== initialUrl;

    if (!hasDifferentProduct) return;

    analysisStarted.current = true;
    setDraft(null);
    setState((current) =>
      current
        ? { ...current, step: "product_understanding" }
        : current,
    );
    void runAnalysis(initialUrl);
  }, [initialUrl, runAnalysis, state]);

  function updateMoment(index: number, patch: Partial<MomentDraft>) {
    setDraft((current) => {
      if (!current) return current;
      const moments = current.moments.slice();
      moments[index] = { ...moments[index], ...patch };
      return { ...current, moments };
    });
  }

  function addMoment() {
    setDraft((current) => {
      if (!current) return current;

      const used = new Set(current.moments.map((moment) => moment.key));
      let fallback = "moment_1";
      let index = 1;

      while (used.has(fallback)) {
        index += 1;
        fallback = "moment_" + index;
      }

      const label = "New Moment";

      return {
        ...current,
        moments: [
          ...current.moments,
          {
            key: slugifyMoment(label, fallback),
            label,
            description: "",
          },
        ],
      };
    });
  }

  function removeMoment(index: number) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        moments: current.moments.filter((_, itemIndex) => itemIndex !== index),
      };
    });
  }

  async function confirmProduct() {
    if (!draft || saving) return;

    const keys = draft.moments.map((moment) => moment.key.trim());

    const invalid =
      !draft.name.trim() ||
      draft.moments.length < 1 ||
      draft.moments.length > 20 ||
      draft.moments.some(
        (moment) =>
          !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(moment.key.trim()) ||
          !moment.label.trim(),
      ) ||
      new Set(keys).size !== keys.length;

    if (invalid) {
      setError(
        "Please fix the product name and Moment definitions before continuing.",
      );
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/products/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: draft.url,
          name: draft.name,
          description: draft.description,
          moments: draft.moments.map((moment) => ({
            key: moment.key.trim(),
            label: moment.label.trim(),
            description: moment.description.trim(),
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Unable to confirm the product."),
        );
      }

      await loadState();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to confirm the product.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveCapabilities() {
    if (saving || capabilitySelection.length < 1) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/workspaces/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilities: capabilitySelection }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Unable to save the activation goal."),
        );
      }

      await loadState();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save the activation goal.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function createIntegration() {
    if (!state?.product || saving) return;

    setSaving(true);
    setError(null);
    setIntegrationToken(null);

    try {
      const response = await fetch("/api/integrations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: state.product.id }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            "Unable to create the product connection.",
          ),
        );
      }

      const payload = await response.json();
      const token =
        typeof payload.credential?.token === "string"
          ? payload.credential.token
          : null;

      if (!token) {
        throw new Error("The connection credential was not returned.");
      }

      setIntegrationToken(token);
      await loadState();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create the product connection.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function verifyIntegration() {
    if (!integrationToken || verifying) return;

    setVerifying(true);
    setError(null);

    try {
      const response = await fetch("/api/integrations/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: integrationToken }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            "Unable to verify the connection credential.",
          ),
        );
      }

      setIntegrationToken(null);
      await loadState();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to verify the connection credential.",
      );
    } finally {
      setVerifying(false);
    }
  }

  function toggleOfferMoment(momentId: string) {
    setOfferForm((current) => ({
      ...current,
      moment_ids: current.moment_ids.includes(momentId)
        ? current.moment_ids.filter((id) => id !== momentId)
        : [...current.moment_ids, momentId],
    }));
  }

  async function createOffer() {
    if (!state?.product || saving) return;

    if (
      !offerForm.title.trim() ||
      !offerForm.destination_url.trim() ||
      offerForm.moment_ids.length < 1
    ) {
      setError("Add an offer title, destination URL, and at least one Moment.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/offers/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: offerForm.title,
          description: offerForm.description,
          cta_label: offerForm.cta_label,
          destination_url: offerForm.destination_url,
          moment_ids: offerForm.moment_ids,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Unable to create the offer."),
        );
      }

      await loadState();
      setOfferForm((current) => ({
        ...current,
        title: "",
        description: "",
        destination_url: "",
      }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create the offer.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  function renderHeader(step: ActivationStep) {
    const index =
      step === "url"
        ? 1
        : step === "product_understanding"
          ? 2
          : step === "intent"
            ? 3
            : step === "capability_setup"
              ? 4
              : step === "verification"
                ? 5
                : 6;

    return (
      <div className="mb-10">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <p className="text-indigo-400 text-xs font-semibold uppercase tracking-[0.18em]">
              Activation
            </p>
            <p className="text-neutral-500 text-xs mt-1">Step {index} of 6</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-neutral-500 hover:text-white transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {Array.from({ length: 6 }, (_, itemIndex) => (
            <div
              key={itemIndex}
              className={
                "h-1 rounded-full " +
                (itemIndex < index ? "bg-indigo-500" : "bg-neutral-800")
              }
            />
          ))}
        </div>
      </div>
    );
  }

  function renderUrlStep() {
    return (
      <section className="text-center">
        <div className="w-14 h-14 mx-auto bg-neutral-900 border border-neutral-800 rounded-2xl flex items-center justify-center mb-6">
          <Globe className="w-7 h-7 text-indigo-400" />
        </div>
        <h1 className="text-4xl font-bold text-white">What are we activating?</h1>
        <p className="text-neutral-400 max-w-xl mx-auto mt-3 mb-10">
          Start with your SaaS URL. We use it to build product understanding that you can review before anything is saved.
        </p>

        <div className="max-w-xl mx-auto space-y-3">
          <input
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="https://your-saas.com"
            disabled={analysisRunning}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-2xl px-5 py-4 text-white outline-none focus:border-indigo-500/60 focus:ring-4 focus:ring-indigo-500/10"
          />
          <button
            onClick={() => {
              analysisStarted.current = true;
              void runAnalysis(urlInput);
            }}
            disabled={!urlInput.trim() || analysisRunning}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-2xl py-4 font-semibold transition-colors"
          >
            {analysisRunning ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Understanding product...
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </section>
    );
  }

  function renderProductStep() {
    if (!draft) return null;

    return (
      <section>
        <button
          onClick={() => {
            setDraft(null);
            setUrlInput("");
            setError(null);
            analysisStarted.current = false;
            setState((current) =>
              current
                ? { ...current, step: "url" }
                : current,
            );
            router.replace("/onboarding");
          }}
          className="flex items-center gap-2 text-sm text-neutral-500 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Change URL
        </button>

        <div className="flex items-start gap-4 mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Review the product understanding</h1>
            <p className="text-neutral-400 text-sm mt-2 break-all">{draft.url}</p>
          </div>
        </div>

        <div className="space-y-6">
          <label className="block">
            <span className="text-sm font-medium text-neutral-300">Product name</span>
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              className="mt-2 w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/60"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-neutral-300">Description</span>
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              rows={4}
              className="mt-2 w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/60 resize-none"
            />
          </label>

          <div>
            <div className="flex items-center justify-between gap-4 mb-3">
              <div>
                <h2 className="font-semibold text-white">Moments</h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Review, remove, or add the Moments your product can expose.
                </p>
              </div>
              <button
                onClick={addMoment}
                disabled={draft.moments.length >= 20}
                className="flex items-center gap-2 px-3 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 rounded-lg text-sm text-white"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>

            <div className="space-y-3">
              {draft.moments.map((moment, index) => (
                <div
                  key={index}
                  className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 grid gap-3 md:grid-cols-2">
                      <input
                        value={moment.label}
                        onChange={(event) =>
                          updateMoment(index, { label: event.target.value })
                        }
                        placeholder="Moment label"
                        className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-white outline-none focus:border-indigo-500/60"
                      />
                      <input
                        value={moment.key}
                        onChange={(event) =>
                          updateMoment(index, { key: event.target.value })
                        }
                        placeholder="moment_key"
                        className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-white font-mono text-sm outline-none focus:border-indigo-500/60"
                      />
                    </div>
                    <button
                      onClick={() => removeMoment(index)}
                      disabled={draft.moments.length <= 1}
                      className="p-2 text-neutral-600 hover:text-red-400 disabled:opacity-30"
                      aria-label="Remove moment"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <textarea
                    value={moment.description}
                    onChange={(event) =>
                      updateMoment(index, { description: event.target.value })
                    }
                    rows={2}
                    placeholder="What does this Moment mean?"
                    className="mt-3 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500/60 resize-none"
                  />
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={confirmProduct}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl py-4 font-semibold"
          >
            {saving ? "Saving..." : "Confirm product"}
            {!saving && <Check className="w-5 h-5" />}
          </button>
        </div>
      </section>
    );
  }

  function renderIntentStep() {
    const cards = [
      {
        value: "make_money" as const,
        icon: Zap,
        title: "Make Money",
        description: "Show relevant offers inside your SaaS when users reach valuable Moments.",
      },
      {
        value: "reach_customers" as const,
        icon: Target,
        title: "Reach Customers",
        description: "Create offers that can appear in relevant Moments across the network.",
      },
      {
        value: "both" as const,
        icon: Sparkles,
        title: "Both",
        description: "Use both sides of the network with the same workspace.",
      },
    ];

    return (
      <section>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">What do you want to do?</h1>
          <p className="text-neutral-400 mt-2">
            Choose how this workspace should participate in NextAction.
          </p>
        </div>

        <div className="grid gap-4">
          {cards.map((card) => {
            const active =
              card.value === "both"
                ? capabilitySelection.length === 2
                : capabilitySelection.length === 1 &&
                  capabilitySelection[0] === card.value;

            const Icon = card.icon;

            return (
              <button
                key={card.value}
                onClick={() =>
                  setCapabilitySelection(
                    card.value === "both" ? [...CAPABILITIES] : [card.value],
                  )
                }
                className={
                  "text-left p-5 rounded-2xl border transition-colors " +
                  (active
                    ? "border-indigo-500 bg-indigo-500/10"
                    : "border-neutral-800 bg-neutral-900 hover:border-neutral-700")
                }
              >
                <div className="flex items-start gap-4">
                  <div
                    className={
                      "w-11 h-11 rounded-xl flex items-center justify-center " +
                      (active ? "bg-indigo-500/20" : "bg-neutral-950")
                    }
                  >
                    <Icon className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-white">{card.title}</h2>
                      {active && <Check className="w-4 h-4 text-indigo-400" />}
                    </div>
                    <p className="text-sm text-neutral-400 mt-1">{card.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={saveCapabilities}
          disabled={saving || capabilitySelection.length === 0}
          className="w-full mt-6 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl py-4 font-semibold"
        >
          {saving ? "Saving..." : "Continue"}
          {!saving && <ArrowRight className="w-5 h-5" />}
        </button>
      </section>
    );
  }

  function renderMakeMoneySetup() {
    if (!state?.product || !state.capabilities.includes("make_money")) return null;

    const exists = state.setup.make_money.exists;
    const verified = state.setup.make_money.verified;

    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <Code2 className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-white">Make Money</h2>
            <p className="text-sm text-neutral-400 mt-1">
              Create a server-side integration credential for {state.product.name}.
            </p>
          </div>
          {verified && <Check className="w-5 h-5 text-emerald-400" />}
        </div>

        {verified ? (
          <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300">
            Credential setup is verified. Live runtime tracking and offer delivery are enabled in a later stage.
          </div>
        ) : !exists ? (
          <button
            onClick={createIntegration}
            disabled={saving}
            className="mt-5 w-full flex items-center justify-center gap-2 bg-white hover:bg-neutral-200 disabled:opacity-50 text-neutral-900 rounded-xl py-3 font-semibold"
          >
            {saving ? "Creating credential..." : "Create connection credential"}
            {!saving && <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <div className="mt-5">
            {integrationToken ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-sm font-semibold text-amber-200">Copy this token now</p>
                  <p className="text-xs text-neutral-400 mt-1">
                    It is returned only during credential creation. Keep it server-side and never ship it to a browser bundle.
                  </p>
                  <div className="mt-3 bg-neutral-950 rounded-lg border border-neutral-800 p-3 font-mono text-xs break-all text-neutral-200">
                    {integrationToken}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">
                    Server-side request shape
                  </p>
                  <pre className="text-xs text-neutral-300 overflow-x-auto whitespace-pre-wrap">
{\`POST /v1/track
Authorization: Bearer <YOUR_NEXTACTION_TOKEN>
Idempotency-Key: <EVENT_ID>
Content-Type: application/json

{"type":"invoice.created","data":{}}\`}
                  </pre>
                </div>

                <button
                  onClick={verifyIntegration}
                  disabled={verifying}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl py-3 font-semibold"
                >
                  {verifying ? "Verifying..." : "Verify setup"}
                  <ShieldCheck className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                <p className="text-sm text-neutral-300">
                  A credential already exists but its plaintext token is not retained by the browser.
                </p>
                <button
                  onClick={createIntegration}
                  disabled={saving}
                  className="mt-3 flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4" />
                  Generate a new credential
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderReachCustomersSetup() {
    if (!state?.product || !state.capabilities.includes("reach_customers")) return null;

    const configured = state.setup.reach_customers.configured;

    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <Target className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-white">Reach Customers</h2>
            <p className="text-sm text-neutral-400 mt-1">
              Create the first offer and connect it to one or more active Moments.
            </p>
          </div>
          {configured && <Check className="w-5 h-5 text-emerald-400" />}
        </div>

        {configured ? (
          <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300">
            An active offer is configured for this product's Moments.
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <input
              value={offerForm.title}
              onChange={(event) =>
                setOfferForm({ ...offerForm, title: event.target.value })
              }
              placeholder="Offer title"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/60"
            />
            <textarea
              value={offerForm.description}
              onChange={(event) =>
                setOfferForm({ ...offerForm, description: event.target.value })
              }
              placeholder="Short offer description"
              rows={3}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/60 resize-none"
            />
            <div className="grid md:grid-cols-2 gap-3">
              <input
                value={offerForm.cta_label}
                onChange={(event) =>
                  setOfferForm({ ...offerForm, cta_label: event.target.value })
                }
                placeholder="CTA label"
                className="bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/60"
              />
              <input
                value={offerForm.destination_url}
                onChange={(event) =>
                  setOfferForm({
                    ...offerForm,
                    destination_url: event.target.value,
                  })
                }
                placeholder="https://your-landing-page.com"
                className="bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/60"
              />
            </div>

            <div>
              <p className="text-sm font-medium text-neutral-300 mb-2">Target Moments</p>
              <div className="grid gap-2">
                {state.product.moments.map((moment) => {
                  const selected = offerForm.moment_ids.includes(moment.id);
                  return (
                    <button
                      key={moment.id}
                      onClick={() => toggleOfferMoment(moment.id)}
                      className={
                        "flex items-center justify-between gap-4 p-3 rounded-xl border text-left transition-colors " +
                        (selected
                          ? "border-indigo-500 bg-indigo-500/10"
                          : "border-neutral-800 bg-neutral-950 hover:border-neutral-700")
                      }
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{moment.label}</p>
                        <p className="text-xs text-neutral-500 font-mono mt-0.5">
                          {moment.moment_key}
                        </p>
                      </div>
                      {selected && <Check className="w-4 h-4 text-indigo-400" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={createOffer}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-white hover:bg-neutral-200 disabled:opacity-50 text-neutral-900 rounded-xl py-3 font-semibold"
            >
              {saving ? "Creating offer..." : "Create first offer"}
              {!saving && <ArrowRight className="w-4 h-4" />}
            </button>

            <p className="text-xs text-neutral-500">
              MVP activation does not require live billing. Capacity and payment setup come later.
            </p>
          </div>
        )}
      </div>
    );
  }

  function renderSetupStep() {
    return (
      <section>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Set up your selected capabilities</h1>
          <p className="text-neutral-400 mt-2">
            Finish each setup item that belongs to this workspace.
          </p>
        </div>

        <div className="space-y-4">
          {renderMakeMoneySetup()}
          {renderReachCustomersSetup()}
        </div>
      </section>
    );
  }

  function renderVerificationStep() {
    return (
      <section>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Verify the setup</h1>
          <p className="text-neutral-400 mt-2">
            Confirm the Make Money credential configuration before activation becomes ready.
          </p>
        </div>

        {renderMakeMoneySetup()}

        {state?.setup.make_money.exists &&
          !state.setup.make_money.verified &&
          !integrationToken && (
            <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-neutral-300">
                The previous token is not retained by the browser. Generate a new credential to complete this verification step.
              </p>
              <button
                onClick={createIntegration}
                disabled={saving}
                className="mt-4 flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
              >
                <RefreshCw className="w-4 h-4" />
                Generate new credential
              </button>
            </div>
          )}
      </section>
    );
  }

  function renderReadyStep() {
    return (
      <section className="text-center">
        <div className="w-16 h-16 mx-auto bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center mb-6">
          <Check className="w-8 h-8 text-emerald-400" />
        </div>
        <p className="text-emerald-400 text-xs font-semibold uppercase tracking-[0.18em] mb-3">
          Activation complete
        </p>
        <h1 className="text-4xl font-bold text-white">Your workspace is ready.</h1>
        <p className="text-neutral-400 max-w-lg mx-auto mt-3">
          Product understanding, capability selection, and the required activation setup are now stored in server state.
        </p>

        <div className="grid md:grid-cols-2 gap-3 mt-8 text-left">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <p className="text-xs uppercase tracking-wider text-neutral-500">Product</p>
            <p className="text-white font-medium mt-1">{state?.product?.name}</p>
            <p className="text-xs text-neutral-500 mt-1 break-all">{state?.product?.canonical_url}</p>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <p className="text-xs uppercase tracking-wider text-neutral-500">Capabilities</p>
            <p className="text-white font-medium mt-1">
              {state?.capabilities
                .map((capability) =>
                  capability === "make_money" ? "Make Money" : "Reach Customers",
                )
                .join(" + ")}
            </p>
          </div>
        </div>

        <button
          onClick={() => router.replace("/dashboard")}
          className="w-full mt-8 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-4 font-semibold"
        >
          Open dashboard
          <ArrowRight className="w-5 h-5" />
        </button>
      </section>
    );
  }

  function renderCurrentStep() {
    if (!state) return null;

    if (analysisRunning) {
      return (
        <section className="text-center py-14">
          <div className="w-16 h-16 mx-auto bg-neutral-900 border border-neutral-800 rounded-2xl flex items-center justify-center mb-6">
            <Sparkles className="w-8 h-8 text-indigo-400 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-white">Understanding your product...</h1>
          <p className="text-neutral-500 mt-2">
            We are preparing proposed product and Moment definitions for your review.
          </p>
        </section>
      );
    }

    switch (state.step) {
      case "url":
        return renderUrlStep();
      case "product_understanding":
        return draft ? renderProductStep() : renderUrlStep();
      case "intent":
        return renderIntentStep();
      case "capability_setup":
        return renderSetupStep();
      case "verification":
        return renderVerificationStep();
      case "ready":
        return renderReadyStep();
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currentStep = state?.step ?? "url";

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50">
      <nav className="border-b border-neutral-900">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-bold">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            NextAction
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-neutral-500 hover:text-white flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-10 md:py-14">
        {renderHeader(currentStep)}

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {renderCurrentStep()}
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
