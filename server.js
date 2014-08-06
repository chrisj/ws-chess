// compile sass
var fs = require('fs');
var sass = require('node-sass');
var sassstats = {};

sass.render({
    file: __dirname + '/public/css/main.scss',
    success: function (css) {
        fs.writeFile(__dirname + '/public/main.css', css, function (err) {
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

// preload template
var listTemplate = fs.readFileSync(__dirname + '/views/list.mst', {encoding: 'utf8'});


///////////////////////////////////////////////////////////////////////////////

var DISABLEFILECACHE = true;


// http
var port       = process.env.PORT || 8888;
var http       = require('http');
var url        = require('url');
var nodestatic = require('node-static');
var formidable = require('formidable');

var logger     = require('morgan')('dev');
var mustache   = require('mustache');

// database
var mongoose   = require('mongoose');
var dbOpenTime = Date.now();
mongoose.connection.once('open', function () {
    console.log('database is open', Date.now() - dbOpenTime);
});
mongoose.connect('mongodb://localhost:27017/nodeappdb');


function isFunction(x) {
    return typeof(x) === 'function';
};

function getTokenForUser(user) {
    return jwt.sign({ username: user.local.username }, jwt_secret, { expiresInMinutes: 60 });
}

var User = require('./app/models/user');

function login(req, res) {
    var form = new formidable.IncomingForm();

    form.parse(req, function (err, fields, files) {
        User.findOne({'local.username' : fields.username}, function (err, user) {
            res.writeHead(200, {"Content-Type": "application/json"});
            if (err || !user || !user.validPassword(fields.password)) {
                console.log('err', err);
                res.end(JSON.stringify({token: false}));
                // return 
            } else {
                res.end(JSON.stringify({token: getTokenForUser(user)}));
            }
        });
    });
};

function signup(req, res) {
    var form = new formidable.IncomingForm();

    form.parse(req, function (err, fields, files) {
        User.findOne({'local.username' : fields.username}, function (err, user) {
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
    });
};

function list(req, res) {
    console.log('list the users');
    // todo, users who have played very few games should be ranked at the bottom
    // double sort?
    // or we store the rank on the user
    User.find().sort('-chess.elo').exec(function (err, users) {
        var rendered = mustache.render(listTemplate, {'users': users });
        res.end(rendered);
    });
};

var fileServer = new nodestatic.Server(__dirname + "/public", { cache: !DISABLEFILECACHE });

var handle = {
    GET: {
        "/list": list
    },
    POST: {
        "/login": login,
        "/signup": signup
    }
};

function route(handle, pathname, req, res) {
    logger(req, res, function () {        
        if (handle[req.method] && isFunction(handle[req.method][pathname])) {
            handle[req.method][pathname](req, res);
        } else {
            // probably move under "/static"
            fileServer.serve(req, res, function (err, result) {
                if (err) {
                    console.log("No request handler or file found for " + pathname, err);
                    res.writeHead(404, {"Content-Type": "text/plain"});
                    res.end();
                }
            });
        }
    });
};

var server = http.createServer(function (req, res) {
    var pathname = url.parse(req.url).pathname;
    route(handle, pathname, req, res);
});

server.listen(port, function () {
    console.log('The magic happens on port ' + port);
});


///////////////////////////////////////////////////////////////////////////////


// sockets
var sio = require('socket.io')(server);
var socketio_jwt = require('socketio-jwt');
var jwt = require('jsonwebtoken');
var jwt_secret = 'CHANGETHIS';

sio.use(socketio_jwt.authorize({
    secret: jwt_secret,
    handshake: true
}));


var validate = require('jsonschema').validate;
var messageschema = require('./app/messageschema.js');


// usernames -> ChessPlayer
var clients = {};
var chess = require('./app/chess.js');


function initPlayer(player) {
    registerChessEventsForPlayer(player);
    player.getReconnectionInfo(function (info) {
        player.socket.emit('reconnection_info', info);
    });
    sio.sockets.emit('clients', Object.keys(clients));
};

sio.sockets.on('connection', function (socket) {
    var username = socket.decoded_token.username;

    console.log('connection', username, socket.id);
    if (clients[username]) {
        var player = clients[username];

        if (player.timeout) {
            console.log(player.username, 'made it back in time');
            clearTimeout(player.timeout);
        }

        console.log('disconnecting old socket for', player.username);
        player.socket.emit('newsocket');
        player.socket.removeAllListeners();
        player.socket.disconnect();
        player.socket = socket;

        initPlayer(player);
    } else { // new client
        var player = new chess.Player(username, socket, function () {
            initPlayer(player);
        });

        clients[username] = player; 
    }
});

function logout(player) {
    console.log('logout', player.username);

    if (!clients[player.username]) { // since we call logout in a timeout
        console.log('already logged out (disconnect timeout)');
        return;
    }

    chess.GameManager.removePlayer(player);
    delete clients[player.username];

    if (player.game) {
        player.game.forfeit(function (agreement, change) {
            var opponent = player.game.oppPersp.player;
            opponent.socket.emit('end', {agree: true, result: opponent.game.myPersp.resultClaim, elochange: -change});
        },
        function (player) { // save callback
            player.socket.emit('stats', player.user.chess);
        });
    }
};

function registerChessEventsForPlayer(player) {
    player.socket.on('disconnect', function () {
        console.log('disconnect', player.username, player.socket.id);

        if (clients[player.username]) { // if we haven't already logged out
            player.timeout = setTimeout(function () { logout(player); }, 10 * 1000);
        }
    });

    player.socket.on('logout', function (callback) {
        logout(player);
        if (isFunction(callback)) {
            callback('ok');
        }
    });

    player.socket.on('reconnect', function () {
        console.log('reconnect', player.username);
        player.getReconnectionInfo(function (info) {
            player.socket.emit('reconnection_info', info);
        });
    });

    player.socket.on('ready', function (json, callback) {
        var vr = validate(json, messageschema.READY);
        if (!vr.valid) {
            console.log('invalid ready', vr.errors);
            return;
        }

        console.log('ready', player.username, json);
        chess.GameManager.ready(player, json, function () { // callback for acknowledge ready, only called if we don't start game
            console.log('callback');
            if (isFunction(callback)) { // is this completely safe?
                callback();
            }
        },
        function (player, startInfo) { // callback for starting game, called for each player
            console.log('sending start to ', player.username);
            player.socket.emit('start', startInfo);
        });
    });

    player.socket.on('cancel', function (callback) {
        console.log('cancel', player.username);
        chess.GameManager.removePlayer(player);
        if (isFunction(callback)) {
            callback();
        }
    });

    player.socket.on('move', function (json, callback) {
        var vr = validate(json, messageschema.MOVE);
        if (!vr.valid) {
            console.log('invalid move', vr.errors);
            return;
        }

        console.log('move', player.username);
        player.move(json, function (opponent) { // only called if move succeeds
            var timeRemaining = player.game.myPersp.time;
            console.log("sending move from " + player.username + " to " + opponent.username);
            json['oppTime'] = timeRemaining; // TODO, don't like this
            opponent.socket.emit('move', json);
            if (isFunction(callback)) {
                callback({ time: timeRemaining });
            }
        });
    });

    player.socket.on('end', function (json) {
        var vr = validate(json, messageschema.END);
        if (!vr.valid) {
            console.log('invalid end', vr.errors);
            return;
        }

        console.log('end', player.username, player.game.myPersp.isWhite, json);
        player.game.myPersp.resultClaim = json.result; // TODO, move and clean this

        // TODO, what if the opponent never responds? send message to opponent to let them know their opponenet thinks the game is over 
        // player.game.oppPersp.player.socket.emit('oppEnd');

        player.game.endGameIfAgreement(function (agreement, change) {
            console.log("agreement", agreement);
            var opponent = player.game.oppPersp.player;
            player.socket.emit('end', {agree: agreement, result: player.game.myPersp.resultClaim, elochange: change});
            opponent.socket.emit('end', {agree: agreement, result: opponent.game.myPersp.resultClaim, elochange: -change});
        },
        function (player) { // save callback
            player.socket.emit('stats', player.user.chess);
        });
    });

    player.socket.on('outoftime', function () {
        console.log('outoftime', player.username);
        if (player.game) {
            console.log('oppTime', player.game.oppPersp.currentTime());
            if (player.game.oppPersp.currentTime() < 0) {
                var opponent = player.game.oppPersp.player;
                // todo, combine forfeit code
                opponent.game.forfeit(function (agreement, change) {
                    opponent.socket.emit('end', {agree: true, result: opponent.game.myPersp.resultClaim, elochange: change});
                    player.socket.emit('end', {agree: true, result: player.game.myPersp.resultClaim, elochange: -change});
                },
                function (player) { // save callback
                    player.socket.emit('stats', player.user.chess);
                });
            }
        }
    })
};
