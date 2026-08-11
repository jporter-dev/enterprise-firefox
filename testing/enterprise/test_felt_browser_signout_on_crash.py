#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from base_test import Environment
from felt_browser_crashes import BrowserCrashes


class BrowserSignoutOnCrash(BrowserCrashes):
    """With crash signout enabled, a crash revokes the session and returns to login with a
    notice instead of silently relaunching the browser authenticated."""

    EXTRA_PREFS = {
        "enterprise.signout.crash.enabled": True,
    }

    def test_browser_signout_on_crash(self):
        super().run_felt_base()
        self.run_felt_verify_signed_in()
        self._manually_closed_child = True
        self.crash_parent()
        self.run_felt_verify_signed_out()

    def run_felt_verify_signed_in(self):
        self.connect_child_browser()
        self.assert_user_signed_in(env=Environment.FIREFOX)
        assert self.signout_count.value == 0, "No signout should have been posted yet"

    def run_felt_verify_signed_out(self):
        self.await_felt_auth_window()
        self.force_window()

        self._wait.until(lambda _: self.signout_count.value == 1)
        assert self.signout_count.value == 1, (
            f"Expected exactly 1 signout request after crash, got {self.signout_count.value}"
        )

        self._driver.set_context("chrome")
        crash_msg = self.get_elem(".felt-browser-info-signed-out-crash")
        assert "signed out" in crash_msg.text.lower(), (
            f"Expected the crash sign-out message, got: {crash_msg.text!r}"
        )

        email_value = self._driver.execute_script(
            "return document.getElementById('felt-form__email').value;"
        )
        self._driver.set_context("content")
        assert email_value == "nobody@mozilla.org", (
            f"Expected the email pre-filled after crash sign-out, got: {email_value!r}"
        )

        self.assert_user_signed_out(env=Environment.FELT)
