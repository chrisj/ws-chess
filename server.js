// compile sass
var fs = require('fs');
var sass = require('node-sass');
var sassstats = {};

sass.render({
    file: './public/css/omni.scss',
    success: function (css) {
        fs.writeFile('./public/omni.css', css, function (err) {
            if (err) {
                console.log(err)
            } else {
                console.log('SCSS saved');
            }
        })
        console.log(sassstats);
    },
    stats: sassstats
});




// http
var http       = require('http');
var url        = require("url");
var qs         = require('querystring');
var logger     = require('morgan')('dev');
var formidable = require('formidable');
var static     = require('node-static');

var port       = process.env.PORT || 8888;
var mongoose   = require('mongoose');

// database
mongoose.connect('mongodb://localhost:27017/nodeappdb');


function getTokenForUser (user) {
    return jwt.sign(user, jwt_secret, { expiresInMinutes: 60 });
}

var User = require('./app/models/user');

function login (req, res) {
    var form = new formidable.IncomingForm();

    form.parse(req, function (err, fields, files) {
        User.findOne({'local.username' : fields.username}, function (err, user) {
            res.writeHead(200, {"Content-Type": "application/json"});
            if (err || !user) {
                console.log('err', err);
                res.end(JSON.stringify({token: false}));
                // return 
            } else if (user.validPassword(fields.password)) {
                res.end(JSON.stringify({token: getTokenForUser(user)}));
            }
        });
    });
};

function signup (req, res) {
    parseLogin(response, request, function (err, user) {
        res.writeHead(200, {"Content-Type": "application/json"});
        if (err || user) {
            console.log('err', err);
            res.end(JSON.stringify({token: false}));
        } else {
            var newUser = new User();
            newUser.local.username = fields.username;
            newUser.local.password = newUser.generateHash(fields.password);

            newUser.save(function (err) {
                if (err)
                    throw err;
                res.end(JSON.stringify({token: getTokenForUser(newUser)}));
            });
        }
    });
};

var disableCache = true;
var fileServer = new static.Server('./public', !disableCache);

var handle = {
    // GET: {
    //     "/": index
    // },
    POST: {
        "/login": login,
        // "/signup": signup
    }
};

function route(handle, pathname, req, res) {
    logger(req, res, function () {        
        if (handle[req.method] && typeof handle[req.method][pathname] === 'function') {
            handle[req.method][pathname](req, res);
        } else {
            // probably move under "/static"
            fileServer.serve(req, res, function (err, result) {
                if (err) {
                    console.log("No request handler or file found for " + pathname);
                    res.writeHead(404, {"Content-Type": "text/plain"});
                    res.end();
                }
            });
        }
    });
}

var server = http.createServer(function (req, res) {
    var pathname = url.parse(req.url).pathname;
    route(handle, pathname, req, res);
});

server.listen(port, function () {
    console.log('The magic happens on port ' + port);
});


// sockets
var sio = require('socket.io')(server);
var socketio_jwt = require('socketio-jwt');
var jwt = require('jsonwebtoken');
var jwt_secret = 'foo bar big secret';

sio.use(socketio_jwt.authorize({
    secret: jwt_secret,
    handshake: true
}));




// usernames -> ChessPlayer
var clients = {};
var chess = require('./app/chess.js');


function initPlayer(player) {
    registerChessEventsForPlayer(player);
    player.get_reconnection_info(function (info) {
        player.socket.emit('reconnection_info', info);
    });
};

sio.sockets.on('connection', function (socket) {
    var username = socket.decoded_token.local.username;

    console.log('connection', username);
    if (clients[username]) {
        var player = clients[username];
        console.log('disconnecting old socket for', player.username);
        // player.socket.emit('newsocket'); // TODO, not used yet
        player.socket.disconnect();
        player.socket = socket;

        initPlayer(player);
    } else { // new client
        var player = new chess.Player(username, socket, function (user) {
            if (user) {
                initPlayer(player);
                sio.sockets.emit('clients', Object.keys(clients));
            } else {
                // TODO: how can this happen? We already logged in? (Disconnect and log it?)
            }
        });

        clients[username] = player; 
    }
});

function registerChessEventsForPlayer(player) {
    player.socket.on('disconnect', function () {
        // TODO we should wait a little while for a potential reconnect
        console.log(player.username, 'disconnected');

        // TODO, don't do this now because they could reconnect. Wait 30 seconds?
        // probably tell the opponent to wait for client.
        if (player.game) {
            player.game.opponent.socket.emit('opponentlostconnection');

            var playerStillNotBack = false;
            if (playerStillNotBack) {
                opponent.socket.emit('end', {agree: true, result: true});
                // remove from client
            }
        }
    });

    player.socket.on('reconnect', function () {
        player.get_reconnection_info(function (info) {
            player.socket.emit('reconnection_info', info);
        });
    });

    player.socket.on('ready', function () {
        console.log('ready', player.username);
        chess.GameManager.ready(player, function () { // callback for acknowledge ready, only called if we don't start game
            player.socket.emit('ready');
        },
        function (player) { // callback for starting game, called for each player
            console.log('sending start to ', player.username);
            player.socket.emit('start', {
                white: player.game.isWhite,
                opponent: player.game.opponent.username,
                time: player.game.time,
                stats: player.game.opponent.user.chess
            });
        });
    });

    player.socket.on('move', function (json) {
        console.log('move', player.username);
        player.move(json, function (opponent) { // only called if move succeeds
            console.log("sending move from " + player.username + " to " + opponent.username);
            json['time'] = opponent.game.time; // TODO, don't like this
            // console.log('time', opponent.game.time(), player.game.time());
            opponent.socket.emit('move', json); // TODO, better way to forward?
        });
    });

    player.socket.on('end', function (json) {
        console.log('end', player.username, json);
        player.game.resultClaim = json.result; // TODO, move and clean this

        player.game.check_for_agreement(function (agreement, change) {
            console.log("agreement", agreement);
            var opponent = player.game.opponent;
            player.socket.emit('end', {agree: agreement, result: player.game.resultClaim, elochange: change});
            opponent.socket.emit('end', {agree: agreement, result: opponent.game.resultClaim, elochange: -change});
        },
        function (player) { // save callback
            player.socket.emit('stats', player.user.chess);
        });
    });
};
