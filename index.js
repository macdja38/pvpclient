/**
 * Created by macdja38 on 2017-01-13.
 */

const WebSocket = require('ws');

const EventEmitter = require('events');

const address = 'ws://localhost:8089';

const states = {
  DISCONNECTED: 0,
  INIT: 1,
  CONNECTING: 2,
  READY: 3,
};

let clientId = "38383838338";

const OpCodes = require('./OpCodes');

class Client extends EventEmitter {
  constructor(destination, token, id, guilds) {
    super();
    this.token = token;
    this.address = destination;
    this.id = id;
    this.connection = false;
    this.state = states.DISCONNECTED;
    this.heartBeatInterval = false;
    this.heartBeatIntervalTime = 15000;
    this.configMap = new Map();
    this.guildList =  new Set(guilds);
    this.delay = 0;
  }

  disconnect(reconnect = false) {
    if (this.connection) {
      this.connection.close();
      this.state = states.DISCONNECTED;
    }
    if (reconnect) {
      setTimeout(() => {
        this.connect();
      }, (this.delay = Math.min(Math.max(this.delay *= 2, 1), 5)) * 1000);
    }
  }

  addGuild(id) {
    this.addGuilds([id]);
  }

  addGuilds(ids) {
    ids.filter(id => !this.guildList.has(id));
    if (ids.length < 1) return;
    ids.forEach(id => this.guildList.add(id));
    this.sendMessage({
      op: OpCodes.REQUEST_GUILD, d: { guilds: [ids] }
    })
  }

  connect() {
    if (this.state !== states.DISCONNECTED) {
      this.disconnect(false);
    }
    this.connection = new WebSocket(this.address, null, {
      headers: { token: this.token, id: this.id }
    });
    this._bindListeners();
    this.connection.on('connect', () => {
      console.log('connection')
    });
    this.connection.on('close', () => {
      console.log('disconnected');
      this.disconnect(true);
    })
  }

  _bindListeners() {
    this.connection.on('message', (message) => {
      let contents = JSON.parse(message);
      console.log('got message', contents);
      switch (contents.op) {
        case OpCodes.HELLO:
          this.heartBeatIntervalTime = contents.d.heartbeat_interval;
          this.startHeartbeat();
          this.sendMessage({ op: OpCodes.IDENTIFY, d: { id: clientId, token: this.token } });
          break;
        case OpCodes.DISPATCH:
          switch (contents.t) {
            case "READY":
              this.sendMessage({ op: OpCodes.REQUEST_GUILD, d: { guilds: Array.from(this.guildList) } });
              this.delay = 0;
              break;
            case "GUILD_CONFIG_UPDATE":
              console.log("New config received", contents.d);
              this.configMap.set(contents.d.id, contents.d);
              this.emit("GUILD_CONFIG_UPDATE", contents.d);
              break;
          }
          break;
      }
    })
  }

  updateConfigMap(id, data) {
    this.sendMessage({ op: OpCodes.UPDATE_CONFIG, d: { data, id, o: "update"} })
  }

  replaceConfigMap(id, data) {
    this.sendMessage({ op: OpCodes.UPDATE_CONFIG, d: { data, id, o: "replace" } })
  }

  getConfig(id) {
    return this.configMap.get(id);
  }

  startHeartbeat() {
    if (this.heartBeatInterval) {
      clearInterval(this.heartBeatInterval);
    }
    this.heartBeatInterval = setInterval(() => {
      this.sendMessage({ op: OpCodes.HEARTBEAT, d: Date.now() });
    }, this.heartBeatIntervalTime)
  }

  sendMessage(object) {
    console.log("sending, ", object, JSON.stringify(object));
    this.connection.send(JSON.stringify(object))
  }
}

module.exports = Client;