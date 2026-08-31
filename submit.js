(() => {
  const form = document.querySelector("#submitForm");
  const status = document.querySelector("#submitStatus");
  const historyStatus = document.querySelector("#historyStatus");
  const submissionList = document.querySelector("#submissionList");
  const submissionEmpty = document.querySelector("#submissionEmpty");
  const config = window.HAN_FIREBASE_CONFIG;
  if (!form || !config || !globalThis.firebase) return;
  const app = firebase.apps.length ? firebase.apps[0] : firebase.initializeApp(config);
  const auth = firebase.auth();
  const db = firebase.firestore();
  let submissionsUnsubscribe = null;
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const renderSubmissions = (snapshot) => {
    const docs = snapshot.docs.sort((a, b) => String(b.data().created_at || "").localeCompare(String(a.data().created_at || "")));
    submissionList.innerHTML = docs.map((doc) => {
      const data = doc.data();
      const title = `${data.object_name || "未填對象"}｜${data.subject || "未填事情"}`;
      const reply = String(data.han_reply || "").trim();
      const time = data.created_at ? new Date(data.created_at).toLocaleString("zh-TW", { hour12: false }) : "";
      return `<li class="employee-submission-row ${reply ? "is-replied" : ""}">
        <button type="button" class="employee-submission-title" aria-expanded="false">${escapeHtml(title)}<span class="employee-submission-status">${reply ? "已回覆" : "待回覆"}</span></button>
        <div class="employee-submission-details" hidden>
          <dl class="employee-submission-fields">
            <div class="employee-submission-top-row">
              <div><dt>對象</dt><dd>${escapeHtml(data.object_name || "—")}</dd></div>
              <div><dt>聯絡人</dt><dd>${escapeHtml(data.contact_name || "—")}</dd></div>
              <div><dt>電話</dt><dd>${escapeHtml(data.phone || "—")}</dd></div>
            </div>
            <div><dt>事情</dt><dd>${escapeHtml(data.subject || "—")}</dd></div>
            <div><dt>需要我做什麼</dt><dd>${escapeHtml(data.requested_action || "—")}</dd></div>
            <div><dt>資料位置</dt><dd>${escapeHtml(data.resource_location || "—")}</dd></div>
            <div><dt>送出時間</dt><dd>${escapeHtml(time || "—")}</dd></div>
          </dl>
          <div class="employee-reply-box"><h3>HAN 回覆</h3><p>${reply ? escapeHtml(reply).replaceAll("\n", "<br>") : "尚未回覆"}</p></div>
        </div>
      </li>`;
    }).join("");
    submissionEmpty.hidden = docs.length !== 0;
    submissionList.querySelectorAll(".employee-submission-title").forEach((button) => {
      button.addEventListener("click", () => {
        const details = button.nextElementSibling;
        const open = details.hidden;
        details.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
      });
    });
  };
  const watchSubmissions = (user) => {
    submissionsUnsubscribe?.();
    submissionsUnsubscribe = db.collection("public_submissions")
      .where("sender_uid", "==", user.uid)
      .onSnapshot((snapshot) => {
        renderSubmissions(snapshot);
        historyStatus.textContent = "已同步";
      }, (error) => { historyStatus.textContent = `同步失敗：${error.message}`; });
  };
  auth.onAuthStateChanged((user) => {
    if (user) watchSubmissions(user);
  });
  const toggle = document.querySelector("#publicEntryToggle");
  const wrap = document.querySelector("#publicEntryFormWrap");
  toggle?.addEventListener("click", () => {
    const open = wrap.hidden;
    wrap.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    status.textContent = "送出中…";
    try {
      const user = auth.currentUser || (await auth.signInAnonymously()).user;
      const values = Object.fromEntries(new FormData(form).entries());
      await db.collection("public_submissions").add({
        owner_email: "n124654262@gmail.com",
        object_name: String(values.object_name || "").trim(),
        subject: String(values.subject || "").trim(),
        contact_name: String(values.contact_name || "").trim(),
        phone: String(values.phone || "").trim(),
        requested_action: String(values.requested_action || "").trim(),
        resource_location: String(values.resource_location || "").trim(),
        sender_uid: user.uid,
        created_at: new Date().toISOString(),
      });
      form.reset();
      status.textContent = "已送出，負責人會在暫存區看到。";
    } catch (error) {
      status.textContent = `送出失敗：${error.message}`;
    } finally { button.disabled = false; }
  });
})();
