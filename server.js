// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { customAlphabet } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 4);

// Configuration
const MAX_GAMES = 100;
const MAX_PLAYERS_PER_GAME = 100;

const HOST = "0.0.0.0";
const PORT = process.env.PORT || 3000;

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 10 * 1000; // 10 seconds
const RATE_LIMIT_MAX = 30; // max events per window per IP

// Serve static files from 'public' directory
app.use(express.static('public'));

const games = new Map(); // gameId -> state

function shuffle(arr) {
  return arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]);
}

// Create initial game state from payload
function createGameState(hostSocketId, payload) {
  const gameId = nanoid();
  const defaultTime = Math.max(5, Math.min(90, payload.defaultTimeLimitSeconds || 20));
  const shuffledQuestions = shuffle(payload.questions).map((q, idx) => ({
    ...q,
    index: idx,
    timeLimitSeconds: Math.max(5, Math.min(90, q.timeLimitSeconds || defaultTime))
  }));

  return {
    id: gameId,
    hostSocketId,
    title: payload.title || 'Quiz',
    questions: shuffledQuestions,
    players: new Map(), // socketId -> {name, score, answeredAtMs, selectedOptionId, lastCorrect}
    started: false,
    currentIndex: -1,
    round: null // {startMs, endMs, timer, awaiting: Set(socketId)}
  };
}

// Get public leaderboard (name and score only, sorted)
function getPublicLeaderboard(state) {
  const entries = Array.from(state.players.values())
    .map(p => ({ name: p.name, score: p.score, lastCorrect: !!p.lastCorrect }))
    .sort((a, b) => b.score - a.score);
  return entries;
}

// Broadcast lobby state to all in room
function broadcastLobby(state) {
  const players = Array.from(state.players.values()).map(p => p.name);
  io.to(state.id).emit('lobby:update', { players, gameId: state.id, title: state.title });
}

// Start the next question round
function startQuestion(state) {
  state.currentIndex++;
  if (state.currentIndex >= state.questions.length) {
    endGame(state);
    return;
  }
  const q = state.questions[state.currentIndex];
  const startMs = Date.now();
  const endMs = startMs + q.timeLimitSeconds * 1000;

  // reset per-round
  for (const p of state.players.values()) {
    p.answeredAtMs = null;
    p.selectedOptionId = null;
    p.lastCorrect = false;
  }

  state.round = {
    startMs, endMs,
    timer: setTimeout(() => endRound(state), q.timeLimitSeconds * 1000),
    awaiting: new Set([...state.players.keys()])
  };

  // Send question payload (do not include correct answers)
  const safeQ = {
    id: q.id,
    index: state.currentIndex,
    total: state.questions.length,
    text: q.text,
    imageUrl: q.imageUrl || null,
    timeLimitSeconds: q.timeLimitSeconds,
    options: q.options // {id,label,shape,color}
  };

  io.to(state.id).emit('question:show', safeQ);
}

// If all players have answered, end round early
function maybeEndEarly(state) {
  if (!state.round) return;
  if (state.round.awaiting.size === 0) {
    clearTimeout(state.round.timer);
    endRound(state);
  }
}

// End the current round, calculate scores, and reveal answers
function endRound(state) {
  if (!state.round) return;
  const q = state.questions[state.currentIndex];
  const { startMs, endMs } = state.round;
  state.round.timer && clearTimeout(state.round.timer);

  // Score
  for (const p of state.players.values()) {
    const answered = p.selectedOptionId != null;
    const correct = answered && q.correctOptionIds.includes(p.selectedOptionId);
    p.lastCorrect = correct;
    if (correct && p.answeredAtMs) {
      const timeLimit = q.timeLimitSeconds * 1000;
      const timeRemaining = Math.max(0, endMs - p.answeredAtMs);
      const points = Math.floor(500 + 500 * (timeRemaining / timeLimit));
      p.score += points;
    }
  }

  const leaderboard = getPublicLeaderboard(state);

  // Reveal to all
  io.to(state.id).emit('question:reveal', {
    correctOptionIds: q.correctOptionIds,
    index: state.currentIndex,
    total: state.questions.length,
    leaderboard
  });

  state.round = null;

  // Host prompt to continue
  io.to(state.hostSocketId).emit('host:canAdvance', { canAdvance: true });
}

// End the game and show final leaderboard
function endGame(state) {
  const leaderboard = getPublicLeaderboard(state);
  io.to(state.id).emit('game:over', { leaderboard });
  games.delete(state.id);
}

// Simple rate limiting per IP
function rateLimit(socket, eventName) {
  const ip = socket.handshake.address;
  const now = Date.now();
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }
  const arr = rateLimitMap.get(ip);
  // Remove old timestamps
  while (arr.length && arr[0] < now - RATE_LIMIT_WINDOW_MS) arr.shift();
  arr.push(now);
  if (arr.length > RATE_LIMIT_MAX) {
    // Optionally log or ban
    return false;
  }
  return true;
}

