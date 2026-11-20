const root = document.querySelector("#app");
let view = location.pathname.startsWith("/ledger") ? "ledger" : "queue";
let sort = "ready";
let editing = null;
let toastText = "";
let data = null;
let quoteOpen = new Set();

root.addEventListener("click", onClick);
root.addEventListener("submit", onSubmit);
root.addEventListener("change", (event) => {
  if (event.target.id === "sort") {
    sort = event.target.value;
    render();
  }
});
window.addEventListener("popstate", () => {
  view = location.pathname.startsWith("/ledger") ? "ledger" : "queue";
  render();
});

refresh();

async function refresh() {
  const response = await fetch("/api/state");
  data = await response.json();
  render();
}

function render() {
  if (!data) {
    root.replaceChildren(el("p", { className: "loading" }, "Loading the queue…"));
    return;
  }
  const shell = el("div", { className: "app" }, [sidebar(), main()]);
  const bits = [shell];
  if (editing) bits.push(drawer());
  if (toastText) bits.push(el("div", { className: "toast" }, toastText));
  root.replaceChildren(...bits);
}

function sidebar() {
  const side = el("aside", { className: "sidebar" });
  const logo = el("div", { className: "logo" }, [
    el("span", { className: "logo-evidence" }, "Evidence"),
    el("span", { className: "logo-mining" }, "Mining"),
  ]);
  side.append(
    logo,
    el("p", { className: "brand-sub" }, `Agent Arena · ${data.owner}`),
    el("nav", { className: "nav" }, [
      navButton("queue", "Review queue", data.queueCount),
      navButton("ledger", "Ledger", data.ledgerCount),
    ]),
    progress(),
    modeCard(),
  );
  return side;
}

function navButton(name, label, count) {
  return el("button", { className: view === name ? "active" : "", "data-action": "nav", "data-view": name }, [
    label,
    el("span", { className: "badge" }, String(count)),
  ]);
}

function progress() {
  const box = el("section", { className: "progress" });
  const coverage = data.coverage;
  box.append(el("p", { className: "kicker" }, "QUALIFICATION PROGRESS"));
  box.append(meter("Submissions", coverage.submissions, coverage.submissionsGoal, "submissions"));
  box.append(meter("Markets", coverage.markets, coverage.marketsGoal, "markets"));
  box.append(el("p", { className: "cap-label" }, "Cap per market · max 3"));
  for (const market of coverage.perMarket) {
    const row = el("div", { className: "mrow" });
    row.append(el("span", {}, market.name));
    row.append(
      slotRow(
        market.slots,
        "",
        `${market.used} of 3 submissions used, ${market.remaining} remaining`,
        market.remaining === 0,
      ),
    );
    row.append(el("span", { className: "mfrac" }, `${market.used}/3`));
    box.append(row);
  }
  if (data.sample) box.append(el("p", { className: "sample-note" }, "Sample figures, until you run live."));
  return box;
}

function meter(label, value, goal, kind) {
  const wrap = el("div");
  wrap.append(
    el("div", { className: "meter-row" }, [el("span", {}, label), el("span", {}, `${value}/${goal}`)]),
    el("div", { className: `meter ${kind}` }, [
      el("span", { style: `width:${Math.min(100, (value / goal) * 100)}%` }),
    ]),
  );
  return wrap;
}

function modeCard() {
  const card = el("section", { className: "mode-card" });
  if (data.mode === "live") {
    card.append(
      el("p", { className: "kicker" }, "LIVE"),
      el("p", {}, "Approve sends the note to Delphi."),
      el("p", {}, "A sent submission cannot be edited or pulled back."),
      el("p", { className: "dim" }, data.terms.detail),
    );
  } else if (data.sample) {
    card.append(
      el("p", { className: "kicker" }, "TEST MODE"),
      el("p", {}, "Nothing is sent to Delphi."),
      el("p", {}, "This local queue is only for your review."),
      el("p", { className: "dim" }, "Sample data — not a real market."),
      el("p", { className: "dim" }, "Runs automatically each morning."),
    );
  } else {
    card.append(
      el("p", { className: "kicker" }, "TEST MODE"),
      el("p", {}, "Nothing is sent to Delphi."),
      el("p", {}, "Approve keeps the decision on this computer."),
      el("p", { className: "dim" }, "Runs automatically each morning."),
    );
  }
  return card;
}

