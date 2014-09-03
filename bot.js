var superagent = require('superagent');

var LOCALHOST = 'http://127.0.0.1:8888';
var io = require('socket.io-client');

var async = require('async');

var ch = require('./public/libs/chessjs/chess');

var GameModeEnum = {
    STANDARD: 0,
    CHESSATTACK: 1
};

var ResultEnum = {
    LOSE: 0,
    TIE: 0.5,
    WIN: 1
};

function login (baseURL, user, pass, callback) {
    superagent.post(baseURL + '/login')
    .send({username:user, password:pass})
    .end(function (res) {
        callback(res.body.token)
    });
};

function establishSocket (baseURL, token, callback) {
    socket = io.connect(baseURL + '?token=' + token, {
        'forceNew': true,
        'reconnection': false
    });

    socket.on('error', function (data) {
        console.log('connection failed', data);
        callback();
    });

    socket.once('connect', function () {
        callback(socket);
    });
};

function loginAndEstablishSocket (baseURL, user, pass, callback) {
    login(baseURL, user, pass, function (token) {
        establishSocket(baseURL, token, function (socket) {
            callback(socket);
        });
    });
};

var chess;

function loginAndJoinGame(user, pass, baseURL) {
    baseURL = typeof baseURL !== 'undefined' ? baseURL : LOCALHOST;

    loginAndEstablishSocket(baseURL, user, pass, function (socket) {
        var whitePlayer;

        function whitesTurn() {
            return chess.turn() === 'w';
        }

        function myTurn() {
            return whitesTurn() === whitePlayer;
        };

        function checkForEnd() {
            if (chess.game_over()) {
                console.log("game over");
                var result;
                if (chess.in_draw()) {
                    result = ResultEnum.TIE;
                    console.log("game over, draw");
                } else {
                    result = (chess.in_checkmate() && !myTurn()) ? ResultEnum.WIN : ResultEnum.LOSE;
                    console.log("game over, you", (chess.in_checkmate() && !myTurn()) ? "won" : "lost");
                }

                socket.emit('end', { result: result });
            }
        };



        socket.emit('ready', { mode: GameModeEnum.STANDARD }, function (data) {
            console.log('readied'); 
        });

        socket.once('start', function (json) {
            chess = new ch.Chess(json.fen, { mode: json.mode === GameModeEnum.CHESSATTACK ? 'chessattack' : null });

            whitePlayer = json.white;

            function makeMove() {
                var move = chess.best_move(4);
                socket.emit('move', { san: move, fen: chess.fen() }, function (data) {
                    chess.move(move);
                });
            };

            console.log('game started');
            if (json.white) {
                console.log('we are white!');
                makeMove();
            }

            socket.once('end', function (json) {
                console.log('agreement', json.agreement);
            });

            socket.on('move', function (json) {
                console.log('got move!');
                chess.move(json.san);

                if (!chess.game_over()) {
                    makeMove();
                }
                
                checkForEnd();
            });
        });
    });
};

exports.loginAndJoinGame = loginAndJoinGame
