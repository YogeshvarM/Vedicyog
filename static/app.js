(function () {
  const { renderMessage, esc } = window.AstroBlocks;
  const $ = (id) => document.getElementById(id);

  const thread = $("thread"), panel = document.querySelector(".panel");
  const input = $("input"), sendBtn = $("send");
  const dialog = $("profile-dialog"), form = $("profile-form");

  const state = { conversationId: null, profile: loadProfile(), busy: false, usdInr: null, effort: loadEffort(), account: null };
  // divisional-chart tabs fetch charts for the open consultation, or the saved birth details
  window.AstroBlocks.context = () => (state.conversationId
    ? { conversation_id: state.conversationId } : { profile: state.profile });

  const SPARK = '<svg viewBox="0 0 24 24"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z"/></svg>';
  const SUGGESTIONS = [
    ["Career analysis", "Give me a complete career and vocational analysis from my chart, including the D10."],
    ["Next 12 months", "What do my current dasha and transits indicate for the next 12 months? Show the timing windows."],
    ["Marriage & partnership", "Analyse marriage and partnership in my chart, including the D9, and when it is most favourable."],
    ["Wealth & finance", "Analyse my wealth potential and the best periods for financial growth."],
    ["Running dasha", "Explain my running Mahadasha and Antardasha and what they activate."],
    ["Yogas & doshas", "Which yogas and doshas are present in my chart and how do they play out?"],
    ["Today", "What does today hold for me? Include panchang highlights."],
  ];

  const api = (url, opts) => fetch(url, opts); // same-origin: the session cookie goes along

  // ---------- account: login, sign-up and the question quota ----------
  const authDialog = $("auth-dialog"), authForm = $("auth-form");
  let signupMode = false;

  function setAuthMode(signup) {
    signupMode = signup;
    $("auth-title").textContent = signup ? "Create account" : "Log in";
    $("auth-sub").textContent = signup ? "Pick a username and password. Each person gets 5 free questions: a second account with the same birth details or on the same device shares them." : "Log in to ask about your chart.";
    $("auth-submit").textContent = signup ? "Create account" : "Log in";
    $("auth-switch-text").textContent = signup ? "Already have an account?" : "New here?";
    $("auth-switch").textContent = signup ? "Log in" : "Create an account";
    authForm.password.autocomplete = signup ? "new-password" : "current-password";
    $("auth-error").hidden = true;
  }
  $("auth-switch").onclick = () => setAuthMode(!signupMode);
  authDialog.addEventListener("cancel", (e) => e.preventDefault()); // logging in is required

  function showAuth() {
    setAuthMode(false);
    if (!authDialog.open) authDialog.showModal();
  }

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("auth-submit");
    btn.disabled = true;
    try {
      const res = await api(signupMode ? "/api/signup" : "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authForm.username.value, password: authForm.password.value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || res.statusText);
      authForm.reset();
      authDialog.close();
      signedIn(body);
    } catch (err) {
      $("auth-error").textContent = err.message;
      $("auth-error").hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  function showAccount(acct) {
    state.account = acct;
    const q = $("quota");
    if (!acct) { q.textContent = ""; input.disabled = false; sendBtn.disabled = state.busy; return; }
    const out = !acct.admin && acct.remaining <= 0;
    q.textContent = acct.admin ? "Admin · unlimited" : `${acct.remaining}/${acct.limit} left`;
    q.title = acct.admin ? "No question limit" : `${acct.remaining} of ${acct.limit} questions left` +
      (acct.shared ? " (shared with another account on this device)" : "");
    q.classList.toggle("out", out);
    input.disabled = out;
    sendBtn.disabled = out || state.busy;
    input.placeholder = out ? `You have used all ${acct.limit} questions on this account.` : "Ask about career, marriage, timing, dasha...";
  }

  $("btn-account").onclick = () => {
    if (!state.account) return showAuth();
    const a = state.account;
    $("account-name").textContent = a.username;
    $("account-quota").textContent = a.admin ? "Admin account: no question limit."
      : `${a.used} of ${a.limit} questions used · ${a.remaining} left` +
        (a.shared ? " (another account on this device used some)." : ".");
    $("admin-users").hidden = !a.admin;
    if (a.admin) loadUsers();
    $("account-dialog").showModal();
  };

  // Admin: every account, flagged when it shares a device or birth chart with another.
  async function loadUsers() {
    const box = $("admin-users");
    box.innerHTML = '<p class="muted">Loading users…</p>';
    const users = await api("/api/admin/users").then((r) => r.json()).catch(() => []);
    const dupes = users.filter((u) => u.same_device.length || u.same_birth_chart.length).length;
    box.innerHTML = `<div class="eyebrow">USERS · ${users.length}${dupes ? ` · ${dupes} LINKED` : ""}</div>` +
      (users.length ? users.map((u) => `
        <div class="admin-user${u.same_device.length || u.same_birth_chart.length ? " dup" : ""}">
          <div class="admin-user-head"><b>${esc(u.username)}</b>
            <span>${u.questions} asked · ${new Date(u.created).toLocaleDateString()}</span>
            <button type="button" class="link" data-reset="${esc(u.username)}">Reset</button></div>
          ${u.same_device.length ? `<div class="admin-flag">Same device as ${esc(u.same_device.join(", "))}</div>` : ""}
          ${u.same_birth_chart.length ? `<div class="admin-flag">Same birth details as ${esc(u.same_birth_chart.join(", "))}</div>` : ""}
          <div class="admin-meta">${u.devices} device${u.devices === 1 ? "" : "s"} · ${u.charts} birth chart${u.charts === 1 ? "" : "s"}${u.ip ? ` · signed up from ${esc(u.ip)}` : ""}</div>
        </div>`).join("") : '<p class="muted">No users yet.</p>');
  }
  $("admin-users").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-reset]");
    if (!b || !confirm(`Give ${b.dataset.reset} a fresh ${state.account?.limit || 5} questions? This also resets the device and birth details they share.`)) return;
    await api("/api/admin/reset", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: b.dataset.reset }),
    });
    loadUsers();
  });
  $("account-logout").onclick = async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    $("account-dialog").close();
    showAccount(null);
    state.conversationId = null;
    welcome();
    showAuth();
  };

  function showEffort() {
    document.querySelectorAll("#effort [data-effort]").forEach((b) => {
      b.setAttribute("aria-checked", b.dataset.effort === state.effort);
    });
  }

  // Reasoning effort for the model; can change between messages.
  const EFFORT_NAME = { none: "Off", low: "Low", medium: "Medium", high: "High", xhigh: "Max" };
  function loadEffort() {
    try { const e = localStorage.getItem("astro.effort"); return EFFORT_NAME[e] ? e : "medium"; } catch { return "medium"; }
  }
  $("effort").addEventListener("click", (e) => {
    const b = e.target.closest("[data-effort]");
    if (!b) return;
    state.effort = b.dataset.effort;
    try { localStorage.setItem("astro.effort", state.effort); } catch { /* storage unavailable */ }
    showEffort();
  });

  // ---------- profile ----------
  function loadProfile() {
    try { return JSON.parse(localStorage.getItem("astro.profile")) || null; } catch { return null; }
  }
  function saveProfile(p) {
    try { localStorage.setItem("astro.profile", JSON.stringify(p)); } catch { /* storage unavailable */ }
  }
  function showNative(p) {
    const el = $("native");
    if (!p) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<span>NATIVE <b>${esc(p.name)}</b></span><span>BORN <b>${esc(p.date)}</b> · <b>${esc(p.time)}</b></span><span>AT <b>${esc(p.place)}</b></span>`;
  }
  function openProfile() {
    const p = state.profile || {};
    for (const k of ["name", "date", "time", "place", "lang"]) if (p[k]) form.elements[k].value = p[k];
    dialog.showModal();
  }
  $("profile-cancel").onclick = () => dialog.close();
  form.addEventListener("submit", () => {
    const fd = new FormData(form);
    const p = Object.fromEntries(fd.entries());
    if (p.time && p.time.length === 5) p.time += ":00";
    state.profile = p;
    saveProfile(p);
    newConsultation();
  });

  // ---------- rendering ----------
  function welcome() {
    const p = state.profile;
    thread.innerHTML = `<div class="welcome">
      <svg class="welcome-mark" viewBox="0 0 48 48"><rect x="4" y="4" width="40" height="40"/><path d="M4 4l40 40M44 4L4 44M24 4l20 20-20 20L4 24z"/></svg>
      <h2>${p ? `Namaste, ${esc(p.name)}` : "Your chart, read closely"}</h2>
      <p>${p
        ? "Ask anything about career, relationships, wealth or timing. VedicYog calculates your kundli, divisional charts, dashas and transits before answering."
        : "VedicYog calculates your Vedic birth chart from NASA JPL ephemeris data and reads it with you. Start with your birth details."}</p>
      ${p ? "" : '<button class="primary" id="welcome-start">Enter birth details</button>'}
    </div>`;
    const b = $("welcome-start");
    if (b) b.onclick = openProfile;
  }

  function addUser(text) {
    const el = document.createElement("div");
    el.className = "msg-user";
    el.textContent = text;
    thread.appendChild(el);
  }

  function addAssistant() {
    const el = document.createElement("div");
    el.className = "msg-ai";
    el.innerHTML = `<div class="ai-label">${SPARK}VedicYog<span class="ai-meta"></span></div>
      <div class="activity"></div>
      <details class="thinking" hidden><summary><span class="thinking-label">Thinking</span></summary><div class="thinking-body"></div></details>
      <div class="prose"></div><div class="run-slot"></div>`;
    thread.appendChild(el);
    return {
      el,
      prose: el.querySelector(".prose"),
      activity: el.querySelector(".activity"),
      meta: el.querySelector(".ai-meta"),
      runSlot: el.querySelector(".run-slot"),
      thinking: el.querySelector(".thinking"),
      thinkingLabel: el.querySelector(".thinking-label"),
      thinkingBody: el.querySelector(".thinking-body"),
    };
  }

  // ---------- run details (model, tokens, tools) ----------
  const tk = (n) => (n == null ? "–" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
  // Cost in USD and INR; data-usd lets the rupee figure fill in once the rate arrives.
  const inr = (n) => (n * state.usdInr).toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const moneyText = (n) => "$" + n.toFixed(4) + (state.usdInr ? " · " + inr(n) : "");
  const usd = (n) => (n == null ? "–" : `<span class="money" data-usd="${n}">${moneyText(n)}</span>`);
  const refreshMoney = () => document.querySelectorAll("[data-usd]").forEach((el) => { el.textContent = moneyText(+el.dataset.usd); });
  const secs = (ms) => (ms == null ? "–" : (ms / 1000).toFixed(1) + "s");
  const shortModel = (m) => String(m || "");

  function thoughtLabel(ms, effort, tokens) {
    return [`Thought for ${Math.max(1, Math.round(ms / 1000))}s`, effort && `${EFFORT_NAME[effort]} effort`,
      tokens && `${tk(tokens)} reasoning tokens`].filter(Boolean).join(" · ");
  }

  function liveMeta(model, u) {
    return `${shortModel(model)} · ${u.api_calls} call${u.api_calls === 1 ? "" : "s"} · ` +
      `${tk(u.input_tokens + u.cache_read_tokens + u.cache_write_tokens)} in · ${tk(u.output_tokens)} out`;
  }

  function renderRun(run) {
    if (!run) return "";
    const t = run.totals || {};
    const totalIn = (t.input_tokens || 0) + (t.cache_read_tokens || 0) + (t.cache_write_tokens || 0);
    const models = Object.entries(run.models || {}).map(([m, u]) => `
      <tr><td><code>${esc(m)}</code></td><td>${tk(u.input_tokens)}</td><td>${tk(u.cache_read_tokens)}</td>
      <td>${tk(u.cache_write_tokens)}</td><td>${tk(u.output_tokens)}</td><td>${usd(u.cost_usd)}</td></tr>`).join("");
    const calls = (run.api_calls || []).map((c) => `
      <tr><td>${c.n}</td><td><code>${esc(shortModel(c.model))}</code></td><td>${tk(c.input_tokens)}</td>
      <td>${tk(c.cache_read_tokens)}</td><td>${tk(c.cache_write_tokens)}</td><td>${tk(c.output_tokens)}</td>
      <td>${esc(c.stop_reason || "")}</td><td>${secs(c.duration_ms)}</td></tr>`).join("");
    const tools = (run.tools || []).map((x) => `
      <tr${x.is_error ? ' class="err"' : ""}><td><code>${esc(x.name)}</code></td>
      <td class="args">${esc(JSON.stringify(x.input || {}))}</td>
      <td>${x.duration_ms == null ? "–" : x.duration_ms + " ms"}</td>
      <td>${x.result_chars == null ? "–" : x.result_chars.toLocaleString() + " chars"}</td></tr>`).join("");
    const modelNames = Object.keys(run.models || {}).map(shortModel).join(" + ") || shortModel(run.requested_model);
    return `<details class="run">
      <summary>
        <span><b>${esc(modelNames)}</b></span>
        <span>${tk(totalIn)} in · ${tk(t.output_tokens)} out${t.reasoning_tokens ? ` (${tk(t.reasoning_tokens)} reasoning)` : ""}</span>
        ${run.reasoning_effort ? `<span>think ${esc(EFFORT_NAME[run.reasoning_effort] || run.reasoning_effort)}</span>` : ""}
        <span>${t.api_calls || 0} API calls · ${(run.tools || []).length} tools</span>
        <span>${usd(run.cost_usd)}</span>
        <span>${secs(run.duration_ms)}</span>
      </summary>
      <div class="run-body">
        <div class="run-section">TOKENS BY MODEL</div>
        <div class="run-table"><table><thead><tr><th>Model</th><th>Input</th><th>Cache read</th><th>Cache write</th><th>Output</th><th>Cost</th></tr></thead><tbody>${models}</tbody></table></div>
        <div class="run-section">API CALLS (${(run.api_calls || []).length})</div>
        <div class="run-table"><table><thead><tr><th>#</th><th>Model</th><th>Input</th><th>Cache read</th><th>Cache write</th><th>Output</th><th>Stop</th><th>Time</th></tr></thead><tbody>${calls}</tbody></table></div>
        <div class="run-section">TOOL CALLS (${(run.tools || []).length})</div>
        ${tools ? `<div class="run-table"><table><thead><tr><th>Tool</th><th>Arguments</th><th>Time</th><th>Result</th></tr></thead><tbody>${tools}</tbody></table></div>` : '<p class="run-note">No tools used.</p>'}
        <p class="run-note">Requested model <code>${esc(run.requested_model)}</code> · ${run.num_turns ?? "–"} turns · API time ${secs(run.duration_api_ms)} of ${secs(run.duration_ms)} total.
        "Input" is uncached prompt tokens; cache read and write are prompt tokens served from or written to the prompt cache.${run.error ? ` · <b>Error:</b> ${esc(run.error)}` : ""}</p>
      </div>
    </details>`;
  }

  const nearBottom = () => panel.scrollHeight - panel.scrollTop - panel.clientHeight < 160;
  const toBottom = () => { panel.scrollTop = panel.scrollHeight; };

  function suggestions() {
    $("suggestions").innerHTML = SUGGESTIONS.map(([l], i) => `<button type="button" class="suggestion" data-i="${i}">${esc(l)}</button>`).join("");
  }
  $("suggestions").addEventListener("click", (e) => {
    const b = e.target.closest(".suggestion");
    if (b) send(SUGGESTIONS[b.dataset.i][1]);
  });

  // ---------- chat ----------
  async function send(text) {
    text = text.trim();
    if (!text || state.busy) return;
    if (!state.profile && !state.conversationId) { openProfile(); return; }
    if (!state.conversationId) thread.innerHTML = "";

    state.busy = true;
    sendBtn.disabled = true;
    input.value = "";
    autosize();

    addUser(text);
    const ai = addAssistant();
    ai.activity.innerHTML = '<span class="activity-title"><span class="pulse"></span>Consulting the ephemeris</span>';
    toBottom();

    let acc = "", tools = 0, frame = 0, model = "", effort = null;
    let thought = "", thinkStart = 0, thinkEnd = 0;
    const pills = {};
    const paint = (streaming) => {
      const stick = nearBottom();
      if (thought) ai.thinkingBody.innerHTML = renderMessage(thought, false);
      ai.prose.innerHTML = renderMessage(acc, streaming);
      ai.prose.classList.toggle("caret", streaming && acc.length > 0);
      if (stick) toBottom();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(true); }); };

    try {
      const res = await api("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text, conversation_id: state.conversationId, profile: state.profile, effort: state.effort,
        }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))).detail || res.statusText;
        if (res.status === 401) showAuth();
        if (res.status === 403) api("/api/me").then((r) => r.json()).then(showAccount).catch(() => {});
        throw Object.assign(new Error(detail), { status: res.status });
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 2);
          if (!line.startsWith("data:")) continue;
          const ev = JSON.parse(line.slice(5));
          if (ev.type === "start") {
            state.conversationId = ev.conversation_id;
            model = ev.model;
            effort = ev.effort;
            ai.meta.textContent = shortModel(model) + (effort ? ` · think ${EFFORT_NAME[effort]}` : "");
          } else if (ev.type === "usage") {
            ai.meta.textContent = liveMeta(model, ev);
          } else if (ev.type === "thinking") {
            if (!thought) {
              thinkStart = Date.now();
              ai.thinking.hidden = false;
              ai.thinking.open = true;
              ai.thinkingLabel.innerHTML = '<span class="pulse"></span>Thinking…';
            } else if (!acc) {
              ai.thinkingLabel.innerHTML = '<span class="pulse"></span>Thinking…'; // thinking again after a tool call
            }
            thought += ev.delta;
            thinkEnd = Date.now();
            schedule();
          } else if (ev.type === "text") {
            if (thought && ai.thinking.open && !acc) {
              ai.thinking.open = false;
              ai.thinkingLabel.textContent = thoughtLabel(thinkEnd - thinkStart, effort);
            }
            acc += ev.delta;
            schedule();
          } else if (ev.type === "tool") {
            acc = ""; // narration before a tool call is not part of the answer
            tools++;
            const pill = document.createElement("span");
            pill.className = "tool-pill";
            pill.textContent = ev.name;
            pill.title = JSON.stringify(ev.input || {});
            ai.activity.appendChild(pill);
            pills[ev.id] = pill;
            paint(true);
          } else if (ev.type === "tool_done") {
            const pill = pills[ev.id];
            if (pill) {
              pill.textContent += ` · ${ev.ms} ms`;
              if (ev.is_error) pill.classList.add("err");
            }
          } else if (ev.type === "error") {
            acc += `\n\n> **Something went wrong:** ${ev.message}`;
          } else if (ev.type === "done") {
            const r = ev.run || {};
            ai.meta.innerHTML = `${esc(shortModel(Object.keys(r.models || {})[0] || model))}${effort ? ` · think ${EFFORT_NAME[effort]}` : ""} · ${usd(r.cost_usd)}`;
            ai.runSlot.innerHTML = renderRun(r);
            if (ev.account) showAccount(ev.account);
            if (thought) {
              ai.thinking.open = false;
              ai.thinkingLabel.textContent = thoughtLabel(thinkEnd - thinkStart, effort, r.totals?.reasoning_tokens);
            }
          }
        }
      }
    } catch (err) {
      acc += err.status === 403 ? `> **Question limit reached:** ${err.message}`
        : err.status === 401 ? "> **Please log in** to ask a question."
        : `\n\n> **Could not reach VedicYog:** ${err.message}`;
    }

    cancelAnimationFrame(frame);
    paint(false);
    ai.activity.innerHTML = tools
      ? `<span class="activity-title">Consulted ${tools} calculation${tools === 1 ? "" : "s"}</span>`
      : "";
    state.busy = false;
    showAccount(state.account); // re-enables sending unless the quota is used up
    input.focus();
  }

  function newConsultation() {
    state.conversationId = null;
    state.profile = loadProfile() || state.profile;
    showNative(state.profile);
    welcome();
  }

  $("composer").addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; }
  input.addEventListener("input", autosize);

  $("btn-new").onclick = () => { if (!state.busy) newConsultation(); };
  $("btn-settings").onclick = openProfile;

  // ---------- history ----------
  const drawer = $("history"), scrim = $("scrim");
  const closeHistory = () => { drawer.hidden = true; scrim.hidden = true; };
  $("history-close").onclick = closeHistory;
  scrim.onclick = closeHistory;

  $("btn-history").onclick = async () => {
    drawer.hidden = false; scrim.hidden = false;
    const list = $("history-list");
    list.innerHTML = '<li class="history-empty">Loading…</li>';
    const [convs, usage] = await Promise.all([
      api("/api/conversations").then((r) => r.json()).catch(() => []),
      fetch("/api/usage").then((r) => r.json()).catch(() => null),
    ]);
    $("usage-summary").innerHTML = usage && usage.runs ? `
      <div class="eyebrow">USAGE · ALL RUNS</div>
      <div class="usage-total">${usd(usage.total.cost_usd)} <span>${usage.runs} run${usage.runs === 1 ? "" : "s"}</span></div>
      ${Object.entries(usage.models).map(([m, u]) => `<div class="usage-row"><code>${esc(shortModel(m))}</code>
        <span>${tk(u.input_tokens + u.cache_read_tokens + u.cache_write_tokens)} in · ${tk(u.output_tokens)} out · ${usd(u.cost_usd)}</span></div>`).join("")}`
      : "";
    list.innerHTML = convs.length ? convs.map((c) => `
      <li>
        <button class="history-open" data-id="${esc(c.id)}">
          <div class="history-title">${esc(c.title)}</div>
          <div class="history-meta">${new Date(c.updated).toLocaleString()}</div>
        </button>
        <button class="history-del" data-del="${esc(c.id)}" aria-label="Delete">✕</button>
      </li>`).join("") : '<li class="history-empty">No consultations yet.</li>';
  };

  $("history-list").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      await api(`/api/conversations/${del.dataset.del}`, { method: "DELETE" });
      del.closest("li").remove();
      if (state.conversationId === del.dataset.del) newConsultation();
      return;
    }
    const open = e.target.closest("[data-id]");
    if (!open || state.busy) return;
    await openConversation(open.dataset.id);
    closeHistory();
  });

  async function openConversation(id) {
    const conv = await api(`/api/conversations/${id}`).then((r) => r.json());
    if (!conv.id) return;
    state.conversationId = conv.id;
    showNative(conv.profile);
    thread.innerHTML = "";
    for (const m of conv.messages) {
      if (m.role === "user") addUser(m.text);
      else {
        const ai = addAssistant();
        ai.prose.innerHTML = renderMessage(m.text, false);
        ai.runSlot.innerHTML = renderRun(m.run);
        if (m.thinking) {
          ai.thinking.hidden = false;
          ai.thinkingBody.innerHTML = renderMessage(m.thinking, false);
          ai.thinkingLabel.textContent = ["Thinking", m.run?.reasoning_effort && `${EFFORT_NAME[m.run.reasoning_effort]} effort`,
            m.run?.totals?.reasoning_tokens && `${tk(m.run.totals.reasoning_tokens)} reasoning tokens`].filter(Boolean).join(" · ");
        }
        if (m.run) ai.meta.innerHTML = `${esc(shortModel(Object.keys(m.run.models || {})[0] || m.run.requested_model))}${m.run.reasoning_effort ? ` · think ${EFFORT_NAME[m.run.reasoning_effort]}` : ""} · ${usd(m.run.cost_usd)}`;
      }
    }
    toBottom();
  }

  // ---------- boot ----------
  fetch("/api/health").then((r) => r.json()).then((h) => {
    const b = $("status");
    b.textContent = "connected";
    b.className = "badge ok";
    b.title = `${h.engine} · ${h.model}`;
    if (!h.available) { b.textContent = "no API key"; b.className = "badge err"; }
  }).catch(() => { $("status").textContent = "offline"; $("status").className = "badge err"; });

  fetch("/api/fx").then((r) => r.json()).then((fx) => {
    state.usdInr = fx.usd_inr;
    refreshMoney();
  }).catch(() => { /* costs stay in USD only */ });

  suggestions();
  showEffort();
  showNative(state.profile);
  welcome();

  // Logged in? Then open a /?c=<conversation id> deep link; otherwise ask to log in.
  const deepLink = new URLSearchParams(location.search).get("c");
  function signedIn(acct) {
    showAccount(acct);
    if (deepLink && !state.conversationId) openConversation(deepLink);
  }
  api("/api/me").then(async (r) => {
    if (r.ok) signedIn(await r.json());
    else if (!new URLSearchParams(location.search).has("demo")) showAuth();
  }).catch(() => {});

  // /?demo renders a sample consultation without calling the agent
  if (new URLSearchParams(location.search).has("demo")) {
    fetch("/static/demo.md").then((r) => r.text()).then((md) => {
      thread.innerHTML = "";
      addUser("Give me a complete career and vocational analysis from my chart.");
      addAssistant().prose.innerHTML = renderMessage(md, false);
    });
  }
})();
