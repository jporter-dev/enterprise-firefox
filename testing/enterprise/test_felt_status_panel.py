#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from felt_tests import FeltTests

CONNECTING_STATUS = "Connecting to example.com…"


class FeltStatusPanel(FeltTests):
    """
    Test the FELT SSO loading status box (bottom-left of the login pane):
    it is hidden before signing in, renders a visible label when populated
    via update(), is emptied by clear(), and is cleared once the SSO page
    finishes loading.

    The clear-after-load assertion guards against the network status (e.g.
    "Transferring data from…") staying stuck after a page loads or while
    background requests keep firing.
    """

    def teardown(self):
        # The test never completes authentication, so no child browser to teardown.
        self._manually_closed_child = True
        super().teardown()

    def _status_panel_hidden(self):
        return not self.find_elem("#felt-statuspanel").is_displayed()

    def test_felt_status_panel(self):
        self._driver.set_context("chrome")
        assert self._status_panel_hidden(), (
            "Status panel is hidden before the user starts signing in"
        )

        # A live network status has no deterministic point to catch, so drive
        # update()/clear() directly, as Firefox tests StatusPanel.
        self._driver.execute_script(
            "window.FeltStatusPanel.update(arguments[0]);", [CONNECTING_STATUS]
        )
        label = self.find_elem("#felt-statuspanel-label")
        assert label.is_displayed(), "update() shows the panel"
        assert label.text == CONNECTING_STATUS, "update() sets the label text"

        self._driver.execute_script("window.FeltStatusPanel.clear();")
        assert self._status_panel_hidden(), "clear() hides the panel"
        self._driver.set_context("content")

        self.run_felt_chrome_on_email_submit()
        self.run_wait_until_sso_loaded()

        self._driver.set_context("chrome")
        self._wait.until(
            lambda _: self._status_panel_hidden(),
            message="Status panel is cleared once the SSO page finishes loading",
        )
        self._driver.set_context("content")
