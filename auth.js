import { alignInkNav, animate, hideInkSheet, showInkSheet } from "./assets/ink/motion.js?v=40115cd331b5";

const $ = (selector) => document.querySelector(selector);
const authDialog = () => $("#auth-dialog");
const feedbackDialog = () => $("#feedback-dialog");
const feedbackForm = () => $("#feedback-form");
const redirectUrl = new URL("./", location.href).href;
const callback = new URL(location.href).searchParams;

let client, config, user, emailToken, mode = "login", afterLogin = false;
let verification = 0;
let authBusy = false;
let feedbackAttempt;
let feedbackBusy = false;
let feedbackListVersion = 0;
const authForm = () => $("#auth-form");

function notice(id, message = "", kind = "") {
  const element = $(id);
  element.textContent = message;
  element.dataset.kind = kind;
}

function changeMode(next) {
  mode = next;
  const dialog = authDialog();
  const nested = mode === "reset" || mode === "newPassword";
  const titles = { login: "登录", signup: "注册", reset: "找回密码", newPassword: "设置新密码", verify: "验证你的邮箱" };
  const form = authForm();
  const container = nested ? $("#auth-sheet-content") : $("#auth-page");
  if (form.parentElement !== container) container.prepend(form);
  if (!nested) hideInkSheet(dialog, true);
  form.dataset.mode = mode;
  $("#auth-password").value = "";
  $("#auth-password").autocomplete = ["signup", "newPassword"].includes(mode) ? "new-password" : "current-password";
  $("#auth-password").required = ["login", "signup", "newPassword"].includes(mode);
  $("#auth-password").minLength = ["signup", "newPassword"].includes(mode) ? 12 : 1;
  $("#auth-email").required = ["login", "signup", "reset"].includes(mode);
  $("#auth-name-field").hidden = mode !== "signup";
  $("#auth-email-field").hidden = !$("#auth-email").required;
  $("#auth-password-field").hidden = !$("#auth-password").required;
  $("#auth-options").hidden = !["login", "signup"].includes(mode);
  $("#github-auth").hidden = !config?.githubEnabled || !["login", "signup"].includes(mode);
  $("#auth-submit").textContent = ({
    login: "登录", signup: "创建账号", reset: "发送重置邮件",
    newPassword: "保存新密码", verify: "确认邮箱"
  })[mode];
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.authMode === mode));
  });
  if (nested) {
    if (!dialog.open) dialog.showModal();
    $("#auth-sheet-title").textContent = titles[mode];
    showInkSheet(dialog, "auth-sheet-title");
  } else {
    $("#auth-title").textContent = titles[mode];
    alignInkNav($("#auth-options"));
    animate($("#auth-page"), "ink-page-in");
  }
  notice("#auth-notice");
}

function updateUser(next) {
  if (user?.id !== next?.id) {
    ++feedbackListVersion;
    feedbackForm().reset();
    clearPreview();
    $("#feedback-history").replaceChildren();
    notice("#feedback-history-note");
    notice("#feedback-notice");
  }
  user = next;
  $("#account-label").textContent = user ? "退出登录" : "登录 / 注册";
}

async function verifiedUser(session) {
  const version = ++verification;
  if (!session?.user?.id) {
    updateUser(null);
    return;
  }
  const result = await client.auth.getUser();
  if (version !== verification) return;
  const candidate = result.data.user;
  updateUser(!result.error && candidate?.email_confirmed_at && !candidate.is_anonymous && candidate.id === session.user.id ? candidate : null);
}

function authError(error) {
  return ({
    invalid_credentials: "邮箱或密码不正确。",
    email_not_confirmed: "请先完成邮箱验证。",
    over_email_send_rate_limit: "邮件发送过于频繁，请稍后重试。",
    user_already_exists: "邮箱已注册，可以直接登录。",
    otp_expired: "验证链接已过期，请重新申请。",
    weak_password: "请使用至少 12 位且更难猜测的密码。"
  })[error?.code] || "账号操作未完成，请检查网络或稍后重试。";
}

