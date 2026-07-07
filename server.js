const net = require("net");

const mode = process.argv[2] || "relay";
const token = "test";
const magic = "TERRARIA_TUNNEL " + token + "\n";

const OPEN = 1;
const DATA = 2;
const CLOSE = 3;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function sendFrame(sock, id, type, data = Buffer.alloc(0)) {
  if (!sock || sock.destroyed) return;
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);

  const header = Buffer.alloc(9);
  header.writeUInt32BE(id, 0);
  header.writeUInt8(type, 4);
  header.writeUInt32BE(data.length, 5);

  sock.write(Buffer.concat([header, data]));
}

function makeParser(onFrame) {
  let buf = Buffer.alloc(0);

  return function parse(chunk) {
    buf = Buffer.concat([buf, chunk]);

    while (buf.length >= 9) {
      const id = buf.readUInt32BE(0);
      const type = buf.readUInt8(4);
      const len = buf.readUInt32BE(5);

      if (len > 20 * 1024 * 1024) {
        throw new Error("Frame too large: " + len);
      }

      if (buf.length < 9 + len) return;

      const data = buf.subarray(9, 9 + len);
      buf = buf.subarray(9 + len);

      onFrame(id, type, data);
    }
  };
}

if (mode === "relay") {
  const port = Number(process.env.PORT || process.env.RELAY_PORT || 26499);
  let tunnel = null;
  let nextId = 1;
  const clients = new Map();

  function closeClient(id) {
    const c = clients.get(id);
    if (c && !c.destroyed) c.destroy();
    clients.delete(id);
  }

  const server = net.createServer((sock) => {
    let firstBuf = Buffer.alloc(0);
    let decided = false;

    function becomeClient(initialData) {
      if (!tunnel || tunnel.destroyed) {
        log("Reject client: no tunnel");
        sock.destroy();
        return;
      }

      const id = nextId++;
      clients.set(id, sock);
      log("Client connected", id, sock.remoteAddress, sock.remotePort);

      sendFrame(tunnel, id, OPEN);

      if (initialData.length) {
        sendFrame(tunnel, id, DATA, initialData);
      }

      sock.on("data", (d) => {
        if (tunnel && !tunnel.destroyed) {
          sendFrame(tunnel, id, DATA, d);
        } else {
          sock.destroy();
        }
      });

      sock.on("close", () => {
        clients.delete(id);
        if (tunnel && !tunnel.destroyed) {
          sendFrame(tunnel, id, CLOSE);
        }
        log("Client closed", id);
      });

      sock.on("error", (err) => {
        log("Client error", id, err.message);
      });
    }

    function becomeTunnel(restData) {
      if (tunnel && !tunnel.destroyed) {
        log("Old tunnel replaced");
        tunnel.destroy();
      }

      tunnel = sock;
      log("Tunnel connected", sock.remoteAddress, sock.remotePort);

      const parse = makeParser((id, type, data) => {
        const c = clients.get(id);

        if (type === DATA && c && !c.destroyed) {
          c.write(data);
        }

        if (type === CLOSE) {
          closeClient(id);
        }
      });

      if (restData.length) {
        try {
          parse(restData);
        } catch (e) {
          log("Tunnel parse error", e.message);
          sock.destroy();
        }
      }

      sock.on("data", (chunk) => {
        try {
          parse(chunk);
        } catch (e) {
          log("Tunnel parse error", e.message);
          sock.destroy();
        }
      });

      sock.on("close", () => {
        log("Tunnel closed");
        if (tunnel === sock) tunnel = null;

        for (const [id, c] of clients.entries()) {
          if (c && !c.destroyed) c.destroy();
          clients.delete(id);
        }
      });

      sock.on("error", (err) => {
        log("Tunnel error", err.message);
      });
    }

    function firstData(d) {
      if (decided) return;

      firstBuf = Buffer.concat([firstBuf, d]);
      const s = firstBuf.toString("utf8");

      if (s.startsWith(magic)) {
        decided = true;
        sock.removeListener("data", firstData);

        const rest = firstBuf.subarray(Buffer.byteLength(magic));
        becomeTunnel(rest);
        return;
      }

      if (!magic.startsWith(s) || firstBuf.length > magic.length) {
        decided = true;
        sock.removeListener("data", firstData);
        becomeClient(firstBuf);
      }
    }

    sock.on("data", firstData);

    setTimeout(() => {
      if (!decided) {
        decided = true;
        sock.removeListener("data", firstData);
        becomeClient(firstBuf);
      }
    }, 1000);
  });

  server.listen(port, "0.0.0.0", () => {
    log("Relay listening on 0.0.0.0:" + port);
    log("Terraria players connect to this host/port");
  });
}

if (mode === "client") {
  const relayHost = process.env.RELAY_HOST;
  const relayPort = Number(process.env.RELAY_PORT);
  const localHost = process.env.LOCAL_HOST || "127.0.0.1";
  const localPort = Number(process.env.LOCAL_PORT || 7777);

  if (!relayHost || !relayPort) {
    console.error("Missing RELAY_HOST or RELAY_PORT");
    process.exit(1);
  }

  const locals = new Map();

  function connectTunnel() {
    log("Connecting relay", relayHost + ":" + relayPort);

    const tunnel = net.connect(relayPort, relayHost, () => {
      log("Connected relay");
      tunnel.write(magic);
    });

    const parse = makeParser((id, type, data) => {
      if (type === OPEN) {
        log("Open local stream", id);

        const local = net.connect(localPort, localHost, () => {
          log("Local connected", id, localHost + ":" + localPort);
        });

        locals.set(id, local);

        local.on("data", (d) => {
          sendFrame(tunnel, id, DATA, d);
        });

        local.on("close", () => {
          locals.delete(id);
          sendFrame(tunnel, id, CLOSE);
          log("Local closed", id);
        });

        local.on("error", (err) => {
          log("Local error", id, err.message);
          locals.delete(id);
          sendFrame(tunnel, id, CLOSE);
        });

        return;
      }

      if (type === DATA) {
        const local = locals.get(id);
        if (local && !local.destroyed) {
          local.write(data);
        }
        return;
      }

      if (type === CLOSE) {
        const local = locals.get(id);
        if (local && !local.destroyed) local.destroy();
        locals.delete(id);
      }
    });

    tunnel.on("data", (chunk) => {
      try {
        parse(chunk);
      } catch (e) {
        log("Client parse error", e.message);
        tunnel.destroy();
      }
    });

    tunnel.on("close", () => {
      log("Relay closed. Reconnect in 3s");

      for (const local of locals.values()) {
        if (local && !local.destroyed) local.destroy();
      }

      locals.clear();
      setTimeout(connectTunnel, 3000);
    });

    tunnel.on("error", (err) => {
      log("Relay error", err.message);
    });
  }

  connectTunnel();
}
