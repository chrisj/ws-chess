exports.READY = {
    type: 'object',
    properties: {
        mode: {enum: [0, 1]} // todo, only allow enum values
    }
};

// todo, we should be more precise about this since we send it to the opponent
exports.MOVE = {
    type: 'object',
    properties: {
        san: {type: "string", required: true},
        fen: {type: "string", required: true}
    }
};

exports.END = {
    type: 'object',
    properties: {
        result: {type: "number", required: true} // todo, only allow enum values
    }
};
