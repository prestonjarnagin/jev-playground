import { buildCurlCommand, buildJevInput, draftFromJevInput, newQuestion, QUESTION_TYPES } from "./builder.js";
import { h } from "./dom.js";
import { highlightJson } from "./highlight.js";
import { PRESETS } from "./presets.js";
import { renderAnswers } from "./render.js";

const DRAFT_STORAGE_KEY = "jev-playground:draft";
const HISTORY_STORAGE_KEY = "jev-playground:history";
const HISTORY_LIMIT = 25;

function readStored(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked; the page works the same without it.
  }
}

const app = {
  draft: readStored(DRAFT_STORAGE_KEY, null) ?? draftFromJevInput(PRESETS[0].input),
  requestTab: "body",
  responseTab: "formatted",
  running: false,
  selectedRun: null,
  history: readStored(HISTORY_STORAGE_KEY, []),
};

const elements = {
  builder: document.querySelector("#builder"),
  requestCode: document.querySelector("#request-code"),
  requestProblems: document.querySelector("#request-problems"),
  requestTabs: document.querySelector("#request-tabs"),
  copyRequest: document.querySelector("#copy-request"),
  runButton: document.querySelector("#run"),
  runHint: document.querySelector("#run-hint"),
  stats: document.querySelector("#stats"),
  responseTabs: document.querySelector("#response-tabs"),
  responseBody: document.querySelector("#response-body"),
  history: document.querySelector("#history"),
  clearHistory: document.querySelector("#clear-history"),
};

/* ---------- builder ---------- */

function modeToggle(field, onChange, label) {
  return h(
    "div",
    { class: "segmented", role: "group", "aria-label": label },
    ["text", "json"].map((mode) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(field.mode === mode),
          onclick: () => {
            field.mode = mode;
            onChange();
          },
        },
        mode === "text" ? "Text" : "JSON",
      ),
    ),
  );
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

function textArea(value, onInput, attributes = {}) {
  const textarea = h("textarea", { rows: "2", spellcheck: "false", ...attributes, oninput: (event) => {
    onInput(event.target.value);
    autoGrow(event.target);
    refreshDerived();
  } });
  textarea.value = value;
  requestAnimationFrame(() => autoGrow(textarea));
  return textarea;
}

function textInput(value, onInput, attributes = {}) {
  const input = h("input", { type: "text", spellcheck: "false", ...attributes, oninput: (event) => {
    onInput(event.target.value);
    refreshDerived();
  } });
  input.value = value;
  return input;
}

function iconButton(label, text, onclick) {
  return h("button", { type: "button", class: "icon-button", "aria-label": label, title: label, onclick }, text);
}

function renderStateEditor() {
  const { state } = app.draft;
  return h(
    "section",
    { class: "builder-section" },
    h("div", { class: "section-head" }, h("h2", {}, "State"), modeToggle(state, renderBuilder, "State format")),
    h("p", { class: "hint" }, state.mode === "json" ? "An object or array. Point questions at fields with backticks, like `order.charges`." : "The text Jev evaluates every question against."),
    textArea(state.text, (value) => (state.text = value), { "aria-label": "State", class: state.mode === "json" ? "is-code" : "" }),
    h("div", { class: "field-problems", dataset: { problemsFor: "state" } }),
  );
}

function renderNoulCriteria(question) {
  const criteria = question.noulCriteria;
  return h(
    "div",
    { class: "criteria criteria-noul" },
    h("p", { class: "hint" }, "Optional. Describe what a yes and a no mean."),
    h("label", {}, h("span", {}, "Yes (1)"), textInput(criteria.true, (value) => (criteria.true = value), { placeholder: "Explicitly time-sensitive" })),
    h("label", {}, h("span", {}, "No (0)"), textInput(criteria.false, (value) => (criteria.false = value), { placeholder: "No urgency expressed" })),
  );
}

