const workspaceKey = "xp-director-projects-v1";

export const formats = { "9:16": "竖屏", "16:9": "横屏", "1:1": "方形" };
export const looks = { realistic: "现实电影感", documentary: "手机纪实感", graphic: "风格化" };
export const reviewItems = [
  "剧本、动机和镜头动作已复核",
  "人物、道具和首尾帧保持连续",
  "所用视频片段已逐镜回看",
  "声音、字幕与交付规格已确认"
];

export function newProject(title) {
  return {
    id: crypto.randomUUID(), title, brief: "", story: "", design: "", ratio: "9:16",
    duration: 30, look: "realistic", shots: [], assets: [], pages: [], reviews: [],
    ledger: [], updated: new Date().toISOString()
  };
}

export function newShot(fields = {}) {
  return {
    id: crypto.randomUUID(), title: "新镜头", action: "", camera: "", seconds: 5,
    firstDescription: "", lastDescription: "", prompt: "", first: "", last: "", clip: "",
    ...fields
  };
}

function example() {
  const project = newProject("雨夜之后");
  const image = { id: "rain-example", type: "image/jpeg", name: "雨夜候车厅 · 示例参考帧", bundled: "./assets/studio/rain-station.jpg" };
  return Object.assign(project, {
    example: true,
    ratio: "16:9",
    brief: "雨停以后，一个女孩在空荡的候车厅发现，所有屏幕都在播放一段她还没有经历的记忆。",
    story: "她误以为车站广播已停。大屏幕先播出她进站的背影，再显示她即将迈出的下一步。广播叫出她的名字，她放下了手里的车票。",
    design: "夜间候车厅，湿玻璃与冷白顶灯。角色始终穿棕色外套，车票一直在右手。环境声由雨声过渡到远处广播。",
    assets: [image],
    shots: [
      newShot({ title: "雨停", seconds: 6, camera: "固定远景", action: "雨从玻璃边缘滴下，候车厅的顶灯逐排亮起。", first: image.id }),
      newShot({ title: "走进候车厅", seconds: 8, camera: "肩后跟随", action: "她从画面左侧入场，靠近空座椅，抬头看向屏幕。", first: image.id }),
      newShot({ title: "屏幕里的自己", seconds: 9, camera: "肩后慢推", action: "屏幕切到她刚才走过的走道。她停下，捏紧右手的车票。", first: image.id }),
      newShot({ title: "广播响起", seconds: 7, camera: "固定中远景", action: "广播叫出她的名字。她低头放下车票，留一拍静止。", first: image.id })
    ]
  });
}

export function loadWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(workspaceKey));
    if (saved?.projects?.some((project) => project.id === saved.active)) return saved;
  } catch { /* Start a new workspace when browser storage is unavailable. */ }
  const project = example();
  return { active: project.id, projects: [project] };
}

export function saveWorkspace(workspace) {
  localStorage.setItem(workspaceKey, JSON.stringify(workspace));
}

let database;
function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("xp-director-media", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    database = undefined;
    throw error;
  });
  return database;
}

async function assetOperation(mode, fn) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("files", mode);
    const request = fn(transaction.objectStore("files"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export function readBlob(id) {
  return assetOperation("readonly", (files) => files.get(id));
}

export async function saveAsset(file, name = file.name) {
  const id = crypto.randomUUID();
  await assetOperation("readwrite", (files) => files.put(file, id));
  return { id, type: file.type, name: name.slice(0, 150), size: file.size };
}

const assetUrls = new Map();
export async function assetUrl(asset) {
  if (!asset) return "";
  if (asset.bundled) return asset.bundled;
  if (!assetUrls.has(asset.id)) {
    assetUrls.set(asset.id, readBlob(asset.id).then((blob) => blob ? URL.createObjectURL(blob) : ""));
  }
  return assetUrls.get(asset.id);
}

export const totalDuration = (shots) => shots.reduce((sum, shot) => sum + Number(shot.seconds), 0);
export const shotLabel = (index) => "S" + String(index + 1).padStart(3, "0");

export function timecode(seconds) {
  const minutes = Math.floor(seconds / 60);
  return String(minutes).padStart(2, "0") + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
}

export function timeline(shots) {
  let offset = 0;
  return shots.map((shot, index) => {
    const start = offset;
    offset += Number(shot.seconds);
    return { ...shot, label: shotLabel(index), start, end: offset };
  });
}

export function outline(project) {
  const sentences = project.brief.split(/(?<=[。！？!?])|\n+/u).map((line) => line.trim()).filter(Boolean);
  const beats = [
    ["建立处境", "固定远景", "交代地点、人物与眼下的目标。"],
    ["行动与阻碍", "中景跟随", "写出主角采取的行动，以及第一个阻碍。"],
    ["发现或转折", "肩后近景", "让观众先看见关键变化，再看人物反应。"],
    ["收束", "固定中景", "给出选择或行动的后果。"]
  ];
  const seconds = Math.floor(project.duration / beats.length);
  return beats.map(([title, camera, hint], index) => newShot({
    title, camera, action: sentences[index] || hint,
    seconds: seconds + (index === beats.length - 1 ? project.duration % beats.length : 0)
  }));
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function projectFiles(project, fields = ["motion", "camera", "frames", "prompt", "clip"]) {
  const shots = timeline(project.shots);
  const names = new Map(project.assets.map((asset) => [asset.id, asset.name]));
  const columns = [
    ["shot_id", (shot) => shot.label],
    ["timeline_start", (shot) => shot.start],
    ["timeline_end", (shot) => shot.end],
    ["purpose", (shot) => shot.title],
    ["visible_motion", (shot) => shot.action, "motion"],
    ["camera", (shot) => shot.camera, "camera"],
    ["first_frame", (shot) => names.get(shot.first), "frames"],
    ["last_frame", (shot) => names.get(shot.last), "frames"],
    ["prompt_file", (shot) => shot.prompt ? "prompts/" + shot.label + ".txt" : "", "prompt"],
    ["clip_file", (shot) => names.get(shot.clip), "clip"],
  ].filter(([, , field]) => !field || fields.includes(field));
  const header = columns.map(([name]) => name).join(",");
  const rows = shots.map((shot) => columns.map(([, read]) => csvCell(read(shot))).join(","));
  return {
    "brief.json": JSON.stringify({
      title: project.title, brief: project.brief, duration: project.duration, ratio: project.ratio, look: project.look
    }, null, 2),
    "story.txt": project.story,
    "design/visual-direction.txt": project.design,
    "storyboard.csv": "\ufeff" + [header, ...rows].join("\r\n"),
    "reviews.jsonl": project.reviews.map((item) => JSON.stringify(item)).join("\n"),
    "generation-ledger.jsonl": project.ledger.map((item) => JSON.stringify(item)).join("\n"),
    "assets.json": JSON.stringify(project.assets.map(({ id, name, type, size }) => ({ id, name, type, size })), null, 2),
    "photo-plan.json": JSON.stringify(project.pages, null, 2),
    ...Object.fromEntries(shots.filter((shot) => shot.prompt).map((shot) => ["prompts/" + shot.label + ".txt", shot.prompt]))
  };
}
