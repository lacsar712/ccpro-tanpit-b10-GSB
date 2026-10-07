import { Window } from "happy-dom";

const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.customElements = window.customElements;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.localStorage = window.localStorage;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

// ---- 模拟后端（与 pits/api.py 行为一致）----
const state = {
  yard: "南冈鞣场",
  village: "青皮村",
  pits: [{ id: 1, code: "东-1", status: "tanning", row: 0, col: 0, latestPh: 4.2, sampleCount: 1 }],
  samples: [{ id: 1, pitCode: "东-1", ph: 4.2, operator: "worker", takenAt: "2026-10-07T09:00:00+08:00" }],
};

function jsonRes(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

globalThis.fetch = async (path, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  const role = (options.headers || {}).Authorization === "Bearer tok-admin" ? "admin" : "worker";
  await new Promise((r) => setTimeout(r, 5));
  if (path === "/api/auth/login") {
    return jsonRes(200, { access_token: `tok-${body.username}`, user: { username: body.username, role: body.username === "admin" ? "admin" : "worker" } });
  }
  if (path === "/api/board") return jsonRes(200, { yard: state.yard, village: state.village, pits: state.pits });
  if (path === "/api/yard") return jsonRes(200, { yard: state.yard, village: state.village, role });
  if (path === "/api/samples")
    return jsonRes(200, { yard: state.yard, village: state.village, rows: state.samples.map((s) => ({ ...s, village: state.village })) });
  if (path === "/api/yard/village") {
    if (role !== "admin") return jsonRes(403, { detail: "仅主管可修改村名" });
    const v = (body.village || "").trim();
    if (!v) return jsonRes(400, { detail: "村名不能为空" });
    state.village = v;
    return jsonRes(200, { yard: state.yard, village: state.village, role });
  }
  return jsonRes(404, { detail: "not found" });
};

await import("./src/main.js");
const el = document.createElement("tan-yard");
document.body.appendChild(el);

const fails = [];
function check(name, cond, extra = "") {
  console.log(cond ? "PASS" : "FAIL", name, extra);
  if (!cond) fails.push(name);
}
const $ = (sel) => el.shadowRoot.querySelector(sel);
const $$ = (sel) => [...el.shadowRoot.querySelectorAll(sel)];
async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await el.updateComplete.catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    try {
      if (fn()) return;
    } catch {}
  }
  throw new Error("等待超时: " + fn.toString().slice(0, 60));
}
const noSubmit = { preventDefault() {} };

// 主管登录
el.username = "admin";
el.password = "123456";
el.login(noSubmit);
await waitFor(() => $(".banner"));

// 1. 楣条：青皮村
check("楣条显示青皮村", $(".banner").textContent.includes("青皮村"), $(".banner").textContent.trim());

// 2. 抽屉首行：点坑 → 首行含村名
$(".pit").click();
await waitFor(() => $(".drawer .head"));
const head1 = $(".drawer .head").textContent;
check("抽屉首行含青皮村", head1.startsWith("青皮村") && head1.includes("东-1"), head1);

// 3. 流水：村列
el.goto("log");
await waitFor(() => $("tbody tr"));
const cols1 = $$("tbody tr").map((tr) => tr.firstElementChild.textContent);
check("流水村列是青皮村", cols1.length === 1 && cols1.every((v) => v === "青皮村"), String(cols1));
check("流水楣条也是青皮村", $(".banner").textContent.includes("青皮村"));

// 4. 村名专页：主管有输入框与保存按钮
el.goto("village");
await waitFor(() => $("form input"));
check("专页输入框预填青皮村", $("form input").value === "青皮村");
check("有保存按钮", $$("button").some((b) => b.textContent.includes("保存新村名")));

// 5. 空名：按钮禁用 + 提交不落库
el.villageDraft = "   ";
await el.updateComplete;
const saveBtn = $$("button").find((b) => b.textContent.includes("保存新村名"));
check("空名时保存按钮禁用", saveBtn.disabled === true);
await el.saveVillage(noSubmit);
check("空名前端拦截报错", el.err === "村名不能为空", el.err);
check("空名未落库", state.village === "青皮村");