function main() {
  const panel = el("main", { className: "main" });
  const path = view === "ledger" ? "/ledger" : "/queue";
  const actions = el("div", { className: "top-actions" }, [
    el("span", { className: data.mode === "live" ? "mode-pill live" : "mode-pill" }, data.mode === "live" ? "LIVE — APPROVAL SENDS EVIDENCE" : "TEST MODE — NOTHING IS SENT"),
  ]);
  if (data.sample) actions.append(el("button", { className: "text-btn", "data-action": "sample" }, "SAMPLE DATA"));
  actions.append(el("button", { className: "text-btn", "data-action": "scan" }, "RESCAN"));
  panel.append(
    el("div", { className: "top" }, [
      el("span"),
      el("div", { className: "loc" }, [globe(), `localhost:${data.port}${path}`]),
      actions,
    ]),
  );
  panel.append(view === "ledger" ? ledgerView() : queueView());
  return panel;
}

function queueView() {
  const wrap = el("section");
  const drafts = data.drafts.slice().sort((a, b) => (sort === "ready" ? Number(b.gates.ok) - Number(a.gates.ok) : 0));
  wrap.append(
    el("div", { className: "title-row" }, [
      el("div", {}, [
        el("h1", {}, "Review queue"),
        el(
          "p",
          { className: "sub" },
          data.queueCount === 0
            ? "Nothing is waiting. Rescan when you want a new pass."
            : `${data.queueCount} candidates are waiting for your decision · ${data.ready} ready to approve, ${data.blocked} still at the gate`,
        ),
      ]),
      (() => {
        const select = el("select", { id: "sort" }, [
          option("ready", "ready for review first"),
          option("kept", "keep this order"),
        ]);
        select.value = sort;
        return el("label", { className: "sort" }, ["Sort", select]);
      })(),
    ]),
  );
  const grid = el("div", { className: "cards" });
  for (const draft of drafts) grid.append(card(draft));
  wrap.append(grid);
  return wrap;
}

function card(draft) {
  const blocked = !draft.gates.ok;
  const article = el("article", {
    className: `card${blocked ? " blocked" : ""}${!blocked && draft.side === "NO" ? " no" : ""}`,
  });
  const badges = el("div", { className: "badges" }, [
    el("span", { className: draft.side === "NO" ? "pill no" : "pill yes" }, draft.side === "NO" ? "SIDE NO" : draft.side === "YES" ? "SIDE YES" : "SIDE"),
    el("span", { className: draft.side === "NO" ? "pill no" : "pill yes" }, draft.oddsLabel),
  ]);
  const right = el("div", { className: "head-right" });
  if (blocked) right.append(el("span", { className: "pill gate" }, "GATE NOT PASSED"));
  right.append(el("span", { className: "domain" }, draft.sourceHost));
  article.append(el("div", { className: "card-head" }, [badges, right]));
  article.append(el("h2", {}, draft.question));

  const body = el("div", { className: draft.preview ? "with-shot" : "" });
  const copy = el("div");
  copy.append(el("p", { className: "kicker summary" }, "EVIDENCE SUMMARY"));
  copy.append(el("p", { className: "quote" }, quoteOpen.has(draft.id) ? draft.note : `“${draft.quote}”`));
  if (draft.extraSource) copy.append(el("p", { className: "extra" }, `+1 more source: ${draft.extraSource}`));
  body.append(copy);
  if (draft.preview) body.append(shot(draft));
  article.append(body);

  let meta = `${draft.kindLabel} · ${draft.collectedLabel}`;
  if (draft.chips.some((chip) => chip.id === "screenshot" && chip.tone === "bad")) meta += " · waiting on a screenshot";
  article.append(
    el("div", { className: "meta" }, [
      el("span", {}, meta),
      el("span", { className: "cap-line" }, [
        el("span", {}, "Cap "),
        slotRow(draft.slots, draft.slotsRemaining === 0 ? "full" : `${draft.slotsRemaining} left`, `${draft.slotsUsed} of 3 used, ${draft.slotsRemaining} left`, draft.slotsRemaining === 0),
      ]),
    ]),
  );

  const pdf = draft.files.find((file) => file.role === "evidence-pdf");
  const files = el("div", { className: "file-line" }, [
    el("span", {}, "Files "),
    slotRow(draft.fileSlots, `${draft.files.length} of 3`, `${draft.files.length} of 3 files`, draft.files.length >= 3),
  ]);
  if (pdf) files.append(el("a", { className: "file-link", href: pdf.href, target: "_blank", rel: "noopener" }, "Evidence PDF"));
  if (draft.pdfSkipped) files.append(el("span", { className: "warn" }, draft.pdfSkipped));
  article.append(files);

  const checks = el("div", { className: "checks" });
  for (const chip of draft.chips) {
    checks.append(
      el("button", { className: `check ${chip.tone}`, "data-action": "chip", "data-id": draft.id, "data-chip": chip.id }, chip.label),
    );
  }
  article.append(checks);

  const fail = draft.gates.checks.find((check) => !check.ok);
  const approve = el(
    "button",
    { className: "approve", "data-action": "approve", "data-id": draft.id, disabled: blocked ? "disabled" : null, title: fail ? fail.detail : "Approve" },
    "Approve",
  );
  if (blocked) approve.disabled = true;
  article.append(
    el("div", { className: "actions" }, [
      approve,
      el("button", { className: "reject", "data-action": "reject", "data-id": draft.id }, "Reject"),
      el("button", { className: "edit", "data-action": "edit", "data-id": draft.id }, "Edit"),
    ]),
  );
  return article;
}

