import { describe, expect, it } from "vitest";
import { applyVariables, projectVariablesSchema, variableNames } from "@/domain/variables";

describe("project variables", () => {
  const variables = [{ key: "saarnaaja", value: "[Nimi]" }, { key: "pyhäpäivä", value: "Mikkelinpäivä" }];

  it("fills known names, keeps spacing inside braces optional and leaves unknown names visible", () => {
    expect(applyVariables("{{pyhäpäivä}} · {{ saarnaaja }}", variables)).toBe("Mikkelinpäivä · [Nimi]");
    expect(applyVariables("{{evankeliumi}}", variables)).toBe("{{evankeliumi}}");
    expect(applyVariables("no tokens", undefined)).toBe("no tokens");
  });

  it("lists the names a text uses once each", () => {
    expect(variableNames("{{a}} {{b}} {{ a }}")).toEqual(["a", "b"]);
  });

  it("accepts Finnish letters but rejects spaces, braces and duplicates", () => {
    expect(projectVariablesSchema.safeParse(variables).success).toBe(true);
    expect(projectVariablesSchema.safeParse([{ key: "two words", value: "" }]).success).toBe(false);
    expect(projectVariablesSchema.safeParse([{ key: "a}}", value: "" }]).success).toBe(false);
    expect(projectVariablesSchema.safeParse([{ key: "a", value: "1" }, { key: "a", value: "2" }]).success).toBe(false);
  });
});
