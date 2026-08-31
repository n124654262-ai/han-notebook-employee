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
  const expandedSubmissionIds = new Set();

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const safeDate = (value) => {
    const date = value?.toDate ? value.toDate() : (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime())
      ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
      : "";
  };

  const fieldMarkup = (label, value) => {
    const text = String(value || "").trim();
    return text ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd></div>` : "";
  };

  const renderSubmissions = (snapshot) => {
    const docs = snapshot.docs
      .sort((a, b) => String(b.data().created_at || "").localeCompare(String(a.data().created_at || "")));
    submissionList.innerHTML = docs.map((doc) => {
      const data = doc.data();
      const title = `${data.object_name || "未填對象"}｜${data.subject || "未填事情"}`;
      const sentDate = safeDate(data.created_at);
      const expanded = expandedSubmissionIds.has(doc.id);
      return `<li class="employee-submission-row" data-submission-id="${escapeHtml(doc.id)}">
        <div class="employee-submission-title-row${expanded ? " is-expanded" : ""}">
          <button type="button" class="employee-submission-title" aria-expanded="${expanded}">
            <span class="employee-submission-title-text">${escapeHtml(title)}</span>
            <span class="employee-submission-status">已送出${sentDate ? ` · ${escapeHtml(sentDate)}` : ""}</span>
          </button>
        </div>
        <div class="employee-submission-details"${expanded ? "" : " hidden"}>
          <dl class="employee-submission-fields">
            ${fieldMarkup("對象", data.object_name)}
            ${fieldMarkup("事情", data.subject)}
            ${fieldMarkup("聯絡人", data.contact_name)}
            ${fieldMarkup("電話", data.phone)}
            ${fieldMarkup("資料位置", data.resource_location)}
            ${fieldMarkup("送出日期", sentDate)}
          </dl>
        </div>
      </li>`;
    }).join("");

    submissionEmpty.hidden = docs.length !== 0;
    submissionList.querySelectorAll(".employee-submission-title").forEach((button) => {
      button.addEventListener("click", () => {
        const row = button.closest(".employee-submission-row");
        const details = row?.querySelector(".employee-submission-details");
        if (!row || !details) return;
        const open = details.hidden;
        details.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
        button.closest(".employee-submission-title-row")?.classList.toggle("is-expanded", open);
        if (open) expandedSubmissionIds.add(row.dataset.submissionId);
        else expandedSubmissionIds.delete(row.dataset.submissionId);
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
      }, (error) => {
        historyStatus.textContent = `同步失敗：${error.message}`;
      });
  };

  auth.onAuthStateChanged((user) => {
    if (user) watchSubmissions(user);
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
      status.textContent = "已送出";
    } catch (error) {
      status.textContent = `送出失敗：${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
})();
