var User = require('./models/user');

var ResultEnum = {
    LOSE: 0,
    TIE: 0.5,
    WIN: 1
}

function GameManager() {
    this.waiting = []
}

GameManager.prototype.ready = function (player) {
    if (!player.game) {
        if (this.waiting.indexOf(player) === -1) {
            this.waiting.push(player);
            this.start_game_if_possible();
        }
        console.log('ready', this.waiting);
        // inform them even if they are already waiting
        // TODO, move to callback
        player.socket.emit('ready');
    }
}

GameManager.prototype.start_game_if_possible = function () {
    console.log('waiting', this.waiting);
    if (this.waiting.length > 1) {
        // just take first 2 for now
        var random01 = Math.floor(Math.random()*2);
        var white = this.waiting[random01];
        var black = this.waiting[1-random01];
        this.waiting.splice(0, 2);

        white.game = black.game = new Game(white, black);

        // TODO, I want to move this to callbacks (don't want to send sockets outside of server)
        white.socket.emit('start', { white: true});
        black.socket.emit('start', { white: false});
    }
};

function fastRemove(arr, element) {
    return arr.filter(function (el) {
        return el !== element
    });
}

GameManager.prototype.remove_player = function (player) {
    this.waiting = fastRemove(this.waiting, player);
}

function Player(socket, callback) {
    this.username = socket.decoded_token.local.username;
    this.socket = socket;

    var self = this;
    User.findOne({'local.username' : this.username}, function (err, user) {
        console.log('err/user', err, user);
        if (!err && user) {
            console.log('got user');
            self.user = user;
            console.log('this.user', user);
        }

        callback(user);
    });
};

Player.prototype.toString = function () {
    return this.username;
};

Player.prototype.getOpponent = function () {
    if (this.game) {
        return this.game.white === this ? this.game.black : this.game.white;
    }
};

Player.prototype.hasTurn = function () {
    return this.game && this.game.currentTurn() === this;
};

Player.prototype.move = function (callback) {
    var opponent = this.getOpponent();
    if (opponent && this.hasTurn()) {
        this.game.turn += 1;
        callback(opponent);
    } else {
        console.log("not your turn", player.username);
    }
}

Player.prototype.Q = function () {
    return Math.pow(10, (this.user.chess.elo / 4000));
};

Player.prototype.updateElos = function (opponent, result) {
    var K = 25;
    var change =  Math.round(K * (result - (this.Q() / (this.Q() + opponent.Q()))));

    this.user.chess.elo += change;
    opponent.user.chess.elo -= change;
};

Player.prototype.updateStats = function () {
    // make this nicer?
    switch (this.resultClaim) {
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

function Game(white, black) {
    this.white = white;
    this.black = black;
    this.turn = 0;

    this.whiteLastFen;
    this.whiteLastMove;

    this.blackLastFen;
    this.blackLastMove;
};

Game.prototype.currentTurn = function () {
    return this.turn % 2 ? this.black : this.white;
};

Game.prototype.cleanUp = function () {
    this.white.resultClaim = this.black.resultClaim = undefined;
    this.white.game = this.black.game = null;
};

Game.prototype.check_for_agreement = function (callback) {
    if (this.white.resultClaim !== undefined && this.black.resultClaim !== undefined) {
        var agreement = this.white.resultClaim + this.black.resultClaim === ResultEnum.WIN;

        if (agreement) {
            this.white.updateStats();
            this.black.updateStats();
            this.white.updateElos(this.black, this.white.resultClaim);

            var self = this;
            this.white.user.save(function (err) {
                if (err)
                    throw err;

                // TODO, move out of chess.js
                self.white.socket.emit('stats', self.white.user.chess);
                console.log("save success player");
            });

            this.black.user.save(function (err) {
                if (err)
                    throw err;

                // TODO, move out of chess.js
                self.black.socket.emit('stats', self.black.user.chess);
                console.log("save success opponent");
            });
        }

        callback(agreement); // 2 ties = win, loss = 0.
        this.cleanUp(); // is this safe here?
    }
};

Player.prototype.get_reconnection_info = function (callback) {
    var info = {
        username: this.username,
        stats: this.user.chess
    };

    if (this.game) {
        info['white'] = this === this.game.white;
        info['fen'] = this.lastMove ? this.lastMove.fen : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; // TODO, eek

        if (this.hasTurn()) {
            info['move'] = this.getOpponent().lastMove;            
        }
    }

    callback(info);
}

exports.GameManager = new GameManager();
exports.Player = Player;
exports.Game = Game;
