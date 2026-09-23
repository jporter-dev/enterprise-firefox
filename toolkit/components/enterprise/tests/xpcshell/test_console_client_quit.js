/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { ConsoleClient } = ChromeUtils.importESModule(
  "resource://gre/modules/enterprise/ConsoleClient.sys.mjs"
);

add_task(async function test_concurrent_quit_requests_preserve_restart() {
  const { promise: hookPromise, resolve: finishHook } = Promise.withResolvers();
  const originalHook = ConsoleClient._appForcedQuitHook;
  const originalStartup = Services.startup;
  const quitCalls = [];
  let hookCalls = 0;
  let firstQuit;
  let secondQuit;

  ConsoleClient._appForcedQuitHook = () => () => {
    hookCalls++;
    return hookPromise;
  };
  Services.startup = { quit: flags => quitCalls.push(flags) };

  try {
    firstQuit = ConsoleClient.quitIgnoringCanClose();
    secondQuit = ConsoleClient.quitIgnoringCanClose(
      Ci.nsIAppStartup.eForceQuit | Ci.nsIAppStartup.eRestart
    );

    Assert.equal(firstQuit, secondQuit, "Concurrent callers share the promise");
    await Promise.resolve();
    Assert.equal(hookCalls, 1, "The hook runs once");
    Assert.equal(quitCalls.length, 0, "Quit waits for the hook");

    finishHook();
    await Promise.all([firstQuit, secondQuit]);

    Assert.deepEqual(
      quitCalls,
      [Ci.nsIAppStartup.eForceQuit | Ci.nsIAppStartup.eRestart],
      "The single quit includes the later restart flag"
    );
    Assert.equal(
      ConsoleClient.quitIgnoringCanClose(),
      firstQuit,
      "A later request does not start another quit"
    );
  } finally {
    finishHook();
    await Promise.allSettled([firstQuit, secondQuit].filter(Boolean));
    ConsoleClient._appForcedQuitHook = originalHook;
    ConsoleClient._quitPromise = null;
    ConsoleClient._pendingQuitFlags = 0;
    Services.startup = originalStartup;
  }
});
