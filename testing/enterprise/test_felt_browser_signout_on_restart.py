#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from base_test import Environment
from felt_tests import FeltTests
from marionette_driver.errors import (
    NoSuchWindowException,
    UnknownException,
)


class BrowserSignoutOnRestart(FeltTests):
    """With restart signout enabled, a restart revokes the session and returns to login
    instead of relaunching the browser authenticated."""

    EXTRA_PREFS = {
        "enterprise.signout.restart.enabled": True,
    }

    def test_browser_signout_on_restart(self):
        super().run_felt_base()
        self.run_felt_verify_signed_in()
        self.run_felt_perform_restart()
        self.run_felt_verify_signed_out()

    def run_felt_verify_signed_in(self):
        self.connect_child_browser()
        self._browser_pid = self._child_driver.session_capabilities["moz:processID"]
        self.assert_user_signed_in(env=Environment.FIREFOX)
        assert self.signout_count.value == 0, "No signout should have been posted yet"

    def run_felt_perform_restart(self):
        try:
            self._child_driver.set_context("chrome")
            self._child_driver.execute_script(
                "Services.startup.quit(Ci.nsIAppStartup.eRestart | Ci.nsIAppStartup.eAttemptQuit);"
            )
        except UnknownException:
            self._logger.info("Received expected UnknownException")
        except NoSuchWindowException:
            self._logger.info("Received expected NoSuchWindowException")
        except OSError:
            self._logger.info(
                "Firefox quit before execute_script returned, Marionette socket was closed"
            )
        finally:
            self._manually_closed_child = True

    def run_felt_verify_signed_out(self):
        self.wait_process_exit(self._browser_pid)
        self.await_felt_auth_window()
        self.force_window()

        self._wait.until(lambda _: self.signout_count.value == 1)
        assert self.signout_count.value == 1, (
            f"Expected exactly 1 signout request after restart, got {self.signout_count.value}"
        )
        self.assert_user_signed_out(env=Environment.FELT)
