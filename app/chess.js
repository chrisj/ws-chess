///////////////////////////////////////////////////////////////////////////////
// CHESS defines 3 classes:
//  GameManger - Forms games based on players waiting to play
//  Player - Represents each registered user.
//  Game - A chess game... slightly confusing
//      Gameplayer ....
///////////////////////////////////////////////////////////////////////////////


var User = require('./models/user');

var GameModeEnum = {
    STANDARD: 0,
    CHESSATTACK: 1
}

var ResultEnum = {
    LOSE: 0,
    TIE: 0.5,
    WIN: 1
}

var gm = new GameManager();

///////////////////////////////////////////////////////////////////////////////
// GAME MANAGER
///////////////////////////////////////////////////////////////////////////////

function GameManager() {
    this.waiting = {}

    // todo, try to replace this with object.keys
    for (var key in GameModeEnum) {
        if (!GameModeEnum.hasOwnProperty(key)) {
            //The current property is not a direct property of p
            continue;
        }
        console.log('key', key, GameModeEnum[key])
        this.waiting[GameModeEnum[key]] = [];
    }
};

GameManager.prototype.ready = function (player, options, callbackReady, callbackStart) {
    var mode = options['mode'] ? options['mode'] : GameModeEnum.STANDARD;
    if (!player.game) {
        if (this.waiting[mode].indexOf(player) === -1) {
            console.log('not already waiting');
            this.waiting[mode].push(player);          
            
            if (!this.startGameIfPossible(mode, callbackStart)) {
                callbackReady();
            }
        }
    }
};

GameManager.prototype.startGameIfPossible = function (mode, callbackStart) {
    if (this.waiting[mode].length > 1) {

        // just take first 2 for now
        var random01 = Math.floor(Math.random()*2);
        var white = this.waiting[mode][random01];
        var black = this.waiting[mode][1-random01];
        this.waiting[mode].splice(0, 2);

        var game = new Game(mode, white, black);
        white.game = game.GameAccessorForPlayer(true);
        black.game = game.GameAccessorForPlayer(false);

        callbackStart(white, white.game.gameInfo());
        callbackStart(black, black.game.gameInfo());
        return true;
    }

    return false;
};

function fastRemove(arr, element) {
    return arr.filter(function (el) {
        return el !== element
    });
};

GameManager.prototype.removePlayer = function (player) {
    for (var mode in this.waiting) {
        this.waiting[mode] = fastRemove(this.waiting[mode], player);
    }
};






///////////////////////////////////////////////////////////////////////////////
// PLAYER
///////////////////////////////////////////////////////////////////////////////

function Player(username, socket, successCallback) {
    this.username = username;
    this.socket = socket;

    var self = this;
    User.findOne({'local.username' : this.username}, function (err, user) {
        if (!err && user) {
            self.user = user;
            successCallback(user);
        } else {
            console.log('err/user', err, user);
        }
    });
};

Player.prototype.toString = function () {
    return this.username;
};

Player.prototype.isWaiting = function () {
    for (var mode in gm.waiting) {
        if (gm.waiting[mode].indexOf(this) !== -1) {
            return Number(mode); // convert from string to number
        }
    }
    return false;
};

Player.prototype.move = function (move, callback) {
    if (this.game && this.game.myPersp.hasTurn()) {
        this.game.makeMove(move); // increments turn, set lastMove
        callback(this.game.oppPersp.player);
    } else {
        console.log("not your turn", this.username);
    }
};

Player.prototype.updateElos = function (opponent, result) {
    function Q (player) {
        return Math.pow(10, (player.user.chess.elo / 4000));
    };

    var K = 25;
    var change = Math.round(K * (result - (Q(this) / (Q(this) + Q(opponent)))));

    this.user.chess.elo += change;
    opponent.user.chess.elo -= change;

    return change;
};

Player.prototype.updateStats = function () {
    // make this nicer?
    switch (this.game.resultClaim) {
        case ResultEnum.WIN:
            this.user.chess.wins += 1;
            break;
        case ResultEnum.TIE:
            this.user.chess.ties += 1;
            break;
        case ResultEnum.LOSE:
            this.user.chess.losses += 1;
            break;
    }
};

