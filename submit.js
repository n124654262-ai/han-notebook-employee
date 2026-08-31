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
  let latestSubmissionsSnapshot = null;
  const submissionMessageUnsubscribers = new Map();
  const submissionMessages = new Map();
  const expandedSubmissionIds = new Set();
  const chatScrollStates = new Map();
  const chatScrollToBottom = new Set();
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
  const rememberChatScroll = () => {
    submissionList.querySelectorAll(".employee-submission-row[data-submission-id]").forEach((row) => {
      const log = row.querySelector(".employee-chat-log");
      if (!log) return;
      const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
      chatScrollStates.set(row.dataset.submissionId, {
        scrollTop: log.scrollTop,
        atBottom: distanceFromBottom < 24,
      });
    });
  };
  const restoreChatScroll = () => {
    submissionList.querySelectorAll(".employee-submission-row[data-submission-id]").forEach((row) => {
      const log = row.querySelector(".employee-chat-log");
      if (!log) return;
      const submissionId = row.dataset.submissionId;
      const previous = chatScrollStates.get(submissionId);
      const forceBottom = chatScrollToBottom.has(submissionId);
      if (forceBottom || previous?.atBottom) log.scrollTop = log.scrollHeight;
      else if (previous) log.scrollTop = Math.min(previous.scrollTop, log.scrollHeight);
      if (forceBottom) chatScrollToBottom.delete(submissionId);
    });
  };
  const conversationMarkup = (doc, data) => {
    const messages = [...(submissionMessages.get(doc.id) || [])];
    const legacyReply = String(data.han_reply || "").trim();
    if (legacyReply && !messages.some((message) => message.sender_role === "han")) {
      messages.push({ sender_role: "han", text: legacyReply, created_at: data.replied_at || data.created_at });
    }
    messages.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    const entries = messages;
    return entries.length
      ? `<div class="employee-chat-log">${entries.map((message) => {
        const edit = message.sender_role === "employee" && message.id
          ? `<button type="button" class="employee-chat-edit" data-message-id="${escapeHtml(message.id)}" data-message-text="${escapeHtml(message.text || "")}">編輯</button>`
          : "";
        const edited = message.edited_at ? `<small class="employee-chat-edited">已修改</small>` : "";
        const sender = message.sender_role === "employee"
          ? ""
          : `<strong class="employee-chat-sender">HAN:</strong>`;
        return `<p class="employee-chat-message ${message.sender_role === "employee" ? "is-employee" : "is-han"}"><span class="employee-chat-bubble">${sender}<span class="employee-chat-text">${escapeHtml(message.text || "").replaceAll("\n", "<br>")}</span>${edit}${edited}</span></p>`;
      }).join("")}</div>`
      : `<p class="employee-conversation-empty">尚未回復</p>`;
  };
  const startEmployeeMessageEdit = (editButton) => {
    const bubble = editButton.closest(".employee-chat-bubble");
    const submissionId = editButton.closest(".employee-reply-form")?.dataset.submissionId
      || editButton.closest(".employee-submission-details")?.querySelector(".employee-reply-form")?.dataset.submissionId;
    const messageId = editButton.dataset.messageId;
    if (!bubble || !submissionId || !messageId) return;
    const editor = document.createElement("span");
    editor.className = "employee-chat-inline-editor";
    const textarea = document.createElement("textarea");
    textarea.rows = 1;
    textarea.maxLength = 20000;
    textarea.value = editButton.dataset.messageText || "";
    const actions = document.createElement("span");
    actions.className = "employee-chat-edit-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "text-button";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => {
      if (latestSubmissionsSnapshot) renderSubmissions(latestSubmissionsSnapshot);
    });
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary-button";
    save.textContent = "儲存";
    save.addEventListener("click", async () => {
      const text = textarea.value.trim();
      if (!text) return;
      save.disabled = true;
      try {
        const user = auth.currentUser || (await auth.signInAnonymously()).user;
        await db.collection("public_submissions").doc(submissionId).collection("messages").doc(messageId).update({
          text,
          edited_at: new Date().toISOString(),
        });
        historyStatus.textContent = "已送出";
        if (latestSubmissionsSnapshot) renderSubmissions(latestSubmissionsSnapshot);
      } catch (error) {
        save.disabled = false;
        historyStatus.textContent = `修改失敗：${error.message}`;
      }
    });
    actions.append(cancel, save);
    editor.append(textarea, actions);
    bubble.replaceChildren(editor);
    textarea.focus();
  };
  const renderSubmissions = (snapshot) => {
    rememberChatScroll();
    const docs = snapshot.docs.sort((a, b) => String(b.data().created_at || "").localeCompare(String(a.data().created_at || "")));
    submissionList.innerHTML = docs.map((doc) => {
      const data = doc.data();
      const title = `${data.object_name || "未填對象"}｜${data.subject || "未填事情"}`;
      const reply = String(data.han_reply || "").trim();
      const sentDate = safeDate(data.created_at);
      const expanded = expandedSubmissionIds.has(doc.id);
      return `<li class="employee-submission-row ${reply ? "is-replied" : ""}" data-submission-id="${escapeHtml(doc.id)}">
        <div class="employee-submission-title-row${expanded ? " is-expanded" : ""}">
          <button type="button" class="employee-submission-title" aria-expanded="${expanded}">${escapeHtml(title)}<span class="employee-submission-status">${reply ? "已回覆" : "待回覆"}</span></button>
        </div>
        <div class="employee-submission-details"${expanded ? "" : " hidden"}>
          <dl class="employee-submission-fields">
            <div class="employee-submission-top-row">
              ${[ ["對象", data.object_name], ["聯絡人", data.contact_name], ["電話", data.phone] ].map(([label, value]) => {
                const text = String(value || "").trim();
                return text ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd></div>` : "";
              }).join("")}
            </div>
            ${fieldMarkup("事情", data.subject)}
            ${fieldMarkup("資料位置", data.resource_location)}
            ${fieldMarkup("日期", sentDate)}
          </dl>
          <div class="employee-reply-box"><h3>回復</h3><div class="employee-conversation">${conversationMarkup(doc, data)}</div></div>
          <form class="employee-reply-form" data-submission-id="${escapeHtml(doc.id)}">
            <label><div class="employee-reply-composer"><textarea aria-label="輸入回覆" rows="1" maxlength="20000"></textarea><button class="primary-button" type="submit">送出</button></div></label>
          </form>
        </div>
      </li>`;
    }).join("");
    submissionEmpty.hidden = docs.length !== 0;
    submissionList.querySelectorAll(".employee-submission-title").forEach((button) => {
      button.addEventListener("click", () => {
        const details = button.closest(".employee-submission-row")?.querySelector(".employee-submission-details");
        if (!details) return;
        const open = details.hidden;
        const submissionId = button.closest(".employee-submission-row")?.dataset.submissionId;
        details.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
        button.parentElement.classList.toggle("is-expanded", open);
        if (submissionId) {
          if (open) expandedSubmissionIds.add(submissionId);
          else expandedSubmissionIds.delete(submissionId);
        }
        if (open) {
          const log = details.querySelector(".employee-chat-log");
          if (log) log.scrollTop = log.scrollHeight;
        }
      });
    });
    submissionList.querySelectorAll(".employee-chat-edit").forEach((button) => {
      button.addEventListener("click", () => startEmployeeMessageEdit(button));
    });
    submissionList.querySelectorAll(".employee-reply-form").forEach((replyForm) => {
      replyForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const textarea = replyForm.querySelector("textarea");
        const button = replyForm.querySelector("button[type=submit]");
        const text = String(textarea?.value || "").trim();
        if (!text) return;
        const submissionId = replyForm.dataset.submissionId;
        chatScrollToBottom.add(submissionId);
        button.disabled = true;
        try {
          const user = auth.currentUser || (await auth.signInAnonymously()).user;
          await db.collection("public_submissions").doc(replyForm.dataset.submissionId).collection("messages").add({
            sender_role: "employee",
            sender_uid: user.uid,
            text,
            created_at: new Date().toISOString(),
          });
          textarea.value = "";
          historyStatus.textContent = "已送出";
          requestAnimationFrame(() => {
            const log = submissionList.querySelector(`.employee-submission-row[data-submission-id="${CSS.escape(submissionId)}"] .employee-chat-log`);
            if (log) log.scrollTop = log.scrollHeight;
          });
        } catch (error) {
          chatScrollToBottom.delete(submissionId);
          historyStatus.textContent = `回覆失敗：${error.message}`;
        } finally {
          button.disabled = false;
        }
      });
    });
    restoreChatScroll();
  };
  const syncSubmissionMessageListeners = (docs) => {
    const visibleIds = new Set(docs.map((doc) => doc.id));
    for (const [id, unsubscribe] of submissionMessageUnsubscribers) {
      if (!visibleIds.has(id)) {
        unsubscribe();
        submissionMessageUnsubscribers.delete(id);
        submissionMessages.delete(id);
      }
    }
    docs.forEach((doc) => {
      if (submissionMessageUnsubscribers.has(doc.id)) return;
      const unsubscribe = db.collection("public_submissions").doc(doc.id).collection("messages")
        .orderBy("created_at")
        .onSnapshot((messageSnapshot) => {
          submissionMessages.set(doc.id, messageSnapshot.docs.map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() })));
          if (latestSubmissionsSnapshot) renderSubmissions(latestSubmissionsSnapshot);
        }, () => {});
      submissionMessageUnsubscribers.set(doc.id, unsubscribe);
    });
  };
  const stopSubmissionMessageListeners = () => {
    for (const unsubscribe of submissionMessageUnsubscribers.values()) unsubscribe();
    submissionMessageUnsubscribers.clear();
    submissionMessages.clear();
  };
  const watchSubmissions = (user) => {
    submissionsUnsubscribe?.();
    stopSubmissionMessageListeners();
    submissionsUnsubscribe = db.collection("public_submissions")
      .where("sender_uid", "==", user.uid)
      .onSnapshot((snapshot) => {
        latestSubmissionsSnapshot = snapshot;
        syncSubmissionMessageListeners(snapshot.docs);
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
        resource_location: String(values.resource_location || "").trim(),
        sender_uid: user.uid,
        created_at: new Date().toISOString(),
      });
      form.reset();
      status.textContent = "已送出";
    } catch (error) {
      status.textContent = `送出失敗：${error.message}`;
    } finally { button.disabled = false; }
  });
})();