function redact(text) {
  return text.trim()
    .replace(/https?:\/\/[^\s]+/gi, "[链接已隐藏]")
    .replace(/\b(?:sk-|ghp_|github_pat_|sb_secret_|Bearer\s+)[A-Za-z0-9._-]+/gi, "[密钥已隐藏]")
    .replace(/\b[A-Z]:\\[^\n]+|\/(?:Users|home)\/[^\s]+/gi, "[本机路径已隐藏]");
}

const feedbackStatus = (status) => ({ open: "待处理", investigating: "跟进中", resolved: "已解决" })[status] || status;

function feedbackPage(page) {
  $("#feedback-write").hidden = page !== "write";
  $("#feedback-records").hidden = page !== "history";
  for (const control of document.querySelectorAll("[data-feedback-page]")) {
    if (control.dataset.feedbackPage === page) control.setAttribute("aria-current", "page");
    else control.removeAttribute("aria-current");
  }
  alignInkNav(feedbackDialog().querySelector(".ink-panel-nav"));
  animate(page === "history" ? $("#feedback-records") : $("#feedback-write"), "ink-page-in");
}

function openFeedbackRecord(row) {
  $("#feedback-sheet-title").textContent = "反馈详情";
  $("#feedback-detail-title").textContent = row.title;
  $("#feedback-detail-status").textContent = feedbackStatus(row.status) + " · " + new Date(row.created_at).toLocaleDateString("zh-CN");
  $("#feedback-detail-body").textContent = row.body;
  $("#feedback-detail").hidden = false;
  $("#feedback-confirm").hidden = true;
  $("#feedback-send-actions").hidden = true;
  showInkSheet(feedbackDialog(), "feedback-sheet-title");
}

async function loadFeedback() {
  const target = $("#feedback-history");
  const historyNotice = $("#feedback-history-note");
  const revision = ++feedbackListVersion;
  target.replaceChildren();
  const owner = user?.id;
  if (!owner) return;
  historyNotice.textContent = "正在读取反馈…";
  const { data, error } = await client.from("xp_feedback")
    .select("id,title,body,status,created_at").eq("user_id", owner).eq("platform", "xp-director")
    .order("created_at", { ascending: false }).limit(10);
  if (user?.id !== owner || revision !== feedbackListVersion) return;
  if (error || !data?.length) {
    historyNotice.textContent = error ? "暂时无法读取反馈记录。" : "还没有反馈。";
    return;
  }
  historyNotice.textContent = "";
  for (const row of data) {
    const item = document.createElement("li");
    const control = document.createElement("button");
    control.type = "button";
    control.className = "button feedback-record";
    const title = document.createElement("span");
    title.textContent = row.title;
    const status = document.createElement("span");
    status.textContent = feedbackStatus(row.status);
    control.append(title, status);
    control.addEventListener("click", () => openFeedbackRecord(row));
    item.append(control);
    target.append(item);
  }
}

function openFeedback() {
  if (!user) {
    afterLogin = true;
    changeMode("login");
    authDialog().showModal();
    alignInkNav($("#auth-options"));
    notice("#auth-notice", "登录后可提交反馈和查看处理状态。");
    return;
  }
  feedbackDialog().showModal();
  feedbackPage("write");
}

async function finishLogin(session) {
  await verifiedUser(session);
  if (!user) throw new Error("Email confirmation required");
  authDialog().close();
  if (afterLogin) {
    afterLogin = false;
    openFeedback();
  }
}