Player.prototype.getReconnectionInfo = function (callback) {
    var info = {
        username: this.username,
        stats: this.user.chess
    };

    if (this.game) {
        var gameInfo = this.game.gameInfo();

        if (this.game.myPersp.hasTurn()) { // if player is white and its the first turn, oppLast move is null so wont be sent. Kinda dirty.
            gameInfo['move'] = this.game.oppPersp.lastMove;          
        }

        info['game'] = gameInfo;

    } else {
        info['waiting'] = this.isWaiting(); // Player.isWaiting() returns the mode the player is waiting in or False if the player is not waiting
    }

    console.log('info', info);
    callback(info);
};







///////////////////////////////////////////////////////////////////////////////
// GAME
///////////////////////////////////////////////////////////////////////////////

function Game(mode, white, black) {
    this.mode = mode;

    var time = 60 * 1000;

    this.timePerTurn = 2 * 1000;

    if (mode === GameModeEnum.CHESSATTACK) {
        this.startFen = '8/8/rnbqk3/ppppp3/8/8/PPPPP3/RNBQK3 w KQkq - 0 1';
        time *= 4;
    } else {
        this.startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        time *= 6;
    }

    this.turn = 0;


    function CreateGamePlayer(game, player, time) {
        var playerInfo = {
            player: player,
            isWhite: player === white,
            time: time,
            currentTime: function() { return this.time - (this.startTime ? (Date.now() - this.startTime) : 0); },
            hasTurn: function() { return game.turn % 2 != this.isWhite }
        };

        if (playerInfo.isWhite) {
            playerInfo.startTime = Date.now();
        }

        return playerInfo;
    };

    // todo, what if we just take game but copy it and assign myInfo and oppInfo for each player
    this.white = CreateGamePlayer(this, white, time);
    this.black = CreateGamePlayer(this, black, time);
};

Game.prototype.GameAccessorForPlayer = function (white) {
    var game = this;


    var game_accessor = {
        myPersp: white ? this.white : this.black,
        oppPersp: white ? this.black : this.white,
        white: this.white,
        black: this.black,

        // for now
        get mode() { return game.mode; },
        get startFen() { return game.startFen; },

        makeMove: function (move) {
            var now = Date.now();
            var timeUsed = now - this.myPersp.startTime;
            this.myPersp.time += game.timePerTurn - timeUsed;
            this.myPersp.startTime = undefined;

            if (this.myPersp.time < 0) {
                return; //... return false?
            }

            console.log("time remaining", this.myPersp.time, "used", timeUsed);
            this.oppPersp.startTime = now;
            this.myPersp.lastMove = move;
            game.turn += 1;
        },
        endGameIfAgreement: function (callback, savecallback) { // TODO, ugly
            game.endGameIfAgreement(this.myPersp.player, callback, savecallback);
        },
        forfeit: function (callback, savecallback) { // same
            game.forfeit(this.myPersp.player, callback, savecallback);
        },
        gameInfo: function () {
            return {
                white: this.myPersp.isWhite,
                opponent: this.oppPersp.player.username,
                oppStats: this.oppPersp.player.user.chess,
                mode: this.mode,
                // not used at start
                fen: this.myPersp.lastMove ? this.myPersp.lastMove.fen : this.startFen,
                clock: {
                    white: game.white.currentTime(),
                    black: game.black.currentTime()
                }

            }
        }
    }

    return game_accessor;
};

Game.prototype.end = function (player, callback, savecallback) {
    var agreement = this.white.resultClaim + this.black.resultClaim === ResultEnum.WIN;

    var change = 0;

    if (agreement) {
        var opponent = player.game.oppPersp.player;

        if (player.game.mode !== GameModeEnum.CHESSATTACK) { // only update players if it is a 'real' game
            player.updateStats();
            opponent.updateStats();
            change = player.updateElos(opponent, player.game.myPersp.resultClaim);

            function savePlayer(player) {
                player.user.save(function (err) {
                    if (err)
                        throw err;
                    savecallback(player);
                });
            };

            savePlayer(player);
            savePlayer(opponent);
        }
    }

    callback(agreement, change);

    player.game = undefined;
    opponent.game = undefined;
};

Game.prototype.forfeit = function (player, callback, savecallback) {
    player.game.myPersp.resultClaim = ResultEnum.LOSE;
    player.game.oppPersp.resultClaim = ResultEnum.WIN;
    this.end(player, callback, savecallback);
};

Game.prototype.endGameIfAgreement = function (player, callback, savecallback) {
    if (this.white.resultClaim !== undefined && this.black.resultClaim !== undefined) {
        this.end(player, callback, savecallback);
    }
};

exports.GameManager = gm;
exports.Player = Player;
exports.Game = Game;
