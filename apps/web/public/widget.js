/**
 * WaCalls Website Visit widget — live chat + WhatsApp + call.
 *
 *   <script src="https://YOUR_DOMAIN/widget.js" data-visit="wv_xxxxx" data-api="https://YOUR_DOMAIN"></script>
 */
(function () {
  var script = document.currentScript;
  if (!script) return;

  var visitKey = script.getAttribute("data-visit");
  var channel = script.getAttribute("data-channel");
  var apiBase = (script.getAttribute("data-api") || "").replace(/\/$/, "");
  if (!apiBase) apiBase = script.src.replace(/\/widget\.js(?:\?.*)?$/, "");

  function el(html) {
    var wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstChild;
  }
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function request(method, path, body) {
    return fetch(apiBase + path, {
      method: method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) {
          throw new Error((json && json.error && json.error.message) || json.message || "Request failed");
        }
        return json;
      });
    });
  }

  function mountLegacy() {
    var root = document.createElement("div");
    root.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;font-family:system-ui,sans-serif";
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
        .then(function (r) { return r.json(); })
        .then(function (j) {
          msg.textContent = j.success ? (j.message || "Queued") : ((j.error && j.error.message) || "Unable to call");
        })
        .catch(function () { msg.textContent = "Network error"; });
    };
  }

  function mountVisit(config) {
    var storeKey = "wacalls_visit_" + visitKey;
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(storeKey) || "{}"); } catch (e) { saved = {}; }
    var sessionKey = saved.sessionKey || ("vs_" + Math.random().toString(36).slice(2) + Date.now().toString(36));
    var conversationId = saved.conversationId || "";
    var visitor = saved.visitor || { name: "", phone: "", departmentId: "" };
    var open = false;
    var messages = [];
    var calling = null;
    var poll = null;
    var callPoll = null;

    var host = document.createElement("div");
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000;font-family:system-ui,sans-serif";
    document.body.appendChild(host);

    function persist() {
      try {
        localStorage.setItem(storeKey, JSON.stringify({ sessionKey: sessionKey, conversationId: conversationId, visitor: visitor }));
      } catch (e) {}
    }
    persist();

    function ping() {
      request("POST", "/api/v1/public/visits/" + encodeURIComponent(visitKey) + "/presence", {
        session_key: sessionKey || undefined,
        url: location.href,
        title: document.title,
        referrer: document.referrer || "",
      }).then(function (json) {
        var data = json.data || json;
        if (data.sessionKey && data.sessionKey !== sessionKey) {
          sessionKey = data.sessionKey;
          persist();
        }
      }).catch(function () {});
    }
    ping();
    setInterval(ping, 8000);

    function bubble() {
      host.innerHTML = "";
      var btn = el(
        '<button type="button" style="border:0;border-radius:999px;padding:14px 20px;background:#10b981;color:#07111c;font-weight:700;font-size:14px;box-shadow:0 12px 30px rgba(16,185,129,.35);cursor:pointer">' +
          esc(config.buttonLabel || "Chat with us") +
        "</button>",
      );
      btn.onclick = function () { open = true; draw(); };
      host.appendChild(btn);
    }

    function header(title) {
      return (
        '<div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)">' +
          '<div style="flex:1;font-weight:700;font-size:14px">' + esc(title || config.name || "Support") + "</div>" +
          (config.callEnabled
            ? '<button type="button" id="wacalls-call" title="Call on WhatsApp" style="border:0;background:rgba(16,185,129,.15);color:#6ee7b7;width:36px;height:36px;border-radius:999px;cursor:pointer;font-size:16px">☎</button>'
            : "") +
          '<button type="button" id="wacalls-close" style="border:0;background:transparent;color:#94a3b8;font-size:20px;cursor:pointer">×</button>' +
        "</div>"
      );
    }

    function bindChrome(card) {
      card.querySelector("#wacalls-close").onclick = function () { open = false; bubble(); };
      var callBtn = card.querySelector("#wacalls-call");
      if (callBtn) callBtn.onclick = startCall;
    }

    function drawStart(error) {
      var depts = config.departments || [];
      var opts = depts.map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (visitor.departmentId === d.id ? " selected" : "") + ">" +
          esc(d.name) + (d.connected ? "" : " (offline)") + "</option>";
      }).join("");
      host.innerHTML = "";
      var card = el(
        '<div style="width:340px;max-width:calc(100vw - 24px);background:#0c1a2b;color:#fff;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.45)">' +
          header(config.name) +
          '<div style="padding:14px">' +
            '<div style="font-size:13px;color:#94a3b8;margin-bottom:12px">' + esc(config.greeting) + "</div>" +
            (error ? '<div style="color:#fb7185;font-size:12px;margin-bottom:10px">' + esc(error) + "</div>" : "") +
            '<label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:8px">Department' +
              '<select id="wacalls-dept" style="display:block;width:100%;margin-top:4px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#07111c;color:#fff">' + opts + "</select></label>" +
            '<input id="wacalls-name" placeholder="Your name" value="' + esc(visitor.name) + '" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#07111c;color:#fff" />' +
            '<input id="wacalls-phone" placeholder="WhatsApp number" value="' + esc(visitor.phone) + '" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#07111c;color:#fff" />' +
            '<button type="button" id="wacalls-start" style="width:100%;padding:12px;border:0;border-radius:12px;background:#10b981;color:#07111c;font-weight:700;cursor:pointer">Start chat</button>' +
          "</div></div>",
      );
      host.appendChild(card);
      bindChrome(card);
      card.querySelector("#wacalls-start").onclick = function () {
        visitor = {
          name: card.querySelector("#wacalls-name").value,
          phone: card.querySelector("#wacalls-phone").value,
          departmentId: card.querySelector("#wacalls-dept").value,
        };
        persist();
        request("POST", "/api/v1/public/visits/" + encodeURIComponent(visitKey) + "/chat/start", {
          session_key: sessionKey,
          department_id: visitor.departmentId || undefined,
          name: visitor.name,
          phone: visitor.phone,
        }).then(function (json) {
          var data = json.data || json;
          conversationId = data.id;
          messages = data.messages || [];
          persist();
          drawChat();
          startMsgPoll();
        }).catch(function (err) {
          drawStart(err.message || "Could not start chat");
        });
      };
    }

    function msgHtml(m) {
      var mine = m.sender === "visitor";
      return (
        '<div style="display:flex;justify-content:' + (mine ? "flex-end" : "flex-start") + ';margin:6px 0">' +
          '<div style="max-width:80%;padding:8px 10px;border-radius:12px;font-size:13px;line-height:1.4;' +
            (mine ? "background:#10b981;color:#07111c" : "background:rgba(255,255,255,.08);color:#e2e8f0") + '">' +
            esc(m.body) +
          "</div></div>"
      );
    }

    function drawChat(error) {
      host.innerHTML = "";
      var card = el(
        '<div style="width:340px;max-width:calc(100vw - 24px);height:480px;max-height:70vh;background:#0c1a2b;color:#fff;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.45);display:flex;flex-direction:column">' +
          header(config.name) +
          (calling ? '<div style="padding:8px 14px;background:rgba(16,185,129,.12);color:#6ee7b7;font-size:12px">' + esc(calling) + "</div>" : "") +
          (error ? '<div style="padding:8px 14px;color:#fb7185;font-size:12px">' + esc(error) + "</div>" : "") +
          '<div id="wacalls-msgs" style="flex:1;overflow:auto;padding:10px 12px">' + messages.map(msgHtml).join("") + "</div>" +
          '<div style="display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.08)">' +
            '<input id="wacalls-text" placeholder="Message…" style="flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#07111c;color:#fff" />' +
            '<button type="button" id="wacalls-send" style="border:0;border-radius:10px;padding:0 14px;background:#10b981;color:#07111c;font-weight:700;cursor:pointer">Send</button>' +
          "</div></div>",
      );
      host.appendChild(card);
      bindChrome(card);
      var box = card.querySelector("#wacalls-msgs");
      box.scrollTop = box.scrollHeight;
      function send() {
        var input = card.querySelector("#wacalls-text");
        var text = (input.value || "").trim();
        if (!text) return;
        input.value = "";
        request("POST", "/api/v1/public/visits/" + encodeURIComponent(visitKey) + "/chat/" + encodeURIComponent(conversationId) + "/messages", {
          session_key: sessionKey,
          body: text,
        }).then(function (json) {
          var data = json.data || json;
          messages = data.messages || [];
          drawChat();
        }).catch(function (err) {
          drawChat(err.message || "Could not send");
        });
      }
      card.querySelector("#wacalls-send").onclick = send;
      card.querySelector("#wacalls-text").onkeydown = function (e) {
        if (e.key === "Enter") send();
      };
    }

    function startMsgPoll() {
      if (poll) clearInterval(poll);
      poll = setInterval(function () {
        if (!conversationId || !open) return;
        request(
          "GET",
          "/api/v1/public/visits/" + encodeURIComponent(visitKey) + "/chat/" + encodeURIComponent(conversationId) +
            "?session_key=" + encodeURIComponent(sessionKey),
        ).then(function (json) {
          var data = json.data || json;
          var next = data.messages || [];
          if (next.length !== messages.length) {
            messages = next;
            if (open) drawChat();
          }
        }).catch(function () {});
      }, 2500);
    }

    function startCall() {
      if (!config.callEnabled) return;
      if (!visitor.name || !visitor.phone) {
        if (!conversationId) drawStart("Enter your name and WhatsApp number to call.");
        return;
      }
      calling = "Starting WhatsApp call…";
      if (conversationId) drawChat();
      request("POST", "/api/v1/public/visits/" + encodeURIComponent(visitKey) + "/call", {
        session_key: sessionKey,
        conversation_id: conversationId || undefined,
        department_id: visitor.departmentId || undefined,
        name: visitor.name,
        phone: visitor.phone,
      }).then(function (res) {
        calling = res.message || "Calling your WhatsApp…";
        if (conversationId) drawChat();
        var callId = res.callId;
        if (callPoll) clearInterval(callPoll);
        callPoll = setInterval(function () {
          request("GET", "/api/v1/public/visits/" + encodeURIComponent(visitKey) + "/calls/" + encodeURIComponent(callId))
            .then(function (json) {
              var call = json.data || json;
              if (call.status === "RINGING") calling = "Ringing — answer on WhatsApp";
              else if (call.status === "ANSWERED") calling = "Connected on WhatsApp";
              else if (call.status === "ENDED") calling = "Call ended";
              else if (["FAILED", "NO_ANSWER", "REJECTED", "BUSY", "CANCELLED"].indexOf(call.status) !== -1)
                calling = call.failureReason || "Call did not connect";
              if (open && conversationId) drawChat();
              if (["ENDED", "FAILED", "BUSY", "NO_ANSWER", "REJECTED", "CANCELLED"].indexOf(call.status) !== -1) {
                clearInterval(callPoll);
                callPoll = null;
              }
            })
            .catch(function () {});
        }, 1500);
      }).catch(function (err) {
        calling = err.message || "Could not start the call";
        if (conversationId) drawChat();
        else drawStart(calling);
      });
    }

    function draw() {
      if (!open) return bubble();
      if (conversationId) {
        drawChat();
        startMsgPoll();
        return;
      }
      drawStart("");
    }

    if (!config.channelConnected) {
      host.appendChild(
        el('<div style="background:#0c1a2b;color:#fbbf24;padding:12px 16px;border-radius:14px;font-size:12px">Support is temporarily unavailable.</div>'),
      );
      return;
    }
    bubble();
  }

  if (visitKey) {
    request("GET", "/api/v1/public/visits/" + encodeURIComponent(visitKey))
      .then(function (json) { mountVisit(json.data || json); })
      .catch(function () {
        mountVisit({ name: "Support", buttonLabel: "Chat with us", greeting: "", departments: [], channelConnected: false, callEnabled: true, chatEnabled: true });
      });
    return;
  }
  if (channel) mountLegacy();
})();
