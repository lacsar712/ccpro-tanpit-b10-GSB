import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "请求失败");
  return data;
}

function fmtTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    view: { type: String },
    board: { type: Object },
    log: { type: Object },
    yardInfo: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    villageDraft: { type: String },
    err: { type: String },
    msg: { type: String },
    saving: { type: Boolean },
    username: { type: String },
    password: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 20px 16px 50px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #8a5a2b; padding-bottom: 8px; margin-bottom: 16px; }
    .brand { font-size: 1.15em; font-weight: bold; color: #5a3a1b; }
    nav button { background: none; border: 0; border-bottom: 2px solid transparent; color: #5a3a1b; cursor: pointer; font: inherit; padding: 6px 10px; }
    nav button.active { border-bottom-color: #8a5a2b; font-weight: bold; }
    .banner { background: #f3ead9; border: 1px solid #d9c4a2; border-radius: 8px; padding: 12px 16px; margin-bottom: 14px; display: flex; align-items: baseline; gap: 14px; }
    .banner h2 { margin: 0; font-size: 1.4em; color: #5a3a1b; }
    .banner .village { font-size: 1.1em; color: #7a4a22; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; font: inherit; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .drawer { margin-top: 16px; border: 1px solid #d9c4a2; border-radius: 8px; padding: 12px 16px; background: #faf5ea; }
    .drawer .head { font-weight: bold; color: #5a3a1b; margin: 0 0 6px; }
    .err { color: #9b1c1c; }
    .ok { color: #3d6b2f; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    table { border-collapse: collapse; width: 100%; background: #fff; }
    th, td { border: 1px solid #d9c4a2; padding: 8px 10px; text-align: left; }
    th { background: #f3ead9; }
    .readonly { background: #f3ead9; border-radius: 6px; padding: 10px 14px; display: inline-block; font-size: 1.1em; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.view = "board";
    this.board = null;
    this.log = null;
    this.yardInfo = null;
    this.picked = null;
    this.ph = "4.2";
    this.villageDraft = "";
    this.err = "";
    this.msg = "";
    this.saving = false;
    this.username = "admin";
    this.password = "123456";
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) this.loadBoard();
  }

  async loadBoard() {
    try {
      this.board = await api("/api/board");
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || this.picked;
      }
    } catch (e) {
      this.err = e.message;
    }
  }

  async loadLog() {
    try {
      this.log = await api("/api/samples");
    } catch (e) {
      this.err = e.message;
    }
  }

  async loadYardInfo() {
    try {
      this.yardInfo = await api("/api/yard");
      this.villageDraft = this.yardInfo.village;
    } catch (e) {
      this.err = e.message;
    }
  }

  goto(view) {
    this.view = view;
    this.err = "";
    this.msg = "";
    // 每次切页都重拉：两名主管抢交村名时，谁进页看到的都是库里留下的那一版
    if (view === "board") this.loadBoard();
    if (view === "log") this.loadLog();
    if (view === "village") this.loadYardInfo();
  }

  async login(e) {
    e.preventDefault();
    this.err = "";
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      this.ready = true;
      this.view = "board";
      await this.loadBoard();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async writePh() {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/samples`, {
        method: "POST",
        body: JSON.stringify({ ph: Number(this.ph) }),
      });
      this.log = null; // 流水有新增，下次进流水页重拉
      await this.loadBoard();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async setStatus(status) {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await this.loadBoard();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async saveVillage(e) {
    e.preventDefault();
    this.err = "";
    this.msg = "";
    const name = this.villageDraft.trim();
    if (!name) {
      this.err = "村名不能为空";
      return;
    }
    this.saving = true;
    try {
      const data = await api("/api/yard/village", {
        method: "PATCH",
        body: JSON.stringify({ village: name }),
      });
      this.villageDraft = data.village;
      this.yardInfo = data;
      this.log = null; // 流水村列须跟新名，下次进流水页重拉
      await this.loadBoard(); // 楣条 + 抽屉首行同源刷新
      this.msg = `村名已改为「${data.village}」`;
    } catch (ex) {
      this.err = ex.message;
    } finally {
      this.saving = false;
    }
  }

  renderTopbar() {
    const tab = (view, label) =>
      html`<button class=${this.view === view ? "active" : ""} @click=${() => this.goto(view)}>${label}</button>`;
    return html`<div class="topbar">
      <span class="brand">南冈鞣场作业台</span>
      <nav>
        ${tab("board", "坑位场地图")}${tab("log", "浸液流水")}${tab("village", "村名专页")}
      </nav>
    </div>`;
  }

  renderBoard() {
    if (!this.board) return html`${this.err || "装载坑位…"}`;
    return html`
      <div class="banner">
        <h2>${this.board.yard}</h2><span class="village">所属：${this.board.village}</span>
      </div>
      <p class="hint">点坑登记浸液酸碱度；放液须最近读数 3.5～5.0</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => (this.picked = p)}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
          </button>`
        )}
      </div>
      ${this.picked
        ? html`<section class="drawer">
            <p class="head">${this.board.village} · ${this.picked.code} · ${LABELS[this.picked.status]}</p>
            <p>最近酸碱度：${this.picked.latestPh ?? "无"} · ${this.picked.sampleCount} 次</p>
            <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
            <button @click=${this.writePh}>登记酸碱度</button>
            <div>
              <button @click=${() => this.setStatus("fill")}>注液</button>
              <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
              <button @click=${() => this.setStatus("drained")}>已放液</button>
            </div>
          </section>`
        : ""}
    `;
  }

  renderLog() {
    if (!this.log) return html`${this.err || "装载流水…"}`;
    return html`
      <div class="banner"><h2>${this.log.yard} · 浸液流水</h2><span class="village">所属：${this.log.village}</span></div>
      <table>
        <thead><tr><th>村名</th><th>坑号</th><th>酸碱度</th><th>操作工</th><th>登记时间</th></tr></thead>
        <tbody>
          ${this.log.rows.map(
            (r) => html`<tr>
              <td>${r.village}</td><td>${r.pitCode}</td><td>${r.ph}</td><td>${r.operator}</td><td>${fmtTime(r.takenAt)}</td>
            </tr>`
          )}
        </tbody>
      </table>
      ${this.log.rows.length === 0 ? html`<p class="hint">暂无浸液登记</p>` : ""}
    `;
  }

  renderVillage() {
    if (!this.yardInfo) return html`${this.err || "装载村名…"}`;
    const isAdmin = this.yardInfo.role === "admin";
    return html`
      <div class="banner"><h2>${this.yardInfo.yard}</h2><span class="village">村名专页</span></div>
      ${isAdmin
        ? html`<form @submit=${this.saveVillage}>
            <label>所属村显示名
              <input .value=${this.villageDraft} @input=${(e) => (this.villageDraft = e.target.value)} maxlength="120" />
            </label>
            <p class="hint">只改村名显示名；坑位、酸碱读数、场名均不受影响。</p>
            <button ?disabled=${this.saving || !this.villageDraft.trim()}>${this.saving ? "保存中…" : "保存新村名"}</button>
          </form>`
        : html`<p>所属村显示名：<span class="readonly">${this.yardInfo.village}</span></p>
          <p class="hint">操作工进村名页只许浏览，改名请联系主管。</p>`}
    `;
  }

  render() {
    if (!this.ready) {
      return html`<div class="wrap">
        <h1>南冈鞣场</h1>
        <form @submit=${this.login} autocomplete="off">
          <label>用户名
            <input name="username" autocomplete="off" .value=${this.username} @input=${(e) => (this.username = e.target.value)} />
          </label>
          <label>密码
            <input name="password" type="password" autocomplete="off" .value=${this.password} @input=${(e) => (this.password = e.target.value)} />
          </label>
          <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
          <button>登录</button>
        </form>
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </div>`;
    }
    return html`<div class="wrap">
      ${this.renderTopbar()}
      ${this.view === "board" ? this.renderBoard() : ""}
      ${this.view === "log" ? this.renderLog() : ""}
      ${this.view === "village" ? this.renderVillage() : ""}
      ${this.msg ? html`<p class="ok">${this.msg}</p>` : ""}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }
}

customElements.define("tan-yard", TanYard);
