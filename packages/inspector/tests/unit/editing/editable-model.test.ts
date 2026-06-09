import { describe, expect, it } from "vitest";
import { EDITABLE_CONFIG_FIELDS, findField } from "../../../src/editing/editable-model.js";

describe("editable-model", () => {
  it("declares model and permissions fields with correct types", () => {
    expect(findField("model.name")?.type).toBe("string");
    expect(findField("model.provider")?.type).toBe("enum");
    expect(findField("model.provider")?.enumValues).toEqual(["anthropic", "openai"]);
    expect(findField("permissions.mode")?.enumValues).toEqual(["yolo", "ask", "plan"]);
    expect(findField("model.settings.temperature")?.type).toBe("number");
  });

  it("has unique field ids that equal their configPath", () => {
    const ids = EDITABLE_CONFIG_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const field of EDITABLE_CONFIG_FIELDS) {
      expect(field.id).toBe(field.configPath);
    }
  });
});
