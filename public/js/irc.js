// Read-only Twitch chat over IRC WebSocket. Anonymous (justinfan) login, so no credentials touch the browser.

export class TwitchChat extends EventTarget {
  constructor(login) {
    super();
    this.login = login.toLowerCase();
    this.delay = 1000;
    this.closed = false;
  }

  connect() {
    const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.ws = ws;
    ws.onopen = () => {
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send("PASS SCHMOOPIIE");
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      ws.send(`JOIN #${this.login}`);
    };
    ws.onmessage = (e) => {
      for (const line of String(e.data).split("\r\n")) if (line) this.handle(line);
    };
    ws.onclose = () => {
      this.dispatchEvent(new CustomEvent("status", { detail: "reconnecting" }));
      if (this.closed) return;
      setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(this.delay * 2, 30_000);
    };
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  handle(line) {
    if (line.startsWith("PING")) {
      this.ws.send(line.replace("PING", "PONG"));
      return;
    }
    let tags = {};
    let rest = line;
    if (rest.startsWith("@")) {
      const sp = rest.indexOf(" ");
      for (const kv of rest.slice(1, sp).split(";")) {
        const [k, v = ""] = kv.split("=");
        tags[k] = v.replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\\\/g, "\\");
      }
      rest = rest.slice(sp + 1);
    }
    const m = rest.match(/^:(\S+) (\S+)(?: (\S+))?(?: :(.*))?$/);
    if (!m) return;
    const [, prefix, command, , text = ""] = m;

    if (command === "366") {
      this.delay = 1000;
      this.dispatchEvent(new CustomEvent("status", { detail: "joined" }));
    } else if (command === "PRIVMSG") {
      const user = tags["display-name"] || prefix.split("!")[0];
      this.dispatchEvent(new CustomEvent("message", { detail: { user, color: tags.color || "", text } }));
    } else if (command === "USERNOTICE") {
      const id = tags["msg-id"];
      if (id === "raid") {
        this.dispatchEvent(
          new CustomEvent("event", {
            detail: { type: "raid", user: tags["msg-param-displayName"], viewers: Number(tags["msg-param-viewerCount"] || 0) },
          }),
        );
      } else if (id === "sub" || id === "resub") {
        this.dispatchEvent(
          new CustomEvent("event", { detail: { type: "sub", user: tags["display-name"], months: Number(tags["msg-param-cumulative-months"] || 1) } }),
        );
      }
    }
  }
}
