import { initAccount } from "./auth.js";
import { assetUrl, formats, loadWorkspace, looks, newProject, newShot, outline, projectFiles, readBlob,
  reviewItems, saveAsset, saveWorkspace, shotLabel, timecode, timeline, totalDuration } from "./projects.js";
import { $, $$, api, button, downloadZip, el, importGenerated, initMedia, notice, operation, upload } from "./media.js";

const workspace = loadWorkspace();
const runtime = { local: false };
const viewNames = { overview: "影片项目", storyboard: "分镜板", assets: "素材库", review: "审片与交付",
  trends: "趋势研究", watch: "竞品拆解", photos: "竖屏图文" };
const project = () => workspace.projects.find((item) => item.id === workspace.active);
let selected = project().shots[project().example ? 2 : 0]?.id;
let previewRatio = project().ratio;
let shotDraft, videoDraft, rename = false, stageVersion = 0, toastTimer;
let textRoute = "harness";
try { textRoute = localStorage.getItem("xp-director-text-route") || textRoute; } catch { /* Optional preference. */ }

function toast(message) {
  $("#toast").textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").textContent = ""; }, 4200);
}

function persist(record) {
  if (record) record.updated = new Date().toISOString();
  try { saveWorkspace(workspace); }
  catch { toast("浏览器空间不足，项目未能保存。请先导出制作记录。"); }
}

