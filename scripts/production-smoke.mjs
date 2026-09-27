import { createHash } from "node:crypto";

const baseUrl = process.env.PRODUCTION_BASE_URL;
const supabaseUrl = process.env.PRODUCTION_NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.PRODUCTION_SUPABASE_SECRET_KEY;

const required = {
  PRODUCTION_BASE_URL: baseUrl,
  PRODUCTION_NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  PRODUCTION_SUPABASE_SECRET_KEY: supabaseSecretKey,
};

const missing = Object.entries(required)
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(
    `Missing required production smoke environment variables: ${missing.join(", ")}`,
  );
  process.exit(2);
}

const base = new URL(baseUrl);
const supabase = new URL(supabaseUrl);

if (base.protocol !== "https:") {
  console.error("PRODUCTION_BASE_URL must use HTTPS.");
  process.exit(2);
}

if (supabase.protocol !== "https:") {
  console.error("PRODUCTION_NEXT_PUBLIC_SUPABASE_URL must use HTTPS.");
  process.exit(2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function appRequest(path, options = {}) {
  return fetch(new URL(path, base), {
    redirect: "manual",
    ...options,
    headers: {
      ...(options.headers ?? {}),
      "cache-control": "no-store",
    },
  });
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(new URL(path, supabase), {
    ...options,
    headers: {
      apikey: supabaseSecretKey,
      Authorization: `Bearer ${supabaseSecretKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      `Supabase request failed: HTTP ${response.status} ${path}`,
    );
  }

  return body;
}

async function insert(table, rows) {
  const body = await supabaseRequest(`/rest/v1/${table}?select=*`, {
    method: "POST",
    headers: {
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });

  if (!Array.isArray(body)) {
    throw new Error(`Unexpected insert response for ${table}`);
  }

  return body;
}

async function deleteByIds(table, column, ids) {
  if (ids.length === 0) return;
  const encoded = ids.map((id) => `"${id.replaceAll('"', '""')}"`).join(",");
  await supabaseRequest(
    `/rest/v1/${table}?${column}=in.(${encoded})`,
    {
      method: "DELETE",
    },
  );
}

async function getRows(path) {
  const body = await supabaseRequest(path, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!Array.isArray(body)) {
    throw new Error(`Expected array response for ${path}`);
  }
  return body;
}

async function waitFor(fn, timeoutMs, intervalMs, description) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${description}`);
}

const smokeId = crypto.randomUUID().replaceAll("-", "");
const smokeEventType = `production_smoke_${smokeId.slice(0, 24)}`;
const momentKey = smokeEventType;
const destinationUrl =
  `https://example.com/?nextaction_production_smoke=${smokeId}`;
const publisherWorkspaceIds = [];
const advertiserWorkspaceIds = [];
const created = {
  workspaces: [],
  workspaceMembers: [],
  capabilities: [],
  products: [],
  moments: [],
  integrations: [],
  integrationSecrets: [],
  offers: [],
  offerMoments: [],
  events: [],
  occurrences: [],
  decisions: [],
  deliveries: [],
  clicks: [],
  qualifiedClicks: [],
  settlements: [],
  creditEntries: [],
  creditAccounts: [],
  financialEntries: [],
  financialAccounts: [],
};

let testUserId = null;

try {
  console.log("Production runtime smoke: starting isolated fixture.");

  const health = await appRequest("/api/health");
  if (health.status !== 200) {
    throw new Error(`Production health expected HTTP 200, got ${health.status}`);
  }

  const healthBody = await health.json();
  if (
    healthBody?.status !== "ok" ||
    healthBody?.service !== "nextaction" ||
    healthBody?.environment !== "production"
  ) {
    throw new Error("Production health returned unexpected deployment identity.");
  }

  console.log("Production health: OK");

  const existingMembers = await getRows(
    "/rest/v1/workspace_members?select=user_id&order=created_at.asc&limit=1",
  );

  testUserId = existingMembers[0]?.user_id;
  if (typeof testUserId !== "string" || testUserId.length === 0) {
    throw new Error(
      "Production smoke requires at least one existing authenticated user to create an isolated temporary workspace.",
    );
  }

  const workspaces = await insert("workspaces", [
    {
      name: `__nextaction_smoke_publisher_${smokeId.slice(0, 12)}`,
      user_id: testUserId,
      created_by: testUserId,
    },
    {
      name: `__nextaction_smoke_advertiser_${smokeId.slice(0, 12)}`,
      user_id: testUserId,
      created_by: testUserId,
    },
  ]);

  if (workspaces.length !== 2) {
    throw new Error("Production smoke did not create exactly two workspaces.");
  }

  created.workspaces = workspaces.map((row) => row.id);
  publisherWorkspaceIds.push(workspaces[0].id);
  advertiserWorkspaceIds.push(workspaces[1].id);

  const members = await insert(
    "workspace_members",
    workspaces.map((workspace) => ({
      workspace_id: workspace.id,
      user_id: testUserId,
      role: "owner",
    })),
  );
  created.workspaceMembers = members.map((row) => ({
    workspace_id: row.workspace_id,
    user_id: row.user_id,
  }));

  const capabilities = await insert("workspace_capabilities", [
    {
      workspace_id: publisherWorkspaceIds[0],
      capability: "make_money",
      status: "active",
    },
    {
      workspace_id: advertiserWorkspaceIds[0],
      capability: "reach_customers",
      status: "active",
    },
  ]);
  created.capabilities = capabilities.map((row) => ({
    workspace_id: row.workspace_id,
    capability: row.capability,
  }));

  const products = await insert("products", [
    {
      workspace_id: publisherWorkspaceIds[0],
      domain: "example.com",
      name: `Production Smoke Publisher ${smokeId.slice(0, 8)}`,
      description: "Ephemeral production smoke fixture.",
      canonical_url: "https://example.com",
      understanding_status: "confirmed",
    },
  ]);
  created.products = products.map((row) => row.id);

  const moments = await insert("moments", [
    {
      product_id: products[0].id,
      moment_key: momentKey,
      label: "Production Smoke Moment",
      description: "Ephemeral production smoke fixture moment.",
      status: "active",
    },
  ]);
  created.moments = moments.map((row) => row.id);

  const integrationToken = `na_prod_smoke_${smokeId}`;
  const integrations = await insert("integrations", [
    {
      product_id: products[0].id,
      name: `Production Smoke Integration ${smokeId.slice(0, 8)}`,
      status: "active",
    },
  ]);
  created.integrations = integrations.map((row) => row.id);

  await insert("integration_secrets", [
    {
      integration_id: integrations[0].id,
      credential_hash: sha256(integrationToken),
    },
  ]);
  created.integrationSecrets = [integrations[0].id];

  const offers = await insert("offers", [
    {
      workspace_id: advertiserWorkspaceIds[0],
      title: `Production Smoke Offer ${smokeId.slice(0, 8)}`,
      description: "Ephemeral production smoke fixture offer.",
      cta_label: "Open smoke destination",
      cta_url: destinationUrl,
      target_moments: [momentKey],
      budget_cents: 100,
      spent_cents: 0,
      status: "active",
      destination_url: destinationUrl,
    },
  ]);
  created.offers = offers.map((row) => row.id);

  await insert("offer_moments", [
    {
      offer_id: offers[0].id,
      moment_id: moments[0].id,
    },
  ]);
  created.offerMoments = [
    {
      offer_id: offers[0].id,
      moment_id: moments[0].id,
    },
  ];

  const creditAccounts = await insert("advertiser_credit_accounts", [
    {
      workspace_id: advertiserWorkspaceIds[0],
      granted_units: 1,
      consumed_units: 0,
      available_units: 1,
    },
  ]);
  created.creditAccounts = creditAccounts.map((row) => row.workspace_id);

  const creditEntries = await insert("advertiser_credit_entries", [
    {
      workspace_id: advertiserWorkspaceIds[0],
      entry_type: "grant",
      units: 1,
      reference_id: null,
    },
  ]);
  created.creditEntries = creditEntries.map((row) => row.id);

  console.log("Production smoke fixture provisioned.");

  const idempotencyKey = `production-smoke-${smokeId}`;
  const trackBody = JSON.stringify({
    type: smokeEventType,
    occurred_at: new Date().toISOString(),
    data: {
      smoke_id: smokeId,
      purpose: "production-runtime-smoke",
    },
  });

  const track = await appRequest("/v1/track", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integrationToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: trackBody,
  });

  if (track.status !== 202) {
    throw new Error(`Production track expected HTTP 202, got ${track.status}`);
  }

  const trackBodyJson = await track.json();
  if (!trackBodyJson?.accepted || !trackBodyJson?.event_id) {
    throw new Error("Production track returned an invalid acceptance response.");
  }
  created.events = [trackBodyJson.event_id];

  const trackReplay = await appRequest("/v1/track", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integrationToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: trackBody,
  });

  if (trackReplay.status !== 202) {
    throw new Error(
      `Production track replay expected HTTP 202, got ${trackReplay.status}`,
    );
  }

  const trackReplayBody = await trackReplay.json();
  if (
    !trackReplayBody?.idempotent_replay ||
    trackReplayBody.event_id !== trackBodyJson.event_id
  ) {
    throw new Error("Production track replay did not return the original Event.");
  }

  console.log("Production Event acceptance + idempotency: OK");

  const offer = await waitFor(
    async () => {
      const response = await appRequest("/v1/offer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${integrationToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          moment_key: momentKey,
          context: {
            source: "production-smoke",
            smoke_id: smokeId,
          },
        }),
      });

      if (response.status !== 200) {
        return null;
      }

      const body = await response.json();
      if (typeof body?.delivery?.token !== "string") {
        return null;
      }

      return body;
    },
    90_000,
    2_000,
    "Decision → Delivery",
  );

  const deliveryToken = offer.delivery.token;
  console.log("Production Decision → Delivery: OK");

  const clickPath = `/v1/click/${encodeURIComponent(deliveryToken)}`;
  const firstClick = await appRequest(clickPath);

  if (firstClick.status !== 302) {
    throw new Error(
      `Production first click expected HTTP 302, got ${firstClick.status}`,
    );
  }

  const location = firstClick.headers.get("location");
  if (location !== destinationUrl) {
    throw new Error("Production first click returned the wrong destination.");
  }

  const replayClick = await appRequest(clickPath);
  if (replayClick.status !== 302) {
    throw new Error(
      `Production replay click expected HTTP 302, got ${replayClick.status}`,
    );
  }

  if (replayClick.headers.get("location") !== location) {
    throw new Error("Production replay click changed its redirect destination.");
  }

  console.log("Production Click + replay redirect: OK");

  const eventRows = await waitFor(
    async () => {
      const rows = await getRows(
        `/rest/v1/events?select=id,processing_status&integration_id=eq.${encodeURIComponent(
          integrations[0].id,
        )}`,
      );

      return rows.length === 1 && rows[0].processing_status === "processed"
        ? rows
        : null;
    },
    90_000,
    2_000,
    "Event worker processing",
  );
  created.events = eventRows.map((row) => row.id);

  const occurrenceRows = await getRows(
    `/rest/v1/moment_occurrences?select=id,event_id&event_id=eq.${encodeURIComponent(
      created.events[0],
    )}`,
  );
  created.occurrences = occurrenceRows.map((row) => row.id);

  const decisionRows = await getRows(
    `/rest/v1/decisions?select=id,offer_id&integration_id=eq.${encodeURIComponent(
      integrations[0].id,
    )}&order=created_at.desc&limit=5`,
  );
  created.decisions = decisionRows.map((row) => row.id);

  const deliveryRows = await getRows(
    `/rest/v1/deliveries?select=id,offer_id,decision_id&integration_id=eq.${encodeURIComponent(
      integrations[0].id,
    )}&order=created_at.desc&limit=5`,
  );
  created.deliveries = deliveryRows.map((row) => row.id);

  const clickRows = await getRows(
    `/rest/v1/clicks?select=id,delivery_id,qualification_status&delivery_id=in.(${created.deliveries
      .map((id) => `"${id}"`)
      .join(",")})`,
  );
  created.clicks = clickRows.map((row) => row.id);

  const qualifiedRows = await getRows(
    `/rest/v1/qualified_clicks?select=id,click_id&click_id=in.(${created.clicks
      .map((id) => `"${id}"`)
      .join(",")})`,
  );
  created.qualifiedClicks = qualifiedRows.map((row) => row.id);

  if (created.qualifiedClicks.length !== 1) {
    throw new Error("Production smoke did not produce exactly one Qualified Click.");
  }

  const settlementRows = await waitFor(
    async () => {
      const rows = await getRows(
        `/rest/v1/settlements?select=id,qualified_click_id,charge_cents,publisher_share_cents,platform_share_cents,currency&qualified_click_id=eq.${encodeURIComponent(
          created.qualifiedClicks[0],
        )}`,
      );
      return rows.length === 1 ? rows : null;
    },
    90_000,
    2_000,
    "Settlement",
  );

  created.settlements = settlementRows.map((row) => row.id);

  const settlement = settlementRows[0];
  if (
    settlement.charge_cents !== 100 ||
    settlement.publisher_share_cents !== 75 ||
    settlement.platform_share_cents !== 25 ||
    settlement.currency !== "USD"
  ) {
    throw new Error("Production settlement economics are incorrect.");
  }

  const financialRows = await getRows(
    `/rest/v1/financial_entries?select=id,settlement_id,entry_type,amount_cents&settlement_id=eq.${encodeURIComponent(
      settlement.id,
    )}`,
  );
  created.financialEntries = financialRows.map((row) => row.id);

  if (financialRows.length !== 3) {
    throw new Error(
      `Production settlement expected 3 financial entries, got ${financialRows.length}`,
    );
  }

  const debitTotal = financialRows
    .filter((row) => row.entry_type === "debit")
    .reduce((sum, row) => sum + row.amount_cents, 0);
  const creditTotal = financialRows
    .filter((row) => row.entry_type === "credit")
    .reduce((sum, row) => sum + row.amount_cents, 0);

  if (debitTotal !== 100 || creditTotal !== 100) {
    throw new Error("Production financial ledger does not balance.");
  }

  console.log("Production Qualified Click → Settlement → Ledger: OK");

  const queueRows = await getRows(
    `/rest/v1/moment_occurrences?select=id&event_id=eq.${encodeURIComponent(
      created.events[0],
    )}`,
  );
  if (queueRows.length < 1) {
    throw new Error("Production worker did not materialize the Moment occurrence.");
  }

  console.log("Production worker processing: OK");
  console.log("Production runtime smoke: PASS");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Production runtime smoke failed.",
  );
  process.exitCode = 1;
} finally {
  try {
    if (created.financialEntries.length > 0) {
      await deleteByIds("financial_entries", "id", created.financialEntries);
    }
    if (created.settlements.length > 0) {
      await deleteByIds("settlements", "id", created.settlements);
    }
    if (created.qualifiedClicks.length > 0) {
      await deleteByIds("qualified_clicks", "id", created.qualifiedClicks);
    }
    if (created.clicks.length > 0) {
      await deleteByIds("clicks", "id", created.clicks);
    }
    if (created.deliveries.length > 0) {
      await deleteByIds("deliveries", "id", created.deliveries);
    }
    if (created.decisions.length > 0) {
      await deleteByIds("decisions", "id", created.decisions);
    }
    if (created.occurrences.length > 0) {
      await deleteByIds("moment_occurrences", "id", created.occurrences);
    }
    if (created.events.length > 0) {
      await deleteByIds("events", "id", created.events);
    }
    if (created.creditEntries.length > 0) {
      await deleteByIds("advertiser_credit_entries", "id", created.creditEntries);
    }
    if (created.creditAccounts.length > 0) {
      await deleteByIds(
        "advertiser_credit_accounts",
        "workspace_id",
        created.creditAccounts,
      );
    }
    if (created.financialAccounts.length > 0) {
      await deleteByIds("financial_accounts", "id", created.financialAccounts);
    }
    if (created.offerMoments.length > 0) {
      const offerIds = created.offerMoments.map((row) => row.offer_id);
      await supabaseRequest(
        `/rest/v1/offer_moments?offer_id=in.(${offerIds
          .map((id) => `"${id}"`)
          .join(",")})`,
        { method: "DELETE" },
      );
    }
    if (created.offers.length > 0) {
      await deleteByIds("offers", "id", created.offers);
    }
    if (created.integrationSecrets.length > 0) {
      await deleteByIds(
        "integration_secrets",
        "integration_id",
        created.integrationSecrets,
      );
    }
    if (created.integrations.length > 0) {
      await deleteByIds("integrations", "id", created.integrations);
    }
    if (created.moments.length > 0) {
      await deleteByIds("moments", "id", created.moments);
    }
    if (created.products.length > 0) {
      await deleteByIds("products", "id", created.products);
    }
    if (created.capabilities.length > 0) {
      const capabilityQuery = created.capabilities
        .map(
          (row) =>
            `and=(workspace_id.eq.${row.workspace_id},capability.eq.${row.capability})`,
        )
        .join("&");
      if (capabilityQuery) {
        await supabaseRequest(
          `/rest/v1/workspace_capabilities?${capabilityQuery}`,
          { method: "DELETE" },
        );
      }
    }
    if (created.workspaceMembers.length > 0) {
      const workspaceIds = [...new Set(created.workspaceMembers.map((row) => row.workspace_id))];
      await supabaseRequest(
        `/rest/v1/workspace_members?workspace_id=in.(${workspaceIds
          .map((id) => `"${id}"`)
          .join(",")})`,
        { method: "DELETE" },
      );
    }

    const workspaceFinancialAccounts = await getRows(
      created.workspaces.length > 0
        ? `/rest/v1/financial_accounts?select=id&workspace_id=in.(${created.workspaces
            .map((id) => `"${id}"`)
            .join(",")})`
        : "/rest/v1/financial_accounts?select=id&workspace_id=eq.null",
    );
    const financialIds = workspaceFinancialAccounts.map((row) => row.id);
    if (financialIds.length > 0) {
      await deleteByIds("financial_accounts", "id", financialIds);
    }

    if (created.workspaces.length > 0) {
      await deleteByIds("workspaces", "id", created.workspaces);
    }

    const remaining = await getRows(
      created.workspaces.length > 0
        ? `/rest/v1/workspaces?select=id&id=in.(${created.workspaces
            .map((id) => `"${id}"`)
            .join(",")})`
        : "/rest/v1/workspaces?select=id&id=eq.00000000-0000-0000-0000-000000000000",
    );

    if (remaining.length !== 0) {
      throw new Error("Production smoke cleanup left temporary workspace data behind.");
    }

    console.log("Production smoke cleanup: OK");
  } catch (cleanupError) {
    console.error(
      cleanupError instanceof Error
        ? cleanupError.message
        : "Production smoke cleanup failed.",
    );
    process.exitCode = 1;
  }
}
