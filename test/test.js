var assert = require('assert');
var superagent = require('superagent');

var baseURL = 'http://127.0.0.1:8888';
var io = require('socket.io-client');

var async = require('async');

var GameModeEnum = {
    STANDARD: 0,
    CHESSATTACK: 1
}

var ResultEnum = {
    LOSE: 0,
    TIE: 0.5,
    WIN: 1
}

function login (user, pass, callback) {
	superagent.post(baseURL + '/login')
	.send({username:user, password:pass})
	.end(function (res) {
		callback(res.body.token)
	});
};

function establishSocket (token, callback) {
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

function loginAndEstablishSocket (user, pass, callback) {
	login(user, pass, function (token) {
		establishSocket(token, function (socket) {
			callback(socket);
		});
	});
};

function readyTwoPlayers(p1Socket, p2Socket, mode, callback) {
	p1Socket.emit('ready', { mode: mode }, function (data) {
		p2Socket.emit('ready', { mode: GameModeEnum.STANDARD }, function (data) {
			// will not be called
		});

		async.parallel([
			function (callback) {
				p1Socket.once('start', function (json) {
					console.log('got results from p1');
					callback(null, json);
				});
			},
			function (callback) {
				p2Socket.once('start', function (json) {
					console.log('got results from p2');
					callback(null, json);
				});
			}
		],
		function (err, results) {
			console.log('got results from both');

			var json1 = results[0];
			var json2 = results[1];	

			assert(typeof(json1.white) === 'boolean', 'white should be a bool');
			assert.equal(json1.mode, GameModeEnum.STANDARD);
			// assert.equal(json1.clock.white, json1.clock.black);

			assert(json1.white !== json2.white, 'both players cannot be white');

			var whiteSocket = json1.white ? p1Socket : p2Socket;
			var blackSocket = json1.white ? p2Socket : p1Socket;
			callback(whiteSocket, blackSocket);
		});
	});
};

function playMoves(activePlayer, inactivePlayer, listofmoves, done) {
	if (listofmoves.length === 0) {
		done();
	} else {
		var move = listofmoves[0];
		activePlayer.emit('move', move);

		inactivePlayer.once('move', function (json) {
			console.log('got move');
			assert.equal(json.from, move.from);
			assert.equal(json.to, move.to);
			assert.equal(json.fen, move.fen);

			playMoves(inactivePlayer, activePlayer, listofmoves.slice(1), done);
		});
	}
};


describe('Server', function () {
	describe('login', function () {
		it('should successfully login and return a valid token', function (done) {
			login('test', 'asdf', function (token) {
				// console.log(token);
				done();
			});
		});
	});

	describe('using sockets', function () {
		var p1Socket;
		var p2Socket;

		beforeEach(function (done) {
			loginAndEstablishSocket('test', 'asdf', function (s1) {
				p1Socket = s1;
				p1Socket.once('reconnection_info', function (json) {
					assert.equal(json.waiting, false);
					console.log('got stats p1');
					p1Socket.wscdebug = {}; // ugly but make it easy when dealing with white and black sockets
					p1Socket.wscdebug.stats = json.stats;
				});

				loginAndEstablishSocket('chris', 'asdf', function (s2) {
					p2Socket = s2;
					p2Socket.once('reconnection_info', function (json) {
						console.log('got stats p2');
						p2Socket.wscdebug = {};
						p2Socket.wscdebug.stats = json.stats;
						done();
					});
				});
			});
		});

		afterEach(function (done) {
			// even though we logout, the connection stays up so the disconnect event isn't
			// fired until after all the tests finish.

			async.parallel([
				function (callback) {
					if (p1Socket.disconnected) {
						callback(null, null);
					} else {
						p1Socket.emit('logout', function (data) {
							callback(null, null);
						});
					}
				},
				function (callback) {
					if (p2Socket.disconnected) {
						callback(null, null);
					} else {
						p2Socket.emit('logout', function (data) {
							callback(null, null);
						});
					}
				}
			],
			function (err, results) {
				done();
			});
		});

		it('should allow us to ready up and play a game that ends in an agreement', function (done) {
			readyTwoPlayers(p1Socket, p2Socket, GameModeEnum.STANDARD, function (whiteSocket, blackSocket) {
				var move1 = { from: 'f2', to: 'f3', fen: 'rnbqkbnr/pppppppp/8/8/8/5P2/PPPPP1PP/RNBQKBNR b KQkq - 0 1'};
				var move2 = { from: 'e7', to: 'e5', fen: 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2'};
				var move3 = { from: 'e7', to: 'e99', fen: ''};

				var moves = [move1, move2, move3];

				playMoves(whiteSocket, blackSocket, moves, function () {

					whiteSocket.emit('end', {result: ResultEnum.LOSE});
					blackSocket.emit('end', {result: ResultEnum.WIN});

					async.parallel([
						function (callback) {
							whiteSocket.once('end', function (json) {
								assert.ok(json.agree, 'players sent opposite results so they should agree');
								assert.equal(json.result, ResultEnum.LOSE);
								callback(null, null);
								console.log('finished', 1);
							});
						},
						function (callback) {
							blackSocket.once('end', function (json) {
								assert.ok(json.agree, 'players sent opposite results so they should agree');
								assert.equal(json.result, ResultEnum.WIN);
								callback(null, null);
								console.log('finished', 2);
							});
						},
						function (callback) {
							whiteSocket.once('stats', function (json) {
								assert.equal(json.wins, whiteSocket.wscdebug.stats.wins, 'player lost so wins should stay the same');
								assert.equal(json.ties, whiteSocket.wscdebug.stats.ties, 'player lost so ties should stay the same');
								assert.equal(json.losses, whiteSocket.wscdebug.stats.losses + 1, 'player lost so losses should increase');
								callback(null, null);
								console.log('finished', 3);
							});
						},
						function (callback) {
							blackSocket.once('stats', function (json) {
								assert.equal(json.wins, blackSocket.wscdebug.stats.wins + 1, 'player won so wins should increase');
								assert.equal(json.ties, blackSocket.wscdebug.stats.ties, 'player won so ties should stay the same');
								assert.equal(json.losses, blackSocket.wscdebug.stats.losses, 'player won so losses should stay the same');
								callback(null, null);
								console.log('finished', 4);
							});
						}
					],
					function (err, results) {
						done();
					});
				});
	        });
		});

		it('should give the opposing player a win when a player disconnects without reconnecting within 10 seconds', function (done) {
			this.timeout(12000); // TODO, for debug, we should configure the server to drop clients more quickly (but it is good to leave the  server in its default state)

			readyTwoPlayers(p1Socket, p2Socket, GameModeEnum.STANDARD, function (whiteSocket, blackSocket) {
				blackSocket.disconnect();
				whiteSocket.once('end', function (json) {
					assert.equal(json.result, ResultEnum.WIN, 'player disconnecting should cause the other player to win');
				});

				whiteSocket.once('stats', function (json) {
					console.log('wins', json.wins, whiteSocket.wscdebug.stats.wins);
					assert.equal(json.wins, whiteSocket.wscdebug.stats.wins + 1, 'wins count should increment by one');
					done();
				});
			});
		});
	});
});