function renderChoiceCriteria(question) {
  const options = question.choiceOptions;
  return h(
    "div",
    { class: "criteria" },
    h("p", { class: "hint" }, "Jev picks one option. The description is optional."),
    h(
      "ul",
      { class: "rows" },
      options.map((option, index) =>
        h(
          "li",
          { class: "row row-choice" },
          textInput(option.key, (value) => (option.key = value), { placeholder: "option", "aria-label": `Option ${index + 1} name`, class: "is-code" }),
          textInput(option.description, (value) => (option.description = value), { placeholder: "What this option covers", "aria-label": `Option ${index + 1} description` }),
          iconButton(`Remove option ${index + 1}`, "✕", () => {
            options.splice(index, 1);
            renderBuilder();
          }),
        ),
      ),
    ),
    h("button", { type: "button", class: "text-button", onclick: () => {
      options.push({ key: "", description: "" });
      renderBuilder();
    } }, "+ Add option"),
  );
}

function renderScoreCriteria(question) {
  const levels = question.scoreLevels;
  const moveLevel = (from, to) => {
    const [level] = levels.splice(from, 1);
    levels.splice(to, 0, level);
    renderBuilder();
  };
  return h(
    "div",
    { class: "criteria" },
    h("p", { class: "hint" }, "Ordered from lowest to highest. 2 to 10 levels."),
    h(
      "ol",
      { class: "rows", start: "0" },
      levels.map((level, index) =>
        h(
          "li",
          { class: "row row-score" },
          h("span", { class: "level-index" }, String(index)),
          textInput(level, (value) => (levels[index] = value), { placeholder: `Level ${index} description`, "aria-label": `Level ${index} description` }),
          iconButton(`Move level ${index} up`, "↑", () => index > 0 && moveLevel(index, index - 1)),
          iconButton(`Move level ${index} down`, "↓", () => index < levels.length - 1 && moveLevel(index, index + 1)),
          iconButton(`Remove level ${index}`, "✕", () => {
            levels.splice(index, 1);
            renderBuilder();
          }),
        ),
      ),
    ),
    h("button", { type: "button", class: "text-button", onclick: () => {
      levels.push("");
      renderBuilder();
    } }, "+ Add level"),
  );
}

const CRITERIA_EDITORS = { noul: renderNoulCriteria, choice: renderChoiceCriteria, score: renderScoreCriteria };

function renderQuestion(question, index) {
  const typeSelect = h(
    "select",
    { "aria-label": "Question type", class: `type-select type-${question.type}`, onchange: (event) => {
      question.type = event.target.value;
      renderBuilder();
    } },
    QUESTION_TYPES.map((type) => h("option", { value: type, selected: type === question.type }, type)),
  );

  return h(
    "li",
    { class: `question question-${question.type}`, dataset: { uid: question.uid } },
    h(
      "div",
      { class: "question-head" },
      typeSelect,
      textInput(question.id, (value) => (question.id = value), { placeholder: "question_id", "aria-label": "Question id", class: "question-id is-code" }),
      iconButton("Remove question", "✕", () => {
        app.draft.questions.splice(index, 1);
        renderBuilder();
      }),
    ),
    h(
      "div",
      { class: "section-head sub" },
      h("h3", {}, "Instructions"),
      modeToggle(question.instructions, renderBuilder, "Instructions format"),
    ),
    textArea(question.instructions.text, (value) => (question.instructions.text = value), {
      "aria-label": "Instructions",
      placeholder: question.instructions.mode === "json" ? '{ "question": "…" }' : "Ask the question Jev should answer",
      class: question.instructions.mode === "json" ? "is-code" : "",
    }),
    CRITERIA_EDITORS[question.type](question),
    h("div", { class: "field-problems", dataset: { problemsFor: `question:${question.uid}` } }),
  );
}

function renderBuilder() {
  const presetSelect = h(
    "select",
    { "aria-label": "Load an example", onchange: (event) => {
      const preset = PRESETS[Number(event.target.value)];
      if (preset) {
        app.draft = draftFromJevInput(preset.input);
        renderBuilder();
      }
    } },
    h("option", { value: "" }, "Load an example…"),
    PRESETS.map((preset, index) => h("option", { value: String(index) }, preset.name)),
  );

  elements.builder.replaceChildren(
    h("div", { class: "builder-toolbar" }, presetSelect, h("button", { type: "button", class: "text-button", onclick: () => {
      app.draft = { state: { mode: "text", text: "" }, questions: [newQuestion("noul")] };
      renderBuilder();
    } }, "Start blank")),
    renderStateEditor(),
    h(
      "section",
      { class: "builder-section" },
      h("div", { class: "section-head" }, h("h2", {}, "Questions"), h("span", { class: "count" }, String(app.draft.questions.length))),
      h("p", { class: "hint" }, "Jev evaluates every question in parallel against the same state. Answers come back under each id."),
      h("ol", { class: "questions" }, app.draft.questions.map(renderQuestion)),
      h(
        "div",
        { class: "add-question" },
        h("span", {}, "Add"),
        QUESTION_TYPES.map((type) =>
          h("button", { type: "button", class: `add-button type-${type}`, onclick: () => {
            app.draft.questions.push(newQuestion(type));
            renderBuilder();
            elements.builder.querySelector(".question:last-child .question-id")?.focus();
          } }, type),
        ),
      ),
    ),
  );
  refreshDerived();
}