function go(view, scroll = true) {
  if (!Object.hasOwn(viewNames, view)) view = "overview";
  for (const tab of $$("[data-view]")) {
    if (tab.dataset.view === view) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  for (const panel of $$("[data-panel]")) panel.hidden = panel.dataset.panel !== view;
  $("#view-label").textContent = viewNames[view];
  if (scroll) window.scrollTo({ top: 0 });
}

function checked(record, index) {
  return record.reviews.findLast((event) => event.index === index)?.passed === true;
}

function invalidate(record, from = 0) {
  for (let index = from; index < reviewItems.length; index++) {
    if (checked(record, index)) record.reviews.push({ index, check: reviewItems[index], passed: false, date: new Date().toISOString() });
  }
  if (from <= 2 && record.film) {
    record.film = null;
    if (record === project()) showFilm(null);
  }
}

function mediaNode(asset, controls = true) {
  const kind = asset.type.split("/")[0];
  const node = el(kind === "image" ? "img" : kind);
  if (kind === "image") {
    node.alt = asset.name;
  } else {
    node.controls = controls;
    node.preload = "metadata";
    if (kind === "video") node.playsInline = true;
  }
  assetUrl(asset).then((source) => { if (source) node.src = source; }).catch(() => {});
  return node;
}

function renderStage() {
  const record = project();
  const shot = record.shots.find((item) => item.id === selected);
  const index = record.shots.indexOf(shot);
  const frame = record.assets.find((asset) => asset.id === (shot?.clip || shot?.first || shot?.last));
  const canvas = $("#stage-viewport");
  const revision = ++stageVersion;
  canvas.dataset.ratio = previewRatio;
  $$("[data-ratio]", $("#preview-ratios")).forEach((control) => control.setAttribute("aria-pressed", String(control.dataset.ratio === previewRatio)));
  canvas.replaceChildren(el("p", frame ? "正在读取素材…" : "添加首帧或视频片段后预览。", "muted"));
  if (frame) {
    assetUrl(frame).then((source) => {
      if (revision !== stageVersion || !source) return;
      const node = mediaNode(frame);
      node.addEventListener("error", () => {
        if (revision === stageVersion) canvas.replaceChildren(el("p", "素材无法预览，请重新导入。", "muted"));
      });
      canvas.replaceChildren(node);
    }).catch(() => {
      if (revision === stageVersion) canvas.replaceChildren(el("p", "素材无法预览。", "muted"));
    });
  }
  $("#stage-caption").textContent = frame?.name || "镜头素材";
  $("#shot-code").textContent = shot ? shotLabel(index) : "";
  $("#shot-name").textContent = shot?.title || "选择一个镜头";
  $("#shot-action").textContent = shot?.action || "";
  $("#shot-camera").textContent = shot?.camera || "—";
  $("#shot-duration").textContent = shot ? shot.seconds + " 秒" : "—";
  $("#shot-frames").textContent = shot ? (shot.first ? "首帧" + (shot.last ? " / 尾帧" : "") : "待添加") : "—";
  $("#shot-model").textContent = runtime.models?.video?.available ? runtime.models.video.label : "待连接";
  $("#edit-current-shot").disabled = !shot;
  $("#open-video").disabled = !shot;
  const task = shot && record.ledger.findLast((entry) => entry.shot === shot.id);
  notice("#shot-status", task ? "最近任务 · " + statusName(task.state) : "");
}

function renderTimeline() {
  const record = project();
  const track = $("#timeline-track");
  const shots = timeline(record.shots);
  const duration = totalDuration(record.shots);
  $("#timeline-summary").textContent = shots.length + " 个镜头 · " + duration + " / " + record.duration + " 秒";
  track.replaceChildren();
  if (!shots.length) track.append(el("p", "写好简报后起稿，或添加一个空镜头。", "muted"));
  shots.forEach((shot) => {
    const card = button("", () => {
      selected = shot.id;
      track.querySelectorAll("button").forEach((control) => control.setAttribute("aria-pressed", String(control === card)));
      renderStage();
    }, "timeline-shot");
    card.setAttribute("aria-pressed", String(shot.id === selected));
    card.append(el("span", shot.label), el("strong", shot.title), el("small", timecode(shot.start) + "–" + timecode(shot.end)));
    track.append(card);
  });
}

function renderStoryboard() {
  const record = project();
  const grid = $("#storyboard-grid");
  grid.replaceChildren();
  if (!record.shots.length) grid.append(el("p", "还没有分镜。", "muted"));
  timeline(record.shots).forEach((shot, index) => {
    const card = el("article", "", "panel card");
    const media = record.assets.find((item) => item.id === (shot.first || shot.last));
    if (media) card.append(mediaNode(media));
    card.append(el("span", shot.label + "  " + timecode(shot.start) + "–" + timecode(shot.end), "eyebrow"),
      el("h3", shot.title), el("p", shot.action || "待写动作", "muted"));
    if (shot.camera) card.append(el("p", shot.camera, "muted"));
    const controls = el("div", "", "card-actions");
    const up = button("上移", () => {
      [record.shots[index - 1], record.shots[index]] = [record.shots[index], record.shots[index - 1]];
      invalidate(record); persist(record); renderProject();
    });
    up.disabled = index === 0;
    controls.append(button("编辑", () => editShot(shot.id)), up);
    card.append(controls);
    grid.append(card);
  });
}

function renderAssets() {
  const record = project();
  const target = $("#asset-grid");
  target.replaceChildren();
  if (!record.assets.length) target.append(el("p", "导入首尾帧、视频片段或声音素材。", "muted"));
  record.assets.forEach((asset) => {
    const item = el("article", "", "panel card");
    item.append(mediaNode(asset), el("h3", asset.name), el("p", asset.type, "muted"));
    target.append(item);
  });
}

function renderReview() {
  const record = project();
  const target = $("#review-checklist");
  target.replaceChildren();
  reviewItems.forEach((text, index) => {
    const label = el("label", "", "checkbox");
    const control = el("input");
    control.type = "checkbox";
    control.checked = checked(record, index);
    control.onchange = () => {
      record.reviews.push({ index, check: text, passed: control.checked, date: new Date().toISOString() });
      persist(record);
    };
    label.append(control, el("span", text));
    target.append(label);
  });
  $("#render-film").disabled = !runtime.render || !record.shots.length || record.shots.some((shot) => !shot.clip);
  if (!runtime.render) notice("#render-status", "使用本机运行器合成片段。");
  else if ($("#render-film").disabled) notice("#render-status", "请给每个分镜关联一条视频片段。");
  else if (!record.film) notice("#render-status");
}

function renderProject() {
  const record = project();
  $("#project-list").replaceChildren(...workspace.projects.map((item) => new Option(item.title, item.id, false, item.id === record.id)));
  $("#project-kind").textContent = record.example ? "示例项目" : "影片项目";
  $("#project-title").textContent = record.title;
  $("#project-spec").textContent = formats[record.ratio] + " " + record.ratio + " · " + record.duration + " 秒";
  $("#brief-input").value = record.brief;
  $("#project-ratio").value = record.ratio;
  $("#project-duration").value = record.duration;
  $("#project-look").value = record.look;
  $("#story-text").value = record.story;
  $("#design-text").value = record.design;
  renderTimeline();
  renderStage();
  renderStoryboard();
  renderAssets();
  renderReview();
  media.renderPhotos();
}

function editShot(id) {
  const record = project();
  const shot = record.shots.find((item) => item.id === id) || newShot();
  shotDraft = { record, shot, existing: Boolean(id) };
  const options = (kind, current) => [new Option("待关联", ""), ...record.assets.filter((asset) => asset.type.startsWith(kind + "/"))
    .map((asset) => new Option(asset.name, asset.id, false, current === asset.id))];
  for (const [name, value] of Object.entries({
    title: shot.title, action: shot.action, camera: shot.camera, seconds: shot.seconds,
    "first-description": shot.firstDescription, "last-description": shot.lastDescription, prompt: shot.prompt
  })) $("#edit-" + name).value = value;
  $("#edit-first").replaceChildren(...options("image", shot.first));
  $("#edit-last").replaceChildren(...options("image", shot.last));
  $("#edit-clip").replaceChildren(...options("video", shot.clip));
  $("#shot-dialog-title").textContent = id ? "编辑镜头" : "添加镜头";
  $("#remove-shot").hidden = !id;
  $("#frame-status").textContent = "";
  for (const control of $$("[data-generate-frame]")) control.disabled = !runtime.models?.image?.available;
  $("#shot-dialog").showModal();
}

function saveShot(event) {
  event.preventDefault();
  const { record, shot, existing } = shotDraft;
  const value = (key) => $("#edit-" + key).value.trim();
  if (!value("title")) return toast("请填写镜头名称。");
  if (!existing && record.shots.length >= 16) return toast("每个影片项目最多 16 个镜头。");
  Object.assign(shot, { title: value("title"), seconds: Number(value("seconds")), action: value("action"), camera: value("camera"),
    firstDescription: value("first-description"), lastDescription: value("last-description"),
    first: value("first"), last: value("last"), clip: value("clip"), prompt: value("prompt") });
  if (!existing) record.shots.push(shot);
  selected = shot.id;
  invalidate(record);
  persist(record);
  renderProject();
  $("#shot-dialog").close();
}

function confirmReplace() {
  if (!project().shots.length) return Promise.resolve(true);
  const dialog = $("#replace-dialog");
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "replace"), { once: true }));
}

