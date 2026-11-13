const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(pointer: fine)");
const motionToggle = $("#motion-toggle");
const openSheets = new WeakMap();
let motion = !reduceMotion.matches;
try {
  const preference = localStorage.getItem("xp-director-motion");
  if (preference !== null) motion = preference === "on";
} catch { /* A blocked preference store should not stop the app. */ }

function updateMotion() {
  document.documentElement.dataset.motion = motion ? "on" : "off";
  motionToggle.setAttribute("aria-pressed", String(motion));
}

export function animate(element, name) {
  if (!motion || !element) return;
  element.classList.remove(name);
  void element.offsetWidth;
  element.classList.add(name);
}

export function alignInkNav(nav) {
  if (!nav || nav.hidden) return;
  const marker = $(".ink-nav-marker", nav);
  const active = $("[aria-current], [aria-pressed=true]", nav);
  if (!marker || !active?.offsetWidth) return;
  marker.style.setProperty("--marker-left", active.offsetLeft + "px");
  marker.style.setProperty("--marker-top", active.offsetTop + "px");
  marker.style.setProperty("--marker-width", active.offsetWidth + "px");
  marker.style.setProperty("--marker-height", active.offsetHeight + "px");
}

export function showInkSheet(dialog, titleId) {
  const layer = $(".ink-sheet-layer", dialog);
  const base = $(".ink-dialog-base", dialog);
  if (!dialog.open || !layer?.hidden) return;
  openSheets.set(dialog, { labelledby: dialog.getAttribute("aria-labelledby"), trigger: document.activeElement });
  layer.hidden = false;
  base.inert = true;
  dialog.setAttribute("aria-labelledby", titleId);
  animate(layer, "ink-sheet-enter");
  document.getElementById(titleId).focus({ preventScroll: true });
}

export function hideInkSheet(dialog, immediate = false) {
  const layer = $(".ink-sheet-layer", dialog);
  const state = openSheets.get(dialog);
  if (!state) return;
  if (state.timer && !immediate) return;
  clearTimeout(state.timer);
  const finish = () => {
    openSheets.delete(dialog);
    layer.hidden = true;
    layer.classList.remove("ink-sheet-enter", "ink-sheet-exit");
    $(".ink-dialog-base", dialog).inert = false;
    dialog.setAttribute("aria-labelledby", state.labelledby);
    if (dialog.open && state.trigger?.isConnected) state.trigger.focus({ preventScroll: true });
    dialog.dispatchEvent(new Event("ink-sheet-closed"));
  };
  if (motion && !immediate) {
    layer.classList.remove("ink-sheet-enter");
    layer.classList.add("ink-sheet-exit");
    state.timer = setTimeout(finish, 310);
  } else finish();
}

function installDialogInk(dialog) {
  const canvas = document.createElement("canvas");
  canvas.className = "ink-canvas";
  canvas.setAttribute("aria-hidden", "true");
  dialog.append(canvas);
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  const ripples = [];
  const flecks = [];
  let width = 0;
  let height = 0;
  let frame = 0;
  let lastFrame = 0;
  let lastTrail = -1000;

  function resize() {
    if (!dialog.open || !motion) return;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const scale = Math.min(devicePixelRatio || 1, 1.5);
    if (!width || !height) return;
    if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    flecks.length = 0;
    ripples.length = 0;
    context.clearRect(0, 0, width, height);
  }

  function paint(now) {
    if (!motion || !dialog.open || document.hidden) return reset();
    frame = 0;
    if (now - lastFrame < 24) {
      frame = requestAnimationFrame(paint);
      return;
    }
    lastFrame = now;
    context.clearRect(0, 0, width, height);
    for (let index = ripples.length - 1; index >= 0; index--) {
      const wave = ripples[index];
      const age = Math.max(0, (now - wave.start) / 740);
      if (age >= 1) {
        ripples.splice(index, 1);
        continue;
      }
      const radius = 7 + 106 * (1 - Math.pow(1 - age, 2.2));
      const tint = wave.light ? "255,255,255" : "18,18,18";
      context.save();
      context.translate(wave.x, wave.y);
      context.scale(1, .61);
      const wash = context.createRadialGradient(0, 0, radius * .08, 0, 0, radius * 1.32);
      wash.addColorStop(0, "rgba(" + tint + "," + ((1 - age) * .31) + ")");
      wash.addColorStop(1, "rgba(" + tint + ",0)");
      context.fillStyle = wash;
      context.fillRect(-radius * 1.32, -radius * 1.32, radius * 2.64, radius * 2.64);
      for (let ring = 0; ring < 2; ring++) {
        const extent = Math.max(1, radius - ring * 12);
        context.beginPath();
        context.arc(0, 0, extent, 0, Math.PI * 2);
        context.strokeStyle = "rgba(" + tint + "," + ((1 - age) * (ring ? .36 : .67)) + ")";
        context.lineWidth = ring ? 1.1 : 2;
        context.stroke();
      }
      context.restore();
    }
    for (let index = flecks.length - 1; index >= 0; index--) {
      const dot = flecks[index];
      const age = Math.max(0, (now - dot.start) / dot.life);
      if (age >= 1) {
        flecks.splice(index, 1);
        continue;
      }
      const tint = dot.light ? "246,246,246" : "23,23,23";
      const size = dot.size * (1 - age * .79);
      context.beginPath();
      context.ellipse(dot.x + dot.dx * age, dot.y + dot.dy * age + age * age * 13, size, size * .65, dot.angle, 0, Math.PI * 2);
      context.fillStyle = "rgba(" + tint + "," + ((1 - age) * .77) + ")";
      context.fill();
    }
    if (ripples.length || flecks.length) frame = requestAnimationFrame(paint);
  }

  function scatter(x, y, light, count, reach) {
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = reach * (.22 + Math.random() * .78);
      flecks.push({
        x, y, light, angle, start,
        dx: Math.cos(angle) * velocity,
        dy: Math.sin(angle) * velocity * .63 - 8,
        size: 1.2 + Math.random() * 3.2,
        life: 360 + Math.random() * 540
      });
    }
    if (flecks.length > 150) flecks.splice(0, flecks.length - 150);
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function point(event, target = event.target) {
    const box = canvas.getBoundingClientRect();
    const control = target.getBoundingClientRect();
    const x = event.detail || event.type !== "click" ? event.clientX : control.left + control.width / 2;
    const y = event.detail || event.type !== "click" ? event.clientY : control.top + control.height / 2;
    const light = !!target.closest(".ink-panel-nav, .ink-sheet-content, .ink-sheet-actions, .model-front, .ink-page .primary");
    return { x: (x - box.left) * width / Math.max(1, box.width), y: (y - box.top) * height / Math.max(1, box.height), light };
  }

  dialog.addEventListener("pointermove", (event) => {
    const now = performance.now();
    if (!motion || !finePointer.matches || event.pointerType === "touch" || now - lastTrail < 48) return;
    lastTrail = now;
    const p = point(event);
    scatter(p.x, p.y, p.light, 4, 39);
  }, { passive: true });
  dialog.addEventListener("pointerover", (event) => {
    if (!motion || event.pointerType === "touch") return;
    const target = event.target.closest(".model-card, .ink-panel-nav button, .ink-back, .ink-sheet-actions .button");
    if (!target || target.contains(event.relatedTarget)) return;
    const p = point(event);
    scatter(p.x, p.y, p.light, 12, 55);
  }, { passive: true });
  dialog.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!motion || !target) return;
    const p = point(event, target);
    ripples.push({ ...p, start: performance.now() });
    if (ripples.length > 6) ripples.shift();
    scatter(p.x, p.y, p.light, 16, 115);
  }, true);
  new ResizeObserver(resize).observe(canvas);
  new MutationObserver(() => {
    reset();
    if (!dialog.open || !motion) return;
    resize();
    ripples.push({ x: width * .26, y: height * .15, start: performance.now(), light: !dialog.classList.contains("ink-layered") });
    scatter(width * .26, height * .15, !dialog.classList.contains("ink-layered"), 15, 99);
  }).observe(dialog, { attributeFilter: ["open"] });
  return reset;
}

