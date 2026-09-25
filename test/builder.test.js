import { describe, expect, it } from "vitest";
import { buildCurlCommand, buildJevInput, draftFromJevInput, newQuestion } from "../public/builder.js";
import { PRESETS } from "../public/presets.js";

const textField = (text) => ({ mode: "text", text });

describe("buildJevInput", () => {
  it("round-trips every preset back to the same Jev input", () => {
    for (const preset of PRESETS) {
      const { input, errors } = buildJevInput(draftFromJevInput(preset.input));
      expect(errors, preset.name).toEqual([]);
      expect(input, preset.name).toEqual(preset.input);
    }
  });

  it("parses JSON state and reports invalid JSON against the state field", () => {
    const question = newQuestion("noul", { id: "q", instructions: textField("Is it?") });

    const valid = buildJevInput({ state: { mode: "json", text: '{"a": 1}' }, questions: [question] });
    expect(valid.input.state).toEqual({ a: 1 });

    const invalid = buildJevInput({ state: { mode: "json", text: "{nope" }, questions: [question] });
    expect(invalid.errors.map((error) => error.path)).toContain("state");
  });

  it("omits noul criteria when both sides are blank, and keeps only the filled side", () => {
    const blank = newQuestion("noul", { id: "q", instructions: textField("Is it?") });
    expect(buildJevInput({ state: textField("s"), questions: [blank] }).input.questions.q).toEqual({
      type: "noul",
      instructions: "Is it?",
    });

    const halfFilled = newQuestion("noul", {
      id: "q",
      instructions: textField("Is it?"),
      noulCriteria: { true: "Clearly yes", false: "  " },
    });
    expect(buildJevInput({ state: textField("s"), questions: [halfFilled] }).input.questions.q.criteria).toEqual({
      true: "Clearly yes",
    });
  });

  it("sends a blank choice description as null", () => {
    const question = newQuestion("choice", {
      id: "pick",
      instructions: textField("Which?"),
      choiceOptions: [
        { key: "a", description: "First" },
        { key: "b", description: "" },
      ],
    });
    const { input, errors } = buildJevInput({ state: textField("s"), questions: [question] });
    expect(errors).toEqual([]);
    expect(input.questions.pick.criteria).toEqual({ a: "First", b: null });
  });

  it("flags duplicate ids, duplicate options, missing names, and empty instructions", () => {
    const { errors } = buildJevInput({
      state: textField("s"),
      questions: [
        newQuestion("choice", {
          id: "dup",
          instructions: textField(""),
          choiceOptions: [
            { key: "a", description: "" },
            { key: "a", description: "" },
            { key: " ", description: "" },
          ],
        }),
        newQuestion("noul", { id: "dup", instructions: textField("ok") }),
        newQuestion("noul", { id: "  ", instructions: textField("ok") }),
      ],
    });
    const messages = errors.map((error) => error.message);
    expect(messages).toContain('Id "dup" is used twice.');
    expect(messages).toContain('Option "a" is listed twice.');
    expect(messages).toContain("Every option needs a name.");
    expect(messages).toContain("Instructions are required.");
    expect(messages).toContain("Every question needs an id.");
  });

  it("enforces the 2 to 10 score level range", () => {
    const withLevels = (count) =>
      buildJevInput({
        state: textField("s"),
        questions: [
          newQuestion("score", {
            id: "rate",
            instructions: textField("How much?"),
            scoreLevels: Array.from({ length: count }, (_, index) => `Level ${index}`),
          }),
        ],
      }).errors;

    expect(withLevels(1)).toHaveLength(1);
    expect(withLevels(2)).toEqual([]);
    expect(withLevels(10)).toEqual([]);
    expect(withLevels(11)).toHaveLength(1);
  });

  it("requires at least one question", () => {
    const { errors } = buildJevInput({ state: textField("s"), questions: [] });
    expect(errors).toEqual([{ path: "questions", message: "Add at least one question." }]);
  });
});

describe("buildCurlCommand", () => {
  it("wraps the input in the Cloudflare REST envelope and escapes single quotes", () => {
    const curl = buildCurlCommand({ state: "it's broken", questions: {} });
    expect(curl).toContain("/ai/run");
    expect(curl).toContain('"model": "typesafe/jev"');
    expect(curl).toContain("it'\\''s broken");
  });
});
