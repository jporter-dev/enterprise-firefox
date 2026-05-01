#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import os
import sys

sys.path.append(os.path.dirname(__file__))

from base_test import Environment
from test_felt_browser_signout import BaseBrowserSignout


class BrowserSignoutCancel(BaseBrowserSignout):
    def test_badge_signout_dialog_cancel_restores_focus(self):
        """Dismissing the signout dialog from the badge panel returns focus to the badge button."""
        super().run_felt_base()
        self.connect_child_browser(capabilities={"unhandledPromptBehavior": "ignore"})
        self.assert_user_signed_in(env=Environment.FIREFOX)

        self._child_driver.set_context("chrome")

        self._logger.info(
            "Focusing and keyboard-activating enterprise badge to open enterprise panel"
        )
        self._child_driver.execute_script(
            """
            const btn = document.getElementById("enterprise-badge-toolbar-button");
            Services.focus.setFocus(btn, Services.focus.FLAG_BYKEY);
            btn.dispatchEvent(
                new KeyboardEvent("keypress", { key: "Enter", bubbles: true, cancelable: true })
            );
            """
        )

        self._logger.info("Clicking signout button in enterprise panel")
        self.get_elem_child(".panelUI-enterprise__sign-out-btn").click()

        self._wait_for_signout_dialog()

        self._logger.info("Cancelling the signout dialog")
        self._child_driver.execute_script(
            """
            document.getElementById("window-modal-dialog")
                .querySelector(".dialogFrame")
                .contentDocument
                .getElementById("enterpriseCloseDialog")
                .getButton("cancel")
                .click();
            """
        )

        self._child_wait.until(
            lambda _: (
                not self._child_driver.execute_script(
                    "return window.gDialogBox?.isOpen ?? false;"
                )
            )
        )

        focused_id = self._child_driver.execute_script(
            "return document.activeElement?.id;"
        )
        assert focused_id == "enterprise-badge-toolbar-button", (
            f"Expected focus on enterprise-badge-toolbar-button, got {focused_id!r}"
        )

        self.assert_user_signed_in(env=Environment.FIREFOX)
