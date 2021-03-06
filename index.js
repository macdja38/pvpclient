/**
 * Created by macdja38 on 2017-01-13.
 */

const WebSocket = require('ws');

const logID = Math.floor(Math.random() * 10000);

const EventEmitter = require('events');

const address = 'ws://localhost:8089';

const states = {
  DISCONNECTED: 0,
  INIT: 1,
  CONNECTING: 2,
  READY: 3,
};

let clientId = "38383838338";

const requestPromise = require("request-promise-native");

const OpCodes = require('./OpCodes');

class Client extends EventEmitter {
  constructor(destination, https, token, id, guilds, eris) {
    super();
    this.token = token;
    this.address = destination;
    this.id = id;
    this.https = https;
    this.connection = false;
    this.state = states.DISCONNECTED;
    this.heartBeatInterval = false;
    this.heartBeatIntervalTime = 15000;
    this.configMap = new Map();
    this.guildList = new Set(guilds);
    this.eris = eris;
    this.delay = 0;
    this._onOpen = this._onOpen.bind(this);
    this._onClose = this._onClose.bind(this);
    this._onError= this._onError.bind(this);
    this._onMessage = this._onMessage.bind(this);
  }

  getWebsocketURL() {
    return `ws${this.https ? "s" : ""}://${this.address}/botconfig/v1/ws`;
  }

  getApiURL() {
    return `http${this.https ? "s" : ""}://${this.address}/v1/`
  }

  /**
   * Disconnect from the api server
   * @param reconnect true if connection should be reformed
   */
  disconnect(reconnect = false) {
    console.log(`${logID} Disconnect called, with reconnect set to ${reconnect}`);
    this.state = states.DISCONNECTED;
    if (this.connection) {
      this._unBindListeners();
      if (this.heartBeatInterval) {
        clearInterval(this.heartBeatInterval);
      }
      this.connection.close();
    }
    if (reconnect) {
      setTimeout(() => {
        this.connect();
      }, (this.delay = Math.min(Math.max(this.delay *= 2, 1), 5)) * 1000);
    }
  }

  /**
   * Starts following config changes of a single guild
   * @param {string} id
   */
  addGuild(id) {
    this.addGuilds([id]);
  }

  /**
   * Notifies the api server that the bot is no longer on the specified guild.
   * @param id
   */
  removeGuild(id) {
    this.removeGuilds([id]);
  }

  /**
   * Starts following config chages for an array of guilds
   * @param ids
   */
  addGuilds(ids) {
    ids.filter(id => !this.guildList.has(id));
    if (ids.length < 1) return;
    ids.forEach(id => this.guildList.add(id));
    if (this.state === states.READY) {
      this.sendMessage({
        op: OpCodes.REQUEST_GUILD, d: { guilds: [ids] },
      })
    }
  }

  /**
   * Starts following config changes for an array of guilds
   * @param ids
   */
  removeGuilds(ids) {
    ids.filter(id => this.guildList.has(id));
    if (ids.length < 1) return;
    ids.forEach(id => this.guildList.delete(id));
    if (this.state === states.READY) {
      this.sendMessage({
        op: OpCodes.REMOVE_GUILD, d: { guilds: [ids] },
      })
    }
  }

  /**
   * Initialises the connection to the api server
   */
  connect() {
    if (this.state !== states.DISCONNECTED) {
      this.disconnect(false);
    }
    this.state = states.CONNECTING;
    this.connection = new WebSocket(this.getWebsocketURL(), {
      headers: { token: this.token, id: this.id },
    });
    this._bindListeners();
  }

  _bindListeners() {
    this.connection.on('open', this._onOpen);
    this.connection.on('close', this._onClose);
    this.connection.on('error', this._onError);
    this.connection.on('message', this._onMessage);
  }

  _unBindListeners() {
    this.connection.removeListener('open', this._onOpen);
    this.connection.removeListener('close', this._onClose);
    this.connection.removeListener('error', this._onError);
    this.connection.removeListener('message', this._onMessage);
  }

  _onOpen() {
    this.state = states.READY;
    this.delay = 0;
    console.log(`${logID} connection`)
  }

  _onClose() {
    console.log(`${logID} disconnected`);
    this.disconnect(true);
  }

  _onError(error) {
    console.error(error);
    this.emit("error", error);
  }

