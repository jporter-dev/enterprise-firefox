/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  setAndLockPref,
  unsetAndUnlockPref,
} from "resource:///modules/policies/Policies.sys.mjs";

const PREF_LOGLEVEL = "browser.policies.loglevel";
const DLP_MODE_PREF = "enterprise.dlp.mode";
const BUILTIN_RULES_PREF = "enterprise.dlp.builtin.rules";

const VALID_ACTIONS = [
  "ClipboardCopy",
  "ClipboardPaste",
  "Download",
  "DragAndDrop",
  "FileUpload",
  "Print",
];
const VALID_TYPES = ["warn", "block"];
const NAME_REGEX = /^[a-z0-9-]{1,64}$/;

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  let { ConsoleAPI } = ChromeUtils.importESModule(
    "resource://gre/modules/Console.sys.mjs"
  );
  return new ConsoleAPI({
    prefix: "BuiltinDataLossPrevention",
    maxLogLevel: "error",
    maxLogLevelPref: PREF_LOGLEVEL,
  });
});

/**
 * Helper for the BuiltinDataLossPrevention enterprise policy.
 *
 * The built-in DLP and ContentAnalysis policies share a single derived
 * `enterprise.dlp.mode` pref. ContentAnalysis takes precedence: when both
 * policies are enabled the mode is "contentanalysis"; when only the built-in
 * policy is enabled it is "builtin"; when neither is enabled the pref is
 * cleared. Both policies call `updateDLPMode` whenever they are applied or
 * removed so the mode always reflects the final active policy set.
 */
export const BuiltinDataLossPrevention = {
  /**
   * Recompute the shared `enterprise.dlp.mode` pref from the active policy set.
   *
   * Reads the final active policies (so application order is irrelevant) and
   * resolves precedence in one place. Called by both the BuiltinDataLossPrevention
   * and ContentAnalysis handlers on add and remove.
   *
   * @param {object} manager - The enterprise policy manager, used to query the
   *   currently active policies via `getActivePolicies()`.
   */
  updateDLPMode(manager) {
    const activePolicies = manager.getActivePolicies();
    const caActive = activePolicies?.ContentAnalysis?.Enabled === true;
    const builtinActive =
      activePolicies?.BuiltinDataLossPrevention?.Enabled === true;

    if (!caActive && !builtinActive) {
      unsetAndUnlockPref(DLP_MODE_PREF);
      return;
    }

    setAndLockPref(DLP_MODE_PREF, caActive ? "contentanalysis" : "builtin");
  },

  /**
   * Validate the configured rules, dropping any that are invalid.
   *
   * Each rule is checked independently; an invalid rule is skipped and logged
   * to about:policies#errors while the remaining rules still load. Enforces:
   *   - Name unique within the policy and matching [a-z0-9-]{1,64}
   *   - Actions non-empty and drawn only from the known interception points
   *   - Domains present and non-empty (["*"] matches all domains)
   *   - Type (when present) is "warn" or "block"
   *
   * @param {Array<object>} rules - The raw Rules array from the policy.
   * @returns {Array<object>} The subset of rules that passed validation.
   */
  validateRules(rules) {
    const valid = [];
    const seenNames = new Set();

    for (const rule of rules) {
      const name = rule.Name;

      if (typeof name !== "string" || !NAME_REGEX.test(name)) {
        lazy.log.error(
          `BuiltinDataLossPrevention: skipping rule with invalid Name ` +
            `${JSON.stringify(name)} - must match [a-z0-9-]{1,64}.`
        );
        continue;
      }

      if (seenNames.has(name)) {
        lazy.log.error(
          `BuiltinDataLossPrevention: skipping rule "${name}" - Name must be ` +
            `unique within the policy.`
        );
        continue;
      }

      if (
        !Array.isArray(rule.Actions) ||
        !rule.Actions.length ||
        !rule.Actions.every(action => VALID_ACTIONS.includes(action))
      ) {
        lazy.log.error(
          `BuiltinDataLossPrevention: skipping rule "${name}" - Actions must ` +
            `be non-empty and only contain ${VALID_ACTIONS.join(", ")}.`
        );
        continue;
      }

      if (
        !Array.isArray(rule.Domains) ||
        !rule.Domains.length ||
        !rule.Domains.every(
          domain => typeof domain === "string" && domain.length
        )
      ) {
        lazy.log.error(
          `BuiltinDataLossPrevention: skipping rule "${name}" - Domains must ` +
            `be present and contain only non-empty strings (use ["*"] for all ` +
            `domains).`
        );
        continue;
      }

      if ("Type" in rule && !VALID_TYPES.includes(rule.Type)) {
        lazy.log.error(
          `BuiltinDataLossPrevention: skipping rule "${name}" - Type must be ` +
            `"warn" or "block".`
        );
        continue;
      }

      seenNames.add(name);
      valid.push(rule);
    }

    return valid;
  },

  /**
   * Enable built-in DLP: validate and persist the rules, then recompute the
   * DLP mode.
   *
   * Valid rules (including those with `Enabled: false`, which load but stay
   * inactive) are written to the locked `enterprise.dlp.builtin.rules` pref as
   * a JSON string for the DLP engine to consume.
   *
   * @param {object} manager - The enterprise policy manager.
   * @param {object} param - The BuiltinDataLossPrevention policy object.
   * @param {Array<object>} [param.Rules] - The configured DLP rules.
   */
  enable(manager, param) {
    const rules = this.validateRules(param.Rules ?? []);
    setAndLockPref(BUILTIN_RULES_PREF, JSON.stringify(rules));
    this.updateDLPMode(manager);
  },

  /**
   * Disable built-in DLP: clear the persisted rules and recompute the DLP mode.
   *
   * @param {object} manager - The enterprise policy manager.
   */
  disable(manager) {
    unsetAndUnlockPref(BUILTIN_RULES_PREF);
    this.updateDLPMode(manager);
  },
};