async function createPlan(useModel) {
  const record = project();
  const control = $(useModel ? "#generate-plan" : "#outline-plan");
  const duration = $("#project-duration");
  if (!duration.value || !duration.reportValidity()) return notice("#brief-status", "请输入 10–180 的整数秒数。", "error");
  record.duration = duration.valueAsNumber;
  if (!record.brief.trim()) return notice("#brief-status", "请先填写故事想法。", "error");
  if (!await confirmReplace()) return;
  return operation(control, "#brief-status", useModel ? "模型正在编写故事、分镜与提示词…" : "正在整理四个叙事段落…", async () => {
    if (useModel) {
      const result = await api("film/plan", { route: textRoute, brief: record.brief, ratio: record.ratio, duration: record.duration, look: looks[record.look] });
      record.shots = result.shots.map((shot) => newShot(shot));
      record.story = result.story;
      record.design = result.design;
    } else {
      record.shots = outline(record);
    }
    invalidate(record);
    persist(record);
    if (project() === record) {
      selected = record.shots[0]?.id;
      renderProject();
    }
    notice("#brief-status", (useModel ? "已写入" : "已套用模板，建立") + " " + record.shots.length + " 个镜头。", "success");
  });
}

function fileName(name) {
  return name.replace(/[^\p{L}\p{N}_.-]/gu, "_").slice(0, 62) || "XP-Director";
}

async function localAsset(record, id) {
  if (!id) return "";
  const asset = record.assets.find((item) => item.id === id);
  const blob = asset?.bundled ? await fetch(asset.bundled).then((response) => response.ok ? response.blob() : null) : await readBlob(id);
  return (await upload(blob)).id;
}

function showFilm(asset) {
  const preview = $("#film-preview");
  const link = $("#download-film");
  preview.hidden = !asset;
  link.hidden = !asset;
  if (!asset) {
    preview.removeAttribute("src");
    preview.load();
    link.removeAttribute("href");
    return;
  }
  assetUrl(asset).then((url) => {
    if (project().film?.id !== asset.id || !url) return;
    preview.src = url;
    link.href = url;
    link.download = fileName(project().title) + ".mp4";
  }).catch(() => notice("#render-status", "暂时无法读取预览文件。", "error"));
}

