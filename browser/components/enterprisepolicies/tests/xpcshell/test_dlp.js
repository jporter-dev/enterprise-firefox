/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

const DLP_MODE_PREF = "enterprise.dlp.mode";
const BUILTIN_RULES_PREF = "enterprise.dlp.builtin.rules";

function getPersistedRules() {
  return JSON.parse(Preferences.get(BUILTIN_RULES_PREF));
}

add_task(async function test_builtin_only() {
  await setupPolicyEngineWithJson({
    policies: {
      BuiltinDataLossPrevention: {
        Enabled: true,
      },
    },
  });

  checkLockedPref(DLP_MODE_PREF, "builtin");
  deepEqual(getPersistedRules(), [], "No rules persisted when none configured");
});

add_task(async function test_content_analysis_only() {
  await setupPolicyEngineWithJson({
    policies: {
      ContentAnalysis: {
        Enabled: true,
      },
    },
  });

  checkLockedPref(DLP_MODE_PREF, "contentanalysis");
});

add_task(async function test_both_enabled_content_analysis_wins() {
  await setupPolicyEngineWithJson({
    policies: {
      BuiltinDataLossPrevention: {
        Enabled: true,
      },
      ContentAnalysis: {
        Enabled: true,
      },
    },
  });

  checkLockedPref(DLP_MODE_PREF, "contentanalysis");
});

add_task(async function test_builtin_disabled() {
  await setupPolicyEngineWithJson({
    policies: {
      BuiltinDataLossPrevention: {
        Enabled: false,
      },
    },
  });

  checkUnsetPref(DLP_MODE_PREF);
});

add_task(async function test_no_dlp_policies() {
  await setupPolicyEngineWithJson({
    policies: {},
  });

  checkUnsetPref(DLP_MODE_PREF);
});

add_task(async function test_rule_validation() {
  await setupPolicyEngineWithJson({
    policies: {
      BuiltinDataLossPrevention: {
        Enabled: true,
        Rules: [
          {
            Name: "block-uploads",
            Actions: ["FileUpload"],
            Domains: ["drive.google.com"],
            Type: "block",
          },
          {
            Name: "warn-copy",
            Actions: ["ClipboardCopy", "Print"],
            Domains: ["*"],
          },
          // Invalid Name (uppercase and underscore).
          {
            Name: "Bad_Name",
            Actions: ["Download"],
            Domains: ["*"],
          },
          // Duplicate Name.
          {
            Name: "block-uploads",
            Actions: ["Print"],
            Domains: ["*"],
          },
          // Empty Actions.
          {
            Name: "empty-actions",
            Actions: [],
            Domains: ["*"],
          },
          // Action not in the enum.
          {
            Name: "bad-action",
            Actions: ["Teleport"],
            Domains: ["*"],
          },
          // Empty Domains.
          {
            Name: "empty-domains",
            Actions: ["Print"],
            Domains: [],
          },
          // Domains array with an empty-string entry.
          {
            Name: "empty-domain-string",
            Actions: ["Print"],
            Domains: [""],
          },
          // Invalid Type.
          {
            Name: "bad-type",
            Actions: ["Print"],
            Domains: ["*"],
            Type: "destroy",
          },
          // Missing required Domains (dropped by schema validation).
          {
            Name: "missing-domains",
            Actions: ["Print"],
          },
        ],
      },
    },
  });

  checkLockedPref(DLP_MODE_PREF, "builtin");

  const rules = getPersistedRules();
  deepEqual(
    rules.map(rule => rule.Name),
    ["block-uploads", "warn-copy"],
    "Only valid rules are persisted; the rest of the policy still applies"
  );
});

add_task(async function test_disabled_rule_still_loads() {
  await setupPolicyEngineWithJson({
    policies: {
      BuiltinDataLossPrevention: {
        Enabled: true,
        Rules: [
          {
            Name: "inactive-rule",
            Enabled: false,
            Actions: ["Print"],
            Domains: ["*"],
          },
        ],
      },
    },
  });

  const rules = getPersistedRules();
  deepEqual(
    rules.map(rule => rule.Name),
    ["inactive-rule"],
    "A valid but disabled rule still loads (Enabled:false disables, not removes)"
  );
  strictEqual(rules[0].Enabled, false, "Rule retains its Enabled flag");
});

add_task(async function test_invalid_rule_does_not_shadow_valid_duplicate() {
  await setupPolicyEngineWithJson({
    policies: {
      BuiltinDataLossPrevention: {
        Enabled: true,
        Rules: [
          // Invalid (empty Actions) - must not reserve the Name.
          {
            Name: "shared-name",
            Actions: [],
            Domains: ["*"],
          },
          // Valid rule with the same Name - must still load.
          {
            Name: "shared-name",
            Actions: ["Print"],
            Domains: ["*"],
          },
        ],
      },
    },
  });

  deepEqual(
    getPersistedRules().map(rule => rule.Name),
    ["shared-name"],
    "An earlier invalid rule does not shadow a later valid rule sharing its Name"
  );
});

add_task(async function test_precedence_transitions() {
  // Builtin first.
  await setupPolicyEngineWithJson({
    policies: { BuiltinDataLossPrevention: { Enabled: true } },
  });
  checkLockedPref(DLP_MODE_PREF, "builtin");

  // Add ContentAnalysis -> it takes precedence.
  await setupPolicyEngineWithJson({
    policies: {
      BuiltinDataLossPrevention: { Enabled: true },
      ContentAnalysis: { Enabled: true },
    },
  });
  checkLockedPref(DLP_MODE_PREF, "contentanalysis");

  // Remove ContentAnalysis -> builtin takes back over.
  await setupPolicyEngineWithJson({
    policies: { BuiltinDataLossPrevention: { Enabled: true } },
  });
  checkLockedPref(DLP_MODE_PREF, "builtin");
});

add_task(async function test_disable_clears_rules() {
  await setupPolicyEngineWithJson({
    policies: {
      BuiltinDataLossPrevention: {
        Enabled: true,
        Rules: [{ Name: "r1", Actions: ["Print"], Domains: ["*"] }],
      },
    },
  });
  deepEqual(
    getPersistedRules().map(rule => rule.Name),
    ["r1"],
    "Rule is persisted while enabled"
  );

  // Disabling the policy runs disable(), which clears the persisted rules.
  // (restoreDefaultValues does not reset this novel locked pref, so a passing
  // assertion here proves disable() actively cleared it.)
  await setupPolicyEngineWithJson({
    policies: { BuiltinDataLossPrevention: { Enabled: false } },
  });
  checkUnsetPref(BUILTIN_RULES_PREF);
  checkUnsetPref(DLP_MODE_PREF);
});