/* ---------- request preview ---------- */

function problemsByTarget(errors) {
  const byTarget = new Map();
  for (const error of errors) {
    let target = "other";
    if (error.path === "state") target = "state";
    else if (error.path.startsWith("questions.")) {
      const segment = error.path.split(".")[1];
      const question = app.draft.questions.find((candidate) => candidate.id.trim() === segment || candidate.uid === segment);
      if (question) target = `question:${question.uid}`;
    }
    byTarget.set(target, [...(byTarget.get(target) ?? []), error.message]);
  }
  return byTarget;
}

function refreshDerived() {
  const { input, errors } = buildJevInput(app.draft);
  writeStored(DRAFT_STORAGE_KEY, app.draft);

  const byTarget = problemsByTarget(errors);
  for (const container of elements.builder.querySelectorAll("[data-problems-for]")) {
    const messages = byTarget.get(container.dataset.problemsFor) ?? [];
    container.replaceChildren(...messages.map((message) => h("p", {}, message)));
  }

  const code = app.requestTab === "curl" ? buildCurlCommand(input) : JSON.stringify(input, null, 2);
  elements.requestCode.replaceChildren(app.requestTab === "curl" ? code : highlightJson(code));
  elements.requestCode.dataset.copyText = code;

  elements.requestProblems.replaceChildren(
    ...(errors.length ? [h("p", {}, `Fix ${errors.length === 1 ? "1 problem" : `${errors.length} problems`} in the builder before running.`)] : []),
  );
  elements.runButton.disabled = errors.length > 0 || app.running;
}

/* ---------- response ---------- */

const usd = (value) => {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "$0";
  return value < 0.01 ? `$${value.toPrecision(2)}` : `$${value.toFixed(4)}`;
};
const milliseconds = (value) => (value === null || value === undefined ? "—" : `${Math.round(value).toLocaleString()} ms`);
const count = (value) => (value === null || value === undefined ? "—" : value.toLocaleString());

function renderStats(run) {
  const stats = run?.payload?.stats ?? {};
  const pricing = stats.pricing;
  const pricingNote = pricing
    ? `Estimated at $${pricing.usd_per_million_input_tokens} per million input tokens and $${pricing.usd_per_million_output_tokens} per million output tokens`
    : "";
  const items = [
    ["Model latency", milliseconds(stats.latency_ms), "Time the Worker spent waiting on Jev"],
    ["Round trip", milliseconds(run?.roundTripMs), "Browser to Worker to Jev and back"],
    ["Input tokens", count(stats.input_tokens), ""],
    ["Output tokens", count(stats.output_tokens), ""],
    ["Est. cost", usd(stats.cost_usd), pricingNote],
    ["Model", stats.model ?? "—", "Version that answered"],
  ];
  elements.stats.replaceChildren(
    ...items.map(([label, value, title]) => h("div", { class: "stat", title: title || null }, h("dt", {}, label), h("dd", {}, value))),
  );
}

function renderResponse() {
  const run = app.selectedRun;
  renderStats(run);
  for (const button of elements.responseTabs.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.tab === app.responseTab));
  }

  if (app.running) {
    elements.responseBody.replaceChildren(h("p", { class: "empty is-running" }, "Asking Jev…"));
    return;
  }
  if (!run) {
    elements.responseBody.replaceChildren(h("p", { class: "empty" }, "Run the request to see Jev's answers here."));
    return;
  }

  const failed = !run.ok;
  if (app.responseTab === "raw") {
    const raw = failed ? (run.payload.raw ?? run.payload) : (run.payload.raw ?? run.payload.result);
    elements.responseBody.replaceChildren(h("pre", { class: "code" }, h("code", {}, highlightJson(JSON.stringify(raw, null, 2)))));
    return;
  }

  if (failed) {
    elements.responseBody.replaceChildren(
      h(
        "div",
        { class: "failure" },
        h("h3", {}, `Request failed (HTTP ${run.status})`),
        h("p", {}, run.payload?.error ?? "No error message came back. Check the raw view."),
      ),
    );
    return;
  }
  elements.responseBody.replaceChildren(renderAnswers(run.payload.result, run.request));
}

