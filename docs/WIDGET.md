# Website widget

```html
<script src="https://YOUR-DOMAIN/widget.js" data-channel="CHANNEL_UUID"></script>
```

The script posts to `/widget/call` with `{ channelId, phone, name }`. If the WhatsApp channel is busy the API returns queue position (`You are in queue. Position: #2`).

The widget never receives session files, QR seeds, or API secrets. Use a dedicated channel UUID; treat it like a public intake ID, not a credential.