const statusName = (state) => ({
  submitting: "正在确认回执", submitted: "已提交", uncertain: "回执不确定", queued: "排队中",
  running: "生成中", succeeded: "已生成", failed: "失败", expired: "已过期", cancelled: "已取消"
})[state] || state;

function openVideo() {
  const record = project();
  const shot = record.shots.find((item) => item.id === selected);
  if (!shot) return;
  videoDraft = { record, shot };
  $("#video-spec").textContent = shotLabel(record.shots.indexOf(shot)) + " · " + shot.title + " · " + record.ratio
    + " · " + (runtime.models?.video?.label || "Seedance") + " · 720p";
  $("#video-seconds").value = Math.min(shot.seconds, 20);
  $("#video-estimate").value = "";
  $("#video-consent").checked = false;
  const task = record.ledger.findLast((entry) => entry.shot === shot.id && entry.job);
  $("#video-query").hidden = !task?.job;
  $("#video-submit").disabled = !runtime.models?.video?.available || !shot.first || !shot.prompt;
  if (task) notice("#video-status", "已有任务 · " + statusName(task.state) + (task.task ? " · " + task.task : ""));
  else if (!runtime.models?.video?.available) notice("#video-status", "请连接本地运行器并配置 Seedance。");
  else if (!shot.first || !shot.prompt) notice("#video-status", "请先保存首帧与视频提示词。");
  else notice("#video-status");
  $("#video-dialog").showModal();
}

function updateModels() {
  const available = runtime.models;
  const select = $("#model-select");
  const routes = available?.text || [{ id: "harness", label: "DeepSeek Harness", available: false },
    { id: "compatible", label: "兼容文本 API", available: false }];
  if (!routes.some((item) => item.id === textRoute && item.available)) {
    textRoute = routes.find((item) => item.available)?.id || "harness";
  }
  select.replaceChildren(...routes.map((item) => {
    const option = new Option(item.label + (item.available ? "" : " · 待连接"), item.id, false, item.id === textRoute);
    option.disabled = !item.available;
    return option;
  }));
  select.disabled = !routes.some((item) => item.available);
  $("#generate-plan").disabled = !routes.some((item) => item.id === textRoute && item.available);
  $("#models-local-note").textContent = runtime.local ? "本机运行器已连接。" : "模型、采集和视频处理由本机运行器执行。";
  $("#runtime-label").textContent = runtime.local ? "本机运行器在线" : "网页工作台";
  $("#open-local").hidden = runtime.local;
  $("#connection-settings").hidden = !runtime.local;
  $("#model-status").replaceChildren(...[["生图", available?.image], ["视频", available?.video], ["视频分析", available?.vision]].map(([title, model]) => {
    const row = el("div");
    row.append(el("dt", title), el("dd", model?.available ? model.label : "待配置"));
    return row;
  }));
  renderStage();
  renderReview();
  media.updateAvailability();
  media.renderPhotos();
}

const media = initMedia({ project, persist, runtime, route: () => textRoute,
  canWrite: () => runtime.models?.text.some((item) => item.id === textRoute && item.available) });