  _onMessage(message) {
    let contents = JSON.parse(message);
    if (this.rpcClient && this.rpcClient.isRpcMsg(contents)) {
      this.rpcClient.message(contents);
      return;
    }
    switch (contents.op) {
      case OpCodes.HELLO:
        this.heartBeatIntervalTime = contents.d.heartbeat_interval;
        this._startHeartbeat();
        this.sendMessage({ op: OpCodes.IDENTIFY, d: { id: this.id, token: this.token } });
        break;
      case OpCodes.DISPATCH:
        switch (contents.t) {
          case "READY":
            this.sendMessage({
              op: OpCodes.REQUEST_GUILD,
              d: { guilds: Array.from(this.guildList) },
            });
            this.delay = 0;
            break;
          case "GUILD_CONFIG_UPDATE":
            this.configMap.set(contents.d.id, contents.d);
            this.emit("GUILD_CONFIG_UPDATE", contents.d);
            break;
        }
        break;
      case OpCodes.GET_CHANNELS_USERS_AND_ROLES:
        console.log(`${logID} Was asked for something`);
        console.log(contents);
        let guild = this.eris.guilds.get(contents.d.id);
        let serverObject;
        if (guild) {
          serverObject = {
            roles: guild.roles.map(role => ({ id: role.id, name: role.name })),
            members: guild.members.map(member => ({ id: member.id, name: member.user.username })),
            channels: guild.channels.map(channel => ({
              id: channel.id,
              name: channel.name,
              type: channel.type,
            })),
          };
        } else {
          serverObject = {
            error: "unable to find guild with that id",
          };
        }
        this.sendMessage({
          op: OpCodes.RESPONSE_CHANNELS_USERS_AND_ROLES,
          d: serverObject,
          nonce: contents.nonce,
        });
        break;
      case OpCodes.HEARTBEAT_ACK:
        console.log(`${logID} heartbeat acked { d: ${contents.d} }`);
        this.heartbeatAcked = contents.d;
    }
  }

  /**
   * Updates a configMap
   * @param id guild id or * for base config
   * @param data
   */
  updateConfigMap(id, data) {
    this.sendMessage({ op: OpCodes.UPDATE_CONFIG, d: { data, id, o: "update" } })
  }

  /**
   * Replaces a configMap
   * @param id guild id or * for base config
   * @param data
   */
  replaceConfigMap(id, data) {
    this.sendMessage({ op: OpCodes.UPDATE_CONFIG, d: { data, id, o: "replace" } })
  }

  getConfigMap() {
    return requestPromise(`${this.getApiURL()}settingsMap/${this.id}`, {
      headers: {
        token: this.token,
      },
    }).then(res => JSON.parse(res));
  }

  /**
   * get a key from the config. will accept a fallBack value or throw if failThrow is defined.
   * @param key
   * @param fallBack
   * @param failThrow
   * @returns {*}
   */
  get(key, { fallBack, failThrow }) {
    if (failThrow) failThrow = `Error Property ${key} does not exist on ${this._fileName}`;
    let keys = key.split(".");
    if (keys.length < 1) throw "Key must be at least one section long";
    let data = this.configMap.get(keys.shift());
    data = (data && data.data) ? data.data : {};
    return this._recursiveGet(keys, data, { fallBack, failThrow });
  }

  _recursiveGet(keys, data, { fallback, failThrow }) {
    if (keys.length === 0) {
      return data;
    }
    let key = keys.shift();
    if (typeof data === "object" && data !== null && data.hasOwnProperty(key)) {
      return this._recursiveGet(keys, data[key], { fallback, failThrow });
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
    this.heartbeatAcked = Date.now();
    this.heartBeatInterval = setInterval(() => {
      if (this.heartbeatAcked < (Date.now() - (2 * this.heartBeatIntervalTime) - 200)) {
        console.log(`${logID} forcing disconnect`);
        this.disconnect(true);
      } else {
        const d = Date.now();
        console.log(`${logID} sending heartbeat with { d: ${d} }`);
        this.sendMessage({ op: OpCodes.HEARTBEAT, d });
      }
    }, this.heartBeatIntervalTime)
  }

  /**
   * Sends an object through the websocket to the api server, if using the lib this will probably not be needed.
   * @param object
   */
  sendMessage(object) {
    this.connection.send(JSON.stringify(object))
  }
}

module.exports = Client;
