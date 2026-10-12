"use client";

import { useEffect, useMemo, useState } from "react";

type Workspace = { id: string; role: string };
type Moment = { key: string; label: string; description: string };

type ActivationState = {
  workspaces: Workspace[];
  workspace_selection_required: boolean;
  workspace: { id: string } | null;
  product: {
    id: string;
    name: string;
    description: string | null;
    canonical_url: string;
    moments: Array<{ id: string; moment_key: string; label: string; description: string | null }>;
  } | null;
  capabilities: string[];
  setup: { make_money: { exists: boolean; verified: boolean; integration_id: string | null } };
};

class ActivationApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ActivationApiError";
  }
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ActivationApiError(body?.error?.message ?? "Request failed.", response.status);
  }
  return body;
}

// Activation state is a read-only request. Retry transient server/network
// failures, but never retry authorization or input errors and never retry writes.
async function apiWithTransientReadRetry(path: string, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await api(path, { cache: "no-store" });
    } catch (error) {
      const retryable = error instanceof ActivationApiError
        ? error.status === 408 || error.status === 429 || error.status >= 500
        : error instanceof TypeError;
      if (!retryable || attempt === maxAttempts) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error("Unreachable activation state retry state.");
}

function applyActivationState(next: ActivationState, setters: {
  setState: (value: ActivationState) => void;
  setWorkspaceId: (value: string) => void;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setUrl: (value: string) => void;
  setMoments: (value: Moment[]) => void;
  setPublisherKey: (value: string | null) => void;
}) {
  setters.setState(next);
  if (next.workspace?.id) setters.setWorkspaceId(next.workspace.id);
  if (next.product) {
    setters.setName(next.product.name);
    setters.setDescription(next.product.description ?? "");
    setters.setUrl(next.product.canonical_url);
    setters.setMoments(next.product.moments.map((m) => ({
      key: m.moment_key,
      label: m.label,
      description: m.description ?? "",
    })));
  }
  if (next.setup.make_money.integration_id) {
    setters.setPublisherKey(next.setup.make_money.integration_id);
  }
}

