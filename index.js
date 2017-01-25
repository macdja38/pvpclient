/**
 * Created by macdja38 on 2017-01-13.
 */

const WebSocket = require('ws');

const EventEmitter = require('events');

const address = 'ws://localhost:8080';

const states = {
  DISCONNECTED: 0,
  INIT: 1,
  CONNECTING: 2,
  READY: 3,
};

let clientId = "38383838338";

const OpCodes = require('./OpCodes');

class Client extends EventEmitter {
  constructor(token) {
    super();
    this.token = token;
    this.connection = false;
    this.state = states.DISCONNECTED;
    this.heartBeatInterval = false;
    this.heartBeatIntervalTime = 15000;
    this.configMap = new Map();
  }

  disconnect(reconnect = false) {
    if (this.connection) {
      this.connection.close();
      this.state = states.DISCONNECTED;
    }
    if (reconnect) {
      this.connect();
    }
  }

  connect() {
    if (this.state !== states.DISCONNECTED) {
      this.disconnect(false);
    }
    this.connection = new WebSocket(address, null, {
      headers: { auth: 'trololololol' }
    });
    this.bindListeners();
    this.connection.on('connect', () => {
      console.log('connection')
    })
  }

  bindListeners() {
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
              this.sendMessage({ op: OpCodes.REQUEST_GUILD, d: { guilds: ['97069403178278912'] } });
              break;
            case "GUILD_CONFIG_UPDATE":
              console.log("New config received", contents.d);
              this.configMap.set(contents.d.id, contents.d);
              break;
          }
          break;
      }
    })
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