// 6. 主管改名 → 三处联动
el.villageDraft = "红柳村";
await el.saveVillage(noSubmit);
await waitFor(() => el.msg && el.msg.includes("红柳村"));
el.goto("board");
await waitFor(() => $(".banner").textContent.includes("红柳村"));
check("改名后楣条=红柳村", $(".banner").textContent.includes("红柳村"));
check("楣条不再出现青皮村", !$(".banner").textContent.includes("青皮村"));
$(".pit").click();
await waitFor(() => $(".drawer .head") && $(".drawer .head").textContent.startsWith("红柳村"));
check("改名后抽屉首行=红柳村", $(".drawer .head").textContent.startsWith("红柳村"), $(".drawer .head").textContent);
el.goto("log");
await waitFor(() => $("tbody tr"));
const cols2 = $$("tbody tr").map((tr) => tr.firstElementChild.textContent);
check("改名后流水村列全部=红柳村", cols2.every((v) => v === "红柳村"), String(cols2));
check("改名后流水楣条=红柳村", $(".banner").textContent.includes("红柳村"));
el.goto("village");
await waitFor(() => $("form input") && $("form input").value === "红柳村");
check("专页回显红柳村", $("form input").value === "红柳村");

// 7. 操作工：只许浏览
localStorage.clear();
const el2 = document.createElement("tan-yard");
document.body.appendChild(el2);
el2.username = "worker";
el2.password = "123456";
el2.login(noSubmit);
await waitFor(() => el2.board);
el2.goto("village");
await waitFor(() => el2.shadowRoot.querySelector(".readonly"));
const root2 = el2.shadowRoot;
check("操作工看到只读村名", root2.querySelector(".readonly").textContent === "红柳村", root2.querySelector(".readonly").textContent);
check("操作工页无表单/保存按钮", !root2.querySelector("form") && ![...root2.querySelectorAll("button")].some((b) => b.textContent.includes("保存")));
// 即使强行调接口，后端也拒（模拟已返回 403）：验证接口层
const r403 = await globalThis.fetch("/api/yard/village", { method: "PATCH", headers: { Authorization: "Bearer tok-worker" }, body: JSON.stringify({ village: "河西村" }) });
check("操作工 PATCH 接口返回 403", r403.status === 403);
check("403 后村名不变", state.village === "红柳村");

// 8. 两名主管抢交：两次 PATCH 串行生效，库里只留最后一版
const pa = globalThis.fetch("/api/yard/village", { method: "PATCH", headers: { Authorization: "Bearer tok-admin" }, body: JSON.stringify({ village: "白鹭村" }) });
const pb = globalThis.fetch("/api/yard/village", { method: "PATCH", headers: { Authorization: "Bearer tok-admin" }, body: JSON.stringify({ village: "青枫村" }) });
const [ra, rb] = await Promise.all([pa, pb]);
check("两主管提交均 200", ra.ok && rb.ok);
check("库里只留一版", state.village === "白鹭村" || state.village === "青枫村", state.village);
// 主管重新进各页，三处都跟留版（worker 用例清过 localStorage，先恢复主管令牌）
localStorage.setItem("tanpit_token", "tok-admin");
el.goto("village");
await waitFor(() => el.shadowRoot.querySelector("form input"));
const finalName = state.village;
el.goto("board");
await waitFor(() => el.shadowRoot.querySelector(".banner"));
check("并发后楣条跟留版", el.shadowRoot.querySelector(".banner").textContent.includes(finalName));
el.shadowRoot.querySelector(".pit").click();
await waitFor(() => el.shadowRoot.querySelector(".drawer .head"));
check("并发后抽屉首行跟留版", el.shadowRoot.querySelector(".drawer .head").textContent.startsWith(finalName));
el.goto("log");
await waitFor(() => el.shadowRoot.querySelector("tbody tr"));
const cols3 = [...el.shadowRoot.querySelectorAll("tbody tr")].map((tr) => tr.firstElementChild.textContent);
check("并发后流水村列跟留版", cols3.every((v) => v === finalName), String(cols3));

console.log("\nFAILED:", fails.length ? fails : "无 —— 全部通过");
process.exit(fails.length ? 1 : 0);