export default function ActivatePage() {
  const [state, setState] = useState<ActivationState | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [moments, setMoments] = useState<Moment[]>([{ key: "invoice_created", label: "Invoice Created", description: "" }]);
  const [publisherKey, setPublisherKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [stateLoading, setStateLoading] = useState(true);

  const selectedWorkspace = useMemo(
    () => workspaceId || state?.workspace?.id || "",
    [workspaceId, state?.workspace?.id],
  );

  async function load(id?: string) {
    const query = id ? "?workspace_id=" + encodeURIComponent(id) : "";
    const payload = await apiWithTransientReadRetry("/api/onboarding/state" + query);
    applyActivationState(payload.state as ActivationState, {
      setState,
      setWorkspaceId,
      setName,
      setDescription,
      setUrl,
      setMoments,
      setPublisherKey,
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        // /onboarding may carry a URL-first entry point, but the URL is metadata
        // only. Prefill it in the publisher form without fetching that URL.
        const pendingUrl = new URLSearchParams(window.location.search).get("url");
        if (pendingUrl) setUrl(pendingUrl);

        const payload = await apiWithTransientReadRetry("/api/onboarding/state");
        if (cancelled) return;
        applyActivationState(payload.state as ActivationState, {
          setState,
          setWorkspaceId,
          setName,
          setDescription,
          setUrl,
          setMoments,
          setPublisherKey,
        });
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Gagal memuat aktivasi.");
      } finally {
        if (!cancelled) setStateLoading(false);
      }
    }

    void initialize();
    return () => { cancelled = true; };
  }, []);

  async function retryActivationState() {
    setStateLoading(true);
    setMessage("");
    try {
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal memuat aktivasi.");
    } finally {
      setStateLoading(false);
    }
  }

  function updateMoment(index: number, patch: Partial<Moment>) {
    setMoments((current) => current.map((moment, i) => i === index ? { ...moment, ...patch } : moment));
  }

  async function saveProduct() {
    if (!state) {
      setMessage("Tunggu status aktivasi selesai dimuat, lalu coba lagi.");
      return;
    }
    if (!selectedWorkspace && (state.workspaces?.length ?? 0) > 0) {
      setMessage("Pilih workspace sebelum menyimpan publisher.");
      return;
    }
    if (!url.trim() || !name.trim() || moments.length === 0) {
      setMessage("Isi URL aplikasi, nama aplikasi, dan minimal satu Moment.");
      return;
    }
    const valid = moments.every((m) => /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(m.key.trim()) && m.label.trim());
    if (!valid) {
      setMessage("Moment key harus lower_snake_case, misalnya invoice_created.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const confirmation = await api("/api/products/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: selectedWorkspace,
          url: url.trim(),
          name: name.trim(),
          description: description.trim(),
          moments,
        }),
      });
      // A first-time user may have no workspace yet. The confirmation RPC
      // creates the initial workspace and returns its ID; subsequent writes
      // must use that resolved ID instead of the empty pre-save selection.
      const effectiveWorkspaceId =
        selectedWorkspace || confirmation?.product?.workspace_id;
      if (typeof effectiveWorkspaceId !== "string" || !effectiveWorkspaceId) {
        throw new Error("Publisher saved without a workspace ID.");
      }
      setWorkspaceId(effectiveWorkspaceId);
      await api("/api/workspaces/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: effectiveWorkspaceId, capabilities: ["make_money"] }),
      });
      await load(effectiveWorkspaceId);
      setMessage("Publisher dan Moment tersimpan. Lanjutkan untuk membuat publisher key.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal menyimpan publisher.");
    } finally {
      setBusy(false);
    }
  }

  async function createPublisher() {
    if (!state?.product || !selectedWorkspace) return;
    setBusy(true);
    setMessage("");
    try {
      const payload = await api("/api/integrations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: selectedWorkspace, product_id: state.product.id }),
      });
      setPublisherKey(payload.integration?.id ?? null);
      setMessage("Publisher key siap. Identifier ini publik; credential rahasia tidak ditampilkan.");
      await load(selectedWorkspace);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal membuat publisher key.");
    } finally {
      setBusy(false);
    }
  }

  const script = publisherKey
    ? `<script src="${window.location.origin}/nextaction.js" data-publisher-key="${publisherKey}" defer></script>`
    : "";
  const trigger = `// setelah invoice berhasil dibuat\nshow_ads("invoice_created");`;

  return (
    <main style={{ minHeight: "100vh", background: "#09090b", color: "#f4f4f5", padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>NextAction Activation</h1>
        <p style={{ color: "#a1a1aa", marginBottom: 28 }}>
          Tanpa SDK. Tanpa crawling. Tanpa AI. Publisher menentukan sendiri Moment tempat iklan muncul.
        </p>
        {stateLoading && <p role="status" aria-live="polite" style={{ color: "#a1a1aa" }}>Memuat status aktivasi…</p>}
        {!state && !stateLoading && (
          <button type="button" disabled={busy} onClick={() => void retryActivationState()} style={buttonStyle}>
            Coba muat ulang status aktivasi
          </button>
        )}

        {state && (state.workspaces?.length ?? 0) > 1 && (
          <select
            value={selectedWorkspace}
            onChange={(e) => { setWorkspaceId(e.target.value); void load(e.target.value).catch((error) => setMessage(error.message)); }}
            style={{ width: "100%", padding: 12, marginBottom: 20, background: "#18181b", color: "white", border: "1px solid #3f3f46", borderRadius: 8 }}
          >
            <option value="">Pilih workspace</option>
            {state.workspaces.map((w) => <option key={w.id} value={w.id}>{w.id} · {w.role}</option>)}
          </select>
        )}

        <section style={panelStyle}>
          <h2>1. Publisher & Moments</h2>
          <p style={{ color: "#a1a1aa" }}>URL hanya metadata. NextAction tidak mengunjungi atau membaca URL tersebut.</p>
          <input placeholder="https://invoice-app.com" value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle} />
          <input placeholder="Nama aplikasi" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          <textarea placeholder="Deskripsi singkat" value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inputStyle, minHeight: 70 }} />
          {moments.map((m, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, marginBottom: 8 }}>
              <input placeholder="invoice_created" value={m.key} onChange={(e) => updateMoment(i, { key: e.target.value })} style={inputStyle} />
              <input placeholder="Invoice Created" value={m.label} onChange={(e) => updateMoment(i, { label: e.target.value })} style={inputStyle} />
              <input placeholder="Optional description" value={m.description} onChange={(e) => updateMoment(i, { description: e.target.value })} style={inputStyle} />
              <button type="button" onClick={() => setMoments((current) => current.filter((_, n) => n !== i))} style={buttonStyle}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => setMoments((current) => [...current, { key: "", label: "", description: "" }])} style={buttonStyle}>+ Moment</button>
          <button type="button" disabled={busy || stateLoading || !state} onClick={() => void saveProduct()} style={{ ...buttonStyle, marginLeft: 8 }}>Simpan Publisher</button>
        </section>

        {state?.product && (
          <section style={panelStyle}>
            <h2>2. Publisher Key</h2>
            <p style={{ color: "#a1a1aa" }}>Identifier publik untuk script browser, bukan credential rahasia.</p>
            {!publisherKey
              ? <button type="button" disabled={busy} onClick={() => void createPublisher()} style={buttonStyle}>Buat Publisher Key</button>
              : <>
                  <pre style={preStyle}>{publisherKey}</pre>
                  <pre style={preStyle}>{script}</pre>
                  <p style={{ color: "#a1a1aa" }}>Pasang script sekali di aplikasi publisher.</p>
                </>}
          </section>
        )}

        {publisherKey && (
          <section style={panelStyle}>
            <h2>3. Panggil iklan di action yang tepat</h2>
            <p style={{ color: "#a1a1aa" }}>Contoh: sesudah invoice berhasil dibuat. Gunakan key Moment yang sudah didaftarkan di atas.</p>
            <pre style={preStyle}>{trigger}</pre>
            <p style={{ color: "#a1a1aa" }}>Jika tidak ada offer, iklan akan diam dan tidak mengganggu aplikasi publisher.</p>
          </section>
        )}

        {message && <p style={{ marginTop: 20, color: "#a7f3d0" }}>{message}</p>}
      </div>
    </main>
  );
}

const panelStyle = { background: "#18181b", padding: 24, borderRadius: 16, marginBottom: 20 };
const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: 12, margin: "6px 0", background: "#09090b", color: "white", border: "1px solid #3f3f46", borderRadius: 8 };
const buttonStyle = { padding: "10px 14px", background: "#27272a", color: "white", border: "1px solid #52525b", borderRadius: 8, cursor: "pointer" };
const preStyle = { whiteSpace: "pre-wrap" as const, overflowX: "auto" as const, background: "#09090b", padding: 14, borderRadius: 8, color: "#d4d4d8" };
