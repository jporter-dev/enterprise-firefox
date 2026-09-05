/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/* global PanelUI */

const { CustomizableUITestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/CustomizableUITestUtils.sys.mjs"
);

const gCUITestUtils = new CustomizableUITestUtils(window);

async function openHelpView() {
  await gCUITestUtils.openMainMenu();
  PanelUI.showHelpView(document.getElementById("PanelUI-menu-button"));
  let helpView = document.getElementById("PanelUI-helpView");
  await BrowserTestUtils.waitForEvent(helpView, "ViewShowing");
  return helpView;
}

add_task(async function test_switch_device_absent_from_menubar() {
  Assert.equal(
    document.getElementById("helpSwitchDevice"),
    null,
    "helpSwitchDevice menuitem should not be compiled on enterprise builds"
  );
});

add_task(async function test_switch_device_absent_from_app_menu() {
  let helpView = await openHelpView();

  Assert.equal(
    helpView.querySelector("#appMenu_helpSwitchDevice"),
    null,
    "appMenu_helpSwitchDevice should not be present on enterprise builds"
  );
  Assert.equal(
    helpView.querySelector("#appMenu-nova-switch-device-promo"),
    null,
    "Nova switch-device promo should not be present on enterprise builds"
  );

  await gCUITestUtils.hideMainMenu();
});

add_task(async function test_share_ideas_absent_from_menubar() {
  Assert.equal(
    document.getElementById("feedbackPage"),
    null,
    "feedbackPage menuitem should not be compiled on enterprise builds"
  );
});

add_task(async function test_share_ideas_absent_from_app_menu() {
  let helpView = await openHelpView();

  Assert.equal(
    helpView.querySelector("#appMenu_feedbackPage"),
    null,
    "appMenu_feedbackPage should not be present on enterprise builds"
  );

  await gCUITestUtils.hideMainMenu();
});
