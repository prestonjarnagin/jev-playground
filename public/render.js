import { h } from "./dom.js";

const percent = (probability) => `${Math.round(probability * 100)}%`;
const twoDecimals = (value) => value.toFixed(2);

function describe(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function confidenceTag(confidence) {
  return h(
    "span",
    { class: "confidence", title: "How certain Jev is, derived from the probability spread" },
    `${twoDecimals(confidence)} confidence`,
  );
}

function answerHeader(questionId, type, ...extras) {
  return h("header", { class: "answer-head" }, h("span", { class: `type-chip type-${type}` }, type), h("code", { class: "answer-id" }, questionId), ...extras);
}

function renderNoul(questionId, answer, question) {
  const value = answer.noul;
  const noLabel = describe(question?.criteria?.false) || "No";
  const yesLabel = describe(question?.criteria?.true) || "Yes";

  return h(
    "article",
    { class: "answer answer-noul" },
    answerHeader(questionId, "noul"),
    h("div", { class: "readout" }, h("span", { class: "readout-value" }, twoDecimals(value)), h("span", { class: "readout-unit" }, "probability of yes")),
    h(
      "div",
      { class: "gauge", role: "img", "aria-label": `Probability of yes: ${twoDecimals(value)}` },
      h("div", { class: "gauge-fill", style: { width: percent(value) } }),
      h("div", { class: "gauge-midline" }),
      h("div", { class: "gauge-needle", style: { left: percent(value) } }),
    ),
    h("div", { class: "gauge-ends" }, h("span", {}, h("b", {}, "0 "), noLabel), h("span", {}, yesLabel, h("b", {}, " 1"))),
  );
}

function renderChoice(questionId, answer, question) {
  const ranked = Object.entries(answer.probabilities).sort(([, a], [, b]) => b - a);

  return h(
    "article",
    { class: "answer answer-choice" },
    answerHeader(questionId, "choice", confidenceTag(answer.confidence)),
    h("div", { class: "readout" }, h("span", { class: "readout-value readout-word" }, answer.choice)),
    h(
      "ol",
      { class: "choice-bars" },
      ranked.map(([option, probability]) =>
        h(
          "li",
          { class: option === answer.choice ? "is-chosen" : "" },
          h("div", { class: "choice-label" }, h("code", {}, option), h("span", { class: "choice-description" }, describe(question?.criteria?.[option]))),
          h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: { width: percent(probability) } })),
          h("span", { class: "bar-value" }, percent(probability)),
        ),
      ),
    ),
  );
}

function renderScore(questionId, answer) {
  const levels = Object.keys(answer.legend).sort((a, b) => Number(a) - Number(b));
  const highestLevel = Math.max(levels.length - 1, 1);
  const scorePosition = Math.min(Math.max(answer.score / highestLevel, 0), 1);

  return h(
    "article",
    { class: "answer answer-score" },
    answerHeader(questionId, "score", confidenceTag(answer.confidence)),
    h("div", { class: "readout" }, h("span", { class: "readout-value" }, twoDecimals(answer.score)), h("span", { class: "readout-unit" }, `on a 0 to ${levels.length - 1} scale`)),
    h(
      "div",
      { class: "ruler", style: { "--levels": String(levels.length) }, role: "img", "aria-label": `Score ${twoDecimals(answer.score)}` },
      h(
        "div",
        { class: "ruler-columns" },
        levels.map((level) =>
          h(
            "div",
            { class: "ruler-column" },
            h("span", { class: "ruler-probability" }, percent(answer.probabilities[level] ?? 0)),
            h("div", { class: "ruler-bar", style: { "--probability": String(answer.probabilities[level] ?? 0) } }),
          ),
        ),
      ),
      h("div", { class: "ruler-axis" }, h("div", { class: "ruler-needle", style: { left: percent(scorePosition) } })),
      h("div", { class: "ruler-ticks" }, levels.map((level) => h("span", {}, level))),
    ),
    h("ol", { class: "legend", start: "0" }, levels.map((level) => h("li", {}, answer.legend[level]))),
  );
}

/**
 * Draws one instrument per answer. The question from the request is passed
 * alongside so option and criteria descriptions can label the bars.
 */
export function renderAnswers(result, request) {
  const answers = result?.answers;
  if (!answers || typeof answers !== "object") {
    return h("p", { class: "empty" }, "The response has no answers. Check the raw view for what came back.");
  }

  return h(
    "div",
    { class: "answers" },
    Object.entries(answers).map(([questionId, answer]) => {
      const question = request?.questions?.[questionId];
      if (answer.type === "noul") return renderNoul(questionId, answer, question);
      if (answer.type === "choice") return renderChoice(questionId, answer, question);
      if (answer.type === "score") return renderScore(questionId, answer);
      return h("pre", { class: "answer" }, JSON.stringify({ [questionId]: answer }, null, 2));
    }),
  );
}
