/* Durable requests come from the journal; drafts and widgets are presentation only. */
(() => {
  let owner = "",
    pending = null,
    busy = false;
  const cache = new Map(),
    drafts = new Map(),
    submitting = new Set();
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) {
      node.textContent = text;
      node.dir = "auto";
    }
    if (cls) node.className = cls;
    return node;
  };
  const icon = (name) => {
    const node = el("span");
    node.dataset.icon = name;
    node.setAttribute("aria-hidden", "true");
    window.heartUI?.renderIcons(node);
    return node;
  };
  function render(item, conversationId) {
    const key = conversationId + ":" + item.id,
      signature = JSON.stringify([
        item.status,
        item.response,
        item.respondedAt,
      ]);
    const previous = cache.get(key);
    if (previous?.signature === signature) {
      previous.node
        .querySelectorAll("fieldset")
        .forEach((field) => (field.disabled = busy || submitting.has(key)));
      return previous.node;
    }
    if (item.status !== "pending") {
      drafts.delete(key);
      const card = window.heartTurns.receipt({
        className:
          "interaction-message interaction-receipt resolved " + item.status,
        symbol: item.status === "cancelled" ? "close" : "check",
        label:
          item.status === "cancelled"
            ? "Demande annulée"
            : "Réponse enregistrée",
        at: item.respondedAt || item.at,
        title: item.request.title,
      });
      card.dataset.eventId = item.id;
      card.setAttribute("aria-label", item.request.title);
      card
        .querySelector(".chat-receipt-meta strong")
        .classList.add("interaction-state");
      if (item.status === "answered") {
        const rows = [];
        for (const q of item.request.questions) {
          const value = item.response?.answers[q.id];
          if (value === undefined) continue;
          const values = Array.isArray(value) ? value : [value];
          rows.push({
            label: q.label,
            value: values
              .map(
                (value) =>
                  q.options?.find((option) => option.id === value)?.label ||
                  value,
              )
              .join(", "),
          });
        }
        const copy = card.querySelector(".chat-receipt-copy");
        if (
          rows.length === 1 &&
          rows[0].value.length < 180 &&
          !rows[0].value.includes("\n")
        )
          copy.append(el("small", rows[0].value, "interaction-answer"));
        else if (rows.length) {
          const details = el(
              "details",
              undefined,
              "interaction-answer-details",
            ),
            summary = el("summary");
          summary.append(
            el("span", rows.map((row) => row.value).join(" · ")),
            icon("chevron-down"),
          );
          details.append(summary);
          const answers = el("dl", undefined, "interaction-summary");
          for (const row of rows)
            answers.append(el("dt", row.label), el("dd", row.value));
          details.append(answers);
          copy.append(details);
        }
      }
      cache.set(key, { signature, node: card });
      return card;
    }
    const card = el(
      "section",
      undefined,
      "conversation-message interaction-message",
    );
    card.dataset.eventId = item.id;
    card.setAttribute("aria-label", item.request.title);
    const heading = el("header", undefined, "interaction-heading"),
      copy = el("div");
    copy.append(el("h3", item.request.title));
    if (item.request.description)
      copy.append(el("p", item.request.description));
    heading.append(icon("question"), copy);
    card.append(heading);
    const quick =
      item.request.questions.length === 1 &&
      item.request.questions[0].type === "single" &&
      item.request.questions[0].required !== false;
    const form = el("form"),
      fields = el("fieldset", undefined, "interaction-fields");
    form.noValidate = true;
    fields.disabled = busy || submitting.has(key);
    const values = drafts.get(key) || {};
    drafts.set(key, values);
    const controls = new Map();
    for (const q of item.request.questions) {
      const group = el("fieldset", undefined, "interaction-question");
      group.dataset.questionId = q.id;
      const legend = el("legend", q.label);
      if (q.required === false) legend.append(el("small", "Facultatif"));
      group.append(legend);
      if (q.description) group.append(el("p", q.description, "field-help"));
      if (q.type === "text") {
        const field = el("textarea");
        field.dir = "auto";
        field.rows = 2;
        field.name = q.id;
        field.setAttribute("aria-label", q.label);
        field.required = q.required !== false;
        if (q.placeholder) field.placeholder = q.placeholder;
        field.value = values[q.id] || "";
        field.addEventListener("input", () => {
          values[q.id] = field.value;
          feedback.hidden = true;
        });
        group.append(field);
        controls.set(q.id, [field]);
      } else {
        const list = el("div", undefined, "interaction-options"),
          items = [];
        for (const option of q.options) {
          const label = el(
              quick ? "button" : "label",
              undefined,
              "interaction-option",
            ),
            input = el("input");
          if (quick) {
            label.type = "button";
            input.hidden = true;
            input.tabIndex = -1;
          }
          input.type = q.type === "single" ? "radio" : "checkbox";
          input.name = item.id + "-" + q.id;
          input.value = option.id;
          input.checked =
            q.type === "single"
              ? values[q.id] === option.id
              : (values[q.id] || []).includes(option.id);
          input.setAttribute("aria-label", option.label);
          const optionCopy = el("span");
          optionCopy.append(el("strong", option.label));
          if (option.description)
            optionCopy.append(el("small", option.description));
          if (quick) {
            label.append(optionCopy, icon("arrow-right"));
            list.append(input, label);
            label.addEventListener("click", () => {
              items.forEach(
                (item) => (item.checked = item.value === option.id),
              );
              values[q.id] = option.id;
              void send("answered");
            });
          } else {
            label.append(input, optionCopy);
            list.append(label);
          }
          items.push(input);
          input.addEventListener("change", () => {
            feedback.hidden = true;
            values[q.id] =
              q.type === "single"
                ? option.id
                : items
                    .filter((item) => item.checked)
                    .map((item) => item.value);
          });
        }
        group.append(list);
        controls.set(q.id, items);
        if (
          q.type === "multiple" &&
          (q.minSelections !== undefined || q.maxSelections !== undefined)
        )
          group.append(
            el(
              "small",
              q.minSelections === q.maxSelections
                ? `${q.minSelections} choix`
                : `${q.minSelections ?? 0} à ${q.maxSelections ?? q.options.length} choix`,
              "field-help",
            ),
          );
      }
      fields.append(group);
    }
    const feedback = el("p", "", "interaction-feedback");
    feedback.setAttribute("role", "status");
    feedback.hidden = true;
    const actions = el("div", undefined, "interaction-actions"),
      cancel = el("button", "Annuler", "button secondary"),
      submit = el(
        "button",
        item.request.submitLabel || "Continuer",
        "button primary",
      );
    cancel.type = "button";
    submit.type = "submit";
    submit.hidden = quick;
    actions.append(cancel, submit);
    fields.append(actions);
    form.append(fields, feedback);
    card.append(form);
    async function send(status) {
      if (submitting.has(key)) return;
      const answers = {};
      if (status === "answered") {
        for (const q of item.request.questions) {
          const items = controls.get(q.id),
            selected =
              q.type === "text"
                ? items[0].value
                : q.type === "single"
                  ? items.find((item) => item.checked)?.value
                  : items
                      .filter((item) => item.checked)
                      .map((item) => item.value);
          const empty =
            selected === undefined ||
            selected === "" ||
            (Array.isArray(selected) && !selected.length);
          if (empty && q.required === false) {
            continue;
          }
          if (
            empty ||
            (q.type === "text" &&
              (!selected.trim() ||
                (q.maxLength !== undefined &&
                  [...selected].length > q.maxLength))) ||
            (q.type === "multiple" &&
              (selected.length <
                (q.minSelections ?? (q.required === false ? 0 : 1)) ||
                selected.length > (q.maxSelections ?? q.options.length)))
          ) {
            feedback.textContent = `Vérifie « ${q.label} ».`;
            feedback.hidden = false;
            items[0]?.focus({ preventScroll: true });
            return;
          }
          answers[q.id] = selected;
        }
      }
      submitting.add(key);
      fields.disabled = true;
      feedback.hidden = false;
      feedback.replaceChildren();
      const spinner = icon("refresh");
      spinner.classList.add("interaction-spinner");
      feedback.append(
        spinner,
        document.createTextNode(
          status === "cancelled" ? "Annulation…" : "Envoi de ta réponse…",
        ),
      );
      card.setAttribute("aria-busy", "true");
      submit.classList.add("spin-request");
      try {
        await window.heartInteractionActions.respond(conversationId, item.id, {
          status,
          answers,
        });
      } catch (error) {
        feedback.textContent = errorText(error);
        feedback.hidden = false;
      } finally {
        submitting.delete(key);
        spinner.remove();
        card.removeAttribute("aria-busy");
        submit.classList.remove("spin-request");
        fields.disabled = false;
      }
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void send("answered");
    });
    cancel.addEventListener("click", () => void send("cancelled"));
    cache.set(key, { signature, node: card });
    return card;
  }
  window.heartInteractions = {
    render,
    update(data) {
      if (owner !== data.conversation?.id) {
        cache.clear();
        owner = data.conversation?.id || "";
      }
      pending = data.pendingInput || null;
      busy = !!data.busy;
    },
    pending: () => !!pending,
    reset() {
      owner = "";
      pending = null;
      busy = false;
      cache.clear();
      drafts.clear();
    },
  };
})();
