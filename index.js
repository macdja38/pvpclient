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
    this.guildList = new Set(guilds);
    this.delay = 0;
  }

  /**
   * Disconnect from the api server
   * @param reconnect true if connection should be reformed
   */
  disconnect(reconnect = false) {
    if (this.connection) {
      this.connection.close();
      if (this.heartBeatInterval) {
        clearInterval(this.heartBeatInterval);
      }
      this.state = states.DISCONNECTED;
    }
    if (reconnect) {
      setTimeout(() => {
        this.connect();
      }, (this.delay = Math.min(Math.max(this.delay *= 2, 1), 5)) * 1000);
    }
  }

  /**
   * Starts following config changes of a single guild
   * @param id
   */
  addGuild(id) {
    this.addGuilds([id]);
  }

  /**
   * Starts following config chages for an array of guilds
   * @param ids
   */
  addGuilds(ids) {
    ids.filter(id => !this.guildList.has(id));
    if (ids.length < 1) return;
    ids.forEach(id => this.guildList.add(id));
    this.sendMessage({
      op: OpCodes.REQUEST_GUILD, d: {guilds: [ids]}
    })
  }

  /**
   * Initialises the connection to the api server
   */
  connect() {
    if (this.state !== states.DISCONNECTED) {
      this.disconnect(false);
    }
    this.connection = new WebSocket(this.address, null, {
      headers: {token: this.token, id: this.id}
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
          this._startHeartbeat();
          this.sendMessage({op: OpCodes.IDENTIFY, d: {id: this.id, token: this.token}});
          break;
        case OpCodes.DISPATCH:
          switch (contents.t) {
            case "READY":
              this.sendMessage({op: OpCodes.REQUEST_GUILD, d: {guilds: Array.from(this.guildList)}});
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

  /**
   * Updates a configMap
   * @param id guild id or * for base config
   * @param data
   */
  updateConfigMap(id, data) {
    this.sendMessage({op: OpCodes.UPDATE_CONFIG, d: {data, id, o: "update"}})
  }

  /**
   * Replaces a configMap
   * @param id guild id or * for base config
   * @param data
   */
  replaceConfigMap(id, data) {
    this.sendMessage({op: OpCodes.UPDATE_CONFIG, d: {data, id, o: "replace"}})
  }

  /**
   * get a key from the config. will accept a fallBack value or throw if failThrow is defined.
   * @param key
   * @param fallBack
   * @param failThrow
   * @returns {*}
   */
  get(key, {fallBack, failThrow}) {
    if (failThrow) failThrow = `Error Property ${key} does not exist on ${this._fileName}`;
    let keys = key.split(".");
    if (keys.length < 1) throw "Key must be at least one section long";
    let data = this.configMap.get(keys[0]);
    data = (data && data.data) ? data.data : {};
    return this._recursiveGet(keys, data, {fallBack, failThrow});
  }

  _recursiveGet(keys, data, {fallback, failThrow}) {
    if (keys.length === 0) {
      return data;
    }
    let key = keys.shift();
    if (typeof data === "object" && data !== null && data.hasOwnProperty(key)) {
      return this._recursiveGet(keys, data[key], {fallback, failThrow});
    } else {
      if (fallback) return fallback;
      if (failThrow) throw failThrow;
    }
  }

  /**
   * Get's the entire config based on an id
   * @param id of guild
   * @returns {Object || null}
   */
  getConfig(id) {
    return this.configMap.get(id);
  }

  _startHeartbeat() {
    if (this.heartBeatInterval) {
      clearInterval(this.heartBeatInterval);
    }
    this.heartBeatInterval = setInterval(() => {
      this.sendMessage({op: OpCodes.HEARTBEAT, d: Date.now()});
    }, this.heartBeatIntervalTime)
  }

  /**
   * Sends an object through the websocket to the api server, if using the lib this will probably not be needed.
   * @param object
   */
  sendMessage(object) {
    console.log("sending, ", object, JSON.stringify(object));
    this.connection.send(JSON.stringify(object))
  }
}

module.exports = Client;