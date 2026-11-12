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

function notice(id, message = "", kind = "") {
  const element = $(id);
  element.textContent = message;
  element.dataset.kind = kind;
}

function changeMode(next) {
  mode = next;
  $("#auth-form").dataset.mode = mode;
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
  $("#auth-back").hidden = ["login", "signup"].includes(mode);
  $("#auth-submit").textContent = ({
    login: "登录", signup: "创建账号", reset: "发送重置邮件",
    newPassword: "保存新密码", verify: "确认邮箱"
  })[mode];
  $("#auth-title").textContent = ({
    login: "登录", signup: "注册", reset: "找回密码",
    newPassword: "设置新密码", verify: "验证你的邮箱"
  })[mode];
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.authMode === mode));
  });
  notice("#auth-notice");
}

function updateUser(next) {
  if (user?.id !== next?.id) {
    feedbackForm().reset();
    clearPreview();
    $("#feedback-history").replaceChildren();
    notice("#feedback-notice");
  }
  user = next;
  $("#top-account").textContent = user ? "退出登录" : "登录 / 注册";
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

async function loadFeedback() {
  const target = $("#feedback-history");
  target.replaceChildren();
  const owner = user?.id;
  if (!owner) return;
  const { data, error } = await client.from("xp_feedback")
    .select("id,title,status,created_at").eq("user_id", owner).eq("platform", "xp-director")
    .order("created_at", { ascending: false }).limit(10);
  if (user?.id !== owner) return;
  if (error || !data?.length) {
    target.textContent = error ? "暂时无法读取反馈记录。" : "还没有反馈。";
    return;
  }
  for (const row of data) {
    const item = document.createElement("li");
    const status = { open: "待处理", investigating: "跟进中", resolved: "已解决" }[row.status] || row.status;
    item.textContent = row.title + " · " + status;
    target.append(item);
  }
}

function openFeedback() {
  if (!user) {
    afterLogin = true;
    changeMode("login");
    authDialog().showModal();
    notice("#auth-notice", "登录后可提交反馈和查看处理状态。");
    return;
  }
  feedbackDialog().showModal();
  loadFeedback().catch(() => { $("#feedback-history").textContent = "暂时无法读取反馈记录。"; });
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
  if (!client) return notice("#auth-notice", "账号服务暂不可用。", "error");
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const operation = mode;
  const controls = [...$("#auth-form").querySelectorAll("button"), ...$("#auth-options").querySelectorAll("button")];
  authBusy = true;
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
    controls.forEach((element) => { element.disabled = false; });
  }
}

async function submitFeedback(event) {
  event.preventDefault();
  if (!user) return;
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
  if (feedbackAttempt?.signature !== signature) {
    feedbackAttempt = { signature, id: crypto.randomUUID() };
    $("#feedback-preview").textContent = title + "\n\n" + body;
    $("#feedback-confirm").hidden = false;
    $("#feedback-submit").textContent = "确认发送";
    notice("#feedback-notice", "请检查下面的实际发送内容。");
    return;
  }
  const button = $("#feedback-submit");
  button.disabled = true;
  notice("#feedback-notice", "正在发送…");
  try {
    const owner = user.id;
    const { data, error } = await client.rpc("xp_submit_feedback", { ...draft, p_id: feedbackAttempt.id });
    if (user?.id !== owner) return;
    if (error || !data?.id) throw error || new Error("Missing feedback receipt");
    feedbackForm().reset();
    clearPreview();
    notice("#feedback-notice", "已提交，编号 " + data.id.slice(0, 8) + "。", "success");
    await loadFeedback();
  } catch (error) {
    notice("#feedback-notice", error?.message?.startsWith("反馈提交比较频繁")
      ? "反馈提交比较频繁，请稍后再试。" : "暂未收到确认，可用同一编号重试。", "error");
  } finally { button.disabled = false; }
}

function clearPreview() {
  feedbackAttempt = null;
  $("#feedback-confirm").hidden = true;
  $("#feedback-preview").textContent = "";
  $("#feedback-submit").textContent = "预览反馈";
}

export async function initAccount() {
  changeMode("login");
  $("#top-account").onclick = async () => {
    if (!user) {
      afterLogin = false;
      changeMode("login");
      authDialog().showModal();
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
  document.querySelectorAll("[data-auth-mode]").forEach((button) => { button.onclick = () => changeMode(button.dataset.authMode); });
  $("#auth-form").onsubmit = runAuth;
  $("#github-auth").onclick = async () => {
    if (!client || !config?.githubEnabled) return;
    try {
      if (afterLogin) sessionStorage.setItem("xp-director-after-login", "feedback");
      const { error } = await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: redirectUrl } });
      if (error) throw error;
    } catch (error) { notice("#auth-notice", authError(error), "error"); }
  };
  feedbackForm().onsubmit = submitFeedback;
  feedbackForm().oninput = clearPreview;
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
    } else if (mode === "login") {
      changeMode("login");
    }
  } catch {
    client = null;
    updateUser(null);
    if (authDialog().open) notice("#auth-notice", "暂时无法连接账号服务，请稍后刷新。", "error");
  }
}
