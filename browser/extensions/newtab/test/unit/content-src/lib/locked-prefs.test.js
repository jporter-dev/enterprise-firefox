import { isPrefLockedOff } from "content-src/lib/locked-prefs.mjs";

describe("isPrefLockedOff", () => {
  it("is true for a pref locked to a falsy value", () => {
    assert.isTrue(
      isPrefLockedOff(
        { "feeds.topsites": false, lockedPrefs: ["feeds.topsites"] },
        "feeds.topsites"
      )
    );
  });

  it("is false for a pref locked to a truthy value", () => {
    assert.isFalse(
      isPrefLockedOff(
        { "feeds.topsites": true, lockedPrefs: ["feeds.topsites"] },
        "feeds.topsites"
      )
    );
  });

  it("is false for an unlocked pref that happens to be off", () => {
    assert.isFalse(
      isPrefLockedOff(
        { "feeds.topsites": false, lockedPrefs: [] },
        "feeds.topsites"
      )
    );
  });

  it("is false when no lock state has been broadcast yet", () => {
    assert.isFalse(isPrefLockedOff({}, "feeds.topsites"));
    assert.isFalse(isPrefLockedOff(undefined, "feeds.topsites"));
  });
});