async function runAuth(event) {
  event.preventDefault();
  if (authBusy) return;
  if (!client) return notice("#auth-notice", "账号服务暂不可用。", "error");
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const operation = mode;
  const controls = [...$("#auth-form").querySelectorAll("button"), ...$("#auth-options").querySelectorAll("button")];
  authBusy = true;
  authForm().setAttribute("aria-busy", "true");
  controls.forEach((element) => { element.disabled = true; });
  notice("#auth-notice", "正在处理…");
  try {
    let result;
    switch (operation) {
      case "signup":
        result = await client.auth.signUp({
          email, password,
          options: { emailRedirectTo: redirectUrl, data: { display_name: $("#auth-name").value.trim() } }
        });
        break;
      case "reset":
        result = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
        break;
      case "verify":
        if (!emailToken) throw new Error("Missing email token");
        result = await client.auth.verifyOtp(emailToken);
        break;
      case "newPassword":
        result = await client.auth.updateUser({ password });
        break;
      default:
        result = await client.auth.signInWithPassword({ email, password });
    }
    if (result.error) throw result.error;
    $("#auth-password").value = "";
    if (operation === "reset") {
      notice("#auth-notice", "如该邮箱已注册，请查收密码重置邮件。", "success");
    } else if (operation === "signup" && !result.data.session) {
      const authResult = $("#auth-signup-result");
      authResult.hidden = false;
      $("#auth-sheet-title").textContent = "验证邮箱";
      $("#auth-signup-email").textContent = email;
      showInkSheet(authDialog(), "auth-sheet-title");
      notice("#auth-notice", "请查收验证邮件。完成验证后即可登录。", "success");
    } else if (operation === "verify" && emailToken?.type === "recovery") {
      emailToken = null;
      changeMode("newPassword");
    } else if (operation === "newPassword") {
      const { data } = await client.auth.getSession();
      await finishLogin(data.session);
    } else {
      emailToken = null;
      await finishLogin(result.data.session);
    }
  } catch (error) {
    notice("#auth-notice", authError(error), "error");
  } finally {
    authBusy = false;
    authForm().removeAttribute("aria-busy");
    controls.forEach((element) => { element.disabled = false; });
  }
}

function previewFeedback(event) {
  event.preventDefault();
  if (!user || feedbackBusy) return;
  const body = redact($("#feedback-body").value);
  const title = redact($("#feedback-subject").value);
  if ([...body].length < 10 || [...title].length < 3) {
    return notice("#feedback-notice", "请填写至少 3 个字符的标题和 10 个字符的描述。", "error");
  }
  const draft = {
    p_title: title, p_body: body, p_category: $("#feedback-category").value,
    p_diagnostics: { platform: "xp-director", app_version: "0.1.0" },
    p_consent_version: "2026-11-03"
  };
  const signature = JSON.stringify(draft);
  if (feedbackAttempt?.signature !== signature) feedbackAttempt = { signature, draft, id: crypto.randomUUID() };
  $("#feedback-sheet-title").textContent = "发送内容预览";
  $("#feedback-preview").textContent = title + "\n\n" + body;
  $("#feedback-detail").hidden = true;
  $("#feedback-confirm").hidden = false;
  $("#feedback-send-actions").hidden = false;
  notice("#feedback-notice");
  notice("#feedback-send-notice");
  showInkSheet(feedbackDialog(), "feedback-sheet-title");
}

async function sendFeedback() {
  if (!user || !feedbackAttempt || feedbackBusy || $("#feedback-confirm").hidden) return;
  const { draft, id } = feedbackAttempt;
  const button = $("#feedback-submit");
  feedbackBusy = true;
  button.disabled = true;
  notice("#feedback-send-notice", "正在发送…");
  try {
    const owner = user.id;
    const { data, error } = await client.rpc("xp_submit_feedback", { ...draft, p_id: id });
    if (user?.id !== owner) return;
    if (error || !data?.id) throw error || new Error("Missing feedback receipt");
    feedbackForm().reset();
    clearPreview();
    hideInkSheet(feedbackDialog(), true);
    feedbackPage("history");
    await loadFeedback().catch(() => {});
    if (user?.id === owner) notice("#feedback-history-note", "已提交，编号 " + data.id.slice(0, 8) + "。", "success");
  } catch (error) {
    notice("#feedback-send-notice", error?.message?.startsWith("反馈提交比较频繁")
      ? "反馈提交比较频繁，请稍后再试。" : "暂未收到确认，可用同一编号重试。", "error");
  } finally {
    feedbackBusy = false;
    button.disabled = false;
  }
}

function clearPreview() {
  feedbackAttempt = null;
  $("#feedback-confirm").hidden = true;
  $("#feedback-preview").textContent = "";
}

