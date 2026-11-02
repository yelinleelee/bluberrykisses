/* BluberryKisses — Supabase backend for the wedding village.
 * Provides window.claude.use('db' | 'user' | 'downloads') with the same
 * small API the game was written against, backed by one Supabase table
 * (public.docs) with realtime updates and anonymous sign-in per guest.
 */
(function () {
  "use strict";
  const cfg = window.BK_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  let sb = null, session = null, hostFlag = false, readyP = null;

  function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
  const lastSeg = p => String(p).split("/").pop();
  const parentOf = p => String(p).split("/").slice(0, -1).join("/");

  async function ready() {
    if (!enabled) return false;
    if (readyP) return readyP;
    readyP = (async () => {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: "bk-wedding-auth" },
        realtime: { params: { eventsPerSecond: 20 } }
      });
      const { data } = await sb.auth.getSession();
      session = data.session;
      if (!session) {
        const r = await sb.auth.signInAnonymously();
        if (r.error) throw r.error;
        session = r.data.session;
      }
      try { const r = await sb.rpc("is_host"); hostFlag = !r.error && r.data === true; } catch (e) { hostFlag = false; }
      return true;
    })().catch(e => { console.warn("[bk] supabase", e); readyP = null; return false; });
    return readyP;
  }

  /* ---------- documents ---------- */
  const cache = new Map(); // path -> data (last known)
  function snapDoc(path, data) {
    return { id: lastSeg(path), exists: data !== undefined && data !== null, data: () => data == null ? undefined : data,
      metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function snapQuery(rows) {
    const docs = rows.map(r => snapDoc(r.path, r.data));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((d, i) => ({ type: "added", doc: d, oldIndex: -1, newIndex: i })),
      metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function mapError(e) {
    if (!e) return err("unavailable");
    if (e.code === "42501" || /row-level security|permission/i.test(e.message || "")) return err("invalid_argument", "not allowed");
    return err("unavailable", e.message);
  }

  async function getDoc(path) {
    const { data, error } = await sb.from("docs").select("path,data").eq("path", path).maybeSingle();
    if (error) throw mapError(error);
    if (data) cache.set(path, data.data);
    return snapDoc(path, data ? data.data : undefined);
  }
  async function setDoc(path, body) {
    const row = { path, col: parentOf(path), data: body };
    const { error } = await sb.from("docs").upsert(row, { onConflict: "path" });
    if (error) throw mapError(error);
    cache.set(path, body);
  }
  function merge(a, b) {
    const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    for (const [k, v] of Object.entries(b)) {
      out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? merge(out[k], v) : v;
    }
    return out;
  }
  async function updateDoc(path, patch) {
    let base = cache.get(path);
    if (base === undefined) { const s = await getDoc(path); if (!s.exists) throw err("invalid_argument", "document does not exist"); base = s.data(); }
    await setDoc(path, merge(base, patch));
  }

  let chanSeq = 0;
  function subscribeDoc(path, next, onErr) {
    let dead = false, ch = null;
    (async () => {
      try { const s = await getDoc(path); if (!dead) next(s); } catch (e) { onErr && onErr(e); }
      if (dead) return;
      ch = sb.channel("doc-" + (++chanSeq)).on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "path=eq." + path }, p => {
        if (dead) return;
        if (p.eventType === "DELETE") { cache.delete(path); next(snapDoc(path, undefined)); }
        else { cache.set(path, p.new.data); next(snapDoc(path, p.new.data)); }
      }).subscribe();
    })();
    return () => { dead = true; if (ch) sb.removeChannel(ch); };
  }
  function subscribeCol(col, q, next, onErr) {
    let dead = false, ch = null, timer = null;
    const rows = new Map();
    const emit = () => { if (timer || dead) return; timer = setTimeout(() => { timer = null; if (!dead) next(snapQuery(sortRows([...rows.values()], q))); }, 250); };
    (async () => {
      try {
        const list = await runQuery(col, q);
        for (const r of list) rows.set(r.path, r);
        if (!dead) next(snapQuery(sortRows([...rows.values()], q)));
      } catch (e) { onErr && onErr(e); }
      if (dead) return;
      ch = sb.channel("col-" + (++chanSeq)).on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "col=eq." + col }, p => {
        if (dead) return;
        if (p.eventType === "DELETE") rows.delete(p.old.path);
        else { rows.set(p.new.path, { path: p.new.path, data: p.new.data }); cache.set(p.new.path, p.new.data); }
        emit();
      }).subscribe();
    })();
    return () => { dead = true; clearTimeout(timer); if (ch) sb.removeChannel(ch); };
  }
  function sortRows(list, q) {
    if (q.order) { const f = q.order.field, s = q.order.dir === "desc" ? -1 : 1; list.sort((a, b) => ((a.data || {})[f] > (b.data || {})[f] ? 1 : -1) * s); }
    else list.sort((a, b) => a.path < b.path ? -1 : 1);
    return q.limit ? list.slice(0, q.limit) : list;
  }
  async function runQuery(col, q) {
    let r = sb.from("docs").select("path,data").eq("col", col);
    if (q.order) r = r.order("data->" + q.order.field, { ascending: q.order.dir !== "desc" });
    r = r.limit(q.limit || 1000);
    const { data, error } = await r;
    if (error) throw mapError(error);
    return data || [];
  }

  function docRef(path) {
    return {
      id: lastSeg(path), path,
      get: () => getDoc(path),
      set: d => setDoc(path, d),
      update: d => updateDoc(path, d),
      delete: async () => { const { error } = await sb.from("docs").delete().eq("path", path); if (error) throw mapError(error); cache.delete(path); },
      onSnapshot: (n, e) => subscribeDoc(path, n, e),
      collection: c => colRef(path + "/" + c)
    };
  }
  function queryRef(col, q) {
    return {
      where() { return queryRef(col, q); },
      orderBy(field, dir) { return queryRef(col, Object.assign({}, q, { order: { field, dir: dir || "asc" } })); },
      limit(n) { return queryRef(col, Object.assign({}, q, { limit: n })); },
      get: async () => snapQuery(await runQuery(col, q)),
      onSnapshot: (n, e) => subscribeCol(col, q, n, e)
    };
  }
  function colRef(col) {
    const base = queryRef(col, {});
    return Object.assign(base, {
      path: col,
      doc: id => docRef(col + "/" + (id || Math.random().toString(36).slice(2) + Date.now().toString(36))),
      add: async d => { const r = docRef(col + "/" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)); await r.set(d); return r; }
    });
  }
  const DB = { doc: docRef, collection: colRef };

  /* ---------- user ---------- */
  const USER = {
    isOwner: async () => hostFlag,
    canEdit: async () => hostFlag,
    can: async () => null,
    id: async () => (session && session.user ? session.user.id : null),
    me: async () => ({ id: session && session.user ? session.user.id : null, name: "", avatarUrl: "", color: "#4E5DB5", email: null, isOwner: hostFlag, canEdit: hostFlag }),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: "", avatarUrl: "", color: "#4E5DB5", email: null, isMe: false, guest: false }]))
  };

  /* ---------- downloads (share sheet on phones, file download elsewhere) ---------- */
  const DOWNLOADS = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      try {
        const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return { status: "saved" }; }
      } catch (e) { if (e && e.name === "AbortError") throw err("declined"); }
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { status: "saved" };
    }
  };

  /* ---------- host sign-in ---------- */
  window.BK = {
    enabled,
    ready,
    async claimHost(pw) {
      if (!(await ready())) return { ok: false, msg: "저장소에 연결되지 않았어요" };
      const r = await sb.rpc("claim_host", { pw });
      if (r.error) return { ok: false, msg: "확인하지 못했어요. 잠시 후 다시 해주세요" };
      if (r.data === true) { hostFlag = true; return { ok: true }; }
      return { ok: false, msg: "비밀번호가 맞지 않아요" };
    },
    async leaveHost() { if (await ready()) { await sb.rpc("leave_host"); hostFlag = false; } }
  };

  window.claude = {
    use: async name => {
      if (name === "downloads") return DOWNLOADS;
      if (!(await ready())) return null;
      if (name === "db") return DB;
      if (name === "user") return USER;
      return null;
    }
  };
})();