for (const control of $$("[data-view]")) control.onclick = () => go(control.dataset.view);
for (const control of $$("[data-close]")) control.onclick = () => control.closest("dialog").close();
for (const control of $$("[data-models]")) control.onclick = () => $("#models-dialog").showModal();
$("#model-select").onchange = (event) => {
  textRoute = event.target.value;
  try { localStorage.setItem("xp-director-text-route", textRoute); } catch { /* Session selection still works. */ }
  updateModels();
};
$("#connection-kind").onchange = (event) => {
  const kind = event.target.value;
  $("#connection-url-field").hidden = !["compatible", "image", "vision"].includes(kind);
  $("#connection-url").value = "";
  $("#connection-key").value = "";
  $("#connection-model").value = kind === "harness" ? "deepseek-v4-flash" : "";
  notice("#connection-notice");
};
$("#connection-form").onsubmit = (event) => {
  event.preventDefault();
  const kind = $("#connection-kind").value;
  return operation($("#connection-save"), "#connection-notice", "正在应用…", async () => {
    const models = await api("models", { kind, model: $("#connection-model").value, address: $("#connection-url").value,
      key: $("#connection-key").value });
    $("#connection-key").value = "";
    runtime.models = models;
    if (["harness", "compatible"].includes(kind)) textRoute = kind;
    updateModels();
    notice("#connection-notice", "已保存到当前运行器。第一次调用时验证服务响应。", "success");
  });
};
$("#project-list").onchange = (event) => {
  workspace.active = event.target.value;
  selected = project().shots[0]?.id;
  previewRatio = project().ratio;
  persist();
  renderProject();
  const currentFilm = project().film;
  if (!currentFilm) showFilm(null);
  else showFilm(currentFilm);
  go("overview");
};
for (const id of ["new-project", "rename-project"]) $("#" + id).onclick = () => {
  rename = id === "rename-project";
  $("#project-name").value = rename ? project().title : "";
  $("#project-dialog-title").textContent = rename ? "重命名项目" : "新建项目";
  $("#project-dialog").showModal();
};
$("#project-form").onsubmit = (event) => {
  event.preventDefault();
  const title = $("#project-name").value.trim();
  if (!title) return toast("请填写项目名称。");
  if (rename) project().title = title;
  else {
    const item = newProject(title);
    workspace.projects.push(item);
    workspace.active = item.id;
    selected = undefined;
    previewRatio = item.ratio;
    showFilm(null);
  }
  persist(project());
  renderProject();
  $("#project-dialog").close();
  go("overview");
};

for (const [id, key] of [["brief-input", "brief"], ["story-text", "story"], ["design-text", "design"]]) {
  $("#" + id).oninput = (event) => {
    const record = project();
    record[key] = event.target.value;
    invalidate(record);
    persist(record);
    renderReview();
  };
}
$("#project-duration").oninput = (event) => {
  if (!event.target.value || !event.target.validity.valid) return;
  const record = project();
  record.duration = event.target.valueAsNumber;
  invalidate(record);
  persist(record);
  $("#project-spec").textContent = formats[record.ratio] + " " + record.ratio + " · " + record.duration + " 秒";
  renderTimeline();
  renderReview();
};
for (const [id, key] of [["project-ratio", "ratio"], ["project-look", "look"]]) {
  $("#" + id).onchange = (event) => {
    const record = project();
    record[key] = event.target.value;
    if (key === "ratio") previewRatio = record.ratio;
    invalidate(record);
    persist(record);
    renderProject();
  };
}
for (const button of $$("[data-ratio]", $("#preview-ratios"))) button.onclick = () => {
  previewRatio = button.dataset.ratio;
  renderStage();
};
$("#generate-plan").onclick = () => createPlan(true);
$("#outline-plan").onclick = () => createPlan(false);
$("#open-storyboard").onclick = () => go("storyboard");
$("#edit-current-shot").onclick = () => editShot(selected);
$("#add-shot").onclick = $("#storyboard-add").onclick = () => editShot();
$("#shot-form").onsubmit = saveShot;
$("#remove-shot").onclick = () => {
  const { record, shot } = shotDraft;
  if (!confirm("移除这个镜头？素材仍在素材库里。")) return;
  record.shots = record.shots.filter((item) => item.id !== shot.id);
  selected = record.shots[0]?.id;
  invalidate(record); persist(record); renderProject(); $("#shot-dialog").close();
};
for (const control of $$("[data-generate-frame]")) control.onclick = () => operation(control, "#frame-status", "正在生成画面…", async () => {
  const key = control.dataset.generateFrame;
  const draft = shotDraft;
  const composition = $("#edit-" + key + "-description").value.trim();
  if (!composition) throw new Error("请先写出该画面的构图。");
  const { record } = draft;
  const image = await api("photos/image", { ratio: record.ratio,
    prompt: [composition, record.design, "画幅 " + record.ratio + "。画面无叠加文字。"].join("\n") });
  const asset = await importGenerated(image, $("#edit-title").value.trim() + (key === "first" ? " · 首帧" : " · 尾帧"));
  record.assets.push(asset); persist(record); renderAssets();
  if (shotDraft === draft && $("#shot-dialog").open) {
    for (const select of [$("#edit-first"), $("#edit-last")]) select.add(new Option(asset.name, asset.id));
    $("#edit-" + key).value = asset.id;
    notice("#frame-status", "图片已加入素材库。保存镜头后关联。", "success");
  }
});

