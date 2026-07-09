/* ============================================================
   Moose Tracker — family cabin app
   ============================================================ */
(function () {
  "use strict";

  const cfg = window.MOOSE_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  const root = document.getElementById("root");

  const state = {
    user: null,
    profile: null,
    isOwner: false,
    tab: "calendar",
    calMonth: startOfMonth(new Date()),
    news: [],
    unseen: 0,
  };

  /* ---------------- small helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MO_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function ymd(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function todayYmd() { return ymd(new Date()); }
  function fmtShort(s) { const d = parseYmd(s); return MO_SHORT[d.getMonth()] + " " + d.getDate(); }
  function fmtLong(s) { const d = parseYmd(s); return MO_SHORT[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear(); }
  function fmtRange(a, b) {
    if (a === b) return fmtLong(a);
    const da = parseYmd(a), db = parseYmd(b);
    if (da.getFullYear() === db.getFullYear())
      return MO_SHORT[da.getMonth()] + " " + da.getDate() + " – " + MO_SHORT[db.getMonth()] + " " + db.getDate() + ", " + db.getFullYear();
    return fmtLong(a) + " – " + fmtLong(b);
  }
  function nights(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 604800) return Math.floor(s / 86400) + "d ago";
    return fmtLong(ymd(new Date(iso)));
  }
  function money(n) {
    if (n == null || n === "") return "—";
    return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function firstName() {
    const n = (state.profile && state.profile.full_name) || "";
    return n.split(" ")[0] || n || "";
  }

  /* ---------------- toast + modal ---------------- */
  function toast(msg, type) {
    const t = document.createElement("div");
    t.className = "msg " + (type === "err" ? "err" : "ok");
    t.style.cssText = "position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:200;box-shadow:var(--shadow-lg);max-width:90%;";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function openModal(html, extraClass) {
    closeModal();
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.id = "overlay";
    ov.innerHTML = '<div class="modal ' + (extraClass || "") + '">' + html + "</div>";
    ov.addEventListener("click", (e) => { if (e.target === ov) closeModal(); });
    document.body.appendChild(ov);
    return ov;
  }
  function closeModal() { const o = document.getElementById("overlay"); if (o) o.remove(); }

  function confirmDialog(message, onYes, yesLabel) {
    openModal(
      '<div class="modal-head"><h2>Just checking</h2></div>' +
      "<p>" + esc(message) + "</p>" +
      '<div class="actions">' +
        '<button class="btn ghost" data-act="close">Cancel</button>' +
        '<button class="btn red" data-act="confirm-yes">' + esc(yesLabel || "Delete") + "</button>" +
      "</div>"
    );
    document.getElementById("overlay").querySelector('[data-act="confirm-yes"]').addEventListener("click", () => {
      closeModal(); onYes();
    });
  }

  /* ---------------- auth ---------------- */
  async function init() {
    const { data } = await sb.auth.getSession();
    if (data.session) { await onSignedIn(data.session.user); }
    else { renderLogin(); }

    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session && (!state.user || state.user.id !== session.user.id)) {
        await onSignedIn(session.user);
      } else if (event === "SIGNED_OUT") {
        state.user = null; state.profile = null; state.isOwner = false; renderLogin();
      }
    });
  }

  async function onSignedIn(user) {
    state.user = user;
    state.isOwner = (user.email || "").toLowerCase() === cfg.OWNER_EMAIL.toLowerCase();
    // Clean the magic-link tokens out of the URL bar.
    if (window.location.hash && window.location.hash.indexOf("access_token") !== -1) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    // Family-only gate: only approved members (or the owner) get in.
    const { data: isMember } = await sb.rpc("is_member");
    if (!isMember && !state.isOwner) { renderPending(); return; }
    await loadProfile();
    renderApp();
    await refreshNews(true);
  }

  function renderPending() {
    root.innerHTML =
      '<div class="login-wrap"><div class="login-card">' +
        '<img class="logo" src="assets/moose.svg" alt="Moose Tracker" />' +
        "<h1>Almost there!</h1>" +
        '<p class="tag">This cabin is family-only.</p>' +
        '<div class="msg ok" style="text-align:left">You\'re signed in as <strong>' + esc(state.user.email) +
          "</strong>, but that email isn't on the family list yet.<br><br>Ask Malcolm to add you, then come back and refresh.</div>" +
        '<button class="btn ghost block" data-act="sign-out" style="margin-top:16px">Sign out</button>' +
      "</div></div>";
  }

  async function loadProfile() {
    let { data } = await sb.from("profiles").select("*").eq("id", state.user.id).maybeSingle();
    if (!data) {
      // Fallback in case the signup trigger hasn't landed yet.
      await sb.from("profiles").insert({
        id: state.user.id, email: state.user.email,
        full_name: (state.user.email || "friend").split("@")[0],
      });
      const r = await sb.from("profiles").select("*").eq("id", state.user.id).maybeSingle();
      data = r.data;
    }
    state.profile = data || { id: state.user.id, email: state.user.email, full_name: "", news_seen_at: "2000-01-01" };
  }

  function renderLogin() {
    root.innerHTML =
      '<div class="login-wrap"><div class="login-card">' +
        '<img class="logo" src="assets/moose.svg" alt="Moose Tracker" />' +
        "<h1>Moose Tracker</h1>" +
        '<p class="tag">The family cabin, all in one place.</p>' +
        '<div id="login-body">' +
          '<div class="field">' +
            '<label for="email">Your email</label>' +
            '<input id="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" />' +
          "</div>" +
          '<button class="btn block" data-act="send-link">Send me a login link</button>' +
          '<p class="note">We\'ll email you a one-tap link — no password to remember.</p>' +
        "</div>" +
      "</div></div>";
    const input = document.getElementById("email");
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendLink(); });
    input.focus();
  }

  async function sendLink() {
    const input = document.getElementById("email");
    const email = (input.value || "").trim();
    if (!email || email.indexOf("@") === -1) { toast("Please enter a valid email.", "err"); return; }
    const btn = document.querySelector('[data-act="send-link"]');
    btn.disabled = true; btn.textContent = "Sending…";
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split("#")[0] },
    });
    if (error) {
      btn.disabled = false; btn.textContent = "Send me a login link";
      document.getElementById("login-body").insertAdjacentHTML("beforeend",
        '<div class="msg err">' + esc(error.message) + "</div>");
      return;
    }
    document.getElementById("login-body").innerHTML =
      '<div class="msg ok"><strong>Check your email!</strong><br>We sent a login link to ' + esc(email) +
      ". Tap it on this device to jump in.</div>" +
      '<p class="note">Didn\'t get it? Check spam, or <a href="#" data-act="reset-login">try again</a>.</p>';
  }

  async function signOut() { await sb.auth.signOut(); }

  /* ---------------- app shell ---------------- */
  function tabs() {
    const t = [
      { id: "calendar", label: "Calendar", icon: "📅" },
      { id: "work", label: "Work", icon: "🔧" },
      { id: "supplies", label: "Supplies", icon: "📦" },
      { id: "procedures", label: "Guide", icon: "📖" },
    ];
    if (state.isOwner) t.push({ id: "maintenance", label: "Private", icon: "🔒" });
    return t;
  }

  function renderApp() {
    root.innerHTML =
      '<div class="app">' +
        '<header class="topbar">' +
          '<div class="brand"><img src="assets/moose.svg" alt="" /> Moose Tracker</div>' +
          '<div class="spacer"></div>' +
          '<button class="bell" data-act="open-news" title="News">🔔<span class="dot ' +
            (state.unseen ? "" : "hidden") + '" id="news-dot"></span></button>' +
          '<button class="who" data-act="account">' + esc(firstName() || "Account") + "</button>" +
        "</header>" +
        '<main class="main" id="view"></main>' +
        '<nav class="tabbar" id="tabbar"></nav>' +
      "</div>";
    renderTabbar();
    renderTab();
  }

  function renderTabbar() {
    const bar = document.getElementById("tabbar");
    bar.innerHTML = tabs().map((t) =>
      '<button data-tab="' + t.id + '" class="' + (state.tab === t.id ? "active" : "") + '">' +
        '<span class="ic">' + t.icon + "</span>" + esc(t.label) +
      "</button>"
    ).join("");
  }

  function setTab(id) { state.tab = id; renderTabbar(); renderTab(); window.scrollTo(0, 0); }

  function viewEl() { return document.getElementById("view"); }
  function loading() { viewEl().innerHTML = '<div class="loading"><div class="spin"></div>Loading…</div>'; }
  function fab(act, label) {
    const old = document.getElementById("fab"); if (old) old.remove();
    const b = document.createElement("button");
    b.className = "fab"; b.id = "fab"; b.dataset.act = act; b.title = label || "Add"; b.innerHTML = "+";
    document.querySelector(".app").appendChild(b);
  }
  function removeFab() { const f = document.getElementById("fab"); if (f) f.remove(); }

  function renderTab() {
    removeFab();
    switch (state.tab) {
      case "calendar": return viewCalendar();
      case "work": return viewWork();
      case "supplies": return viewSupplies();
      case "procedures": return viewProcedures();
      case "maintenance": return state.isOwner ? viewMaintenance() : setTab("calendar");
    }
  }

  /* ---------------- CALENDAR ---------------- */
  async function viewCalendar() {
    loading();
    const { data: bookings, error } = await sb.from("bookings").select("*").order("start_date");
    if (error) { viewEl().innerHTML = errBox(error); return; }
    state._bookings = bookings || [];
    drawCalendar();
    fab("add-booking", "Add stay");
  }

  function drawCalendar() {
    const bookings = state._bookings || [];
    const m = state.calMonth;
    const year = m.getFullYear(), month = m.getMonth();
    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = todayYmd();

    // map each day -> booking (first match)
    const byDay = {};
    bookings.forEach((b) => {
      let d = parseYmd(b.start_date), end = parseYmd(b.end_date);
      while (d <= end) { const k = ymd(d); if (!byDay[k]) byDay[k] = b; d.setDate(d.getDate() + 1); }
    });

    let cells = "";
    for (let i = 0; i < startPad; i++) cells += '<div class="cal-cell blank"></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const k = ymd(new Date(year, month, day));
      const b = byDay[k];
      const cls = ["cal-cell"];
      if (k === today) cls.push("today");
      if (b) cls.push("booked");
      else if (k < today) cls.push("past");
      cells += '<button class="' + cls.join(" ") + '" data-day="' + k + '">' + day + "</button>";
    }

    const upcoming = bookings.filter((b) => b.end_date >= today);

    viewEl().innerHTML =
      '<div class="view-head"><h2>Cabin Calendar</h2></div>' +
      '<div class="card">' +
        '<div class="cal-head">' +
          '<div class="mo">' + MONTHS[month] + " " + year + "</div>" +
          '<div class="cal-nav"><button data-act="cal-prev">‹</button><button data-act="cal-today">•</button><button data-act="cal-next">›</button></div>' +
        "</div>" +
        '<div class="cal-grid">' + DOW.map((d) => '<div class="cal-dow">' + d + "</div>").join("") + cells + "</div>" +
        '<div class="cal-legend"><span><span class="sw" style="background:var(--green)"></span>Booked</span>' +
          '<span><span class="sw" style="background:#fff;border:1px solid var(--line)"></span>Open</span>' +
          '<span><span class="sw" style="background:#fff;outline:2px solid var(--blue);outline-offset:-2px"></span>Today</span></div>' +
      "</div>" +
      '<div class="section-label">Upcoming stays</div>' +
      (upcoming.length
        ? '<div class="list">' + upcoming.map(bookingCard).join("") + "</div>"
        : '<div class="empty"><div class="big">🌲</div>No stays booked yet.<br>Tap the + to add yours.</div>');
  }

  function bookingCard(b) {
    const mine = b.user_id === state.user.id;
    const canDel = mine || state.isOwner;
    return '<div class="card">' +
      '<div class="row"><div style="flex:1">' +
        "<h3>" + esc(b.guest_name) + (mine ? ' <span class="pill done">You</span>' : "") + "</h3>" +
        '<div class="small muted">' + esc(fmtRange(b.start_date, b.end_date)) + " · " + nights(b.start_date, b.end_date) + " night" + (nights(b.start_date, b.end_date) === 1 ? "" : "s") + "</div>" +
        (b.notes ? '<div class="small" style="margin-top:4px">' + esc(b.notes) + "</div>" : "") +
      "</div>" +
      (canDel ? '<button class="btn ghost sm" data-act="del-booking" data-id="' + b.id + '">Cancel</button>' : "") +
      "</div></div>";
  }

  function bookingForm(prefillStart) {
    const name = state.profile && state.profile.full_name ? state.profile.full_name : "";
    const s = prefillStart || todayYmd();
    openModal(
      '<div class="modal-head"><h2>Add a stay</h2><div class="spacer"></div><button class="x" data-act="close">×</button></div>' +
      '<div class="field"><label>Who\'s coming?</label><input id="bk-name" value="' + esc(name) + '" placeholder="e.g. The Johnsons" /></div>' +
      '<div class="row" style="gap:12px">' +
        '<div class="field" style="flex:1"><label>Arrive</label><input id="bk-start" type="date" value="' + esc(s) + '" /></div>' +
        '<div class="field" style="flex:1"><label>Leave</label><input id="bk-end" type="date" value="' + esc(s) + '" /></div>' +
      "</div>" +
      '<div class="field"><label>Notes (optional)</label><textarea id="bk-notes" placeholder="Bringing the dog, arriving late, etc."></textarea></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="save-booking">Save stay</button></div>'
    );
    const start = document.getElementById("bk-start");
    const end = document.getElementById("bk-end");
    start.addEventListener("change", () => { if (end.value < start.value) end.value = start.value; });
  }

  async function saveBooking() {
    const name = document.getElementById("bk-name").value.trim();
    const start = document.getElementById("bk-start").value;
    const end = document.getElementById("bk-end").value;
    const notes = document.getElementById("bk-notes").value.trim();
    if (!name) { toast("Please add a name.", "err"); return; }
    if (!start || !end) { toast("Please pick both dates.", "err"); return; }
    if (end < start) { toast("The leave date can't be before the arrive date.", "err"); return; }

    // Friendly conflict check first.
    const { data: clash } = await sb.from("bookings").select("*")
      .lte("start_date", end).gte("end_date", start).order("start_date").limit(1);
    if (clash && clash.length) { showConflict(clash[0]); return; }

    const btn = document.querySelector('[data-act="save-booking"]');
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    const { error } = await sb.from("bookings").insert({
      user_id: state.user.id, guest_name: name, start_date: start, end_date: end, notes: notes || null,
    });
    if (error) {
      if (error.code === "23P01" || /overlap|exclude/i.test(error.message)) {
        // Someone booked in the split-second between check and save.
        const { data: c2 } = await sb.from("bookings").select("*").lte("start_date", end).gte("end_date", start).limit(1);
        if (c2 && c2.length) { showConflict(c2[0]); return; }
      }
      toast(error.message, "err");
      if (btn) { btn.disabled = false; btn.textContent = "Save stay"; }
      return;
    }
    closeModal();
    toast("Stay booked! 🎉");
    viewCalendar();
  }

  function showConflict(b) {
    openModal(
      '<div class="modal-head"><h2>⚠️ Dates already taken</h2></div>' +
      '<div class="conflict-box">Your dates conflict with ' + esc(b.guest_name) + "'s dates<br>(" +
        esc(fmtRange(b.start_date, b.end_date)) + ").</div>" +
      '<p class="note">The cabin\'s already spoken for then. Pick different dates and try again — nothing was overwritten.</p>' +
      '<div class="actions"><button class="btn" data-act="close">Got it</button></div>',
      "conflict"
    );
  }

  async function delBooking(id) {
    const { error } = await sb.from("bookings").delete().eq("id", id);
    if (error) { toast(error.message, "err"); return; }
    toast("Stay cancelled.");
    viewCalendar();
  }

  /* ---------------- WORK ORDERS ---------------- */
  async function viewWork() {
    loading();
    const { data, error } = await sb.from("work_orders").select("*").order("created_at", { ascending: false });
    if (error) { viewEl().innerHTML = errBox(error); return; }
    const open = (data || []).filter((w) => w.status !== "done");
    const done = (data || []).filter((w) => w.status === "done");
    viewEl().innerHTML =
      '<div class="view-head"><h2>Work Orders</h2></div>' +
      '<p class="muted small" style="margin-top:-6px">Something need fixing or updating around the cabin? Log it here.</p>' +
      (open.length ? '<div class="list">' + open.map(workCard).join("") + "</div>"
        : '<div class="empty"><div class="big">✅</div>Nothing needs attention right now.</div>') +
      (done.length ? '<div class="section-label">Done</div><div class="list">' + done.map(workCard).join("") + "</div>" : "");
    fab("add-work", "Add work order");
  }

  function workCard(w) {
    const canDel = w.created_by === state.user.id || state.isOwner;
    const next = w.status === "open" ? "in_progress" : w.status === "in_progress" ? "done" : "open";
    const nextLbl = next === "in_progress" ? "Start" : next === "done" ? "Mark done" : "Reopen";
    return '<div class="card' + (w.status === "done" ? "" : "") + '">' +
      '<div class="row" style="align-items:flex-start">' +
        '<div style="flex:1">' +
          '<h3 class="' + (w.status === "done" ? "strike" : "") + '">' + esc(w.title) + "</h3>" +
          '<div class="row" style="gap:6px;margin:4px 0">' +
            '<span class="pill ' + w.category + '">' + (w.category === "repair" ? "🔧 Repair" : "✨ Update") + "</span>" +
            '<span class="pill ' + w.status + '">' + statusLabel(w.status) + "</span>" +
          "</div>" +
          (w.location ? '<div class="tiny muted">📍 ' + esc(w.location) + "</div>" : "") +
          (w.description ? '<div class="small" style="margin-top:4px">' + esc(w.description) + "</div>" : "") +
        "</div>" +
      "</div>" +
      '<div class="row" style="margin-top:10px;gap:8px">' +
        '<button class="btn ghost sm" data-act="cycle-work" data-id="' + w.id + '" data-next="' + next + '">' + nextLbl + "</button>" +
        (canDel ? '<button class="btn ghost sm" data-act="del-work" data-id="' + w.id + '">Delete</button>' : "") +
      "</div></div>";
  }
  function statusLabel(s) { return s === "open" ? "Open" : s === "in_progress" ? "In progress" : "Done"; }

  function workForm() {
    openModal(
      '<div class="modal-head"><h2>New work order</h2><div class="spacer"></div><button class="x" data-act="close">×</button></div>' +
      '<div class="field"><label>What needs work?</label><input id="wk-title" placeholder="e.g. Kitchen faucet drips" /></div>' +
      '<div class="field"><label>Where in the cabin?</label><input id="wk-loc" placeholder="e.g. Kitchen" /></div>' +
      '<div class="field"><label>Is it a repair or an update?</label>' +
        '<select id="wk-cat"><option value="repair">🔧 Repair — something\'s broken</option><option value="update">✨ Update — improve / replace</option></select></div>' +
      '<div class="field"><label>Details (optional)</label><textarea id="wk-desc" placeholder="Anything helpful to know"></textarea></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="save-work">Add it</button></div>'
    );
  }

  async function saveWork() {
    const title = document.getElementById("wk-title").value.trim();
    if (!title) { toast("Give it a short title.", "err"); return; }
    const { error } = await sb.from("work_orders").insert({
      created_by: state.user.id, title,
      location: document.getElementById("wk-loc").value.trim() || null,
      category: document.getElementById("wk-cat").value,
      description: document.getElementById("wk-desc").value.trim() || null,
    });
    if (error) { toast(error.message, "err"); return; }
    closeModal(); toast("Work order added."); viewWork();
  }
  async function cycleWork(id, next) {
    const { error } = await sb.from("work_orders").update({ status: next }).eq("id", id);
    if (error) { toast(error.message, "err"); return; } viewWork();
  }
  async function delWork(id) {
    const { error } = await sb.from("work_orders").delete().eq("id", id);
    if (error) { toast(error.message, "err"); return; } toast("Deleted."); viewWork();
  }

  /* ---------------- SUPPLIES ---------------- */
  async function viewSupplies() {
    loading();
    const { data, error } = await sb.from("supplies").select("*").order("created_at", { ascending: false });
    if (error) { viewEl().innerHTML = errBox(error); return; }
    const needed = (data || []).filter((s) => s.status === "needed");
    const stocked = (data || []).filter((s) => s.status === "stocked");
    viewEl().innerHTML =
      '<div class="view-head"><h2>Supplies</h2></div>' +
      '<p class="muted small" style="margin-top:-6px">Running low on something? Add it so the next person knows to grab it.</p>' +
      '<div class="section-label">Need to buy (' + needed.length + ")</div>" +
      (needed.length ? '<div class="list">' + needed.map(supplyCard).join("") + "</div>"
        : '<div class="empty"><div class="big">🧺</div>All stocked up!</div>') +
      (stocked.length ? '<div class="section-label">Stocked</div><div class="list">' + stocked.map(supplyCard).join("") + "</div>" : "");
    fab("add-supply", "Add supply");
  }

  function supplyCard(s) {
    const canDel = s.added_by === state.user.id || state.isOwner;
    const toStatus = s.status === "needed" ? "stocked" : "needed";
    return '<div class="card"><div class="row">' +
      '<div style="flex:1"><h3 class="' + (s.status === "stocked" ? "strike" : "") + '" style="font-size:15px">' + esc(s.name) +
        (s.quantity ? ' <span class="muted small">· ' + esc(s.quantity) + "</span>" : "") + "</h3></div>" +
      '<button class="btn ' + (s.status === "needed" ? "" : "ghost") + ' sm" data-act="toggle-supply" data-id="' + s.id + '" data-status="' + toStatus + '">' +
        (s.status === "needed" ? "Got it" : "Need again") + "</button>" +
      (canDel ? '<button class="btn ghost sm" data-act="del-supply" data-id="' + s.id + '">✕</button>' : "") +
      "</div></div>";
  }

  function supplyForm() {
    openModal(
      '<div class="modal-head"><h2>Add a supply</h2><div class="spacer"></div><button class="x" data-act="close">×</button></div>' +
      '<div class="field"><label>Item</label><input id="sp-name" placeholder="e.g. Paper towels" /></div>' +
      '<div class="field"><label>How much / how many (optional)</label><input id="sp-qty" placeholder="e.g. 2 rolls, 1 box" /></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="save-supply">Add to list</button></div>'
    );
    document.getElementById("sp-name").focus();
  }
  async function saveSupply() {
    const name = document.getElementById("sp-name").value.trim();
    if (!name) { toast("What's the item?", "err"); return; }
    const { error } = await sb.from("supplies").insert({
      added_by: state.user.id, name, quantity: document.getElementById("sp-qty").value.trim() || null,
    });
    if (error) { toast(error.message, "err"); return; }
    closeModal(); toast("Added to the list."); viewSupplies();
  }
  async function toggleSupply(id, status) {
    const { error } = await sb.from("supplies").update({ status }).eq("id", id);
    if (error) { toast(error.message, "err"); return; } viewSupplies();
  }
  async function delSupply(id) {
    const { error } = await sb.from("supplies").delete().eq("id", id);
    if (error) { toast(error.message, "err"); return; } viewSupplies();
  }

  /* ---------------- PROCEDURES ---------------- */
  async function viewProcedures() {
    loading();
    const { data, error } = await sb.from("procedures").select("*");
    if (error) { viewEl().innerHTML = errBox(error); return; }
    const map = {}; (data || []).forEach((p) => (map[p.kind] = p));
    viewEl().innerHTML =
      '<div class="view-head"><h2>Cabin Procedures</h2></div>' +
      '<p class="muted small" style="margin-top:-6px">The full open &amp; close routine, always up to date.</p>' +
      procCard("opening", "🌲 Opening the Cabin", map.opening) +
      procCard("closing", "❄️ Closing the Cabin", map.closing);
  }
  function procCard(kind, title, p) {
    const content = (p && p.content) || "Nothing here yet.";
    return '<div class="card">' +
      '<div class="row"><h3 style="flex:1">' + title + "</h3>" +
        (state.isOwner ? '<button class="btn ghost sm" data-act="edit-proc" data-kind="' + kind + '">Edit</button>' : "") +
      "</div>" +
      '<div class="proc">' + esc(content) + "</div>" +
      (p && p.updated_at ? '<div class="tiny muted" style="margin-top:10px">Updated ' + esc(timeAgo(p.updated_at)) + "</div>" : "") +
      "</div>";
  }
  async function editProc(kind) {
    const { data } = await sb.from("procedures").select("*").eq("kind", kind).maybeSingle();
    openModal(
      '<div class="modal-head"><h2>Edit ' + kind + ' procedure</h2><div class="spacer"></div><button class="x" data-act="close">×</button></div>' +
      '<div class="field"><textarea id="proc-text" style="min-height:320px">' + esc((data && data.content) || "") + "</textarea></div>" +
      '<div class="actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="save-proc" data-kind="' + kind + '">Save</button></div>'
    );
  }
  async function saveProc(kind) {
    const content = document.getElementById("proc-text").value;
    const { error } = await sb.from("procedures").update({
      content, updated_at: new Date().toISOString(), updated_by: state.user.id,
    }).eq("kind", kind);
    if (error) { toast(error.message, "err"); return; }
    closeModal(); toast("Procedures updated."); viewProcedures();
  }

  /* ---------------- MAINTENANCE (owner only) ---------------- */
  async function viewMaintenance() {
    loading();
    const { data, error } = await sb.from("maintenance").select("*").order("service_date", { ascending: false, nullsFirst: false });
    if (error) { viewEl().innerHTML = errBox(error); return; }
    const rows = data || [];
    const total = rows.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);
    viewEl().innerHTML =
      '<div class="view-head"><h2>Maintenance</h2><div class="spacer"></div><span class="lock-note">🔒 Only you</span></div>' +
      '<p class="muted small" style="margin-top:-6px">Your private log of cabin maintenance &amp; costs. No one else can see this tab.</p>' +
      '<div class="total-bar"><div><div class="lbl">Total logged</div></div><div class="amt">' + money(total) + "</div></div>" +
      (rows.length ? '<div class="list">' + rows.map(maintCard).join("") + "</div>"
        : '<div class="empty"><div class="big">🧾</div>No records yet.<br>Tap + to log maintenance.</div>');
    fab("add-maint", "Add record");
  }
  function maintCard(r) {
    return '<div class="card"><div class="row" style="align-items:flex-start">' +
      '<div style="flex:1"><h3 style="font-size:15px">' + esc(r.description) + "</h3>" +
        '<div class="tiny muted">' + (r.service_date ? esc(fmtLong(r.service_date)) : "No date") +
          (r.vendor ? " · " + esc(r.vendor) : "") + "</div>" +
        (r.notes ? '<div class="small" style="margin-top:4px">' + esc(r.notes) + "</div>" : "") +
      "</div>" +
      '<div style="text-align:right"><div class="cost">' + money(r.cost) + "</div>" +
        '<button class="btn ghost sm" data-act="del-maint" data-id="' + r.id + '" style="margin-top:8px">Delete</button></div>' +
      "</div></div>";
  }
  function maintForm() {
    openModal(
      '<div class="modal-head"><h2>Log maintenance</h2><div class="spacer"></div><button class="x" data-act="close">×</button></div>' +
      '<div class="field"><label>What was done?</label><input id="mt-desc" placeholder="e.g. Furnace serviced" /></div>' +
      '<div class="row" style="gap:12px">' +
        '<div class="field" style="flex:1"><label>Cost</label><input id="mt-cost" type="number" inputmode="decimal" step="0.01" placeholder="0.00" /></div>' +
        '<div class="field" style="flex:1"><label>Date</label><input id="mt-date" type="date" value="' + todayYmd() + '" /></div>' +
      "</div>" +
      '<div class="field"><label>Vendor (optional)</label><input id="mt-vendor" placeholder="e.g. Tahoe Heating Co." /></div>' +
      '<div class="field"><label>Notes (optional)</label><textarea id="mt-notes"></textarea></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="save-maint">Save</button></div>'
    );
  }
  async function saveMaint() {
    const desc = document.getElementById("mt-desc").value.trim();
    if (!desc) { toast("What was done?", "err"); return; }
    const costRaw = document.getElementById("mt-cost").value;
    const { error } = await sb.from("maintenance").insert({
      description: desc,
      cost: costRaw === "" ? null : Number(costRaw),
      service_date: document.getElementById("mt-date").value || null,
      vendor: document.getElementById("mt-vendor").value.trim() || null,
      notes: document.getElementById("mt-notes").value.trim() || null,
    });
    if (error) { toast(error.message, "err"); return; }
    closeModal(); toast("Record saved."); viewMaintenance();
  }
  async function delMaint(id) {
    const { error } = await sb.from("maintenance").delete().eq("id", id);
    if (error) { toast(error.message, "err"); return; } toast("Deleted."); viewMaintenance();
  }

  /* ---------------- NEWS ---------------- */
  async function refreshNews(popupIfNew) {
    const { data } = await sb.from("news").select("*").order("created_at", { ascending: false });
    state.news = data || [];
    const seen = (state.profile && state.profile.news_seen_at) || "2000-01-01";
    const unseen = state.news.filter((n) => new Date(n.created_at) > new Date(seen));
    state.unseen = unseen.length;
    const dot = document.getElementById("news-dot");
    if (dot) dot.classList.toggle("hidden", state.unseen === 0);
    if (popupIfNew && unseen.length) newsPopup(unseen);
  }

  function newsPopup(items) {
    openModal(
      '<div class="modal-head"><h2>📣 Cabin News</h2><div class="spacer"></div></div>' +
      '<p class="muted small">Here\'s what\'s new since you last checked:</p>' +
      items.map(newsItem).join("") +
      '<div class="actions"><button class="btn" data-act="dismiss-news">Got it</button></div>'
    );
  }
  function newsItem(n) {
    return '<div class="news-item"><h3>' + esc(n.title) + '</h3><div class="when">' + esc(timeAgo(n.created_at)) +
      '</div><div class="body">' + esc(n.body) + "</div></div>";
  }

  async function markNewsSeen() {
    const now = new Date().toISOString();
    state.profile.news_seen_at = now; state.unseen = 0;
    const dot = document.getElementById("news-dot"); if (dot) dot.classList.add("hidden");
    await sb.from("profiles").update({ news_seen_at: now }).eq("id", state.user.id);
  }

  async function openNews() {
    await refreshNews(false);
    openModal(
      '<div class="modal-head"><h2>📣 Cabin News</h2><div class="spacer"></div><button class="x" data-act="close-news">×</button></div>' +
      (state.isOwner ? '<button class="btn red block" data-act="post-news" style="margin-bottom:16px">+ Post an update</button>' : "") +
      (state.news.length ? state.news.map(newsItemOwner).join("")
        : '<div class="empty"><div class="big">📰</div>No news yet.</div>')
    );
    markNewsSeen();
  }
  function newsItemOwner(n) {
    return '<div class="news-item"><div class="row"><h3 style="flex:1">' + esc(n.title) + "</h3>" +
      (state.isOwner ? '<button class="x" data-act="del-news" data-id="' + n.id + '" title="Delete">🗑</button>' : "") +
      '</div><div class="when">' + esc(timeAgo(n.created_at)) + '</div><div class="body">' + esc(n.body) + "</div></div>";
  }
  function newsForm() {
    openModal(
      '<div class="modal-head"><h2>Post cabin news</h2><div class="spacer"></div><button class="x" data-act="close">×</button></div>' +
      '<p class="muted small">Everyone will get a pop-up next time they open Moose Tracker.</p>' +
      '<div class="field"><label>Headline</label><input id="nw-title" placeholder="e.g. New Wi-Fi password" /></div>' +
      '<div class="field"><label>Details</label><textarea id="nw-body" placeholder="What changed and what people need to know"></textarea></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn red" data-act="save-news">Post it</button></div>'
    );
  }
  async function saveNews() {
    const title = document.getElementById("nw-title").value.trim();
    const body = document.getElementById("nw-body").value.trim();
    if (!title || !body) { toast("Add a headline and details.", "err"); return; }
    const { error } = await sb.from("news").insert({ title, body, created_by: state.user.id });
    if (error) { toast(error.message, "err"); return; }
    // Mark as seen for the poster so they don't get their own popup.
    await sb.from("profiles").update({ news_seen_at: new Date().toISOString() }).eq("id", state.user.id);
    state.profile.news_seen_at = new Date().toISOString();
    closeModal(); toast("Posted! 📣"); openNews();
  }
  async function delNews(id) {
    const { error } = await sb.from("news").delete().eq("id", id);
    if (error) { toast(error.message, "err"); return; }
    openNews();
  }

  /* ---------------- ACCOUNT ---------------- */
  function accountModal() {
    openModal(
      '<div class="modal-head"><h2>Your account</h2><div class="spacer"></div><button class="x" data-act="close">×</button></div>' +
      '<div class="field"><label>Display name</label><input id="ac-name" value="' + esc((state.profile && state.profile.full_name) || "") + '" placeholder="Your name" /></div>' +
      '<p class="tiny muted">Signed in as ' + esc(state.user.email) + (state.isOwner ? " · Owner" : "") + "</p>" +
      (state.isOwner ? '<button class="btn blue block" data-act="manage-family" style="margin:6px 0 4px">👪 Manage family list</button>' : "") +
      '<div class="actions"><button class="btn ghost" data-act="sign-out">Sign out</button><button class="btn" data-act="save-name">Save</button></div>'
    );
  }
  async function saveName() {
    const name = document.getElementById("ac-name").value.trim();
    if (!name) { toast("Name can't be empty.", "err"); return; }
    const { error } = await sb.from("profiles").update({ full_name: name }).eq("id", state.user.id);
    if (error) { toast(error.message, "err"); return; }
    state.profile.full_name = name;
    const who = document.querySelector(".who"); if (who) who.textContent = firstName();
    closeModal(); toast("Saved.");
  }

  /* ---------------- FAMILY LIST (owner only) ---------------- */
  async function openFamily() {
    const { data, error } = await sb.from("members").select("*").order("email");
    if (error) { toast(error.message, "err"); return; }
    const list = (data || []).map((m) =>
      '<div class="card" style="padding:12px"><div class="row">' +
        '<div style="flex:1;font-size:14px">' + esc(m.email) +
          (m.email.toLowerCase() === cfg.OWNER_EMAIL.toLowerCase() ? ' <span class="pill done">Owner</span>' : "") + "</div>" +
        (m.email.toLowerCase() === cfg.OWNER_EMAIL.toLowerCase() ? ""
          : '<button class="btn ghost sm" data-act="remove-member" data-email="' + esc(m.email) + '">Remove</button>') +
      "</div></div>"
    ).join("");
    openModal(
      '<div class="modal-head"><h2>👪 Family list</h2><div class="spacer"></div><button class="x" data-act="close">×</button></div>' +
      '<p class="muted small">Only these emails can sign in and see the cabin. Add a family member\'s email and they can log in with a magic link.</p>' +
      '<div class="row" style="gap:8px;margin-bottom:16px">' +
        '<input id="fm-email" type="email" inputmode="email" placeholder="name@example.com" style="flex:1;padding:12px 14px;border:1.5px solid var(--line);border-radius:10px" />' +
        '<button class="btn" data-act="add-member">Add</button></div>' +
      '<div class="list">' + list + "</div>"
    );
    const inp = document.getElementById("fm-email");
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") addMember(); });
    inp.focus();
  }
  async function addMember() {
    const email = (document.getElementById("fm-email").value || "").trim().toLowerCase();
    if (!email || email.indexOf("@") === -1) { toast("Enter a valid email.", "err"); return; }
    const { error } = await sb.from("members").insert({ email, added_by: state.user.id });
    if (error) {
      if (error.code === "23505") { toast("That email is already on the list."); }
      else { toast(error.message, "err"); return; }
    } else { toast("Added to the family. 👋"); }
    openFamily();
  }
  async function removeMember(email) {
    const { error } = await sb.from("members").delete().eq("email", email);
    if (error) { toast(error.message, "err"); return; }
    toast("Removed."); openFamily();
  }

  function errBox(error) {
    return '<div class="msg err" style="margin-top:20px">Couldn\'t load this: ' + esc(error.message) + "</div>";
  }

  /* ---------------- event delegation ---------------- */
  document.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act, id = el.dataset.id;
    const A = {
      "send-link": sendLink,
      "reset-login": (ev) => { ev.preventDefault(); renderLogin(); },
      "account": accountModal,
      "sign-out": signOut,
      "save-name": saveName,
      "manage-family": openFamily,
      "add-member": addMember,
      "remove-member": () => removeMember(el.dataset.email),
      "close": closeModal,
      "open-news": openNews,
      "close-news": closeModal,
      "post-news": newsForm,
      "save-news": saveNews,
      "del-news": () => delNews(id),
      "dismiss-news": () => { markNewsSeen(); closeModal(); },
      // calendar
      "cal-prev": () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); drawCalendar(); },
      "cal-next": () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); drawCalendar(); },
      "cal-today": () => { state.calMonth = startOfMonth(new Date()); drawCalendar(); },
      "add-booking": () => bookingForm(),
      "save-booking": saveBooking,
      "del-booking": () => confirmDialog("Cancel this stay?", () => delBooking(id), "Cancel stay"),
      // work
      "add-work": workForm,
      "save-work": saveWork,
      "cycle-work": () => cycleWork(id, el.dataset.next),
      "del-work": () => confirmDialog("Delete this work order?", () => delWork(id)),
      // supplies
      "add-supply": supplyForm,
      "save-supply": saveSupply,
      "toggle-supply": () => toggleSupply(id, el.dataset.status),
      "del-supply": () => delSupply(id),
      // procedures
      "edit-proc": () => editProc(el.dataset.kind),
      "save-proc": () => saveProc(el.dataset.kind),
      // maintenance
      "add-maint": maintForm,
      "save-maint": saveMaint,
      "del-maint": () => confirmDialog("Delete this record?", () => delMaint(id)),
    };
    if (A[act]) A[act](e);
  });

  // calendar day tap -> book from that day or show who's there
  document.addEventListener("click", (e) => {
    const cell = e.target.closest(".cal-cell[data-day]");
    if (!cell || state.tab !== "calendar") return;
    const day = cell.dataset.day;
    if (cell.classList.contains("booked")) {
      const b = (state._bookings || []).find((x) => x.start_date <= day && x.end_date >= day);
      if (b) openModal(
        '<div class="modal-head"><h2>' + esc(b.guest_name) + '</h2><div class="spacer"></div><button class="x" data-act="close">×</button></div>' +
        '<p>' + esc(fmtRange(b.start_date, b.end_date)) + "</p>" +
        (b.notes ? '<p class="muted">' + esc(b.notes) + "</p>" : "") +
        '<div class="actions"><button class="btn" data-act="close">Close</button></div>');
    } else {
      bookingForm(day);
    }
  });

  init();
})();
