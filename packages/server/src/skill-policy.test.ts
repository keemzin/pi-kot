import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isSkillEffective,
  getProjectOverride,
  readSkillOverrides,
  setSkillEnabled,
  setAllSkillsEnabled,
  setProjectSkillOverride,
  clearProjectSkillOverrides,
  _setSkillOverridesFileForTesting,
} from "./skill-policy.js";

describe("skill-policy", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pi-kot-skills-test-"));
    _setSkillOverridesFileForTesting(join(tempDir, "skill-overrides.json"));
  });

  afterEach(async () => {
    _setSkillOverridesFileForTesting(undefined);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  describe("isSkillEffective", () => {
    it("returns true by default when no overrides exist", () => {
      const overrides = { disableAll: false, global: [], projects: {} };
      expect(isSkillEffective(overrides, undefined, "my-skill")).toBe(true);
      expect(isSkillEffective(overrides, "proj-1", "my-skill")).toBe(true);
    });

    it("returns false when skill is in global disabled list", () => {
      const overrides = { disableAll: false, global: ["my-skill"], projects: {} };
      expect(isSkillEffective(overrides, undefined, "my-skill")).toBe(false);
      expect(isSkillEffective(overrides, "proj-1", "my-skill")).toBe(false);
      expect(isSkillEffective(overrides, undefined, "other-skill")).toBe(true);
    });

    it("returns false for all skills when disableAll is true", () => {
      const overrides = { disableAll: true, global: [], projects: {} };
      expect(isSkillEffective(overrides, undefined, "skill-a")).toBe(false);
      expect(isSkillEffective(overrides, undefined, "skill-b")).toBe(false);
    });

    it("respects per-project enable override over global disable", () => {
      const overrides = {
        disableAll: false,
        global: ["my-skill"],
        projects: {
          "proj-1": { enable: ["my-skill"], disable: [] },
        },
      };
      expect(isSkillEffective(overrides, "proj-1", "my-skill")).toBe(true);
      expect(isSkillEffective(overrides, "proj-2", "my-skill")).toBe(false);
    });

    it("respects per-project disable override over global enable", () => {
      const overrides = {
        disableAll: false,
        global: [],
        projects: {
          "proj-1": { enable: [], disable: ["my-skill"] },
        },
      };
      expect(isSkillEffective(overrides, "proj-1", "my-skill")).toBe(false);
      expect(isSkillEffective(overrides, "proj-2", "my-skill")).toBe(true);
    });
  });

  describe("persistence operations", () => {
    it("reads empty state when file does not exist", async () => {
      const overrides = await readSkillOverrides();
      expect(overrides).toEqual({ disableAll: false, global: [], projects: {} });
    });

    it("disables and enables individual skills", async () => {
      await setSkillEnabled("skill-x", false);
      let data = await readSkillOverrides();
      expect(data.global).toContain("skill-x");
      expect(isSkillEffective(data, undefined, "skill-x")).toBe(false);

      await setSkillEnabled("skill-x", true);
      data = await readSkillOverrides();
      expect(data.global).not.toContain("skill-x");
      expect(isSkillEffective(data, undefined, "skill-x")).toBe(true);
    });

    it("toggles all skills with setAllSkillsEnabled", async () => {
      await setAllSkillsEnabled(false);
      let data = await readSkillOverrides();
      expect(data.disableAll).toBe(true);
      expect(isSkillEffective(data, undefined, "any-skill")).toBe(false);

      await setAllSkillsEnabled(true);
      data = await readSkillOverrides();
      expect(data.disableAll).toBe(false);
      expect(data.global).toEqual([]);
      expect(isSkillEffective(data, undefined, "any-skill")).toBe(true);
    });

    it("unsets disableAll when enabling an individual skill", async () => {
      await setAllSkillsEnabled(false);
      let data = await readSkillOverrides();
      expect(data.disableAll).toBe(true);

      await setSkillEnabled("skill-one", true);
      data = await readSkillOverrides();
      expect(data.disableAll).toBe(false);
      expect(isSkillEffective(data, undefined, "skill-one")).toBe(true);
    });

    it("manages per-project overrides and clearing", async () => {
      await setProjectSkillOverride("proj-a", "skill-z", "disabled");
      let data = await readSkillOverrides();
      expect(getProjectOverride(data, "proj-a", "skill-z")).toBe("disabled");
      expect(isSkillEffective(data, "proj-a", "skill-z")).toBe(false);

      await clearProjectSkillOverrides("proj-a");
      data = await readSkillOverrides();
      expect(getProjectOverride(data, "proj-a", "skill-z")).toBeUndefined();
    });
  });
});
