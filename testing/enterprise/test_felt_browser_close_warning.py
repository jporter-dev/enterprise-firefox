#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from base_test import Environment
from felt_tests import FeltTests

PREF_PROMPT_ON_SIGNOUT = "enterprise.prompt_on_signout"
PREF_WARN_ON_CLOSE = "browser.tabs.warnOnClose"


class BrowserCloseWarning(FeltTests):
    def _set_child_bool_pref(self, pref_name, value):
        self._child_driver.set_context("chrome")
        self._child_driver.execute_script(
            f"Services.prefs.setBoolPref('{pref_name}', {'true' if value else 'false'});"
        )
        self._child_driver.set_context("content")

    def _close_browser(self):
        """Simulate a natural browser close by firing quit-application-requested,
        which BrowserGlue intercepts to show the Enterprise signout dialog.
        If the quit is not cancelled, force-quit to mirror native OS behavior."""
        self._child_driver.set_context("chrome")
        self._child_driver.execute_script(
            """
            let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"]
                .createInstance(Ci.nsISupportsPRBool);
            Services.obs.notifyObservers(cancelQuit, "quit-application-requested", null);
            if (!cancelQuit.data) {
                Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
            }
            """
        )
        self._manually_closed_child = True

    def _assert_close_dialog_content(self, expected_title, expected_message):
        self._logger.info("Waiting for the custom signout dialog to assert its content")
        self._child_wait.until(
            lambda _: self._child_driver.execute_script(
                """
                try {
                    const dialog = document.getElementById('window-modal-dialog');
                    return !!(dialog?.open && dialog.querySelector(".dialogFrame")
                        ?.contentDocument
                        ?.getElementById("enterpriseCloseDialog")
                        ?.getButton('accept'));
                } catch (e) {
                    return false;
                }
                """
            )
        )
        content = self._child_driver.execute_script(
            """
            const doc = document.getElementById('window-modal-dialog')
                .querySelector('.dialogFrame').contentDocument;
            return {
                title: doc.getElementById('infoTitle').textContent,
                message: doc.getElementById('infoBody').textContent,
            };
            """
        )
        assert content["title"] == expected_title, (
            f"Unexpected dialog title: {content['title']!r}"
        )
        assert content["message"] == expected_message, (
            f"Unexpected dialog message: {content['message']!r}"
        )

    def _accept_close_dialog(self):
        self._logger.info("Waiting for the custom signout dialog to open")
        self._child_wait.until(
            lambda _: self._child_driver.execute_script(
                """
                try {
                    const dialog = document.getElementById('window-modal-dialog');
                    return !!(dialog?.open && dialog.querySelector(".dialogFrame")
                        ?.contentDocument
                        ?.getElementById("enterpriseCloseDialog")
                        ?.getButton('accept'));
                } catch (e) {
                    return false;
                }
                """
            )
        )

        self._logger.info(
            "Signing out the user by clicking the Signout button in the custom signout dialog"
        )
        self._child_driver.execute_script(
            """
            document.getElementById("window-modal-dialog")
                .querySelector(".dialogFrame")
                .contentDocument
                .getElementById("enterpriseCloseDialog")
                .getButton("accept")
                .click();
            """
        )

    def test_browser_window_close_default_config(self):
        """Default config: sign-out warn on, single tab - enterprise dialog shows."""
        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        self._close_browser()
        self._assert_close_dialog_content(
            expected_title="Close Firefox Enterprise?",
            expected_message=(
                "You’re about to sign out of Firefox Enterprise and end your session.\n\n"
                "To use Firefox Enterprise again, you’ll need to reauthenticate through your organization’s SSO provider."
            ),
        )
        self._accept_close_dialog()

        self.assert_child_browser_closed()

    def test_browser_window_close_with_both_warnings(self):
        """Sign-out warn on, tabs warn on, multiple tabs open - enterprise dialog with tabs checkbox shown."""
        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        self._set_child_bool_pref(PREF_WARN_ON_CLOSE, True)
        self.open_tab_child("about:blank")

        self._close_browser()
        self._assert_close_dialog_content(
            expected_title="Close Firefox Enterprise and 2 tabs?",
            expected_message=(
                "You’re about to sign out of Firefox Enterprise and close 2 tabs.\n\n"
                "To use Firefox Enterprise again, you’ll need to reauthenticate through your organization’s SSO provider."
            ),
        )
        self._accept_close_dialog()

        self.assert_child_browser_closed()

    def test_browser_window_close_tabs_warning_only(self):
        """Sign-out warn off, tabs warn on, multiple tabs - dialog shows tabs-only variant."""
        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        self._set_child_bool_pref(PREF_PROMPT_ON_SIGNOUT, False)
        self._set_child_bool_pref(PREF_WARN_ON_CLOSE, True)
        self.open_tab_child("about:blank")

        self._close_browser()
        self._assert_close_dialog_content(
            expected_title="Close 2 tabs?",
            expected_message="Closing Firefox will also sign you out.",
        )
        self._accept_close_dialog()

        self.assert_child_browser_closed()

    def test_browser_window_close_no_warnings(self):
        """Sign-out warn off - no dialog, quit proceeds directly."""
        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        self._set_child_bool_pref(PREF_PROMPT_ON_SIGNOUT, False)

        self._close_browser()

        self.assert_child_browser_closed()
