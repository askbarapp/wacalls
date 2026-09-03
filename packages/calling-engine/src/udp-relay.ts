import dgram from "node:dgram";
import pino from "pino";

const logger = pino({ name: "udp-relay", level: process.env.LOG_LEVEL ?? "info" });

const EDGE_UDP = 3478;
const EDGE_RTC = 3480;

export type UdpRelayConfig = {
  onTransportMessage: (data: Uint8Array, ip: string, port: number) => void;
  onIceRtt?: (rttMs: number, ip: string, port: number) => void;
};

type Addr = { ip: string; port: number };
type Pending = { packet: Buffer; ip: string; port: number };

function isIPv6(ip: string) {
  return ip.includes(":");
}

function stripBrackets(ip: string) {
  return ip.replace(/^\[/, "").replace(/\]$/, "");
}

function copyPacket(packet: Uint8Array) {
  const out = Buffer.allocUnsafe(packet.byteLength);
  out.set(packet);
  return out;
}

/**
 * One UDP socket to Meta :3478. Bind/pongs work on this port from Docker.
 * :3480 is ICE/DTLS-only and stays on the WebRTC transport.
 * IPv6 destinations are sent to the IPv4 twin on this same socket so bind and
 * allocate share a 5-tuple. Replies are presented as IPv4 so WASM does not
 * switch to dummy 1:: .
 */