function shot(draft) {
  const box = el("aside", { className: "shot" });
  box.append(el("span", { className: "kicker" }, draft.preview.kicker));
  box.append(el("strong", {}, draft.preview.title));
  box.append(el("p", {}, draft.preview.body));
  box.append(el("span", { className: "shot-foot" }, draft.preview.footer));
  return box;
}

function ledgerView() {
  const wrap = el("section");
  wrap.append(
    el("div", { className: "title-row" }, [
      el("div", {}, [
        el("h1", {}, "Ledger"),
        el("p", { className: "sub" }, "Notes, submissions, verdicts, and rewards stay on this computer."),
      ]),
    ]),
  );
  if (data.sample) wrap.append(el("p", { className: "banner" }, "Sample figures. These are not real payments, and nothing was sent."));
  if (!data.terms.ok && data.mode === "live") wrap.append(el("p", { className: "banner" }, data.terms.detail));
  const table = el("table");
  table.append(
    el("thead", {}, [
      el("tr", {}, ["When", "Market", "Side", "Status", "Verdict", "Reward", "Key"].map((name) => el("th", {}, name))),
    ]),
  );
  const body = el("tbody");
  if (data.submissions.length === 0) {
    body.append(el("tr", {}, [el("td", { colspan: "7" }, "No submissions yet.")]));
  }
  for (const row of data.submissions) {
    body.append(
      el("tr", {}, [
        el("td", {}, row.when),
        el("td", {}, row.shortName),
        el("td", {}, row.side),
        el("td", {}, row.status),
        el("td", {}, row.verdict || "—"),
        el("td", {}, row.rewardLabel),
        el("td", {}, row.idempotency || "—"),
      ]),
    );
  }
  table.append(body);
  wrap.append(el("div", { className: "panel" }, table));
  wrap.append(el("h2", { style: "font-family:Fraunces,Georgia,serif;font-weight:520;margin-top:28px" }, "Notes"));
  const notes = el("div", { className: "panel notes" });
  for (const note of data.notes) {
    const block = el("article", { className: "note" });
    block.append(el("p", { className: "kicker" }, `${note.shortName} · ${note.when}`));
    block.append(el("p", {}, note.quote));
    if (/^https?:\/\//i.test(note.url)) block.append(el("a", { href: note.url, target: "_blank", rel: "noopener" }, note.url));
    notes.append(block);
  }
  wrap.append(notes);
  return wrap;
}

function drawer() {
  const draft = data.drafts.find((item) => item.id === editing);
  if (!draft) return el("div");
  const form = el("form", { className: "drawer", id: "edit-form" });
  form.append(el("p", { className: "kicker" }, "EDIT DRAFT"));
  form.append(el("h2", {}, draft.shortName));
  form.append(field("Side", el("select", { className: "field", name: "side" }, [option("YES", "YES"), option("NO", "NO")])));
  form.querySelector("[name=side]").value = draft.side || "YES";
  form.append(field("Quote", area("quote", draft.quote)));
  form.append(field("Rationale", area("rationale", draft.rationale)));
  form.append(field("Published date", el("input", { type: "date", name: "publishedAt", value: (draft.publishedAt || "").slice(0, 10) })));
  form.append(field("Links, one per line", area("links", draft.links.map((link) => link.url).join("\n"))));
  form.append(field("Note Delphi would receive", area("note", draft.note)));
  const rebuild = el("input", { type: "checkbox", name: "rebuildNote" });
  rebuild.checked = true;
  form.append(el("label", { className: "checkline" }, [rebuild, "Rebuild the note from these fields"]));
  form.append(field("Screenshot (PNG or JPG)", el("input", { type: "file", name: "screenshot", accept: "image/png,image/jpeg" })));
  if (draft.files.some((file) => file.role === "screenshot")) {
    form.append(el("button", { type: "button", className: "linkish", "data-action": "remove-shot", "data-id": draft.id }, "Remove screenshot"));
  }
  const fails = draft.gates.checks.filter((check) => !check.ok);
  if (fails.length) form.append(el("ul", { className: "fail-list" }, fails.map((check) => el("li", {}, check.detail))));
  form.append(
    el("div", { className: "actions" }, [
      el("button", { className: "save", type: "submit" }, "Save"),
      el("button", { className: "cancel", type: "button", "data-action": "close" }, "Cancel"),
    ]),
  );
  return el("div", { className: "drawer-back" }, form);
}

async function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.closest("form") && button.type === "submit") return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === "nav") {
    view = button.dataset.view;
    history.pushState({}, "", view === "ledger" ? "/ledger" : "/queue");
    render();
  } else if (action === "chip" && button.dataset.chip === "quote") {
    if (quoteOpen.has(id)) quoteOpen.delete(id);
    else quoteOpen.add(id);
    render();
  } else if (action === "edit") {
    editing = id;
    render();
  } else if (action === "close") {
    editing = null;
    render();
  } else if (action === "sample") {
    toast("These markets are fiction, for practice. Nothing is sent.");
  } else if (action === "scan") {
    toast("Scanning…");
    const response = await fetch("/api/scan", { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      toast(body.message || "The scan did not finish.");
      return;
    }
    data = body;
    toast(data.sample ? "Scan finished. Sample data is on screen." : "Scan finished.");
  } else if (action === "approve") {
    if (button.disabled) return;
    const response = await fetch(`/api/drafts/${id}/approve`, { method: "POST" });
    const body = await response.json();
    toast(body.message || "Done.");
    await refresh();
  } else if (action === "reject") {
    const response = await fetch(`/api/drafts/${id}/reject`, { method: "POST" });
    const body = await response.json();
    toast(body.message || "Rejected.");
    await refresh();
  } else if (action === "remove-shot") {
    await fetch(`/api/drafts/${id}/screenshot`, { method: "DELETE" });
    toast("Screenshot removed.");
    await refresh();
    editing = id;
    render();
  }
}

