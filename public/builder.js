export const QUESTION_TYPES = ["noul", "choice", "score"];
export const MAX_CHOICE_OPTIONS = 255;
export const MIN_SCORE_LEVELS = 2;
export const MAX_SCORE_LEVELS = 10;

/**
 * A field typed in the builder is either plain text or JSON, because Jev
 * accepts structured values for state and instructions.
 */
function parseTextOrJson(field, path, errors) {
  if (field.mode !== "json") return field.text;
  try {
    return JSON.parse(field.text);
  } catch (error) {
    errors.push({ path, message: `Not valid JSON: ${error.message}` });
    return undefined;
  }
}

function blankToNull(text) {
  return text.trim() === "" ? null : text;
}

function buildNoulCriteria(criteria) {
  const trueDescription = criteria.true.trim();
  const falseDescription = criteria.false.trim();
  if (!trueDescription && !falseDescription) return undefined;

  const built = {};
  if (trueDescription) built.true = criteria.true;
  if (falseDescription) built.false = criteria.false;
  return built;
}

function buildChoiceCriteria(options, path, errors) {
  if (options.length === 0) errors.push({ path, message: "Add at least one option." });
  if (options.length > MAX_CHOICE_OPTIONS) {
    errors.push({ path, message: `Choice allows at most ${MAX_CHOICE_OPTIONS} options.` });
  }

  const built = {};
  for (const option of options) {
    const key = option.key.trim();
    if (!key) {
      errors.push({ path, message: "Every option needs a name." });
      continue;
    }
    if (key in built) errors.push({ path, message: `Option "${key}" is listed twice.` });
    built[key] = blankToNull(option.description);
  }
  return built;
}

function buildScoreCriteria(levels, path, errors) {
  if (levels.length < MIN_SCORE_LEVELS || levels.length > MAX_SCORE_LEVELS) {
    errors.push({ path, message: `Score needs ${MIN_SCORE_LEVELS} to ${MAX_SCORE_LEVELS} levels.` });
  }
  if (levels.some((level) => level.trim() === "")) {
    errors.push({ path, message: "Every level needs a description." });
  }
  return [...levels];
}

function buildQuestion(question, path, errors) {
  const instructions = parseTextOrJson(question.instructions, `${path}.instructions`, errors);
  if (question.instructions.mode === "text" && question.instructions.text.trim() === "") {
    errors.push({ path: `${path}.instructions`, message: "Instructions are required." });
  }

  const built = { type: question.type, instructions };

  if (question.type === "noul") {
    const criteria = buildNoulCriteria(question.noulCriteria);
    if (criteria) built.criteria = criteria;
  } else if (question.type === "choice") {
    built.criteria = buildChoiceCriteria(question.choiceOptions, `${path}.criteria`, errors);
  } else if (question.type === "score") {
    built.criteria = buildScoreCriteria(question.scoreLevels, `${path}.criteria`, errors);
  } else {
    errors.push({ path, message: `Unknown question type "${question.type}".` });
  }

  return built;
}

/**
 * Turns builder state into the exact input sent to `env.AI.run("typesafe/jev", input)`.
 * Returns every problem found rather than stopping at the first, so the
 * builder can mark all of them at once.
 */
export function buildJevInput(draft) {
  const errors = [];
  const state = parseTextOrJson(draft.state, "state", errors);

  if (draft.questions.length === 0) errors.push({ path: "questions", message: "Add at least one question." });

  const questions = {};
  for (const question of draft.questions) {
    const questionId = question.id.trim();
    const path = `questions.${questionId || question.uid}`;
    if (!questionId) {
      errors.push({ path, message: "Every question needs an id." });
      continue;
    }
    if (questionId in questions) errors.push({ path, message: `Id "${questionId}" is used twice.` });
    questions[questionId] = buildQuestion(question, path, errors);
  }

  return { input: { state, questions }, errors };
}

export function buildCurlCommand(input) {
  const envelope = JSON.stringify({ model: "typesafe/jev", input }, null, 2).replaceAll("'", "'\\''");
  return [
    "curl https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run \\",
    '  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \\',
    '  --header "Content-Type: application/json" \\',
    `  --data '${envelope}'`,
  ].join("\n");
}

let uidCounter = 0;
export function newUid() {
  uidCounter += 1;
  return `q${Date.now().toString(36)}${uidCounter}`;
}

export function newQuestion(type, overrides = {}) {
  return {
    uid: newUid(),
    id: "",
    type,
    instructions: { mode: "text", text: "" },
    noulCriteria: { true: "", false: "" },
    choiceOptions: [
      { key: "", description: "" },
      { key: "", description: "" },
    ],
    scoreLevels: ["", "", ""],
    ...overrides,
  };
}

function textField(value) {
  return typeof value === "string"
    ? { mode: "text", text: value }
    : { mode: "json", text: JSON.stringify(value, null, 2) };
}

function criteriaText(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * The reverse of `buildJevInput`: loads a Jev input (a preset or a pasted
 * request) back into editable builder state.
 */
export function draftFromJevInput(input) {
  const questions = Object.entries(input.questions ?? {}).map(([id, question]) => {
    const draftQuestion = newQuestion(question.type, { id, instructions: textField(question.instructions ?? "") });
    if (question.type === "noul") {
      draftQuestion.noulCriteria = {
        true: criteriaText(question.criteria?.true),
        false: criteriaText(question.criteria?.false),
      };
    } else if (question.type === "choice") {
      draftQuestion.choiceOptions = Object.entries(question.criteria ?? {}).map(([key, description]) => ({
        key,
        description: criteriaText(description),
      }));
    } else if (question.type === "score") {
      draftQuestion.scoreLevels = (question.criteria ?? []).map(criteriaText);
    }
    return draftQuestion;
  });

  return { state: textField(input.state ?? ""), questions };
}
