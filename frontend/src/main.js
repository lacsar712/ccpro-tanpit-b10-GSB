import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };
const ROLE_LABELS = { admin: "主管", worker: "操作工" };

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
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    me: { type: Object },
    board: { type: Object },
    flow: { type: Array },
    view: { type: String },
    picked: { type: Object },
    ph: { type: String },
    villageDraft: { type: String },
    err: { type: String },
    notice: { type: String },
    username: { type: String },
    password: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .topbar { display: flex; align-items: center; gap: 10px; background: #3a2c1e; color: #f5ead9; padding: 10px 18px; }
    .topbar .brand { font-size: 1.15em; font-weight: bold; margin-right: 12px; }
    .topbar button { font: inherit; background: none; border: 1px solid #8a7358; color: #f5ead9; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
    .topbar button.active { background: #8a5a2b; border-color: #8a5a2b; }
    .topbar .who { margin-left: auto; font-size: 0.92em; color: #d8c7ae; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 22px 16px 50px; }
    .banner { background: #8a5a2b; color: #fff; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
    .banner h1 { margin: 0; font-size: 1.5em; }
    .banner p { margin: 6px 0 0; color: #f0e2cc; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; font: inherit; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .err { color: #9b1c1c; }
    .ok { color: #3d6b35; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid #d9c9b2; padding: 6px 8px; text-align: left; }
    th { color: #6b5a48; }
    .drawer { position: fixed; top: 0; right: 0; width: 320px; height: 100%; box-sizing: border-box; background: #fbf6ec; box-shadow: -4px 0 18px rgba(0, 0, 0, 0.25); padding: 20px; overflow-y: auto; }
    .drawer .first { font-size: 1.2em; font-weight: bold; margin: 0 0 4px; }
    .ticket { border: 2px dashed #8a5a2b; border-radius: 8px; padding: 10px 12px; margin: 12px 0; background: #fff; }
    .ticket .cap { color: #6b5a48; font-size: 0.85em; letter-spacing: 2px; }
    .ticket p { margin: 4px 0; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.me = null;
    this.board = null;
    this.flow = [];
    this.view = "map";
    this.picked = null;
    this.ph = "4.2";
    this.villageDraft = "";
    this.err = "";
    this.notice = "";
    this.username = "admin";
    this.password = "123456";
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) this.bootstrap();
  }

  async bootstrap() {
    try {
      this.me = await api("/api/auth/me");
      await this.refresh();
    } catch (e) {
      this.err = e.message;
    }
  }

  async refresh() {
    try {
      this.board = await api("/api/board");
      this.flow = (await api("/api/flow")).rows;
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || null;
      }
    } catch (e) {
      this.err = e.message;
    }
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
      this.me = data.user;
      this.ready = true;
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.ready = false;
    this.me = null;
    this.board = null;
    this.flow = [];
    this.picked = null;
    this.view = "map";
    this.err = "";
    this.notice = "";
  }

  openView(view) {
    this.view = view;
    this.err = "";
    this.notice = "";
    if (view === "village") {
      this.picked = null;
      this.villageDraft = this.board ? this.board.village : "";
    }
  }

  async writePh() {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/samples`, {
        method: "POST",
        body: JSON.stringify({ ph: Number(this.ph) }),
      });
      await this.refresh();
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
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async saveVillage() {
    this.err = "";
    this.notice = "";
    const village = this.villageDraft.trim();
    if (!village) {
      this.err = "村名不能为空";
      return;
    }
    try {
      await api("/api/yard/village", { method: "PUT", body: JSON.stringify({ village }) });
      // 重新拉场地图与流水：楣条、抽屉首行、票夹、流水村列都吃库里留下的那一版。
      await this.refresh();
      this.villageDraft = this.board.village;
      this.notice = `村名已保存，当前为「${this.board.village}」`;
    } catch (ex) {
      this.err = ex.message;
    }
  }

  renderTopbar() {
    return html`<div class="topbar">
      <span class="brand">${this.board ? this.board.yard : "南冈鞣场"}</span>
      <button class=${this.view === "map" ? "active" : ""} @click=${() => this.openView("map")}>场地图</button>
      <button class=${this.view === "village" ? "active" : ""} @click=${() => this.openView("village")}>村名专页</button>
      <span class="who">${this.me ? `${this.me.username}（${ROLE_LABELS[this.me.role] || this.me.role}）` : ""}</span>
      <button @click=${this.logout}>退出</button>
    </div>`;
  }

  renderFlow() {
    if (!this.flow.length) return html`<p class="hint">尚无登记流水。</p>`;
    return html`<table>
      <thead><tr><th>时间</th><th>坑位</th><th>村</th><th>酸碱度</th><th>登记人</th></tr></thead>
      <tbody>
        ${this.flow.map(
          (r) => html`<tr>
            <td>${fmtTime(r.takenAt)}</td>
            <td>${r.pit}</td>
            <td>${this.board.village}</td>
            <td>${r.ph}</td>
            <td>${r.operator}</td>
          </tr>`
        )}
      </tbody>
    </table>`;
  }

  renderMap() {
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`<div class="wrap">
      <div class="banner">
        <h1>${this.board.yard} · ${this.board.village}</h1>
        <p>点坑登记浸液酸碱度；放液须最近读数 3.5～5.0</p>
      </div>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => (this.picked = p)}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
          </button>`
        )}
      </div>
      <h2>流水</h2>
      ${this.renderFlow()}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }

  renderDrawer() {
    const p = this.picked;
    return html`<aside class="drawer">
      <button style="float:right" @click=${() => (this.picked = null)}>收起</button>
      <p class="first">${this.board.village} · ${p.code}</p>
      <div class="ticket">
        <span class="cap">票夹 · 坑票</span>
        <p>${this.board.village} · ${this.board.yard}</p>
        <p>${p.code} · ${LABELS[p.status]}</p>
        <p>最近酸碱度：${p.latestPh ?? "无"} · ${p.sampleCount} 次</p>
      </div>
      <label>浸液酸碱度
        <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
      </label>
      <button @click=${this.writePh}>登记酸碱度</button>
      <div>
        <button @click=${() => this.setStatus("fill")}>注液</button>
        <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
        <button @click=${() => this.setStatus("drained")}>已放液</button>
      </div>
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </aside>`;
  }

  renderVillage() {
    if (!this.board) return html`<div class="wrap">${this.err || "装载…"}</div>`;
    const isAdmin = this.me && this.me.role === "admin";
    return html`<div class="wrap">
      <h1>村名专页</h1>
      <p>场名：<strong>${this.board.yard}</strong>（场名不在此更改）</p>
      <p>当前村名：<strong>${this.board.village}</strong></p>
      ${isAdmin
        ? html`<label>新村名
              <input .value=${this.villageDraft} @input=${(e) => (this.villageDraft = e.target.value)} placeholder="请输入村名" />
            </label>
            <button @click=${this.saveVillage}>保存村名</button>
            <p class="hint">只改村名：坑位、酸碱读数、场名都不动；空名不会落库。</p>`
        : html`<p class="hint">操作工只许浏览；改村名请找主管。</p>`}
      ${this.notice ? html`<p class="ok">${this.notice}</p>` : ""}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
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
    return html`
      ${this.renderTopbar()}
      ${this.view === "village" ? this.renderVillage() : this.renderMap()}
      ${this.picked && this.view === "map" ? this.renderDrawer() : ""}
    `;
  }
}

customElements.define("tan-yard", TanYard);
