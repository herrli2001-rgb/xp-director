import { $, $$, api, button, el, notice, operation } from "../../media.js?v=40115cd331b5";
import { alignInkNav, animate, showInkSheet } from "./motion.js?v=40115cd331b5";

const categories = {
  text: { title: "文本与分镜", icon: "board", description: "用于剧本、分镜与提示词。", kinds: ["harness", "compatible"] },
  image: { title: "图像生成", icon: "photo", description: "用于竖屏图文、分镜参考图和首尾帧。", kinds: ["image"] },
  video: { title: "视频生成", icon: "play", description: "用首尾帧和提示词生成视频片段。", kinds: ["video"] },
  vision: { title: "视频拆解", icon: "aperture", description: "用于分析参考视频的画面和字幕。", kinds: ["vision"] },
};

const providers = {
  harness: { name: "DeepSeek Harness", connection: "DeepSeek Harness", defaultModel: "deepseek-v4-flash" },
  compatible: { name: "兼容文本模型", connection: "兼容 API", address: true },
  image: { name: "兼容生图模型", connection: "兼容 API", address: true },
  video: { name: "Seedance", connection: "方舟 Seedance" },
  vision: { name: "兼容视觉模型", connection: "视觉 API", address: true },
};

const defaultTextRoutes = categories.text.kinds.map((id) => ({ id, label: providers[id].name, available: false }));

export function initModelPanel({ runtime, route, setRoute, onModelsChanged }) {
  const dialog = $("#models-dialog");
  const nav = $(".ink-panel-nav", dialog);
  const page = $("#model-panel");
  const select = $("#model-select");
  const form = $("#connection-form");
  const key = $("#connection-key");
  const save = $("#connection-save");
  let category = "text";
  let connectionKind = "";

  function activeModel(kind) {
    return categories.text.kinds.includes(kind)
      ? runtime.models?.text.find((item) => item.id === kind)
      : runtime.models?.[kind];
  }

  function createModelCard(kind, icon) {
    const provider = providers[kind];
    const model = activeModel(kind);
    const isReady = !!model?.available;
    const isDefault = category === "text" && kind === route() && isReady;
    const state = isReady ? (isDefault ? "默认 · 已配置" : "已配置") : "待配置";
    const modelName = isReady ? model.label : provider.defaultModel || provider.connection;
    const card = button("", () => openConnection(kind), "model-card");
    card.dataset.modelKind = kind;
    card.setAttribute("aria-label", "配置 " + provider.name);
    card.setAttribute("aria-description", state + " · " + modelName);
    const tilt = el("span", "", "model-tilt");
    tilt.setAttribute("aria-hidden", "true");
    const rotor = el("span", "", "model-rotor");
    const front = el("span", "", "model-face model-front");
    const head = el("span", "", "model-card-top");
    const symbol = el("span", "", "model-icon");
    symbol.append(el("i", "", "nav-icon " + icon));
    head.append(symbol, el("span", state, "model-state"));
    const bottom = el("span", "", "model-card-bottom");
    bottom.append(el("span", modelName, "model-id"), el("span", "配置 ↗", "model-action"));
    front.append(head, el("strong", provider.name, "model-name"), bottom);
    const back = el("span", "", "model-face model-back");
    const backBottom = el("span", "", "model-card-bottom");
    backBottom.append(el("span", provider.name, "model-id"), el("span", "打开 ↗", "model-action"));
    back.append(el("span", categories[category].title, "model-back-kicker"), el("strong", "连接配置", "model-name"), backBottom);
    rotor.append(front, back);
    tilt.append(rotor);
    card.append(tilt);
    return card;
  }

  function refresh() {
    const current = categories[category];
    const focusedKind = document.activeElement?.dataset.modelKind;
    $("#model-panel-title").textContent = current.title;
    $("#model-panel-description").textContent = current.description;
    $("#model-cards").replaceChildren(...current.kinds.map((kind) => createModelCard(kind, current.icon)));
    $("#model-route-field").hidden = category !== "text" || !runtime.local;
    $("#models-local-note").textContent = runtime.local
      ? "模型配置应用到本次运行。"
      : "在本机工作台配置模型连接并运行生成任务。";
    $("#open-local").hidden = runtime.local;
    if (focusedKind && dialog.open) $("[data-model-kind=" + focusedKind + "]", page)?.focus({ preventScroll: true });
  }

  function selectCategory(next) {
    category = next;
    for (const tab of $$("[data-model-category]", nav)) {
      if (tab.dataset.modelCategory === next) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    refresh();
    page.scrollTop = 0;
    alignInkNav(nav);
    animate(page, "ink-page-in");
  }

  function openConnection(kind) {
    connectionKind = kind;
    const provider = providers[kind];
    const model = activeModel(kind);
    const local = runtime.local;
    $("#connection-title").textContent = provider.name;
    $("#connection-kind").value = provider.connection;
    $("#connection-url-field").hidden = !provider.address;
    $("#connection-url").disabled = !local || !provider.address;
    $("#connection-url").value = "";
    $("#connection-model").disabled = !local;
    $("#connection-model").value = model?.available ? model.label : provider.defaultModel || "";
    $("#connection-model").placeholder = "填写服务商的模型 ID";
    key.disabled = !local;
    key.value = "";
    key.placeholder = local ? "填写服务商的 API 密钥" : "在本机工作台填写";
    $("#connection-scope").textContent = local
      ? "密钥由本机运行器使用。第一次调用时验证服务响应。"
      : "打开本机工作台后，可以填写模型 ID 和 API 密钥。";
    $("#connection-local").hidden = local;
    save.hidden = !local;
    notice("#connection-notice");
    showInkSheet(dialog, "connection-title");
  }

  for (const entry of $$("[data-models]")) entry.addEventListener("click", () => {
    dialog.showModal();
    selectCategory(category);
  });
  for (const tab of $$("[data-model-category]", nav)) tab.addEventListener("click", () => selectCategory(tab.dataset.modelCategory));
  dialog.addEventListener("ink-sheet-closed", () => { key.value = ""; });
  select.addEventListener("change", () => {
    setRoute(select.value);
    try { localStorage.setItem("xp-director-text-route", select.value); } catch { /* Session selection still works. */ }
    onModelsChanged();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!runtime.local || !connectionKind || save.disabled) return;
    const kind = connectionKind;
    return operation(save, "#connection-notice", "正在应用…", async () => {
      const models = await api("models", { kind, model: $("#connection-model").value,
        address: $("#connection-url").value, key: key.value });
      key.value = "";
      runtime.models = models;
      if (categories.text.kinds.includes(kind)) setRoute(kind);
      onModelsChanged();
      if (dialog.open && connectionKind === kind && !$(".ink-sheet-layer", dialog).hidden) {
        notice("#connection-notice", "已应用到本次运行。", "success");
      }
    });
  });

  return {
    refreshRoutes() {
      const routes = runtime.models?.text ?? defaultTextRoutes;
      if (!routes.some((item) => item.id === route() && item.available)) {
        setRoute(routes.find((item) => item.available)?.id || "harness");
      }
      select.replaceChildren(...routes.map((item) => {
        const option = new Option(item.label + (item.available ? "" : " · 待连接"), item.id, false, item.id === route());
        option.disabled = !item.available;
        return option;
      }));
      select.disabled = !routes.some((item) => item.available);
      refresh();
      return routes.some((item) => item.id === route() && item.available);
    },
  };
}
