import { strToU8, zip } from "./vendor/fflate.js?v=40115cd331b5";
import { assetUrl, saveAsset } from "./projects.js?v=40115cd331b5";

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export function el(tag, text = "", className = "") {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function button(text, handler, className = "button") {
  const control = el("button", text, className);
  control.type = "button";
  control.onclick = handler;
  return control;
}

export function notice(id, message = "", kind = "") {
  const target = $(id);
  target.textContent = message;
  target.dataset.kind = kind;
}

export async function api(route, input) {
  const options = input === undefined ? {} : {
    method: "POST", headers: { "x-xp-director": "workspace", "content-type": "application/json" },
    body: JSON.stringify(input)
  };
  return request(route, options);
}

async function request(route, options) {
  const response = await fetch("./api/" + route, { ...options, cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || "请从本机运行器打开此功能。");
  return result;
}

export function upload(blob) {
  if (!blob || blob.size > 90_000_000) throw new Error("单个媒体文件须小于 90 MB。");
  return request("upload", { method: "POST", headers: { "x-xp-director": "workspace", "content-type": blob.type }, body: blob });
}

export async function importGenerated(media, name) {
  const url = new URL(media.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/files/")) throw new Error("素材地址无效。");
  const response = await fetch(url);
  if (!response.ok) throw new Error("无法保存生成素材。");
  return saveAsset(await response.blob(), name);
}

export function download(blob, name) {
  const link = el("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadZip(files, name) {
  const buffers = Object.fromEntries(Object.entries(files).map(([path, data]) => [path, typeof data === "string" ? strToU8(data) : data]));
  return new Promise((resolve, reject) => {
    zip(buffers, { level: 0 }, (error, data) => {
      if (error) return reject(error);
      download(new Blob([data], { type: "application/zip" }), name);
      resolve();
    });
  });
}

export async function operation(control, status, working, task) {
  const wasDisabled = control.disabled;
  control.disabled = true;
  notice(status, working);
  try { return await task(); }
  catch (error) { notice(status, error?.message || "处理失败，请稍后重试。", "error"); }
  finally { control.disabled = wasDisabled; }
}

const platforms = { bilibili: "哔哩哔哩", xiaohongshu: "小红书", douyin: "抖音", x: "X / Twitter" };
const trendKey = "xp-director-trend-snapshots-v1";
function getTrends() {
  try { return JSON.parse(localStorage.getItem(trendKey) || "[]"); }
  catch { return []; }
}

function parseSnapshot(data) {
  if (!Object.hasOwn(platforms, data?.platform) || typeof data.keyword !== "string" || !data.keyword.trim()
    || !Number.isFinite(Date.parse(data.observedAt)) || !Array.isArray(data.items)) {
    throw new Error("导入 JSON 需包含 platform、keyword、observedAt 和 items。");
  }
  const count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const items = data.items.slice(0, 100).map((row) => {
    let url;
    try { url = new URL(row.url); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password || typeof row.title !== "string" || !row.title.trim()) return null;
    return { url: url.href, title: row.title.trim().slice(0, 220), author: String(row.author || "").slice(0, 120),
      views: count(row.views), likes: count(row.likes) };
  }).filter(Boolean);
  if (!items.length) throw new Error("没有包含标题和来源链接的作品。");
  return { platform: data.platform, keyword: data.keyword.trim().slice(0, 120),
    observedAt: new Date(data.observedAt).toISOString(), items: [...new Map(items.map((row) => [row.url, row])).values()] };
}

function saveTrend(data) {
  const snapshot = parseSnapshot(data);
  const cache = getTrends().filter((item) => item.observedAt !== snapshot.observedAt || item.platform !== snapshot.platform || item.keyword !== snapshot.keyword);
  cache.push(snapshot);
  cache.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  localStorage.setItem(trendKey, JSON.stringify(cache.slice(-25)));
  return snapshot;
}

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const observed = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" });

function rankChart(items, metric) {
  const chart = el("canvas", "", "trend-chart");
  chart.width = 860;
  chart.height = 40 + items.length * 32;
  chart.setAttribute("aria-label", "样本排名柱状图，下方列出详细数值");
  chart.setAttribute("role", "img");
  const canvas = chart.getContext("2d");
  const top = items[0]?.[metric] || 1;
  canvas.font = "14px system-ui, sans-serif";
  items.forEach((row, index) => {
    const y = 26 + index * 32;
    canvas.fillStyle = "#aaa99e";
    canvas.fillText(String(index + 1).padStart(2, "0") + "  " + [...row.title].slice(0, 18).join(""), 14, y + 14, 285);
    canvas.fillStyle = "#31342e";
    canvas.fillRect(310, y, 440, 16);
    canvas.fillStyle = "#e7bd80";
    canvas.fillRect(310, y, 440 * row[metric] / top, 16);
    canvas.fillStyle = "#f3f1e9";
    canvas.fillText(number.format(row[metric]), 764, y + 13);
  });
  return chart;
}

function trendChart(points, metricName, overlap) {
  const chart = el("canvas", "", "trend-chart");
  chart.width = 860;
  chart.height = 178;
  chart.setAttribute("aria-label", overlap + " 条重叠作品的" + metricName + "合计变化");
  chart.setAttribute("role", "img");
  const ctx = chart.getContext("2d");
  ctx.font = "14px system-ui, sans-serif";
  const max = Math.max(1, ...points.map((point) => point.value));
  const coords = points.map((point, i) => [92 + i * 672 / (points.length - 1), 125 - point.value * 84 / max]);
  ctx.strokeStyle = "#343732";
  for (const y of [42, 84, 126]) {
    ctx.beginPath();
    ctx.moveTo(65, y); ctx.lineTo(800, y); ctx.stroke();
  }
  ctx.strokeStyle = "#e7bd80";
  ctx.lineWidth = 2;
  ctx.beginPath();
  coords.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
  coords.forEach(([x, y], i) => {
    ctx.fillStyle = "#e7bd80";
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#eee";
    ctx.textAlign = "center";
    ctx.fillText(number.format(points[i].value), x, y - 10, 100);
    ctx.fillStyle = "#aaa99e";
    ctx.fillText(observed.format(new Date(points[i].date)), x, 153, 120);
  });
  return chart;
}

function showTrends(snapshot, ctx) {
  const target = $("#trend-results");
  target.replaceChildren();
  if (!snapshot) return;
  const history = getTrends().filter((item) => item.keyword === snapshot.keyword && item.platform === snapshot.platform && item.observedAt <= snapshot.observedAt);
  const metric = snapshot.items.some((item) => item.views !== null) ? "views" : "likes";
  const metricName = metric === "views" ? "播放" : "点赞";
  const ranked = snapshot.items.filter((row) => row[metric] !== null).sort((a, b) => b[metric] - a[metric]);
  const dated = observed.format(new Date(snapshot.observedAt));
  target.append(el("h2", platforms[snapshot.platform] + " · " + snapshot.keyword), el("p", dated + " · " + snapshot.items.length + " 条采集样本", "muted"));
  if (ranked.length) target.append(rankChart(ranked.slice(0, 8), metric));
  const comparison = history.slice(-5).map((item) => new Map(item.items.filter((row) => row[metric] !== null).map((row) => [row.url, row])));
  const overlap = ranked.filter((row) => comparison.every((set) => set.has(row.url)));
  if (comparison.length >= 2 && overlap.length) {
    const points = comparison.map((set, index) => ({
      value: overlap.reduce((sum, row) => sum + set.get(row.url)[metric], 0), date: history.slice(-5)[index].observedAt
    }));
    const delta = points.at(-1).value - points[0].value;
    target.append(el("p", overlap.length + " 条重复采集作品 · " + metricName + "合计变化 " + (delta >= 0 ? "+" : "") + number.format(delta), "muted"),
      trendChart(points, metricName, overlap.length));
  } else {
    target.append(el("p", "同一关键词至少两次采集且有重叠作品时，显示时间趋势。", "muted"));
  }
  const list = el("ul", "", "ranking");
  for (const row of (ranked.length ? ranked : snapshot.items).slice(0, 12)) {
    const item = el("li");
    const link = el("a", row.title);
    link.href = row.url; link.target = "_blank"; link.rel = "noopener noreferrer";
    item.append(link, el("span", row[metric] === null ? "—" : number.format(row[metric]) + " " + metricName),
      el("span", row.author, "muted"));
    list.append(item);
  }
  target.append(list);
  const ideas = button("从这批样本提炼选题", () => operation(ideas, "#trend-status", "正在分析样本…", async () => {
    const result = await api("trends/ideas", { route: ctx.route(), keyword: snapshot.keyword, items: ranked.slice(0, 12) });
    const block = el("section", "", "result-block");
    block.append(el("h3", "创作方向"), el("pre", result.ideas));
    target.querySelector(".result-block")?.remove();
    target.append(block);
    notice("#trend-status", "已依据本轮样本生成选题。");
  }));
  ideas.disabled = !ctx.canWrite() || !ranked.length;
  target.append(ideas);
}

function showWatch(result) {
  const target = $("#watch-results");
  target.replaceChildren();
  if (result.frames?.length) {
    const frames = el("div", "", "result-grid");
    for (const frame of result.frames) {
      const figure = el("figure");
      const image = el("img");
      image.src = frame.url; image.alt = frame.time + " 的视频样帧"; image.loading = "lazy";
      figure.append(image, el("figcaption", frame.time));
      frames.append(figure);
    }
    target.append(frames);
  }
  for (const [title, text] of [["模型拆解", result.analysis], ["时间戳字幕", result.transcript]]) {
    if (!text) continue;
    const section = el("section", "", "result-block");
    section.append(el("h3", title), el("pre", text));
    target.append(section);
  }
}

const captionFont = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif';

function textLines(ctx, caption, width) {
  const lines = [];
  for (const paragraph of caption.split("\n")) {
    let line = "";
    for (const letter of paragraph) {
      if (line && ctx.measureText(line + letter).width > width) {
        lines.push(line);
        line = "";
      }
      line += letter;
    }
    if (line) lines.push(line);
  }
  return lines;
}

async function photoPng(page, asset) {
  const canvas = el("canvas");
  canvas.width = 1080; canvas.height = 1920;
  const context = canvas.getContext("2d");
  if (!page.caption.trim()) throw new Error("请填写每一页的字幕。");
  if (page.warning) {
    context.fillStyle = "#a4a4a4";
    context.fillRect(0, 0, 1080, 1920);
  } else {
    const source = await assetUrl(asset);
    if (!source) throw new Error("请先为每一页导入或生成图片。");
    const image = new Image();
    image.src = source;
    await image.decode();
    const scale = Math.max(1080 / image.width, 1920 / image.height);
    const width = image.width * scale, height = image.height * scale;
    context.drawImage(image, (1080 - width) / 2, (1920 - height) / 2, width, height);
  }
  let size = page.warning ? 84 : 59;
  let lines;
  do {
    context.font = "800 " + size + "px " + captionFont;
    lines = textLines(context, page.caption, 908);
    if (lines.length <= 3) break;
    size -= 3;
  } while (size >= 35);
  if (lines.length > 3) throw new Error("请缩短字幕，最多显示三行。");
  context.textAlign = "center"; context.textBaseline = "top";
  context.fillStyle = page.warning ? "#171717" : "#fff";
  context.strokeStyle = "#171717"; context.lineJoin = "round"; context.lineWidth = 5;
  const lineHeight = size * 1.27;
  const top = page.warning ? 960 - lines.length * lineHeight / 2 : 384;
  lines.forEach((line, index) => {
    const y = top + index * lineHeight;
    if (!page.warning) context.strokeText(line, 540, y);
    context.fillText(line, 540, y);
  });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("导出图片失败。")), "image/png"));
}

function photoLabel(text, control) {
  const label = el("label", text);
  label.append(control);
  return label;
}

export function initMedia(ctx) {
  let displayedTrend = getTrends().at(-1);
  const trendSubmit = $("#trend-submit");
  const photoSubmit = $("#photo-plan");
  const updateAvailability = () => {
    const platform = $("#trend-platform").value;
    trendSubmit.disabled = platform === "bilibili" ? !ctx.runtime.bili : !ctx.runtime.mediaClaw;
    notice("#trend-status", trendSubmit.disabled ? (platform === "bilibili" ? "本机运行器或 bili 未连接。也可导入采集文件。" : "此平台需要配置 Media Claw。也可导入采集文件。") : "");
    $("#watch-submit").disabled = !ctx.runtime.watch;
    $("#watch-transcribe").disabled = !ctx.runtime.transcription;
    photoSubmit.disabled = !ctx.canWrite();
    if (!ctx.runtime.watch) notice("#watch-status", "此功能需要本机运行器与 FFmpeg。");
    showTrends(displayedTrend, ctx);
  };

  const renderPhotos = () => {
    const project = ctx.project();
    const target = $("#photo-grid");
    target.replaceChildren();
    if (!project.pages.length) target.append(el("p", "添加一页，或从题材生成逐页分镜。", "muted"));
    $("#export-photos").disabled = !project.pages.length;
    project.pages.forEach((page, index) => {
      const card = el("article", "", "panel card");
      const preview = el("div", "", "photo-preview" + (page.warning ? " warning" : ""));
      const asset = project.assets.find((item) => item.id === page.asset);
      const text = el("p", page.caption);
      preview.append(text);
      if (asset && !page.warning) assetUrl(asset).then((src) => {
        if (!src) return;
        const image = el("img");
        image.alt = "第 " + (index + 1) + " 页"; image.src = src;
        preview.prepend(image);
      }).catch(() => {});
      const caption = el("textarea");
      caption.maxLength = 130; caption.rows = 2; caption.value = page.caption;
      caption.oninput = () => { page.caption = caption.value; text.textContent = page.caption; ctx.persist(project); };
      const prompt = el("textarea");
      prompt.maxLength = 3000; prompt.rows = 3; prompt.value = page.prompt;
      prompt.oninput = () => { page.prompt = prompt.value; ctx.persist(project); };
      const warning = el("input"); warning.type = "checkbox"; warning.checked = page.warning;
      warning.onchange = () => {
        page.warning = warning.checked;
        if (page.warning && !page.caption.trim()) page.caption = "温馨提示\n前方惊悚画面\n请谨慎观看";
        ctx.persist(project); renderPhotos();
      };
      const warningLabel = photoLabel("独立预警页", warning); warningLabel.className = "checkbox";
      const fileInput = el("input"); fileInput.type = "file"; fileInput.accept = "image/png,image/jpeg,image/webp";
      fileInput.onchange = async () => {
        try {
          const file = fileInput.files[0];
          if (!file) return;
          if (!file.type.startsWith("image/") || file.size > 20_000_000) throw new Error("请选择小于 20 MB 的图片。");
          const asset = await saveAsset(file);
          project.assets.push(asset); page.asset = asset.id; ctx.persist(project);
          if (ctx.project() === project) renderPhotos();
        } catch (error) { notice("#photo-status", error.message, "error"); }
      };
      const actions = el("div", "", "card-actions");
      const generate = button("生成这页图片", () => operation(generate, "#photo-status", "正在调用生图模型…", async () => {
        if (!page.prompt.trim()) throw new Error("请填写画面提示词。");
        const media = await api("photos/image", { prompt: page.prompt + "\n竖屏 9:16，手机纪实摄影，真实物理与构图，中上方留出文字安全区，画面无叠加字幕。" });
        const image = await importGenerated(media, "图文第 " + (index + 1) + " 页");
        project.assets.push(image); page.asset = image.id; ctx.persist(project);
        if (ctx.project() === project) renderPhotos();
        notice("#photo-status", "已保存生成图片。", "success");
      }));
      generate.disabled = !ctx.runtime.models?.image?.available || page.warning;
      actions.append(generate);
      const up = button("上移", () => {
        [project.pages[index - 1], project.pages[index]] = [page, project.pages[index - 1]];
        ctx.persist(project); renderPhotos();
      });
      up.disabled = !index;
      actions.append(up, button("移除", () => {
        project.pages.splice(index, 1); ctx.persist(project); renderPhotos();
      }));
      card.append(el("h3", "第 " + (index + 1) + " 页"), preview, photoLabel("字幕", caption), warningLabel);
      if (!page.warning) card.append(photoLabel("画面提示词", prompt), photoLabel("导入底图", fileInput));
      card.append(actions);
      target.append(card);
    });
  };

  $("#trend-platform").onchange = updateAvailability;
  $("#trend-form").onsubmit = (event) => {
    event.preventDefault();
    operation(trendSubmit, "#trend-status", "正在读取平台样本…", async () => {
      const data = await api("trends", { keyword: $("#trend-keyword").value, platform: $("#trend-platform").value });
      displayedTrend = saveTrend(data); showTrends(displayedTrend, ctx);
      notice("#trend-status", "采集完成。", "success");
    }).finally(updateAvailability);
  };
  $("#trend-import").onchange = async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 1_000_000) throw new Error("采集文件须小于 1 MB。");
      displayedTrend = saveTrend(JSON.parse(await file.text()));
      showTrends(displayedTrend, ctx);
      notice("#trend-status", "已导入采集样本。", "success");
    } catch (error) { notice("#trend-status", error.message, "error"); }
    finally { event.target.value = ""; }
  };
  $("#watch-form").onsubmit = (event) => {
    event.preventDefault();
    operation($("#watch-submit"), "#watch-status", "正在提取关键帧与字幕…", async () => {
      const file = $("#watch-file").files[0];
      const url = $("#watch-url").value.trim();
      if (!file && !url) throw new Error("请提供视频链接或选择本地视频。");
      const stored = file ? await upload(file) : null;
      const result = await api("watch", {
        file: stored?.id, url, question: $("#watch-question").value, route: ctx.route(),
        analyze: $("#watch-analyze").checked, transcribe: $("#watch-transcribe").checked
      });
      showWatch(result);
      notice("#watch-status", result.frames.length + " 张样帧 · " + (result.transcript ? "已取得字幕" : "暂无字幕")
        + (result.analysisStatus ? " · " + result.analysisStatus : ""), "success");
    });
  };
  $("#add-page").onclick = () => {
    const project = ctx.project();
    if (project.pages.length >= 24) return notice("#photo-status", "单组最多 24 页。", "error");
    project.pages.push({ caption: "", prompt: "", asset: "", warning: false });
    ctx.persist(project); renderPhotos();
  };
  $("#photos-form").onsubmit = (event) => {
    event.preventDefault();
    operation(photoSubmit, "#photo-status", "正在写逐页分镜…", async () => {
      const project = ctx.project();
      const brief = $("#photo-brief").value.trim() || project.brief;
      const count = Number($("#photo-count").value);
      const result = await api("photos/plan", { route: ctx.route(), brief, count });
      if (project.pages.length + result.pages.length > 24) throw new Error("当前项目余下页数不足，请减少新增页数。");
      project.pages.push(...result.pages.map((page) => ({ ...page, asset: "" })));
      ctx.persist(project);
      if (ctx.project() === project) renderPhotos();
      notice("#photo-status", "已添加逐页分镜。", "success");
    });
  };
  $("#export-photos").onclick = () => operation($("#export-photos"), "#photo-status", "正在合成字幕和 PNG…", async () => {
    const project = ctx.project();
    const files = {};
    for (const [index, page] of project.pages.entries()) {
      const asset = project.assets.find((item) => item.id === page.asset);
      const blob = await photoPng(page, asset);
      files[String(index + 1).padStart(2, "0") + ".png"] = new Uint8Array(await blob.arrayBuffer());
    }
    await downloadZip(files, "xp-director-photo-story.zip");
    notice("#photo-status", "已导出 " + project.pages.length + " 张竖屏图文。", "success");
  });
  return { updateAvailability, renderPhotos };
}
