(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var publisherKey = script.getAttribute("data-publisher-key");
  var apiBase = script.getAttribute("data-nextaction-url") || new URL(script.src).origin;
  var defaultPosition = script.getAttribute("data-position") || "bottom-right";
  var rootId = "nextaction-ad";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function remove() {
    var existing = document.getElementById(rootId);
    if (existing) existing.remove();
  }

  function render(delivery, position) {
    remove();
    var offer = delivery.offer || {};
    var root = document.createElement("aside");
    root.id = rootId;
    root.setAttribute("aria-label", "Sponsored recommendation");
    root.style.cssText = [
      "position:fixed", "z-index:2147483647", "max-width:360px", "width:calc(100vw - 32px)",
      "padding:16px", "box-sizing:border-box", "background:#fff", "color:#111827",
      "border:1px solid #e5e7eb", "border-radius:14px", "box-shadow:0 12px 40px rgba(0,0,0,.16)",
      "font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"
    ].join(";");
    root.style[position === "bottom-left" ? "left" : "right"] = "16px";
    root.style.bottom = "16px";

    root.innerHTML = '<button type="button" aria-label="Close" style="position:absolute;right:8px;top:6px;border:0;background:transparent;font-size:20px;cursor:pointer;color:#6b7280">×</button>' +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:5px">Sponsored</div>' +
      '<div style="font-weight:700;font-size:16px;padding-right:20px">' + escapeHtml(offer.title || "Recommended for you") + '</div>' +
      (offer.description ? '<div style="margin-top:6px;color:#4b5563">' + escapeHtml(offer.description) + '</div>' : "") +
      '<a target="_blank" rel="noopener noreferrer" href="' + escapeHtml(delivery.click_url) + '" style="display:inline-block;margin-top:12px;padding:9px 13px;border-radius:9px;background:#111827;color:#fff;text-decoration:none;font-weight:600">' + escapeHtml(offer.cta_label || "Learn More") + '</a>';

    root.querySelector("button").addEventListener("click", remove);
    document.body.appendChild(root);
  }

  window.show_ads = function (momentKey, options) {
    if (!publisherKey || typeof momentKey !== "string" || !momentKey.trim()) return Promise.resolve(null);
    options = options || {};
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 5000);

    return fetch(new URL("/v1/public-offer", apiBase), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publisher_key: publisherKey,
        moment_key: momentKey.trim(),
        context: options.context && typeof options.context === "object" ? options.context : undefined
      }),
      signal: controller.signal,
      credentials: "omit"
    }).then(function (response) {
      if (response.status === 204) return null;
      if (!response.ok) return null;
      return response.json();
    }).then(function (payload) {
      if (!payload || !payload.delivery) return null;
      render(payload.delivery, options.position || defaultPosition);
      return payload.delivery;
    }).catch(function () {
      // Advertising must never break the publisher's primary application flow.
      return null;
    }).finally(function () {
      clearTimeout(timeout);
    });
  };

  window.NextAction = window.NextAction || {};
  window.NextAction.show_ads = window.show_ads;
})();
