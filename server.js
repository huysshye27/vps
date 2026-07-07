const net = require("net");

const mode = process.argv[2] || "relay";
const token = "test";
const magic = "TERRARIA_TUNNEL " + token + "\n";

const OPEN = 1, DATA = 2, CLOSE = 3;

function frame(sock, id, type, data = Buffer.alloc(0)) {
  const h = Buffer.alloc(9);
  h.writeUInt32BE(id, 0);
  h.writeUInt8(type, 4);
  h.writeUInt32BE(data.length, 5);
  sock.write(Buffer.concat([h, data]));
}

function parser(cb) {
  let buf = Buffer.alloc(0);
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 9) {
      const id = buf.readUInt32BE(0);
      const type = buf.readUInt8(4);
      const len = buf.readUInt32BE(5);
      if (buf.length < 9 + len) return;
      const data = buf.subarray(9, 9 + len);
      buf = buf.subarray(9 + len);
      cb(id, type, data);
    }
  };
}

if (mode === "relay") {
  const port = Number(process.env.PORT || 26499);
  let tunnel = null;
  let next = 1;
  const clients = new Map();

  const server = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    let decided = false;

    function asClient(first) {
      if (!tunnel) return sock.destroy();

      const id = next++;
      clients.set(id, sock);
      frame(tunnel, id, OPEN);

      if (first.length) frame(tunnel, id, DATA, first);

      sock.on("data", d => tunnel && frame(tunnel, id, DATA, d));
      sock.on("close", () => {
        clients.delete(id);
        if (tunnel) frame(tunnel, id, CLOSE);
      });
      sock.on("error", () => {});
    }

    sock.on("data", function first(d) {
      if (decided) return;
      buf = Buffer.concat([buf, d]);

      const s = buf.toString();
      if (s.startsWith(magic)) {
        decided = true;
        sock.removeListener("data", first);
        tunnel = sock;
        console.log("Tunnel connected");

        const p = parser((id, type, data) => {
          const c = clients.get(id);
          if (type === DATA && c) c.write(data);
          if (type === CLOSE && c) c.destroy();
        });

        const rest = buf.subarray(Buffer.byteLength(magic));
        if (rest.length) p(rest);

        sock.on("data", p);
        sock.on("close", () => {
          console.log("Tunnel closed");
          tunnel = null;
          for (const c of clients.values()) c.destroy();
          clients.clear();
        });
        return;
      }

      if (!magic.startsWith(s) || buf.length > magic.length) {
        decided = true;
        sock.removeListener("data", first);
        asClient(buf);
      }
    });

    setTimeout(() => {
      if (!decided) {
        decided = true;
        sock.removeAllListeners("data");
        asClient(buf);
      }
    }, 1000);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log("Relay:", "0.0.0.0:" + port);
  });
}

if (mode === "client") {
  const relayHost = process.env.RELAY_HOST;
  const relayPort = Number(process.env.RELAY_PORT);
  const localPort = Number(process.env.LOCAL_PORT || 7777);

  const locals = new Map();

  function connect() {
    console.log("Connecting relay...");
    const tunnel = net.connect(relayPort, relayHost, () => {
      console.log("Connected relay");
      tunnel.write(magic);
    });

    const p = parser((id, type, data) => {
      if (type === OPEN) {
        const local = net.connect(localPort, "127.0.0.1");
        locals.set(id, local);

        local.on("data", d => frame(tunnel, id, DATA, d));
        local.on("close", () => {
          locals.delete(id);
          frame(tunnel, id, CLOSE);
        });
        local.on("error", () => {
          frame(tunnel, id, CLOSE);
        });
      }

      if (type === DATA) {
        const local = locals.get(id);
        if (local) local.write(data);
      }

      if (type === CLOSE) {
        const local = locals.get(id);
        if (local) local.destroy();
        locals.delete(id);
      }
    });

    tunnel.on("data", p);
    tunnel.on("close", () => {
      for (const l of locals.values()) l.destroy();
      locals.clear();
      setTimeout(connect, 3000);
    });
    tunnel.on("error", () => {});
  }

  connect();
}
