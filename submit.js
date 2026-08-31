(() => {
  const form = document.querySelector("#submitForm");
  const status = document.querySelector("#submitStatus");
  const historyStatus = document.querySelector("#historyStatus");
  const submissionList = document.querySelector("#submissionList");
  const submissionEmpty = document.querySelector("#submissionEmpty");
  const submissionSelectionCount = document.querySelector("#submissionSelectionCount");
  const submissionBatchDelete = document.querySelector("#submissionBatchDelete");
  const config = window.HAN_FIREBASE_CONFIG;
  if (!form || !config || !globalThis.firebase) return;
  const app = firebase.apps.length ? firebase.apps[0] : firebase.initializeApp(config);
  const auth = firebase.auth();
  const db = firebase.firestore();
  let submissionsUnsubscribe = null;
  const submissionSelection = new Set();
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const updateSubmissionBatchActions = () => {
    if (!submissionSelectionCount || !submissionBatchDelete) return;
    submissionSelectionCount.textContent = `已選取 ${submissionSelection.size} 筆`;
    submissionBatchDelete.disabled = submissionSelection.size === 0;
  };
  const renderSubmissions = (snapshot) => {
    const docs = snapshot.docs.sort((a, b) => String(b.data().created_at || "").localeCompare(String(a.data().created_at || "")));
    const visibleIds = new Set(docs.map((doc) => doc.id));
    for (const id of [...submissionSelection]) {
      if (!visibleIds.has(id)) submissionSelection.delete(id);
    }
    submissionList.innerHTML = docs.map((doc) => {
      const data = doc.data();
      const title = `${data.object_name || "未填對象"}｜${data.subject || "未填事情"}`;
      const reply = String(data.han_reply || "").trim();
      const date = data.created_at ? new Date(data.created_at) : null;
      const sentDate = date && !Number.isNaN(date.getTime())
        ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
        : "";
      return `<li class="employee-submission-row ${reply ? "is-replied" : ""}">
        <div class="employee-submission-title-row">
          <input type="checkbox" class="employee-submission-select" data-submission-id="${escapeHtml(doc.id)}" aria-label="選取 ${escapeHtml(title)}"${submissionSelection.has(doc.id) ? " checked" : ""}>
          <button type="button" class="employee-submission-title" aria-expanded="false">${escapeHtml(title)}<span class="employee-submission-status">${reply ? "已回覆" : "待回覆"}</span></button>
        </div>
        <div class="employee-submission-details" hidden>
          <dl class="employee-submission-fields">
            <div class="employee-submission-top-row">
              <div><dt>對象</dt><dd>${escapeHtml(data.object_name || "—")}</dd></div>
              <div><dt>聯絡人</dt><dd>${escapeHtml(data.contact_name || "—")}</dd></div>
              <div><dt>電話</dt><dd>${escapeHtml(data.phone || "—")}</dd></div>
            </div>
            <div><dt>事情</dt><dd>${escapeHtml(data.subject || "—")}</dd></div>
            <div><dt>資料位置</dt><dd>${escapeHtml(data.resource_location || "—")}</dd></div>
            <div><dt>日期</dt><dd>${escapeHtml(sentDate || "—")}</dd></div>
          </dl>
          <div class="employee-reply-box"><h3>回復</h3><p>${reply ? escapeHtml(reply).replaceAll("\n", "<br>") : "尚未回覆"}</p></div>
        </div>
      </li>`;
    }).join("");
    submissionEmpty.hidden = docs.length !== 0;
    submissionList.querySelectorAll(".employee-submission-select").forEach((checkbox) => {
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        const id = checkbox.dataset.submissionId;
        if (checkbox.checked) submissionSelection.add(id);
        else submissionSelection.delete(id);
        updateSubmissionBatchActions();
      });
    });
    submissionList.querySelectorAll(".employee-submission-title").forEach((button) => {
      button.addEventListener("click", () => {
        const details = button.closest(".employee-submission-row")?.querySelector(".employee-submission-details");
        if (!details) return;
        const open = details.hidden;
        details.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
        button.parentElement.classList.toggle("is-expanded", open);
      });
    });
    updateSubmissionBatchActions();
  };
  const deleteSelectedSubmissions = async () => {
    const ids = [...submissionSelection];
    if (!ids.length) return;
    if (!window.confirm(`確定刪除選取的 ${ids.length} 筆留言？刪除後無法復原。`)) return;
    submissionBatchDelete.disabled = true;
    try {
      const batch = db.batch();
      ids.forEach((id) => batch.delete(db.collection("public_submissions").doc(id)));
      await batch.commit();
      submissionSelection.clear();
      historyStatus.textContent = `已刪除 ${ids.length} 筆留言`;
    } catch (error) {
      historyStatus.textContent = `刪除失敗：${error.message}`;
    } finally {
      updateSubmissionBatchActions();
    }
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
  submissionBatchDelete?.addEventListener("click", () => void deleteSelectedSubmissions());
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