export function initInkWorkspace() {
  const template = $("#ink-landscape");
  const world = $(".workspace-landscape");
  const dialogs = $$("dialog.modal");
  for (const dialog of dialogs) {
    if (!dialog.classList.contains("ink-layered")) dialog.setAttribute("data-ink-scene", "");
  }
  for (const scene of $$("[data-ink-scene]")) scene.prepend(template.content.cloneNode(true));

  const navs = $$(".ink-panel-nav");
  const resizeNavs = new ResizeObserver(() => navs.forEach(alignInkNav));
  for (const nav of navs) resizeNavs.observe(nav);

  const resets = dialogs.map((dialog) => {
    dialog.addEventListener("cancel", (event) => {
      if (!openSheets.has(dialog)) return;
      event.preventDefault();
      hideInkSheet(dialog);
    });
    dialog.addEventListener("close", () => {
      if (!dialog.open) hideInkSheet(dialog, true);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-sheet-dismiss]")) hideInkSheet(dialog);
    });
    return installDialogInk(dialog);
  });

  let pointerFrame = 0;
  let sample;
  function track(event) {
    if (!motion || !finePointer.matches || event.pointerType === "touch") return;
    sample = { x: event.clientX, y: event.clientY, target: event.target };
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      if (!motion) return;
      const { x, y, target } = sample;
      const scene = target.closest("[data-ink-scene]") || world;
      for (const current of new Set([scene, world])) {
        const box = current.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        const a = Math.max(0, Math.min(1, (x - box.left) / box.width));
        const b = Math.max(0, Math.min(1, (y - box.top) / box.height));
        current.style.setProperty("--ink-x", (a * 2 - 1).toFixed(3));
        current.style.setProperty("--ink-y", (b * 2 - 1).toFixed(3));
        current.style.setProperty("--ink-light-x", (a * 100).toFixed(1) + "%");
        current.style.setProperty("--ink-light-y", (b * 100).toFixed(1) + "%");
      }
      const control = target.closest("button, a");
      if (!control) return;
      const box = control.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const a = Math.max(0, Math.min(1, (x - box.left) / box.width));
      const b = Math.max(0, Math.min(1, (y - box.top) / box.height));
      control.style.setProperty("--spot-x", (a * 100).toFixed(1) + "%");
      control.style.setProperty("--spot-y", (b * 100).toFixed(1) + "%");
      control.style.setProperty("--ink-tilt", ((a - .5) * 19).toFixed(1) + "deg");
      if (control.classList.contains("model-card")) {
        control.style.setProperty("--model-tilt-x", ((.5 - b) * 20).toFixed(1) + "deg");
        control.style.setProperty("--model-tilt-y", ((a - .5) * 23).toFixed(1) + "deg");
      }
    });
  }
  document.addEventListener("pointermove", track, { passive: true });

  function setMotion(on) {
    motion = on;
    updateMotion();
    if (!motion) resets.forEach((reset) => reset());
  }
  motionToggle.addEventListener("click", () => {
    setMotion(!motion);
    try { localStorage.setItem("xp-director-motion", motion ? "on" : "off"); } catch { /* Optional preference. */ }
  });
  reduceMotion.addEventListener("change", (event) => setMotion(!event.matches));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resets.forEach((reset) => reset());
  });
  updateMotion();
}
