var User = require('./models/user');

var gm = new GameManager();

var ResultEnum = {
    LOSE: 0,
    TIE: 0.5,
    WIN: 1
}

function GameManager() {
    this.waiting = []
}

GameManager.prototype.ready = function (player, callbackready, callbackgame) {
    if (!player.game) {
        if (this.waiting.indexOf(player) === -1) {
            this.waiting.push(player);            
            
            if (!this.start_game_if_possible(callbackgame)) {
                callbackready();
            }
        }
    }
}

GameManager.prototype.start_game_if_possible = function (callback) {
    if (this.waiting.length > 1) {

        // just take first 2 for now
        var random01 = Math.floor(Math.random()*2);
        var white = this.waiting[random01];
        var black = this.waiting[1-random01];
        this.waiting.splice(0, 2);

        var game = new Game(white, black, 5 * 60 * 1000);
        white.game = game.game_accessor_for_player(true);
        black.game = game.game_accessor_for_player(false);

        callback(white, black);
        return true;
    }

    return false;
};

function fastRemove(arr, element) {
    return arr.filter(function (el) {
        return el !== element
    });
}

GameManager.prototype.remove_player = function (player) {
    this.waiting = fastRemove(this.waiting, player);
}

function Player(username, socket, callback) {
    this.username = username;
    this.socket = socket;

    var self = this;
    User.findOne({'local.username' : this.username}, function (err, user) {
        if (!err && user) {
            self.user = user;
        } else {
            console.log('err/user', err, user);
        }

        callback(user);
    });
};

Player.prototype.toString = function () {
    return this.username;
};

Player.prototype.hasTurn = function () {
    return this.game && this.game.currentTurn() === this;
};

Player.prototype.move = function (move, callback) {
    if (this.hasTurn()) {
        this.game.makeMove(move); // increments turn, set lastMove
        callback(this.game.opponent);
    } else {
        console.log("not your turn", this.username);
    }
}

Player.prototype.Q = function () {
    return Math.pow(10, (this.user.chess.elo / 4000));
};

Player.prototype.updateElos = function (opponent, result) {
    function Q (player) {
        return Math.pow(10, (player.user.chess.elo / 4000));
    };

    var K = 25;
    var change =  Math.round(K * (result - (Q(this) / (Q(this) + Q(opponent)))));

    this.user.chess.elo += change;
    opponent.user.chess.elo -= change;

    return change;
};

Player.prototype.updateStats = function () {
    // make this nicer?
    switch (this.game.resultClaim()) {
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
}

function Game(white, black, time) {
    this.turn = 0;

    this.white = {
        player: white,
        time: time,
        startTime: Date.now()
    }

    this.black = {
        player: black,
        time: time
    }
};

Game.prototype.game_accessor_for_player = function (white) {
    var myStats = white ? this.white : this.black;
    var oppStats = white ? this.black : this.white;

    var self = this;

    var game_accessor = {
        isWhite: white,
        opponent: oppStats.player,
        time: function () {
            return myStats.time;
        },
        oppTime: function () {
            return myStats.oppTime;
        },
        lastMove: function () {
            return myStats.lastMove;
        },
        oppLastMove: function () {
            return oppStats.lastMove
        },
        resultClaim: function () {
            return myStats.resultClaim
        },
        setResultClaim: function (claim) {
            myStats.resultClaim = claim;
        },
        currentTurn: function () {
            return self.turn % 2 ? self.black.player : self.white.player
        },
        makeMove: function (move) {
            var timeUsed = Date.now() - myStats.startTime;
            myStats.time -= timeUsed;

            if (myStats.time < 0) {
                //... return false?
            }

            console.log("time remaining", myStats.time, "used", timeUsed);
            oppStats.startTime = Date.now();
            myStats.lastMove = move;
            self.turn += 1;
        },
        check_for_agreement: function (callback, savecallback) { // TODO, ugly
            self.check_for_agreement(callback, savecallback);
        }
    }

    return game_accessor;
};

Game.prototype.check_for_agreement = function (callback, savecallback) {
    console.log('check for agreement');

    if (this.white.resultClaim !== undefined && this.black.resultClaim !== undefined) {
        var agreement = this.white.resultClaim + this.black.resultClaim === ResultEnum.WIN;

        var change = 0;

        if (agreement) {
            // TODO, clean all this up
            this.white.player.updateStats();
            this.black.player.updateStats();
            change = this.white.player.updateElos(this.black.player, this.white.resultClaim);

            var self = this;
            this.white.player.user.save(function (err) {
                if (err)
                    throw err;

                savecallback(self.white.player);
            });

            this.black.player.user.save(function (err) {
                if (err)
                    throw err;

                savecallback(self.black.player);
            });
        }

        callback(agreement, change); // 2 ties = win, loss = 0.
        this.white.player.game = undefined;
        this.black.player.game = undefined;
    }
};

Player.prototype.get_reconnection_info = function (callback) {
    var info = {
        username: this.username,
        stats: this.user.chess
    };

    info['waiting'] = gm.waiting.indexOf(this) !== -1;

    if (this.game) {
        // TODO, most of this information should be the same as the start game information
        info['white'] = this.game.isWhite;
        info['fen'] = this.game.lastMove() ? this.game.lastMove().fen : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; // TODO, eek
        info['opponent'] = this.game.opponent.username;

        if (this.hasTurn()) {
            info['move'] = this.game.oppLastMove(); // something is removing this by the time it reaches client if it undefined            
        }
    }

    console.log('info', info);
    callback(info);
}

exports.GameManager = gm;
exports.Player = Player;
exports.Game = Game;
