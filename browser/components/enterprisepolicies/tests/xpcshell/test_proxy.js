/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

add_task(async function test_proxy_modes_and_autoconfig() {
  // Directly test the proxy Mode and AutoconfigURL parameters through
  // the API instead of the policy engine, because the test harness
  // uses these prefs, and changing them interfere with the harness.

  // Checks that every Mode value translates correctly to the expected pref value
  let { ProxyPolicies, PROXY_TYPES_MAP } = ChromeUtils.importESModule(
    "resource:///modules/policies/ProxyPolicies.sys.mjs"
  );

  for (let [mode, expectedValue] of PROXY_TYPES_MAP) {
    ProxyPolicies.configureProxySettings({ Mode: mode }, (_, value) => {
      equal(value, expectedValue, "Correct proxy mode");
    });
  }

  let autoconfigURL = new URL("data:text/plain,test");
  ProxyPolicies.configureProxySettings(
    { AutoConfigURL: autoconfigURL },
    (_, value) => {
      equal(value, autoconfigURL.href, "AutoconfigURL correctly set");
    }
  );
});

add_task(async function test_proxy_boolean_settings() {
  // Tests that both false and true values are correctly set and locked
  await setupPolicyEngineWithJson({
    policies: {
      Proxy: {
        UseProxyForDNS: false,
        AutoLogin: false,
      },
    },
  });

  checkUnlockedPref("network.proxy.socks5_remote_dns", false);
  checkUnlockedPref("signon.autologin.proxy", false);

  await setupPolicyEngineWithJson({
    policies: {
      Proxy: {
        UseProxyForDNS: true,
        AutoLogin: true,
      },
    },
  });

  checkUnlockedPref("network.proxy.socks5_remote_dns", true);
  checkUnlockedPref("signon.autologin.proxy", true);
});

add_task(async function test_proxy_socks_and_passthrough() {
  await setupPolicyEngineWithJson({
    policies: {
      Proxy: {
        SOCKSVersion: 4,
        Passthrough: "a, b, c",
      },
    },
  });

  checkUnlockedPref("network.proxy.socks_version", 4);
  checkUnlockedPref("network.proxy.no_proxies_on", "a, b, c");
});

add_task(async function test_proxy_exclude_console_from_proxy() {
  const CONSOLE_ADDRESS_PREF = "enterprise.console.address";
  let { ProxyPolicies } = ChromeUtils.importESModule(
    "resource:///modules/policies/ProxyPolicies.sys.mjs"
  );
  registerCleanupFunction(() => {
    Services.prefs.clearUserPref(CONSOLE_ADDRESS_PREF);
  });

  let calls = [];
  let setPref = (name, value, locked) => calls.push({ name, value, locked });
  const NO_PROXIES = "network.proxy.no_proxies_on";

  // Set the address only after the call so the console-host injection has to
  // survive the address arriving late in startup (bug 2051323).
  let pending = ProxyPolicies.excludeConsoleFromProxy(
    { Mode: "manual" },
    setPref
  );
  Services.prefs.setStringPref(
    CONSOLE_ADDRESS_PREF,
    "https://console.example.com"
  );
  await pending;
  Assert.deepEqual(calls, [
    { name: NO_PROXIES, value: "console.example.com", locked: undefined },
  ]);

  calls = [];
  await ProxyPolicies.excludeConsoleFromProxy(
    { Mode: "manual", Passthrough: "a, b", Locked: true },
    setPref
  );
  Assert.deepEqual(calls, [
    { name: NO_PROXIES, value: "a, b, console.example.com", locked: true },
  ]);

  // no_proxies_on is honored for PAC too, since CanUseProxy runs before the PAC.
  calls = [];
  await ProxyPolicies.excludeConsoleFromProxy(
    { Mode: "autoConfig", Passthrough: "a, b" },
    setPref
  );
  Assert.deepEqual(calls, [
    { name: NO_PROXIES, value: "a, b, console.example.com", locked: undefined },
  ]);
});

add_task(async function test_proxy_addresses() {
  function checkProxyPref(proxytype, address, port) {
    checkUnlockedPref(`network.proxy.${proxytype}`, address);
    checkUnlockedPref(`network.proxy.${proxytype}_port`, port);
  }

  await setupPolicyEngineWithJson({
    policies: {
      Proxy: {
        HTTPProxy: "http.proxy.example.com:10",
        SSLProxy: "ssl.proxy.example.com:30",
        SOCKSProxy: "socks.proxy.example.com:40",
      },
    },
  });

  checkProxyPref("http", "http.proxy.example.com", 10);
  checkProxyPref("ssl", "ssl.proxy.example.com", 30);
  checkProxyPref("socks", "socks.proxy.example.com", 40);

  // Do the same, but now use the UseHTTPProxyForAllProtocols option
  // and check that it takes effect.
  await setupPolicyEngineWithJson({
    policies: {
      Proxy: {
        HTTPProxy: "http.proxy.example.com:10",
        // FTP support was removed in bug 1574475
        // Setting an FTPProxy should result in a warning but should not fail
        FTPProxy: "ftp.proxy.example.com:20",
        SSLProxy: "ssl.proxy.example.com:30",
        SOCKSProxy: "socks.proxy.example.com:40",
        UseHTTPProxyForAllProtocols: true,
      },
    },
  });

  checkProxyPref("http", "http.proxy.example.com", 10);
  checkProxyPref("ssl", "http.proxy.example.com", 10);
  // SOCKS proxy should NOT be overwritten with UseHTTPProxyForAllProtocols
  checkProxyPref("socks", "socks.proxy.example.com", 40);

  // Make sure the FTPProxy setting did nothing
  Assert.equal(
    Services.prefs.getPrefType("network.proxy.ftp"),
    Ci.nsIPrefBranch.PREF_INVALID,
    "network.proxy.ftp should not be set"
  );
  Assert.equal(
    Services.prefs.getPrefType("network.proxy.ftp_port"),
    Ci.nsIPrefBranch.PREF_INVALID,
    "network.proxy.ftp_port should not be set"
  );
});
