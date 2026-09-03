/**
 * WaCalls JS SDK — embed calling and WhatsApp text in a third-party site.
 *
 *   <script src="https://YOUR_DOMAIN/sdk/wacalls.js"></script>
 *   <script>
 *     const client = WaCalls.init({
 *       token: "wc_live_... or wc_pub_...",
 *       channelId: "channel-uuid"
 *     });
 *     client.call({ phone: "+9198xxxxxxxx", name: "Website lead" });
 *     client.sendMessage({ phone: "+9198xxxxxxxx", text: "Hello" });
 *   </script>
 */
(function (root) {
  function detectApiUrl() {
    var script = document.currentScript;
    if (script && script.src) {
      return script.src.replace(/\/sdk\/wacalls\.js(?:\?.*)?$/, "");
    }
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf("/sdk/wacalls.js") !== -1) {
        return scripts[i].src.replace(/\/sdk\/wacalls\.js(?:\?.*)?$/, "");
      }
    }
    return "";
  }

  function request(apiUrl, token, method, path, body) {
    var payload = body ? JSON.stringify(body) : undefined;
    return fetch(apiUrl + path, {
      method: method,
      headers: payload
        ? { "content-type": "application/json", "x-api-key": token }
        : { "x-api-key": token },
      body: payload,
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) {
          var msg =
            (json && json.error && json.error.message) ||
            (json && json.message) ||
            "WaCalls request failed (" + res.status + ")";
          throw new Error(msg);
        }
        return json;
      });
    });
  }

  function init(opts) {
    opts = opts || {};
    var token = opts.token || opts.apiKey;
    var channelId = opts.channelId || opts.channel_id;
    var apiUrl = (opts.apiUrl || opts.baseUrl || detectApiUrl()).replace(/\/$/, "");
    if (!token) throw new Error("WaCalls.init requires token (wc_live_… or wc_pub_…)");
    if (!apiUrl) throw new Error("WaCalls.init requires apiUrl, or load /sdk/wacalls.js from your WaCalls domain");

    return {
      apiUrl: apiUrl,
      channelId: channelId,
      call: function (input) {
        input = input || {};
        var id = input.channelId || input.channel_id || channelId;
        if (!id) throw new Error("channelId is required");
        return request(apiUrl, token, "POST", "/api/v1/calls", {
          channel_id: id,
          phone: input.phone,
          contact_name: input.name || input.contact_name,
        }).then(function (json) {
          return {
            callId: json.call_id,
            status: json.status,
            queuePosition: json.queue_position,
          };
        });
      },
      sendMessage: function (input) {
        input = input || {};
        var id = input.channelId || input.channel_id || channelId;
        if (!id) throw new Error("channelId is required");
        return request(apiUrl, token, "POST", "/api/v1/messages", {
          channel_id: id,
          phone: input.phone,
          text: input.text || input.body,
        }).then(function (json) {
          return json.data || json;
        });
      },
      getCall: function (callId) {
        return request(apiUrl, token, "GET", "/api/v1/calls/" + encodeURIComponent(callId)).then(function (json) {
          return json.data || json;
        });
      },
      watchCall: function (callId, onUpdate, intervalMs) {
        var timer = setInterval(function () {
          this.getCall(callId)
            .then(function (call) {
              if (typeof onUpdate === "function") onUpdate(call);
              var done = ["ENDED", "FAILED", "BUSY", "NO_ANSWER", "REJECTED", "CANCELLED"].indexOf(call.status) !== -1;
              if (done) clearInterval(timer);
            })
            .catch(function () {
              clearInterval(timer);
            });
        }.bind(this), intervalMs || 2000);
        return function stop() {
          clearInterval(timer);
        };
      },
    };
  }

  root.WaCalls = { init: init };
})(typeof window !== "undefined" ? window : this);
