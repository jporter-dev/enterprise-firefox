/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Returns true when `pref` is locked to a falsy value, as an administrator does
 * through the FirefoxHome or Preferences policy, or through autoconfig. The
 * customize panel drops such a row rather than render a control that can only
 * ever read "off"; a pref locked to a truthy value keeps its row, disabled by
 * CustomizeMenu's lock sweep, so the pinned state stays visible.
 *
 * @param {object} prefs - pref values from the Redux store (state.Prefs.values)
 * @param {string} pref - branch-relative pref name
 * @returns {boolean}
 */
export function isPrefLockedOff(prefs, pref) {
  return Boolean(prefs?.lockedPrefs?.includes(pref) && !prefs[pref]);
}
