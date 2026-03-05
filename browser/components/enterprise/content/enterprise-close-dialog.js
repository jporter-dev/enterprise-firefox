/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

let gArgs;

function onLoad() {
  gArgs = window.arguments[0];

  document.title = gArgs.title;
  document.getElementById("infoTitle").textContent = gArgs.title;
  document.getElementById("infoBody").textContent = gArgs.message;

  const dialog = document.getElementById("enterpriseCloseDialog");
  dialog.getButton("accept").label = gArgs.acceptLabel;

  if (gArgs.checkboxes.length) {
    createCheckboxes();
  }

  document.addEventListener("dialogaccept", onAccept, { once: true });
  document.addEventListener("dialogcancel", onCancel, { once: true });

  window.sizeToContent();
}

function createCheckboxes() {
  const list = document.getElementById("checkboxesList");
  for (const { id, label, checked } of gArgs.checkboxes) {
    const checkbox = document.createElementNS(XUL_NS, "checkbox");
    checkbox.id = id;
    checkbox.setAttribute("label", label);
    if (checked) {
      checkbox.setAttribute("checked", "true");
    }
    list.appendChild(checkbox);
  }
  document.getElementById("checkboxesRow").removeAttribute("hidden");
}

function onAccept() {
  gArgs.accepted = true;
  for (const checkboxArgs of gArgs.checkboxes) {
    checkboxArgs.checked = document.getElementById(checkboxArgs.id).checked;
  }
}

function onCancel() {
  gArgs.accepted = false;
}

document.addEventListener("DOMContentLoaded", onLoad);