// Validate quiz JSON payload
function validateQuizPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (!Array.isArray(payload.questions) || payload.questions.length === 0) return false;
  if (typeof payload.title !== 'string' || !payload.title.trim()) return false;
  for (const q of payload.questions) {
    if (!q || typeof q !== 'object') return false;
    if (typeof q.id !== 'string' || !q.id.trim()) return false;
    if (typeof q.text !== 'string' || !q.text.trim()) return false;
    if (!Array.isArray(q.options) || q.options.length < 2) return false;
    for (const opt of q.options) {
      if (!opt || typeof opt !== 'object') return false;
      if (typeof opt.id !== 'string' || !opt.id.trim()) return false;
      if (typeof opt.label !== 'string' || !opt.label.trim()) return false;
    }
    if (!Array.isArray(q.correctOptionIds) || q.correctOptionIds.length === 0) return false;
    for (const cid of q.correctOptionIds) {
      if (typeof cid !== 'string' || !cid.trim()) return false;
    }
  }
  return true;
}

// Sanitize player name input
function sanitizeName(name) {
  // Remove HTML tags and limit to 20 chars, allow only basic printable chars
  return String(name)
    .replace(/<[^>]*>/g, '')
    .replace(/[^\w\s\-'.!]/g, '')
    .slice(0, 20)
    .trim();
}

// Handle socket connections
io.on('connection', (socket) => {
  // Rate limit all socket events
  const wrapRateLimit = (handler, eventName) => (...args) => {
    if (!rateLimit(socket, eventName)) {
      // Optionally disconnect or notify
      if (typeof args[args.length - 1] === 'function') {
        args[args.length - 1]({ ok: false, error: 'Rate limit exceeded' });
      }
      return;
    }
    handler(...args);
  };

  // Host creates a new game from JSON
  socket.on('host:createGame', wrapRateLimit((payload, ack) => {
    // Limit number of games
    if (games.size >= MAX_GAMES) {
      ack && ack({ ok: false, error: 'Too many games running. Try again later.' });
      return;
    }
    // Validate JSON
    if (!validateQuizPayload(payload)) {
      ack && ack({ ok: false, error: 'Invalid quiz JSON format.' });
      return;
    }
    try {
      const state = createGameState(socket.id, payload);
      games.set(state.id, state);
      socket.join(state.id);
      ack && ack({ ok: true, gameId: state.id });
      broadcastLobby(state);
    } catch (e) {
      ack && ack({ ok: false, error: 'Invalid JSON format' });
    }
  }, 'host:createGame'));

  // Host starts the game
  socket.on('host:startGame', wrapRateLimit(({ gameId }) => {
    const state = games.get(gameId);
    if (!state || state.hostSocketId !== socket.id || state.started) return;
    state.started = true;
    io.to(state.id).emit('game:started', { title: state.title });
    startQuestion(state);
  }, 'host:startGame'));

  // Host advances to next question
  socket.on('host:next', wrapRateLimit(({ gameId }) => {
    const state = games.get(gameId);
    if (!state || state.hostSocketId !== socket.id) return;
    startQuestion(state);
  }, 'host:next'));

  // Player joins with name via link
  socket.on('player:join', wrapRateLimit(({ gameId, name }, ack) => {
    const state = games.get(gameId);
    if (!state || state.started) {
      ack && ack({ ok: false, error: 'Game not found or already started' });
      return;
    }
    // Limit players per game
    if (state.players.size >= MAX_PLAYERS_PER_GAME) {
      ack && ack({ ok: false, error: 'Game is full.' });
      return;
    }
    // Sanitize name
    const safeName = sanitizeName(name);
    socket.join(gameId);
    state.players.set(socket.id, { name: safeName, score: 0, answeredAtMs: null, selectedOptionId: null, lastCorrect: false });
    ack && ack({ ok: true, gameId, title: state.title });
    broadcastLobby(state);
  }, 'player:join'));

  // Player submits answer
  socket.on('player:answer', wrapRateLimit(({ gameId, questionId, optionId }) => {
    const state = games.get(gameId);
    if (!state || !state.round) return;
    const p = state.players.get(socket.id);
    if (!p) return;

    const q = state.questions[state.currentIndex];
    if (!q || q.id !== questionId) return;
    if (p.selectedOptionId != null) return; // already answered

    p.selectedOptionId = optionId;
    p.answeredAtMs = Date.now();
    state.round.awaiting.delete(socket.id);

    // Notify player they locked in
    io.to(socket.id).emit('player:locked', { optionId });

    // If all answered, end early
    maybeEndEarly(state);
  }, 'player:answer'));

  socket.on('disconnect', () => {
    // Remove player or end game if host leaves
    for (const [gameId, state] of games) {
      if (state.hostSocketId === socket.id) {
        io.to(state.id).emit('game:cancelled', { reason: 'Host disconnected' });
        games.delete(gameId);
        break;
      }
      if (state.players.has(socket.id)) {
        state.players.delete(socket.id);
        broadcastLobby(state);
        // If no players remain and game hasn’t started, keep lobby; if in-round and all left, end round
        if (state.round && state.players.size === 0) {
          clearTimeout(state.round.timer);
          endRound(state);
        }
        break;
      }
    }
  });
});

// Start server
server.listen(PORT, HOST, () =>
  console.log(`NanoQuiz server running on http://${HOST}:${PORT}/host.html`)
);
