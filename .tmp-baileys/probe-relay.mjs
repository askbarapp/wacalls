import dgram from "node:dgram";
import { randomBytes } from "node:crypto";

function stun(type) {
  const b = Buffer.alloc(20);
  b.writeUInt16BE(type, 0);
  b.writeUInt16BE(0, 2);
  b.writeUInt32BE(0x2112a442, 4);
  randomBytes(12).copy(b, 8);
  return b;
}

function tryOne(label, ip, port, pkt, ms) {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      s.close();
      console.log(JSON.stringify({ label, ip, port, rx: 0 }));
      resolve();
    }, ms);
    s.on("message", (m, ri) => {
      clearTimeout(timer);
      const typ = ((m[0] & 0x3f) << 8) | m[1];
      console.log(
        JSON.stringify({
          label,
          rx: m.length,
          from: ri.address,
          rport: ri.port,
          stun: `0x${typ.toString(16)}`,
        }),
      );
      s.close();
      resolve();
    });
    s.on("error", (e) => {
      clearTimeout(timer);
      console.log(JSON.stringify({ label, err: e.message }));
      s.close();
      resolve();
    });
    s.bind(0, "0.0.0.0", () => {
      s.send(pkt, port, ip, (e) => e && console.log(JSON.stringify({ label, send: e.message })));
    });
  });
}

const ip = "57.144.141.57";
await tryOne("bind3478", ip, 3478, stun(1), 2500);
await tryOne("bind3480", ip, 3480, stun(1), 2500);
await tryOne("alloc3478", ip, 3478, stun(3), 2500);
await tryOne("alloc3480", ip, 3480, stun(3), 2500);