async function onSubmit(event) {
  if (event.target.id !== "edit-form") return;
  event.preventDefault();
  const form = event.target;
  const id = editing;
  const links = form.links.value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const response = await fetch(`/api/drafts/${id}/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      side: form.side.value,
      quote: form.quote.value,
      rationale: form.rationale.value,
      publishedAt: form.publishedAt.value,
      links,
      note: form.note.value,
      rebuildNote: form.rebuildNote.checked,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    toast(body.message || "Could not save.");
    return;
  }
  const file = form.screenshot.files[0];
  if (file) {
    const upload = await fetch(`/api/drafts/${id}/screenshot`, {
      method: "POST",
      headers: { "content-type": file.type, "x-filename": file.name },
      body: file,
    });
    const uploaded = await upload.json();
    if (!upload.ok) {
      toast(uploaded.message || "The screenshot was not attached.");
      await refresh();
      editing = id;
      render();
      return;
    }
  }
  editing = null;
  toast(body.message || "Saved.");
  await refresh();
}

function toast(message) {
  toastText = message;
  render();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    toastText = "";
    if (!editing) render();
  }, 3200);
}

function slotRow(slots, caption, label, full) {
  const wrap = el("span", { className: full ? "slots full" : "slots" });
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", label);
  for (const on of slots) wrap.append(el("i", { className: on ? "slot on" : "slot" }));
  if (caption) wrap.append(el("span", { className: "slot-caption" }, caption));
  return wrap;
}

function field(label, control) {
  return el("label", {}, [label, control]);
}

function area(name, value) {
  const node = el("textarea", { name });
  node.value = value;
  return node;
}

function option(value, label) {
  const node = el("option", { value }, label);
  return node;
}

function globe() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "#8d8278");
  svg.setAttribute("stroke-width", "1.6");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "9");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9s-1.3 6.2-3.8 9c-2.5-2.8-3.8-5.8-3.8-9S9.5 5.8 12 3z");
  svg.append(circle, path);
  return svg;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "className") node.className = value;
    else node.setAttribute(key, value);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
