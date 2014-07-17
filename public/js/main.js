$(document).ready(function() {

    var ResultEnum = {
        LOSE: 0,
        TIE: 0.5,
        WIN: 1
    }

    var token = sessionStorage.getItem("chesstoken");
    var socket;

    var playerUsername;
    var whitePlayer;
    var foolsMate = true;

    var squareClass = '.square-55d63';
    var boardEl = $('#board');

    var cfg = {
      draggable: true,
      onDrop: onDrop,
      onSnapEnd: onSnapEnd,
      onDragStart: onDragStart,
      onMouseoutSquare: onMouseoutSquare,
      onMouseoverSquare: onMouseoverSquare
    };

    var board = new ChessBoard('board', cfg);
    var chess;

    function authenticate (url) {
        var form = $('#loginform');
        var usernameField = form.find('input[name="username"]');
        var passwordField = form.find('input[name="password"]');

        $.ajax({
            type: 'POST',
            data: {
                username: usernameField.val(),
                password: passwordField.val()
            },
            url: url
        }).done(function (result) {
            token = result.token;
            sessionStorage.setItem("chesstoken", token);
            console.log("got token! " + token);
            connectSocket();
        });

        usernameField.val('');
        passwordField.val('');
    };

    $('.joingame').click(function() { socket.emit('ready'); });

    $('#loginform').submit(function (e) {
        e.preventDefault();
        authenticate('/login');
        return false; // what does this do?
    });

    $('#signup').click(function (e) {
        e.preventDefault();
        authenticate('/signup')
        return false; // what does this do?
    });

    if (token) {
        connectSocket();
    } else {
        // show signup?
    }

    function handleStats(json) {
        json['username'] = playerUsername;

        $.get('templates/userInfo.mst', function (template) {
            var rendered = Mustache.render(template, json);
            $('#userInfo').html(rendered);
        });
    };

    function connectSocket () {
        socket = io.connect('?token=' + token, {
            'forceNew': true,
            'reconnection': false
        });

        socket.on('reconnection_info', handleReconnection);
        socket.on('stats', handleStats);
        socket.on('start', handleStart);
        socket.on('move', handleMove);
        socket.on('end', handleEnd);

        socket.on('ready', function () {
            $('.joingame').prop("disabled", true);
        });

        // socket.on('disconnect', function (data) {
        //     console.log('disconnected', data);
        // });

        // socket.on('newsocket'), function (data) {
        //     console.log('newsocket', data);
        // }

        // socket.on('clients', function (loc) {
        //     console.log('clients', loc);
        //     var cList = $('#clients');
        //     cList.empty();
        //     $.each(loc, function (client) {
        //         var li = $('<li/>')
        //             // .addClass('ui-menu-item')
        //             // .attr('role', 'menuitem')
        //             .text(this)
        //             .appendTo(cList);
        //     });
        // });
    };

    function handleReconnection (json) {
        playerUsername = json.username;

        if (json.white !== undefined) {
            // TODO, combine this with new game
            setColor(json.white);

            chess = new Chess(json.fen);
            board.position(chess.fen());

            if (json.move) {
                handleMove(json.move);
            }
        }

        handleStats(json.stats);
    }

    function handleMove(json) {
        if (json.time) {
            startClock(json.time);
        }

        var move = chess.move({
            from: json.from, // TODO, why does having aisdjfiasdf.from not throw an error here?
            to: json.to,
            promotion: 'q'
        });

        if (move !== null) {
            boardEl.find('.square-' + move.from).addClass('opp-highlight-' + (whitePlayer ? 'black' : 'white'));
            boardEl.find('.square-' + move.to).addClass('opp-highlight-' + (whitePlayer ? 'black' : 'white'));
            board.position(chess.fen());
        }

        // should this stuff be in null move?
        checkForEnd(true);

        if (foolsMate) {
            if (whitePlayer) {
                onDrop("g2", "g4");
            } else {
                onDrop("e7", "e5");
                onDrop("d8", "h4");
            }

            board.position(chess.fen());
        }
    };

    function handleStart (json) {
        setColor(json.white);
        board.position('start');
        chess = new Chess();
        startClock(json.time);


        $('.joingame').toggleClass('active', false);
        $.get('templates/start_game_modal.mst', function (template) {
            var rendered = Mustache.render(template, {
                opponent: json.opponent
            });
            $('#myModal').html(rendered);
            $('#myModal').modal('show');

            // TODO, this could be annoying to the player
        });

        // DEBUG
        if (foolsMate) {
            if (whitePlayer) {
                onDrop("f2", "f3");
            }
        }
    };

    function handleEnd (json) {
        $('.joingame').prop("disabled", false);

        $.get('templates/game_result_modal.mst', function (template) {

            var resultText = "You Lost";

            if (json.agree && json.result > 0) {
                resultText = "You Won";
            } else if (json.agree && json.tie) {
                resultText = "You Tied";
            }

            var rendered = Mustache.render(template, {
                resulttext: resultText
            });
            $('#myModal').html(rendered);

            $('.joingame').click(function() {
                socket.emit('ready'); // is this ok?
                $('#myModal').modal('hide');
            });

            $('#myModal').modal('show');
        });
    };

    function setColor(isWhite) {
        whitePlayer = isWhite;
        board.orientation(isWhite ? 'white' : 'black');
    };





    function startClock(time) {
        $('#clock').countdown(Date.now() + time).on('update.countdown', function(event) {
        var $this = $(this).html(event.strftime(''
            + '<span>%M</span> min '
            + '<span>%S</span> sec'));
        });
    };







    function onDragStart(source, piece, position, orientation) {
        var whitePiece = piece.search(/^b/) === -1;
        if (chess.game_over() || (whitePiece !== whitePlayer) === true) {
            return false;
        }
    };

    function checkForEnd(yourTurn) {
        if (chess.game_over()) {
            console.log("game over");
            var result;
            if (chess.in_stalemate()) {
                result = ResultEnum.TIE;
                console.log("game over stalemate");
            } else {
                result = (chess.in_checkmate() && !yourTurn) ? 1 : 0;
                console.log("game over you ", (chess.in_checkmate() && !yourTurn) ? "won" : "lost");
            }

            socket.emit('end', { result: result });
        }
    };

    function onDrop(source, target) {
        removeGreySquares();

        var move = chess.move({
            from: source,
            to: target,
            promotion: 'q'
        });

        if (move === null) return 'snapback';
        socket.emit('move', {from : source, to: target, fen: chess.fen()});
        $('#clock').countdown('stop');
        checkForEnd(false);
    };

    function onSnapEnd() { // does en passant, promotion, ...
        board.position(chess.fen());
        boardEl.find(squareClass).removeClass('opp-highlight-' + (whitePlayer ? 'black' : 'white'));
    };






    // help for beginners
    var removeGreySquares = function() {
      $('#board .square-55d63').css('background', '');
    };

    var greySquare = function(square) {
        var squareEl = $('#board .square-' + square);
      
        var background = '#a9a9a9';
        if (squareEl.hasClass('black-3c85d') === true) {
            background = '#696969';
        }

        squareEl.css('background', background);
    };

    function onMouseoverSquare(square, piece) {
        if (!chess) {
            return;
        }

      // get list of possible moves for this square
      var moves = chess.moves({
        square: square,
        verbose: true
      });

      // exit if there are no moves available for this square
      if (moves.length === 0) return;

      // highlight the square they moused over
      greySquare(square);

      // highlight the possible squares for this piece
      for (var i = 0; i < moves.length; i++) {
        greySquare(moves[i].to);
      }
    };

    function onMouseoutSquare(square, piece) {
        removeGreySquares();
    };
});