export class UdpRelayTransport {
  readonly config: UdpRelayConfig;
  #sock4 = dgram.createSocket("udp4");
  #bound4 = false;
  #v6toV4 = new Map<string, Addr>();
  #pending: Pending[] = [];
  #totals = {
    sentPackets: 0,
    receivedPackets: 0,
    sentBytes: 0,
    receivedBytes: 0,
    droppedPackets: 0,
    remappedV6: 0,
    queuedV6: 0,
    alloc3480: 0,
    rx3480: 0,
    openConnections: 0,
  };
  #lastV4: Addr | null = null;

  constructor(config: UdpRelayConfig) {
    this.config = config;
    this.#listen();
    this.#sock4.bind(0, "0.0.0.0", () => {
      try {
        this.#sock4.setRecvBufferSize(1024 * 1024);
        this.#sock4.setSendBufferSize(1024 * 1024);
      } catch {
        /* optional */
      }
      this.#bound4 = true;
      this.#totals.openConnections = 1;
      logger.info({ address: this.#sock4.address() }, "UDP4 relay socket ready");
    });
    this.#sock4.on("error", (err) => logger.warn({ err }, "UDP relay socket error"));
  }

  updateRelayList = (update: {
    relays?: Array<{
      addresses?: Array<{ ipv4?: string; ipv6?: string; port?: number; port_v6?: number }>;
    }>;
  }) => {
    const relays = update?.relays ?? [];
    if (!relays.length) {
      logger.info({ aliases: this.#v6toV4.size }, "ignoring empty WASM relay list");
      return;
    }
    const next = new Map<string, Addr>();
    for (const relay of relays) {
      const addresses = relay.addresses ?? (relay as { address?: typeof relay.addresses }).address ?? [];
      for (const address of addresses ?? []) {
        const ipv4 = address.ipv4;
        const ipv6 = address.ipv6 ? stripBrackets(address.ipv6) : "";
        if (ipv4 && ipv6) {
          const v4port = address.port && address.port !== EDGE_RTC ? address.port : EDGE_UDP;
          next.set(ipv6, { ip: ipv4, port: v4port });
          next.set(ipv6.toLowerCase(), { ip: ipv4, port: v4port });
        }
      }
    }
    if (!next.size) {
      logger.info({ relays: relays.length, aliases: this.#v6toV4.size }, "relay list had no v6/v4 pairs; keeping previous aliases");
      return;
    }
    this.#v6toV4 = next;
    logger.info({ aliases: this.#v6toV4.size, relays: relays.length, queued: this.#pending.length }, "UDP relay aliases from WASM list");
    this.#flushPending();
  };

  send = (packet: Uint8Array, ip: string, port: number) => {
    if (!packet?.byteLength || !ip || !port) return 0;
    const dest = stripBrackets(ip);
    const buf = copyPacket(packet);
    const outPort = port === EDGE_RTC ? EDGE_UDP : port;
    if (isIPv6(dest)) {
      const mapped = this.ipv4Alias(dest) ?? this.#lastV4;
      if (!mapped) {
        this.#pending.push({ packet: buf, ip: dest, port: outPort });
        this.#totals.queuedV6 += 1;
        if (this.#totals.queuedV6 <= 8) {
          logger.info({ ip: dest, port: outPort, queued: this.#pending.length }, "queued IPv6 relay packet until v4 alias exists");
        }
        return packet.byteLength;
      }
      this.#totals.remappedV6 += 1;
      this.#lastV4 = { ip: mapped.ip, port: mapped.port || EDGE_UDP };
      this.#sendOn(buf, mapped.ip, this.#lastV4.port, dest);
      return packet.byteLength;
    }
    this.#lastV4 = { ip: dest, port: outPort };
    this.#sendOn(buf, dest, outPort);
    return packet.byteLength;
  };

  ipv4Alias = (ip: string): Addr | undefined => {
    const dest = stripBrackets(ip);
    return this.#v6toV4.get(dest) ?? this.#v6toV4.get(dest.toLowerCase());
  };

  getStats = () => ({
    ...this.#totals,
    aliases: this.#v6toV4.size,
    queued: this.#pending.length,
    openConnections: this.#bound4 ? 1 : 0,
  });

  closeAll = async () => {
    this.#pending = [];
    await new Promise<void>((resolve) => {
      try {
        this.#sock4.close(() => resolve());
      } catch {
        resolve();
      }
    });
    this.#bound4 = false;
    this.#totals.openConnections = 0;
  };

  #flushPending() {
    if (!this.#pending.length) return;
    const leftover: Pending[] = [];
    for (const item of this.#pending) {
      const mapped = this.#v6toV4.get(item.ip) ?? this.#v6toV4.get(item.ip.toLowerCase());
      if (mapped) this.send(item.packet, item.ip, item.port);
      else leftover.push(item);
    }
    this.#pending = leftover;
  }

  #listen() {
    this.#sock4.on("message", (msg, rinfo) => {
      this.#totals.receivedPackets += 1;
      this.#totals.receivedBytes += msg.byteLength;
      const fromRtcPort = rinfo.port === EDGE_RTC;
      if (fromRtcPort) this.#totals.rx3480 += 1;
      const stunType =
        msg.byteLength >= 2 && (msg[0]! & 0xc0) === 0 ? (((msg[0]! & 0x3f) << 8) | msg[1]!).toString(16) : "n/a";
      if (this.#totals.receivedPackets <= 12 || this.#totals.receivedPackets % 50 === 0) {
        logger.info(
          {
            from: rinfo.address,
            port: rinfo.port,
            bytes: msg.byteLength,
            stunType,
            received: this.#totals.receivedPackets,
            fromRtcPort,
          },
          "UDP packet from WhatsApp relay",
        );
      }
      const copy = new Uint8Array(msg.byteLength);
      copy.set(msg);
      this.config.onTransportMessage(copy, rinfo.address, rinfo.port === EDGE_RTC ? EDGE_UDP : rinfo.port);
    });
  }

  #sendOn(buf: Buffer, ip: string, port: number, originalIp?: string) {
    this.#sock4.send(buf, 0, buf.byteLength, port, ip, (err) => {
      if (err) {
        this.#totals.droppedPackets += 1;
        if (this.#totals.droppedPackets <= 8 || this.#totals.droppedPackets % 50 === 0) {
          logger.warn({ err, ip, port, originalIp }, "UDP send to relay failed");
        }
      }
    });
    this.#totals.sentPackets += 1;
    this.#totals.sentBytes += buf.byteLength;
    if (this.#totals.sentPackets <= 8 || this.#totals.sentPackets % 50 === 0) {
      const stunType =
        buf.byteLength >= 2 && (buf[0]! & 0xc0) === 0 ? (((buf[0]! & 0x3f) << 8) | buf[1]!).toString(16) : "n/a";
      logger.info(
        { ip, port, originalIp, bytes: buf.byteLength, stunType, sent: this.#totals.sentPackets },
        "UDP sent to WhatsApp relay",
      );
    }
  }
}