$("#asset-input").onchange = async (event) => {
  const record = project();
  const selectedFiles = [...event.target.files];
  let added = 0;
  try {
    for (const file of selectedFiles) {
      if (!/^(image\/(jpeg|png|webp)|video\/(mp4|quicktime|webm)|audio\/(mpeg|wav))$/.test(file.type) || file.size > 90_000_000) {
        throw new Error("不支持的格式，或文件大于 90 MB。");
      }
      record.assets.push(await saveAsset(file));
      persist(record);
      added++;
    }
    notice("#asset-status", "已导入 " + added + " 个素材。", "success");
  } catch (error) {
    notice("#asset-status", (added ? "已导入 " + added + " 个素材。 " : "") + error.message, "error");
  } finally {
    if (record === project()) renderAssets();
    event.target.value = "";
  }
};
$("#open-video").onclick = openVideo;
$("#video-form").onsubmit = (event) => {
  event.preventDefault();
  if (!$("#video-consent").checked || !videoDraft) return;
  const { record, shot } = videoDraft;
  const seconds = Number($("#video-seconds").value), estimate = Number($("#video-estimate").value);
  return operation($("#video-submit"), "#video-status", "正在检查首尾帧并提交一次请求…", async () => {
    const first = await localAsset(record, shot.first);
    const last = await localAsset(record, shot.last);
    const result = await api("video/submit", { first, last, seconds, estimate, ratio: record.ratio, prompt: shot.prompt, confirmed: true });
    if (!record.ledger.some((entry) => entry.job === result.job && entry.shot === shot.id)) record.ledger.push({
      date: new Date().toISOString(), shot: shot.id, label: shotLabel(record.shots.indexOf(shot)), estimate, currency: "CNY",
      seconds, ratio: record.ratio, confirmed: true, ...result
    });
    persist(record);
    if (project() === record) renderStage();
    $("#video-query").hidden = false;
    $("#video-consent").checked = false;
    notice("#video-status", statusName(result.state) + (result.task ? " · " + result.task : " · 请到方舟控制台核对回执。"));
  });
};
$("#video-query").onclick = () => operation($("#video-query"), "#video-status", "正在查询已有任务…", async () => {
  const { record, shot } = videoDraft;
  const entry = record.ledger.findLast((item) => item.shot === shot.id && item.job);
  if (!entry) throw new Error("找不到该镜头的提交记录。");
  const result = await api("video/status", { job: entry.job });
  entry.state = result.state;
  if (result.clip && !entry.asset) {
    const asset = await importGenerated(result.clip, shot.title + " · Seedance");
    record.assets.push(asset); entry.asset = asset.id; shot.clip = asset.id; invalidate(record, 2);
  }
  persist(record);
  if (project() === record) renderProject();
  notice("#video-status", statusName(result.state) + (result.clip ? " · 原片已保存并关联。" : ""));
});
$("#export-project").onclick = async () => {
  try {
    const record = project();
    await downloadZip(projectFiles(record), fileName(record.title) + "-制作记录.zip");
    toast("已导出制作记录。");
  } catch (error) { toast(error.message); }
};
$("#render-film").onclick = () => operation($("#render-film"), "#render-status", "正在拼接镜头并编码 MP4…", async () => {
  const record = project();
  const ratio = record.ratio;
  const sequence = record.shots.map((shot) => ({ clip: shot.clip, seconds: shot.seconds }));
  const clips = [];
  for (const shot of sequence) clips.push({ id: await localAsset(record, shot.clip), seconds: shot.seconds });
  const result = await api("film/render", { ratio, clips });
  const film = await importGenerated(result, record.title + " · 粗剪");
  if (record.ratio !== ratio || JSON.stringify(sequence) !== JSON.stringify(record.shots.map(({ clip, seconds }) => ({ clip, seconds })))) {
    throw new Error("分镜在渲染期间已变化，请按最新镜头重新合成。");
  }
  record.film = film;
  persist(record);
  if (project() === record) showFilm(record.film);
  notice("#render-status", "已完成粗剪，可播放或下载。", "success");
});

renderProject();
if (project().film) showFilm(project().film);
initAccount();
api("status").then((status) => { Object.assign(runtime, status); }).catch(() => {}).finally(updateModels);
go("overview", false);