function renderHistory() {
  elements.clearHistory.hidden = app.history.length === 0;
  if (app.history.length === 0) {
    elements.history.replaceChildren(h("li", { class: "empty" }, "Past runs show up here so you can compare them."));
    return;
  }
  elements.history.replaceChildren(
    ...app.history.map((run) => {
      const stats = run.payload?.stats ?? {};
      const questionCount = Object.keys(run.request?.questions ?? {}).length;
      const time = new Date(run.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
      return h(
        "li",
        {},
        h(
          "button",
          {
            type: "button",
            class: `history-row${run === app.selectedRun ? " is-selected" : ""}${run.ok ? "" : " is-failed"}`,
            onclick: () => {
              app.selectedRun = run;
              renderResponse();
              renderHistory();
            },
          },
          h("span", {}, time),
          h("span", {}, `${questionCount} ${questionCount === 1 ? "question" : "questions"}`),
          h("span", {}, run.ok ? milliseconds(stats.latency_ms) : `HTTP ${run.status}`),
          h("span", {}, count(stats.input_tokens), " tok"),
          h("span", {}, usd(stats.cost_usd)),
        ),
      );
    }),
  );
}

async function runRequest() {
  const { input, errors } = buildJevInput(app.draft);
  if (errors.length || app.running) return;

  app.running = true;
  elements.runButton.disabled = true;
  elements.runButton.textContent = "Running…";
  renderResponse();

  const startedAt = performance.now();
  let run;
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      // Cloudflare Access returns an HTML login page once the session expires.
      payload = { error: response.redirected || text.includes("cloudflareaccess") ? "Your Cloudflare Access session expired. Reload the page to sign in again." : `Unexpected response: ${text.slice(0, 300)}` };
    }
    run = { ok: response.ok && !payload.error, status: response.status, payload };
  } catch (error) {
    // An expired Access session redirects to a cross-origin login page, which
    // fetch reports as a network error rather than a response.
    run = { ok: false, status: 0, payload: { error: `Could not reach the Worker (${error.message}). If you have been away a while, reload the page to sign in again.` } };
  }
  run.roundTripMs = performance.now() - startedAt;
  run.request = input;
  run.at = Date.now();

  app.running = false;
  elements.runButton.textContent = "Run";
  app.selectedRun = run;
  app.history = [run, ...app.history].slice(0, HISTORY_LIMIT);
  writeStored(HISTORY_STORAGE_KEY, app.history);

  refreshDerived();
  renderResponse();
  renderHistory();
}

/* ---------- wiring ---------- */

function wireTabs(container, onSelect) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) return;
    for (const tab of container.querySelectorAll("button[data-tab]")) tab.setAttribute("aria-pressed", String(tab === button));
    onSelect(button.dataset.tab);
  });
}

wireTabs(elements.requestTabs, (tab) => {
  app.requestTab = tab;
  refreshDerived();
});
wireTabs(elements.responseTabs, (tab) => {
  app.responseTab = tab;
  renderResponse();
});

elements.copyRequest.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.requestCode.dataset.copyText ?? "");
    elements.copyRequest.textContent = "Copied";
  } catch {
    elements.copyRequest.textContent = "Copy failed";
  }
  setTimeout(() => (elements.copyRequest.textContent = "Copy"), 1500);
});

elements.clearHistory.addEventListener("click", () => {
  app.history = [];
  writeStored(HISTORY_STORAGE_KEY, app.history);
  renderHistory();
});

elements.runButton.addEventListener("click", runRequest);
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void runRequest();
  }
});
elements.runHint.textContent = navigator.platform.toLowerCase().includes("mac") ? "⌘ Enter" : "Ctrl Enter";

app.selectedRun = app.history[0] ?? null;
renderBuilder();
renderResponse();
renderHistory();
