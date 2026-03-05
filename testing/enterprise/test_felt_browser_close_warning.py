#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from base_test import Environment
from felt_tests import FeltTests
from marionette_driver.errors import NoSuchWindowException, UnknownException

PREF_PROMPT_ON_SIGNOUT = "enterprise.promptOnSignout"
PREF_WARN_ON_CLOSE = "browser.tabs.warnOnClose"


class BrowserCloseWarning(FeltTests):
    def _set_child_bool_pref(self, pref_name, value):
        self._child_driver.set_context("chrome")
        self._child_driver.execute_script(
            f"Services.prefs.setBoolPref('{pref_name}', {'true' if value else 'false'});"
        )
        self._child_driver.set_context("content")

    def _close_browser(self):
        self._child_driver.set_context("chrome")
        try:
            self._child_driver.execute_script(
                "EnterpriseHandler.warnAboutClosing(window);"
            )
        except (NoSuchWindowException, UnknownException):
            pass
        finally:
            self._manually_closed_child = True

    def _close_app(self):
        """Simulate an OS-level app close by firing quit-application-requested,
        which BrowserGlue intercepts to show the Enterprise signout dialog."""
        self._child_driver.set_context("chrome")
        self._child_driver.execute_script(
            """
            let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"]
                .createInstance(Ci.nsISupportsPRBool);
            Services.obs.notifyObservers(cancelQuit, "quit-application-requested", null);
            """
        )
        self._manually_closed_child = True

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

    def _assert_signed_out_after_close(self):
        self.await_felt_auth_window()
        self.force_window()
        self.assert_user_signed_out(env=Environment.FELT)

    def test_browser_window_close_default_config(self):
        """Default config: sign-out warn on, tabs warn off, single tab - dialog shows."""
        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        self._close_browser()
        self._accept_close_dialog()

        self._assert_signed_out_after_close()

    def test_browser_window_close_with_both_warnings(self):
        """Sign-out warn on, tabs warn on, multiple tabs open - both warnings shown."""
        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        self._set_child_bool_pref(PREF_WARN_ON_CLOSE, True)
        self.open_tab_child("about:blank")

        self._close_browser()
        self._accept_close_dialog()

        self._assert_signed_out_after_close()

    def test_browser_window_close_no_warnings(self):
        """Sign-out warn off, tabs warn off - no dialog, direct shutdown."""
        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        self._set_child_bool_pref(PREF_PROMPT_ON_SIGNOUT, False)

        self._close_browser()

        self._assert_signed_out_after_close()

    def test_browser_window_close_tabs_warn_only(self):
        """Sign-out warn off, tabs warn on, multiple tabs open - tabs warning shown."""
        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        self._set_child_bool_pref(PREF_PROMPT_ON_SIGNOUT, False)
        self._set_child_bool_pref(PREF_WARN_ON_CLOSE, True)
        self.open_tab_child("about:blank")

        self._close_browser()
        self._accept_close_dialog()

        self._assert_signed_out_after_close()

    def test_app_close_shows_enterprise_dialog(self):
        """App close (quit-application-requested) is intercepted by BrowserGlue and shows dialog."""
        super().run_felt_base()
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)

        self._close_app()
        self._accept_close_dialog()

        self._assert_signed_out_after_close()
