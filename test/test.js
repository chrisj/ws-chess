var assert = require('assert');
var superagent = require('superagent');

var baseURL = 'http://127.0.0.1:8888';
var io = require('socket.io-client');

var GameModeEnum = {
    STANDARD: 0,
    CHESSATTACK: 1
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

    socket.on('connect', function () {
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


describe('Server', function () {
	describe('login', function () {
		it('should successfully login and return a valid token', function (done) {
			login('test', 'asdf', function (token) {
				// console.log(token);
				done();
			});
		});
	});

	describe('get socket', function () {
		var token;

		before(function (done) {
			console.log('beforeEach called');
			login('test', 'asdf', function (t) {
				token = t;
				done();
			});
		});

		// it('should establish a websocket connection and get reconnection info', function (done) {



		describe('use socket', function () {
			var p1Socket;
			var p2Socket;

			beforeEach(function (done) {
				loginAndEstablishSocket('test', 'asdf', function (s1) {
					p1Socket = s1;
					loginAndEstablishSocket('chris', 'asdf', function (s2) {
						p2Socket = s2;
						done();
					});
				});
			});

			afterEach(function (done) {
				// even though we logout, the connection stays up so the disconnect event isn't
				// fired until after all the tests finish.
				p1Socket.emit('logout', function (data) {
					console.log('p1Socket logged out', data);
					p2Socket.emit('logout', function (data) {
						console.log('p2Socket logged out', data);
						done();
					});
				});
			});

			it('should send reconnection_info', function (done) {
				// testing p2 since we already missed p1's reconnection
				p2Socket.on('reconnection_info', function (json) {
		    		console.log('got reconnection_info!', json);
		    		assert.equal(json.username, 'chris');
		    		assert.equal(json.waiting, false);
					done();
				});
			});

			it('should allow us to ready up and start a game', function (done) {
				p1Socket.emit('ready', { mode: GameModeEnum.STANDARD }, function (data) {
					console.log('ready!', data);

					p2Socket.emit('ready', { mode: GameModeEnum.STANDARD }, function (data) {
						// will not be called
					});

					p2Socket.on('start', function (json) {
						console.log('we are starting!');
						assert(typeof(json.white) === 'boolean', 'white should be a bool');
						assert.equal(json.mode, GameModeEnum.STANDARD);
						assert.equal(json.time, 5 * 60 * 1000);
						done();
					});

					// todo, we should wait for both start messages so we can ensure that they have opposing white, etc
		        });
			});
		});
	});
});
