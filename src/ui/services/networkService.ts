///<reference path="../_app.ts" />
'use strict';

import { EventEmitter } from "events";
import StaticService from "./staticService.ts";
import readConfigData from "../../../ConfigReader.ts";

const io = <SocketIOClientStatic>require("socket.io-client");
var playerId;
var pathToLolExe;
var pathToLolFolder;
var execFile = require('child_process').execFile;
export class NetworkService extends EventEmitter {
    /**  Current lobby. May be null. */
    currentLobby: lobby.Lobby;
    /** Current Socket.IO connection to lobby. May be null. */
    currentLobbyConnection: SocketIOClient.Socket;
    /** Current username within the current lobby. */
    currentUsername: string;

    /** List of all available lobbies. */
    lobbies: lobby.LobbyListItem[];
    /** Current Socket.IO connection to central server. */
    currentConnection: SocketIOClient.Socket;

    constructor() {
        super();

        this.lobbies = [];
    }

    connectToCentral(url: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.currentConnection = io.connect(url, { reconnection: false });
            this.currentConnection.on("connect", resolve);

            const [add, update, remove] = this.buildListUpdater("lobbylist", this.lobbies, {
                name: "name",
                creator: "creator",
                playerLimit: "playerLimit",
                playerCount: "playerCount",
                gamemodeName: "gameMode",
                hasPassword: "requirePassword",
                address: "address",
                port: "port"
            });
            this.currentConnection.on("lobbylist-add", add);
            this.currentConnection.on("lobbylist-update", update);
            this.currentConnection.on("lobbylist-remove", remove);

            //Sending the options to the server
            var options = {
                name: "name",
                creator: "creator",
                playerLimit: "10",
                gamemodeName: "gameMode",
                requirePassword: "false",
                address: "address",
                port: "port"
            }
            this.currentConnection.emit('lobby.create', options);
            this.currentConnection.emit('lobby.list');
            this.currentConnection.on("lobby.list", function(lobbies){
                var count = 0;
                while (count <= lobbies.length){
                    add(lobbies[count]);
                    count++;
                }
            });
        });
    }


    /*
     * ======================================
     * ============= Lobby Lists ============
     * ======================================
     */
    public joinLobby(item: lobby.LobbyListItem, username = "Player", password?: string): Promise<any> {
        if (this.currentLobby || this.currentLobbyConnection) {
            throw new Error("Already connected to lobby.");
        }

        this.currentUsername = username;
        return new Promise((resolve, reject) => {
            this.currentLobbyConnection = io.connect(item.address + ":" + item.port, {reconnection: false, 'forceNew': true});
            this.currentLobbyConnection.on("connect", () => {
                this.currentLobbyConnection.emit("lobby-connect", { name: username, password: password });
            });
            this.currentLobbyConnection.on("lobby-connect", (c) => this.handleLobbyConnect(c, resolve, reject));
        });
    }

    public leaveLobby() {
        this.currentLobbyConnection.disconnect();
    }
    /*
     * ======================================
     * =============== Lobby ================
     * ======================================
     */
    public setSetting(setting: lobby.LobbySetting, value: any) {
        if (!this.currentLobby || !this.currentLobbyConnection) {
            throw new Error("Not connected to lobby.");
        }
        
        this.currentLobbyConnection.emit("lobby-setting", { 
            "setting-binding": setting.binding,
            "value": value 
        });
    }
    public startGame(){
        if (!(this.currentLobby && this.currentLobbyConnection)) {
            throw new Error("Not connected to lobby.");
        }
        this.currentLobbyConnection.emit("start-game");
    }
    
    /** Sends a chat message. */
    public sendMessage(msg: string) {
        if (!this.currentLobby || !this.currentLobbyConnection) {
            throw new Error("Not connected to lobby.");
        }
        
        this.currentLobbyConnection.emit("chat-message", { 
            message: msg
        });
    }
    
    /** Joins the specified team. */
    public joinTeam(team: lobby.Team) {
        if (!this.currentLobby || !this.currentLobbyConnection) {
            throw new Error("Not connected to lobby.");
        }
        
        this.currentLobbyConnection.emit("join-team", { 
            team: team.id
        });
    }
    
    private handleLobbyConnect(contents: any, resolve: any, reject: any) {
        if (contents.ok) {
            this.currentLobby = {
                name: contents.name,
                creator: contents.creator,
                gamemodeName: contents.gameMode,
                teams: [],
                players: [],
                settings: []
            };
            this.emit("lobby-connect");

            const [teamlistAdd, teamlistUpdate, teamlistRemove] = this.buildListUpdater("teamlist", this.currentLobby.teams, {
                id: "id",
                name: "name",
                color: "color",
                playerLimit: "playerLimit"
            });

            const [playerlistAdd, playerlistUpdate, playerlistRemove] = this.buildListUpdater("playerlist", this.currentLobby.players, {
                id: "id",
                name: "name",
                team: ["teamId", id => this.currentLobby.teams.filter(x => x.id === id)[0]],
                champion: ["championId", id => StaticService.champions.filter(x => x.id === id)[0]],
                skinIndex: "skinIndex",
                spellOne: ["spell1id", id => StaticService.summonerSpells.filter(x => x.id === id)[0]],
                spellTwo: ["spell2id", id => StaticService.summonerSpells.filter(x => x.id === id)[0]]
            });
            function startGame(gameServerPort){
                //Start the game with the port
                console.log("Starting LoL...")
                var configContent = readConfigData();
                var args = [
                    "8394",
                    "LoLLauncher.exe",
                    "",
                    "127.0.0.1 " + gameServerPort + " 17BLOhi6KZsTtldTsizvHg== " + playerId
                ];
                execFile.execFile(configContent.pathToLolExe, 
                args, {cwd: configContent.pathToLolFolder, maxBuffer: 1024 * 90000},
                (error) => {
                    if (error){
                        throw error;
                }});
            }
            this.currentLobbyConnection.on("teamlist-add", teamlistAdd);
            this.currentLobbyConnection.on("teamlist-update", teamlistUpdate);
            this.currentLobbyConnection.on("teamlist-remove", teamlistRemove);

            this.currentLobbyConnection.on("playerlist-add", playerlistAdd);
            this.currentLobbyConnection.on("playerlist-update", playerlistUpdate);
            this.currentLobbyConnection.on("playerlist-remove", playerlistRemove);
            
            this.currentLobbyConnection.on("settinglist-add", this.handleSettingAdd.bind(this));
            this.currentLobbyConnection.on("settinglist-update", this.handleSettingUpdate.bind(this));
            this.currentLobbyConnection.on("settinglist-remove", this.handleSettingRemove.bind(this));
            
            this.currentLobbyConnection.on("chat-message", data => {
                const d = new Date(0);
                d.setUTCMilliseconds(data.timestamp);
                this.emit("chat", d, data.sender, data.message); 
            });
            this.currentLobbyConnection.on("start-game", startGame);
            this.currentLobbyConnection.on("playerID", function(receivedPlayerId){
                //Start the game with the port
                playerId = receivedPlayerId;
            });
            this.currentLobbyConnection.on("chat-message-batch", data => {
                data.messages.forEach(m => {
                    const d = new Date(0);
                    d.setMilliseconds(m.timestamp);
                    this.emit("chat", d, m.sender, m.message);
                });
            });
            
            resolve(contents);
        } else {
            reject(contents);

            this.currentLobbyConnection.close();
            this.currentLobbyConnection = null;
        }
    }

    /**
     * Because the whole foo-add, foo-update and foo-remove structure is quite common
     * in the lobby protocol, I extracted most of the logic to this function, which is
     * a factory for listener functions. Just give it a name, a list which should store
     * the data and a KeyTransformMap which specifies how the incoming data should be
     * transformed to the local representation.
     */
    private buildListUpdater<L extends { id: number }>(evntName: string, list: L[], map: KeyTransformMap): [any, any, any] {
        function get(id): L {
            return list.filter(x => x.id === id)[0];
        }

        return [contents => { // add
            if (get(contents.id)) throw new Error(evntName + " with id " + contents.id + " already exists.");

            const res: L = <any>{};
            Object.keys(map).forEach(prop => {
                // Direct mapping.
                if (typeof map[prop] === "string") {
                    if (typeof contents[<string>map[prop]] === "undefined") throw new Error("Missing required property " + map[prop]);
                    res[prop] = contents[<string>map[prop]];
                } else {
                    const transform = <any>map[prop];
                    if (typeof contents[transform[0]] === "undefined") throw new Error("Missing required property " + transform[0]);
                    res[prop] = transform[1](contents[transform[0]], res);
                }
            });

            list.push(res);
            this.emit(evntName + "-add", res);
        }, contents => { // update
            if (!get(contents.id)) throw new Error("No " + evntName + " with id " + contents.id + ".");

            const item = get(contents.id);
            Object.keys(map).forEach(prop => {
                // Direct mapping.
                if (typeof map[prop] === "string") {
                    if (typeof contents[<string>map[prop]] === "undefined") return;
                    item[prop] = contents[<string>map[prop]];
                } else {
                    const transform = <any>map[prop];
                    if (typeof contents[transform[0]] === "undefined") return;
                    item[prop] = transform[1](contents[transform[0]], item);
                }
            });
            this.emit(evntName + "-update", item);
        }, contents => { // remove
            if (!get(contents.id)) throw new Error("No " + evntName + " with id " + contents.id + ".");

            const item = get(contents.id);
            list.splice(list.indexOf(item), 1);
            this.emit(evntName + "-remove", item);
        }];
    }
    
    private handleSettingAdd(contents: any) {
        if (this.currentLobby.settings.filter(x => x.binding === contents.binding).length > 0) {
            throw new Error("Duplicate setting " + contents.binding);
        }

        const setting: lobby.LobbySetting = contents;
        this.currentLobby.settings.push(setting);
        this.emit("setting-add", setting);
    }
    
    private handleSettingUpdate(contents: any) {
        if (this.currentLobby.settings.filter(x => x.binding === contents.binding).length) {
            const item = this.currentLobby.settings.filter(x => x.binding === contents.binding)[0];
            (<any>Object).assign(item, contents);
            this.emit("setting-update", item);
            return;
        }

        throw new Error("Unknown setting " + contents.binding);
    }
    
    private handleSettingRemove(contents: any) {
        if (this.currentLobby.settings.filter(x => x.binding === contents.binding).length) {
            const item = this.currentLobby.settings.filter(x => x.binding === contents.binding)[0];
            this.currentLobby.settings.splice(this.currentLobby.settings.indexOf(item), 1);
            this.emit("setting-remove", item);
            return;
        }
        
        throw new Error("Unknown setting " + contents.binding);
    }
}

const instance = new NetworkService();
export default instance;

interface KeyTransformMap {
    [key: string]: (string | ([string, (any, thiz?: any) => any]));
}