export async function initAccount() {
  changeMode("login");
  $("#top-account").onclick = async () => {
    if (!user) {
      afterLogin = false;
      changeMode("login");
    if (!authDialog().open) authDialog().showModal();
      alignInkNav($("#auth-options"));
      if (!client) notice("#auth-notice", "账号服务暂不可用。", "error");
      return;
    }
    const { error } = await client.auth.signOut({ scope: "local" });
    if (!error) {
      ++verification;
      updateUser(null);
      feedbackDialog().close();
    } else {
      changeMode("login");
      authDialog().showModal();
      notice("#auth-notice", "退出失败，请稍后重试。", "error");
    }
  };
  document.querySelectorAll("[data-feedback]").forEach((button) => { button.onclick = openFeedback; });
  document.querySelectorAll("[data-auth-mode]").forEach((button) => { button.onclick = () => {
    if (!authBusy) changeMode(button.dataset.authMode);
  }; });
  authDialog().addEventListener("ink-sheet-closed", () => {
    $("#auth-signup-result").hidden = true;
    if (mode === "reset" || mode === "newPassword") changeMode("login");
  });
  authForm().onsubmit = runAuth;
  $("#github-auth").onclick = async () => {
    if (!client || !config?.githubEnabled) return;
    try {
      if (afterLogin) sessionStorage.setItem("xp-director-after-login", "feedback");
      const { error } = await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: redirectUrl } });
      if (error) throw error;
    } catch (error) { notice("#auth-notice", authError(error), "error"); }
  };
  feedbackForm().onsubmit = previewFeedback;
  feedbackForm().oninput = clearPreview;
  $("#feedback-submit").onclick = sendFeedback;
  document.querySelectorAll("[data-feedback-page]").forEach((button) => { button.onclick = () => {
    const page = button.dataset.feedbackPage;
    feedbackPage(page);
    if (page === "history") loadFeedback().catch(() => { $("#feedback-history-note").textContent = "暂时无法读取反馈记录。"; });
  }; });
  try {
    const response = await fetch(new URL("service-config.json", redirectUrl), { cache: "no-store" });
    if (!response.ok) throw new Error("Missing public configuration");
    config = await response.json();
    const endpoint = new URL(config.supabaseUrl);
    if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".supabase.co")
      || endpoint.pathname !== "/" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) throw new Error("Invalid public configuration");
    client = globalThis.supabase.createClient(endpoint.origin, config.publishableKey, {
      auth: { flowType: "pkce", detectSessionInUrl: true, storageKey: "xp-director-auth-v1" }
    });
    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        ++verification;
        updateUser(null);
        feedbackDialog().close();
        clearPreview();
      } else if (event === "PASSWORD_RECOVERY") {
        changeMode("newPassword");
        if (!authDialog().open) authDialog().showModal();
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (!authBusy) setTimeout(() => { if (!authBusy) verifiedUser(session).catch(() => {}); }, 0);
      }
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    await verifiedUser(data.session);
    const type = callback.get("type");
    const hash = callback.get("token_hash");
    if (hash && ["email", "signup", "recovery"].includes(type)) {
      emailToken = { token_hash: hash, type };
      history.replaceState(null, "", redirectUrl);
      changeMode("verify");
      if (!authDialog().open) authDialog().showModal();
    } else if (callback.has("error") || (callback.has("code") && !user)) {
      changeMode("login");
      if (!authDialog().open) authDialog().showModal();
      notice("#auth-notice", "登录链接已失效或回调地址尚未启用。", "error");
    } else if (user && sessionStorage.getItem("xp-director-after-login") === "feedback") {
      sessionStorage.removeItem("xp-director-after-login");
      if (!authDialog().open) openFeedback();
    } else {
      $("#github-auth").hidden = !config.githubEnabled || !["login", "signup"].includes(mode);
    }
  } catch {
    client = null;
    updateUser(null);
    if (authDialog().open) notice("#auth-notice", "暂时无法连接账号服务，请稍后刷新。", "error");
  }
}
