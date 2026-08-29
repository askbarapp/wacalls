(function () {
  var script = document.currentScript;
  if (!script) return;
  var channel = script.getAttribute("data-channel");
  var apiBase = script.src.replace(/\/widget\.js(?:\?.*)?$/, "");
  var root = document.createElement("div");
  root.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:99999;font-family:system-ui,sans-serif";
  root.innerHTML =
    '<div style="width:280px;background:#0c1a2b;color:#fff;border-radius:16px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.35)">' +
    '<div style="font-weight:600;margin-bottom:8px">Call Us</div>' +
    '<input id="wacalls-phone" placeholder="Mobile number" style="width:100%;padding:8px;border-radius:8px;border:0;margin-bottom:8px" />' +
    '<button id="wacalls-go" style="width:100%;padding:10px;border:0;border-radius:8px;background:#10b981;color:#07111c;font-weight:700">CALL NOW</button>' +
    '<div id="wacalls-msg" style="margin-top:8px;font-size:12px;color:#94a3b8"></div></div>';
  document.body.appendChild(root);
  document.getElementById("wacalls-go").onclick = function () {
    var phone = document.getElementById("wacalls-phone").value;
    var msg = document.getElementById("wacalls-msg");
    msg.textContent = "Connecting…";
    fetch(apiBase + "/widget/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: channel, phone: phone }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (!j.success) {
          msg.textContent = (j.error && j.error.message) || "Unable to call";
          return;
        }
        msg.textContent = j.message || "Queued";
      })
      .catch(function () {
        msg.textContent = "Network error";
      });
  };
})();
